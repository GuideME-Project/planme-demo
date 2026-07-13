import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import {
  assessPlanmePlanningInput,
  PLANME_EXTERNAL_DURATION_ERROR_MESSAGE,
  PLANME_EXTERNAL_MAX_DURATION_DAYS,
  type GptActionItineraryDaySummary,
  type GptActionItineraryResponse,
  type PlanmeClarificationResponse,
  type PlanmeItinerary,
  type PlanmePlanningRequest,
  type RecommendItineraryRequest,
} from "@planme/core";
import { z } from "zod";
import {
  createNaverGeocoder,
  hasNaverGeocoderRuntimeConfig,
} from "./naver-geocoding.js";
import { createPlanmeWidgetHtml } from "./planme-widget.js";
import { createPlanmeUsageRecorder } from "./usage-counters.js";
import {
  recommendAndPersistItinerary,
} from "./itinerary-recommendation-flow.js";
import {
  classifyPlanmeRecommendationFailure,
  createPlanmePublicFailurePayload,
  logPlanmeRecommendationFailure,
  mapPlanmeMeasurementToCompletionStage,
  PLANME_PUBLIC_FAILURE_STAGES,
  type PlanmePublicFailureStage,
} from "./recommendation-error-response.js";
import { PreviewStoreHandoffError } from "./preview-store-handoff-error.js";
export { PreviewStoreHandoffError } from "./preview-store-handoff-error.js";

export const PLANME_WIDGET_URI = "ui://planme/itinerary-widget-v2.html";
const PLANME_LEGACY_WIDGET_URI = "ui://planme/itinerary-widget.html";
const PLANME_WEB_ORIGIN = "https://planme-demo.vercel.app";
const PLANME_MCP_ORIGIN = "https://planme-demo-mcp.vercel.app";
// Web finalization owns a 40-second deadline; MCP allows transport and JSON overhead beyond it.
const PLANME_WEB_FINALIZATION_TIMEOUT_MS = 43_000;
const PLANME_WEB_LOOKUP_TIMEOUT_MS = 8_000;

type PersistedFinalizedItineraryResponse = {
  expiresAt: string;
  itinerary: PlanmeItinerary;
  itineraryId: string;
  ogImageUrl: string;
  pageUrl: string;
  revision: number;
  status: "ready";
};

const timelineEventSchema = z.object({
  time: z.string(),
  title: z.string(),
  description: z
    .string()
    .describe(
      "Short event description. Do not say luggage is stored, retrieved, or picked up at a plain train/subway station, terminal, or airport.",
    ),
  category: z.string(),
  highlight: z.boolean().optional(),
  savingLabel: z.string().optional(),
});

const itineraryDaySummarySchema = z.object({
  carryme: z.object({
    durationMinutes: z.number(),
    end: z.string(),
    endTime: z.string().optional(),
    start: z.string(),
    startTime: z.string().optional(),
  }),
  day: z.number(),
  isFinalDay: z.boolean(),
  label: z.string(),
  luggageDelivery: z
    .object({
      target: z.string(),
      targetRole: z.enum(["출발지", "방문지", "숙소", "복귀지"]).optional(),
      time: z.string(),
    })
    .optional(),
  returnsToTripOrigin: z.boolean(),
  sameEndpoints: z.boolean(),
  savedMinutes: z.number().optional(),
  savingStatus: z.enum(["verified", "hidden_estimated"]),
  standard: z.object({
    durationMinutes: z.number(),
    end: z.string(),
    endTime: z.string().optional(),
    start: z.string(),
    startTime: z.string().optional(),
  }),
});

const planningSlotSchema = z.enum([
  "destination",
  "origin",
  "durationDays",
  "transportMode",
  "hotelName",
  "preferences",
]);

const planningQuestionSchema = z.object({
  slot: planningSlotSchema,
  text: z.string(),
  required: z.boolean(),
  examples: z.array(z.string()),
});

const appTransportModeSchema = z
  .enum(["drive", "transit", "자동차", "대중교통"])
  .describe(
    "일정 전체 이동 수단입니다. 사용자가 자동차를 선택하면 자동차 또는 drive, 대중교통을 선택하면 대중교통 또는 transit으로 전달하세요.",
  );
const externalDurationDaysSchema = z
  .number()
  .int()
  .min(1)
  .max(PLANME_EXTERNAL_MAX_DURATION_DAYS, PLANME_EXTERNAL_DURATION_ERROR_MESSAGE)
  .describe(PLANME_EXTERNAL_DURATION_ERROR_MESSAGE);

