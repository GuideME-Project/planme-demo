import assert from "node:assert/strict";
import type {
  AllowedTourContentTypeId,
  PlanmeUsageCounterEvent,
  RouteSegment,
} from "@planme/core";
import { PLANME_V3_ALLOWED_CONTENT_TYPE_IDS } from "@planme/core";
import { createMemoryPlanmeV3JobStore } from "../lib/planme-v3/job-store";
import { createMemoryPlanmeV3TourCache } from "../lib/planme-v3/tour-cache";
import { createPlanmeV3Orchestrator } from "../lib/planme-v3/orchestrator";

async function main() {
  let now = Date.parse("2026-07-14T00:00:00.000Z");
  let idSequence = 0;
  let routeCalls = 0;
  let emptyVisitCandidates = false;
  let hangRoutes = false;
  let routeConfigurationFailure = false;
  let observedRouteAbort = false;
  let activeCandidateCalls = 0;
  let maxActiveCandidateCalls = 0;
  let firstPlannerCandidateTypes: AllowedTourContentTypeId[] | null = null;
  const geocodeQueries: string[] = [];
  const usageEvents: PlanmeUsageCounterEvent[] = [];
  const jobStore = createMemoryPlanmeV3JobStore({
    now: () => now,
    createId: () => `orchestrated-${++idSequence}`,
  });
  const orchestrator = createPlanmeV3Orchestrator({
    jobStore,
    tourCache: createMemoryPlanmeV3TourCache({ now: () => now }),
    now: () => now,
    pageOrigin: "https://planme.example",
    createLockOwner: () => "test-worker",
    usageRecorder: (event) => {
      usageEvents.push(event);
    },
    resolveRegion: async () => ({
      regionCode: "26",
      regionName: "부산광역시",
      districtCode: "260",
      districtName: "중구",
    }),
    geocodeAnchor: async (query) => {
      geocodeQueries.push(query);
      if (query === "부산역") {
        return { status: "not_found" };
      }
      return {
        status: "ready",
        coordinate:
          query === "서울역"
            ? { lat: 37.5547, lng: 126.9707 }
            : { lat: 35.1796, lng: 129.0756 },
      };
    },
    listCandidates: async ({ contentTypeId }) => {
      activeCandidateCalls += 1;
      maxActiveCandidateCalls = Math.max(
        maxActiveCandidateCalls,
        activeCandidateCalls,
      );
      try {
        const typeIndex = PLANME_V3_ALLOWED_CONTENT_TYPE_IDS.indexOf(contentTypeId);
        await new Promise((resolve) => setTimeout(resolve, 8 - typeIndex));
        return emptyVisitCandidates && contentTypeId === 12
          ? { status: "empty", records: [], totalCount: 0 }
          : candidateResponse(contentTypeId);
      } finally {
        activeCandidateCalls -= 1;
      }
    },
    planCandidates: async ({ candidates, intent }) => {
      firstPlannerCandidateTypes ??= candidates.map(
        (candidate) => candidate.contentTypeId,
      );
      return {
        ok: true,
        attempts: 1,
        source: "luna",
        selection: {
          lodgingContentId: candidates.find(
            (candidate) => candidate.contentTypeId === 32,
          )?.contentId ?? "",
          days: Array.from(
            { length: intent.durationDays },
            (_, index) => ({
              day: index + 1,
              orderedVisitContentIds:
                index === 0
                  ? candidates
                      .filter((candidate) => candidate.contentTypeId === 12)
                      .map((candidate) => candidate.contentId)
                  : [],
              restaurantContentIds: [],
            }),
          ),
        },
      };
    },
    routeSegment: async ({ from, to, transportMode, signal }) => {
      routeCalls += 1;
      if (routeConfigurationFailure) {
        return { status: "failed", errorCode: "ODSAY_CONFIGURATION_ERROR" };
      }
      if (hangRoutes) {
        return new Promise((resolve) => {
          const abort = () => {
            observedRouteAbort = true;
            resolve({ status: "failed", errorCode: "ABORTED" });
          };
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        });
      }
      const durationSeconds =
        from.ref === "origin" && to.ref === "lodging-1"
          ? 1_800
          : from.ref === "origin" || to.ref === "origin"
            ? 1_200
            : 600;
      const segment: RouteSegment = {
        fromRef: from.ref,
        toRef: to.ref,
        mode: transportMode,
        source: transportMode === "drive" ? "naver" : "odsay",
        distanceMeters: durationSeconds * 10,
        durationSeconds,
        geometryStatus: "complete",
        paths: [[from.coordinate, to.coordinate]],
      };
      return { status: "ready", segment };
    },
  });

  const invalid = await orchestrator.startItinerary(
    {
      destination: "부산",
      durationDays: 1,
      transportMode: "transit",
    },
    "invalid-invocation",
  );
  assert.deepEqual(invalid, {
    status: "invalid",
    missingSlots: ["origin"],
    invalidSlots: [],
  });

  const started = await orchestrator.startItinerary(
    {
      origin: "서울역",
      destination: "부산",
      durationDays: 1,
      transportMode: "transit",
      requestedPlaces: ["해운대", "존재하지 않는 장소"],
    },
    "gpts-invocation-1",
  );
  assert.equal(started.status, "processing");
  if (started.status !== "processing") {
    throw new Error("일정 작업이 processing으로 시작되지 않았습니다.");
  }
  assert.equal(started.phase, "resolving_anchors");

  for (let step = 0; step < 4; step += 1) {
    await orchestrator.advanceItinerary(started.itineraryId);
  }
  assert.equal(maxActiveCandidateCalls, 3);
  assert.deepEqual(firstPlannerCandidateTypes, [12, 32]);
  assert.equal((await jobStore.getJob(started.itineraryId))?.meta.phase, "routing");
  await orchestrator.advanceItinerary(started.itineraryId);
  const afterRouting = await jobStore.getJob(started.itineraryId);
  assert.equal(afterRouting?.meta.phase, "ready");
  assert.ok(routeCalls > 0);
  const terminal = await orchestrator.runUntilTerminal(started.itineraryId, now + 42_000);
  assert.equal(terminal?.status, "ready");
  if (terminal?.status !== "ready") {
    throw new Error("일정 작업이 ready로 활성화되지 않았습니다.");
  }
  assert.equal(terminal.revision, 1);
  assert.equal(terminal.pageUrl, "https://planme.example/itinerary/orchestrated-1");
  assert.equal(terminal.widget.standardTotalMinutes, 60);
  assert.equal(terminal.widget.carrymeTotalMinutes, 40);
  assert.equal(terminal.widget.savedMinutes, 20);
  assert.deepEqual(usageEvents, ["itinerary_ready"]);
  assert.deepEqual(terminal.excludedRequestedPlaces, [
    { input: "존재하지 않는 장소", reason: "TOURAPI_NOT_FOUND" },
  ]);

  const stored = await jobStore.getRevision(started.itineraryId, 1);
  assert.equal(stored?.standard.days[0]?.startMinute, 600);
  assert.equal(stored?.standard.days[0]?.visits[0]?.startMinute, 610);
  assert.equal(stored?.carryme.days[0]?.startMinute, 590);
  assert.equal(stored?.carryme.days[0]?.visits[0]?.startMinute, 590);
  assert.equal(stored?.carryme.luggageSegments.length, 1);
  assert.deepEqual(
    stored?.carryme.luggageEvents.map((event) => event.kind),
    ["handoff", "delivered"],
  );
  assert.equal(
    Object.values(stored?.selectedPlaceSnapshots ?? {}).every(
      (place) => place.source === "tourapi",
    ),
    true,
  );

  const stationDestination = await orchestrator.startItinerary(
    {
      origin: "서울역",
      destination: "부산역",
      durationDays: 1,
      transportMode: "drive",
    },
    "gpts:station-destination",
  );
  assert.equal(stationDestination.status, "processing");
  if (stationDestination.status !== "processing") {
    throw new Error("역 목적지 일정이 processing으로 시작되지 않았습니다.");
  }
  await orchestrator.advanceItinerary(stationDestination.itineraryId);
  assert.equal(
    (await jobStore.getJob(stationDestination.itineraryId))?.meta.phase,
    "collecting_candidates",
  );
  assert.deepEqual(geocodeQueries.slice(-3), ["서울역", "부산역", "부산광역시 중구"]);

  const replay = await orchestrator.startItinerary(
    {
      origin: "서울역",
      destination: "부산",
      durationDays: 1,
      transportMode: "transit",
      requestedPlaces: ["해운대", "존재하지 않는 장소"],
    },
    "gpts-invocation-1",
  );
  assert.equal(replay.status, "ready");
  if (replay.status === "ready") {
    assert.equal(replay.itineraryId, started.itineraryId);
  }

  const conflict = await orchestrator.startItinerary(
    {
      origin: "서울역",
      destination: "제주",
      durationDays: 1,
      transportMode: "transit",
    },
    "gpts-invocation-1",
  );
  assert.deepEqual(conflict, { status: "idempotency_conflict" });

  const editStarted = await orchestrator.startItineraryEdit(started.itineraryId, {
    baseRevision: 1,
    transportMode: "drive",
    days: [
      {
        day: 1,
        orderedVisitContentIds: ["visit-1"],
        restaurantContentIds: [],
      },
    ],
  });
  assert.equal(editStarted.status, "processing");
  const edited = await orchestrator.runUntilTerminal(
    started.itineraryId,
    now + 42_000,
  );
  assert.equal(edited?.status, "ready");
  if (edited?.status === "ready") {
    assert.equal(edited.revision, 2);
    assert.equal(edited.widget.transportMode, "drive");
  }
  const editedJob = await jobStore.getJob(started.itineraryId);
  assert.equal(editedJob?.meta.previousRevision, 1);
  assert.equal(editedJob?.meta.activeRevision, 2);

  const invalidEditStarted = await orchestrator.startItineraryEdit(
    started.itineraryId,
    {
      baseRevision: 2,
      days: [
        {
          day: 1,
          orderedVisitContentIds: ["invented-place"],
        },
      ],
    },
  );
  assert.equal(invalidEditStarted.status, "processing");
  const invalidEdit = await orchestrator.runUntilTerminal(
    started.itineraryId,
    now + 42_000,
  );
  assert.equal(invalidEdit?.status, "failed");
  if (invalidEdit?.status === "failed") {
    assert.equal(invalidEdit.errorCode, "INVALID_EDIT_COMMAND");
  }
  const preserved = await jobStore.getJob(started.itineraryId);
  assert.equal(preserved?.meta.activeRevision, 2);
  assert.equal(preserved?.activeRevision?.revision, 2);

  now += 25 * 60 * 60 * 1_000;
  emptyVisitCandidates = true;
  const emptyRefreshEdit = await orchestrator.startItineraryEdit(
    started.itineraryId,
    {
      baseRevision: 2,
      days: [
        {
          day: 1,
          orderedVisitContentIds: ["visit-1"],
        },
      ],
    },
  );
  assert.equal(emptyRefreshEdit.status, "processing");
  const emptyRefreshFailure = await orchestrator.runUntilTerminal(
    started.itineraryId,
    now + 42_000,
  );
  assert.equal(emptyRefreshFailure?.status, "failed");
  if (emptyRefreshFailure?.status === "failed") {
    assert.equal(
      emptyRefreshFailure.errorCode,
      "TOURAPI_CANDIDATES_INSUFFICIENT",
    );
  }
  assert.equal(
    (await jobStore.getJob(started.itineraryId))?.meta.activeRevision,
    2,
  );
  emptyVisitCandidates = false;

  now += 25 * 60 * 60 * 1_000;
  const zeroLuggageStart = await orchestrator.startItinerary(
    {
      origin: "서울역",
      destination: "부산",
      durationDays: 1,
      transportMode: "transit",
      luggageCount: 0,
    },
    "gpts:zero-luggage",
  );
  assert.equal(zeroLuggageStart.status, "processing");
  if (zeroLuggageStart.status !== "processing") {
    throw new Error("0개 수하물 일정이 processing으로 시작되지 않았습니다.");
  }
  const zeroLuggageReady = await orchestrator.runUntilTerminal(
    zeroLuggageStart.itineraryId,
    now + 42_000,
  );
  assert.equal(zeroLuggageReady?.status, "ready");
  const zeroLuggageRevision = await jobStore.getRevision(
    zeroLuggageStart.itineraryId,
    1,
  );
  assert.equal(
    zeroLuggageRevision?.standard.totalMinutes,
    zeroLuggageRevision?.carryme.totalMinutes,
  );
  assert.deepEqual(zeroLuggageRevision?.carryme.luggageEvents, []);

  routeConfigurationFailure = true;
  const routeConfigurationStart = await orchestrator.startItinerary(
    {
      origin: "서울역",
      destination: "부산",
      durationDays: 1,
      transportMode: "transit",
    },
    "gpts:route-configuration-failure",
  );
  assert.equal(routeConfigurationStart.status, "processing");
  if (routeConfigurationStart.status !== "processing") {
    throw new Error("경로 설정 실패 일정이 processing으로 시작되지 않았습니다.");
  }
  const routeConfigurationResult = await orchestrator.runUntilTerminal(
    routeConfigurationStart.itineraryId,
    now + 42_000,
  );
  assert.equal(routeConfigurationResult?.status, "failed");
  if (routeConfigurationResult?.status === "failed") {
    assert.equal(
      routeConfigurationResult.errorCode,
      "INTERNAL_CONFIGURATION_ERROR",
    );
  }
  routeConfigurationFailure = false;

  const fourteenDayStart = await orchestrator.startItinerary(
    {
      origin: "서울역",
      destination: "부산",
      durationDays: 14,
      transportMode: "transit",
    },
    "gpts:fourteen-days",
  );
  assert.equal(fourteenDayStart.status, "processing");
  if (fourteenDayStart.status !== "processing") {
    throw new Error("14일 일정이 processing으로 시작되지 않았습니다.");
  }
  const fourteenDayReady = await orchestrator.runUntilTerminal(
    fourteenDayStart.itineraryId,
    now + 42_000,
  );
  assert.equal(fourteenDayReady?.status, "ready");
  const fourteenDayRevision = await jobStore.getRevision(
    fourteenDayStart.itineraryId,
    1,
  );
  assert.equal(fourteenDayRevision?.standard.days.length, 14);
  assert.equal(
    fourteenDayRevision?.standard.days
      .slice(1)
      .every((day) => day.idleBlocks.length > 0),
    true,
  );

  const abortableStart = await orchestrator.startItinerary(
    {
      origin: "서울역",
      destination: "부산",
      durationDays: 1,
      transportMode: "transit",
    },
    "gpts:abortable-route",
  );
  assert.equal(abortableStart.status, "processing");
  if (abortableStart.status !== "processing") {
    throw new Error("취소 가능 일정이 processing으로 시작되지 않았습니다.");
  }
  for (let step = 0; step < 4; step += 1) {
    await orchestrator.advanceItinerary(abortableStart.itineraryId);
  }
  hangRoutes = true;
  const abortController = new AbortController();
  const abortTimer = setTimeout(() => abortController.abort(), 20);
  const aborted = await orchestrator.runUntilTerminal(
    abortableStart.itineraryId,
    now + 10_000,
    abortController.signal,
  );
  clearTimeout(abortTimer);
  hangRoutes = false;
  assert.equal(observedRouteAbort, true);
  assert.equal(aborted?.status, "failed");
  if (aborted?.status === "failed") {
    assert.equal(aborted.errorCode, "TIME_BUDGET_EXCEEDED");
  }

  const timeoutStart = await orchestrator.startItinerary(
    {
      origin: "서울역",
      destination: "부산",
      durationDays: 1,
      transportMode: "transit",
    },
    "gpts-invocation-timeout",
  );
  assert.equal(timeoutStart.status, "processing");
  if (timeoutStart.status === "processing") {
    const timeout = await orchestrator.runUntilTerminal(
      timeoutStart.itineraryId,
      now + 100,
    );
    assert.deepEqual(timeout, {
      status: "failed",
      itineraryId: timeoutStart.itineraryId,
      errorCode: "TIME_BUDGET_EXCEEDED",
      message: "제한 시간 안에 안전한 일정을 완성하지 못했습니다.",
    });
  }

  console.log(
    "PlanME V3 orchestrator checks passed (V3-02, V3-08 staged terminal delivery).",
  );
}

function candidateResponse(contentTypeId: AllowedTourContentTypeId) {
  if (contentTypeId === 12) {
    return {
      status: "success" as const,
      totalCount: 1,
      records: [
        {
          contentid: "visit-1",
          contenttypeid: 12,
          title: "해운대",
          mapx: 129.1587,
          mapy: 35.1587,
          lDongRegnCd: "26",
          lDongSignguCd: "260",
        },
      ],
    };
  }
  if (contentTypeId === 32) {
    return {
      status: "success" as const,
      totalCount: 1,
      records: [
        {
          contentid: "lodging-1",
          contenttypeid: 32,
          title: "부산 호텔",
          mapx: 129.0756,
          mapy: 35.1796,
          lDongRegnCd: "26",
          lDongSignguCd: "260",
        },
      ],
    };
  }
  return { status: "empty" as const, records: [] as [], totalCount: 0 as const };
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
