export type PlanmeUsageCounterEvent =
  | "openai_request"
  | "function_place_search_call"
  | "google_places_request"
  | "naver_geocode_request"
  | "odsay_request"
  | "itinerary_ready"
  | "needs_clarification"
  | "final_ai_decision"
  | "hard_gate_failed";

export type PlanmeUsageRecorder = (
  event: PlanmeUsageCounterEvent,
  amount?: number,
) => Promise<void> | void;

/**
 * Records usage without letting observability failures block itinerary generation.
 */
export async function recordPlanmeUsageSafely(
  recorder: PlanmeUsageRecorder | undefined,
  event: PlanmeUsageCounterEvent,
  amount = 1,
): Promise<void> {
  if (!recorder) {
    return;
  }

  try {
    await recorder(event, amount);
  } catch {
    // Usage counters are diagnostic only; generation should fail on provider/data errors instead.
  }
}