type AppTransportMode = z.infer<typeof appTransportModeSchema>;
type AppPlanmePlanningRequest = Omit<PlanmePlanningRequest, "transportMode"> & {
  transportMode?: AppTransportMode;
};
type AppRecommendItineraryRequest = Omit<RecommendItineraryRequest, "transportMode"> & {
  transportMode: AppTransportMode;
};

/**
 * Converts Apps tool choices into the internal itinerary transport-mode values.
 */
function normalizeAppTransportMode(value: AppTransportMode): RecommendItineraryRequest["transportMode"] {
  // Apps can repeat Korean choices, while the itinerary generator requires internal values.
  if (value === "자동차") {
    return "drive";
  }

  if (value === "대중교통") {
    return "transit";
  }

  return value;
}

const itinerarySummarySchema = {
  clarificationContext: z
    .object({
      previousAnswers: z.array(z.string()),
      previousQuestions: z.array(z.string()),
      round: z.number(),
      unresolvedPlaces: z.array(z.string()),
    })
    .optional(),
  carrymeTotalMinutes: z.number().optional(),
  days: z.array(itineraryDaySummarySchema).optional(),
  error: z.enum(["OPENAI_API_KEY_REQUIRED", "PLANME_RECOMMENDATION_FAILED"]).optional(),
  feedbackMessage: z.string().optional(),
  itineraryId: z.string().optional(),
  message: z.string().optional(),
  pageUrl: z.string().url().optional(),
  questions: z.array(z.string()).optional(),
  resolutionLogs: z
    .array(
      z.object({
        decisionStatus: z.string(),
        originalName: z.string(),
        query: z.string().optional(),
        reason: z.string(),
        resolvedName: z.string().optional(),
        source: z.string(),
      }),
    )
    .optional(),
  retryable: z.boolean().optional(),
  savedMinutes: z.number().optional(),
  savingStatus: z.enum(["verified", "hidden_estimated"]).optional(),
  standardTotalMinutes: z.number().optional(),
  transportMode: z.enum(["drive", "transit"]).optional(),
  stage: z.enum(PLANME_PUBLIC_FAILURE_STAGES).optional(),
  status: z.enum(["ready", "needs_clarification", "error"]),
  summary: z.string().optional(),
  timeline: z.array(timelineEventSchema).optional(),
  title: z.string().optional(),
  traceId: z.string().optional(),
  unresolvedStops: z.array(z.string()).optional(),
  validationIssues: z.array(z.string()).optional(),
};

const planningAssessmentSchema = {
  status: z.enum(["needs_input", "ready"]),
  missingSlots: z.array(planningSlotSchema),
  questions: z.array(planningQuestionSchema),
  normalizedInput: z.object({
    destination: z.string().nullable(),
    destinationType: z.enum(["region", "place"]).nullable(),
    origin: z.string().nullable(),
    arrivalAirport: z.string().nullable(),
    durationDays: z.number().nullable(),
    hotelName: z.string().nullable(),
    preferences: z.array(z.string()),
    mustVisitPlaces: z.array(z.string()),
    transportMode: z.enum(["drive", "transit"]).nullable(),
  }),
  nextAction: z.enum(["ask_user", "recommend_planme_itinerary"]),
};

type ItinerarySummary = {
  clarificationContext?: PlanmeClarificationResponse["clarificationContext"];
  carrymeTotalMinutes?: number;
  days?: GptActionItineraryDaySummary[];
  error?: "OPENAI_API_KEY_REQUIRED" | "PLANME_RECOMMENDATION_FAILED";
  feedbackMessage?: string;
  itineraryId?: string;
  message?: string;
  pageUrl?: string;
  questions?: string[];
  resolutionLogs?: PlanmeClarificationResponse["resolutionLogs"];
  retryable?: boolean;
  savedMinutes?: number;
  savingStatus?: "verified" | "hidden_estimated";
  standardTotalMinutes?: number;
  transportMode?: "drive" | "transit";
  stage?: PlanmePublicFailureStage;
  status: "ready" | "needs_clarification" | "error";
  summary?: string;
  timeline?: Array<{
    time: string;
    title: string;
    description: string;
    category: string;
    highlight?: boolean;
    savingLabel?: string;
  }>;
  title?: string;
  traceId?: string;
  unresolvedStops?: string[];
  validationIssues?: string[];
};

