import assert from "node:assert/strict";
import type {
  MapCoordinate,
  PlanmeItinerary,
  RoutePlan,
} from "@planme/core";
import {
  RouteFinalizationError,
  RouteFinalizationTimeoutError,
  finalizeItineraryRoutes,
} from "../lib/itinerary-route-finalizer";
import { validateEditedItineraryPlaces } from "../lib/edited-itinerary-validator";
import { computeNaverDirectionsRoute } from "../lib/route-providers/naver-directions";
import { computeOdsayTransitRoute } from "../lib/route-providers/odsay";
import {
  MemoryRouteProviderCallBudget,
  MemoryRouteSegmentCache,
  RouteProviderRuntimeError,
  createRouteSegmentCacheKey,
  type OdsayStationRecoveryPolicy,
  type TransitRecoveryRuntime,
} from "../lib/route-segment-cache";
import type {
  RouteProviderResult,
  RouteProviderStop,
} from "../lib/route-providers/types";
import { RouteProviderError } from "../lib/route-providers/types";
import { TransitAccessDecisionError } from "../lib/route-providers/types";

/** Verifies concurrency, atomic failure, timeout, timeline invariance, and versioned storage. */
async function main() {
  const itinerary = createTestItinerary();
  const timelineBefore = serializeTimelines(itinerary);
  let activeProviders = 0;
  let maximumActiveProviders = 0;

  const finalized = await finalizeItineraryRoutes(itinerary, {
    computeDriveRoute: async (stops) => {
      activeProviders += 1;
      maximumActiveProviders = Math.max(maximumActiveProviders, activeProviders);
      await new Promise((resolve) => setTimeout(resolve, 15));
      activeProviders -= 1;
      return createProviderResult(stops, 600);
    },
  });

  assert.equal(maximumActiveProviders, 2);
  assert.equal(serializeTimelines(finalized), timelineBefore);
  assert.equal(finalized.days[0].standard.durationMinutes, 10);
  assert.equal(finalized.days[0].standard.geoPath, undefined);
  assert.equal(finalized.days[0].standard.geoSegments?.length, 1);

  await assertFailedProviderLegRetriesOnce();
  await assertShortTransitLegSkipsOdsay();
  await assertOdsayStationRecoveryAndCacheContract();
  await assertOdsayEstimatedWalkAndPolicyLimits();
  await assertOdsayCallBudgetFailsClosed();
  await assertStableTimelineAdjustmentAndHiddenSavings();
  await assertDeterministicTransitFailureSelection();
  await assertOdsayFailureIncludesSegmentContext();
  await assertMissingCoordinatesUseRepresentativeNaverCandidate();
  await assertEditedItineraryPreservesAiFields();
  await assertDuplicateOnlyRouteNeedsNoProviderCall();
  await assertDuplicateStableTimelineReferences();

  let providerCalls = 0;
  await assert.rejects(
    () =>
      finalizeItineraryRoutes(itinerary, {
        computeDriveRoute: async (stops) => {
          providerCalls += 1;

          if (providerCalls === 2) {
            throw new RouteProviderError(
              "NAVER_HTTP_503",
              "provider response body must not enter the finalization log",
              true,
              true,
              {
                destinationStop: stops[1],
                originStop: stops[0],
                segmentIndex: 0,
              },
            );
          }

          return createProviderResult(stops, 600);
        },
      }),
    (error) =>
      error instanceof RouteFinalizationError &&
      error.internalCode === "NAVER_HTTP_503" &&
      error.provider === "naver-directions" &&
      error.dayIndex === 0 &&
      error.routeId === "carryme" &&
      error.retried &&
      error.segmentIndex === 0 &&
      error.originPlaceName === undefined &&
      error.originCoordinate === undefined &&
      error.destinationPlaceName === itinerary.days[0].carryme.stops[1].label &&
      error.destinationCoordinate?.lat ===
        itinerary.days[0].carryme.stops[1].coordinate?.lat &&
      error.destinationCoordinate?.lng ===
        itinerary.days[0].carryme.stops[1].coordinate?.lng,
  );
  assert.equal(providerCalls, 2);

  await assert.rejects(
    () =>
      finalizeItineraryRoutes(itinerary, {
        computeDriveRoute: (_stops, signal) =>
          new Promise<RouteProviderResult>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new RouteFinalizationTimeoutError()),
              { once: true },
            );
          }),
        timeoutMs: 20,
      }),
    RouteFinalizationTimeoutError,
  );

  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const store = await import("../lib/preview-itinerary-store");
  const savedDraft = await store.savePreviewItinerary(itinerary);
  const draftRecord = await store.getPreviewItineraryRecordById(savedDraft.itineraryId);

  assert.equal(draftRecord?.version, 1);
  assert.equal(draftRecord?.revision, 0);
  const savedFinalized = await store.saveFinalizedPreviewItinerary(finalized, 0);

  assert.equal(savedFinalized?.revision, 1);
  assert.equal((await store.getPreviewItineraryRecordById(itinerary.id))?.routeFinalized, true);
  assert.equal(await store.saveFinalizedPreviewItinerary(finalized, 0), null);

  console.log("PlanME finalized route contract passed");
}

