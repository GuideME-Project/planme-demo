import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  assessPlanmePlanningInput,
  isPlanmeClarificationResponse,
  PLANME_EXTERNAL_DURATION_ERROR_MESSAGE,
  PLANME_EXTERNAL_MAX_DURATION_DAYS,
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
import {
  getPlanmeWebOrigin,
  persistItineraryForDetailPage,
} from "./planme-mcp.js";
import { createPlanmeUsageRecorder } from "./usage-counters.js";
import { recommendAndPersistItinerary } from "./itinerary-recommendation-flow.js";
import {
  classifyPlanmeRecommendationFailure,
  createPlanmePublicFailurePayload,
  logPlanmeRecommendationFailure,
  mapPlanmeMeasurementToCompletionStage,
  PLANME_PUBLIC_FAILURE_STAGES,
} from "./recommendation-error-response.js";

type BodyRequest = IncomingMessage & {
  body?: object | string | Buffer;
};

const gptsTransportModeSchema = z
  .enum(["drive", "transit", "자동차", "대중교통"])
  .transform((value) => {
    // GPTs can repeat the user's Korean choice even when the internal contract uses English values.
    if (value === "자동차") {
      return "drive" as const;
    }

    if (value === "대중교통") {
      return "transit" as const;
    }

    return value;
  });
const externalDurationDaysSchema = z
  .number()
  .int()
  .min(1)
  .max(PLANME_EXTERNAL_MAX_DURATION_DAYS, PLANME_EXTERNAL_DURATION_ERROR_MESSAGE);
const planningRequestSchema = z.object({
  message: z.string().optional(),
  destination: z.string().optional(),
  destinationType: z.enum(["region", "place"]).optional(),
  mustVisitPlaces: z.array(z.string().min(1)).optional(),
  durationDays: externalDurationDaysSchema.optional(),
  arrivalAirport: z.string().optional(),
  arrivalTime: z.string().optional(),
  hotelName: z.string().optional(),
  origin: z.string().optional(),
  travelerCount: z.number().int().min(1).max(20).optional(),
  luggageCount: z.number().int().min(0).max(20).optional(),
  preferences: z.array(z.string()).optional(),
  theme: z.enum(["light", "dark"]).optional(),
  transportMode: gptsTransportModeSchema.optional(),
});
const recommendationRequestSchema = z
  .object({
    destination: z.string().min(1),
    destinationType: z.enum(["region", "place"]).optional(),
    mustVisitPlaces: z.array(z.string().min(1)).optional(),
    durationDays: externalDurationDaysSchema,
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
    transportMode: gptsTransportModeSchema,
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
    writeJson(response, 400, {
      error: "INVALID_PLANME_PLANNING_REQUEST",
      validationIssues: createGptsValidationIssues(parsed.error),
    });
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

  const traceId = randomUUID();

  try {
    const parsed = recommendationRequestSchema.safeParse(await readJsonBody(request));

    if (!parsed.success) {
      console.error("PlanME GPTs Actions request validation failure", {
        completionStage: "input_interpretation",
        event: "planme_gpts_request_validation_failure",
        internalCode: "INVALID_PLANME_RECOMMENDATION_REQUEST",
        retryable: false,
        stage: "request_validation",
        status: 400,
        traceId,
      });
      writeJson(response, 400, {
        error: "INVALID_PLANME_RECOMMENDATION_REQUEST",
        traceId,
        validationIssues: createGptsValidationIssues(parsed.error),
      });
      return;
    }

    const input: RecommendItineraryRequest = parsed.data;
    const usageRecorder = createPlanmeUsageRecorder();
    const result = await recommendAndPersistItinerary(
      `${getPlanmeWebOrigin()}/api/gpt/itineraries/recommend`,
      input,
      traceId,
      {
        aiOptions: {
          draftGeocoder: hasNaverGeocoderRuntimeConfig()
            ? createNaverGeocoder({ usageRecorder })
            : undefined,
          googleMapsReferer: `${getPlanmeWebOrigin()}/`,
          usageRecorder,
        },
        onStage: (event) => {
          console.info("PlanME GPTs Actions stage", {
            completionStage: mapPlanmeMeasurementToCompletionStage(event.stage),
            event: "planme_gpts_stage",
            ...event,
            traceId,
          });
        },
        persist: persistItineraryForDetailPage,
      },
    );

    if (result.status === "needs_clarification") {
      writeGptsRecommendationResponse(
        response,
        { ...toGptsRestRecommendationResponse(result), traceId },
        traceId,
        "clarification",
      );
      return;
    }

    writeGptsRecommendationResponse(
      response,
      { ...toGptsRestRecommendationResponse(result.response), traceId },
      traceId,
      "ready",
    );
  } catch (error) {
    const failure = classifyPlanmeRecommendationFailure(
      error instanceof Error ? error : new Error("PLANME_RECOMMENDATION_FAILED"),
    );

    logPlanmeRecommendationFailure("gpts", traceId, failure);
    writeJson(response, 500, createPlanmePublicFailurePayload(failure, traceId));
  }
}

/** Records response byte size without logging the GPTs payload itself. */
function writeGptsRecommendationResponse(
  response: ServerResponse,
  payload: object,
  traceId: string,
  stage: "clarification" | "ready",
) {
  const responseBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");

  console.info("PlanME GPTs Actions response", {
    completionStage: "response_delivery",
    event: "planme_gpts_response",
    responseBytes,
    stage,
    status: 200,
    traceId,
  });
  writeJson(response, 200, payload);
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
 * Returns field-level request errors without echoing user input or provider credentials.
 */
function createGptsValidationIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    message: issue.message,
    path: issue.path.join(".") || "request",
  }));
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
 * Keeps GPTs Actions responses link-focused after the full itinerary is persisted.
 * Route geometry, preview markup, and internal resolution logs stay on the detail surface.
 */
