import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import {
  createRecommendedItineraryResponse,
  getGptActionItineraryResponse,
  type GptActionItineraryResponse,
  type PlanmeItinerary,
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
    "recommend_planme_itinerary",
    {
      title: "Recommend PlanME itinerary",
      description: "Recommend the current PlanME Osaka demo itinerary and render a timeline widget.",
      inputSchema: {
        destination: z.string().optional(),
        durationDays: z.number().int().min(1).max(14).optional(),
        arrivalAirport: z.string().optional(),
        arrivalTime: z.string().optional(),
        hotelName: z.string().optional(),
        travelerCount: z.number().int().min(1).max(20).optional(),
        luggageCount: z.number().int().min(0).max(20).optional(),
        preferences: z.array(z.string()).optional(),
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
      const response = createRecommendedItineraryResponse("https://planme-demo.vercel.app/mcp", input);
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