/**
 * Converts PlanME core itinerary data into the model-visible MCP output shape.
 */
function toItinerarySummary(response: GptActionItineraryResponse): ItinerarySummary {
  const firstDay = response.itinerary.days[0];

  // Keep model-visible data compact; full itinerary details are passed through _meta for the widget.
  return {
    carrymeTotalMinutes: response.carrymeTotalMinutes,
    days: response.days,
    itineraryId: response.itineraryId,
    pageUrl: response.pageUrl,
    resolutionLogs: response.resolutionLogs,
    savedMinutes: response.savedMinutes,
    savingStatus: response.savingStatus,
    standardTotalMinutes: response.standardTotalMinutes,
    transportMode: response.itinerary.transportMode,
    status: "ready",
    summary: response.summary,
    timeline: firstDay.timeline,
    title: response.title,
    validationIssues: response.validationIssues?.map((issue) => issue.message),
  };
}

/**
 * Converts coordinate-resolution failures into model-visible MCP clarification content.
 */
function toClarificationSummary(response: PlanmeClarificationResponse): ItinerarySummary {
  return {
    clarificationContext: response.clarificationContext,
    feedbackMessage: response.feedbackMessage,
    message: response.message,
    questions: response.questions,
    resolutionLogs: response.resolutionLogs,
    status: "needs_clarification",
    unresolvedStops: response.unresolvedStops,
    validationIssues: response.validationIssues.map((issue) => issue.message),
  };
}

/**
 * Builds the non-model-visible metadata used by the PlanME widget.
 */
function toWidgetMeta(itinerary: PlanmeItinerary, pageUrl: string) {
  // Widget metadata can be richer than structuredContent because it is rendered by the component.
  return {
    itinerary: {
      ...itinerary,
      detailUrl: pageUrl,
    },
    widget: {
      defaultView: "timeline",
      showMap: true,
    },
  };
}

/**
 * Persists an MCP-produced itinerary through the web app so short detail links can reopen it.
 */
export async function persistItineraryForDetailPage(
  itinerary: PlanmeItinerary,
  traceId: string = randomUUID(),
  timeoutMs = 40_000,
  signal?: AbortSignal,
): Promise<PersistedFinalizedItineraryResponse> {
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
      // Only the stable web error code crosses service boundaries; response messages stay private.
      const failure = await readPreviewStoreError(response);
      throw new PreviewStoreHandoffError(
        traceId,
        failure.internalCode,
        response.status,
        failure.repair,
        failure.classification,
      );
    }

    return (await response.json()) as PersistedFinalizedItineraryResponse;
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

