import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import {
  assessPlanmePlanningInput,
  createAiRecommendedItineraryResponse,
  formatPlanmeAiGenerationError,
  getGptActionItineraryResponse,
  PlanmeAiConfigurationError,
  toGptActionItineraryResponse,
  type GptActionItineraryResponse,
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
  description: z
    .string()
    .describe(
      "Short event description. Do not say luggage is stored, retrieved, or picked up at a plain train/subway station, terminal, or airport.",
    ),
  category: z.string(),
  highlight: z.boolean().optional(),
  savingLabel: z.string().optional(),
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
  nextAction: z.enum(["ask_user", "recommend_planme_itinerary"]),
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
};

/**
 * Converts PlanME core itinerary data into the model-visible MCP output shape.
 */
function toItinerarySummary(response: GptActionItineraryResponse): ItinerarySummary {
  const firstDay = response.itinerary.days[0];

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
export async function persistItineraryForDetailPage(itinerary: PlanmeItinerary): Promise<void> {
  if (process.env.VERCEL !== "1" && !process.env.PLANME_WEB_ORIGIN?.trim()) {
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(`${getPlanmeWebOrigin()}/api/gpt/itineraries/preview-store`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ itinerary }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Do not log the itinerary payload; status is enough to diagnose handoff failures.
      throw new Error(`PlanME preview store handoff failed with status ${response.status}`);
    }
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : "unknown error";

    throw new Error(`PlanME preview store handoff error: ${safeMessage}`);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Reads the web origin lazily so tests and Vercel env can override the handoff target.
 */
function getPlanmeWebOrigin() {
  return process.env.PLANME_WEB_ORIGIN?.trim() || PLANME_WEB_ORIGIN;
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
      title: "Recommend PlanME itinerary",
      description:
        "Generate a PlanME itinerary server-side and render the widget. Do not pass ChatGPT-authored days or timeline events; this MCP server calls OpenAI internally and then saves the generated itinerary for the detail page. CarryME luggage handoff points must be lodging, hotels, or explicit pickup points, not plain train/subway stations, terminals, or airports.",
      inputSchema: {
        destination: z
          .string()
          .optional()
          .describe("Region or city only, such as 남해 or 여수."),
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
          .describe("User preferences like 아이 동반 or 바다 전망."),
        theme: z.enum(["light", "dark"]).optional(),
      },
      outputSchema: itinerarySummarySchema,
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
          {
            draftGeocoder: hasNaverGeocoderRuntimeConfig()
              ? createNaverGeocoder()
              : undefined,
            googleMapsReferer: `${PLANME_WEB_ORIGIN}/`,
          },
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

      try {
        await persistItineraryForDetailPage(response.itinerary);
      } catch (error) {
        const safeMessage = error instanceof Error ? error.message : "unknown error";

        // Do not expose a detail URL when the web store could not persist the generated payload.
        console.error("PlanME generated itinerary handoff failed", safeMessage);

        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "PlanME 일정은 생성됐지만 상세 일정 저장에 실패했습니다. 잠시 후 다시 시도하세요.",
            },
          ],
        };
      }

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
