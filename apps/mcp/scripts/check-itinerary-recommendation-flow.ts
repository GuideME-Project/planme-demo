import assert from "node:assert/strict";
import {
  createAiRecommendedItineraryResponse,
  isPlanmeClarificationResponse,
  toGptActionItineraryResponse,
  type PlanmeItinerary,
  type RecommendItineraryRequest,
} from "@planme/core";
import {
  recommendAndPersistItinerary,
  type TransitPreflightResult,
} from "../src/itinerary-recommendation-flow.js";
import { PreviewStoreHandoffError } from "../src/preview-store-handoff-error.js";

const requestUrl = "http://localhost:3000/api/gpt/itineraries/recommend";
const request: RecommendItineraryRequest = {
  destination: "남해",
  destinationType: "region",
  durationDays: 2,
  origin: "강동역",
  transportMode: "transit",
};

async function main() {
  await assertCorePlaceIntentContract();
  await assertLegacyOmissionDefaultsToRegion();
  await assertReplacementCandidatesAndSingleStore();
  await assertCandidateExhaustionRemovesOnlyAiStop();
  await assertFixedPlaceBecomesClarification();
  await assertNoVisitPlaceDoesNotPersist();
  await assertOffModeSkipsPreflight();
  await assertFinalStoreRepairSafetyRunsOnce();
  console.log("PlanME shared recommendation flow contract passed");
}

async function assertLegacyOmissionDefaultsToRegion() {
  let capturedDestinationType: RecommendItineraryRequest["destinationType"];
  const legacyRequest = { ...request };
  delete legacyRequest.destinationType;
  const result = await recommendAndPersistItinerary(
    requestUrl,
    legacyRequest,
    "00000000-0000-4000-8000-000000000200",
    {
      generate: async (_currentRequestUrl, input) => {
        capturedDestinationType = input.destinationType;
        return createGeneratedResponse(createFlowItinerary())();
      },
      mode: "off",
      persist: async (itinerary) => ({ itinerary }),
    },
  );

  assert.equal(result.status, "ready");
  assert.equal(capturedDestinationType, "region");
}

async function assertFinalStoreRepairSafetyRunsOnce() {
  let persistCalls = 0;
  let preflightCalls = 0;
  const result = await recommendAndPersistItinerary(
    requestUrl,
    request,
    "00000000-0000-4000-8000-000000000206",
    {
      generate: createGeneratedResponse(createFlowItinerary()),
      mode: "on",
      persist: async (candidate, traceId) => {
        persistCalls += 1;

        if (persistCalls === 1) {
          throw new PreviewStoreHandoffError(traceId, "ROUTE_REPAIR_REQUIRED", 422, {
            code: "TRANSIT_PLACE_REPLACEMENT_REQUIRED",
            context: {
              dayIndex: 0,
              placeConstraint: "replaceable",
              reason: "destination_station_missing",
              routeId: "standard",
              segmentIndex: 0,
              stopRef: "day-1-stop-2",
            },
          });
        }

        return { itinerary: candidate };
      },
      preflight: async () => {
        preflightCalls += 1;
        return { estimatedSegmentCount: 0, status: "accessible" };
      },
      replacementOptions: {
        placeCandidateSearcher: async ({ query }) => ({
          candidates: [
            {
              candidateId: "safety-candidate",
              coordinate: { lat: 34.82, lng: 128.06 },
              id: "safety-candidate",
              name: query ?? "안전장치 대체 장소",
              source: "naver_local",
              sourceRef: "naver_local:safety-candidate",
            },
          ],
          searchedQueries: query ? [query] : [],
        }),
        replacementQuerySuggester: async () => "안전장치 대체 장소",
      },
    },
  );

  assert.equal(result.status, "ready");
  assert.equal(preflightCalls, 2);
  assert.equal(persistCalls, 2);
}