/** Reads only a stable error code from the web handoff response. */
async function readPreviewStoreError(response: Response) {
  try {
    const body = (await response.json()) as {
      code?: PreviewStoreHandoffError["repairCode"];
      context?: PreviewStoreHandoffError["repairContext"];
      error?: string;
      retryable?: boolean;
      stage?:
        | "itinerary_finalization"
        | "place_resolution"
        | "route_calculation"
        | "storage";
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

/** Reads one finalized version 2 itinerary and retries one transient lookup failure. */
async function fetchFinalizedItineraryForWidget(itineraryId: string) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PLANME_WEB_LOOKUP_TIMEOUT_MS);

    try {
      const response = await fetch(
        buildPlanmeWebUrl(`/api/gpt/itineraries/${encodeURIComponent(itineraryId)}`),
        { signal: controller.signal },
      );

      if (response.ok) {
        return (await response.json()) as GptActionItineraryResponse;
      }

      if (response.status < 500 || attempt === 1) {
        return null;
      }
    } catch {
      if (attempt === 1) {
        return null;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}

/** Reads the server-only handoff token required by both Vercel projects. */
function getPlanmeInternalApiToken() {
  const token = process.env.PLANME_INTERNAL_API_TOKEN?.trim();

  if (!token) {
    throw new Error("PLANME_INTERNAL_API_TOKEN is required.");
  }

  return token;
}

/**
 * Reads the web origin lazily so tests and Vercel env can override the handoff target.
 */
export function getPlanmeWebOrigin(): string {
  const raw = process.env.PLANME_WEB_ORIGIN?.trim() || PLANME_WEB_ORIGIN;

  return new URL(raw).origin;
}

/**
 * Builds an absolute web URL from the normalized PlanME web origin.
 */
function buildPlanmeWebUrl(path: string): string {
  return new URL(path, `${getPlanmeWebOrigin()}/`).toString();
}

/**
 * Builds a web-origin request URL for PlanME core link generation.
 */
function getPlanmeWebRequestUrl(): string {
  // Keep generated page URLs aligned with the same web origin used for preview persistence.
  return buildPlanmeWebUrl("/mcp");
}

/**
 * Builds Apps SDK resource metadata using the current web origin.
 */
function createPlanmeWidgetMeta() {
  const webOrigin = getPlanmeWebOrigin();
  const widgetCsp = {
    connectDomains: [PLANME_MCP_ORIGIN, webOrigin],
    resourceDomains: [PLANME_MCP_ORIGIN, webOrigin],
  };

  return {
    ui: {
      prefersBorder: true,
      domain: PLANME_MCP_ORIGIN,
      csp: widgetCsp,
    },
    "openai/widgetDescription": "PlanME 일정의 전체 이동 시간과 1~3일차 CarryME 타임라인을 보여줍니다.",
    "openai/widgetPrefersBorder": true,
    "openai/widgetCSP": {
      connect_domains: widgetCsp.connectDomains,
      redirect_domains: [webOrigin],
      resource_domains: widgetCsp.resourceDomains,
    },
    "openai/widgetDomain": PLANME_MCP_ORIGIN,
  };
}

/**
 * Registers a PlanME widget HTML resource for a ChatGPT Apps SDK template URI.
 */
function registerPlanmeWidgetResource(server: McpServer, name: string, resourceUri: string): void {
  // Register both current and legacy URIs because ChatGPT can cache tool descriptors between app updates.
  registerAppResource(
    server,
    name,
    resourceUri,
    {
      title: "PlanME itinerary widget",
      description: "Renders the PlanME Standard and CarryME timeline comparison.",
      _meta: createPlanmeWidgetMeta(),
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: RESOURCE_MIME_TYPE,
          text: createPlanmeWidgetHtml(),
          _meta: createPlanmeWidgetMeta(),
        },
      ],
    }),
  );
}

/**
 * Creates the PlanME MCP server used by the GPT App proof of concept.
 */
