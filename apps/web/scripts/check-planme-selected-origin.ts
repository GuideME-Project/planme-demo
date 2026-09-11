import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { autocompletePlanmePlaces, resolveSelectedPlanmePlace } from "../lib/planme-places";
import { createMemoryPlanmeV3JobStore } from "../lib/planme-v3/job-store";
import { createMemoryPlanmeV3TourCache } from "../lib/planme-v3/tour-cache";
import { createPlanmeV3Orchestrator, type PlanmeV3OrchestratorDependencies } from "../lib/planme-v3/orchestrator";
import { createTourApiClient } from "../lib/planme-v3/tour-api-client";
import { geocodePlanmeAnchor } from "../lib/planme-v3/geocoding";
import { planTourCandidatesWithLuna } from "../lib/planme-v3/luna-planner";
import { routePlanmeSegment } from "../lib/planme-v3/route-service";

// Real providers with process-local storage; no shared Redis writes or provider doubles.
// node --env-file=apps/web/.env.local --import tsx apps/web/scripts/check-planme-selected-origin.ts --confirm-external-api
async function main() {
  assert.ok(process.argv.includes("--confirm-external-api"), "실제 API 검증 동의가 필요합니다.");
  const token = randomUUID();
  const { suggestions } = await autocompletePlanmePlaces("동탄", token);
  const suggestion = suggestions.find((place) => place.name === "동탄대로");
  assert.ok(suggestion, "실제 동탄대로 후보가 필요합니다.");
  const origin = await resolveSelectedPlanmePlace(suggestion.placeId, token);
  assert.ok(origin);
  const jobStore = createMemoryPlanmeV3JobStore();
  const tourApi = createTourApiClient();
  const dependencies: PlanmeV3OrchestratorDependencies = {
    jobStore,
    tourCache: createMemoryPlanmeV3TourCache(),
    pageOrigin: "http://localhost:3000",
    resolveDestination: tourApi.resolveDestination,
    listCandidates: tourApi.listCandidates,
    geocodeAnchor: (query, signal) => geocodePlanmeAnchor(query, { signal }),
    planCandidates: ({ signal, ...input }) => planTourCandidatesWithLuna(input, { signal }),
    routeSegment: routePlanmeSegment,
  };
  const runtime = createPlanmeV3Orchestrator(dependencies);
  const input = { origin: origin.searchText, destination: "부산", durationDays: 4, transportMode: "drive" as const };
  const requestId = randomUUID();
  const started = await runtime.startItinerary(input, requestId, { selectedOriginCoordinate: origin.coordinate });
  assert.equal(started.status, "processing");
  if (started.status !== "processing") throw new Error("일정 시작 실패");
  const retried = await runtime.startItinerary(input, requestId, { selectedOriginCoordinate: origin.coordinate });
  assert.deepEqual(retried, started);
  const invalid = await runtime.startItinerary(input, randomUUID(), { selectedOriginCoordinate: { lat: Infinity, lng: 0 } });
  assert.equal(invalid.status, "invalid");

  // A fresh orchestrator must load the selected coordinate from its persisted checkpoint.
  const resumed = createPlanmeV3Orchestrator(dependencies);
  await resumed.advanceItinerary(started.itineraryId);
  const anchors = await jobStore.getCheckpoint(started.itineraryId, 1, "resolving_anchors");
  assert.ok(anchors?.payload && typeof anchors.payload === "object" && !Array.isArray(anchors.payload));
  assert.deepEqual(anchors.payload.originCoordinate, origin.coordinate);
  console.log("동탄대로 선택 좌표: 작업 재개 후 출발지 확정 단계 통과");
  const terminal = await resumed.runUntilTerminal(started.itineraryId, Date.now() + 45_000);
  assert.equal(terminal?.status, "ready", JSON.stringify(terminal));
  const revision = await jobStore.getRevision(started.itineraryId, 1);
  assert.ok(revision);
  const edited = await resumed.startItineraryEdit(started.itineraryId, {
    baseRevision: 1,
    days: revision.plan.days.map((day) => ({ day: day.day, orderedVisitContentIds: day.visits.map((visit) => visit.contentId) })),
  });
  assert.equal(edited.status, "processing");
  await resumed.advanceItinerary(started.itineraryId);
  const editedAnchors = await jobStore.getCheckpoint(started.itineraryId, 2, "resolving_anchors");
  assert.ok(editedAnchors?.payload && typeof editedAnchors.payload === "object" && !Array.isArray(editedAnchors.payload));
  assert.deepEqual(editedAnchors.payload.originCoordinate, origin.coordinate);
  console.log("동탄대로→부산 3박 4일 실제 일정 완성 및 편집 시 출발지 좌표 유지 통과");
}

void main();