export function toGptsRestRecommendationResponse(response: PlanmeRecommendationResponse) {
  if (isPlanmeClarificationResponse(response)) {
    return toRestClarificationResponse(response);
  }

  return {
    itineraryId: response.itineraryId,
    title: response.title,
    summary: response.summary,
    standardTotalMinutes: response.standardTotalMinutes,
    carrymeTotalMinutes: response.carrymeTotalMinutes,
    days: response.days,
    ...(response.savedMinutes === undefined
      ? {}
      : { savedMinutes: response.savedMinutes }),
    savingStatus: response.savingStatus,
    pageUrl: response.pageUrl,
    detailLinkMarkdown: `[상세 일정 열기](${response.pageUrl})`,
    ogImageUrl: response.ogImageUrl,
    highlights: response.highlights,
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
          description:
            "Check only the four required inputs: origin, destination, trip length, and transport mode. PlanME supports trips from 1 through 3 days; for 4 days or longer, explain the limit and ask for a trip of up to 3 days. Ask the returned required questions exactly once. Do not ask for lodging or preferences.",
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
            "400": {
              description: "Invalid planning request with field-level validation issues",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/InvalidRequestResponse" },
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
          description:
            "When origin, destination, a supported trip length from 1 through 3 days, and transport mode are present, call immediately without additional research or optional questions. Do not call this operation for 4 days or longer; explain the 3-day limit and ask the user to shorten the trip. Never turn an internal generation failure into a request for more user input.",
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
            "500": {
              description: "AI generation or web handoff failed",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PlanmeErrorResponse" },
                },
              },
            },
            "400": {
              description: "Invalid recommendation request with field-level validation issues",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/InvalidRecommendationRequestResponse",
                  },
                },
              },
            },
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
            destinationType: {
              type: "string",
              enum: ["region", "place"],
              default: "region",
              description: "Exact single places use place; omitted values are treated as region.",
            },
            mustVisitPlaces: { type: "array", items: { type: "string" } },
            durationDays: {
              type: "integer",
              minimum: 1,
              maximum: PLANME_EXTERNAL_MAX_DURATION_DAYS,
              description: PLANME_EXTERNAL_DURATION_ERROR_MESSAGE,
            },
            arrivalAirport: { type: "string" },
            arrivalTime: { type: "string" },
            hotelName: { type: "string" },
            origin: { type: "string" },
            travelerCount: { type: "integer", minimum: 1, maximum: 20 },
            luggageCount: { type: "integer", minimum: 0, maximum: 20 },
            preferences: { type: "array", items: { type: "string" } },
            theme: { type: "string", enum: ["light", "dark"] },
            transportMode: {
              type: "string",
              enum: ["drive", "transit", "자동차", "대중교통"],
              description:
                "Use drive or 자동차 for car guidance; use transit or 대중교통 for public transit guidance.",
            },
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
            "destinationType",
            "origin",
            "arrivalAirport",
            "durationDays",
            "hotelName",
            "preferences",
            "mustVisitPlaces",
            "transportMode",
          ],
          properties: {
            destination: { type: ["string", "null"] },
            destinationType: {
              type: ["string", "null"],
              enum: ["region", "place", null],
            },
            origin: { type: ["string", "null"] },
            arrivalAirport: { type: ["string", "null"] },
            durationDays: { type: ["integer", "null"] },
            hotelName: { type: ["string", "null"] },
            preferences: { type: "array", items: { type: "string" } },
            mustVisitPlaces: { type: "array", items: { type: "string" } },
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
            destinationType: {
              type: "string",
              enum: ["region", "place"],
              default: "region",
              description:
                "Use region for a travel area that must not become a stop; use place for a user-selected destination. Omitted values are treated as region.",
            },
            mustVisitPlaces: {
              type: "array",
              items: { type: "string" },
              description: "Exact user-requested places that must remain fixed.",
            },
            durationDays: {
              type: "integer",
              minimum: 1,
              maximum: PLANME_EXTERNAL_MAX_DURATION_DAYS,
              description: PLANME_EXTERNAL_DURATION_ERROR_MESSAGE,
            },
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
            transportMode: {
              type: "string",
              enum: ["drive", "transit", "자동차", "대중교통"],
              description:
                "Use drive or 자동차 for car guidance; use transit or 대중교통 for public transit guidance. The response is normalized to drive or transit.",
            },
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
            "days",
            "savingStatus",
            "pageUrl",
            "detailLinkMarkdown",
            "highlights",
            "traceId",
          ],
          properties: {
            itineraryId: { type: "string" },
            title: { type: "string" },
            summary: { type: "string" },
            standardTotalMinutes: { type: "integer" },
            carrymeTotalMinutes: { type: "integer" },
            days: {
              type: "array",
              items: { $ref: "#/components/schemas/PlanmeItineraryDaySummary" },
            },
            savedMinutes: { type: "integer" },
            savingStatus: {
              type: "string",
              enum: ["verified", "hidden_estimated"],
            },
            pageUrl: { type: "string", format: "uri" },
            detailLinkMarkdown: {
              type: "string",
              description:
                "Render this exact Markdown link in the final answer without changing or omitting its URL.",
            },
            ogImageUrl: { type: "string", format: "uri" },
            highlights: { type: "array", items: { type: "string" } },
            status: { type: "string", enum: ["ready"] },
            validationIssues: { type: "array", items: { type: "string" } },
            transportMode: { type: "string", enum: ["drive", "transit"] },
            traceId: { type: "string", description: "Operational correlation identifier." },
          },
        },
        PlanmeRouteSummary: {
          type: "object",
          required: ["durationMinutes", "end", "start"],
          properties: {
            durationMinutes: { type: "integer" },
            end: { type: "string" },
            endTime: { type: "string" },
            start: { type: "string" },
            startTime: { type: "string" },
          },
        },
        PlanmeLuggageDeliverySummary: {
          type: "object",
          required: ["target", "time"],
          properties: {
            target: { type: "string" },
            targetRole: {
              type: "string",
              enum: ["출발지", "방문지", "숙소", "복귀지"],
            },
            time: { type: "string" },
          },
        },
        PlanmeItineraryDaySummary: {
          type: "object",
          required: [
            "carryme",
            "day",
            "isFinalDay",
            "label",
            "returnsToTripOrigin",
            "sameEndpoints",
            "savingStatus",
            "standard",
          ],
          properties: {
            carryme: { $ref: "#/components/schemas/PlanmeRouteSummary" },
            day: { type: "integer" },
            isFinalDay: { type: "boolean" },
            label: { type: "string" },
            luggageDelivery: {
              $ref: "#/components/schemas/PlanmeLuggageDeliverySummary",
            },
            returnsToTripOrigin: { type: "boolean" },
            sameEndpoints: { type: "boolean" },
            savedMinutes: { type: "integer" },
            savingStatus: {
              type: "string",
              enum: ["verified", "hidden_estimated"],
            },
            standard: { $ref: "#/components/schemas/PlanmeRouteSummary" },
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
        InvalidRequestResponse: {
          type: "object",
          required: ["error", "validationIssues"],
          properties: {
            error: { type: "string" },
            validationIssues: {
              type: "array",
              items: {
                type: "object",
                required: ["path", "message"],
                properties: {
                  path: { type: "string" },
                  message: { type: "string" },
                },
              },
            },
          },
        },
        InvalidRecommendationRequestResponse: {
          type: "object",
          required: ["error", "traceId", "validationIssues"],
          properties: {
            error: { type: "string", enum: ["INVALID_PLANME_RECOMMENDATION_REQUEST"] },
            traceId: { type: "string", format: "uuid" },
            validationIssues: {
              type: "array",
              items: {
                type: "object",
                required: ["path", "message"],
                properties: {
                  path: { type: "string" },
                  message: { type: "string" },
                },
              },
            },
          },
        },
        PlanmeErrorResponse: {
          type: "object",
          required: ["error", "message", "retryable", "stage", "status", "traceId"],
          properties: {
            error: { type: "string" },
            message: { type: "string" },
            retryable: { type: "boolean" },
            stage: { type: "string", enum: [...PLANME_PUBLIC_FAILURE_STAGES] },
            status: { type: "string", enum: ["error"] },
            traceId: { type: "string", format: "uuid" },
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
            "traceId",
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
            traceId: { type: "string", description: "Operational correlation identifier." },
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
