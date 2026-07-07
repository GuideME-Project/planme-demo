import { NextResponse } from "next/server";

/**
 * Returns the legacy OpenAPI document without web-side generation operations.
 */
export function GET() {
  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "PlanME Demo Actions API",
      version: "0.1.0",
      description:
        "PlanME 일정 생성은 MCP 도구(recommend_planme_itinerary)에서만 지원합니다.",
    },
    servers: [
      {
        url: "https://planme-demo.vercel.app",
      },
    ],
    paths: {},
  });
}
