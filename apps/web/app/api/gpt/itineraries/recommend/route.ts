import { NextResponse } from "next/server";
import {
  createAiRecommendedItineraryResponse,
  formatPlanmeAiGenerationError,
  PlanmeAiConfigurationError,
  type RecommendItineraryRequest,
} from "@planme/core";
import { createWebNaverGeocoder, hasWebNaverGeocoderRuntimeConfig } from "../../naver-geocoding";

/**
 * Creates an AI-authored PlanME itinerary for Custom GPT Actions.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as RecommendItineraryRequest;

  try {
    return NextResponse.json(
      await createAiRecommendedItineraryResponse(
        request.url,
        body,
        hasWebNaverGeocoderRuntimeConfig()
          ? { apiDraftCoordinateResolver: createWebNaverGeocoder() }
          : {},
      ),
    );
  } catch (error) {
    if (error instanceof PlanmeAiConfigurationError) {
      return NextResponse.json(
        {
          error: "PlanME AI 일정 생성을 사용하려면 서버 환경변수 OPENAI_API_KEY가 필요합니다.",
        },
        { status: 503 },
      );
    }

    const safeMessage =
      error instanceof Error ? formatPlanmeAiGenerationError(error) : "unknown error";

    // The API key is never logged; this message is needed to debug provider/schema failures.
    console.error("PlanME AI itinerary generation failed", safeMessage);

    return NextResponse.json(
      { error: `PlanME AI 일정 생성에 실패했습니다: ${safeMessage}` },
      { status: 502 },
    );
  }
}