/** Verifies route order is stable and operational failures outrank repair decisions. */
async function assertDeterministicTransitFailureSelection() {
  const itinerary = createTestItinerary();
  itinerary.transportMode = "transit";
  itinerary.days = itinerary.days.slice(0, 1);

  await assert.rejects(
    () => finalizeItineraryRoutes(itinerary, {
      computeTransitRoute: async (stops) => {
        const isStandard = stops[0]?.id.startsWith("standard");
        await new Promise((resolve) => setTimeout(resolve, isStandard ? 15 : 1));
        throw new TransitAccessDecisionError(
          { ...stops[1], placeConstraint: "replaceable", stopRef: isStandard ? "a" : "b" },
          0,
          "destination_station_missing",
        );
      },
    }),
    (error) =>
      error instanceof RouteFinalizationError &&
      error.routeId === "standard" &&
      error.stopRef === "a",
  );

  await assert.rejects(
    () => finalizeItineraryRoutes(itinerary, {
      computeTransitRoute: async (stops) => {
        const isStandard = stops[0]?.id.startsWith("standard");

        if (isStandard) {
          throw new TransitAccessDecisionError(
            { ...stops[1], placeConstraint: "replaceable", stopRef: "a" },
            0,
            "destination_station_missing",
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new RouteProviderRuntimeError("ROUTE_PROVIDER_CONFIGURATION_ERROR");
      },
    }),
    (error) =>
      error instanceof RouteFinalizationError &&
      error.routeId === "carryme" &&
      error.internalCode === "ROUTE_PROVIDER_CONFIGURATION_ERROR",
  );
}

/** Verifies stable timelines use route durations and estimated routes omit every saving label. */
async function assertStableTimelineAdjustmentAndHiddenSavings() {
  const itinerary = createTestItinerary();
  itinerary.transportMode = "transit";
  itinerary.days = itinerary.days.slice(0, 1).map((day) => {
    const addContract = (route: RoutePlan): RoutePlan => ({
      ...route,
      stops: route.stops.map((stop, index) => ({
        ...stop,
        mode: "transit",
        placeConstraint: index === 0 ? "fixed" : "replaceable",
        stopRef: `day-1-stop-${index + 1}`,
      })),
    });
    const timeline = [
      {
        category: "arrival" as const,
        description: "출발합니다.",
        savingLabel: "기존 절약 문구",
        stayDurationMinutes: 30,
        stopRef: "day-1-stop-1",
        time: "08:00",
        title: "출발",
      },
      {
        category: "event" as const,
        description: "방문합니다.",
        savingLabel: "10분 절약",
        stayDurationMinutes: 60,
        stopRef: "day-1-stop-2",
        time: "23:00",
        title: "방문",
      },
    ];

    return {
      ...day,
      carryme: addContract(day.carryme),
      carrymeTimeline: timeline,
      standard: addContract(day.standard),
      standardTimeline: timeline,
      timeline,
    };
  });

  const finalized = await finalizeItineraryRoutes(itinerary, {
    computeTransitRoute: async (stops) =>
      createTransitProviderResult(
        stops,
        stops[0]?.id.startsWith("carryme") ? 900 : 600,
        stops[0]?.id.startsWith("carryme") ? "estimated" : "provider",
      ),
  });
  const day = finalized.days[0];

  assert.equal(day.standardTimeline?.[1].time, "08:40");
  assert.equal(day.carrymeTimeline?.[1].time, "08:45");
  assert.equal(day.savingStatus, "hidden_estimated");
  assert.equal(day.savingMinutes, undefined);
  assert.equal(day.timeline[1].savingLabel, undefined);
  assert.equal(finalized.carrymeSaving, undefined);
  assert.equal(finalized.savedDurationLabel, undefined);

  const boundary = structuredClone(itinerary);
  boundary.days[0].timeline[0].time = "23:50";
  boundary.days[0].standardTimeline![0].time = "23:50";
  boundary.days[0].carrymeTimeline![0].time = "23:50";

  await assert.rejects(
    () => finalizeItineraryRoutes(boundary, {
      computeTransitRoute: async (stops) =>
        createTransitProviderResult(stops, 600, "provider"),
    }),
    (error) =>
      error instanceof RouteFinalizationError &&
      error.internalCode === "TIMELINE_DATE_BOUNDARY_EXCEEDED",
  );
}

/** Verifies code 4 evaluates only three stations and shares the winning segment by trace. */
async function assertOdsayStationRecoveryAndCacheContract() {
  const originalApiKey = process.env.NEXT_PUBLIC_ODSAY_API_KEY;
  const destination = createRecoveryDestination("replaceable");
  const origin = createRecoveryOrigin();
  const runtime = createTestRecoveryRuntime("00000000-0000-4000-8000-000000000101");
  let providerCalls = 0;
  let stationTransitCalls = 0;
  let walkCalls = 0;

  try {
    const cacheKey = createRouteSegmentCacheKey(
      runtime.traceId,
      origin.coordinate!,
      destination.coordinate!,
      runtime.policy.policyVersion,
    );
    assert.doesNotMatch(cacheKey, /사용자 출발지|방문지|37\.000000|127\.000000/);
    process.env.NEXT_PUBLIC_ODSAY_API_KEY = "test-odsay-key";
    const fetchImpl: typeof fetch = async (input) => {
      providerCalls += 1;
      const url = new URL(String(input));

      if (url.pathname.endsWith("/pointSearch")) {
        return jsonResponse({
          result: {
            station: [
              createStationFixture(1, 127.0105, 37.0105),
              createStationFixture(2, 127.011, 37.011),
              createStationFixture(3, 127.0115, 37.0115),
              createStationFixture(4, 127.012, 37.012),
            ],
          },
        });
      }

      if (url.pathname.endsWith("/searchWalkPathV2")) {
        walkCalls += 1;
        const stationLongitude = Number(url.searchParams.get("SX"));
        const walkMinutes = stationLongitude === 127.011 ? 8 : stationLongitude < 127.011 ? 5 : 6;

        return jsonResponse({
          result: { path: [{ info: { totalDistance: 300, totalTime: walkMinutes } }] },
        });
      }

      if (url.pathname.endsWith("/searchPubTransPathT")) {
        const destinationLongitude = Number(url.searchParams.get("EX"));

        if (destinationLongitude === destination.coordinate?.lng) {
          return jsonResponse({ error: { code: "4", message: "destination station missing" } });
        }

        stationTransitCalls += 1;
        const transitMinutes = destinationLongitude === 127.011
          ? 10
          : destinationLongitude < 127.011
            ? 30
            : 20;

        return jsonResponse({
          result: { path: [{ info: { totalDistance: 2_000, totalTime: transitMinutes } }] },
        });
      }

      throw new Error(`Unexpected ODsay test path: ${url.pathname}`);
    };
    const first = await computeOdsayTransitRoute(
      [origin, destination],
      new AbortController().signal,
      { fetchImpl, recoveryRuntime: runtime, skipRequestSpacing: true },
    );
    const firstCallCount = providerCalls;

    assert.equal(stationTransitCalls, 3);
    assert.equal(walkCalls, 3);
    assert.equal(first.totalDurationSeconds, 18 * 60);
    assert.equal(first.segments[0].durationSource, "provider");

    const cached = await computeOdsayTransitRoute(
      [origin, destination],
      new AbortController().signal,
      { fetchImpl, recoveryRuntime: runtime, skipRequestSpacing: true },
    );

    assert.equal(providerCalls, firstCallCount);
    assert.equal(cached.totalDurationSeconds, first.totalDurationSeconds);
  } finally {
    restoreEnv("NEXT_PUBLIC_ODSAY_API_KEY", originalApiKey);
  }
}

/** Verifies 411-414 estimation and the 30/90 minute fixed-place boundaries. */
async function assertOdsayEstimatedWalkAndPolicyLimits() {
  const originalApiKey = process.env.NEXT_PUBLIC_ODSAY_API_KEY;

  try {
    process.env.NEXT_PUBLIC_ODSAY_API_KEY = "test-odsay-key";
    const estimatedRuntime = createTestRecoveryRuntime(
      "00000000-0000-4000-8000-000000000102",
    );
    const estimatedFetch = createSingleStationRecoveryFetch({ walkErrorCode: "411" });
    const estimated = await computeOdsayTransitRoute(
      [createRecoveryOrigin(), createRecoveryDestination("replaceable")],
      new AbortController().signal,
      {
        fetchImpl: estimatedFetch,
        recoveryRuntime: estimatedRuntime,
        skipRequestSpacing: true,
      },
    );

    assert.equal(estimated.segments[0].durationSource, "estimated");
    assert.deepEqual(estimated.segments[0].paths, []);

    await assertWalkPolicyBoundary("replaceable", 30, true, 103);
    await assertWalkPolicyBoundary("replaceable", 31, false, 104);
    await assertWalkPolicyBoundary("fixed", 90, true, 105);
    await assertWalkPolicyBoundary("fixed", 91, false, 106);
  } finally {
    restoreEnv("NEXT_PUBLIC_ODSAY_API_KEY", originalApiKey);
  }
}

/** Verifies the shared provider counter rejects before a second network request. */
async function assertOdsayCallBudgetFailsClosed() {
  const originalApiKey = process.env.NEXT_PUBLIC_ODSAY_API_KEY;
  const traceId = "00000000-0000-4000-8000-000000000107";
  const runtime = createTestRecoveryRuntime(traceId, 1);
  let networkCalls = 0;

  try {
    process.env.NEXT_PUBLIC_ODSAY_API_KEY = "test-odsay-key";
    await assert.rejects(
      () => computeOdsayTransitRoute(
        [createRecoveryOrigin(), createRecoveryDestination("replaceable")],
        new AbortController().signal,
        {
          fetchImpl: async () => {
            networkCalls += 1;
            return jsonResponse({ error: { code: "4", message: "missing" } });
          },
          recoveryRuntime: runtime,
          skipRequestSpacing: true,
        },
      ),
      (error) =>
        error instanceof RouteProviderRuntimeError &&
        error.code === "PROVIDER_CALL_BUDGET_EXCEEDED",
    );
    assert.equal(networkCalls, 1);
  } finally {
    restoreEnv("NEXT_PUBLIC_ODSAY_API_KEY", originalApiKey);
  }
}

async function assertWalkPolicyBoundary(
  constraint: "fixed" | "replaceable",
  walkMinutes: number,
  accessible: boolean,
  traceSuffix: number,
) {
  const runtime = createTestRecoveryRuntime(
    `00000000-0000-4000-8000-${String(traceSuffix).padStart(12, "0")}`,
  );
  const promise = computeOdsayTransitRoute(
    [createRecoveryOrigin(), createRecoveryDestination(constraint)],
    new AbortController().signal,
    {
      fetchImpl: createSingleStationRecoveryFetch({ walkMinutes }),
      recoveryRuntime: runtime,
      skipRequestSpacing: true,
    },
  );

  if (accessible) {
    assert.equal((await promise).segments.length, 1);
    return;
  }

  await assert.rejects(
    () => promise,
    (error) =>
      error instanceof TransitAccessDecisionError &&
      error.reason === "walk_limit_exceeded" &&
      error.status === (constraint === "replaceable"
        ? "replacement_required"
        : "confirmation_required"),
  );
}

function createTestRecoveryRuntime(
  traceId: string,
  maxRequests = 100,
): TransitRecoveryRuntime {
  const policy: OdsayStationRecoveryPolicy = {
    aiWalkLimitMinutes: 30,
    fixedWalkLimitMinutes: 90,
    maxStationCandidates: 3,
    policyVersion: "test-v1",
    searchRadiiMeters: [500, 1_000],
  };

  return {
    budget: new MemoryRouteProviderCallBudget(traceId, maxRequests),
    cache: new MemoryRouteSegmentCache(),
    mode: "on",
    policy,
    traceId,
  };
}

function createRecoveryOrigin(): RouteProviderStop {
  return {
    coordinate: { lat: 37, lng: 127 },
    id: "recovery-origin",
    label: "사용자 출발지",
    placeConstraint: "fixed",
    role: "출발지",
    stopRef: "day-1-stop-1",
  };
}

function createRecoveryDestination(
  placeConstraint: "fixed" | "replaceable",
): RouteProviderStop {
  return {
    coordinate: { lat: 37.01, lng: 127.01 },
    id: "recovery-destination",
    label: "방문지",
    placeConstraint,
    role: "방문지",
    stopRef: "day-1-stop-2",
  };
}

function createStationFixture(id: number, x: number, y: number) {
  return { stationClass: 1, stationID: id, stationName: `정류장 ${id}`, x, y };
}

function createSingleStationRecoveryFetch(input: {
  walkErrorCode?: string;
  walkMinutes?: number;
}): typeof fetch {
  return async (request) => {
    const url = new URL(String(request));

    if (url.pathname.endsWith("/pointSearch")) {
      return jsonResponse({ result: { station: [createStationFixture(1, 127.0105, 37.0105)] } });
    }

    if (url.pathname.endsWith("/searchWalkPathV2")) {
      return input.walkErrorCode
        ? jsonResponse({ error: { code: input.walkErrorCode, message: "walk network missing" } })
        : jsonResponse({
            result: { path: [{ info: { totalDistance: 300, totalTime: input.walkMinutes } }] },
          });
    }

    if (url.pathname.endsWith("/searchPubTransPathT")) {
      return Number(url.searchParams.get("EX")) === 127.01
        ? jsonResponse({ error: { code: "4", message: "destination station missing" } })
        : jsonResponse({ result: { path: [{ info: { totalDistance: 2_000, totalTime: 10 } }] } });
    }

    throw new Error(`Unexpected ODsay test path: ${url.pathname}`);
  };
}

function jsonResponse(value: object) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

/** Verifies a non-retriable ODsay response retains the exact failed leg. */
async function assertOdsayFailureIncludesSegmentContext() {
  const originalApiKey = process.env.NEXT_PUBLIC_ODSAY_API_KEY;
  const originalFetch = globalThis.fetch;
  const originStop: RouteProviderStop = {
    coordinate: { lat: 37.535, lng: 127.123 },
    id: "standard-0-origin",
    label: "사용자 출발지",
    role: "출발지",
  };
  const destinationStop: RouteProviderStop = {
    coordinate: { lat: 37.546, lng: 127.134 },
    id: "standard-1-visit",
    label: "AI 방문지",
    role: "방문지",
  };

  try {
    process.env.NEXT_PUBLIC_ODSAY_API_KEY = "test-odsay-key";
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ error: { code: "-98", message: "provider message" } }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );

    await assert.rejects(
      () =>
        computeOdsayTransitRoute(
          [originStop, destinationStop],
          new AbortController().signal,
        ),
      (error) =>
        error instanceof RouteProviderError &&
        error.code === "-98" &&
        error.segmentIndex === 0 &&
        error.originStop === originStop &&
        error.destinationStop === destinationStop &&
        !error.retried,
    );
  } finally {
    globalThis.fetch = originalFetch;

    if (originalApiKey === undefined) {
      delete process.env.NEXT_PUBLIC_ODSAY_API_KEY;
    } else {
      process.env.NEXT_PUBLIC_ODSAY_API_KEY = originalApiKey;
    }
  }
}

