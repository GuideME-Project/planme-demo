import { NextResponse } from "next/server";
import { createRecommendedItineraryResponse, getDemoItinerary } from "@planme/core";

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
 * Accepts a lightweight planning request and returns the same demo handoff payload.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as PlanRequestBody;
  const response = createRecommendedItineraryResponse(request.url, {
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
}
