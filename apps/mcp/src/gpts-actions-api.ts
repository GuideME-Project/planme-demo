import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { writeCorsHeaders, writeJson } from "./http-utils.js";
import {
  createPlanmeIdempotencyKey,
  PlanmeWebClientHttpError,
  runPlanmeV3Itinerary,
  startPlanmeV3Itinerary,
  getPlanmeWebOrigin,
  type PlanmeV3StartInput,
} from "./planme-web-client.js";

type BodyRequest = IncomingMessage & {
  body?: object | string | Buffer;
};

const transportModeSchema = z
  .enum(["drive", "transit", "자동차", "대중교통"])
  .transform((value) =>
    value === "자동차" ? "drive" as const : value === "대중교통" ? "transit" as const : value,
  );
const requestedPlacesSchema = z
  .union([
    z.string().trim().min(1),
    z.array(z.string().trim().min(1)),
  ])
  .transform((value) => Array.isArray(value) ? value : [value]);
const planningRequestSchema = z
  .object({
    message: z.string().optional(),
    destination: z.string().optional(),
    durationDays: z.number().int().min(1).max(14).optional(),
    origin: z.string().optional(),
    transportMode: transportModeSchema.optional(),
  })
  .strict();
const recommendationRequestSchema = z
  .object({
    invocationId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/).optional(),
    latestUserMessage: z.string().trim().min(1).optional(),
    origin: z.string().trim().min(1),
    destination: z.string().trim().min(1),
    destinationType: z.enum(["region", "place"]).optional(),
    durationDays: z.number().int().min(1).max(14),
    transportMode: transportModeSchema.optional(),
    travelStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    preferences: z.array(z.string()).optional(),
    requestedPlaces: requestedPlacesSchema.optional(),
    travelerCount: z.number().int().min(1).max(20).optional(),
    luggageCount: z.number().int().min(0).max(20).optional(),
    mustVisitPlaces: requestedPlacesSchema.optional(),
  })
  .strict();