async function assertCorePlaceIntentContract() {
  const createCandidate = (name: string, index: number) => ({
    candidateId: `naver_local:${name}`,
    coordinate: { lat: 34.8 + index * 0.001, lng: 128.04 + index * 0.001 },
    id: `candidate-${index}`,
    name,
    query: name,
    source: "naver_local" as const,
    sourceRef: `naver_local:${name}`,
  });
  const placeCandidateSearcher = async ({ query, stop }: {
    query?: string;
    stop: { name: string };
  }) => {
    const name = query?.trim() || stop.name;

    return {
      candidates: [createCandidate(name, name.length)],
      searchedQueries: [name],
    };
  };
  const draftGeocoder = async ({ query }: { query: string }) => ({
    coordinate: { lat: 37.535, lng: 127.123 },
    placeSource: "naver_geocode" as const,
    placeSourceRef: `naver_geocode:${query}`,
  });
  const createDraft = (includeFixedPlaces: boolean) => {
    const visits = includeFixedPlaces
      ? [
          { name: "남해독일마을", requiredPlaceKind: "destination" as const },
          { name: "보리암", requiredPlaceKind: "must_visit" as const },
        ]
      : [{ name: "원예예술촌" }];
    const stops = [
      { name: "강동역", requiredPlaceKind: "origin" as const, role: "출발지" as const },
      ...visits.map((visit) => ({ ...visit, role: "방문지" as const })),
      { name: "강동역", requiredPlaceKind: "origin" as const, role: "복귀지" as const },
    ].map((stop, index) => ({
      ...stop,
      caption: stop.role === "출발지" ? "출발" : stop.role === "복귀지" ? "복귀" : "방문",
      coordinate: { lat: 34.8 + index * 0.001, lng: 128.04 + index * 0.001 },
      mode: "transit" as const,
      placeSource: "naver_local" as const,
      placeSourceRef: `naver_local:${stop.name}`,
    }));
    const timeline = stops.map((stop, index) => ({
      category: index === 0 ? "arrival" as const : "event" as const,
      description: `${stop.name} 일정`,
      stayDurationMinutes: index === 0 ? 0 : 60,
      stopIndex: index,
      time: `${String(8 + index).padStart(2, "0")}:00`,
      title: stop.name,
    }));

    return {
      days: [
        {
          carrymeDurationMinutes: 300,
          carrymeStops: structuredClone(stops),
          carrymeTimeline: structuredClone(timeline),
          day: 1,
          label: "Day 1",
          standardDurationMinutes: 330,
          standardStops: structuredClone(stops),
          standardTimeline: structuredClone(timeline),
        },
      ],
      duration: "1박 2일",
      origin: "강동역",
      region: "남해",
      savedMinutes: 30,
      summary: "장소 의도 계약 테스트",
      title: "남해 일정",
      transportMode: "transit" as const,
    };
  };
  const commonOptions = {
    accommodationCandidateSearcher: async () => [],
    draftGeocoder,
    placeCandidateSearcher,
  };
  const regionResponse = await createAiRecommendedItineraryResponse(
    requestUrl,
    { ...request, destinationType: "region" },
    {
      ...commonOptions,
      aiItineraryGenerator: async () => createDraft(false),
    },
  );

  assert.equal(isPlanmeClarificationResponse(regionResponse), false);

  if (!isPlanmeClarificationResponse(regionResponse)) {
    const regionStops = regionResponse.itinerary.days[0].standard.stops;
    assert.equal(regionStops.some((stop) => stop.label === "남해"), false);
    assert.equal(
      regionStops.find((stop) => stop.label === "원예예술촌")?.placeConstraint,
      "replaceable",
    );
  }

  const misclassifiedRegionResponse = await createAiRecommendedItineraryResponse(
    requestUrl,
    { ...request, destinationType: "region" },
    {
      ...commonOptions,
      aiItineraryGenerator: async () => {
        const draft = createDraft(false);
        const removeHardGate = (stops: typeof draft.days[number]["standardStops"]) =>
          stops?.map((stop) =>
            stop.role === "방문지"
              ? {
                  ...stop,
                  coordinate: undefined,
                  placeSource: undefined,
                  placeSourceRef: undefined,
                  requiredPlaceKind: "destination" as const,
                }
              : stop,
          );

        return {
          ...draft,
          days: draft.days.map((day) => ({
            ...day,
            carrymeStops: removeHardGate(day.carrymeStops),
            standardStops: removeHardGate(day.standardStops),
          })),
        };
      },
    },
  );

  assert.equal(isPlanmeClarificationResponse(misclassifiedRegionResponse), false);

  if (!isPlanmeClarificationResponse(misclassifiedRegionResponse)) {
    assert.equal(
      misclassifiedRegionResponse.itinerary.days[0].standard.stops.find(
        (stop) => stop.label === "원예예술촌",
      )?.placeConstraint,
      "replaceable",
    );
  }

  const fixedResponse = await createAiRecommendedItineraryResponse(
    requestUrl,
    {
      ...request,
      destination: "남해독일마을",
      destinationType: "place",
      mustVisitPlaces: ["보리암"],
    },
    {
      ...commonOptions,
      aiItineraryGenerator: async () => createDraft(true),
    },
  );

  assert.equal(isPlanmeClarificationResponse(fixedResponse), false);

  if (!isPlanmeClarificationResponse(fixedResponse)) {
    const fixedStops = fixedResponse.itinerary.days[0].standard.stops;
    assert.equal(
      fixedStops.find((stop) => stop.label === "남해독일마을")?.placeConstraint,
      "fixed",
    );
    assert.equal(
      fixedStops.find((stop) => stop.label === "보리암")?.placeConstraint,
      "fixed",
    );
  }
}

