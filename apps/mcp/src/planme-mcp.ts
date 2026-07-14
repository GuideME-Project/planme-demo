import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import type { PlanmeItinerary } from "@planme/core";
import { z } from "zod";
import { createPlanmeWidgetHtml } from "./planme-widget.js";
import { PreviewStoreHandoffError } from "./preview-store-handoff-error.js";
import {
  PlanmeWebClientHttpError,
  advancePlanmeV3Itinerary,
  createPlanmeIdempotencyKey,
  getPlanmeV3Itinerary,
  getPlanmeWebOrigin as getConfiguredPlanmeWebOrigin,
  startPlanmeV3Itinerary,
  type PlanmeV3StartInput,
  type PlanmeWebJobResponse,
} from "./planme-web-client.js";

export { PreviewStoreHandoffError } from "./preview-store-handoff-error.js";

export const PLANME_WIDGET_URI = "ui://planme/itinerary-widget-v3.html";
const PLANME_LEGACY_WIDGET_URI = "ui://planme/itinerary-widget-v2.html";
const PLANME_MCP_ORIGIN = "https://planme-demo-mcp.vercel.app";
// Web finalization owns a 40-second deadline; MCP allows transport overhead beyond it.
const PLANME_WEB_FINALIZATION_TIMEOUT_MS = 43_000;

const transportModeSchema = z
  .enum(["drive", "transit", "자동차", "대중교통"])
  .describe("일정 전체 이동 수단입니다.");
type AppTransportMode = z.infer<typeof transportModeSchema>;

const planningSlotSchema = z.enum([
  "origin",
  "destination",
  "transportMode",
  "durationDays",
]);
const planningQuestionSchema = z.object({
  slot: planningSlotSchema,
  text: z.string(),
  required: z.boolean(),
  examples: z.array(z.string()),
});
const planningAssessmentSchema = {
  status: z.enum(["needs_input", "ready"]),
  missingSlots: z.array(planningSlotSchema),
  questions: z.array(planningQuestionSchema),
  normalizedInput: z.object({
    origin: z.string().nullable(),
    destination: z.string().nullable(),
    transportMode: z.enum(["drive", "transit"]).nullable(),
    durationDays: z.number().nullable(),
  }),
  nextAction: z.enum(["ask_user", "recommend_planme_itinerary"]),
};

const displayPlaceSchema = z.object({
  contentId: z.string(),
  contentTypeId: z.number(),
  title: z.string(),
  coordinate: z.object({ lat: z.number(), lng: z.number() }),
  address: z.string().optional(),
});
const widgetSchema = z.object({
  itineraryId: z.string(),
  revision: z.number(),
  title: z.string(),
  region: z.string(),
  durationDays: z.number(),
  transportMode: z.enum(["drive", "transit"]),
  days: z.array(z.object({ day: z.number(), visits: z.array(displayPlaceSchema) })),
  standardTotalMinutes: z.number(),
  carrymeTotalMinutes: z.number(),
  savedMinutes: z.number(),
  pageUrl: z.string().url(),
});
const jobOutputSchema = {
  status: z.enum(["processing", "ready", "failed"]),
  itineraryId: z.string(),
  phase: z.string().optional(),
  retryAfterMs: z.number().optional(),
  revision: z.number().optional(),
  pageUrl: z.string().url().optional(),
  widget: widgetSchema.optional(),
  excludedRequestedPlaces: z
    .array(z.object({ input: z.string(), reason: z.string() }))
    .optional(),
  errorCode: z.string().optional(),
  message: z.string().optional(),
};