type PlanningSlot = "origin" | "destination" | "transportMode" | "durationDays";

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
  writeJson(response, 200, buildGptsOpenApiSchema(getRequestOrigin(request)));
}

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
    writeJson(response, 400, invalidRequest(parsed.error));
    return;
  }
  writeJson(response, 200, assessPlanningInput(parsed.data));
}

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
  const deadlineEpochMs = Date.now() + 55_000;
  const parsed = recommendationRequestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    writeJson(response, 400, invalidRequest(parsed.error));
    return;
  }
  const {
    invocationId,
    latestUserMessage,
    mustVisitPlaces,
    destinationType: _destinationType,
    transportMode: parsedTransportMode,
    ...input
  } = parsed.data;
  const transportMode =
    parsedTransportMode ?? resolveLegacyTransportMode(latestUserMessage);
  if (!transportMode) {
    writeJson(response, 200, assessPlanningInput({ ...input, transportMode }));
    return;
  }
  const sourceId = invocationId ?? `legacy:${randomUUID()}`;
  const startInput = {
    ...input,
    requestedPlaces: input.requestedPlaces ?? mustVisitPlaces,
    transportMode,
  } satisfies PlanmeV3StartInput;
  const recoveredIdempotencyKey = createPlanmeIdempotencyKey(
    "gpts",
    createRecoveredSourceId(sourceId, startInput),
  );

  try {
    let result;
    try {
      result = await startPlanmeV3Itinerary(
        startInput,
        createPlanmeIdempotencyKey("gpts", sourceId),
      );
    } catch (error) {
      if (
        !invocationId ||
        !(error instanceof PlanmeWebClientHttpError) ||
        error.status !== 409
      ) {
        throw error;
      }
      result = await startPlanmeV3Itinerary(
        startInput,
        recoveredIdempotencyKey,
      );
    }
    if (invocationId && result.status === "failed") {
      result = await startPlanmeV3Itinerary(
        startInput,
        recoveredIdempotencyKey,
      );
    }
    if (result.status === "processing") {
      result = await runPlanmeV3Itinerary(result.itineraryId, deadlineEpochMs);
    }
    if (result.status === "processing") {
      writeJson(response, 200, {
        status: "failed",
        itineraryId: result.itineraryId,
        errorCode: "TIME_BUDGET_EXCEEDED",
        message: "제한 시간 안에 안전한 일정을 완성하지 못했습니다.",
      });
      return;
    }
    const actionPageUrl = result.status === "ready"
      ? createActionPageUrl(request, result.itineraryId)
      : undefined;
    const highlights = result.status === "ready"
      ? result.widget.days.flatMap((day) => day.visits.map((visit) => visit.title))
      : [];
    const detailLinkMarkdown = result.status === "ready"
      ? `[상세 일정 열기](${actionPageUrl})`
      : undefined;
    const excludedNotice = result.status === "ready"
      ? buildExcludedNotice(result.excludedRequestedPlaces)
      : "";
    writeJson(response, 200, result.status === "ready"
      ? {
          status: result.status,
          finalAnswerMarkdown: buildFinalAnswerMarkdown({
            detailLinkMarkdown: detailLinkMarkdown!,
            durationDays: result.widget.durationDays,
            excludedNotice,
            highlights,
            origin: startInput.origin,
            savedMinutes: result.widget.savedMinutes,
            title: result.widget.title,
            transportMode: result.widget.transportMode,
          }),
          detailLinkMarkdown: detailLinkMarkdown!,
          itineraryId: result.itineraryId,
          revision: result.revision,
          pageUrl: actionPageUrl!,
          title: result.widget.title,
          origin: startInput.origin,
          destination: startInput.destination,
          durationDays: result.widget.durationDays,
          transportMode: result.widget.transportMode,
          highlights,
          savedMinutes: result.widget.savedMinutes,
          excludedRequestedPlaces: result.excludedRequestedPlaces,
          excludedNotice,
        }
      : result);
  } catch (error) {
    if (error instanceof PlanmeWebClientHttpError) {
      const status = [400, 409, 429].includes(error.status) ? error.status : 503;
      writeJson(response, status, { error: error.errorCode });
      return;
    }
    writeJson(response, 503, { error: "PLANME_WEB_UNAVAILABLE" });
  }
}

function buildFinalAnswerMarkdown(input: {
  detailLinkMarkdown: string;
  durationDays: number;
  excludedNotice: string;
  highlights: string[];
  origin: string;
  savedMinutes: number;
  title: string;
  transportMode: "drive" | "transit";
}) {
  const transportLabel = input.transportMode === "drive" ? "자동차" : "대중교통";
  return [
    `**${input.title}**이 완성됐습니다.`,
    `${input.origin} 출발 · ${transportLabel} · ${input.durationDays}일`,
    input.highlights.length > 0 ? `주요 일정: ${input.highlights.join(", ")}` : "",
    `CarryME 예상 절약 시간: ${input.savedMinutes}분`,
    input.excludedNotice,
    input.detailLinkMarkdown,
  ].filter(Boolean).join("\n\n");
}

export function handleGptsItineraryOpenRequest(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  if (request.method !== "GET") {
    writeJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }
  const requestUrl = new URL(request.url ?? "/", getRequestOrigin(request));
  const itineraryId = requestUrl.searchParams.get("itineraryId")?.trim() ?? "";
  if (!/^planme-v3-[A-Za-z0-9-]+$/.test(itineraryId)) {
    writeJson(response, 400, { error: "INVALID_ITINERARY_ID" });
    return;
  }
  response.statusCode = 302;
  response.setHeader(
    "Location",
    new URL(`/itinerary/${encodeURIComponent(itineraryId)}`, getPlanmeWebOrigin()).toString(),
  );
  response.setHeader("Cache-Control", "no-store");
  response.end();
}