/** Verifies the known 678 m Namhae leg completes without consuming an ODsay request. */
async function assertShortTransitLegSkipsOdsay() {
  const originalApiKey = process.env.NEXT_PUBLIC_ODSAY_API_KEY;
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;

  try {
    process.env.NEXT_PUBLIC_ODSAY_API_KEY = "test-odsay-key";
    globalThis.fetch = async () => {
      providerCalls += 1;
      throw new Error("ODsay must not be called for a nearby transit leg.");
    };

    const result = await computeOdsayTransitRoute(
      [
        {
          coordinate: { lat: 34.7992073, lng: 128.0401618 },
          id: "namhae-german-village",
          label: "남해독일마을",
          role: "방문지",
        },
        {
          coordinate: { lat: 34.8043064, lng: 128.0360876 },
          id: "gardening-art-village-deck",
          label: "원예예술촌전망데크",
          role: "방문지",
        },
      ],
      new AbortController().signal,
    );

    assert.equal(providerCalls, 0);
    assert.equal(result.segments.length, 1);
    assert.equal(result.segments[0].distanceMeters, 678);
    assert.equal(result.segments[0].durationSeconds, 610);
    assert.equal(result.segments[0].geometryStatus, "partial");
    assert.deepEqual(result.segments[0].paths, []);
  } finally {
    globalThis.fetch = originalFetch;

    if (originalApiKey === undefined) {
      delete process.env.NEXT_PUBLIC_ODSAY_API_KEY;
    } else {
      process.env.NEXT_PUBLIC_ODSAY_API_KEY = originalApiKey;
    }
  }
}

