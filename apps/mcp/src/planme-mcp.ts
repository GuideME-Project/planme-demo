import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import {
  assessPlanmePlanningInput,
  createAiRecommendedItineraryResponse,
  commitPlanmeDraftPreview,
  createPlanmeDraftPreview,
  formatPlanmeAiGenerationError,
  getGptActionItineraryResponse,
  PlanmeAiConfigurationError,
  toDraftGptActionItineraryResponse,
  toGptActionItineraryResponse,
  updatePlanmeDraftPreview,
  type GptActionItineraryResponse,
  type PlanmeDraftCommitRequest,
  type PlanmeDraftPreviewRequest,
  type PlanmeDraftPreviewResult,
  type PlanmeItinerary,
  type PlanmePlanningRequest,
  type RecommendItineraryRequest,
} from "@planme/core";
import { z } from "zod";
import { createPlanmeWidgetHtml } from "./planme-widget.js";

export const PLANME_WIDGET_URI = "ui://planme/itinerary-widget-v2.html";
const PLANME_LEGACY_WIDGET_URI = "ui://planme/itinerary-widget.html";
const PLANME_WEB_ORIGIN = "https://planme-demo.vercel.app";
const PLANME_MCP_ORIGIN = "https://planme-demo-mcp.vercel.app";

const planmeWidgetCsp = {
  connectDomains: [PLANME_MCP_ORIGIN, PLANME_WEB_ORIGIN],
  resourceDomains: [PLANME_MCP_ORIGIN, PLANME_WEB_ORIGIN],
};

const planmeLegacyWidgetCsp = {
  connect_domains: planmeWidgetCsp.connectDomains,
  resource_domains: planmeWidgetCsp.resourceDomains,
  redirect_domains: [PLANME_WEB_ORIGIN],
};

const planmeWidgetMeta = {
  ui: {
    prefersBorder: true,
    domain: PLANME_MCP_ORIGIN,
    csp: planmeWidgetCsp,
  },
  "openai/widgetDescription": "PlanME 일정의 CarryME 절약 효과와 Day 1 타임라인을 보여줍니다.",
  "openai/widgetPrefersBorder": true,
  "openai/widgetCSP": planmeLegacyWidgetCsp,
  "openai/widgetDomain": PLANME_MCP_ORIGIN,
};

const timelineEventSchema = z.object({
  time: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  highlight: z.boolean().optional(),
  savingLabel: z.string().optional(),
});

const draftStopSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("Single stop or POI name only. Do not put a full route list in one stop."),
  role: z
    .enum(["origin", "visit", "luggageDestination", "finalDestination"])
    .optional(),
  caption: z.string().optional(),
  coordinate: z
    .object({
      lat: z.number(),
      lng: z.number(),
    })
    .optional(),
});

const draftTimelineEventSchema = z.object({
  time: z.string(),
  title: z
    .string()
    .describe("Short single-event title only, such as 독일마을 산책. Do not repeat the full route."),
  description: z.string(),
  category: z
    .enum(["arrival", "carryme", "transit", "meal", "hotel", "event"])
    .optional(),
  highlight: z.boolean().optional(),
  savingLabel: z.string().optional(),
});

const draftDaySchema = z.object({
  day: z.number().int().min(1).max(14).optional(),
  label: z.string().optional(),
  stops: z.array(draftStopSchema).min(1),
  timeline: z.array(draftTimelineEventSchema).min(1),
  standardDurationMinutes: z.number().int().min(0).optional(),
  carrymeDurationMinutes: z.number().int().min(0).optional(),
  standardRouteText: z.string().optional(),
  carrymeRouteText: z.string().optional(),
});

const planningSlotSchema = z.enum([
  "destination",
  "origin",
  "durationDays",
  "hotelName",
  "preferences",
]);

const planningQuestionSchema = z.object({
  slot: planningSlotSchema,
  text: z.string(),
  required: z.boolean(),
  examples: z.array(z.string()),
});

const itinerarySummarySchema = {
  itineraryId: z.string(),
  title: z.string(),
  summary: z.string(),
  pageUrl: z.string().url(),
  savedMinutes: z.number(),
  standardTotalMinutes: z.number(),
  carrymeTotalMinutes: z.number(),
  timeline: z.array(timelineEventSchema),
};

const draftValidationIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(["error", "warning"]),
});

const recommendationSummarySchema = {
  ...itinerarySummarySchema,
  previewId: z.string().optional(),
  status: z.enum(["preview_ready", "needs_revision", "committed"]).optional(),
  validationIssues: z.array(draftValidationIssueSchema).optional(),
  version: z.number().int().min(1).optional(),
};

