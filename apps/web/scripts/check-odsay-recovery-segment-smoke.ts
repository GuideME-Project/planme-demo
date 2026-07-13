import assert from "node:assert/strict";
import { computeOdsayTransitRoute } from "../lib/route-providers/odsay";
import {
  MemoryRouteSegmentCache,
  RouteProviderRuntimeError,
  type RouteProviderCallBudget,
  type RouteProviderOperation,
  type TransitRecoveryRuntime,
} from "../lib/route-segment-cache";
import {
  TransitAccessDecisionError,
  type RouteProviderStop,
} from "../lib/route-providers/types";

/** Counts every real ODsay request while enforcing the caller-provided smoke ceiling. */
class CountingRouteProviderBudget implements RouteProviderCallBudget {
  readonly callsByOperation: Record<RouteProviderOperation, number> = {
    point_search: 0,
    retry: 0,
    transit: 0,
    walk: 0,
  };
  total = 0;

  constructor(private readonly maximum: number) {}

  async consume(operation: RouteProviderOperation) {
    this.total += 1;
    this.callsByOperation[operation] += 1;

    if (this.total > this.maximum) {
      throw new RouteProviderRuntimeError("PROVIDER_CALL_BUDGET_EXCEEDED");
    }
  }
}

async function main() {
  const confirmed =
    process.argv.includes("--confirm-external-api") ||
    process.env.PLANME_CONFIRM_EXTERNAL_API_SMOKE === "1";

  assert.ok(
    confirmed,
    "실제 ODsay segment smoke에는 --confirm-external-api 또는 PLANME_CONFIRM_EXTERNAL_API_SMOKE=1이 필요합니다.",
  );
  assert.ok(process.env.NEXT_PUBLIC_ODSAY_API_KEY?.trim(), "NEXT_PUBLIC_ODSAY_API_KEY is required.");

  const maximum = Number(process.env.PLANME_TRANSIT_SMOKE_MAX_REQUESTS);
  assert.ok(
    Number.isInteger(maximum) && maximum > 0,
    "PLANME_TRANSIT_SMOKE_MAX_REQUESTS must be an explicit positive integer.",
  );

  const budget = new CountingRouteProviderBudget(maximum);
  const traceId = "00000000-0000-4000-8000-000000000301";
  const runtime: TransitRecoveryRuntime = {
    budget,
    cache: new MemoryRouteSegmentCache(),
    mode: "smoke",
    policy: {
      aiWalkLimitMinutes: 30,
      fixedWalkLimitMinutes: 90,
      maxStationCandidates: 2,
      policyVersion: "smoke-20260713-v1",
      searchRadiiMeters: [500, 1_000],
    },
    traceId,
  };
  const stops: RouteProviderStop[] = [
    {
      coordinate: { lat: 34.7034963, lng: 128.025256 },
      id: "smoke-lodging",
      label: "쏠비치 남해",
      placeConstraint: "replaceable",
      role: "숙소",
      stopRef: "day-2-stop-1",
    },
    {
      coordinate: { lat: 34.7519684, lng: 127.9828872 },
      id: "smoke-destination",
      label: "보리암",
      placeConstraint: "replaceable",
      role: "방문지",
      stopRef: "day-2-stop-2",
    },
  ];
  const startedAt = Date.now();

  try {
    await computeOdsayTransitRoute(stops, new AbortController().signal, {
      recoveryRuntime: runtime,
    });
    throw new Error("대표 접근 불가 구간이 예기치 않게 바로 경로 계산에 성공했습니다.");
  } catch (error) {
    const result = {
      callsByOperation: budget.callsByOperation,
      elapsedMs: Date.now() - startedAt,
      reason: error instanceof TransitAccessDecisionError ? error.reason : undefined,
      status: error instanceof TransitAccessDecisionError ? error.status : undefined,
      totalRequests: budget.total,
    };

    console.log(JSON.stringify(result));
    assert.ok(error instanceof TransitAccessDecisionError);
    assert.equal(error.status, "replacement_required");
    assert.ok(budget.total <= maximum);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "ODsay segment smoke failed");
  process.exitCode = 1;
});