export function createPlanmeMcpServer(): McpServer {
  const server = new McpServer({ name: "planme-mcp", version: "3.0.0" });
  registerWidgetResource(server, "planme-itinerary-widget-v3", PLANME_WIDGET_URI);
  registerWidgetResource(server, "planme-itinerary-widget-v2", PLANME_LEGACY_WIDGET_URI);

  registerAppTool(
    server,
    "start_planme_planning",
    {
      title: "Start PlanME planning",
      description:
        "출발지, 목적지, 전체 이동 수단, 여행 기간만 확인합니다. 숙소·선호·장소·시간·인원·짐을 먼저 질문하지 마세요.",
      inputSchema: {
        message: z.string().optional(),
        origin: z.string().optional(),
        destination: z.string().optional(),
        transportMode: transportModeSchema.optional(),
        durationDays: z.number().int().min(1).max(14).optional(),
      },
      outputSchema: planningAssessmentSchema,
      _meta: {
        "openai/toolInvocation/invoking": "PlanME 일정 조건을 확인하는 중입니다.",
        "openai/toolInvocation/invoked": "PlanME 일정 조건을 확인했습니다.",
      },
    },
    async (input) => {
      const transportMode = input.transportMode
        ? normalizeTransportMode(input.transportMode)
        : undefined;
      const missingSlots: Array<
        "origin" | "destination" | "transportMode" | "durationDays"
      > = [];
      if (!input.origin?.trim()) missingSlots.push("origin");
      if (!input.destination?.trim()) missingSlots.push("destination");
      if (!transportMode) missingSlots.push("transportMode");
      if (!input.durationDays) missingSlots.push("durationDays");
      const questions = missingSlots.map((slot) => ({
        slot,
        required: true,
        text: questionForSlot(slot),
        examples: examplesForSlot(slot),
      }));
      const assessment = {
        status: missingSlots.length > 0 ? "needs_input" as const : "ready" as const,
        missingSlots,
        questions,
        normalizedInput: {
          origin: input.origin?.trim() || null,
          destination: input.destination?.trim() || null,
          transportMode: transportMode ?? null,
          durationDays: input.durationDays ?? null,
        },
        nextAction:
          missingSlots.length > 0
            ? "ask_user" as const
            : "recommend_planme_itinerary" as const,
      };
      return {
        structuredContent: assessment,
        content: [
          {
            type: "text" as const,
            text: questions.length > 0
              ? questions.map((question) => question.text).join(" ")
              : "필수 조건이 준비됐습니다. 일정을 생성합니다.",
          },
        ],
      };
    },
  );

  registerAppTool(
    server,
    "recommend_planme_itinerary",
    {
      title: "Recommend PlanME itinerary",
      description:
        "웹 오케스트레이터에서 TourAPI 장소만으로 일정을 시작합니다. 처리 중 위젯이 자동 조회하므로 사용자에게 추가 호출이나 입력을 요구하지 마세요.",
      inputSchema: {
        origin: z.string().trim().min(1),
        destination: z.string().trim().min(1),
        transportMode: transportModeSchema,
        durationDays: z.number().int().min(1).max(14),
        travelStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        preferences: z.array(z.string()).optional(),
        requestedPlaces: z.array(z.string()).optional(),
        travelerCount: z.number().int().min(1).max(20).optional(),
        luggageCount: z.number().int().min(0).max(20).optional(),
      },
      outputSchema: jobOutputSchema,
      _meta: toolWidgetMeta("PlanME 일정을 구성하는 중입니다."),
    },
    async (input, extra) => {
      const requestId = String(extra.requestId ?? "").trim();
      if (!requestId) {
        return failedToolResult("", "MISSING_REQUEST_ID");
      }
      const startInput: PlanmeV3StartInput = {
        ...input,
        transportMode: normalizeTransportMode(input.transportMode),
      };
      try {
        const result = await startPlanmeV3Itinerary(
          startInput,
          createPlanmeIdempotencyKey("mcp", requestId),
        );
        return toToolResult(result);
      } catch (error) {
        return webClientFailureResult(
          error instanceof Error ? error : new Error("PLANME_WEB_UNAVAILABLE"),
        );
      }
    },
  );

  registerAppTool(
    server,
    "get_planme_itinerary",
    {
      title: "Get PlanME itinerary",
      description:
        "처리 중이면 웹에서 한 단계를 자동 진행하고 상태를 반환합니다. 위젯이 자동 재호출하므로 사용자에게 호출을 요청하지 마세요.",
      inputSchema: { itineraryId: z.string().min(1) },
      outputSchema: jobOutputSchema,
      _meta: toolWidgetMeta("PlanME 일정을 계산하는 중입니다."),
    },
    async ({ itineraryId }) => {
      try {
        let result = await getPlanmeV3Itinerary(itineraryId);
        if (result.status === "processing") {
          result = await advancePlanmeV3Itinerary(itineraryId);
        }
        return toToolResult(result);
      } catch (error) {
        return webClientFailureResult(
          error instanceof Error ? error : new Error("PLANME_WEB_UNAVAILABLE"),
          itineraryId,
        );
      }
    },
  );

  return server;
}