async function assertReplacementCandidatesAndSingleStore() {
  const itinerary = createFlowItinerary();
  let preflightCalls = 0;
  let persistCalls = 0;
  let replacementQueries = 0;
  const result = await recommendAndPersistItinerary(
    requestUrl,
    request,
    "00000000-0000-4000-8000-000000000201",
    {
      generate: createGeneratedResponse(itinerary),
      mode: "on",
      persist: async (candidate) => {
        persistCalls += 1;
        return { itinerary: candidate };
      },
      preflight: async (): Promise<TransitPreflightResult> => {
        preflightCalls += 1;
        return preflightCalls < 3
          ? createReplacementDecision("day-1-stop-2")
          : { estimatedSegmentCount: 0, status: "accessible" };
      },
      replacementOptions: {
        placeCandidateSearcher: async ({ query, stop }) => ({
          candidates: [
            {
              candidateId: `naver_local:${query}`,
              coordinate: {
                lat: (stop.coordinate?.lat ?? 34.8) + replacementQueries * 0.001,
                lng: (stop.coordinate?.lng ?? 128.0) + replacementQueries * 0.001,
              },
              id: `candidate-${replacementQueries}`,
              name: query ?? "대체 장소",
              query,
              source: "naver_local",
              sourceRef: `naver_local:replacement-${replacementQueries}`,
            },
          ],
          searchedQueries: query ? [query] : [],
        }),
        replacementQuerySuggester: async ({ attempt }) => {
          replacementQueries += 1;
          return `대체 장소 ${attempt}`;
        },
      },
    },
  );

  assert.equal(result.status, "ready");
  assert.equal(preflightCalls, 3);
  assert.equal(replacementQueries, 2);
  assert.equal(persistCalls, 1);

  if (result.status === "ready") {
    const replacedStops = result.response.itinerary.days[0].standard.stops.filter(
      (stop) => stop.stopRef === "day-1-stop-2",
    );
    assert.equal(replacedStops[0]?.label, "대체 장소 2");
    assert.equal(replacedStops[0]?.placeConstraint, "replaceable");
  }
}

async function assertCandidateExhaustionRemovesOnlyAiStop() {
  const itinerary = createFlowItinerary();
  let preflightCalls = 0;
  let persistCalls = 0;
  let replacementAttempts = 0;
  const result = await recommendAndPersistItinerary(
    requestUrl,
    request,
    "00000000-0000-4000-8000-000000000202",
    {
      generate: createGeneratedResponse(itinerary),
      mode: "on",
      persist: async (candidate) => {
        persistCalls += 1;
        return { itinerary: candidate };
      },
      preflight: async () => {
        preflightCalls += 1;
        return preflightCalls === 1
          ? createReplacementDecision("day-1-stop-2")
          : { estimatedSegmentCount: 0, status: "accessible" as const };
      },
      replacementOptions: {
        replacementQuerySuggester: async () => {
          replacementAttempts += 1;
          return null;
        },
      },
    },
  );

  assert.equal(result.status, "ready");
  assert.equal(replacementAttempts, 3);
  assert.equal(preflightCalls, 2);
  assert.equal(persistCalls, 1);

  if (result.status === "ready") {
    assert.equal(
      result.response.itinerary.days[0].standard.stops.some(
        (stop) => stop.stopRef === "day-1-stop-2",
      ),
      false,
    );
    assert.equal(
      result.response.itinerary.days[0].standard.stops.some(
        (stop) => stop.stopRef === "day-1-stop-3",
      ),
      true,
    );
    assert.equal(
      result.response.itinerary.days[0].timeline.some(
        (event) => event.title === "자유시간" && event.stopRef === undefined,
      ),
      true,
    );
  }
}

async function assertFixedPlaceBecomesClarification() {
  const itinerary = createFlowItinerary();
  itinerary.days[0].standard.stops[2].placeConstraint = "fixed";
  itinerary.days[0].carryme.stops[2].placeConstraint = "fixed";
  let persistCalls = 0;
  const result = await recommendAndPersistItinerary(
    requestUrl,
    request,
    "00000000-0000-4000-8000-000000000203",
    {
      generate: createGeneratedResponse(itinerary),
      mode: "on",
      persist: async (candidate) => {
        persistCalls += 1;
        return { itinerary: candidate };
      },
      preflight: async () => ({
        context: {
          dayIndex: 0,
          placeConstraint: "fixed",
          reason: "walk_limit_exceeded",
          routeId: "standard",
          segmentIndex: 1,
          stopRef: "day-1-stop-3",
        },
        status: "confirmation_required",
      }),
    },
  );

  assert.equal(result.status, "needs_clarification");
  assert.equal(persistCalls, 0);
}