function createActionPageUrl(request: IncomingMessage, itineraryId: string) {
  const url = new URL("/api/gpt/itineraries/open", getRequestOrigin(request));
  url.searchParams.set("itineraryId", itineraryId);
  return url.toString();
}

function createRecoveredSourceId(sourceId: string, input: PlanmeV3StartInput) {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 24);
  return `recovered:${sourceId}:${fingerprint}`;
}

function resolveLegacyTransportMode(message: string | undefined) {
  if (!message) {
    return undefined;
  }
  const normalized = message.normalize("NFKC");
  const mentionsDrive = /자동차|자차/.test(normalized);
  const mentionsTransit = /대중\s*교통/.test(normalized);
  if (mentionsDrive === mentionsTransit) {
    return undefined;
  }
  return mentionsDrive ? "drive" as const : "transit" as const;
}

function buildExcludedNotice(
  excludedRequestedPlaces: Array<{ input: string; reason: string }>,
) {
  return excludedRequestedPlaces
    .map(({ input, reason }) => reason === "TOURAPI_NOT_FOUND"
      ? `요청한 장소 "${input}": TourAPI에서 확인되지 않아 일정에서 제외되었습니다.`
      : `요청한 장소 "${input}": 경로를 확정할 수 없어 일정에서 제외되었습니다.`)
    .join("\n");
}

function assessPlanningInput(input: {
  origin?: string;
  destination?: string;
  durationDays?: number;
  transportMode?: "drive" | "transit";
}) {
  const missingSlots: PlanningSlot[] = [];
  if (!input.origin?.trim()) missingSlots.push("origin");
  if (!input.destination?.trim()) missingSlots.push("destination");
  if (!input.transportMode) missingSlots.push("transportMode");
  if (!input.durationDays) missingSlots.push("durationDays");
  const questions = missingSlots.map((slot) => ({
    slot,
    required: true,
    text: planningQuestion(slot),
    examples: planningExamples(slot),
  }));
  return {
    status: missingSlots.length > 0 ? "needs_input" as const : "ready" as const,
    missingSlots,
    questions,
    normalizedInput: {
      origin: input.origin?.trim() || null,
      destination: input.destination?.trim() || null,
      durationDays: input.durationDays ?? null,
      transportMode: input.transportMode ?? null,
    },
    nextAction:
      missingSlots.length > 0 ? "ask_user" as const : "recommend_planme_itinerary" as const,
  };
}

function planningQuestion(slot: PlanningSlot) {
  if (slot === "origin") return "어디에서 출발하시나요?";
  if (slot === "destination") return "어디로 여행하시나요?";
  if (slot === "transportMode") return "자동차와 대중교통 중 어떤 이동 수단을 이용하시나요?";
  return "며칠 동안 여행하시나요?";
}

function planningExamples(slot: PlanningSlot) {
  if (slot === "origin") return ["서울역", "동탄"];
  if (slot === "destination") return ["부산", "경주"];
  if (slot === "transportMode") return ["자동차", "대중교통"];
  return ["1일", "2일"];
}

async function readJsonBody(request: IncomingMessage): Promise<object> {
  const requestWithBody = request as BodyRequest;
  if (typeof requestWithBody.body === "string") {
    return JSON.parse(requestWithBody.body) as object;
  }
  if (Buffer.isBuffer(requestWithBody.body)) {
    return JSON.parse(requestWithBody.body.toString("utf8")) as object;
  }
  if (typeof requestWithBody.body === "object" && requestWithBody.body !== null) {
    return requestWithBody.body;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return chunks.length === 0
    ? {}
    : JSON.parse(Buffer.concat(chunks).toString("utf8")) as object;
}

function invalidRequest(error: z.ZodError) {
  return {
    error: "INVALID_PLANME_REQUEST",
    validationIssues: error.issues.map((issue) => ({
      message: issue.message,
      path: issue.path.join(".") || "request",
    })),
  };
}

function handleOptionsRequest(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== "OPTIONS") {
    return false;
  }
  response.writeHead(204);
  response.end();
  return true;
}

