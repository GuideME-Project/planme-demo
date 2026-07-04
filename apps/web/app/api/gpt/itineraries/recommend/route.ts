import { NextResponse } from "next/server";
import {
  createAiRecommendedItineraryResponse,
  PlanmeAiConfigurationError,
  type RecommendItineraryRequest,
} from "@planme/core";

/**
 * Creates an AI-authored PlanME itinerary for Custom GPT Actions.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as RecommendItineraryRequest;

  try {
    return NextResponse.json(await createAiRecommendedItineraryResponse(request.url, body));
  } catch (error) {
    if (error instanceof PlanmeAiConfigurationError) {
      return NextResponse.json(
        {
          error: "PlanME AI 일정 생성을 사용하려면 서버 환경변수 OPENAI_API_KEY가 필요합니다.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json({ error: "PlanME AI 일정 생성에 실패했습니다." }, { status: 502 });
  }
}
