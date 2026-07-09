import { NextResponse } from "next/server";
import type { PlanmeUsageCounterEvent } from "@planme/core";
import { recordWebPlanmeUsage } from "../../../../lib/usage-counter-store";

const usageEvents: PlanmeUsageCounterEvent[] = [
  "openai_request",
  "function_place_search_call",
  "google_places_request",
  "naver_geocode_request",
  "odsay_request",
  "itinerary_ready",
  "needs_clarification",
  "final_ai_decision",
  "hard_gate_failed",
];

/**
 * Records a PlanME usage event from browser-only provider flows.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    amount?: number;
    event?: PlanmeUsageCounterEvent;
  } | null;
  const event = body?.event;

  if (!event || !usageEvents.includes(event)) {
    return NextResponse.json({ error: "Unsupported PlanME usage event." }, { status: 400 });
  }

  await recordWebPlanmeUsage(event, normalizeUsageAmount(body.amount));

  return NextResponse.json({ ok: true });
}

/**
 * Keeps browser-supplied counter amounts small and positive.
 */
function normalizeUsageAmount(amount: number | undefined) {
  if (!Number.isInteger(amount) || !amount || amount < 1) {
    return 1;
  }

  return Math.min(amount, 100);
}
