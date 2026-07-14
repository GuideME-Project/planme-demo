export type PlanmeUsageCounterEvent =
  | "openai_request"
  | "function_place_search_call"
  | "naver_local_search_request"
  | "naver_geocode_request"
  | "naver_directions_request"
  | "tourapi_request"
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
export function recordPlanmeUsageSafely(
  recorder: PlanmeUsageRecorder | undefined,
  event: PlanmeUsageCounterEvent,
  amount = 1,
): void {
  if (!recorder) {
    return;
  }

  try {
    const pending = recorder(event, amount);

    if (pending) {
      // Diagnostic writes are best-effort and must not consume the itinerary deadline.
      void pending.catch(() => undefined);
    }
  } catch {
    // Usage counters are diagnostic only; generation should fail on provider/data errors instead.
  }
}
