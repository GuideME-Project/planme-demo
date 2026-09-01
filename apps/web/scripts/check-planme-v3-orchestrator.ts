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
  let visitCandidateCount = 1;
  let activeDriveRouteCalls = 0;
  let activeTransitRouteCalls = 0;
  let maxActiveDriveRouteCalls = 0;
  let maxActiveTransitRouteCalls = 0;
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
    resolveDestination: async (destination) => destination === "경주월드"
      ? {
          region: {
            regionCode: "47",
            regionName: "경상북도",
            districtCode: "130",
            districtName: "경주시",
          },
          place: {
            contentid: "gyeongju-world",
            contenttypeid: "12",
            title: "경주월드 어뮤즈먼트",
            mapx: "129.2822",
            mapy: "35.8366",
            addr1: "경상북도 경주시 보문로 544",
            lDongRegnCd: "47",
            lDongSignguCd: "130",
          },
        }
      : {
          region: {
            regionCode: "26",
            regionName: "부산광역시",
            districtCode: "260",
            districtName: "중구",
          },
        },
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
          : candidateResponse(contentTypeId, visitCandidateCount);
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
      if (transportMode === "drive") {
        activeDriveRouteCalls += 1;
        maxActiveDriveRouteCalls = Math.max(
          maxActiveDriveRouteCalls,
          activeDriveRouteCalls,
        );
      } else {
        activeTransitRouteCalls += 1;
        maxActiveTransitRouteCalls = Math.max(
          maxActiveTransitRouteCalls,
          activeTransitRouteCalls,
        );
      }
      try {
        if (routeConfigurationFailure) {
          return { status: "failed", errorCode: "ODSAY_CONFIGURATION_ERROR" };
        }
        if (hangRoutes) {
          return await new Promise((resolve) => {
            const abort = () => {
              observedRouteAbort = true;
              resolve({ status: "failed", errorCode: "ABORTED" });
            };
            if (signal?.aborted) abort();
            else signal?.addEventListener("abort", abort, { once: true });
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
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
      } finally {
        if (transportMode === "drive") activeDriveRouteCalls -= 1;
        else activeTransitRouteCalls -= 1;
      }
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
  assert.equal(maxActiveTransitRouteCalls, 1);
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

  const placeDestination = await orchestrator.startItinerary(
    {
      origin: "강원도 양양",
      destination: "경주월드",
      durationDays: 2,
      transportMode: "drive",
    },
    "gpts:place-destination",
  );
  assert.equal(placeDestination.status, "processing");
  if (placeDestination.status !== "processing") {
    throw new Error("장소형 목적지 일정이 processing으로 시작되지 않았습니다.");
  }
  await orchestrator.advanceItinerary(placeDestination.itineraryId);
  const placeAnchor = await jobStore.getCheckpoint(
    placeDestination.itineraryId,
    1,
    "resolving_anchors",
  );
  const placePayload = placeAnchor?.payload as {
    intent?: { destination?: string; requestedPlaces?: string[] };
    destinationCoordinate?: { lat?: number; lng?: number };
    requiredDestinationPlace?: { title?: string };
  } | undefined;
  assert.equal(placePayload?.intent?.destination, "경주시");
  assert.deepEqual(placePayload?.intent?.requestedPlaces, ["경주월드 어뮤즈먼트"]);
  assert.deepEqual(placePayload?.destinationCoordinate, {
    lat: 35.8366,
    lng: 129.2822,
  });
  assert.equal(placePayload?.requiredDestinationPlace?.title, "경주월드 어뮤즈먼트");

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
  maxActiveDriveRouteCalls = 0;
  const edited = await orchestrator.runUntilTerminal(
    started.itineraryId,
    now + 42_000,
  );
  assert.equal(edited?.status, "ready");
  if (edited?.status === "ready") {
    assert.equal(edited.revision, 2);
    assert.equal(edited.widget.transportMode, "drive");
  }
  assert.equal(maxActiveDriveRouteCalls, 3);
  const editedJob = await jobStore.getJob(started.itineraryId);
  assert.equal(editedJob?.meta.previousRevision, 1);
  assert.equal(editedJob?.meta.activeRevision, 2);

  now += 25 * 60 * 60 * 1_000;
  visitCandidateCount = 7;
  maxActiveDriveRouteCalls = 0;
  const batchedDriveStart = await orchestrator.startItinerary(
    {
      origin: "서울역",
      destination: "부산",
      durationDays: 1,
      transportMode: "drive",
    },
    "gpts:batched-drive-routes",
  );
  assert.equal(batchedDriveStart.status, "processing");
  if (batchedDriveStart.status !== "processing") {
    throw new Error("자동차 배치 경로 일정이 processing으로 시작되지 않았습니다.");
  }
  const batchedDriveReady = await orchestrator.runUntilTerminal(
    batchedDriveStart.itineraryId,
    now + 42_000,
  );
  assert.equal(batchedDriveReady?.status, "ready");
  assert.equal(maxActiveDriveRouteCalls, 3);
  visitCandidateCount = 1;

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
  await checkChildDistrictCandidateCollection();
  console.log(
    "PlanME V3 orchestrator checks passed (V3-02, V3-08 staged terminal delivery).",
  );
}

async function checkChildDistrictCandidateCollection() {
  const now = Date.parse("2026-08-31T00:00:00.000Z");
  const jobStore = createMemoryPlanmeV3JobStore({
    now: () => now,
    createId: () => "child-district-merge",
  });
  const tourCache = createMemoryPlanmeV3TourCache({ now: () => now });
  await tourCache.saveSuccessfulResponse(
    { regionCode: "52", districtCode: "110", contentTypeId: 12 },
    [
      {
        contentId: "parent-cache-must-not-be-used",
        contentTypeId: 12,
        title: "상위 전주시 캐시",
        coordinate: { lat: 35.8242, lng: 127.148 },
        regionCode: "52",
        districtCode: "110",
        fetchedAt: "2026-08-30T00:00:00.000Z",
        cacheStatus: "fresh",
        source: "tourapi",
      },
    ],
  );
  const candidateQueries: Array<{
    districtCode?: string;
    contentTypeId: AllowedTourContentTypeId;
  }> = [];
  const orchestrator = createPlanmeV3Orchestrator({
    jobStore,
    tourCache,
    now: () => now,
    pageOrigin: "https://planme.example",
    createLockOwner: () => "child-district-worker",
    resolveDestination: async () => ({
      region: {
        regionCode: "52",
        regionName: "전북특별자치도",
        districtCode: "110",
        districtName: "전주시",
      },
      candidateRegions: [
        {
          regionCode: "52",
          regionName: "전북특별자치도",
          districtCode: "111",
          districtName: "전주시 완산구",
        },
        {
          regionCode: "52",
          regionName: "전북특별자치도",
          districtCode: "113",
          districtName: "전주시 덕진구",
        },
      ],
    }),
    geocodeAnchor: async () => ({
      status: "ready",
      coordinate: { lat: 35.8242, lng: 127.148 },
    }),
    listCandidates: async ({ region, contentTypeId }) => {
      candidateQueries.push({ districtCode: region.districtCode, contentTypeId });
      if (contentTypeId === 12) {
        return {
          status: "success",
          totalCount: 2,
          records: [
            {
              contentid: "shared-attraction",
              contenttypeid: 12,
              title: region.districtCode === "111" ? "공통 명소 첫 결과" : "공통 명소 중복",
              mapx: 127.148,
              mapy: 35.8242,
              lDongRegnCd: "52",
              lDongSignguCd: region.districtCode,
            },
            {
              contentid: `visit-${region.districtCode}`,
              contenttypeid: 12,
              title: `전주 명소 ${region.districtCode}`,
              mapx: 127.15,
              mapy: 35.82,
              lDongRegnCd: "52",
              lDongSignguCd: region.districtCode,
            },
          ],
        };
      }
      if (contentTypeId === 14 && region.districtCode === "111") {
        return { status: "failure", errorCode: "TOURAPI_NETWORK", retriable: true };
      }
      if (contentTypeId === 14) {
        return {
          status: "success",
          totalCount: 1,
          records: [
            {
              contentid: "museum-113",
              contenttypeid: 14,
              title: "덕진구 박물관",
              mapx: 127.13,
              mapy: 35.85,
              lDongRegnCd: "52",
              lDongSignguCd: "113",
            },
          ],
        };
      }
      if (contentTypeId === 32) {
        return {
          status: "success",
          totalCount: 1,
          records: [
            {
              contentid: `lodging-${region.districtCode}`,
              contenttypeid: 32,
              title: `전주 숙소 ${region.districtCode}`,
              mapx: 127.14,
              mapy: 35.83,
              lDongRegnCd: "52",
              lDongSignguCd: region.districtCode,
            },
          ],
        };
      }
      return { status: "empty", records: [], totalCount: 0 };
    },
    planCandidates: async () => ({
      ok: false,
      errorCode: "OPENAI_CONFIGURATION_MISSING",
      attempts: 0,
    }),
    routeSegment: async () => ({
      status: "failed",
      errorCode: "NOT_USED",
    }),
  });

  const started = await orchestrator.startItinerary(
    {
      origin: "서울역",
      destination: "전주",
      durationDays: 1,
      transportMode: "drive",
    },
    "child-district-merge",
  );
  assert.equal(started.status, "processing");
  if (started.status !== "processing") {
    throw new Error("하위 구 병합 일정이 processing으로 시작되지 않았습니다.");
  }
  await orchestrator.advanceItinerary(started.itineraryId);
  await orchestrator.advanceItinerary(started.itineraryId);
  assert.equal(
    (await jobStore.getJob(started.itineraryId))?.meta.phase,
    "arranging",
  );
  assert.equal(candidateQueries.length, PLANME_V3_ALLOWED_CONTENT_TYPE_IDS.length * 2);
  assert.equal(
    candidateQueries.some((query) => query.districtCode === "110"),
    false,
  );
  assert.deepEqual(
    [...new Set(candidateQueries.map((query) => query.districtCode))],
    ["111", "113"],
  );

  const checkpoint = await jobStore.getCheckpoint(
    started.itineraryId,
    1,
    "collecting_candidates",
  );
  const payload = checkpoint?.payload as {
    candidates?: Array<{ contentId?: string; title?: string }>;
  } | undefined;
  assert.deepEqual(
    payload?.candidates?.map((candidate) => candidate.contentId),
    [
      "shared-attraction",
      "visit-111",
      "visit-113",
      "museum-113",
      "lodging-111",
      "lodging-113",
    ],
  );
  assert.equal(payload?.candidates?.[0]?.title, "공통 명소 첫 결과");
  assert.equal(
    payload?.candidates?.some(
      (candidate) => candidate.contentId === "parent-cache-must-not-be-used",
    ),
    false,
  );
}

function candidateResponse(
  contentTypeId: AllowedTourContentTypeId,
  visitCandidateCount: number,
) {
  if (contentTypeId === 12) {
    return {
      status: "success" as const,
      totalCount: visitCandidateCount,
      records: Array.from({ length: visitCandidateCount }, (_, index) => ({
          contentid: `visit-${index + 1}`,
          contenttypeid: 12,
          title: index === 0 ? "해운대" : `부산 명소 ${index + 1}`,
          mapx: 129.1587 + index * 0.001,
          mapy: 35.1587 + index * 0.001,
          lDongRegnCd: "26",
          lDongSignguCd: "260",
        })),
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
