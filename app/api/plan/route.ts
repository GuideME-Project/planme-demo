import { NextResponse } from "next/server";
import { getDemoItinerary } from "@/lib/mock-data";

type PlanRequestBody = {
  destination?: string;
  nights?: number;
  days?: number;
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
  const itinerary = getDemoItinerary();

  // 데모 단계에서는 입력값을 기록 가능한 형태로만 반영하고 일정 생성은 mock 데이터로 고정합니다.
  return NextResponse.json({
    message:
      "GuideME 스타일의 여정으로 안내할께요. 요청하신 조건에 맞춰 PlanME 상세 일정 링크를 준비했어요.",
    input: {
      destination: body.destination ?? itinerary.region,
      nights: body.nights ?? 1,
      days: body.days ?? 2,
    },
    itinerary,
    cta: {
      label: "플랜미로 상세 일정 보기",
      url: itinerary.detailUrl,
    },
  });
}
