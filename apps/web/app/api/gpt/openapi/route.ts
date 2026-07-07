import { NextResponse } from "next/server";

/**
 * Returns the read-only OpenAPI schema for PlanME detail lookup and sharing.
 */
export function GET(request: Request) {
  const serverUrl = new URL(request.url).origin;

  // Itinerary generation is intentionally absent; MCP owns OpenAI-backed generation.
  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "PlanME GPT Actions API",
      version: "0.1.0",
      description:
        "Read-only PlanME detail handoff API. Generate itineraries with the MCP tool recommend_planme_itinerary.",
    },
    servers: [{ url: serverUrl }],
    paths: {
      "/api/gpt/itineraries/{itineraryId}": {
        get: {
          operationId: "getPlanmeItinerary",
          summary: "Get a saved PlanME itinerary by id",
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
                  schema: { $ref: "#/components/schemas/ItineraryShareResponse" },
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
              description: "Optional .png preview image URL for clients that support previews.",
            },
            previewMarkdown: { type: "string" },
            highlights: {
              type: "array",
              items: { type: "string" },
            },
            itinerary: { type: "object", additionalProperties: true },
          },
        },
        ItineraryShareResponse: {
          type: "object",
          required: ["itineraryId", "pageUrl", "expiresAt"],
          properties: {
            itineraryId: { type: "string" },
            pageUrl: { type: "string", format: "uri" },
            ogImageUrl: {
              type: "string",
              format: "uri",
              description: "Optional .png preview image URL for clients that support previews.",
            },
            previewMarkdown: { type: "string" },
            expiresAt: { type: ["string", "null"], format: "date-time" },
          },
        },
      },
    },
  });
}