/** Verifies a same-place-only route completes as zero movement without a provider error. */
async function assertDuplicateOnlyRouteNeedsNoProviderCall() {
  const itinerary = createTestItinerary();
  let providerCalls = 0;

  itinerary.days = itinerary.days.slice(0, 1).map((day) => ({
    ...day,
    standard: {
      ...day.standard,
      stops: [
        day.standard.stops[0],
        { ...day.standard.stops[0], caption: "복귀", role: "복귀지" },
      ],
    },
    carryme: {
      ...day.carryme,
      stops: [
        day.carryme.stops[0],
        { ...day.carryme.stops[0], caption: "복귀", role: "복귀지" },
      ],
    },
  }));

  const finalized = await finalizeItineraryRoutes(itinerary, {
    computeDriveRoute: async (stops) => {
      providerCalls += 1;
      return createProviderResult(stops, 600);
    },
  });

  assert.equal(providerCalls, 0);
  assert.equal(finalized.days[0].standard.durationMinutes, 0);
  assert.equal(finalized.days[0].standard.durationLabel, "0분");
  assert.equal(finalized.days[0].standard.geoSegments, undefined);
  assert.equal(finalized.days[0].standard.stops.length, 1);
}

/** Verifies same-place route deduplication keeps every logical timeline reference valid. */
async function assertDuplicateStableTimelineReferences() {
  const itinerary = createTestItinerary();
  const createStableRoute = (route: RoutePlan): RoutePlan => {
    const origin = {
      ...route.stops[0],
      placeConstraint: "fixed" as const,
      stopRef: "day-1-stop-1",
    };
    const firstVisit = {
      ...route.stops[1],
      mode: "transit" as const,
      placeConstraint: "replaceable" as const,
      placeSourceRef: "naver_local:same-place",
      stopRef: "day-1-stop-2",
    };
    const secondVisit = {
      ...firstVisit,
      caption: "같은 장소에서 다음 일정",
      stopRef: "day-1-stop-3",
    };

    return { ...route, stops: [origin, firstVisit, secondVisit] };
  };
  const timeline = [
    {
      category: "arrival" as const,
      description: "출발합니다.",
      stayDurationMinutes: 30,
      stopRef: "day-1-stop-1",
      time: "08:00",
      title: "출발",
    },
    {
      category: "event" as const,
      description: "첫 일정을 진행합니다.",
      stayDurationMinutes: 60,
      stopRef: "day-1-stop-2",
      time: "09:00",
      title: "첫 일정",
    },
    {
      category: "event" as const,
      description: "같은 장소에서 다음 일정을 진행합니다.",
      stayDurationMinutes: 30,
      stopRef: "day-1-stop-3",
      time: "10:00",
      title: "다음 일정",
    },
  ];

  itinerary.transportMode = "transit";
  itinerary.days = itinerary.days.slice(0, 1).map((day) => ({
    ...day,
    carryme: createStableRoute(day.carryme),
    carrymeTimeline: timeline,
    standard: createStableRoute(day.standard),
    standardTimeline: timeline,
    timeline,
  }));

  const finalized = await finalizeItineraryRoutes(itinerary, {
    computeTransitRoute: async (stops) =>
      createTransitProviderResult(stops, 600, "provider"),
  });

  assert.equal(finalized.days[0].standard.stops.length, 2);
  assert.equal(finalized.days[0].standardTimeline?.[1].time, "08:40");
  assert.equal(finalized.days[0].standardTimeline?.[2].time, "09:40");
}