async function assertNoVisitPlaceDoesNotPersist() {
  const itinerary = createFlowItinerary();
  itinerary.days[0].standard.stops = itinerary.days[0].standard.stops.filter(
    (stop) => stop.stopRef !== "day-1-stop-3",
  );
  itinerary.days[0].carryme.stops = itinerary.days[0].carryme.stops.filter(
    (stop) => stop.stopRef !== "day-1-stop-3",
  );
  let persistCalls = 0;
  const result = await recommendAndPersistItinerary(
    requestUrl,
    request,
    "00000000-0000-4000-8000-000000000204",
    {
      generate: createGeneratedResponse(itinerary),
      mode: "on",
      persist: async (candidate) => {
        persistCalls += 1;
        return { itinerary: candidate };
      },
      preflight: async () => createReplacementDecision("day-1-stop-2"),
      replacementOptions: {
        replacementQuerySuggester: async () => null,
      },
    },
  );

  assert.equal(result.status, "needs_clarification");
  assert.equal(persistCalls, 0);
}

async function assertOffModeSkipsPreflight() {
  let preflightCalls = 0;
  let persistCalls = 0;
  const result = await recommendAndPersistItinerary(
    requestUrl,
    request,
    "00000000-0000-4000-8000-000000000205",
    {
      generate: createGeneratedResponse(createFlowItinerary()),
      mode: "off",
      persist: async (candidate) => {
        persistCalls += 1;
        return { itinerary: candidate };
      },
      preflight: async () => {
        preflightCalls += 1;
        return { estimatedSegmentCount: 0, status: "accessible" };
      },
    },
  );

  assert.equal(result.status, "ready");
  assert.equal(preflightCalls, 0);
  assert.equal(persistCalls, 1);
}

function createGeneratedResponse(itinerary: PlanmeItinerary) {
  return async () => ({
    ...toGptActionItineraryResponse(itinerary, requestUrl),
    itinerary,
  });
}

function createReplacementDecision(stopRef: string): TransitPreflightResult {
  return {
    context: {
      dayIndex: 0,
      placeConstraint: "replaceable",
      reason: "destination_station_missing",
      routeId: "standard",
      segmentIndex: 0,
      stopRef,
    },
    status: "replacement_required",
  };
}

function createFlowItinerary(): PlanmeItinerary {
  const stops = [
    createStop("강동역", "day-1-stop-1", "fixed", "출발지", 37.535, 127.123),
    createStop("AI 장소 A", "day-1-stop-2", "replaceable", "방문지", 34.8, 128.04),
    createStop("AI 장소 B", "day-1-stop-3", "replaceable", "방문지", 34.81, 128.05),
    createStop("강동역", "day-1-stop-1", "fixed", "복귀지", 37.535, 127.123),
  ];
  const timeline = stops.map((stop, index) => ({
    category: index === 0 ? "arrival" as const : "event" as const,
    description: `${stop.label} 일정`,
    stayDurationMinutes: index === 0 ? 0 : 60,
    stopRef: stop.stopRef,
    time: `${String(8 + index).padStart(2, "0")}:00`,
    title: stop.label,
  }));
  const createRoute = (id: "carryme" | "standard") => ({
    badge: id === "standard" ? "Standard" : "CarryME",
    description: "테스트 경로",
    durationLabel: "5시간",
    durationMinutes: 300,
    id,
    label: id === "standard" ? "Standard" : "CarryME",
    mapPath: [],
    routeText: stops.map((stop) => stop.label).join(" → "),
    stops: structuredClone(stops),
  });

  return {
    benefits: [],
    carrymeSaving: "30분 절약",
    days: [
      {
        carryme: createRoute("carryme"),
        carrymeTimeline: structuredClone(timeline),
        day: 1,
        label: "Day 1",
        savingMinutes: 30,
        standard: createRoute("standard"),
        standardTimeline: structuredClone(timeline),
        timeline,
      },
    ],
    detailUrl: "/itinerary/flow-test",
    duration: "1박 2일",
    id: "flow-test",
    region: "남해",
    savedDurationLabel: "30분 절약",
    summary: "공통 흐름 테스트",
    title: "남해 일정",
    totalDurationLabel: "5시간 30분 → 5시간",
    transportMode: "transit",
  };
}

function createStop(
  label: string,
  stopRef: string,
  placeConstraint: "fixed" | "replaceable",
  role: "복귀지" | "방문지" | "출발지",
  lat: number,
  lng: number,
) {
  return {
    caption: role === "출발지" ? "출발" : role === "복귀지" ? "복귀" : "방문",
    coordinate: { lat, lng },
    icon: role === "방문지" ? "event" as const : "station" as const,
    label,
    mode: "transit" as const,
    placeConstraint,
    placeSource: "naver_local" as const,
    placeSourceRef: `naver_local:${label}`,
    role,
    stopRef,
  };
}

await main();