function toToolResult(result: PlanmeWebJobResponse) {
  const text = result.status === "processing"
    ? "PlanME가 일정을 자동으로 계산하고 있습니다. 사용자 입력은 필요하지 않습니다."
    : result.status === "failed"
      ? result.message
      : readyResultText(result);
  return {
    structuredContent: result,
    content: [{ type: "text" as const, text }],
    _meta: { planmeJob: result },
  };
}

function readyResultText(result: Extract<PlanmeWebJobResponse, { status: "ready" }>) {
  const excluded = result.excludedRequestedPlaces.length > 0
    ? ` ${result.excludedRequestedPlaces.map((item) =>
        item.reason === "UNROUTABLE"
          ? `요청한 장소 ${item.input}은 안전한 이동 경로를 확인하지 못해 일정에서 제외되었습니다.`
          : `요청한 장소 ${item.input}은 TourAPI에서 확인되지 않아 일정에서 제외되었습니다.`,
      ).join(" ")}`
    : "";
  return `${result.widget.title}: ${result.pageUrl}.${excluded}`;
}

function webClientFailureResult(error: Error | PlanmeWebClientHttpError, itineraryId = "") {
  const errorCode = error instanceof PlanmeWebClientHttpError
    ? error.errorCode
    : "PLANME_WEB_UNAVAILABLE";
  return failedToolResult(itineraryId, errorCode);
}

function failedToolResult(itineraryId: string, errorCode: string) {
  const result: PlanmeWebJobResponse = {
    status: "failed",
    itineraryId,
    errorCode,
    message: "안전한 여행 일정을 완성하지 못했습니다.",
  };
  return {
    structuredContent: result,
    content: [{ type: "text" as const, text: result.message }],
    _meta: { planmeJob: result },
  };
}

function normalizeTransportMode(value: AppTransportMode) {
  return value === "자동차" ? "drive" as const : value === "대중교통" ? "transit" as const : value;
}

function questionForSlot(
  slot: "origin" | "destination" | "transportMode" | "durationDays",
) {
  if (slot === "origin") return "어디에서 출발하시나요?";
  if (slot === "destination") return "어디로 여행하시나요?";
  if (slot === "transportMode") return "자동차와 대중교통 중 어떤 이동 수단을 이용하시나요?";
  return "며칠 동안 여행하시나요?";
}

function examplesForSlot(
  slot: "origin" | "destination" | "transportMode" | "durationDays",
) {
  if (slot === "origin") return ["서울역", "동탄"];
  if (slot === "destination") return ["부산", "경주"];
  if (slot === "transportMode") return ["자동차", "대중교통"];
  return ["1일", "2일"];
}

function toolWidgetMeta(invoking: string) {
  return {
    ui: { resourceUri: PLANME_WIDGET_URI },
    "openai/outputTemplate": PLANME_WIDGET_URI,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": "PlanME 일정 상태를 갱신했습니다.",
  };
}

function registerWidgetResource(
  server: McpServer,
  name: string,
  resourceUri: string,
) {
  registerAppResource(
    server,
    name,
    resourceUri,
    {
      title: "PlanME itinerary widget",
      description: "TourAPI 기반 PlanME 일정의 자동 처리 상태와 결과를 표시합니다.",
      _meta: createWidgetMeta(),
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: RESOURCE_MIME_TYPE,
          text: createPlanmeWidgetHtml(),
          _meta: createWidgetMeta(),
        },
      ],
    }),
  );
}