function getRequestOrigin(request: IncomingMessage) {
  const host = firstHeaderValue(request.headers.host) ?? "planme-demo-mcp.vercel.app";
  const localHost = /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host);
  const forwardedProto = firstHeaderValue(request.headers["x-forwarded-proto"])
    ?? (localHost ? "http" : "https");
  return `${forwardedProto}://${host}`;
}

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function buildGptsOpenApiSchema(serverUrl: string) {
  const transportMode = {
    type: "string",
    enum: ["drive", "transit", "자동차", "대중교통"],
    description:
      "사용자가 현재 대화에서 직접 확정한 이동 수단입니다. 자동차는 drive, 대중교통은 transit입니다. 이후 턴의 최신 메시지가 출발지만 포함하더라도 이전 턴에서 확정한 값을 반드시 다시 포함하며, 누락하거나 다시 묻지 않습니다.",
  };
  const startProperties = {
    origin: {
      type: "string",
      description:
        "현재 또는 이전 대화 턴에서 사용자가 직접 확정한 출발지입니다. 동탄처럼 넓은 지역명도 유효하며 더 구체적인 주소를 다시 묻지 않습니다.",
    },
    destination: {
      type: "string",
      description:
        "현재 또는 이전 대화 턴에서 사용자가 직접 확정한 목적지입니다. 이후 턴에도 이 값을 유지해 전달합니다.",
    },
    durationDays: {
      type: "integer",
      minimum: 1,
      maximum: 14,
      description:
        "현재 또는 이전 대화 턴에서 확정한 여행 일수입니다. 1일부터 14일까지 지원하며, 13박 14일은 durationDays=14로 유지합니다.",
    },
    transportMode,
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "PlanME GPTs Actions API",
      version: "3.0.0",
      description:
        "TourAPI 장소만 사용하는 PlanME V3 일정 API입니다. invocationId는 도구가 생성하며 사용자에게 묻거나 보여주지 않습니다.",
    },
    servers: [{ url: serverUrl }],
    paths: {
      "/api/gpt/planning/start": {
        post: {
          operationId: "startPlanmePlanning",
          summary: "출발지, 목적지, 이동 수단, 기간의 누락 여부 확인",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: { message: { type: "string" }, ...startProperties },
                },
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
            "400": { description: "Invalid planning request" },
          },
        },
      },
      "/api/gpt/itineraries/recommend": {
        post: {
          operationId: "recommendPlanmeItinerary",
          summary: "TourAPI 기반 일정을 42초 안에 생성",
          description:
            "대화 전체에서 출발지, 목적지, 여행 일수, 이동 수단이 모두 확정된 뒤 한 번만 호출합니다. 최신 사용자 메시지에 없는 값도 이전 턴의 확정값을 누적해 네 필드를 모두 전달합니다. status=ready이면 finalAnswerMarkdown을 한 글자도 바꾸거나 덧붙이지 말고 최종 답변 전체로 그대로 출력합니다.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "invocationId",
                    "origin",
                    "destination",
                    "durationDays",
                    "transportMode",
                  ],
                  properties: {
                    invocationId: {
                      type: "string",
                      minLength: 1,
                      maxLength: 128,
                      pattern: "^[A-Za-z0-9._:-]+$",
                      description:
                        "도구 호출용 식별자입니다. 새 생성에는 새 값을 만들고 재전송에는 같은 값을 사용하며 사용자에게 질문하지 않습니다.",
                    },
                    latestUserMessage: {
                      type: "string",
                      minLength: 1,
                      description:
                        "사용자가 방금 작성한 최신 메시지 원문입니다. 누적 상태를 대신하지 않으므로 origin, destination, durationDays, transportMode는 대화 전체의 확정값을 각각 별도 필드로 전달합니다.",
                    },
                    ...startProperties,
                    travelStartDate: { type: "string", format: "date" },
                    preferences: { type: "array", items: { type: "string" } },
                    requestedPlaces: { type: "array", items: { type: "string" } },
                    travelerCount: { type: "integer", minimum: 1, maximum: 20 },
                    luggageCount: { type: "integer", minimum: 0, maximum: 20 },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Terminal ready or failed response; processing is never returned",
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      { $ref: "#/components/schemas/ItineraryReadyResponse" },
                      { $ref: "#/components/schemas/ItineraryFailedResponse" },
                    ],
                  },
                },
              },
            },
            "400": { description: "Invalid request" },
            "409": { description: "Idempotency conflict" },
            "429": { description: "Rate limited" },
            "503": { description: "Job could not be created" },
          },
        },
      },
    },
    components: {
      schemas: {
        PlanningSlot: {
          type: "string",
          enum: ["origin", "destination", "transportMode", "durationDays"],
        },
        PlanmePlanningQuestion: {
          type: "object",
          additionalProperties: false,
          required: ["slot", "text", "required", "examples"],
          properties: {
            slot: { $ref: "#/components/schemas/PlanningSlot" },
            text: { type: "string" },
            required: { type: "boolean" },
            examples: { type: "array", items: { type: "string" } },
          },
        },
        PlanmePlanningAssessment: {
          type: "object",
          required: ["status", "missingSlots", "questions", "normalizedInput", "nextAction"],
          properties: {
            status: { type: "string", enum: ["needs_input", "ready"] },
            missingSlots: {
              type: "array",
              items: { $ref: "#/components/schemas/PlanningSlot" },
            },
            questions: {
              type: "array",
              items: { $ref: "#/components/schemas/PlanmePlanningQuestion" },
            },
            normalizedInput: { type: "object" },
            nextAction: {
              type: "string",
              enum: ["ask_user", "recommend_planme_itinerary"],
            },
          },
        },
        ItineraryReadyResponse: {
          type: "object",
          additionalProperties: false,
          required: [
            "status",
            "finalAnswerMarkdown",
            "detailLinkMarkdown",
            "itineraryId",
            "revision",
            "pageUrl",
            "title",
            "origin",
            "destination",
            "durationDays",
            "transportMode",
            "highlights",
            "savedMinutes",
            "excludedRequestedPlaces",
            "excludedNotice",
          ],
          properties: {
            status: { type: "string", enum: ["ready"] },
            finalAnswerMarkdown: {
              type: "string",
              description:
                "한 글자도 바꾸거나 덧붙이지 말고 최종 답변 전체로 그대로 출력할 Markdown입니다.",
            },
            detailLinkMarkdown: {
              type: "string",
              description:
                "응답 마지막 줄에 포함된 [상세 일정 열기](URL) 형식의 Markdown 링크입니다.",
            },
            itineraryId: { type: "string" },
            revision: { type: "integer" },
            pageUrl: {
              type: "string",
              format: "uri",
              description:
                "Action 서버와 같은 도메인에서 웹 상세 화면으로 안전하게 연결되는 URL입니다. 사용자에게 [상세 일정 열기](pageUrl) 형식의 클릭 가능한 Markdown 링크로 제공합니다.",
            },
            title: { type: "string" },
            origin: { type: "string" },
            destination: { type: "string" },
            durationDays: { type: "integer" },
            transportMode: { type: "string", enum: ["drive", "transit"] },
            highlights: { type: "array", items: { type: "string" } },
            savedMinutes: { type: "integer" },
            excludedRequestedPlaces: { type: "array", items: { type: "object" } },
            excludedNotice: {
              type: "string",
              description:
                "비어 있지 않으면 내용을 바꾸지 말고 사용자에게 그대로 출력합니다.",
            },
          },
        },
        ItineraryFailedResponse: {
          type: "object",
          additionalProperties: false,
          required: ["status", "itineraryId", "errorCode", "message"],
          properties: {
            status: { type: "string", enum: ["failed"] },
            itineraryId: { type: "string" },
            errorCode: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
  };
}