/** Verifies browser edits cannot replace stored AI copy, Standard order, or timeline arrays. */
async function assertEditedItineraryPreservesAiFields() {
  const stored = createTestItinerary();
  const candidate = structuredClone(stored);

  candidate.title = "변조한 제목";
  candidate.days[0].timeline = [
    {
      category: "arrival",
      description: "변조한 시간표",
      time: "23:59",
      title: "변조 이벤트",
    },
  ];
  candidate.days[0].standard.stops.reverse();
  candidate.days[0].carryme.stops.reverse();
  candidate.transportMode = "transit";

  const validated = await validateEditedItineraryPlaces(
    candidate,
    stored,
    new AbortController().signal,
  );

  assert.equal(validated.title, stored.title);
  assert.equal(serializeTimelines(validated), serializeTimelines(stored));
  assert.deepEqual(validated.days[0].standard.stops, stored.days[0].standard.stops);
  assert.equal(
    validated.days[0].carryme.stops[0].placeSourceRef,
    stored.days[0].carryme.stops[1].placeSourceRef,
  );
  assert.equal(validated.transportMode, "transit");
}

/** Verifies a missing AI stop is resolved once and reused across comparison routes. */
async function assertMissingCoordinatesUseRepresentativeNaverCandidate() {
  const originalClientId = process.env.NAVER_SEARCH_CLIENT_ID;
  const originalClientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET;
  const originalFetch = globalThis.fetch;
  const itinerary = createTestItinerary();
  let searchCalls = 0;

  itinerary.days[0].standard.stops[1] = {
    ...itinerary.days[0].standard.stops[1],
    coordinate: undefined,
    placeSourceRef: undefined,
  };
  itinerary.days[0].carryme.stops[1] = {
    ...itinerary.days[0].carryme.stops[1],
    coordinate: undefined,
    placeSourceRef: undefined,
  };

  try {
    process.env.NAVER_SEARCH_CLIENT_ID = "test-search-id";
    process.env.NAVER_SEARCH_CLIENT_SECRET = "test-search-secret";
    globalThis.fetch = async () => {
      searchCalls += 1;
      return new Response(
        JSON.stringify({
          items: [
            {
              mapx: "1271100000",
              mapy: "372100000",
              roadAddress: "경기도 화성시 테스트로 1",
              title: "<b>대표 방문지</b>",
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    };

    const finalized = await finalizeItineraryRoutes(itinerary, {
      computeDriveRoute: async (stops) => createProviderResult(stops, 600),
    });
    const standardStop = finalized.days[0].standard.stops[1];
    const carrymeStop = finalized.days[0].carryme.stops[1];

    assert.equal(searchCalls, 1);
    assert.deepEqual(standardStop.coordinate, { lat: 37.21, lng: 127.11 });
    assert.deepEqual(carrymeStop.coordinate, standardStop.coordinate);
    assert.equal(standardStop.label, "대표 방문지");
    assert.equal(carrymeStop.placeSourceRef, standardStop.placeSourceRef);
  } finally {
    globalThis.fetch = originalFetch;

    if (originalClientId === undefined) {
      delete process.env.NAVER_SEARCH_CLIENT_ID;
    } else {
      process.env.NAVER_SEARCH_CLIENT_ID = originalClientId;
    }

    if (originalClientSecret === undefined) {
      delete process.env.NAVER_SEARCH_CLIENT_SECRET;
    } else {
      process.env.NAVER_SEARCH_CLIENT_SECRET = originalClientSecret;
    }
  }
}

/** Verifies a transient failed Naver leg is retried once without rerunning other routes. */
async function assertFailedProviderLegRetriesOnce() {
  const originalClientId = process.env.NAVER_MAPS_CLIENT_ID;
  const originalClientSecret = process.env.NAVER_MAPS_CLIENT_SECRET;
  const originalFetch = globalThis.fetch;
  let requestCount = 0;

  try {
    process.env.NAVER_MAPS_CLIENT_ID = "test-client-id";
    process.env.NAVER_MAPS_CLIENT_SECRET = "test-client-secret";
    globalThis.fetch = async () => {
      requestCount += 1;

      if (requestCount === 1) {
        return new Response("temporary failure", { status: 503 });
      }

      return new Response(
        JSON.stringify({
          route: {
            trafast: [
              {
                path: [
                  [127.1, 37.2],
                  [127.105, 37.205],
                  [127.11, 37.21],
                ],
                summary: { distance: 1_000, duration: 600_000 },
              },
            ],
          },
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    };

    const result = await computeNaverDirectionsRoute(
      [
        {
          coordinate: { lat: 37.2, lng: 127.1 },
          id: "retry-origin",
          label: "출발지",
        },
        {
          coordinate: { lat: 37.21, lng: 127.11 },
          id: "retry-destination",
          label: "도착지",
        },
      ],
      new AbortController().signal,
    );

    assert.equal(requestCount, 2);
    assert.equal(result.totalDurationSeconds, 600);

    requestCount = 0;
    globalThis.fetch = async () => {
      requestCount += 1;
      return new Response("temporary failure", { status: 503 });
    };

    await assert.rejects(
      () =>
        computeNaverDirectionsRoute(
          [
            {
              coordinate: { lat: 37.2, lng: 127.1 },
              id: "retry-failure-origin",
              label: "출발지",
            },
            {
              coordinate: { lat: 37.21, lng: 127.11 },
              id: "retry-failure-destination",
              label: "도착지",
            },
          ],
          new AbortController().signal,
        ),
      (error) =>
        error instanceof RouteProviderError &&
        error.code === "NAVER_HTTP_503" &&
        error.retried,
    );
    assert.equal(requestCount, 2);
  } finally {
    globalThis.fetch = originalFetch;

    if (originalClientId === undefined) {
      delete process.env.NAVER_MAPS_CLIENT_ID;
    } else {
      process.env.NAVER_MAPS_CLIENT_ID = originalClientId;
    }

    if (originalClientSecret === undefined) {
      delete process.env.NAVER_MAPS_CLIENT_SECRET;
    } else {
      process.env.NAVER_MAPS_CLIENT_SECRET = originalClientSecret;
    }
  }
}

/** Creates a deterministic two-day comparison itinerary for pure server tests. */
function createTestItinerary(): PlanmeItinerary {
  const createRoute = (id: RoutePlan["id"], day: number): RoutePlan => ({
    id,
    label: id === "standard" ? "Standard" : "CarryME",
    badge: id === "standard" ? "Standard" : "CarryME",
    routeText: "출발지 → 방문지",
    description: "테스트 경로",
    durationLabel: "AI 예상값",
    durationMinutes: 999,
    stops: [
      {
        label: "출발지",
        caption: "출발",
        coordinate: { lat: 37.2 + day * 0.01, lng: 127.1 },
        icon: "station",
        mode: "drive",
        placeSourceRef: `start-${day}`,
        role: "출발지",
      },
      {
        label: "방문지",
        caption: "방문",
        coordinate: { lat: 37.21 + day * 0.01, lng: 127.11 },
        icon: "attraction",
        mode: "drive",
        placeSourceRef: `end-${day}`,
        role: "방문지",
      },
    ],
    mapPath: [],
  });

  return {
    id: "generated-finalization-contract",
    title: "PlanME 최종화 계약 테스트",
    region: "동탄",
    duration: "1박 2일",
    summary: "서버 최종화 테스트",
    detailUrl: "/itinerary/generated-finalization-contract",
    carrymeSaving: "AI 예상값",
    totalDurationLabel: "AI 예상값",
    savedDurationLabel: "AI 예상값",
    transportMode: "drive",
    days: [1, 2].map((day) => ({
      day,
      label: `Day ${day}`,
      savingMinutes: 0,
      standard: createRoute("standard", day),
      carryme: createRoute("carryme", day),
      timeline: [
        {
          time: "10:00",
          title: `${day}일차 출발`,
          description: "AI 시간표",
          category: "arrival",
        },
      ],
    })),
    benefits: [],
  };
}

/** Produces one provider path without a duplicate flattened geoPath. */
function createProviderResult(
  stops: RouteProviderStop[],
  durationSeconds: number,
): RouteProviderResult {
  const coordinates = stops
    .map((stop) => stop.coordinate)
    .filter((coordinate): coordinate is MapCoordinate => Boolean(coordinate));
  const origin = coordinates[0];
  const destination = coordinates[coordinates.length - 1];
  const midpoint = {
    lat: (origin.lat + destination.lat) / 2,
    lng: (origin.lng + destination.lng) / 2,
  };
  const paths = [[origin, midpoint, destination]];

  return {
    geometryStatus: "complete" as const,
    segments: [
      {
        distanceMeters: 1_000,
        durationSource: "provider",
        durationSeconds,
        geometryStatus: "complete" as const,
        mode: "drive" as const,
        paths,
      },
    ],
    totalDistanceMeters: 1_000,
    totalDurationSeconds: durationSeconds,
    transitMarkers: [],
  };
}

function createTransitProviderResult(
  stops: RouteProviderStop[],
  durationSeconds: number,
  durationSource: "estimated" | "provider",
): RouteProviderResult {
  const result = createProviderResult(stops, durationSeconds);

  return {
    ...result,
    segments: result.segments.map((segment) => ({
      ...segment,
      durationSource,
      mode: "transit",
    })),
  };
}

/** Serializes only the AI-authored timeline fields protected by the product contract. */
function serializeTimelines(itinerary: PlanmeItinerary) {
  return JSON.stringify(
    itinerary.days.map((day) => ({
      carrymeTimeline: day.carrymeTimeline,
      standardTimeline: day.standardTimeline,
      timeline: day.timeline,
    })),
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "PlanME finalization test failed");
  process.exitCode = 1;
});