export function createPlanmeMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "planme-mcp",
      version: "0.1.0",
    },
    {
      instructions:
        "When GuideME-PlanME is selected and the user asks to create a travel itinerary, use this server instead of web search. PlanME supports trips from 1 through 3 days. For 4 days or longer, explain the 3-day limit and ask the user to shorten the trip without calling recommend_planme_itinerary. If origin, destination, a supported trip length, and transport mode are present, call recommend_planme_itinerary immediately without researching routes, stations, coordinates, or attractions. Any non-empty origin is valid, including a broad region, city, neighborhood, station, or landmark such as 동탄. Never ask the user for a more exact origin, place name, or address; pass the user's origin text unchanged because the server resolves a representative departure point. When transport mode is answered in a follow-up turn, preserve the origin, destination, and trip length from the first turn. Call start_planme_planning only when one of those four inputs is missing. After a ready result, call get_planme_itinerary exactly once.",
    },
  );
  const usageRecorder = createPlanmeUsageRecorder();

  registerPlanmeWidgetResource(server, "planme-itinerary-widget-v2", PLANME_WIDGET_URI);
  registerPlanmeWidgetResource(server, "planme-itinerary-widget-legacy", PLANME_LEGACY_WIDGET_URI);

  registerAppTool(
    server,
    "start_planme_planning",
    {
      title: "PlanME 여행 조건 확인",
      description:
        "Use this when the user asks PlanME to create a travel itinerary but origin, destination, a supported trip length from 1 through 3 days, or transport mode is missing. Any non-empty origin such as 동탄, 마포구청, or 강동역 already satisfies the origin requirement. Never treat a broad origin as missing and never ask for a more exact place name or address; the server resolves a representative point. When transport mode is supplied later, preserve the first turn's origin, destination, and trip length. For 4 days or longer, explain the 3-day limit and ask the user to shorten the trip. If the four required inputs are present, do not research attractions, stations, or coordinates and call recommend_planme_itinerary immediately. Lodging and preferences may be omitted and are not blockers.",
      inputSchema: {
        message: z.string().optional(),
        destination: z.string().optional(),
        destinationType: z
          .enum(["region", "place"])
          .optional()
          .describe("정확한 단일 장소만 place이며, 생략하면 region으로 처리합니다."),
        mustVisitPlaces: z.array(z.string().min(1)).optional(),
        durationDays: externalDurationDaysSchema.optional(),
        arrivalAirport: z.string().optional(),
        arrivalTime: z.string().optional(),
        hotelName: z.string().optional(),
        origin: z
          .string()
          .min(1)
          .optional()
          .describe(
            "사용자가 말한 출발지 원문입니다. 동탄 같은 넓은 지역도 유효하므로 더 정확한 장소명이나 주소를 묻지 말고 그대로 전달하세요.",
          ),
        travelerCount: z.number().int().min(1).max(20).optional(),
        luggageCount: z.number().int().min(0).max(20).optional(),
        preferences: z.array(z.string()).optional(),
        transportMode: appTransportModeSchema.optional(),
        theme: z.enum(["light", "dark"]).optional(),
      },
      outputSchema: planningAssessmentSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      _meta: {
        "openai/toolInvocation/invoking": "PlanME 일정 조건을 확인하는 중입니다.",
        "openai/toolInvocation/invoked": "PlanME 일정 질문이 준비됐습니다.",
      },
    },
    async (input: AppPlanmePlanningRequest) => {
      const normalizedInput: PlanmePlanningRequest = {
        ...input,
        transportMode: input.transportMode
          ? normalizeAppTransportMode(input.transportMode)
          : undefined,
      };
      const assessment = assessPlanmePlanningInput(normalizedInput);

      // This preflight tool does not render the widget; it tells ChatGPT what to ask next.
      return {
        structuredContent: assessment,
        content: [
          {
            type: "text" as const,
            text:
              assessment.status === "ready"
                ? "PlanME 일정 생성에 필요한 기본 조건이 준비됐습니다. recommend_planme_itinerary를 호출해 MCP 서버에서 일정을 생성하세요."
                : `PlanME 일정 생성 전에 ${assessment.questions
                    .map((question) => question.text)
                    .join(" ")}`,
          },
        ],
      };
    },
  );

  registerAppTool(
    server,
    "recommend_planme_itinerary",
    {
      title: "PlanME 여행 일정 생성 및 저장",
      description:
        "Use this when the user asks PlanME to create a travel itinerary of 1 through 3 days and origin, destination, trip length, and transport mode are present, for example '동탄에서 남해 1박 2일 여행 일정, 자동차.' Any non-empty origin is valid, including a broad region, city, neighborhood, station, or landmark. Never ask for a more exact origin, place name, or address; pass the user's origin text unchanged because the server resolves a representative departure point. When transport mode is answered in a follow-up turn, preserve the origin, destination, and trip length from the first turn. Do not call this tool for 4 days or longer; explain the 3-day limit and ask the user to shorten the trip. Call this tool before browsing or researching attractions, stations, coordinates, or routes; the server selects, verifies, replaces, and saves itinerary places. Pass only places explicitly fixed by the user in mustVisitPlaces, and do not pass ChatGPT-authored days or timeline events. Missing lodging and preferences are allowed. If the response status is needs_clarification, ask the returned question in chat. If the response status is ready, call get_planme_itinerary exactly once with the returned itineraryId to render the widget. Do not render a widget from this tool. CarryME luggage handoff points must be lodging, hotels, or explicit pickup points, not plain train/subway stations, terminals, or airports.",
      inputSchema: {
        destination: z
          .string()
          .min(1)
          .describe("A Korean region, city, or user-selected place such as 경주월드."),
        destinationType: z
          .enum(["region", "place"])
          .optional()
          .describe(
            "지역 범위만 고정하면 region, 사용자가 고른 정확한 목적지이면 place입니다. 생략하면 region으로 처리합니다.",
          ),
        mustVisitPlaces: z
          .array(z.string().min(1))
          .optional()
          .describe("사용자가 직접 지정한 필수 방문 장소 목록입니다."),
        durationDays: externalDurationDaysSchema,
        arrivalAirport: z.string().optional(),
        arrivalTime: z.string().optional(),
        hotelName: z.string().optional(),
        origin: z
          .string()
          .min(1)
          .optional()
          .describe(
            "사용자가 말한 출발지 원문입니다. 동탄 같은 넓은 지역도 유효하므로 더 정확한 장소명이나 주소를 묻지 말고 그대로 전달하세요. 서버가 대표 출발 지점을 확정합니다.",
          ),
        travelerCount: z.number().int().min(1).max(20).optional(),
        luggageCount: z.number().int().min(0).max(20).optional(),
        preferences: z
          .array(z.string())
          .optional()
          .describe("User preferences like 아이 동반 or 바다 전망."),
        transportMode: appTransportModeSchema,
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
      },
      outputSchema: itinerarySummarySchema,
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
      },
      _meta: {
        "openai/toolInvocation/invoking": "PlanME 일정을 구성하는 중입니다.",
        "openai/toolInvocation/invoked": "PlanME 일정이 준비됐습니다.",
      },
    },
    async (input: AppRecommendItineraryRequest) => {
      const traceId = randomUUID();
      const normalizedInput: RecommendItineraryRequest = {
        ...input,
        transportMode: normalizeAppTransportMode(input.transportMode),
      };
      let response: GptActionItineraryResponse;

      try {
        const result = await recommendAndPersistItinerary(
          getPlanmeWebRequestUrl(),
          normalizedInput,
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
              console.info("PlanME Apps stage", {
                completionStage: mapPlanmeMeasurementToCompletionStage(event.stage),
                event: "planme_apps_stage",
                ...event,
                traceId,
              });
            },
            persist: persistItineraryForDetailPage,
          },
        );

        if (result.status === "needs_clarification") {
          const structuredContent = { ...toClarificationSummary(result), traceId };

          console.info("PlanME Apps response", {
            completionStage: "response_delivery",
            event: "planme_apps_response",
            stage: "clarification",
            status: 200,
            traceId,
          });

          return {
            structuredContent,
            content: [
              {
                type: "text" as const,
                text: `${result.message} 확인 필요 장소: ${result.unresolvedStops.join(", ")}`,
              },
            ],
          };
        }

        response = result.response;
      } catch (error) {
        const failure = classifyPlanmeRecommendationFailure(
          error instanceof Error ? error : new Error("PLANME_RECOMMENDATION_FAILED"),
        );
        const structuredContent: ItinerarySummary = createPlanmePublicFailurePayload(
          failure,
          traceId,
        );

        logPlanmeRecommendationFailure("apps", traceId, failure);

        return {
          isError: true,
          structuredContent,
          content: [
            {
              type: "text" as const,
              text: `${failure.message} 추적 ID: ${traceId}`,
            },
          ],
        };
      }

      const structuredContent = { ...toItinerarySummary(response), traceId };

      console.info("PlanME Apps response", {
        completionStage: "response_delivery",
        event: "planme_apps_response",
        stage: "ready",
        status: 200,
        traceId,
      });

      // The model calls the widget-only lookup tool after this server-side generation succeeds.
      return {
        structuredContent,
        content: [
          {
            type: "text" as const,
            text: `${response.title} 일정 생성과 저장이 완료됐습니다. get_planme_itinerary를 itineraryId ${response.itineraryId}로 한 번 호출해 일정 위젯을 표시하세요.`,
          },
        ],
      };
    },
  );

  registerAppTool(
    server,
    "get_planme_itinerary",
    {
      title: "저장된 PlanME 여행 일정 표시",
      description:
        "Use this when recommend_planme_itinerary returns status ready. Call exactly once with the returned itineraryId to show the saved PlanME itinerary in the timeline widget.",
      inputSchema: {
        itineraryId: z.string().min(1),
      },
      outputSchema: itinerarySummarySchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      _meta: {
        ui: {
          resourceUri: PLANME_WIDGET_URI,
        },
        "openai/outputTemplate": PLANME_WIDGET_URI,
        "openai/toolInvocation/invoking": "PlanME 일정을 조회하는 중입니다.",
        "openai/toolInvocation/invoked": "PlanME 일정을 불러왔습니다.",
      },
    },
    async ({ itineraryId }: { itineraryId: string }) => {
      const response = await fetchFinalizedItineraryForWidget(itineraryId);

      if (!response) {
        // MCP clients surface tool errors better when the result is explicitly marked as an error.
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `PlanME itinerary not found: ${itineraryId}`,
            },
          ],
        };
      }

      const structuredContent = toItinerarySummary(response);

      return {
        structuredContent,
        content: [
          {
            type: "text" as const,
            text: `${response.title}: ${response.pageUrl}`,
          },
        ],
        _meta: toWidgetMeta(response.itinerary, response.pageUrl),
      };
    },
  );

  return server;
}
