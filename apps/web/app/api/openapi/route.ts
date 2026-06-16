import { NextResponse } from "next/server";

/**
 * Returns a minimal OpenAPI schema that can be pasted into Custom GPT Actions.
 */
export function GET() {
  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "PlanME Demo Actions API",
      version: "0.1.0",
    },
    servers: [
      {
        url: "https://planme-demo.vercel.app",
      },
    ],
    paths: {
      "/api/plan": {
        post: {
          operationId: "createPlanmeItinerary",
          summary: "Create a PlanME itinerary handoff link",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    destination: {
                      type: "string",
                      description: "여행 목적지",
                    },
                    nights: {
                      type: "integer",
                      description: "숙박 수",
                    },
                    days: {
                      type: "integer",
                      description: "여행 일수",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "PlanME handoff response",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      message: {
                        type: "string",
                      },
                      cta: {
                        type: "object",
                        properties: {
                          label: {
                            type: "string",
                          },
                          url: {
                            type: "string",
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}
