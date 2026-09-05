"use server";

import type { ItineraryPhase } from "@/lib/planme-v3/job-store";
import { isPlanmeProgressPreviewEnabled } from "@/lib/planme-progress-preview";
import { getPlanmeV3Runtime } from "@/lib/planme-v3/runtime";

// Keeps deterministic local fixture phases visible long enough for design review.
const PREVIEW_STEP_INTERVAL_MS = 1_500;

export type PlanmeGenerationProgressResult =
  | {
      status: "processing";
      phase: ItineraryPhase;
      retryAfterMs: number;
    }
  | { status: "ready" }
  | { status: "failed"; message: string };

export async function advancePlanmeGenerationAction(
  itineraryId: string,
): Promise<PlanmeGenerationProgressResult> {
  if (!isPlanmeProgressPreviewEnabled()) {
    return { status: "failed", message: "로컬 진행 화면 시안이 비활성화되어 있습니다." };
  }
  if (!/^planme-v3-[0-9a-f-]{36}$/i.test(itineraryId)) {
    return { status: "failed", message: "일정 정보를 확인할 수 없습니다." };
  }

  const result = await getPlanmeV3Runtime().advanceItinerary(itineraryId);
  if (!result) {
    return { status: "failed", message: "일정 정보를 확인할 수 없습니다." };
  }
  if (result.status === "ready") {
    return { status: "ready" };
  }
  if (result.status === "failed") {
    return { status: "failed", message: result.message };
  }
  return {
    status: "processing",
    phase: result.phase,
    retryAfterMs: Math.max(result.retryAfterMs, PREVIEW_STEP_INTERVAL_MS),
  };
}
