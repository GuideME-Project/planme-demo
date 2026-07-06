import { NextResponse } from "next/server";

/**
 * Returns the OpenAPI schema used to configure PlanME Custom GPT Actions.
 */
export function GET(request: Request) {
  const serverUrl = new URL(request.url).origin;

  // The schema intentionally exposes only high-level orchestration endpoints to the GPT.
  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "PlanME GPT Actions API",
      version: "0.1.0",
      description: "Technical validation API for PlanME itinerary handoff from Custom GPT.",
    },
    servers: [
      {
        url: serverUrl,
      },
    ],
    paths: {
      "/api/gpt/itineraries/recommend": {
        post: {
          operationId: "recommendPlanmeItinerary",
          summary: "Render an AI-authored PlanME itinerary widget or handoff URL",
          description:
            "When ChatGPT has drafted concrete stops or timeline events in conversation, include days with real POI names so the PlanME widget matches the draft. If days is omitted, PlanME asks OpenAI to draft the itinerary server-side. CarryME luggage handoff points must be lodging, hotels, or explicit pickup points, not plain train/subway stations, terminals, or airports.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    title: {
                      type: "string",
                      description:
                        "Compact ChatGPT-authored itinerary title shown in the widget. Do not list every stop here.",
                    },
                    region: {
                      type: "string",
                      description: "Primary travel region used for PlanME labels",
                    },
                    duration: {
                      type: "string",
                      description: "User-facing trip length label, for example 1박 2일",
                    },
                    summary: {
                      type: "string",
                      description: "Short explanation of the ChatGPT-authored itinerary draft",
                    },
                    assumptions: {
                      type: "array",
                      items: { type: "string" },
                      description: "Planning assumptions used to draft the itinerary",
                    },
                    savedMinutes: {
                      type: "integer",
                      minimum: 0,
                      description: "Estimated minutes saved by using CarryME",
                    },
                    days: {
                      type: "array",
                      items: { $ref: "#/components/schemas/PlanmeDraftDay" },
                      description:
                        "Concrete ChatGPT-authored itinerary days. Include this whenever the conversation contains real stops or POIs. Do not create station luggage storage or pickup events unless the user explicitly named a CarryME pickup point.",
                    },
                    destination: {
                      type: "string",
                      description:
                        "Travel region or city only, such as Namhae or Yeosu. Put concrete POI routes in days.stops instead.",
                    },
                    durationDays: { type: "integer", minimum: 1, maximum: 14 },
                    arrivalAirport: { type: "string", description: "Arrival airport code" },
                    arrivalTime: { type: "string", description: "Arrival time in HH:mm format" },
                    hotelName: { type: "string", description: "Optional hotel name" },
                    origin: {
                      type: "string",
                      description:
                        "Optional departure city or station, for example Seoul or Seoul Station",
                    },
                    travelerCount: { type: "integer", minimum: 1, maximum: 20 },
                    luggageCount: { type: "integer", minimum: 0, maximum: 20 },
                    preferences: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "User travel preferences such as family trip or sea view. Do not put a full POI route here.",
                    },
                    theme: { type: "string", enum: ["light", "dark"] },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Recommended itinerary response",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ItineraryActionResponse" },
                },
              },
            },
          },
        },
      },
      "/api/gpt/itineraries/{itineraryId}": {
        get: {
          operationId: "getPlanmeItinerary",
          summary: "Get a PlanME itinerary by id",
          parameters: [
            {
              name: "itineraryId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Itinerary response",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ItineraryActionResponse" },
                },
              },
            },
            "404": { description: "Itinerary not found" },
          },
        },
      },
      "/api/gpt/itineraries/{itineraryId}/share": {
        post: {
          operationId: "createPlanmeItineraryShareLink",
          summary: "Create a shareable PlanME itinerary URL",
          parameters: [
            {
              name: "itineraryId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Share link response",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["itineraryId", "pageUrl", "expiresAt"],
                    properties: {
                      itineraryId: { type: "string" },
                      pageUrl: { type: "string", format: "uri" },
                      ogImageUrl: {
                        type: "string",
                        format: "uri",
                        description:
                          "Optional dynamic PNG preview image URL for clients that support image previews. The primary handoff target is pageUrl.",
                      },
                      previewMarkdown: {
                        type: "string",
                        description:
                          "Optional Markdown image syntax using the .png ogImageUrl. Do not use this as the primary response unless the user explicitly asks for an image preview.",
                      },
                      expiresAt: { type: ["string", "null"], format: "date-time" },
                    },
                  },
                },
              },
            },
            "404": { description: "Itinerary not found" },
          },
        },
      },
    },
    components: {
      schemas: {
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
            ogImageUrl: {
              type: "string",
              format: "uri",
              description:
                "Optional dynamic PNG preview image URL for clients that support image previews. The primary handoff target is pageUrl.",
            },
            previewMarkdown: {
              type: "string",
              description:
                "Optional Markdown image syntax using the .png ogImageUrl. Do not use this as the primary response unless the user explicitly asks for an image preview.",
            },
            highlights: {
              type: "array",
              items: { type: "string" },
            },
            itinerary: { type: "object", additionalProperties: true },
            previewId: {
              type: "string",
              description: "Present when the response was rendered from ChatGPT-authored days",
            },
            status: {
              type: "string",
              enum: ["preview_ready", "needs_revision", "committed"],
              description: "Draft preview status when days were supplied",
            },
            validationIssues: {
              type: "array",
              items: { $ref: "#/components/schemas/PlanmeDraftValidationIssue" },
            },
            version: {
              type: "integer",
              minimum: 1,
              description: "Draft preview version when days were supplied",
            },
          },
        },
        PlanmeDraftDay: {
          type: "object",
          required: ["stops", "timeline"],
          properties: {
            day: { type: "integer", minimum: 1, maximum: 14 },
            label: { type: "string" },
            stops: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/components/schemas/PlanmeDraftStop" },
            },
            timeline: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/components/schemas/PlanmeDraftTimelineEvent" },
            },
            standardDurationMinutes: { type: "integer", minimum: 0 },
            carrymeDurationMinutes: { type: "integer", minimum: 0 },
            standardRouteText: { type: "string" },
            carrymeRouteText: { type: "string" },
          },
        },
        PlanmeDraftStop: {
          type: "object",
          required: ["name"],
          properties: {
            name: {
              type: "string",
              description: "Single stop or POI name only. Do not put a full route list in one stop.",
            },
            role: {
              type: "string",
              enum: ["origin", "visit", "luggageDestination", "finalDestination"],
              description:
                "Use luggageDestination only for lodging, hotel, or an explicitly named CarryME pickup point. Do not use a plain train/subway station, terminal, or airport as a luggage handoff point.",
            },
            caption: { type: "string" },
            coordinate: { $ref: "#/components/schemas/MapCoordinate" },
          },
        },
        PlanmeDraftTimelineEvent: {
          type: "object",
          required: ["time", "title", "description"],
          properties: {
            time: { type: "string" },
            title: {
              type: "string",
              description:
                "Short single-event title, such as 독일마을 산책. Do not repeat the full route.",
            },
            description: {
              type: "string",
              description:
                "Short event description. Do not say luggage is stored, retrieved, or picked up at a plain train/subway station, terminal, or airport.",
            },
            category: {
              type: "string",
              enum: ["arrival", "carryme", "transit", "meal", "hotel", "event"],
            },
            highlight: { type: "boolean" },
            savingLabel: { type: "string" },
          },
        },
        MapCoordinate: {
          type: "object",
          required: ["lat", "lng"],
          properties: {
            lat: { type: "number" },
            lng: { type: "number" },
          },
        },
        PlanmeDraftValidationIssue: {
          type: "object",
          required: ["code", "message", "severity"],
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            severity: { type: "string", enum: ["error", "warning"] },
          },
        },
      },
    },
  });
}
