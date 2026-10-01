import { NextResponse } from "next/server";
import { getPlanmeWebOrigin } from "@/lib/planme-web-origin";

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
        "PlanME 웹은 일정 생성 API를 제공하지 않습니다.",
    },
    servers: [
      {
        url: getPlanmeWebOrigin(),
      },
    ],
    paths: {},
  });
}
