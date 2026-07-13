import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import type { PlanmeItinerary, RoutePlan } from "@planme/core";

async function main() {
  const confirmed =
    process.argv.includes("--confirm-external-api") ||
    process.env.PLANME_CONFIRM_EXTERNAL_API_SMOKE === "1";

  if (!confirmed) {
    console.error(
      "실제 ODsay 복구 smoke는 실행하지 않았습니다. PLANME_CONFIRM_EXTERNAL_API_SMOKE=1이 필요합니다.",
    );
    process.exitCode = 1;
    return;
  }

  const webOrigin = process.env.PLANME_WEB_ORIGIN?.trim();
  const internalToken = process.env.PLANME_INTERNAL_API_TOKEN?.trim();
  const executionLimit = Number(process.env.PLANME_TRANSIT_SMOKE_MAX_REQUESTS);

  assert.ok(webOrigin, "PLANME_WEB_ORIGIN is required.");
  assert.ok(internalToken, "PLANME_INTERNAL_API_TOKEN is required.");
  assert.ok(
    Number.isInteger(executionLimit) && executionLimit > 0,
    "PLANME_TRANSIT_SMOKE_MAX_REQUESTS must be an explicit positive integer.",
  );

  console.log(`ODsay 복구 smoke 실행 상한: ${executionLimit} requests`);
  const startedAt = Date.now();
  const response = await fetch(
    new URL("/api/gpt/itineraries/transit-preflight", webOrigin),
    {
      body: JSON.stringify({ itinerary: createSmokeItinerary(), timeoutMs: 40_000 }),
      headers: {
        Authorization: `Bearer ${internalToken}`,
        "Content-Type": "application/json",
        "X-PlanME-Trace-Id": randomUUID(),
        "X-PlanME-Transit-Recovery-Smoke": "1",
      },
      method: "POST",
    },
  );
  const body = await response.json() as {
    error?: string;
    estimatedSegmentCount?: number;
    status?: string;
  };

  console.log(
    JSON.stringify({
      elapsedMs: Date.now() - startedAt,
      error: body.error,
      estimatedSegmentCount: body.estimatedSegmentCount,
      status: body.status,
    }),
  );
  assert.equal(response.ok, true);
}

function createSmokeItinerary(): PlanmeItinerary {
  const stops = [
    {
      caption: "출발",
      coordinate: { lat: 34.7992073, lng: 128.0401618 },
      icon: "station" as const,
      label: "남해독일마을",
      mode: "transit" as const,
      placeConstraint: "fixed" as const,
      role: "출발지" as const,
      stopRef: "day-1-stop-1",
    },
    {
      caption: "방문",
      coordinate: { lat: 34.6687, lng: 127.9795 },
      icon: "event" as const,
      label: "보리암",
      mode: "transit" as const,
      placeConstraint: "fixed" as const,
      role: "방문지" as const,
      stopRef: "day-1-stop-2",
    },
  ];
  const createRoute = (id: RoutePlan["id"]): RoutePlan => ({
    badge: id === "standard" ? "Standard" : "CarryME",
    description: "ODsay 복구 smoke",
    durationLabel: "확인 전",
    durationMinutes: 0,
    id,
    label: id === "standard" ? "Standard" : "CarryME",
    mapPath: [],
    routeText: stops.map((stop) => stop.label).join(" → "),
    stops,
  });
  const timeline = stops.map((stop, index) => ({
    category: index === 0 ? "arrival" as const : "event" as const,
    description: stop.label,
    stayDurationMinutes: index === 0 ? 0 : 60,
    stopRef: stop.stopRef,
    time: index === 0 ? "09:00" : "10:00",
    title: stop.label,
  }));

  return {
    benefits: [],
    days: [
      {
        carryme: createRoute("carryme"),
        carrymeTimeline: timeline,
        day: 1,
        label: "Day 1",
        standard: createRoute("standard"),
        standardTimeline: timeline,
        timeline,
      },
    ],
    detailUrl: "/itinerary/transit-recovery-smoke",
    duration: "당일",
    id: "transit-recovery-smoke",
    region: "남해",
    summary: "제한된 실제 ODsay 복구 검증",
    title: "남해 ODsay 복구 smoke",
    totalDurationLabel: "확인 전",
    transportMode: "transit",
  };
}

await main();
