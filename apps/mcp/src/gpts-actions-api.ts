import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  assessPlanmePlanningInput,
  createAiRecommendedItineraryResponse,
  formatPlanmeAiGenerationError,
  isPlanmeClarificationResponse,
  PlanmeAiConfigurationError,
  type PlanmeClarificationResponse,
  type PlanmePlanningRequest,
  type PlanmeRecommendationResponse,
  type RecommendItineraryRequest,
} from "@planme/core";
import { writeCorsHeaders, writeJson } from "./http-utils.js";
import {
  createNaverGeocoder,
  hasNaverGeocoderRuntimeConfig,
} from "./naver-geocoding.js";
import { getPlanmeWebOrigin, persistItineraryForDetailPage } from "./planme-mcp.js";
import { createPlanmeUsageRecorder } from "./usage-counters.js";

type BodyRequest = IncomingMessage & {
  body?: object | string | Buffer;
};

const transportModeSchema = z.enum(["drive", "transit"]);
const planningRequestSchema = z.object({
  message: z.string().optional(),
  destination: z.string().optional(),
  durationDays: z.number().int().min(1).max(14).optional(),
  arrivalAirport: z.string().optional(),
  arrivalTime: z.string().optional(),
  hotelName: z.string().optional(),
  origin: z.string().optional(),
  travelerCount: z.number().int().min(1).max(20).optional(),
  luggageCount: z.number().int().min(0).max(20).optional(),
  preferences: z.array(z.string()).optional(),
  theme: z.enum(["light", "dark"]).optional(),
  transportMode: transportModeSchema.optional(),
});
const recommendationRequestSchema = z
  .object({
    destination: z.string().min(1),
    durationDays: z.number().int().min(1).max(14),
    arrivalAirport: z.string().optional(),
    arrivalTime: z.string().optional(),
    hotelName: z.string().optional(),
    origin: z.string().optional(),
    travelerCount: z.number().int().min(1).max(20).optional(),
    luggageCount: z.number().int().min(0).max(20).optional(),
    preferences: z.array(z.string()).optional(),
    clarificationAnswers: z.union([z.string(), z.array(z.string())]).optional(),
    clarificationContext: z
      .object({
        previousAnswers: z.array(z.string()),
        previousQuestions: z.array(z.string()),
        round: z.number().int().min(0).max(2),
        unresolvedPlaces: z.array(z.string()),
      })
      .optional(),
    theme: z.enum(["light", "dark"]).optional(),
    transportMode: transportModeSchema,
  })
  .refine((input) => Boolean(input.origin?.trim() || input.arrivalAirport?.trim()), {
    message: "origin or arrivalAirport is required",
  });

/**
 * Serves the OpenAPI schema used by GPTs Actions.
 */
export function handleGptsOpenApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  writeCorsHeaders(response);

  if (handleOptionsRequest(request, response)) {
    return;
  }

  if (request.method !== "GET") {
    writeJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }

  // GPT Builder imports this schema and then calls the same MCP deployment as REST.
  writeJson(response, 200, buildGptsOpenApiSchema(getRequestOrigin(request)));
}

/**
 * Handles GPTs Actions preflight planning requests.
 */
export async function handleGptsPlanningStartRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  writeCorsHeaders(response);

  if (handleOptionsRequest(request, response)) {
    return;
  }

  if (request.method !== "POST") {
    writeJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }

  const parsed = planningRequestSchema.safeParse(await readJsonBody(request));

  if (!parsed.success) {
    writeJson(response, 400, { error: "INVALID_PLANME_PLANNING_REQUEST" });
    return;
  }

  // Keep the same readiness rules as the Apps SDK MCP tool.
  writeJson(response, 200, assessPlanmePlanningInput(parsed.data));
}

/**
 * Handles GPTs Actions itinerary recommendation requests.
 */
export async function handleGptsRecommendItineraryRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  writeCorsHeaders(response);

  if (handleOptionsRequest(request, response)) {
    return;
  }

  if (request.method !== "POST") {
    writeJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }

  try {
    const parsed = recommendationRequestSchema.safeParse(await readJsonBody(request));

    if (!parsed.success) {
      writeJson(response, 400, { error: "INVALID_PLANME_RECOMMENDATION_REQUEST" });
      return;
    }

    const input: RecommendItineraryRequest = parsed.data;
    const usageRecorder = createPlanmeUsageRecorder();
    const generated = await createAiRecommendedItineraryResponse(
      `${getPlanmeWebOrigin()}/api/gpt/itineraries/recommend`,
      input,
      {
        draftGeocoder: hasNaverGeocoderRuntimeConfig()
          ? createNaverGeocoder({ usageRecorder })
          : undefined,
        googleMapsReferer: `${getPlanmeWebOrigin()}/`,
        usageRecorder,
      },
    );

    if (isPlanmeClarificationResponse(generated)) {
      writeJson(response, 200, toRestRecommendationResponse(generated));
      return;
    }

    // Do not return a usable detail URL unless the web handoff store accepted the itinerary.
    await persistItineraryForDetailPage(generated.itinerary);

    writeJson(response, 200, toRestRecommendationResponse(generated));
  } catch (error) {
    if (error instanceof PlanmeAiConfigurationError) {
      writeJson(response, 500, {
        error: "OPENAI_API_KEY_REQUIRED",
        message: "PlanME AI itinerary generation requires OPENAI_API_KEY.",
      });
      return;
    }

    const message =
      error instanceof Error ? formatPlanmeAiGenerationError(error) : "PlanME request failed";

    // The API key and itinerary payload are never logged or echoed in REST errors.
    console.error("PlanME GPTs Actions recommendation failed", message);
    writeJson(response, 500, {
      error: "PLANME_RECOMMENDATION_FAILED",
      message,
    });
  }
}

/**
 * Reads a JSON request body from Node or serverless adapters.
 */
async function readJsonBody(request: IncomingMessage): Promise<object> {
  const requestWithBody = request as BodyRequest;

  if (typeof requestWithBody.body === "string") {
    // Vercel can expose the raw JSON body as a string.
    return JSON.parse(requestWithBody.body) as object;
  }

  if (Buffer.isBuffer(requestWithBody.body)) {
    // Normalize buffered request bodies before passing them to shared core logic.
    return JSON.parse(requestWithBody.body.toString("utf8")) as object;
  }

  if (typeof requestWithBody.body === "object" && requestWithBody.body !== null) {
    return requestWithBody.body;
  }

  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    // IncomingMessage yields Buffer|string chunks depending on the runtime adapter.
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as object;
}

/**
 * Finishes CORS preflight requests before route-specific logic runs.
 */
function handleOptionsRequest(request: IncomingMessage, response: ServerResponse): boolean {
  if (request.method !== "OPTIONS") {
    return false;
  }

  // GPT Builder may preflight unauthenticated Action endpoints.
  response.writeHead(204);
  response.end();
  return true;
}

/**
 * Builds a public origin from Vercel and local Node request headers.
 */
function getRequestOrigin(request: IncomingMessage): string {
  const forwardedProto = firstHeaderValue(request.headers["x-forwarded-proto"]) ?? "https";
  const host = firstHeaderValue(request.headers.host) ?? "planme-demo-mcp.vercel.app";

  // OpenAPI servers must point at the MCP REST deployment, not the web detail app.
  return `${forwardedProto}://${host}`;
}

/**
 * Returns the first value from a Node HTTP header.
 */
function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Converts the core itinerary response into the REST payload exposed to GPTs.
 */
function toRestRecommendationResponse(response: PlanmeRecommendationResponse) {
  if (isPlanmeClarificationResponse(response)) {
    return toRestClarificationResponse(response);
  }

  return {
    itineraryId: response.itineraryId,
    title: response.title,
    summary: response.summary,
    standardTotalMinutes: response.standardTotalMinutes,
    carrymeTotalMinutes: response.carrymeTotalMinutes,
    savedMinutes: response.savedMinutes,
    pageUrl: response.pageUrl,
    ogImageUrl: response.ogImageUrl,
    previewMarkdown: response.previewMarkdown,
    highlights: response.highlights,
    resolutionLogs: response.resolutionLogs,
    itinerary: response.itinerary,
    transportMode: response.itinerary.transportMode,
    status: "ready",
    validationIssues: response.validationIssues?.map((issue) => issue.message),
  };
}

