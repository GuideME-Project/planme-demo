import { NextResponse } from "next/server";
import {
  createAiRecommendedItineraryResponse,
  formatPlanmeAiGenerationError,
  getDemoItinerary,
  PlanmeAiConfigurationError,
} from "@planme/core";

type PlanRequestBody = {
  arrivalAirport?: string;
  arrivalTime?: string;
  destination?: string;
  days?: number;
  hotelName?: string;
  luggageCount?: number;
  nights?: number;
  origin?: string;
  preferences?: string[];
  travelerCount?: number;
};

/**
 * Returns the demo PlanME itinerary response used by Custom GPT Actions.
 */
export async function GET() {
  const itinerary = getDemoItinerary();

  return NextResponse.json({
    message:
      "GuideME 스타일의 여정으로 안내할께요. CarryME를 사용하면 호텔에 들르지 않고 바로 관광할 수 있어요.",
    itinerary,
    cta: {
      label: "플랜미로 상세 일정 보기",
      url: itinerary.detailUrl,
    },
  });
}

/**
 * Accepts a lightweight planning request and returns an AI-authored handoff payload.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as PlanRequestBody;

  try {
    const response = await createAiRecommendedItineraryResponse(request.url, {
      arrivalAirport: body.arrivalAirport,
      arrivalTime: body.arrivalTime,
      destination: body.destination,
      durationDays: body.days ?? (typeof body.nights === "number" ? body.nights + 1 : undefined),
      hotelName: body.hotelName,
      luggageCount: body.luggageCount,
      origin: body.origin,
      preferences: body.preferences,
      travelerCount: body.travelerCount,
    });

    return NextResponse.json({
      message:
        "GuideME 스타일의 여정으로 안내할께요. 요청하신 조건에 맞춰 PlanME 상세 일정 링크를 준비했어요.",
      input: response.input,
      itinerary: response.itinerary,
      cta: {
        label: "플랜미로 상세 일정 보기",
        url: response.pageUrl,
      },
    });
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
