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
          summary: "Recommend a PlanME itinerary and return a handoff URL",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    destination: { type: "string", description: "Travel destination" },
                    durationDays: { type: "integer", minimum: 1, maximum: 14 },
                    arrivalAirport: { type: "string", description: "Arrival airport code" },
                    arrivalTime: { type: "string", description: "Arrival time in HH:mm format" },
                    hotelName: { type: "string", description: "Optional hotel name" },
                    travelerCount: { type: "integer", minimum: 1, maximum: 20 },
                    luggageCount: { type: "integer", minimum: 0, maximum: 20 },
                    preferences: {
                      type: "array",
                      items: { type: "string" },
                      description: "User travel preferences",
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
            highlights: {
              type: "array",
              items: { type: "string" },
            },
            itinerary: { type: "object", additionalProperties: true },
          },
        },
      },
    },
  });
}
