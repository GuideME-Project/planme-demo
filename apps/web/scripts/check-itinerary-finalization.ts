import assert from "node:assert/strict";
import type {
  MapCoordinate,
  PlanmeItinerary,
  RoutePlan,
} from "@planme/core";
import {
  RouteFinalizationTimeoutError,
  finalizeItineraryRoutes,
} from "../lib/itinerary-route-finalizer";
import { validateEditedItineraryPlaces } from "../lib/edited-itinerary-validator";
import { computeNaverDirectionsRoute } from "../lib/route-providers/naver-directions";
import type {
  RouteProviderResult,
  RouteProviderStop,
} from "../lib/route-providers/types";

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
  await assertMissingCoordinatesUseRepresentativeNaverCandidate();
  await assertEditedItineraryPreservesAiFields();
  await assertDuplicateOnlyRouteNeedsNoProviderCall();

  let providerCalls = 0;
  await assert.rejects(
    () =>
      finalizeItineraryRoutes(itinerary, {
        computeDriveRoute: async (stops) => {
          providerCalls += 1;

          if (providerCalls === 2) {
            throw new Error("provider segment failed");
          }

          return createProviderResult(stops, 600);
        },
      }),
    /provider segment failed/,
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
function createProviderResult(stops: RouteProviderStop[], durationSeconds: number) {
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