/**
 * Converts coordinate-resolution clarification into a GPTs-readable REST payload.
 */
function toRestClarificationResponse(response: PlanmeClarificationResponse) {
  return {
    clarificationContext: response.clarificationContext,
    feedbackMessage: response.feedbackMessage,
    message: response.message,
    questions: response.questions,
    resolutionLogs: response.resolutionLogs,
    status: response.status,
    unresolvedStops: response.unresolvedStops,
    validationIssues: response.validationIssues.map((issue) => issue.message),
  };
}

/**
 * Builds the OpenAPI document imported by GPT Builder Actions.
 */
function buildGptsOpenApiSchema(serverUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "PlanME GPTs Actions API",
      version: "0.1.0",
      description:
        "PlanME planning and itinerary generation API for GPTs Actions. The MCP endpoint remains available separately at /mcp.",
    },
    servers: [{ url: serverUrl }],
    paths: {
      "/api/gpt/planning/start": {
        post: {
          operationId: "startPlanmePlanning",
          summary: "Check whether a PlanME itinerary request has enough detail",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PlanmePlanningRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Planning readiness assessment",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PlanmePlanningAssessment" },
                },
              },
            },
          },
        },
      },
      "/api/gpt/itineraries/recommend": {
        post: {
          operationId: "recommendPlanmeItinerary",
          summary: "Generate a PlanME itinerary and return a detail page link",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RecommendItineraryRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Generated itinerary response or place clarification request",
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      { $ref: "#/components/schemas/ItineraryActionResponse" },
                      { $ref: "#/components/schemas/PlanmeClarificationResponse" },
                    ],
                  },
                },
              },
            },
            "500": { description: "AI generation or web handoff failed" },
          },
        },
      },
    },
    components: {
      schemas: {
        PlanmePlanningRequest: {
          type: "object",
          properties: {
            message: { type: "string" },
            destination: { type: "string", description: "Travel destination city or region." },
            durationDays: { type: "integer", minimum: 1, maximum: 14 },
            arrivalAirport: { type: "string" },
            arrivalTime: { type: "string" },
            hotelName: { type: "string" },
            origin: { type: "string" },
            travelerCount: { type: "integer", minimum: 1, maximum: 20 },
            luggageCount: { type: "integer", minimum: 0, maximum: 20 },
            preferences: { type: "array", items: { type: "string" } },
            theme: { type: "string", enum: ["light", "dark"] },
            transportMode: { type: "string", enum: ["drive", "transit"] },
          },
        },
        PlanmePlanningAssessment: {
          type: "object",
          required: ["status", "missingSlots", "questions", "normalizedInput", "nextAction"],
          properties: {
            status: { type: "string", enum: ["needs_input", "ready"] },
            missingSlots: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "destination",
                  "origin",
                  "durationDays",
                  "transportMode",
                  "hotelName",
                  "preferences",
                ],
              },
            },
            questions: {
              type: "array",
              items: { $ref: "#/components/schemas/PlanmePlanningQuestion" },
            },
            normalizedInput: { $ref: "#/components/schemas/NormalizedPlanningInput" },
            nextAction: { type: "string", enum: ["ask_user", "recommend_planme_itinerary"] },
          },
        },
        PlanmePlanningQuestion: {
          type: "object",
          required: ["slot", "text", "required", "examples"],
          properties: {
            slot: {
              type: "string",
              enum: [
                "destination",
                "origin",
                "durationDays",
                "transportMode",
                "hotelName",
                "preferences",
              ],
            },
            text: { type: "string" },
            required: { type: "boolean" },
            examples: { type: "array", items: { type: "string" } },
          },
        },
        NormalizedPlanningInput: {
          type: "object",
          required: [
            "destination",
            "origin",
            "arrivalAirport",
            "durationDays",
            "hotelName",
            "preferences",
            "transportMode",
          ],
          properties: {
            destination: { type: ["string", "null"] },
            origin: { type: ["string", "null"] },
            arrivalAirport: { type: ["string", "null"] },
            durationDays: { type: ["integer", "null"] },
            hotelName: { type: ["string", "null"] },
            preferences: { type: "array", items: { type: "string" } },
            transportMode: {
              type: ["string", "null"],
              enum: ["drive", "transit", null],
            },
          },
        },
        RecommendItineraryRequest: {
          type: "object",
          required: ["destination", "durationDays", "transportMode"],
          anyOf: [{ required: ["origin"] }, { required: ["arrivalAirport"] }],
          properties: {
            destination: {
              type: "string",
              description: "A Korean region, city, or user-selected place such as 경주월드.",
            },
            durationDays: { type: "integer", minimum: 1, maximum: 14 },
            arrivalAirport: { type: "string" },
            arrivalTime: { type: "string" },
            hotelName: { type: "string" },
            origin: { type: "string" },
            travelerCount: { type: "integer", minimum: 1, maximum: 20 },
            luggageCount: { type: "integer", minimum: 0, maximum: 20 },
            preferences: { type: "array", items: { type: "string" } },
            clarificationAnswers: {
              oneOf: [
                { type: "string" },
                { type: "array", items: { type: "string" } },
              ],
              description: "User answers for unresolved place clarification questions.",
            },
            clarificationContext: {
              $ref: "#/components/schemas/PlanmeClarificationContext",
            },
            theme: { type: "string", enum: ["light", "dark"] },
            transportMode: { type: "string", enum: ["drive", "transit"] },
          },
        },
        ItineraryActionResponse: {
          type: "object",
          required: [
            "itineraryId",
            "title",
            "summary",
            "standardTotalMinutes",
            "carrymeTotalMinutes",
            "savedMinutes",
            "pageUrl",
            "highlights",
          ],
          properties: {
            itineraryId: { type: "string" },
            title: { type: "string" },
            summary: { type: "string" },
            standardTotalMinutes: { type: "integer" },
            carrymeTotalMinutes: { type: "integer" },
            savedMinutes: { type: "integer" },
            pageUrl: { type: "string", format: "uri" },
            ogImageUrl: { type: "string", format: "uri" },
            previewMarkdown: { type: "string" },
            highlights: { type: "array", items: { type: "string" } },
            resolutionLogs: {
              type: "array",
              items: { $ref: "#/components/schemas/PlanmeResolutionLog" },
            },
            status: { type: "string", enum: ["ready"] },
            validationIssues: { type: "array", items: { type: "string" } },
            transportMode: { type: "string", enum: ["drive", "transit"] },
            itinerary: { type: "object", additionalProperties: true },
          },
        },
        PlanmeClarificationContext: {
          type: "object",
          required: ["previousAnswers", "previousQuestions", "round", "unresolvedPlaces"],
          properties: {
            previousAnswers: { type: "array", items: { type: "string" } },
            previousQuestions: { type: "array", items: { type: "string" } },
            round: { type: "integer", minimum: 0, maximum: 2 },
            unresolvedPlaces: { type: "array", items: { type: "string" } },
          },
        },
        PlanmeClarificationResponse: {
          type: "object",
          required: [
            "clarificationContext",
            "message",
            "questions",
            "resolutionLogs",
            "status",
            "unresolvedStops",
            "validationIssues",
          ],
          properties: {
            clarificationContext: { $ref: "#/components/schemas/PlanmeClarificationContext" },
            feedbackMessage: { type: "string" },
            message: { type: "string" },
            questions: { type: "array", items: { type: "string" } },
            resolutionLogs: {
              type: "array",
              items: { $ref: "#/components/schemas/PlanmeResolutionLog" },
            },
            status: { type: "string", enum: ["needs_clarification"] },
            unresolvedStops: { type: "array", items: { type: "string" } },
            validationIssues: { type: "array", items: { type: "string" } },
          },
        },
        PlanmeResolutionLog: {
          type: "object",
          required: ["decisionStatus", "originalName", "reason", "source"],
          properties: {
            decisionStatus: {
              type: "string",
              enum: ["accepted", "ambiguous", "rejected"],
            },
            originalName: { type: "string" },
            query: { type: "string" },
            reason: { type: "string" },
            resolvedName: { type: "string" },
            source: { type: "string" },
          },
        },
      },
    },
  };
}
