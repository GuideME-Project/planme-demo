import { NextResponse } from "next/server";
import { getDemoItinerary } from "@planme/core";

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