function createWidgetMeta() {
  const webOrigin = getPlanmeWebOrigin();
  return {
    ui: {
      prefersBorder: true,
      domain: PLANME_MCP_ORIGIN,
      csp: {
        connectDomains: [PLANME_MCP_ORIGIN, webOrigin],
        resourceDomains: [PLANME_MCP_ORIGIN, webOrigin],
      },
    },
    "openai/widgetDescription": "PlanME 일정 생성 상태와 CarryME 절약 결과를 보여줍니다.",
    "openai/widgetPrefersBorder": true,
    "openai/widgetCSP": {
      connect_domains: [PLANME_MCP_ORIGIN, webOrigin],
      redirect_domains: [webOrigin],
      resource_domains: [PLANME_MCP_ORIGIN, webOrigin],
    },
    "openai/widgetDomain": PLANME_MCP_ORIGIN,
  };
}

export function getPlanmeWebOrigin() {
  return getConfiguredPlanmeWebOrigin();
}

// Legacy export retained for existing V2 callers and regression boundaries.
export async function persistItineraryForDetailPage(
  itinerary: PlanmeItinerary,
  traceId: string = randomUUID(),
  timeoutMs = 40_000,
  signal?: AbortSignal,
) {
  const internalToken = getPlanmeInternalApiToken();
  const controller = new AbortController();
  const normalizedTimeoutMs = Math.max(1, Math.min(timeoutMs, 40_000));
  const timeout = setTimeout(
    () => controller.abort(),
    Math.min(PLANME_WEB_FINALIZATION_TIMEOUT_MS, normalizedTimeoutMs + 3_000),
  );
  const abortFromFlow = () => controller.abort(signal?.reason);

  if (signal?.aborted) {
    abortFromFlow();
  } else {
    signal?.addEventListener("abort", abortFromFlow, { once: true });
  }

  try {
    const response = await fetch(buildPlanmeWebUrl("/api/gpt/itineraries/preview-store"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${internalToken}`,
        "Content-Type": "application/json",
        "X-PlanME-Trace-Id": traceId,
      },
      body: JSON.stringify({ itinerary, timeoutMs: normalizedTimeoutMs }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const failure = await readPreviewStoreError(response);
      throw new PreviewStoreHandoffError(
        traceId,
        failure.internalCode,
        response.status,
        failure.repair,
        failure.classification,
      );
    }

    return response.json();
  } catch (error) {
    if (error instanceof PreviewStoreHandoffError) {
      throw error;
    }

    throw new PreviewStoreHandoffError(traceId, "PREVIEW_STORE_HANDOFF_REQUEST_FAILED");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromFlow);
  }
}

async function readPreviewStoreError(response: Response) {
  try {
    const body = (await response.json()) as {
      code?: PreviewStoreHandoffError["repairCode"];
      context?: PreviewStoreHandoffError["repairContext"];
      error?: string;
      retryable?: boolean;
      stage?: PreviewStoreHandoffError["failureStage"];
    };
    const errorCode = body.error?.trim() ?? "";

    return {
      internalCode: /^[A-Z][A-Z0-9_]{2,80}$/.test(errorCode)
        ? errorCode
        : "PREVIEW_STORE_HANDOFF_FAILED",
      repair:
        errorCode === "ROUTE_REPAIR_REQUIRED" && body.code && body.context
          ? { code: body.code, context: body.context }
          : undefined,
      classification: {
        failureStage: body.stage,
        retryable: typeof body.retryable === "boolean" ? body.retryable : undefined,
      },
    };
  } catch {
    return { internalCode: "PREVIEW_STORE_HANDOFF_FAILED" };
  }
}

function getPlanmeInternalApiToken() {
  const token = process.env.PLANME_INTERNAL_API_TOKEN?.trim();

  if (!token) {
    throw new Error("PLANME_INTERNAL_API_TOKEN is required.");
  }

  return token;
}

function buildPlanmeWebUrl(path: string) {
  return new URL(path, `${getPlanmeWebOrigin()}/`).toString();
}