const draftPreviewSummarySchema = {
  ...itinerarySummarySchema,
  previewId: z.string(),
  status: z.enum(["preview_ready", "needs_revision", "committed"]),
  validationIssues: z.array(draftValidationIssueSchema),
  version: z.number().int().min(1),
};

const planningAssessmentSchema = {
  status: z.enum(["needs_input", "ready"]),
  missingSlots: z.array(planningSlotSchema),
  questions: z.array(planningQuestionSchema),
  normalizedInput: z.object({
    destination: z.string().nullable(),
    origin: z.string().nullable(),
    arrivalAirport: z.string().nullable(),
    durationDays: z.number().nullable(),
    hotelName: z.string().nullable(),
    preferences: z.array(z.string()),
  }),
  nextAction: z.enum(["ask_user", "draft_planme_itinerary"]),
};

type ItinerarySummary = {
  itineraryId: string;
  title: string;
  summary: string;
  pageUrl: string;
  savedMinutes: number;
  standardTotalMinutes: number;
  carrymeTotalMinutes: number;
  timeline: Array<{
    time: string;
    title: string;
    description: string;
    category: string;
    highlight?: boolean;
    savingLabel?: string;
  }>;
  previewId?: string;
  status?: PlanmeDraftPreviewResult["status"];
  validationIssues?: PlanmeDraftPreviewResult["validationIssues"];
  version?: number;
};

type DraftPreviewSummary = ItinerarySummary & {
  previewId: string;
  status: "preview_ready" | "needs_revision" | "committed";
  validationIssues: Array<{
    code: string;
    message: string;
    severity: "error" | "warning";
  }>;
  version: number;
};

/**
 * Converts PlanME core itinerary data into the model-visible MCP output shape.
 */
function toItinerarySummary(response: GptActionItineraryResponse): ItinerarySummary {
  const firstDay = response.itinerary.days[0];
  const draftFields =
    response.previewId && response.status && response.validationIssues && response.version
      ? {
          previewId: response.previewId,
          status: response.status,
          validationIssues: response.validationIssues,
          version: response.version,
        }
      : {};

  // Keep model-visible data compact; full itinerary details are passed through _meta for the widget.
  return {
    itineraryId: response.itineraryId,
    title: response.title,
    summary: response.summary,
    pageUrl: response.pageUrl,
    savedMinutes: response.savedMinutes,
    standardTotalMinutes: response.standardTotalMinutes,
    carrymeTotalMinutes: response.carrymeTotalMinutes,
    timeline: firstDay.timeline,
    ...draftFields,
  };
}

/**
 * Converts a normalized draft preview into model-visible MCP output.
 */
function toDraftPreviewSummary(result: PlanmeDraftPreviewResult): DraftPreviewSummary {
  const response = toDraftGptActionItineraryResponse(result, `${PLANME_WEB_ORIGIN}/mcp`);

  return {
    ...toItinerarySummary(response),
    previewId: result.previewId,
    status: result.status,
    validationIssues: result.validationIssues,
    version: result.version,
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
async function persistItineraryForDetailPage(itinerary: PlanmeItinerary): Promise<void> {
  if (process.env.VERCEL !== "1") {
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(`${PLANME_WEB_ORIGIN}/api/gpt/itineraries/preview-store`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ itinerary }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Do not log the itinerary payload; status is enough to diagnose handoff failures.
      console.error("PlanME preview store handoff failed", response.status);
    }
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : "unknown error";

    // The widget can still render from _meta; this only affects the external detail page.
    console.error("PlanME preview store handoff error", safeMessage);
  } finally {
    clearTimeout(timeout);
  }
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
      _meta: planmeWidgetMeta,
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: RESOURCE_MIME_TYPE,
          text: createPlanmeWidgetHtml(),
          _meta: planmeWidgetMeta,
        },
      ],
    }),
  );
}

/**
 * Creates the PlanME MCP server used by the GPT App proof of concept.
 */
export function createPlanmeMcpServer(): McpServer {
  const server = new McpServer({
    name: "planme-mcp",
    version: "0.1.0",
  });

  registerPlanmeWidgetResource(server, "planme-itinerary-widget-v2", PLANME_WIDGET_URI);
  registerPlanmeWidgetResource(server, "planme-itinerary-widget-legacy", PLANME_LEGACY_WIDGET_URI);

  registerAppTool(
    server,
    "start_planme_planning",
    {
      title: "Start PlanME planning",
      description:
        "Check whether a PlanME request has enough detail. Use this first when origin, destination, trip length, lodging, or preferences are unclear; ask the returned questions before recommending an itinerary.",
      inputSchema: {
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
      },
      outputSchema: planningAssessmentSchema,
      _meta: {
        "openai/toolInvocation/invoking": "PlanME 일정 조건을 확인하는 중입니다.",
        "openai/toolInvocation/invoked": "PlanME 일정 질문이 준비됐습니다.",
      },
    },
    async (input: PlanmePlanningRequest) => {
      const assessment = assessPlanmePlanningInput(input);

      // This preflight tool does not render the widget; it tells ChatGPT what to ask next.
      return {
        structuredContent: assessment,
        content: [
          {
            type: "text" as const,
            text:
              assessment.status === "ready"
                ? "PlanME 일정 초안에 필요한 기본 조건이 준비됐습니다. 대화에서 일정 초안을 작성한 뒤 preview_planme_itinerary를 호출하세요."
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
    "preview_planme_itinerary",
    {
      title: "Preview PlanME itinerary draft",
      description:
        "Render a PlanME widget from the itinerary draft ChatGPT just authored in the conversation. Use this as soon as a draft itinerary is available; do not wait for the user to explicitly ask to open PlanME.",
      inputSchema: {
        title: z
          .string()
          .min(1)
          .describe("Compact itinerary title. Do not list every stop in the title."),
        region: z.string().optional(),
        duration: z.string().optional(),
        summary: z.string().optional(),
        origin: z.string().optional().describe("Optional departure city or station. Do not invent an airport origin."),
        assumptions: z.array(z.string()).optional(),
        savedMinutes: z.number().int().min(0).optional(),
        days: z.array(draftDaySchema).min(1),
      },
      outputSchema: draftPreviewSummarySchema,
      _meta: {
        ui: {
          resourceUri: PLANME_WIDGET_URI,
        },
        "openai/outputTemplate": PLANME_WIDGET_URI,
        "openai/toolInvocation/invoking": "PlanME 일정 초안을 위젯으로 구성하는 중입니다.",
        "openai/toolInvocation/invoked": "PlanME 일정 초안 위젯이 준비됐습니다.",
      },
    },
    async (input: PlanmeDraftPreviewRequest) => {
      const result = createPlanmeDraftPreview(input);
      await persistItineraryForDetailPage(result.itinerary);
      const structuredContent = toDraftPreviewSummary(result);

      // The full normalized itinerary is passed through _meta so the widget and text stay aligned.
      return {
        structuredContent,
        content: [
          {
            type: "text" as const,
            text: `${result.itinerary.title} 초안을 PlanME 위젯으로 표시했습니다.`,
          },
        ],
        _meta: toWidgetMeta(result.itinerary, structuredContent.pageUrl),
      };
    },
  );

  registerAppTool(
    server,
    "update_planme_itinerary_preview",
    {
      title: "Update PlanME itinerary preview",
      description:
        "Replace the current PlanME preview with a revised itinerary draft after the user changes the plan in conversation.",
      inputSchema: {
        previewId: z.string().min(1).optional(),
        baseVersion: z.number().int().min(1).optional(),
        title: z
          .string()
          .min(1)
          .describe("Compact itinerary title. Do not list every stop in the title."),
        region: z.string().optional(),
        duration: z.string().optional(),
        summary: z.string().optional(),
        origin: z.string().optional().describe("Optional departure city or station. Do not invent an airport origin."),
        assumptions: z.array(z.string()).optional(),
        savedMinutes: z.number().int().min(0).optional(),
        days: z.array(draftDaySchema).min(1),
      },
      outputSchema: draftPreviewSummarySchema,
      _meta: {
        ui: {
          resourceUri: PLANME_WIDGET_URI,
        },
        "openai/outputTemplate": PLANME_WIDGET_URI,
        "openai/toolInvocation/invoking": "PlanME 일정 초안을 갱신하는 중입니다.",
        "openai/toolInvocation/invoked": "PlanME 일정 초안이 갱신됐습니다.",
      },
    },
    async (input: PlanmeDraftPreviewRequest) => {
      const result = updatePlanmeDraftPreview(input);
      await persistItineraryForDetailPage(result.itinerary);
      const structuredContent = toDraftPreviewSummary(result);

      // A revised draft should re-render the same widget with the latest normalized itinerary.
      return {
        structuredContent,
        content: [
          {
            type: "text" as const,
            text: `${result.itinerary.title} 초안을 PlanME 위젯에 다시 반영했습니다.`,
          },
        ],
        _meta: toWidgetMeta(result.itinerary, structuredContent.pageUrl),
      };
    },
  );

  registerAppTool(
    server,
    "commit_planme_itinerary",
    {
      title: "Commit PlanME itinerary",
      description:
        "Commit a previously rendered PlanME preview after the user explicitly confirms the draft. This is a state-changing action and requires userConfirmed=true.",
      inputSchema: {
        previewId: z.string().min(1),
        version: z.number().int().min(1),
        userConfirmed: z.boolean(),
        idempotencyKey: z.string().min(1),
        visibility: z.enum(["private", "public"]),
      },
      outputSchema: draftPreviewSummarySchema,
      _meta: {
        ui: {
          resourceUri: PLANME_WIDGET_URI,
        },
        "openai/outputTemplate": PLANME_WIDGET_URI,
        "openai/toolInvocation/invoking": "PlanME 일정을 확정 저장하는 중입니다.",
        "openai/toolInvocation/invoked": "PlanME 일정이 확정됐습니다.",
      },
    },
    async (input: PlanmeDraftCommitRequest) => {
      const result = commitPlanmeDraftPreview(input);

      if (!result) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "PlanME 일정 확정에 실패했습니다. previewId, version, userConfirmed 값을 다시 확인하세요.",
            },
          ],
        };
      }

      await persistItineraryForDetailPage(result.itinerary);
      const structuredContent = toDraftPreviewSummary(result);

      // Returning the same widget keeps the committed state visually aligned with the preview.
      return {
        structuredContent,
        content: [
          {
            type: "text" as const,
            text: `${result.itinerary.title} 일정이 PlanME에 확정됐습니다.`,
          },
        ],
        _meta: toWidgetMeta(result.itinerary, structuredContent.pageUrl),
      };
    },
  );

  registerAppTool(
    server,
    "recommend_planme_itinerary",
    {
      title: "Recommend or render PlanME itinerary",
      description:
        "Render a PlanME widget. When ChatGPT has already drafted concrete stops or timeline events in conversation, include days with real POI names so the widget matches the draft. If days is omitted, PlanME asks OpenAI to draft the itinerary server-side.",
      inputSchema: {
        title: z
          .string()
          .optional()
          .describe("Compact itinerary title. Do not list every stop in the title."),
        region: z.string().optional(),
        duration: z.string().optional(),
        summary: z.string().optional(),
        assumptions: z.array(z.string()).optional(),
        savedMinutes: z.number().int().min(0).optional(),
        days: z.array(draftDaySchema).optional(),
        destination: z
          .string()
          .optional()
          .describe("Region or city only, such as 남해 or 여수. Put concrete POI routes in days.stops instead."),
        durationDays: z.number().int().min(1).max(14).optional(),
        arrivalAirport: z.string().optional(),
        arrivalTime: z.string().optional(),
        hotelName: z.string().optional(),
        origin: z.string().optional(),
        travelerCount: z.number().int().min(1).max(20).optional(),
        luggageCount: z.number().int().min(0).max(20).optional(),
        preferences: z
          .array(z.string())
          .optional()
          .describe("User preferences like 아이 동반 or 바다 전망. Do not put a full POI route here."),
        theme: z.enum(["light", "dark"]).optional(),
      },
      outputSchema: recommendationSummarySchema,
      _meta: {
        ui: {
          resourceUri: PLANME_WIDGET_URI,
        },
        "openai/outputTemplate": PLANME_WIDGET_URI,
        "openai/toolInvocation/invoking": "PlanME 일정을 구성하는 중입니다.",
        "openai/toolInvocation/invoked": "PlanME 일정이 준비됐습니다.",
      },
    },
    async (input: RecommendItineraryRequest) => {
      let response: GptActionItineraryResponse;

      try {
        response = await createAiRecommendedItineraryResponse(
          "https://planme-demo.vercel.app/mcp",
          input,
        );
      } catch (error) {
        if (error instanceof PlanmeAiConfigurationError) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "PlanME AI 일정 생성을 사용하려면 서버 환경변수 OPENAI_API_KEY가 필요합니다.",
              },
            ],
          };
        }

        const safeMessage =
          error instanceof Error ? formatPlanmeAiGenerationError(error) : "unknown error";

        // The API key is never logged; this message is needed to debug provider/schema failures.
        console.error("PlanME AI itinerary generation failed", safeMessage);

        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `PlanME AI 일정 생성에 실패했습니다: ${safeMessage}`,
            },
          ],
        };
      }

      await persistItineraryForDetailPage(response.itinerary);
      const structuredContent = toItinerarySummary(response);

      // Return a concise text fallback for clients that do not render the widget.
      return {
        structuredContent,
        content: [
          {
            type: "text" as const,
            text: `${response.title}: CarryME 이용 시 ${response.summary}. 상세 일정은 ${response.pageUrl}에서 확인할 수 있습니다.`,
          },
        ],
        _meta: toWidgetMeta(response.itinerary, response.pageUrl),
      };
    },
  );

  registerAppTool(
    server,
    "get_planme_itinerary",
    {
      title: "Get PlanME itinerary",
      description: "Get a PlanME itinerary by id and render the timeline widget.",
      inputSchema: {
        itineraryId: z.string().min(1),
      },
      outputSchema: itinerarySummarySchema,
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
      const response = getGptActionItineraryResponse(itineraryId, "https://planme-demo.vercel.app/mcp");

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
