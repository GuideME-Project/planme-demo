import { once } from "node:events";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  assessPlanmePlanningInput,
  createAiRecommendedItineraryResponse as createCoreAiRecommendedItineraryResponse,
  createGeneratedItinerary,
  createPlanmeDraftPreview,
  decidePlanmePlaceCandidateWithOpenAi,
  generatePlanmeDraftWithOpenAi,
  isPlanmeClarificationResponse,
  getPlanmeItineraryById,
  PLANME_EXTERNAL_DURATION_ERROR_MESSAGE,
  PLANME_EXTERNAL_MAX_DURATION_DAYS,
  PlanmeOpenAiError,
  resolvePlanmeDraftCoordinates,
  searchAccommodationCandidates,
  searchPlanmePlaceCandidates,
  selectPlanmeRequiredPlaceCandidate,
  toGptActionItineraryResponse,
  type GptActionItineraryResponse,
  type AiRecommendedItineraryOptions,
  type PlanmeDraftGeocoder,
  type PlanmeItinerary,
  type PlanmeRecommendationResponse,
  type RecommendItineraryRequest,
  type RouteStop,
} from "@planme/core";
import { createNaverGeocoder } from "../src/naver-geocoding.js";
import {
  persistItineraryForDetailPage,
  PreviewStoreHandoffError,
} from "../src/planme-mcp.js";
import { createPlanmeHttpServer } from "../src/server.js";
import {
  clearMemoryUsageCounters,
  createPlanmeUsageRecorder,
  readMemoryUsageCounter,
} from "../src/usage-counters.js";
import {
  handleGptsOpenApiRequest,
  handleGptsPlanningStartRequest,
  handleGptsRecommendItineraryRequest,
  toGptsRestRecommendationResponse,
} from "../src/gpts-actions-api.js";

type RecommendationContent = {
  carrymeTotalMinutes?: number;
  days?: GptActionItineraryResponse["days"];
  itineraryId?: string;
  pageUrl?: string;
  questions?: string[];
  savingStatus?: "verified" | "hidden_estimated";
  standardTotalMinutes?: number;
  status?: "ready" | "needs_clarification";
  summary?: string;
  title?: string;
  savedMinutes?: number;
  timeline?: Array<{
    title?: string;
  }>;
  transportMode?: "drive" | "transit";
  unresolvedStops?: string[];
  validationIssues?: string[];
};

type SharedRecommendationContract = Omit<
  Pick<
    RecommendationContent,
    | "carrymeTotalMinutes"
    | "days"
    | "itineraryId"
    | "pageUrl"
    | "savedMinutes"
    | "savingStatus"
    | "standardTotalMinutes"
    | "status"
    | "summary"
    | "title"
    | "transportMode"
    | "validationIssues"
  >,
  "status"
> & {
  status?: string;
};

/** Selects the fields that GPTs Actions and Apps must expose identically. */
function toSharedRecommendationContract(
  source: SharedRecommendationContract,
): SharedRecommendationContract {
  return {
    carrymeTotalMinutes: source.carrymeTotalMinutes,
    days: source.days,
    itineraryId: source.itineraryId,
    pageUrl: source.pageUrl,
    savedMinutes: source.savedMinutes,
    savingStatus: source.savingStatus,
    standardTotalMinutes: source.standardTotalMinutes,
    status: source.status,
    summary: source.summary,
    title: source.title,
    transportMode: source.transportMode,
    validationIssues: source.validationIssues,
  };
}

type PlanningContent = {
  status?: "needs_input" | "ready";
  missingSlots?: string[];
  nextAction?: "ask_user" | "recommend_planme_itinerary";
  normalizedInput?: {
    destinationType?: "region" | "place" | null;
    transportMode?: "drive" | "transit" | null;
  };
  questions?: Array<{
    slot?: string;
    text?: string;
  }>;
};

type PlanmeWidgetResourceMeta = {
  ui?: {
    csp?: {
      connectDomains?: string[];
      frameDomains?: string[];
      resourceDomains?: string[];
    };
  };
  "openai/widgetCSP"?: {
    connect_domains?: string[];
    frame_domains?: string[];
    redirect_domains?: string[];
    resource_domains?: string[];
  };
};

/**
 * Narrows the recommendation union to the ready itinerary branch for existing assertions.
 */
function assertReadyRecommendation(
  response: PlanmeRecommendationResponse,
): asserts response is GptActionItineraryResponse {
  assert.equal(
    isPlanmeClarificationResponse(response),
    false,
    `Expected ready itinerary response, got ${JSON.stringify(response)}`,
  );
}

/** Verifies model-facing totals and day summaries use the complete itinerary contract. */
function assertGptActionMultiDayResponseContract(): void {
  const itinerary = createGptActionMultiDayFixture();
  const response = toGptActionItineraryResponse(
    itinerary,
    "https://planme.example/api/gpt/itineraries/recommend",
  );

  assert.equal(response.standardTotalMinutes, 540);
  assert.equal(response.carrymeTotalMinutes, 470);
  assert.equal(response.savingStatus, "verified");
  assert.equal(response.savedMinutes, 70);
  assert.equal(response.summary, "약 70분 절약");
  assert.equal(response.days.length, 2);
  assert.deepEqual(response.days[0], {
    carryme: {
      durationMinutes: 260,
      end: "부산 숙소",
      endTime: "17:00",
      start: "동탄",
      startTime: "08:00",
    },
    day: 1,
    isFinalDay: false,
    label: "Day 1",
    luggageDelivery: {
      target: "부산 숙소",
      targetRole: "숙소",
      time: "16:00",
    },
    returnsToTripOrigin: false,
    sameEndpoints: true,
    savedMinutes: 40,
    savingStatus: "verified",
    standard: {
      durationMinutes: 300,
      end: "부산 숙소",
      endTime: "17:00",
      start: "동탄",
      startTime: "08:00",
    },
  });
  assert.deepEqual(response.days[1], {
    carryme: {
      durationMinutes: 210,
      end: "동탄",
      endTime: "19:00",
      start: "부산 숙소",
      startTime: "09:00",
    },
    day: 2,
    isFinalDay: true,
    label: "Day 2",
    luggageDelivery: {
      target: "동탄",
      targetRole: "복귀지",
      time: "18:00",
    },
    returnsToTripOrigin: true,
    sameEndpoints: true,
    savedMinutes: 30,
    savingStatus: "verified",
    standard: {
      durationMinutes: 240,
      end: "동탄",
      endTime: "19:00",
      start: "부산 숙소",
      startTime: "09:00",
    },
  });

  const hiddenResponse = toGptActionItineraryResponse(
    {
      ...itinerary,
      days: itinerary.days.map((day, index) =>
        index === 1 ? { ...day, savingMinutes: undefined, savingStatus: "hidden_estimated" } : day,
      ),
    },
    "https://planme.example/api/gpt/itineraries/recommend",
  );

  assert.equal(hiddenResponse.savingStatus, "hidden_estimated");
  assert.equal(hiddenResponse.savedMinutes, undefined);
  assert.equal(hiddenResponse.summary, "짐 없이 바로 이동 가능!");
  assert.doesNotMatch(hiddenResponse.summary, /\d+분.*절약/);
  assert.equal(hiddenResponse.days[0]?.savedMinutes, 40);
  assert.equal(hiddenResponse.days[1]?.savedMinutes, undefined);
  assert.equal(hiddenResponse.days[1]?.savingStatus, "hidden_estimated");

  const inferredHiddenResponse = toGptActionItineraryResponse(
    {
      ...itinerary,
      days: itinerary.days.map((day, index) =>
        index === 1
          ? {
              ...day,
              savingStatus: undefined,
              standard: { ...day.standard, durationSource: "estimated" },
            }
          : day,
      ),
    },
    "https://planme.example/api/gpt/itineraries/recommend",
  );

  assert.equal(inferredHiddenResponse.savingStatus, "hidden_estimated");
  assert.equal(inferredHiddenResponse.savedMinutes, undefined);
  assert.equal(inferredHiddenResponse.days[1]?.savingStatus, "hidden_estimated");

  const mismatchedEndpointResponse = toGptActionItineraryResponse(
    {
      ...itinerary,
      days: itinerary.days.map((day, index) =>
        index === 1
          ? {
              ...day,
              carryme: {
                ...day.carryme,
                routeText: "부산 숙소 → 부산 관광지",
                stops: day.carryme.stops.slice(0, -1),
              },
            }
          : day,
      ),
    },
    "https://planme.example/api/gpt/itineraries/recommend",
  );

  assert.equal(mismatchedEndpointResponse.savingStatus, "hidden_estimated");
  assert.equal(mismatchedEndpointResponse.savedMinutes, undefined);
  assert.equal(mismatchedEndpointResponse.days[1]?.sameEndpoints, false);
  assert.equal(mismatchedEndpointResponse.days[1]?.returnsToTripOrigin, false);
}

/** Verifies the public planning boundary without changing the internal draft limit. */
function assertExternalDurationBoundaryContract(): void {
  const unsupportedAssessment = assessPlanmePlanningInput({
    destination: "부산",
    durationDays: PLANME_EXTERNAL_MAX_DURATION_DAYS + 1,
    origin: "동탄",
    transportMode: "drive",
  });

  assert.equal(unsupportedAssessment.status, "needs_input");
  assert.equal(unsupportedAssessment.normalizedInput.durationDays, null);
  assert.deepEqual(unsupportedAssessment.missingSlots, ["durationDays"]);
  assert.equal(
    unsupportedAssessment.questions[0]?.text,
    PLANME_EXTERNAL_DURATION_ERROR_MESSAGE,
  );

  const legacyDraft = createPlanmeDraftPreview({
    days: Array.from({ length: 14 }, (_, index) => ({
      day: index + 1,
      label: `Day ${index + 1}`,
      stops: [{ name: `레거시 장소 ${index + 1}`, caption: "방문" }],
      timeline: [
        {
          category: "event" as const,
          description: "내부 14일 초안 호환성을 확인합니다.",
          time: "10:00",
          title: `레거시 일정 ${index + 1}`,
        },
      ],
    })),
    duration: "13박 14일",
    region: "레거시 테스트",
    summary: "외부 기간 제한과 내부 초안 상한을 분리합니다.",
    title: "내부 14일 초안",
    transportMode: "drive",
  });

  assert.equal(legacyDraft.itinerary.days.length, 14);
}

/** Creates a compact stable-contract itinerary without provider or network dependencies. */
function createGptActionMultiDayFixture(): PlanmeItinerary {
  const origin: RouteStop = {
    caption: "출발",
    icon: "station" as const,
    label: "동탄",
    placeRef: "place:origin",
    role: "출발지" as const,
    stopRef: "day-1-origin",
  };
  const lodging: RouteStop = {
    caption: "숙소",
    icon: "hotel" as const,
    label: "부산 숙소",
    placeRef: "place:lodging",
    role: "숙소" as const,
    stopRef: "day-1-lodging",
  };
  const returnOrigin: RouteStop = {
    ...origin,
    caption: "복귀",
    role: "복귀지" as const,
    stopRef: "day-2-origin-return",
  };
  const visit: RouteStop = {
    caption: "관광",
    icon: "event" as const,
    label: "부산 관광지",
    placeRef: "place:visit",
    role: "방문지" as const,
    stopRef: "visit",
  };
  const createRoute = (
    id: "standard" | "carryme",
    durationMinutes: number,
    stops: RouteStop[],
  ) => ({
    badge: id === "standard" ? "Standard" : "CarryME",
    description: `${id} 테스트 경로`,
    durationLabel: `약 ${durationMinutes}분`,
    durationMinutes,
    id,
    label: id === "standard" ? "Standard" : "CarryME",
    mapPath: [],
    routeText: stops.map((stop) => stop.label).join(" → "),
    stops,
  });

  return {
    benefits: [],
    carrymeSaving: "약 40분 절약",
    days: [
      {
        carryme: createRoute("carryme", 260, [origin, visit, lodging]),
        carrymeTimeline: [
          {
            category: "transit",
            description: "동탄에서 출발합니다.",
            eventKind: "traveler_stop",
            stopRef: origin.stopRef,
            time: "08:00",
            title: "동탄 출발",
          },
          {
            category: "carryme",
            deliverySourcePlaceRef: origin.placeRef,
            deliveryTargetPlaceRef: lodging.placeRef,
            deliveryTargetStopRef: lodging.stopRef,
            description: "짐은 여행자보다 먼저 숙소에 도착합니다.",
            eventKind: "luggage_delivery",
            time: "16:00",
            title: "짐 부산 숙소 도착",
          },
          {
            category: "hotel",
            description: "숙소에 도착합니다.",
            eventKind: "traveler_stop",
            stopRef: lodging.stopRef,
            time: "17:00",
            title: "부산 숙소 도착",
          },
        ],
        day: 1,
        label: "Day 1",
        savingMinutes: 40,
        savingStatus: "verified",
        standard: createRoute("standard", 300, [origin, visit, lodging]),
        standardTimeline: [
          {
            category: "transit",
            description: "동탄에서 출발합니다.",
            eventKind: "traveler_stop",
            stopRef: origin.stopRef,
            time: "08:00",
            title: "동탄 출발",
          },
          {
            category: "hotel",
            description: "숙소에 도착합니다.",
            eventKind: "traveler_stop",
            stopRef: lodging.stopRef,
            time: "17:00",
            title: "부산 숙소 도착",
          },
        ],
        timeline: [],
      },
      {
        carryme: createRoute("carryme", 210, [lodging, visit, returnOrigin]),
        carrymeTimeline: [
          {
            category: "transit",
            description: "숙소에서 출발합니다.",
            eventKind: "traveler_stop",
            stopRef: lodging.stopRef,
            time: "09:00",
            title: "부산 숙소 출발",
          },
          {
            category: "carryme",
            deliverySourcePlaceRef: lodging.placeRef,
            deliveryTargetPlaceRef: returnOrigin.placeRef,
            deliveryTargetStopRef: returnOrigin.stopRef,
            description: "짐은 여행자보다 먼저 출발지에 도착합니다.",
            eventKind: "luggage_delivery",
            time: "18:00",
            title: "짐 동탄 도착",
          },
          {
            category: "arrival",
            description: "최초 출발지에 도착합니다.",
            eventKind: "traveler_stop",
            stopRef: returnOrigin.stopRef,
            time: "19:00",
            title: "동탄 도착",
          },
        ],
        day: 2,
        label: "Day 2",
        savingMinutes: 30,
        savingStatus: "verified",
        standard: createRoute("standard", 240, [lodging, visit, returnOrigin]),
        standardTimeline: [
          {
            category: "transit",
            description: "숙소에서 출발합니다.",
            eventKind: "traveler_stop",
            stopRef: lodging.stopRef,
            time: "09:00",
            title: "부산 숙소 출발",
          },
          {
            category: "arrival",
            description: "최초 출발지에 도착합니다.",
            eventKind: "traveler_stop",
            stopRef: returnOrigin.stopRef,
            time: "19:00",
            title: "동탄 도착",
          },
        ],
        timeline: [],
      },
    ],
    detailUrl: "/itinerary/response-parity-test",
    duration: "1박 2일",
    id: "response-parity-test",
    region: "부산",
    savedDurationLabel: "약 40분 절약",
    summary: "동탄에서 부산을 여행하고 출발지로 복귀합니다.",
    title: "부산 1박 2일 여행",
    totalDurationLabel: "약 9시간 → 약 7시간 50분",
    transportMode: "drive",
  };
}

/**
 * Creates a provider-backed POI candidate for tests that expect ready itinerary links.
 */
function createMockNaverPlaceCandidate(name: string, index = 0) {
  const id = `naver-${name.replace(/\s+/g, "-").toLowerCase()}`;
  const coordinate = { lat: 34.75 + index * 0.01, lng: 127.9 + index * 0.01 };
  const sourceRef = `naver_local:${id}:${coordinate.lat.toFixed(6)}:${coordinate.lng.toFixed(6)}`;

  return {
    address: `경상남도 남해군 ${name}`,
    candidateId: sourceRef,
    coordinate,
    id,
    name,
    query: name,
    source: "naver_local" as const,
    sourceRef,
  };
}

/**
 * Supplies deterministic anchor-only geocoding so recommendation tests stay provider-free.
 */
function createAiRecommendedItineraryResponse(
  requestUrl: string,
  input: RecommendItineraryRequest,
  options: AiRecommendedItineraryOptions = {},
) {
  const anchorGeocoder: PlanmeDraftGeocoder = async ({ dayIndex, query }) => {
    if (dayIndex !== -1) {
      return null;
    }

    const coordinate = query.includes("양양")
      ? { lat: 38.0754, lng: 128.6191 }
      : query.includes("동탄")
        ? { lat: 37.2001, lng: 127.0951 }
        : { lat: 35.1796, lng: 129.0756 };

    return {
      coordinate,
      placeSource: "naver_geocode",
      placeSourceRef: `naver_geocode:${query}:${coordinate.lat.toFixed(6)}:${coordinate.lng.toFixed(6)}`,
    };
  };

  const testGeocoder: PlanmeDraftGeocoder = async (geocoderInput) => {
    const explicitResult = await options.draftGeocoder?.(geocoderInput);

    if (explicitResult) {
      if (geocoderInput.dayIndex !== -1 || explicitResult.placeSourceRef) {
        return explicitResult;
      }

      return {
        ...explicitResult,
        placeSource: explicitResult.placeSource ?? "naver_geocode",
        placeSourceRef: `naver_geocode:${geocoderInput.query}:${explicitResult.coordinate.lat.toFixed(6)}:${explicitResult.coordinate.lng.toFixed(6)}`,
      };
    }

    return anchorGeocoder(geocoderInput);
  };

  return createCoreAiRecommendedItineraryResponse(requestUrl, input, {
    ...options,
    draftGeocoder: testGeocoder,
  });
}

/**
 * Starts a local HTTP server for the GPTs Actions REST facade.
 */
async function startGptsActionsServer() {
  const server = createServer(async (request, response) => {
    if (request.url === "/api/gpt/openapi") {
      handleGptsOpenApiRequest(request, response);
      return;
    }

    if (request.url === "/api/gpt/planning/start") {
      await handleGptsPlanningStartRequest(request, response);
      return;
    }

    if (request.url === "/api/gpt/itineraries/recommend") {
      await handleGptsRecommendItineraryRequest(request, response);
      return;
    }

    // Keep the test server minimal while still surfacing accidental route mismatches.
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "not_found" }));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const addressInfo = address as AddressInfo;

  return {
    server,
    origin: `http://127.0.0.1:${addressInfo.port}`,
  };
}

/**
 * Verifies the OpenAI generator boundary without calling the real OpenAI API.
 */
async function assertOpenAiGeneratorContract(): Promise<void> {
  let capturedBody = "";
  let fetchCallCount = 0;
  const generatedDraft = await generatePlanmeDraftWithOpenAi(
    {
      destination: "남해 가족여행",
      durationDays: 2, transportMode: "drive",
      origin: "동탄",
      accommodationCandidates: [
        {
          id: "place-namhae-pension",
          name: "펜션 사랑가",
          address: "경상남도 남해군 남면 남면로 123",
          coordinate: { lat: 34.7601, lng: 127.9001 },
          placeId: "places/namhae-pension",
          types: ["lodging"],
        },
      ],
      preferences: ["아이 동반"],
      travelerCount: 4,
      luggageCount: 2,
    },
    {
      apiKey: "test-api-key",
      model: "test-model",
      fetchImpl: async (_url, init) => {
        fetchCallCount += 1;
        capturedBody = String(init?.body ?? "");

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              title: "남해 아이 동반 가족여행 1박 2일 초안",
              region: "남해",
              duration: "1박 2일",
              summary: "아이 동반 가족이 남해를 무리 없이 보는 일정입니다.",
              origin: "동탄",
              assumptions: ["동탄 출발", "아이 동반"],
              savedMinutes: 60,
              days: [
                {
                  day: 1,
                  label: "Day 1",
                  standardDurationMinutes: 420,
                  carrymeDurationMinutes: 360,
                  standardRouteText: "동탄 → 남해 숙소 → 남해 독일마을",
                  carrymeRouteText: "동탄 → 남해 독일마을 → 남해 숙소",
                  standardStops: [
                    {
                      name: "동탄",
                      caption: "출발",
                      role: "출발지",
                      mode: "transit",
                      addressQuery: "경기도 화성시 동탄역",
                    },
                    {
                      name: "남해 숙소",
                      caption: "숙소 도착",
                      role: "숙소",
                      mode: "transit",
                      addressQuery: "경상남도 남해군 남해 숙소",
                    },
                    {
                      name: "남해 독일마을",
                      caption: "관광",
                      role: "방문지",
                      mode: "transit",
                      addressQuery: "경상남도 남해군 삼동면 독일로 89-7 남해 독일마을",
                    },
                  ],
                  carrymeStops: [
                    {
                      name: "동탄",
                      caption: "출발",
                      role: "출발지",
                      mode: "transit",
                      addressQuery: "경기도 화성시 동탄역",
                    },
                    {
                      name: "남해 독일마을",
                      caption: "관광",
                      role: "방문지",
                      mode: "transit",
                      addressQuery: "경상남도 남해군 삼동면 독일로 89-7 남해 독일마을",
                    },
                    {
                      name: "남해 숙소",
                      caption: "숙소",
                      role: "숙소",
                      mode: "transit",
                      addressQuery: "경상남도 남해군 남해 숙소",
                    },
                  ],
                  standardTimeline: [
                    {
                      time: "09:00",
                      title: "동탄 출발",
                      description: "가족 여행을 시작합니다.",
                      category: "arrival",
                      highlight: false,
                      savingLabel: "",
                    },
                    {
                      time: "13:30",
                      title: "남해 숙소 도착",
                      description: "가족 여행 숙소에 먼저 도착합니다.",
                      category: "hotel",
                      highlight: false,
                      savingLabel: "",
                    },
                    {
                      time: "14:00",
                      title: "남해 독일마을 방문",
                      description: "아이와 함께 가볍게 둘러봅니다.",
                      category: "event",
                      highlight: true,
                      savingLabel: "약 60분 절약",
                    },
                  ],
                  carrymeTimeline: [
                    {
                      time: "09:00",
                      title: "동탄 출발",
                      description: "가족 여행을 시작합니다.",
                      category: "arrival",
                      highlight: false,
                      savingLabel: "",
                    },
                    {
                      time: "13:30",
                      title: "짐 숙소 도착",
                      description: "짐은 숙소에 도착하고 여행자는 바로 관광합니다.",
                      category: "hotel",
                      highlight: false,
                      savingLabel: "",
                    },
                    {
                      time: "14:00",
                      title: "남해 독일마을 방문",
                      description: "아이와 함께 가볍게 둘러봅니다.",
                      category: "event",
                      highlight: true,
                      savingLabel: "약 60분 절약",
                    },
                  ],
                },
              ],
            }),
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    },
  );

  assert.equal(generatedDraft.title, "남해 아이 동반 가족여행 1박 2일 초안");
  assert.equal(
    generatedDraft.days[0]?.standardStops?.[2]?.addressQuery,
    "경상남도 남해군 삼동면 독일로 89-7 남해 독일마을",
  );
  assert.equal(generatedDraft.days[0]?.carrymeTimeline?.[1]?.title, "짐 숙소 도착");
  assert.match(capturedBody, /json_schema/);
  assert.match(capturedBody, /planme_compact_itinerary_draft/);
  assert.match(capturedBody, /addressQuery/);
  assert.match(capturedBody, /days는 정확히 2개/);
  assert.match(capturedBody, /숙소, 출발지, 복귀지, 짐 배송, 이동 경로와 시각은 서버가 추가/);
  assert.doesNotMatch(capturedBody, /standardStops/);
  assert.doesNotMatch(capturedBody, /carrymeTimeline/);
  assert.doesNotMatch(capturedBody, /luggageDestination/);
  assert.match(capturedBody, /PLANME_OPENAI_MODEL|test-model/);
  assert.doesNotMatch(capturedBody, /test-api-key/);
  assert.equal(fetchCallCount, 1);
}

/** Verifies the production compact outline expands without a second OpenAI request. */
async function assertCompactOpenAiGeneratorContract(): Promise<void> {
  let capturedBody = "";
  let fetchCallCount = 0;
  const generatedDraft = await generatePlanmeDraftWithOpenAi(
    {
      accommodationCandidates: [
        {
          address: "부산광역시 해운대구 해운대해변로 209번가길 27",
          coordinate: { lat: 35.1601, lng: 129.1598 },
          id: "hotel-busan",
          name: "베이몬드호텔 해운대",
          types: ["숙박"],
        },
      ],
      destination: "부산",
      durationDays: 2,
      origin: "동탄",
      preferences: [],
      transportMode: "drive",
    },
    {
      apiKey: "test-api-key",
      model: "gpt-5.6-luna",
      fetchImpl: async (_url, init) => {
        fetchCallCount += 1;
        capturedBody = String(init?.body ?? "");

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              days: [
                {
                  visits: [
                    {
                      addressQuery: "부산 해운대해수욕장",
                      caption: "해변 산책",
                      name: "해운대해수욕장",
                      requiredPlaceKind: null,
                      stayDurationMinutes: 90,
                    },
                  ],
                },
                {
                  visits: [
                    {
                      addressQuery: "부산 감천문화마을",
                      caption: "마을 관람",
                      name: "감천문화마을",
                      requiredPlaceKind: null,
                      stayDurationMinutes: 90,
                    },
                  ],
                },
              ],
              summary: "부산 대표 명소를 둘러보는 일정입니다.",
              title: "동탄 출발 부산 2일 여행",
            }),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
    {
      requiredPlaces: {
        destinations: [],
        origin: {
          address: "경기도 화성시 동탄",
          coordinate: { lat: 37.2, lng: 127.1 },
          inputText: "동탄",
          kind: "origin",
          name: "동탄",
          source: "naver_geocode",
          sourceRef: "naver_geocode:동탄:37.200000:127.100000",
        },
      },
    },
  );

  assert.equal(fetchCallCount, 1);
  assert.match(capturedBody, /"reasoning":\{"effort":"none"\}/);
  assert.doesNotMatch(capturedBody, /search_naver_places|standardStops|carrymeTimeline/);
  assert.equal(generatedDraft.days.length, 2);
  assert.equal(generatedDraft.days[0]?.standardStops?.[0]?.name, "동탄");
  assert.equal(generatedDraft.days[0]?.standardStops?.at(-1)?.name, "베이몬드호텔 해운대");
  assert.equal(generatedDraft.days[1]?.standardStops?.[0]?.name, "베이몬드호텔 해운대");
  assert.equal(generatedDraft.days[1]?.standardStops?.at(-1)?.name, "동탄");
  assert.deepEqual(generatedDraft.days[0]?.standardStops, generatedDraft.days[0]?.carrymeStops);
  assert.equal(
    generatedDraft.days.flatMap((day) => day.carrymeTimeline ?? [])
      .filter((event) => event.category === "carryme").length,
    0,
  );
}

/**
 * Verifies the OpenAI Responses API function-call loop with a local place-search mock.
 */
async function assertOpenAiFunctionCallingContract(): Promise<void> {
  const requestBodies: string[] = [];
  const searchedQueries: string[] = [];
  const generatedDraft = await generatePlanmeDraftWithOpenAi(
    {
      destination: "거제",
      durationDays: 2, transportMode: "drive",
      origin: "강원도 양양",
      preferences: ["낚시"],
    },
    {
      apiKey: "test-api-key",
      model: "test-model",
      fetchImpl: async (_url, init) => {
        const body = String(init?.body ?? "");
        requestBodies.push(body);

        if (requestBodies.length === 1) {
          return new Response(
            JSON.stringify({
              id: "resp_tool_call",
              output: [
                {
                  arguments: JSON.stringify({
                    maxCandidates: 5,
                    query: "거제 바다낚시",
                    region: "거제",
                    userIntent: "낚시",
                  }),
                  call_id: "call_naver_place",
                  name: "search_naver_places",
                  type: "function_call",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              title: "거제 낚시 여행 1박 2일",
              region: "거제",
              duration: "1박 2일",
              summary: "검색 후보를 반영한 일정입니다.",
              origin: "강원도 양양",
              assumptions: ["장소 검색 후보 확인"],
              savedMinutes: 40,
              days: [
                {
                  day: 1,
                  label: "Day 1",
                  standardDurationMinutes: 620,
                  carrymeDurationMinutes: 580,
                  standardRouteText: "강원도 양양 → 거제바다낚시공원",
                  carrymeRouteText: "강원도 양양 → 거제바다낚시공원",
                  stops: [
                    {
                      name: "강원도 양양",
                      role: "origin",
                      caption: "출발",
                      addressQuery: "강원도 양양",
                    },
                    {
                      name: "거제바다낚시공원",
                      role: "visit",
                      caption: "낚시",
                      addressQuery: "경상남도 거제시 일운면 거제바다낚시공원",
                    },
                  ],
                  timeline: [
                    {
                      time: "09:30",
                      title: "강원도 양양 출발",
                      description: "거제로 이동합니다.",
                      category: "arrival",
                      highlight: false,
                      savingLabel: "",
                    },
                    {
                      time: "15:00",
                      title: "거제바다낚시공원 방문",
                      description: "바다 낚시를 즐깁니다.",
                      category: "event",
                      highlight: true,
                      savingLabel: "약 40분 절약",
                    },
                  ],
                },
              ],
            }),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
    {
      placeCandidateSearcher: async ({ query, stop }) => {
        searchedQueries.push(query ?? stop.name);

        return {
          candidates: [
            {
              candidateId: "naver_local:geoje-fishing:34.812300:128.702100",
              id: "naver-geoje-fishing",
              name: "거제바다낚시공원",
              address: "경상남도 거제시 일운면",
              coordinate: { lat: 34.8123, lng: 128.7021 },
              query: query ?? stop.name,
              source: "naver_local",
              sourceRef: "naver_local:geoje-fishing:34.812300:128.702100",
            },
          ],
          searchedQueries: [stop.name],
        };
      },
    },
  );

  assert.equal(generatedDraft.days[0]?.stops?.[1]?.name, "거제바다낚시공원");
  assert.equal(requestBodies.length, 2);
  assert.match(requestBodies[0] ?? "", /search_naver_places/);
  assert.match(requestBodies[0] ?? "", /"tool_choice":"required"/);
  assert.doesNotMatch(requestBodies[0] ?? "", /nearby|radiusMeters|center/);
  assertStrictOpenAiToolSchema(requestBodies[0] ?? "");
  assert.match(requestBodies[1] ?? "", /function_call_output/);
  assert.match(requestBodies[1] ?? "", /previous_response_id/);
  assert.match(requestBodies[1] ?? "", /"tool_choice":"auto"/);
  assert.deepEqual(searchedQueries, ["거제 바다낚시"]);
}

/**
 * Verifies OpenAI strict function tools mark every declared property as required.
 */
function assertStrictOpenAiToolSchema(requestBody: string): void {
  type ToolDefinition = {
    name?: string;
    parameters?: {
      properties?: Record<string, { type?: string | string[] }>;
      required?: string[];
    };
    strict?: boolean;
  };
  const body = JSON.parse(requestBody) as { tools?: ToolDefinition[] };
  const tools = body.tools ?? [];

  for (const tool of tools) {
    assert.equal(tool.strict, true);

    const properties = Object.keys(tool.parameters?.properties ?? {});
    const required = tool.parameters?.required ?? [];

    // OpenAI strict mode rejects schemas where declared properties are not required.
    assert.deepEqual(
      [...required].sort(),
      [...properties].sort(),
      `${tool.name ?? "tool"} schema must require every property`,
    );
  }

  assert.equal(tools.length, 1);
  const naverTool = tools.find((tool) => tool.name === "search_naver_places");

  assert.deepEqual(naverTool?.parameters?.properties?.maxCandidates?.type, [
    "integer",
    "null",
  ]);
  assert.equal(naverTool?.parameters?.properties?.query?.type, "string");
  assert.equal("center" in (naverTool?.parameters?.properties ?? {}), false);
  assert.equal("radiusMeters" in (naverTool?.parameters?.properties ?? {}), false);
}

/** Verifies a required-tool protocol violation fails without discarding and regenerating output. */
async function assertOpenAiMissingRequiredToolCallErrorContract(): Promise<void> {
  const requestBodies: string[] = [];

  await assert.rejects(
    () => generatePlanmeDraftWithOpenAi(
      {
        destination: "거제",
        durationDays: 2,
        transportMode: "drive",
        origin: "강원도 양양",
        preferences: ["낚시"],
      },
      {
        apiKey: "test-api-key",
        model: "test-model",
        fetchImpl: async (_url, init) => {
          requestBodies.push(String(init?.body ?? ""));

          return new Response(
            JSON.stringify({ output_text: JSON.stringify({ title: "도구 없는 초안" }) }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      },
      {
        placeCandidateSearcher: async () => ({ candidates: [], searchedQueries: [] }),
      },
    ),
    (error) => {
      assert.ok(error instanceof PlanmeOpenAiError);
      assert.equal(error.code, "OPENAI_PLACE_TOOL_REQUIRED");
      assert.equal(error.stage, "tool_execution");
      assert.equal(error.retryable, false);
      return true;
    },
  );

  assert.equal(requestBodies.length, 1);
  assert.match(requestBodies[0] ?? "", /"tool_choice":"required"/);
}

/** Verifies equivalent searches run once, at most three at a time, without reordering outputs. */
async function assertOpenAiToolConcurrencyAndDedupContract(): Promise<void> {
  const requestBodies: string[] = [];
  const searchedQueries: string[] = [];
  let activeSearches = 0;
  let maxActiveSearches = 0;
  const toolQueries = [
    "거제   바다낚시",
    "거제 카페",
    "  거제 바다낚시  ",
    "거제 공원",
    "거제 시장",
  ];
  const generatedDraft = await generatePlanmeDraftWithOpenAi(
    {
      destination: "거제",
      durationDays: 2,
      transportMode: "drive",
      origin: "강원도 양양",
    },
    {
      apiKey: "test-api-key",
      model: "test-model",
      fetchImpl: async (_url, init) => {
        requestBodies.push(String(init?.body ?? ""));

        if (requestBodies.length === 1) {
          return new Response(
            JSON.stringify({
              id: "resp_parallel_tools",
              output: toolQueries.map((query, index) => ({
                arguments: JSON.stringify({
                  maxCandidates: 5,
                  query,
                  region: "거제",
                  userIntent: "관광",
                }),
                call_id: `call_${index + 1}`,
                name: "search_naver_places",
                type: "function_call",
              })),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        return createOpenAiTestDraftResponse("병렬 검색 일정");
      },
    },
    {
      placeCandidateSearcher: async ({ query }) => {
        activeSearches += 1;
        maxActiveSearches = Math.max(maxActiveSearches, activeSearches);
        searchedQueries.push(query ?? "");
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
        activeSearches -= 1;

        return { candidates: [], searchedQueries: [query ?? ""] };
      },
    },
  );

  assert.equal(generatedDraft.title, "병렬 검색 일정");
  assert.equal(searchedQueries.length, 4);
  assert.equal(maxActiveSearches, 3);

  const finalRequest = JSON.parse(requestBodies[1] ?? "{}") as {
    input?: Array<{ call_id?: string }>;
  };
  assert.deepEqual(
    finalRequest.input?.map((item) => item.call_id),
    ["call_1", "call_2", "call_3", "call_4", "call_5"],
  );
}

/** Verifies transient OpenAI failures retry once while permanent 4xx and deadlines do not. */
async function assertOpenAiRetryAndTimeoutContract(): Promise<void> {
  for (const status of [408, 429, 500]) {
    let fetchCalls = 0;
    const generatedDraft = await generatePlanmeDraftWithOpenAi(
      { destination: "거제", durationDays: 2, transportMode: "drive", origin: "양양" },
      {
        apiKey: "test-api-key",
        fetchImpl: async () => {
          fetchCalls += 1;

          if (fetchCalls === 1) {
            return status === 500
              ? new Response("temporary upstream failure", { status })
              : new Response(JSON.stringify({ error: { message: "temporary failure" } }), {
                  headers: status === 429 ? { "Retry-After": "0" } : undefined,
                  status,
                });
          }

          return createOpenAiTestDraftResponse(`재시도 성공 ${status}`);
        },
        retryDelayMs: 0,
        timeoutMs: 1_000,
      },
    );

    assert.equal(generatedDraft.title, `재시도 성공 ${status}`);
    assert.equal(fetchCalls, 2);
  }

  let networkCalls = 0;
  const networkRetryDraft = await generatePlanmeDraftWithOpenAi(
    { destination: "거제", durationDays: 2, transportMode: "drive", origin: "양양" },
    {
      apiKey: "test-api-key",
      fetchImpl: async () => {
        networkCalls += 1;

        if (networkCalls === 1) {
          throw new Error("temporary network failure");
        }

        return createOpenAiTestDraftResponse("네트워크 재시도 성공");
      },
      retryDelayMs: 0,
      timeoutMs: 1_000,
    },
  );

  assert.equal(networkRetryDraft.title, "네트워크 재시도 성공");
  assert.equal(networkCalls, 2);

  let rejectedCalls = 0;
  await assert.rejects(
    () => generatePlanmeDraftWithOpenAi(
      { destination: "거제", durationDays: 2, transportMode: "drive", origin: "양양" },
      {
        apiKey: "test-api-key",
        fetchImpl: async () => {
          rejectedCalls += 1;
          return new Response(JSON.stringify({ error: { message: "bad request" } }), {
            status: 400,
          });
        },
        retryDelayMs: 0,
        timeoutMs: 1_000,
      },
    ),
    (error) => {
      assert.ok(error instanceof PlanmeOpenAiError);
      assert.equal(error.code, "OPENAI_REQUEST_REJECTED");
      assert.equal(error.stage, "provider_response");
      assert.equal(error.retryable, false);
      assert.equal(error.status, 400);
      return true;
    },
  );
  assert.equal(rejectedCalls, 1);

  let timeoutCalls = 0;
  await assert.rejects(
    () => generatePlanmeDraftWithOpenAi(
      { destination: "거제", durationDays: 2, transportMode: "drive", origin: "양양" },
      {
        apiKey: "test-api-key",
        fetchImpl: async (_url, init) => {
          timeoutCalls += 1;

          return await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          });
        },
        retryDelayMs: 0,
        timeoutMs: 10,
      },
    ),
    (error) => {
      assert.ok(error instanceof PlanmeOpenAiError);
      assert.equal(error.code, "OPENAI_REQUEST_TIMEOUT");
      assert.equal(error.stage, "request");
      assert.equal(error.retryable, true);
      return true;
    },
  );
  assert.equal(timeoutCalls, 1);
}

/** Creates the smallest structured draft accepted by the generator normalization boundary. */
function createOpenAiTestDraftResponse(title: string) {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        assumptions: [],
        days: [],
        duration: "1박 2일",
        origin: "양양",
        region: "거제",
        savedMinutes: 0,
        summary: "테스트 일정",
        title,
      }),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * Verifies OpenAI can judge searched candidates without relying on provider rank.
 */
async function assertOpenAiPlaceCandidateDecisionContract(): Promise<void> {
  let capturedBody = "";
  const decision = await decidePlanmePlaceCandidateWithOpenAi(
    {
      candidates: [
        {
          candidateId: "naver_local:geoje-fishing:34.812300:128.702100",
          id: "naver-geoje-fishing",
          name: "거제바다낚시공원",
          address: "경상남도 거제시 일운면",
          coordinate: { lat: 34.8123, lng: 128.7021 },
          query: "거제 바다낚시",
          source: "naver_local",
          sourceRef: "naver_local:geoje-fishing:34.812300:128.702100",
        },
      ],
      finalAttempt: false,
      input: {
        destination: "거제",
        origin: "강원도 양양",
        preferences: ["낚시"],
        transportMode: "drive",
      },
      round: 1,
      searchedQueries: ["거제 바다낚시"],
      stop: { name: "거제도 바다 낚시터", role: "visit" },
    },
    {
      apiKey: "test-api-key",
      model: "test-model",
      fetchImpl: async (_url, init) => {
        capturedBody = String(init?.body ?? "");

        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              feedbackMessage: "",
              questions: [],
              reason: "사용자 낚시 의도와 후보 장소가 일치합니다.",
              selectedCandidateId:
                "naver_local:geoje-fishing:34.812300:128.702100",
              status: "accepted",
            }),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  );

  assert.equal(decision.status, "accepted");
  assert.equal(
    decision.selectedCandidateId,
    "naver_local:geoje-fishing:34.812300:128.702100",
  );
  assert.match(capturedBody, /planme_place_candidate_decision/);
  assert.match(capturedBody, /accepted/);
  assert.doesNotMatch(capturedBody, /test-api-key/);
}

/**
 * Verifies AI draft stop coordinates can be resolved from required Korean address queries.
 */
async function assertDraftCoordinateResolverContract(): Promise<void> {
  const geocoder: PlanmeDraftGeocoder = async ({ query }) => {
    if (query.includes("남해 독일마을")) {
      return {
        coordinate: { lat: 34.7983, lng: 128.0406 },
        matchedAddress: "경상남도 남해군 삼동면 독일로 89-7",
      };
    }

    return null;
  };

  const result = await resolvePlanmeDraftCoordinates(
    {
      title: "남해 가족여행 초안",
      transportMode: "drive",
      region: "남해",
      duration: "1박 2일",
      summary: "좌표 보강 테스트",
      origin: "동탄",
      assumptions: ["동탄 출발"],
      savedMinutes: 40,
      days: [
        {
          day: 1,
          label: "Day 1",
          stops: [
            {
              name: "남해 독일마을",
              role: "visit",
              caption: "방문지",
              addressQuery: "경상남도 남해군 삼동면 독일로 89-7 남해 독일마을",
            },
            {
              name: "모호한 장소",
              role: "visit",
              caption: "방문지",
              addressQuery: "남해 모호한 장소",
            },
          ],
          timeline: [
            {
              time: "10:00",
              title: "남해 독일마을 방문",
              description: "좌표 보강된 장소 방문",
              category: "event",
            },
          ],
        },
      ],
    },
    geocoder,
  );

  assert.equal(result.draft.days[0]?.stops?.[0]?.coordinate?.lat, 34.7983);
  assert.equal(result.draft.days[0]?.stops?.[0]?.coordinate?.lng, 128.0406);
  assert.equal(result.validationIssues[0]?.code, "coordinate_resolution_failed");
}

/**
 * Verifies the MCP Naver Geocoding adapter without calling the real API.
 */
async function assertNaverGeocoderContract(): Promise<void> {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const geocoder = createNaverGeocoder({
    keyId: "test-key-id",
    secret: "test-secret",
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
      });

      return new Response(
        JSON.stringify({
          addresses: [
            {
              roadAddress: "경상남도 남해군 삼동면 독일로 89-7",
              x: "128.0406",
              y: "34.7983",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  const result = await geocoder({
    query: "경상남도 남해군 삼동면 독일로 89-7 남해 독일마을",
    stop: { name: "남해 독일마을" },
    region: "남해",
    dayIndex: 0,
    stopIndex: 0,
  });

  assert.equal(result?.coordinate.lat, 34.7983);
  assert.equal(result?.coordinate.lng, 128.0406);
  assert.equal(result?.placeSource, "naver_geocode");
  assert.match(result?.placeSourceRef ?? "", /^naver_geocode:/);
  assert.match(calls[0]?.url ?? "", /query=/);
  assert.equal(calls[0]?.headers["x-ncp-apigw-api-key-id"], "test-key-id");
  assert.equal(calls[0]?.headers["x-ncp-apigw-api-key"], "test-secret");
}

/**
 * Verifies AI recommendations can enrich non-lodging stops with Naver-resolved coordinates.
 */
async function assertAiRecommendationCoordinateResolutionContract(): Promise<void> {
  clearMemoryUsageCounters();

  const fixedDate = new Date("2026-07-09T12:00:00.000Z");
  const response = await createAiRecommendedItineraryResponse(
    "http://localhost:3000/api/gpt/itineraries/recommend",
    { destination: "남해", origin: "동탄", durationDays: 2, transportMode: "drive" },
    {
      accommodationCandidateSearcher: async () => [],
      aiItineraryGenerator: async () => ({
        title: "남해 가족여행 초안",
        region: "남해",
        duration: "1박 2일",
        summary: "좌표 보강 추천 테스트",
        origin: "동탄",
        assumptions: ["동탄 출발"],
        savedMinutes: 40,
        days: [
          {
            day: 1,
            label: "Day 1",
            standardDurationMinutes: 420,
            carrymeDurationMinutes: 360,
            standardRouteText: "동탄 → 남해 독일마을",
            carrymeRouteText: "동탄 → 남해 독일마을",
            stops: [
              {
                name: "동탄",
                role: "origin",
                caption: "출발",
                addressQuery: "경기도 화성시 동탄역",
              },
              {
                name: "남해 독일마을",
                role: "visit",
                caption: "관광",
                addressQuery: "경상남도 남해군 삼동면 독일로 89-7 남해 독일마을",
              },
            ],
            timeline: [
              {
                time: "10:00",
                title: "남해 독일마을 방문",
                description: "독일마을 산책",
                category: "event",
                highlight: true,
                savingLabel: "약 40분 절약",
              },
            ],
          },
        ],
      }),
      draftGeocoder: async ({ query }) => {
        const coordinate = query.includes("남해 독일마을")
          ? { lat: 34.7983, lng: 128.0406 }
          : { lat: 37.2001, lng: 127.0951 };

        return {
          coordinate,
          placeSource: "naver_geocode",
          placeSourceRef: `naver_geocode:${query}:${coordinate.lat.toFixed(6)}:${coordinate.lng.toFixed(6)}`,
        };
      },
      placeCandidateSearcher: async ({ stop }) => ({
        candidates:
          stop.name === "남해 독일마을"
            ? [
                {
                  candidateId: "naver_local:namhae-german-village:34.798300:128.040600",
                  id: "naver-namhae-german-village",
                  name: "남해 독일마을",
                  address: "경상남도 남해군 삼동면 독일로 89-7",
                  coordinate: { lat: 34.7983, lng: 128.0406 },
                  query: "남해 독일마을",
                  source: "naver_local",
                  sourceRef: "naver_local:namhae-german-village:34.798300:128.040600",
                },
              ]
            : [],
        searchedQueries: [stop.name],
      }),
      placeCandidateDecider: async ({ candidates }) => ({
        reason: "주소 좌표가 있지만 방문지는 네이버 장소 후보 판단으로 확정합니다.",
        selectedCandidateId: candidates[0]?.candidateId,
        status: "accepted",
      }),
      usageRecorder: createPlanmeUsageRecorder({
        now: () => fixedDate,
      }),
    },
  );

  assertReadyRecommendation(response);

  const standardRoute = response.itinerary.days[0]?.standard;

  assert.equal(standardRoute?.stops.every((stop) => Boolean(stop.coordinate)), true);
  assert.ok(
    standardRoute?.stops.some(
      (stop) => stop.label === "남해 독일마을" && Boolean(stop.placeSourceRef),
    ),
    JSON.stringify(standardRoute?.stops),
  );
  assert.equal(readMemoryUsageCounter("final_ai_decision", fixedDate), 0);
  assert.ok(
    (standardRoute?.geoPath?.length ?? 0) >= 2,
    "Expected resolved coordinates to create a renderable Naver geoPath",
  );
}

/**
 * Verifies provider lot-number labels do not overwrite the user-facing AI place name.
 */
async function assertProviderAddressLabelDoesNotReplacePlaceName(): Promise<void> {
  const response = await createAiRecommendedItineraryResponse(
    "http://localhost:3000/api/gpt/itineraries/recommend",
    { destination: "부산", origin: "서울 마포구", durationDays: 2, transportMode: "drive" },
    {
      accommodationCandidateSearcher: async () => [],
      aiItineraryGenerator: async () => ({
        title: "서울 마포구 출발 부산 1박 2일 초안",
        region: "부산",
        duration: "1박 2일",
        summary: "지번 후보명 보존 테스트",
        origin: "서울 마포구",
        assumptions: ["서울 마포구 출발"],
        savedMinutes: 30,
        days: [
          {
            day: 1,
            label: "Day 1",
            standardDurationMinutes: 360,
            carrymeDurationMinutes: 330,
            standardRouteText: "서울 마포구 → 오시리아 해안산책로",
            carrymeRouteText: "서울 마포구 → 오시리아 해안산책로",
            stops: [
              {
                name: "서울 마포구",
                role: "origin",
                caption: "출발",
                addressQuery: "서울특별시 마포구",
              },
              {
                name: "오시리아 해안산책로",
                role: "visit",
                caption: "바다 산책",
                addressQuery: "부산광역시 기장군 기장읍 시랑리 62-15",
              },
            ],
            timeline: [
              {
                time: "13:30",
                title: "오시리아 해안산책로 이동",
                description: "바다 풍경을 즐깁니다.",
                category: "event",
              },
            ],
          },
        ],
      }),
      draftGeocoder: async ({ query }) => ({
        coordinate: query.includes("62-15")
          ? { lat: 35.1964941, lng: 129.2282823 }
          : { lat: 37.5580889, lng: 126.9083451 },
        placeSource: "naver_geocode",
        placeSourceRef: `naver_geocode:${query}:35.196494:129.228282`,
      }),
      placeCandidateSearcher: async ({ stop }) => ({
        candidates:
          stop.name === "오시리아 해안산책로"
            ? [
                {
                  candidateId:
                    "google_text_search:places/osiria-lot:62-15:35.196494:129.228282",
                  id: "places/osiria-lot",
                  name: "62-15",
                  address: "부산광역시 기장군 기장읍 시랑리 62-15",
                  coordinate: { lat: 35.1964941, lng: 129.2282823 },
                  placeId: "places/osiria-lot",
                  query: "부산광역시 기장군 기장읍 시랑리 62-15",
                  source: "naver_local",
                  sourceRef:
                    "google_text_search:places/osiria-lot:62-15:35.196494:129.228282",
                  types: ["establishment"],
                },
              ]
            : [],
        searchedQueries: [stop.name],
      }),
      placeCandidateDecider: async ({ candidates }) => ({
        reason: "좌표 후보는 맞지만 displayName은 지번입니다.",
        selectedCandidateId: candidates[0]?.candidateId,
        status: "accepted",
      }),
    },
  );

  assertReadyRecommendation(response);

  const standardRoute = response.itinerary.days[0]?.standard;
  const timelineText = JSON.stringify(response.itinerary.days[0]?.timeline);
  const osiriaStop = standardRoute?.stops.find(
    (stop) => stop.label === "오시리아 해안산책로",
  );

  assert.equal(osiriaStop?.label, "오시리아 해안산책로");
  assert.ok(osiriaStop?.placeSourceRef);
  assert.match(standardRoute?.routeText ?? "", /오시리아 해안산책로/);
  assert.doesNotMatch(standardRoute?.routeText ?? "", /62-15/);
  assert.match(timelineText, /오시리아 해안산책로/);
  assert.doesNotMatch(timelineText, /62-15/);
}

/**
 * Verifies Naver-geocoded visit coordinates satisfy the final coordinate/source hard gate.
 */
async function assertNaverGeocodedVisitHardGateContract(): Promise<void> {
  const response = await createAiRecommendedItineraryResponse(
    "http://localhost:3000/api/gpt/itineraries/recommend",
    { destination: "거제", origin: "강원도 양양", durationDays: 2, transportMode: "drive", preferences: ["낚시"] },
    {
      accommodationCandidateSearcher: async () => [],
      aiItineraryGenerator: async () => ({
        title: "거제 낚시 여행 초안",
        region: "거제",
        duration: "1박 2일",
        summary: "Naver 좌표만 있는 방문지 차단 테스트",
        origin: "강원도 양양",
        assumptions: ["낚시 선호"],
        savedMinutes: 20,
        days: [
          {
            day: 1,
            label: "Day 1",
            standardDurationMinutes: 600,
            carrymeDurationMinutes: 580,
            standardRouteText: "강원도 양양 → 거제도 바다 낚시터",
            carrymeRouteText: "강원도 양양 → 거제도 바다 낚시터",
            stops: [
              {
                name: "강원도 양양",
                role: "origin",
                caption: "출발",
                addressQuery: "강원도 양양",
              },
              {
                name: "거제도 바다 낚시터",
                role: "visit",
                caption: "낚시",
                addressQuery: "거제도 바다 낚시터",
              },
            ],
            timeline: [
              {
                time: "15:00",
                title: "거제도 바다 낚시터 방문",
                description: "장소 확인 필요",
                category: "event",
              },
            ],
          },
        ],
      }),
      draftGeocoder: async ({ query }) => ({
        coordinate: query.includes("양양")
          ? { lat: 38.0754, lng: 128.6191 }
          : { lat: 34.84, lng: 128.69 },
        placeSource: "naver_geocode",
        placeSourceRef: `naver_geocode:${query}:34.840000:128.690000`,
      }),
      placeCandidateSearcher: async ({ stop }) => ({
        candidates: stop.name === "거제도 바다 낚시터" ? [] : [],
        searchedQueries: [stop.name],
      }),
    },
  );

  assertReadyRecommendation(response);
  const visitStop = response.itinerary.days[0]?.standard.stops.find(
    (stop) => stop.label === "거제도 바다 낚시터",
  );

  assert.equal(visitStop?.placeSource, "naver_geocode");
  assert.ok(visitStop?.coordinate);
  assert.ok(visitStop?.placeSourceRef);
}

/**
 * Verifies that AI generation uses actual accommodation candidates instead of generic lodging names.
 */
async function assertAccommodationCandidateContract(): Promise<void> {
  let searchCallCount = 0;
  let generatorInput = "";
  const response = await createAiRecommendedItineraryResponse(
    "http://localhost:3000/api/gpt/itineraries/recommend",
    {
      destination: "남해",
      durationDays: 2, transportMode: "drive",
      origin: "동탄",
      preferences: ["가족 여행", "아이 동반"],
      travelerCount: 4,
      luggageCount: 2,
    },
    {
      accommodationCandidateSearcher: async (input) => {
        searchCallCount += 1;
        assert.equal(input.destination, "남해");

        return [
          {
            id: "place-namhae-pension",
            name: "펜션 사랑가",
            address: "경상남도 남해군 남면 남면로 123",
            coordinate: { lat: 34.7601, lng: 127.9001 },
            placeId: "places/namhae-pension",
            types: ["lodging"],
          },
        ];
      },
      aiItineraryGenerator: async (input) => {
        generatorInput = JSON.stringify(input);

        return {
          title: "남해 2일 가족 여행 일정",
          region: "남해",
          duration: "2일",
          summary: "아이 동반 가족이 남해를 무리 없이 보는 일정입니다.",
          assumptions: ["숙소 후보를 사용"],
          savedMinutes: 60,
          days: [
            {
              day: 1,
              label: "Day 1",
              standardDurationMinutes: 420,
              carrymeDurationMinutes: 360,
              standardRouteText: "남해 숙소 → 상주은모래비치 → 독일마을 → 남해 숙소",
              carrymeRouteText: "상주은모래비치 → 독일마을 → 남해 숙소",
              standardStops: [
                { name: "남해 숙소", caption: "숙소 도착", role: "숙소", mode: "transit" },
                { name: "상주은모래비치", caption: "해변 산책", role: "방문지", mode: "transit" },
                { name: "독일마을", caption: "관광", role: "방문지", mode: "transit" },
                { name: "남해 숙소", caption: "휴식", role: "숙소", mode: "transit" },
              ],
              carrymeStops: [
                { name: "상주은모래비치", caption: "해변 산책", role: "방문지", mode: "transit" },
                { name: "독일마을", caption: "관광", role: "방문지", mode: "transit" },
                { name: "남해 숙소", caption: "휴식", role: "숙소", mode: "transit" },
              ],
              standardTimeline: [
                {
                  time: "오전",
                  title: "남해 숙소 도착",
                  description: "숙소에 짐을 맡기고 여행을 시작합니다.",
                  category: "arrival",
                  highlight: false,
                  savingLabel: "",
                },
              ],
              carrymeTimeline: [
                {
                  time: "오전",
                  title: "짐 숙소 도착",
                  description: "짐은 숙소에 도착하고 가족은 바로 여행합니다.",
                  category: "hotel",
                  highlight: false,
                  savingLabel: "",
                },
                {
                  time: "오후",
                  title: "상주은모래비치 방문",
                  description: "아이와 함께 바다를 봅니다.",
                  category: "event",
                  highlight: true,
                  savingLabel: "약 60분 절약",
                },
              ],
            },
          ],
        };
      },
      draftGeocoder: async ({ query, stop, stopIndex }) => {
        const coordinate = {
          lat: 34.75 + stopIndex * 0.01,
          lng: 127.9 + stop.name.length * 0.001,
        };

        return {
          coordinate,
          placeSource: "naver_geocode",
          placeSourceRef: `naver_geocode:${query}:${coordinate.lat.toFixed(6)}:${coordinate.lng.toFixed(6)}`,
        };
      },
      placeCandidateSearcher: async ({ stop }) => ({
        candidates:
          stop.role === "방문지" || stop.role === "visit"
            ? [createMockNaverPlaceCandidate(stop.name, stop.name.length)]
            : [],
        searchedQueries: [stop.name],
      }),
      placeCandidateDecider: async ({ candidates }) => ({
        reason: "방문지는 네이버 후보 판단을 통과해야 ready 처리됩니다.",
        selectedCandidateId: candidates[0]?.candidateId,
        status: "accepted",
      }),
    },
  );
  assertReadyRecommendation(response);

  const accommodationStop = response.itinerary.days[0]?.standard.stops.find(
    (stop) => stop.role === "숙소",
  );
  const renderedPayload = JSON.stringify(response.itinerary);

  assert.equal(searchCallCount, 1);
  assert.match(generatorInput, /펜션 사랑가/);
  assert.equal(accommodationStop?.label, "펜션 사랑가");
  assert.deepEqual(accommodationStop?.coordinate, { lat: 34.7601, lng: 127.9001 });
  assert.equal(accommodationStop?.role, "숙소");
  assert.equal(accommodationStop?.mode, "drive");
  assert.ok(accommodationStop?.placeSourceRef);
  assert.match(renderedPayload, /펜션 사랑가/);
  assert.doesNotMatch(renderedPayload, /남해 숙소/);
}

/**
 * Verifies that multi-night AI drafts keep the requested number of itinerary days.
 */
async function assertThreeDayAiDraftContract(): Promise<void> {
  const response = await createAiRecommendedItineraryResponse(
    "http://localhost:3000/api/gpt/itineraries/recommend",
    {
      destination: "남해",
      destinationType: "place",
      durationDays: 3, transportMode: "drive",
      origin: "서울",
      preferences: ["낚시", "가족 여행"],
      travelerCount: 4,
      luggageCount: 2,
    },
    {
      accommodationCandidateSearcher: async () => [
        {
          id: "place-namhae-beach-hotel",
          name: "남해 비치호텔",
          address: "경상남도 남해군 남면 남면로 999",
          coordinate: { lat: 34.7301, lng: 127.9001 },
          placeId: "places/namhae-beach-hotel",
          types: ["lodging"],
        },
      ],
      aiItineraryGenerator: async () => ({
        title: "남해 낚시 가족여행 2박 3일 일정",
        region: "남해",
        duration: "2박 3일",
        summary: "가족이 남해에서 낚시와 해안 산책을 함께 즐기는 3일 일정입니다.",
        assumptions: ["2박 3일", "아이 동반 가족 여행"],
        savedMinutes: 60,
        days: [
          {
            day: 1,
            label: "첫째 날: 남해 도착과 숙소 체크인",
            standardDurationMinutes: 420,
            carrymeDurationMinutes: 360,
            standardRouteText: "서울 → 남해 비치호텔 → 남해 독일마을",
            carrymeRouteText: "서울 → 남해 독일마을 → 남해 비치호텔",
            stops: [
              { name: "서울", caption: "출발" },
              { name: "남해 독일마을", caption: "관광" },
              { name: "남해 비치호텔", caption: "숙소" },
            ],
            timeline: [
              {
                time: "09:00",
                title: "서울 출발",
                description: "남해 가족여행을 시작합니다.",
                category: "arrival",
                highlight: false,
                savingLabel: "",
              },
              {
                time: "15:00",
                title: "남해 독일마을 방문",
                description: "가볍게 마을을 둘러봅니다.",
                category: "event",
                highlight: true,
                savingLabel: "약 60분 절약",
              },
            ],
          },
          {
            day: 2,
            label: "둘째 날: 방파제 낚시와 해안 산책",
            standardDurationMinutes: 360,
            carrymeDurationMinutes: 320,
            standardRouteText: "남해 비치호텔 → 물건방조어부림 → 남해 비치호텔",
            carrymeRouteText: "남해 비치호텔 → 물건방조어부림 → 남해 비치호텔",
            stops: [
              { name: "남해 비치호텔", caption: "출발" },
              { name: "물건방조어부림", caption: "해안 산책" },
              { name: "남해 비치호텔", caption: "휴식" },
            ],
            timeline: [
              {
                time: "10:00",
                title: "물건방조어부림 산책",
                description: "가족과 해안 산책을 합니다.",
                category: "event",
                highlight: true,
                savingLabel: "약 40분 절약",
              },
              {
                time: "17:00",
                title: "남해 비치호텔 휴식",
                description: "숙소로 돌아와 쉽니다.",
                category: "hotel",
                highlight: false,
                savingLabel: "",
              },
            ],
          },
          {
            day: 3,
            label: "셋째 날: 바다 산책 후 귀가",
            standardDurationMinutes: 300,
            carrymeDurationMinutes: 260,
            standardRouteText: "남해 비치호텔 → 상주은모래비치 → 서울",
            carrymeRouteText: "남해 비치호텔 → 상주은모래비치 → 서울",
            stops: [
              { name: "남해 비치호텔", caption: "출발" },
              { name: "상주은모래비치", caption: "산책" },
              { name: "서울", caption: "귀가" },
            ],
            timeline: [
              {
                time: "10:00",
                title: "상주은모래비치 산책",
                description: "귀가 전 바다를 봅니다.",
                category: "event",
                highlight: true,
                savingLabel: "약 40분 절약",
              },
              {
                time: "15:00",
                title: "서울 도착",
                description: "여행을 마칩니다.",
                category: "arrival",
                highlight: false,
                savingLabel: "",
              },
            ],
          },
        ],
      }),
      draftGeocoder: async ({ dayIndex, query, stopIndex }) => {
        const coordinate = {
          lat: 34.7 + dayIndex * 0.02 + stopIndex * 0.003,
          lng: 127.9 + dayIndex * 0.02 + stopIndex * 0.003,
        };

        return {
          coordinate,
          placeSource: "naver_geocode",
          placeSourceRef: `naver_geocode:${query}:${coordinate.lat.toFixed(6)}:${coordinate.lng.toFixed(6)}`,
        };
      },
      placeCandidateSearcher: async ({ stop }) => ({
        candidates:
          stop.role === "visit" ? [createMockNaverPlaceCandidate(stop.name, stop.name.length)] : [],
        searchedQueries: [stop.name],
      }),
      placeCandidateDecider: async ({ candidates }) => ({
        reason: "3일 일정 방문지를 실제 후보로 확정합니다.",
        selectedCandidateId: candidates[0]?.candidateId,
        status: "accepted",
      }),
    },
  );

  assertReadyRecommendation(response);

  assert.equal(response.itinerary.days.length, 3);
  assert.equal(response.standardTotalMinutes, 1_080);
  assert.equal(response.carrymeTotalMinutes, 940);
  assert.equal(response.savedMinutes, 140);
  assert.equal(response.days.length, 3);
  assert.deepEqual(
    response.days.map((day) => [day.standard.durationMinutes, day.carryme.durationMinutes]),
    [
      [420, 360],
      [360, 320],
      [300, 260],
    ],
  );
  assert.equal(response.itinerary.days[2]?.day, 3);
  assert.equal(response.itinerary.days[2]?.label, "셋째 날: 바다 산책 후 귀가");
  assert.equal(
    response.itinerary.days.flatMap((day) => day.standard.stops).filter(
      (stop) => stop.label === "남해",
    ).length,
    1,
  );
  assert.equal(
    response.itinerary.days.flatMap((day) => day.carryme.stops).filter(
      (stop) => stop.label === "남해",
    ).length,
    1,
  );
}

/**
 * Verifies accommodation lookup reuses the Naver candidate contract and filters non-lodging POIs.
 */
async function assertNaverAccommodationSearchContract(): Promise<void> {
  let capturedQuery = "";
  const candidates = await searchAccommodationCandidates(
    {
      destination: "남해",
      preferences: ["가족 여행"],
    },
    {
      placeCandidateSearcher: async ({ query }) => {
        capturedQuery = query ?? "";

        return {
          candidates: [
            {
              address: "경상남도 남해군 남면 남면로 999",
              candidateId: "naver_local:namhae-beach-hotel:34.730100:127.900100",
              category: "숙박>호텔",
              coordinate: { lat: 34.7301, lng: 127.9001 },
              id: "namhae-beach-hotel",
              name: "남해 비치호텔",
              source: "naver_local",
              sourceRef: "naver_local:namhae-beach-hotel:34.730100:127.900100",
            },
            {
              address: "경상남도 남해군",
              candidateId: "naver_local:namhae-beach:34.731000:127.901000",
              category: "여행>해변",
              coordinate: { lat: 34.731, lng: 127.901 },
              id: "namhae-beach",
              name: "남해 해변",
              source: "naver_local",
              sourceRef: "naver_local:namhae-beach:34.731000:127.901000",
            },
          ],
          searchedQueries: [query ?? ""],
        };
      },
    },
  );

  assert.match(capturedQuery, /남해/);
  assert.match(capturedQuery, /숙소/);
  assert.deepEqual(candidates.map((candidate) => candidate.name), ["남해 비치호텔"]);
}

/**
 * Verifies Naver Local Search request, coordinate normalization, and source-backed reuse.
 */
async function assertPlaceCandidateSearchContract(): Promise<void> {
  /* Legacy Google Places and nearby-radius assertions removed by GUI-201.
  const textCalls: Array<{
    body: {
      locationBias?: object;
      locationRestriction?: object;
      textQuery?: string;
    };
    headers: Record<string, string>;
    url: string;
  }> = [];
  const textResult = await searchPlanmePlaceCandidates(
    {
      center: { lat: 34.84, lng: 128.69 },
      destination: "거제",
      preferences: ["바다낚시"],
      stop: { name: "거제도 바다 낚시터", role: "visit" },
    },
    {
      apiKey: "test-google-key",
      referer: "http://localhost:3000/mcp",
      fetchImpl: async (url, init) => {
        textCalls.push({
          body: JSON.parse(String(init?.body ?? "{}")) as {
            locationBias?: object;
            locationRestriction?: object;
            textQuery?: string;
          },
          headers: init?.headers as Record<string, string>,
          url: String(url),
        });

        return new Response(
          JSON.stringify({
            places: [
              {
                displayName: { text: "거제바다낚시공원" },
                formattedAddress: "경상남도 거제시 일운면",
                id: "places/geoje-fishing",
                location: { latitude: 34.8123, longitude: 128.7021 },
                primaryType: "tourist_attraction",
                types: ["tourist_attraction", "point_of_interest"],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  );

  assert.equal(textCalls[0]?.url, "https://places.googleapis.com/v1/places:searchText");
  assert.equal(textCalls[0]?.headers["X-Goog-Api-Key"], "test-google-key");
  assert.match(textCalls[0]?.headers["X-Goog-FieldMask"] ?? "", /places\.location/);
  assert.equal(textCalls[0]?.headers.Referer, "http://localhost:3000/");
  assert.ok(textCalls[0]?.body.locationBias);
  assert.equal(textCalls[0]?.body.locationRestriction, undefined);
  assert.equal(textResult.candidates[0]?.source, "naver_local");
  assert.equal(textResult.candidates[0]?.name, "거제바다낚시공원");
  assert.ok(textResult.candidates[0]?.candidateId);
  assert.ok(textResult.candidates[0]?.sourceRef);

  const nearbyRadii: number[] = [];
  const nearbyResult = await searchPlanmePlaceCandidates(
    {
      center: { lat: 34.84, lng: 128.69 },
      destination: "거제",
      preferences: ["바다낚시"],
      stop: { name: "거제도 바다 낚시터", role: "visit" },
    },
    {
      apiKey: "test-google-key",
      fetchImpl: async (url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          locationRestriction?: {
            circle?: {
              radius?: number;
            };
          };
        };

        if (String(url).includes("places:searchText")) {
          return new Response(JSON.stringify({ places: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        const radius = body.locationRestriction?.circle?.radius ?? 0;
        nearbyRadii.push(radius);

        return new Response(
          JSON.stringify({
            places:
              radius === 20000
                ? [
                    {
                      displayName: { text: "거제 낚시공원" },
                      formattedAddress: "경상남도 거제시",
                      id: "places/geoje-nearby-fishing",
                      location: { latitude: 34.8222, longitude: 128.7123 },
                      types: ["point_of_interest"],
                    },
                  ]
                : [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  );

  assert.deepEqual(nearbyRadii, [...PLANME_NEARBY_RADIUS_METERS]);
  assert.equal(Math.max(...nearbyRadii), 20000);
  assert.equal(nearbyResult.candidates[0]?.source, "naver_local");
  assert.equal(nearbyResult.candidates[0]?.radiusMeters, 20000);

  const directNearbyUrls: string[] = [];
  const directNearbyResult = await searchPlanmePlaceCandidates(
    {
      center: { lat: 34.84, lng: 128.69 },
      destination: "거제",
      radiusMeters: 25000,
      searchMode: "nearby",
      stop: { name: "거제 낚시터", role: "visit" },
    },
    {
      apiKey: "test-google-key",
      fetchImpl: async (url, init) => {
        directNearbyUrls.push(String(url));
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          locationRestriction?: {
            circle?: {
              radius?: number;
            };
          };
        };

        assert.equal(body.locationRestriction?.circle?.radius, 20000);

        return new Response(
          JSON.stringify({
            places: [
              {
                displayName: { text: "거제 근거리 낚시터" },
                formattedAddress: "경상남도 거제시",
                id: "places/geoje-direct-nearby-fishing",
                location: { latitude: 34.8322, longitude: 128.7223 },
                types: ["point_of_interest"],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  );

  assert.deepEqual(directNearbyUrls, ["https://places.googleapis.com/v1/places:searchNearby"]);
  assert.equal(directNearbyResult.candidates[0]?.source, "naver_local");

  const stopCoordinateNearbyResult = await searchPlanmePlaceCandidates(
    {
      destination: "거제",
      radiusMeters: 25000,
      searchMode: "nearby",
      stop: {
        name: "거제 낚시터",
        role: "visit",
        coordinate: { lat: 34.84, lng: 128.69 },
        placeSource: "naver_geocode",
        placeSourceRef: "naver_geocode:거제 낚시터:34.840000:128.690000",
      },
    },
    {
      apiKey: "test-google-key",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          locationRestriction?: {
            circle?: {
              center?: {
                latitude?: number;
                longitude?: number;
              };
              radius?: number;
            };
          };
        };

        assert.equal(body.locationRestriction?.circle?.center?.latitude, 34.84);
        assert.equal(body.locationRestriction?.circle?.center?.longitude, 128.69);
        assert.equal(body.locationRestriction?.circle?.radius, 20000);

        return new Response(JSON.stringify({ places: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  );

  assert.equal(stopCoordinateNearbyResult.candidates[0]?.source, "naver_geocode");

  const naverOnlyResult = await searchPlanmePlaceCandidates(
    {
      destination: "거제",
      stop: {
        name: "거제 바다 낚시터",
        role: "visit",
        addressQuery: "경상남도 거제시",
        coordinate: { lat: 34.84, lng: 128.69 },
        placeSource: "naver_geocode",
        placeSourceRef: "naver_geocode:거제 바다 낚시터:34.840000:128.690000",
      },
    },
    { apiKey: "" },
  );

  assert.equal(naverOnlyResult.candidates[0]?.source, "naver_geocode");
  assert.equal(
    naverOnlyResult.candidates[0]?.sourceRef,
    "naver_geocode:거제 바다 낚시터:34.840000:128.690000",
  );

  const mixedResult = await searchPlanmePlaceCandidates(
    {
      destination: "거제",
      stop: {
        name: "거제 바다 낚시터",
        role: "visit",
        coordinate: { lat: 34.84, lng: 128.69 },
        placeSource: "naver_geocode",
        placeSourceRef: "naver_geocode:거제 바다 낚시터:34.840000:128.690000",
      },
    },
    {
      apiKey: "test-google-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            places: [
              {
                displayName: { text: "거제 낚시공원" },
                formattedAddress: "경상남도 거제시",
                id: "places/geoje-google-fishing",
                location: { latitude: 34.8222, longitude: 128.7123 },
                types: ["point_of_interest"],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    },
  );

  assert.deepEqual(
    mixedResult.candidates.map((candidate) => candidate.source),
    ["naver_local", "naver_geocode"],
  );
  */

  const calls: Array<{ headers: Record<string, string>; url: string }> = [];
  const searchResult = await searchPlanmePlaceCandidates(
    {
      destination: "거제",
      maxCandidates: 3,
      preferences: ["바다낚시"],
      stop: { name: "거제도 바다 낚시터", role: "visit" },
    },
    {
      clientId: "test-naver-client-id",
      clientSecret: "test-naver-client-secret",
      fetchImpl: async (url, init) => {
        calls.push({
          headers: init?.headers as Record<string, string>,
          url: String(url),
        });

        return new Response(
          JSON.stringify({
            items: [
              {
                address: "경상남도 거제시 일운면",
                category: "여행,명소>체험",
                link: "https://example.test/geoje-fishing",
                mapx: "1287021000",
                mapy: "348123000",
                title: "<b>거제바다낚시공원</b>",
              },
              {
                address: "좌표가 없는 후보",
                title: "제외 대상",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  );

  const requestUrl = new URL(calls[0]?.url ?? "https://invalid.test");
  assert.equal(requestUrl.origin + requestUrl.pathname, "https://openapi.naver.com/v1/search/local.json");
  assert.equal(requestUrl.searchParams.get("display"), "3");
  assert.equal(calls[0]?.headers["X-Naver-Client-Id"], "test-naver-client-id");
  assert.equal(calls[0]?.headers["X-Naver-Client-Secret"], "test-naver-client-secret");
  assert.equal(searchResult.candidates.length, 1);
  assert.equal(searchResult.candidates[0]?.name, "거제바다낚시공원");
  assert.deepEqual(searchResult.candidates[0]?.coordinate, { lat: 34.8123, lng: 128.7021 });
  assert.equal(searchResult.candidates[0]?.source, "naver_local");
  assert.match(searchResult.candidates[0]?.sourceRef ?? "", /^naver_local:/);

  let providerCalled = false;
  const sourceBackedResult = await searchPlanmePlaceCandidates(
    {
      destination: "거제",
      stop: {
        coordinate: { lat: 34.84, lng: 128.69 },
        name: "검증된 장소",
        placeSource: "naver_geocode",
        placeSourceRef: "naver_geocode:verified:34.840000:128.690000",
        role: "visit",
      },
    },
    {
      clientId: "test-naver-client-id",
      clientSecret: "test-naver-client-secret",
      fetchImpl: async () => {
        providerCalled = true;
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      },
    },
  );

  assert.equal(providerCalled, true);
  assert.equal(sourceBackedResult.candidates[0]?.source, "naver_geocode");
}

/** Verifies a required landmark cannot drift to a business that only embeds its name. */
function assertRequiredPlaceCandidateSelectionContract(): void {
  const hairSalon = createMockNaverPlaceCandidate(
    "박승철헤어스투디오 동탄호수공원점",
    0,
  );
  const lakePark = createMockNaverPlaceCandidate("동탄호수공원", 1);
  const subwayStation = createMockNaverPlaceCandidate("강동역 5호선", 2);
  const officeAmenity = {
    ...createMockNaverPlaceCandidate("무더위쉼터 마포구청사무더위쉼터", 3),
    address: "서울특별시 마포구 월드컵로 212 (마포구청)",
  };

  assert.equal(
    selectPlanmeRequiredPlaceCandidate("동탄호수공원", [hairSalon, lakePark])?.name,
    "동탄호수공원",
  );
  assert.equal(
    selectPlanmeRequiredPlaceCandidate("동탄호수공원", [hairSalon]),
    null,
  );
  assert.equal(
    selectPlanmeRequiredPlaceCandidate("강동역", [subwayStation])?.name,
    "강동역 5호선",
  );
  assert.equal(
    selectPlanmeRequiredPlaceCandidate("마포구청", [officeAmenity])?.name,
    "마포구청",
  );
}

/** Verifies a typed retry resolves a landmark after an unrelated branch ranks first. */
async function assertRequiredPlaceQualifiedRetryContract(): Promise<void> {
  let broadOriginName: string | undefined;

  await assert.rejects(
    createCoreAiRecommendedItineraryResponse(
      "http://localhost:3000/api/gpt/itineraries/recommend",
      {
        destination: "부산",
        destinationType: "region",
        durationDays: 2,
        origin: "동탄",
        transportMode: "drive",
      },
      {
        accommodationCandidateSearcher: async () => [],
        aiItineraryGenerator: async (_input, context) => {
          broadOriginName = context?.requiredPlaces?.origin.name;
          throw new Error("broad-origin-display-verified");
        },
        draftGeocoder: async () => ({
          coordinate: { lat: 37.196, lng: 127.098 },
          matchedAddress: "경기도 화성시 오산동 967-152",
          placeSource: "naver_geocode",
          placeSourceRef: "naver_geocode:동탄:37.196000:127.098000",
        }),
        placeCandidateSearcher: async () => ({
          candidates: [],
          searchedQueries: [],
        }),
      },
    ),
    /broad-origin-display-verified/,
  );

  assert.equal(broadOriginName, "동탄 · 경기도 화성시 오산동 967-152");

  const queries: string[] = [];
  let resolvedOriginName: string | undefined;
  const hairSalon = createMockNaverPlaceCandidate(
    "박승철헤어스투디오 동탄호수공원점",
    0,
  );
  const lakePark = createMockNaverPlaceCandidate("동탄호수공원", 1);

  await assert.rejects(
    createCoreAiRecommendedItineraryResponse(
      "http://localhost:3000/api/gpt/itineraries/recommend",
      {
        destination: "남해",
        destinationType: "region",
        durationDays: 2,
        origin: "동탄호수공원",
        transportMode: "transit",
      },
      {
        accommodationCandidateSearcher: async () => [],
        aiItineraryGenerator: async (_input, context) => {
          resolvedOriginName = context?.requiredPlaces?.origin.name;
          throw new Error("required-place-retry-verified");
        },
        draftGeocoder: async () => null,
        placeCandidateSearcher: async ({ query }) => {
          queries.push(query ?? "");
          return {
            candidates: query === "동탄호수공원 공원" ? [lakePark] : [hairSalon],
            searchedQueries: [query ?? ""],
          };
        },
      },
    ),
    /required-place-retry-verified/,
  );

  assert.deepEqual(queries, ["동탄호수공원", "동탄호수공원 공원"]);
  assert.equal(resolvedOriginName, "동탄호수공원");

  const officeQueries: string[] = [];
  const officeAmenity = {
    ...createMockNaverPlaceCandidate("무더위쉼터 마포구청사무더위쉼터", 4),
    address: "서울특별시 마포구 월드컵로 212 (마포구청)",
  };

  await assert.rejects(
    createCoreAiRecommendedItineraryResponse(
      "http://localhost:3000/api/gpt/itineraries/recommend",
      {
        destination: "남해",
        destinationType: "region",
        durationDays: 2,
        origin: "마포구청",
        transportMode: "drive",
      },
      {
        accommodationCandidateSearcher: async () => [],
        aiItineraryGenerator: async (_input, context) => {
          assert.equal(context?.requiredPlaces?.origin.name, "마포구청");
          throw new Error("government-office-retry-verified");
        },
        draftGeocoder: async () => null,
        placeCandidateSearcher: async ({ query }) => {
          officeQueries.push(query ?? "");
          return {
            candidates: query === "마포구청 청사" ? [officeAmenity] : [],
            searchedQueries: [query ?? ""],
          };
        },
      },
    ),
    /government-office-retry-verified/,
  );

  assert.deepEqual(officeQueries, ["마포구청", "마포구청 청사"]);
}

/**
 * Verifies non-lodging POIs are accepted only through an explicit candidate decision.
 */
async function assertAiRecommendationPlaceCandidateDecisionContract(): Promise<void> {
  const response = await createAiRecommendedItineraryResponse(
    "http://localhost:3000/api/gpt/itineraries/recommend",
    {
      destination: "거제",
      durationDays: 2, transportMode: "drive",
      origin: "강원도 양양",
      preferences: ["바다전망 숙소", "낚시"],
    },
    {
      accommodationCandidateSearcher: async () => [
        {
          id: "place-geoje-ocean-pension",
          name: "거제 오션펜션",
          address: "경상남도 거제시 일운면",
          coordinate: { lat: 34.8421, lng: 128.7022 },
          placeId: "places/geoje-ocean-pension",
          types: ["lodging"],
        },
      ],
      aiItineraryGenerator: async () => ({
        title: "거제 바다전망 낚시 여행 1박 2일",
        region: "거제",
        duration: "1박 2일",
        summary: "양양에서 거제로 이동해 바다전망 숙소와 낚시를 즐기는 일정입니다.",
        origin: "강원도 양양",
        assumptions: ["강원도 양양 출발", "낚시 선호"],
        savedMinutes: 50,
        days: [
          {
            day: 1,
            label: "Day 1",
            standardDurationMinutes: 620,
            carrymeDurationMinutes: 560,
            standardRouteText: "강원도 양양 → 거제 숙소 → 거제도 바다 낚시터",
            carrymeRouteText: "강원도 양양 → 거제도 바다 낚시터 → 거제 숙소",
            stops: [
              {
                name: "강원도 양양",
                role: "origin",
                caption: "출발",
                addressQuery: "강원도 양양",
              },
              { name: "거제도 바다 낚시터", role: "visit", caption: "낚시" },
              { name: "거제 숙소", role: "luggageDestination", caption: "짐 도착" },
            ],
            timeline: [
              {
                time: "09:30",
                title: "강원도 양양 출발",
                description: "거제로 이동합니다.",
                category: "arrival",
              },
              {
                time: "15:00",
                title: "거제도 바다 낚시터 방문",
                description: "바다 낚시를 즐깁니다.",
                category: "event",
              },
            ],
          },
        ],
      }),
      draftGeocoder: async ({ query }) =>
        query.includes("양양") ? { coordinate: { lat: 38.0754, lng: 128.6191 } } : null,
      placeCandidateSearcher: async ({ stop }) => ({
        candidates:
          stop.name === "거제도 바다 낚시터"
            ? [
                {
                  candidateId: "google_text_search:places/geoje-fishing-park:거제 바다낚시:34.812300:128.702100",
                  id: "places/geoje-fishing-park",
                  name: "거제바다낚시공원",
                  address: "경상남도 거제시 일운면",
                  coordinate: { lat: 34.8123, lng: 128.7021 },
                  placeId: "places/geoje-fishing-park",
                  query: "거제 바다낚시",
                  source: "naver_local",
                  sourceRef:
                    "google_text_search:places/geoje-fishing-park:거제 바다낚시:34.812300:128.702100",
                  types: ["tourist_attraction"],
                },
              ]
            : [],
        searchedQueries: ["거제 바다낚시", "거제 낚시터", "거제 낚시공원"],
      }),
      placeCandidateDecider: async ({ candidates }) => ({
        reason: "사용자 낚시 의도와 실제 낚시공원 후보가 일치합니다.",
        selectedCandidateId: candidates[0]?.candidateId,
        status: "accepted",
      }),
    },
  );

  assertReadyRecommendation(response);

  const renderedPayload = JSON.stringify(response.itinerary);
  const fishingStop = response.itinerary.days[0]?.standard.stops.find(
    (stop) => stop.label === "거제바다낚시공원",
  );

  assert.equal(fishingStop?.coordinate?.lat, 34.8123);
  assert.equal(fishingStop?.placeId, "places/geoje-fishing-park");
  assert.equal(fishingStop?.placeSource, "naver_local");
  assert.match(renderedPayload, /거제바다낚시공원/);
  assert.doesNotMatch(renderedPayload, /거제도 바다 낚시터/);
  assert.equal(response.resolutionLogs?.[0]?.source, "naver_local");
  assert.equal(response.resolutionLogs?.[0]?.decisionStatus, "accepted");
}

/**
 * Verifies an unresolved intermediate place is replaced at most twice and then excluded.
 */
async function assertIntermediatePlaceExclusionContract(): Promise<void> {
  const replacementAttempts: number[] = [];
  const response = await createAiRecommendedItineraryResponse(
    "http://localhost:3000/api/gpt/itineraries/recommend",
    { destination: "거제", durationDays: 2, transportMode: "drive", origin: "강원도 양양", preferences: ["낚시"] },
    {
      accommodationCandidateSearcher: async () => [
        {
          id: "place-geoje-ocean-pension",
          name: "거제 오션펜션",
          address: "경상남도 거제시 일운면",
          coordinate: { lat: 34.8421, lng: 128.7022 },
          placeId: "places/geoje-ocean-pension",
          types: ["lodging"],
        },
      ],
      aiItineraryGenerator: async () => ({
        title: "거제 낚시 여행 1박 2일",
        region: "거제",
        duration: "1박 2일",
        summary: "좌표 실패 clarification 테스트",
        origin: "강원도 양양",
        assumptions: ["낚시 선호"],
        days: [
          {
            day: 1,
            label: "Day 1",
            stops: [
              { name: "강원도 양양", role: "origin", caption: "출발" },
              { name: "거제도 바다 낚시터", role: "visit", caption: "낚시" },
              { name: "거제 숙소", role: "luggageDestination", caption: "짐 도착" },
            ],
            timeline: [
              {
                time: "09:30",
                title: "강원도 양양 출발",
                description: "거제로 이동합니다.",
                category: "arrival",
              },
            ],
          },
        ],
      }),
      draftGeocoder: async ({ query }) =>
        query.includes("양양") ? { coordinate: { lat: 38.0754, lng: 128.6191 } } : null,
      placeCandidateSearcher: async () => ({
        candidates: [],
        searchedQueries: ["거제 바다낚시", "거제 낚시터", "거제 낚시공원"],
      }),
      replacementQuerySuggester: async ({ attempt }) => {
        replacementAttempts.push(attempt);
        return attempt === 1 ? "거제 낚시공원" : "거제 방파제 낚시";
      },
    },
  );

  assertReadyRecommendation(response);
  const renderedPayload = JSON.stringify(response.itinerary);

  assert.deepEqual(replacementAttempts, [1, 2]);
  assert.doesNotMatch(renderedPayload, /거제도 바다 낚시터/);
  assert.equal(
    response.resolutionLogs?.some(
      (log) => log.originalName === "거제도 바다 낚시터" && log.decisionStatus === "rejected",
    ),
    true,
  );
}

/** Verifies exclusion keeps stable timeline stop indexes aligned with filtered routes. */
async function assertIntermediateExclusionReindexesTimeline(): Promise<void> {
  const createStops = () => [
    {
      caption: "출발",
      coordinate: { lat: 37.535, lng: 127.123 },
      name: "강동역",
      placeSource: "naver_geocode" as const,
      placeSourceRef: "naver_geocode:강동역",
      requiredPlaceKind: "origin" as const,
      role: "출발지" as const,
    },
    { caption: "방문", name: "확인 불가 중간 장소", role: "방문지" as const },
    {
      caption: "방문",
      coordinate: { lat: 34.8, lng: 128.04 },
      name: "확정 방문지",
      placeSource: "naver_local" as const,
      placeSourceRef: "naver_local:확정-방문지",
      role: "방문지" as const,
    },
    {
      caption: "복귀",
      coordinate: { lat: 37.535, lng: 127.123 },
      name: "강동역",
      placeSource: "naver_geocode" as const,
      placeSourceRef: "naver_geocode:강동역",
      requiredPlaceKind: "origin" as const,
      role: "복귀지" as const,
    },
  ];
  const createTimeline = () => createStops().map((stop, stopIndex) => ({
    category: stopIndex === 0 ? "arrival" as const : "event" as const,
    description: `${stop.name} 일정`,
    stayDurationMinutes: stopIndex === 0 ? 0 : 60,
    stopIndex,
    time: `${String(8 + stopIndex).padStart(2, "0")}:00`,
    title: stop.name,
  }));
  const response = await createAiRecommendedItineraryResponse(
    "http://localhost:3000/api/gpt/itineraries/recommend",
    {
      destination: "남해",
      destinationType: "region",
      durationDays: 1,
      origin: "강동역",
      transportMode: "transit",
    },
    {
      accommodationCandidateSearcher: async () => [],
      aiItineraryGenerator: async () => ({
        days: [
          {
            carrymeStops: createStops(),
            carrymeTimeline: createTimeline(),
            day: 1,
            label: "Day 1",
            standardStops: createStops(),
            standardTimeline: createTimeline(),
          },
        ],
        duration: "당일",
        origin: "강동역",
        region: "남해",
        summary: "중간 장소 제외 참조 테스트",
        title: "남해 일정",
        transportMode: "transit",
      }),
      draftGeocoder: async ({ query }) =>
        query.includes("강동역")
          ? {
              coordinate: { lat: 37.535, lng: 127.123 },
              placeSource: "naver_geocode" as const,
              placeSourceRef: `naver_geocode:${query}`,
            }
          : null,
      placeCandidateSearcher: async () => ({ candidates: [], searchedQueries: [] }),
      replacementQuerySuggester: async () => null,
    },
  );

  assertReadyRecommendation(response);
  const day = response.itinerary.days[0];
  const routeStopRefs = day.standard.stops.map((stop) => stop.stopRef);
  const timelineStopRefs = day.standardTimeline?.map((event) => event.stopRef);

  assert.deepEqual(timelineStopRefs, routeStopRefs);
  assert.equal(day.standard.stops.some((stop) => stop.label === "확인 불가 중간 장소"), false);
}

/** Verifies chronological timeline order realigns model-authored route arrays. */
async function assertTimelineOrderRealignsRoute(): Promise<void> {
  const stops = [
    {
      caption: "출발",
      coordinate: { lat: 37.535, lng: 127.123 },
      name: "강동역",
      placeSource: "naver_geocode" as const,
      placeSourceRef: "naver_geocode:강동역",
      requiredPlaceKind: "origin" as const,
      role: "출발지" as const,
    },
    {
      caption: "방문",
      coordinate: { lat: 34.8, lng: 128.04 },
      name: "방문지 A",
      placeSource: "naver_local" as const,
      placeSourceRef: "naver_local:방문지-a",
      role: "방문지" as const,
    },
    {
      caption: "방문",
      coordinate: { lat: 34.81, lng: 128.05 },
      name: "방문지 B",
      placeSource: "naver_local" as const,
      placeSourceRef: "naver_local:방문지-b",
      role: "방문지" as const,
    },
    {
      caption: "복귀",
      coordinate: { lat: 37.535, lng: 127.123 },
      name: "강동역",
      placeSource: "naver_geocode" as const,
      placeSourceRef: "naver_geocode:강동역",
      requiredPlaceKind: "origin" as const,
      role: "복귀지" as const,
    },
  ];
  const timeline = [0, 2, 1, 3].map((stopIndex, eventIndex) => ({
    category: eventIndex === 0 ? "arrival" as const : "event" as const,
    description: `${stops[stopIndex].name} 일정`,
    stayDurationMinutes: eventIndex === 0 ? 0 : 60,
    stopIndex,
    time: `${String(8 + eventIndex).padStart(2, "0")}:00`,
    title: stops[stopIndex].name,
  }));
  const response = await createAiRecommendedItineraryResponse(
    "http://localhost:3000/api/gpt/itineraries/recommend",
    {
      destination: "남해",
      destinationType: "region",
      durationDays: 1,
      origin: "강동역",
      transportMode: "transit",
    },
    {
      accommodationCandidateSearcher: async () => [],
      aiItineraryGenerator: async () => ({
        days: [
          {
            carrymeStops: structuredClone(stops),
            carrymeTimeline: structuredClone(timeline),
            day: 1,
            label: "Day 1",
            standardStops: structuredClone(stops),
            standardTimeline: structuredClone(timeline),
          },
        ],
        duration: "당일",
        origin: "강동역",
        region: "남해",
        summary: "경로 순서 정렬 테스트",
        title: "남해 일정",
        transportMode: "transit",
      }),
      draftGeocoder: async ({ query }) => ({
        coordinate: { lat: 37.535, lng: 127.123 },
        placeSource: "naver_geocode" as const,
        placeSourceRef: `naver_geocode:${query}`,
      }),
      placeCandidateSearcher: async () => ({ candidates: [], searchedQueries: [] }),
    },
  );

  assertReadyRecommendation(response);
  const day = response.itinerary.days[0];

  assert.deepEqual(
    day.standard.stops.map((stop) => stop.label),
    ["강동역", "방문지 B", "방문지 A", "강동역"],
  );
  assert.deepEqual(
    day.standardTimeline?.map((event) => event.stopRef),
    day.standard.stops.map((stop) => stop.stopRef),
  );
  assert.notEqual(day.standard.stops.at(0)?.stopRef, day.standard.stops.at(-1)?.stopRef);
}

/**
 * Verifies a single clarification answer string is normalized into previousAnswers.
 */
async function assertSingleClarificationAnswerContract(): Promise<void> {
  const response = await createAiRecommendedItineraryResponse(
    "http://localhost:3000/api/gpt/itineraries/recommend",
    {
      clarificationAnswers: "방파제 낚시 위주로 찾아줘",
      clarificationContext: {
        previousAnswers: ["바다 낚시"],
        previousQuestions: ["낚시 장르를 알려주세요."],
        round: 1,
        unresolvedPlaces: ["거제도 바다 낚시터"],
      },
      destination: "거제",
      durationDays: 2, transportMode: "drive",
      origin: "강원도 양양",
      preferences: ["낚시"],
    },
    {
      accommodationCandidateSearcher: async () => [],
      aiItineraryGenerator: async () => ({
        title: "거제 낚시 여행 1박 2일",
        region: "거제",
        duration: "1박 2일",
        summary: "단일 clarification answer 테스트",
        origin: "강원도 양양",
        assumptions: ["낚시 선호"],
        days: [
          {
            day: 1,
            label: "Day 1",
            stops: [{ name: "거제도 바다 낚시터", role: "visit", caption: "낚시" }],
            timeline: [
              {
                time: "15:00",
                title: "거제도 바다 낚시터 방문",
                description: "장소 확인 필요",
                category: "event",
              },
            ],
          },
        ],
      }),
      placeCandidateSearcher: async () => ({
        candidates: [],
        searchedQueries: ["거제 방파제 낚시"],
      }),
    },
  );

  assert.equal(isPlanmeClarificationResponse(response), true);

  if (!isPlanmeClarificationResponse(response)) {
    throw new Error("Expected clarification response");
  }

  assert.deepEqual(response.clarificationContext.previousAnswers, [
    "바다 낚시",
    "방파제 낚시 위주로 찾아줘",
  ]);
  assert.equal(response.clarificationContext.round, 2);
}

/**
 * Verifies the second follow-up performs a final internal candidate selection.
 */
async function assertFinalClarificationDecisionContract(): Promise<void> {
  clearMemoryUsageCounters();

  const fixedDate = new Date("2026-07-09T12:00:00.000Z");
  const response = await createAiRecommendedItineraryResponse(
    "http://localhost:3000/api/gpt/itineraries/recommend",
    {
      clarificationAnswers: ["방파제에서 낚시하고 싶어"],
      clarificationContext: {
        previousAnswers: ["거제 바다 낚시"],
        previousQuestions: ["낚시 장르를 알려주세요."],
        round: 2,
        unresolvedPlaces: ["거제도 바다 낚시터"],
      },
      destination: "거제",
      durationDays: 2, transportMode: "drive",
      origin: "강원도 양양",
      preferences: ["낚시"],
    },
    {
      accommodationCandidateSearcher: async () => [],
      aiItineraryGenerator: async () => ({
        title: "거제 낚시 여행 1박 2일",
        region: "거제",
        duration: "1박 2일",
        summary: "최후 확정 테스트",
        origin: "강원도 양양",
        assumptions: ["낚시 선호"],
        days: [
          {
            day: 1,
            label: "Day 1",
            standardDurationMinutes: 620,
            carrymeDurationMinutes: 580,
            standardRouteText: "강원도 양양 → 거제도 바다 낚시터",
            carrymeRouteText: "강원도 양양 → 거제도 바다 낚시터",
            stops: [
              {
                name: "거제도 바다 낚시터",
                role: "visit",
                caption: "낚시",
              },
            ],
            timeline: [
              {
                time: "15:00",
                title: "거제도 바다 낚시터 방문",
                description: "방파제 낚시를 즐깁니다.",
                category: "event",
              },
            ],
          },
        ],
      }),
      placeCandidateSearcher: async () => ({
        candidates: [
          {
            candidateId:
              "google_text_search:places/geoje-final-fishing:거제 방파제 낚시:34.812300:128.702100",
            id: "places/geoje-final-fishing",
            name: "거제방파제낚시공원",
            address: "경상남도 거제시 일운면",
            coordinate: { lat: 34.8123, lng: 128.7021 },
            placeId: "places/geoje-final-fishing",
            query: "거제 방파제 낚시",
            source: "naver_local",
            sourceRef:
              "google_text_search:places/geoje-final-fishing:거제 방파제 낚시:34.812300:128.702100",
            types: ["point_of_interest"],
          },
        ],
        searchedQueries: ["거제 방파제 낚시"],
      }),
      placeCandidateDecider: async ({ finalAttempt }) => ({
        questions: finalAttempt ? [] : ["낚시 장르를 알려주세요."],
        reason: "아직 낚시 장르가 애매합니다.",
        status: "ambiguous",
      }),
      usageRecorder: createPlanmeUsageRecorder({
        now: () => fixedDate,
      }),
    },
  );

  assertReadyRecommendation(response);
  assert.equal(response.itinerary.days[0]?.standard.stops[0]?.label, "거제방파제낚시공원");
  assert.equal(response.resolutionLogs?.[0]?.decisionStatus, "accepted");
  assert.match(response.resolutionLogs?.[0]?.reason ?? "", /내부 AI 최후 확정/);
  assert.equal(readMemoryUsageCounter("final_ai_decision", fixedDate), 1);
}

/**
 * Verifies the final round still fails closed when the last search has no candidates.
 */
async function assertFinalClarificationWithoutCandidateContract(): Promise<void> {
  const response = await createAiRecommendedItineraryResponse(
    "http://localhost:3000/api/gpt/itineraries/recommend",
    {
      clarificationAnswers: ["방파제에서 낚시하고 싶어"],
      clarificationContext: {
        previousAnswers: ["거제 바다 낚시"],
        previousQuestions: ["낚시 장르를 알려주세요."],
        round: 2,
        unresolvedPlaces: ["존재하지 않는 낚시터"],
      },
      destination: "거제",
      durationDays: 2, transportMode: "drive",
      origin: "강원도 양양",
      preferences: ["낚시"],
    },
    {
      accommodationCandidateSearcher: async () => [],
      aiItineraryGenerator: async () => ({
        title: "거제 낚시 여행 1박 2일",
        region: "거제",
        duration: "1박 2일",
        summary: "최후 실패 테스트",
        origin: "강원도 양양",
        assumptions: ["낚시 선호"],
        days: [
          {
            day: 1,
            label: "Day 1",
            stops: [{ name: "존재하지 않는 낚시터", role: "visit", caption: "낚시" }],
            timeline: [
              {
                time: "15:00",
                title: "존재하지 않는 낚시터 방문",
                description: "후보 없음 테스트",
                category: "event",
              },
            ],
          },
        ],
      }),
      placeCandidateSearcher: async () => ({
        candidates: [],
        searchedQueries: ["거제 존재하지 않는 낚시터"],
      }),
    },
  );

  assert.equal(isPlanmeClarificationResponse(response), true);

  if (!isPlanmeClarificationResponse(response)) {
    throw new Error("Expected final round clarification without candidates");
  }

  assert.equal("pageUrl" in response, false);
  assert.deepEqual(response.unresolvedStops, ["존재하지 않는 낚시터"]);
  assert.equal(response.clarificationContext.round, 2);
}

/**
 * Verifies coordinate-only intermediate stops are excluded when no source reference exists.
 */
async function assertCoordinateOnlyIntermediateExclusionContract(): Promise<void> {
  const response = await createAiRecommendedItineraryResponse(
    "http://localhost:3000/api/gpt/itineraries/recommend",
    {
      destination: "거제",
      durationDays: 2, transportMode: "drive",
      origin: "강원도 양양",
      title: "좌표만 있는 장소 차단 테스트",
      days: [
        {
          day: 1,
          label: "Day 1",
          stops: [
            {
              name: "좌표만 있는 장소",
              role: "visit",
              caption: "확인 필요",
              coordinate: { lat: 34.8, lng: 128.7 },
            },
          ],
          timeline: [
            {
              time: "10:00",
              title: "좌표만 있는 장소 방문",
              description: "검색 출처 없는 좌표를 차단합니다.",
              category: "event",
            },
          ],
        },
      ],
    },
    {
      accommodationCandidateSearcher: async () => [],
      placeCandidateSearcher: async ({ stop }) => ({
        candidates: [],
        searchedQueries: [stop.name],
      }),
      replacementQuerySuggester: async () => null,
    },
  );

  assertReadyRecommendation(response);
  const firstDay = response.itinerary.days[0];
  assert.equal(
    firstDay?.standard.stops.some((stop) => stop.label === "좌표만 있는 장소"),
    false,
  );
  assert.doesNotMatch(JSON.stringify(firstDay?.timeline), /좌표만 있는 장소/);
  assert.equal(
    response.resolutionLogs?.some(
      (log) => log.originalName === "좌표만 있는 장소" && log.decisionStatus === "rejected",
    ),
    true,
  );
}

/**
 * Verifies a route line is not created when any draft stop still lacks a coordinate.
 */
function assertDraftGeoPathRequiresCompleteCoordinates(): void {
  const preview = createPlanmeDraftPreview({
    transportMode: "drive",
    title: "거제 좌표 누락 테스트",
    region: "거제",
    duration: "1박 2일",
    summary: "좌표 누락 route line 차단 테스트",
    origin: "강원도 양양",
    assumptions: ["강원도 양양 출발"],
    days: [
      {
        day: 1,
        label: "Day 1",
        stops: [
          {
            name: "강원도 양양",
            role: "origin",
            caption: "출발",
            coordinate: { lat: 38.0754, lng: 128.6191 },
          },
          { name: "좌표 없는 방문지", role: "visit", caption: "방문" },
        ],
        timeline: [
          {
            time: "09:30",
            title: "강원도 양양 출발",
            description: "좌표 누락 테스트",
            category: "arrival",
          },
        ],
      },
    ],
  });

  assert.equal(preview.itinerary.days[0]?.standard.geoPath, undefined);
}

/**
 * Verifies generated detail URLs stay readable without repeating region tokens.
 */
function assertDraftPreviewSlugContract(): void {
  const preview = createPlanmeDraftPreview({
    transportMode: "drive",
    title: "남해 2일 가족 여행",
    region: "경상남도 남해",
    duration: "2일",
    summary: "아이 동반 가족이 남해를 무리 없이 보는 일정입니다.",
    days: [
      {
        day: 1,
        label: "Day 1",
        stops: [
          { name: "남해 숙소", caption: "출발" },
          { name: "상주은모래비치", caption: "해변" },
          { name: "독일마을", caption: "관광" },
        ],
        timeline: [
          {
            time: "09:00",
            title: "남해 숙소 출발",
            description: "가족 여행을 시작합니다.",
            category: "arrival",
          },
          {
            time: "11:00",
            title: "상주은모래비치 산책",
            description: "아이와 함께 바다를 봅니다.",
            category: "event",
          },
        ],
      },
    ],
  });

  assert.match(preview.previewId, /^generated-경상남도-남해-2일-가족-여행-2d-/);
  assert.doesNotMatch(preview.previewId, /남해-남해/);
}

/** Keeps a timeline row aligned with the resolved stop instead of model-repeated region text. */
function assertTimelineUsesCanonicalResolvedStopLabel(): void {
  const preview = createPlanmeDraftPreview({
    transportMode: "drive",
    title: "부산 2일 핵심 명소 여행",
    region: "부산",
    duration: "1박 2일",
    summary: "장소명 정규화 테스트",
    days: [
      {
        day: 1,
        label: "Day 1",
        stops: [
          { name: "동탄", caption: "출발", role: "출발지" },
          { name: "부산자갈치시장", caption: "방문", role: "방문지" },
        ],
        timeline: [
          {
            category: "arrival",
            description: "부산으로 출발합니다.",
            stopIndex: 0,
            time: "08:00",
            title: "동탄 출발",
          },
          {
            category: "event",
            description: "시장을 둘러봅니다.",
            stopIndex: 1,
            time: "12:00",
            title: "부산부산부산자갈치시장 방문",
          },
        ],
      },
    ],
  });
  const day = preview.itinerary.days[0];

  assert.equal(day?.standardTimeline?.[1]?.title, "부산자갈치시장 방문");
  assert.equal(day?.carrymeTimeline?.[1]?.title, "부산자갈치시장 방문");
  assert.doesNotMatch(JSON.stringify(day), /부산부산/);
}

/**
 * Verifies that plain train or subway stations are not rendered as CarryME luggage handoff points.
 */
function assertStationLuggageGuardrail(): void {
  const problematicDraft = createPlanmeDraftPreview({
    transportMode: "transit",
    title: "부산 가족 여행 1박 2일 초안",
    region: "부산",
    duration: "1박 2일",
    summary: "부산역 도착 후 감천문화마을을 보는 초안입니다.",
    origin: "서울역",
    assumptions: ["서울역 출발", "부산역은 교통 거점"],
    savedMinutes: 60,
    days: [
      {
        day: 1,
        label: "Day 1",
        standardDurationMinutes: 600,
        carrymeDurationMinutes: 540,
        standardRouteText: "서울역 → 부산역 → 감천문화마을 → 부산역 인근 숙소",
        carrymeRouteText: "서울역 → 부산역 → 감천문화마을 → 부산역 인근 숙소",
        stops: [
          { name: "서울역", caption: "출발" },
          { name: "부산역", caption: "짐 보관" },
          { name: "감천문화마을", caption: "관광" },
          { name: "부산역 인근 숙소", caption: "체크인" },
        ],
        timeline: [
          {
            time: "07:00",
            title: "서울역 출발",
            description: "서울에서 부산으로 이동합니다.",
            category: "arrival",
          },
          {
            time: "11:00",
            title: "부산역 도착",
            description: "부산역 도착 후 짐 보관 및 관광 준비",
            category: "transit",
          },
          {
            time: "12:00",
            title: "감천문화마을 방문",
            description: "부산의 대표 문화마을을 둘러봅니다.",
            category: "event",
            savingLabel: "약 60분 절약",
          },
          {
            time: "17:00",
            title: "부산역 복귀 및 짐 회수",
            description: "부산역에서 짐을 챙기고 숙소 체크인을 준비합니다.",
            category: "hotel",
          },
          {
            time: "18:00",
            title: "부산역 이동",
            description: "부산역에서 짐을 챙기고 기차 탑승을 준비합니다.",
            category: "transit",
          },
        ],
      },
    ],
  });
  const renderedPayload = JSON.stringify(problematicDraft.itinerary);

  assert.equal(problematicDraft.status, "preview_ready");
  assert.match(renderedPayload, /부산 숙소/);
  assert.doesNotMatch(renderedPayload, /부산역[^"]*(?:짐|수하물)[^"]*(?:보관|수령|회수|챙)/);
  assert.doesNotMatch(renderedPayload, /(?:짐|수하물)[^"]*(?:보관|수령|회수|챙)[^"]*부산역/);

  const generatedBusan = createGeneratedItinerary({
    destination: "부산",
    durationDays: 2, transportMode: "drive",
    origin: "서울역",
    preferences: ["감천문화마을"],
  });
  const generatedPayload = JSON.stringify(generatedBusan);

  assert.doesNotMatch(generatedPayload, /부산역[^"]*(?:짐|수하물)[^"]*(?:보관|수령|회수|챙)/);
  assert.doesNotMatch(generatedPayload, /(?:짐|수하물)[^"]*(?:보관|수령|회수|챙)[^"]*부산역/);
}

/**
 * Verifies Standard traveler events and CarryME parcel events are normalized before validation.
 */
function assertRouteSpecificTimelineNormalization(): void {
  const input = {
    transportMode: "drive" as const,
    title: "부산 시간표 의미 정규화 테스트",
    region: "부산",
    duration: "1박 2일",
    summary: "Standard 체크인과 CarryME 배송 사건을 구분합니다.",
    days: [
      {
        day: 1,
        label: "Day 1",
        standardStops: [
          { name: "동탄역", caption: "출발", mode: "drive" as const, role: "출발지" as const },
          { name: "파라다이스 호텔 부산", caption: "체크인", mode: "drive" as const, role: "숙소" as const },
          { name: "동백섬", caption: "관광", mode: "drive" as const, role: "방문지" as const },
        ],
        carrymeStops: [
          { name: "동탄역", caption: "출발", mode: "drive" as const, role: "출발지" as const },
          { name: "동백섬", caption: "관광", mode: "drive" as const, role: "방문지" as const },
          { name: "파라다이스 호텔 부산", caption: "도착", mode: "drive" as const, role: "숙소" as const },
        ],
        standardTimeline: [
          {
            time: "07:00",
            title: "동탄역 출발",
            description: "부산으로 출발합니다.",
            category: "arrival" as const,
          },
          {
            time: "13:00",
            title: "파라다이스 호텔 부산 체크인 전 짐 보관",
            description: "호텔에 들러 짐을 맡깁니다.",
            category: "hotel" as const,
          },
          {
            time: "18:00",
            title: "파라다이스 호텔 부산 도착",
            description: "관광 후 호텔로 돌아옵니다.",
            category: "hotel" as const,
          },
          {
            time: "18:00",
            title: "짐 파라다이스 호텔 부산 도착",
            description: "짐이 호텔에 먼저 도착한 것으로 처리합니다.",
            category: "hotel" as const,
          },
        ],
        carrymeTimeline: [
          {
            time: "07:00",
            title: "동탄역 출발",
            description: "부산으로 출발합니다.",
            category: "arrival" as const,
          },
          {
            time: "13:00",
            title: "짐 파라다이스 호텔 부산 도착",
            description: "짐이 호텔에 먼저 도착한 것으로 처리합니다.",
            category: "hotel" as const,
          },
          {
            time: "18:00",
            title: "파라다이스 호텔 부산 도착",
            description: "관광 후 호텔로 이동합니다.",
            category: "hotel" as const,
          },
        ],
      },
    ],
  };
  const inputSnapshot = JSON.stringify(input);
  const preview = createPlanmeDraftPreview(input);
  const day = preview.itinerary.days[0];
  const standardPayload = JSON.stringify(day?.standardTimeline);
  const carrymeDelivery = day?.carrymeTimeline?.find((event) =>
    event.title.startsWith("짐 파라다이스 호텔 부산 도착"),
  );

  assert.equal(preview.status, "preview_ready");
  assert.match(standardPayload, /파라다이스 호텔 부산 체크인/);
  assert.match(standardPayload, /호텔에 체크인한 뒤 다음 일정으로 이동합니다/);
  assert.match(standardPayload, /파라다이스 호텔 부산 도착/);
  assert.doesNotMatch(standardPayload, /짐 파라다이스 호텔 부산 도착/);
  assert.equal(carrymeDelivery?.category, "carryme");
  assert.equal(JSON.stringify(input), inputSnapshot);

  const finalDayPreview = createPlanmeDraftPreview({
    ...input,
    previewId: "generated-final-day-lodging-return",
    days: [
      input.days[0],
      {
        ...input.days[0],
        day: 2,
        standardStops: [
          ...(input.days[0]?.standardStops ?? []),
          { name: "동탄역", caption: "복귀", mode: "drive", role: "복귀지" },
        ],
        carrymeStops: [
          ...(input.days[0]?.carrymeStops ?? []),
          { name: "동탄역", caption: "복귀", mode: "drive", role: "복귀지" },
        ],
        standardTimeline: [
          {
            time: "16:00",
            title: "동백섬 관광",
            description: "마지막 관광 일정을 진행합니다.",
            category: "event",
          },
          {
            time: "18:00",
            title: "파라다이스 호텔 부산 복귀",
            description: "호텔로 돌아와 휴식합니다.",
            category: "hotel",
          },
          {
            time: "22:00",
            title: "동탄역 도착",
            description: "복귀지에서 일정을 마칩니다.",
            category: "transit",
          },
        ],
        carrymeTimeline: [
          {
            time: "13:00",
            title: "짐 파라다이스 호텔 부산 도착",
            description: "짐이 호텔에 도착했습니다.",
            category: "hotel",
          },
          {
            time: "16:00",
            title: "동백섬 관광",
            description: "마지막 관광 일정을 진행합니다.",
            category: "event",
          },
          {
            time: "18:00",
            title: "파라다이스 호텔 부산 숙박",
            description: "호텔로 이동해 휴식합니다.",
            category: "hotel",
          },
          {
            time: "22:00",
            title: "동탄역 도착",
            description: "복귀지에서 일정을 마칩니다.",
            category: "transit",
          },
        ],
      },
    ],
  });
  const firstDay = finalDayPreview.itinerary.days[0];
  const finalDay = finalDayPreview.itinerary.days[1];

  assert.match(JSON.stringify(firstDay?.standardTimeline), /파라다이스 호텔 부산 도착/);
  assert.doesNotMatch(JSON.stringify(finalDay?.standardTimeline), /호텔 부산 복귀/);
  assert.doesNotMatch(JSON.stringify(finalDay?.carrymeTimeline), /호텔 부산 숙박/);
  assert.match(JSON.stringify(finalDay?.carrymeTimeline), /짐 동탄역 도착/);
  assert.doesNotMatch(JSON.stringify(finalDay?.carrymeTimeline), /짐 파라다이스 호텔 부산 도착/);
  assert.match(JSON.stringify(finalDay?.standardTimeline), /동탄역 도착/);
  assert.match(JSON.stringify(finalDay?.carrymeTimeline), /동탄역 도착/);

  const invalidPreview = createPlanmeDraftPreview({
    ...input,
    previewId: "generated-standard-delivery-only",
    days: input.days.map((inputDay) => ({
      ...inputDay,
      standardTimeline: [
        {
          time: "13:00",
          title: "짐 파라다이스 호텔 부산 도착",
          description: "짐이 호텔에 도착했습니다.",
          category: "carryme" as const,
        },
      ],
    })),
  });

  assert.equal(invalidPreview.status, "needs_revision");
  assert.equal(
    invalidPreview.validationIssues.some((issue) => issue.code === "missing_timeline"),
    true,
  );
}

/**
 * Verifies MCP does not return a usable detail URL when the web handoff store fails.
 */
async function assertPreviewStoreHandoffFailsClosed(): Promise<void> {
  const originalVercel = process.env.VERCEL;
  const originalWebOrigin = process.env.PLANME_WEB_ORIGIN;
  const originalInternalToken = process.env.PLANME_INTERNAL_API_TOKEN;
  const originalFetch = globalThis.fetch;
  const traceId = "019f7d3e-2e7f-7000-8000-000000000001";
  let capturedTraceId = "";

  try {
    process.env.VERCEL = "1";
    process.env.PLANME_WEB_ORIGIN = "https://planme-demo.test";
    process.env.PLANME_INTERNAL_API_TOKEN = "mcp-contract-internal-token";
    globalThis.fetch = async (_input, init) => {
      capturedTraceId = new Headers(init?.headers).get("x-planme-trace-id") ?? "";
      return new Response(JSON.stringify({ error: "PREVIEW_STORE_UNAVAILABLE" }), {
        headers: { "Content-Type": "application/json" },
        status: 500,
      });
    };

    await assert.rejects(
      () =>
        persistItineraryForDetailPage(
          createGeneratedItinerary({
            destination: "여수",
            durationDays: 2, transportMode: "drive",
            origin: "서울",
          }),
          traceId,
        ),
      (error) =>
        error instanceof PreviewStoreHandoffError &&
        error.internalCode === "PREVIEW_STORE_UNAVAILABLE" &&
        error.status === 500 &&
        error.traceId === traceId,
    );
    assert.equal(capturedTraceId, traceId);
  } finally {
    if (originalVercel === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = originalVercel;
    }

    if (originalWebOrigin === undefined) {
      delete process.env.PLANME_WEB_ORIGIN;
    } else {
      process.env.PLANME_WEB_ORIGIN = originalWebOrigin;
    }

    if (originalInternalToken === undefined) {
      delete process.env.PLANME_INTERNAL_API_TOKEN;
    } else {
      process.env.PLANME_INTERNAL_API_TOKEN = originalInternalToken;
    }

    globalThis.fetch = originalFetch;
  }
}

/**
 * Verifies MCP usage counters can write to memory fallback and Upstash REST pipeline.
 */
async function assertUsageCounterContract(): Promise<void> {
  clearMemoryUsageCounters();

  const fixedDate = new Date("2026-07-09T12:00:00.000Z");
  const memoryRecorder = createPlanmeUsageRecorder({
    now: () => fixedDate,
  });

  await memoryRecorder("openai_request");
  await memoryRecorder("openai_request", 2);

  assert.equal(readMemoryUsageCounter("openai_request", fixedDate), 3);

  let capturedUrl = "";
  let capturedBody = "";
  let capturedAuthorization = "";
  const upstashRecorder = createPlanmeUsageRecorder({
    fetchImpl: async (url, init) => {
      capturedUrl = String(url);
      capturedBody = String(init?.body ?? "");
      capturedAuthorization = (init?.headers as Record<string, string>)?.Authorization ?? "";

      return new Response(JSON.stringify([{ result: 1 }, { result: 1 }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    now: () => fixedDate,
    token: "test-upstash-token",
    url: "https://example-upstash.test",
  });

  await upstashRecorder("naver_local_search_request", 4);

  assert.equal(capturedUrl, "https://example-upstash.test/pipeline");
  assert.equal(capturedAuthorization, "Bearer test-upstash-token");
  assert.match(capturedBody, /INCRBY/);
  assert.match(capturedBody, /planme:usage:2026-07-09:naver_local_search_request/);
  assert.match(capturedBody, /EXPIRE/);
  assert.doesNotMatch(capturedBody, /test-upstash-token/);
}

/**
 * Verifies the GPTs Actions REST facade exposes OpenAPI, planning, and generation errors.
 */
async function assertGptsActionsRestFacade(): Promise<void> {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  const { server, origin } = await startGptsActionsServer();

  try {
    delete process.env.OPENAI_API_KEY;

    const openApiResponse = await fetch(`${origin}/api/gpt/openapi`);
    const openApiPayload = await openApiResponse.json();
    const openApiText = JSON.stringify(openApiPayload);

    assert.equal(openApiResponse.status, 200);
    assert.match(openApiText, /startPlanmePlanning/);
    assert.match(openApiText, /recommendPlanmeItinerary/);
    assert.match(
      openApiPayload.paths["/api/gpt/planning/start"].post.description,
      /four required inputs.*Ask the returned required questions exactly once.*Do not ask for lodging or preferences/i,
    );
    assert.match(
      openApiPayload.paths["/api/gpt/itineraries/recommend"].post.description,
      /call immediately without additional research or optional questions.*Never turn an internal generation failure into a request for more user input/i,
    );
    assert.match(openApiText, /\/api\/gpt\/planning\/start/);
    assert.match(openApiText, /\/api\/gpt\/itineraries\/recommend/);
    assert.deepEqual(
      openApiPayload.components.schemas.PlanmeErrorResponse.required,
      ["error", "message", "retryable", "stage", "status", "traceId"],
    );
    assert.deepEqual(
      openApiPayload.components.schemas.PlanmeErrorResponse.properties.status.enum,
      ["error"],
    );
    assert.ok(
      openApiPayload.components.schemas.RecommendItineraryRequest.properties
        .clarificationAnswers,
    );
    assert.ok(
      openApiPayload.components.schemas.RecommendItineraryRequest.properties
        .clarificationContext,
    );
    assert.deepEqual(
      openApiPayload.components.schemas.RecommendItineraryRequest.properties.transportMode.enum,
      ["drive", "transit", "자동차", "대중교통"],
    );
    assert.match(
      openApiPayload.components.schemas.RecommendItineraryRequest.properties.transportMode
        .description,
      /자동차.*drive|drive.*자동차/,
    );
    assert.equal(
      openApiPayload.components.schemas.RecommendItineraryRequest.required.includes(
        "destinationType",
      ),
      false,
    );
    assert.equal(
      openApiPayload.components.schemas.RecommendItineraryRequest.properties.destinationType
        .default,
      "region",
    );
    assert.equal(
      openApiPayload.components.schemas.PlanmePlanningRequest.properties.durationDays.maximum,
      PLANME_EXTERNAL_MAX_DURATION_DAYS,
    );
    assert.equal(
      openApiPayload.components.schemas.RecommendItineraryRequest.properties.durationDays.maximum,
      PLANME_EXTERNAL_MAX_DURATION_DAYS,
    );
    assert.equal(
      openApiPayload.components.schemas.RecommendItineraryRequest.properties.durationDays
        .description,
      PLANME_EXTERNAL_DURATION_ERROR_MESSAGE,
    );
    const actionResponseProperties =
      openApiPayload.components.schemas.ItineraryActionResponse.properties;

    assert.equal("itinerary" in actionResponseProperties, false);
    assert.equal("previewMarkdown" in actionResponseProperties, false);
    assert.equal("resolutionLogs" in actionResponseProperties, false);
    assert.ok(
      openApiPayload.components.schemas.ItineraryActionResponse.required.includes(
        "detailLinkMarkdown",
      ),
    );
    assert.ok(
      openApiPayload.components.schemas.ItineraryActionResponse.required.includes("days"),
    );
    assert.equal(
      openApiPayload.components.schemas.ItineraryActionResponse.properties.days.items.$ref,
      "#/components/schemas/PlanmeItineraryDaySummary",
    );
    assert.equal(
      openApiPayload.paths["/api/gpt/itineraries/recommend"].post.responses["400"]
        .content["application/json"].schema.$ref,
      "#/components/schemas/InvalidRecommendationRequestResponse",
    );
    assert.deepEqual(
      openApiPayload.components.schemas.InvalidRecommendationRequestResponse.required,
      ["error", "traceId", "validationIssues"],
    );

    const compactFixture = getPlanmeItineraryById("busan-bts-1d1n");
    assert.ok(compactFixture);
    const compactActionPayload = toGptsRestRecommendationResponse(
      toGptActionItineraryResponse(
        compactFixture,
        "http://localhost:3000/api/gpt/itineraries/busan-bts-1d1n",
      ),
    );
    const compactActionText = JSON.stringify(compactActionPayload);

    assert.equal("itinerary" in compactActionPayload, false);
    assert.equal("previewMarkdown" in compactActionPayload, false);
    assert.equal("resolutionLogs" in compactActionPayload, false);
    assert.equal("detailLinkMarkdown" in compactActionPayload, true);
    assert.equal("days" in compactActionPayload, true);

    if ("days" in compactActionPayload) {
      assert.equal(compactActionPayload.days.length, compactFixture.days.length);
    }

    if ("detailLinkMarkdown" in compactActionPayload) {
      assert.equal(
        compactActionPayload.detailLinkMarkdown,
        `[상세 일정 열기](${compactActionPayload.pageUrl})`,
      );
    }

    assert.ok(Buffer.byteLength(compactActionText, "utf8") < 16_384);

    const planningResponse = await fetch(`${origin}/api/gpt/planning/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination: "여수" }),
    });
    const planningPayload = (await planningResponse.json()) as PlanningContent;

    assert.equal(planningResponse.status, 200);
    assert.equal(planningPayload.status, "needs_input");
    assert.equal(planningPayload.nextAction, "ask_user");
    assert.ok(planningPayload.missingSlots?.includes("origin"));

    const unsupportedPlanningResponse = await fetch(`${origin}/api/gpt/planning/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destination: "부산",
        durationDays: PLANME_EXTERNAL_MAX_DURATION_DAYS + 1,
        origin: "동탄",
        transportMode: "drive",
      }),
    });
    const unsupportedPlanningPayload = (await unsupportedPlanningResponse.json()) as {
      error?: string;
      validationIssues?: Array<{ message?: string; path?: string }>;
    };

    assert.equal(unsupportedPlanningResponse.status, 400);
    assert.equal(unsupportedPlanningPayload.error, "INVALID_PLANME_PLANNING_REQUEST");
    assert.ok(
      unsupportedPlanningPayload.validationIssues?.some(
        (issue) =>
          issue.path === "durationDays" &&
          issue.message === PLANME_EXTERNAL_DURATION_ERROR_MESSAGE,
      ),
    );

    const transportOnlyPlanningResponse = await fetch(`${origin}/api/gpt/planning/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destination: "부산",
        durationDays: 2,
        origin: "용산역",
      }),
    });
    const transportOnlyPlanningPayload =
      (await transportOnlyPlanningResponse.json()) as PlanningContent;

    assert.equal(transportOnlyPlanningResponse.status, 200);
    assert.equal(transportOnlyPlanningPayload.status, "needs_input");
    assert.equal(transportOnlyPlanningPayload.nextAction, "ask_user");
    assert.deepEqual(transportOnlyPlanningPayload.missingSlots, ["transportMode"]);
    assert.deepEqual(
      transportOnlyPlanningPayload.questions?.map((question) => question.slot),
      ["transportMode"],
    );

    const koreanPlanningResponse = await fetch(`${origin}/api/gpt/planning/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destination: "부산",
        durationDays: 2,
        origin: "용산역",
        transportMode: "대중교통",
      }),
    });
    const koreanPlanningPayload = (await koreanPlanningResponse.json()) as PlanningContent;

    assert.equal(koreanPlanningResponse.status, 200);
    assert.equal(koreanPlanningPayload.status, "ready");
    assert.equal(koreanPlanningPayload.normalizedInput?.transportMode, "transit");
    assert.equal(koreanPlanningPayload.normalizedInput?.destinationType, "region");
    assert.deepEqual(koreanPlanningPayload.missingSlots, []);
    assert.deepEqual(koreanPlanningPayload.questions, []);

    const originalConsoleError = console.error;
    let validationLogText = "";
    const [invalidRecommendationResponse, invalidRecommendationPayload] = await (async () => {
      try {
        console.error = (...data) => {
          validationLogText += JSON.stringify(data);
        };
        const currentResponse = await fetch(
          `${origin}/api/gpt/itineraries/recommend`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              destination: "부산",
              durationDays: 2,
              origin: "용산역",
              transportMode: "도보",
            }),
          },
        );

        return [currentResponse, await currentResponse.json()] as const;
      } finally {
        console.error = originalConsoleError;
      }
    })();
    const typedInvalidRecommendationPayload = invalidRecommendationPayload as {
      error?: string;
      traceId?: string;
      validationIssues?: Array<{ message?: string; path?: string }>;
    };

    assert.equal(invalidRecommendationResponse.status, 400);
    assert.equal(
      typedInvalidRecommendationPayload.error,
      "INVALID_PLANME_RECOMMENDATION_REQUEST",
    );
    assert.ok(
      typedInvalidRecommendationPayload.validationIssues?.some(
        (issue) => issue.path === "transportMode",
      ),
    );
    assert.match(
      typedInvalidRecommendationPayload.traceId ?? "",
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.match(validationLogText, /planme_gpts_request_validation_failure/);
    assert.match(validationLogText, /"completionStage":"input_interpretation"/);
    assert.match(validationLogText, /"internalCode":"INVALID_PLANME_RECOMMENDATION_REQUEST"/);
    assert.match(validationLogText, /"stage":"request_validation"/);
    assert.match(validationLogText, new RegExp(typedInvalidRecommendationPayload.traceId ?? "^$"));

    const originalDurationConsoleError = console.error;
    let durationValidationLogText = "";
    const [unsupportedRecommendationResponse, unsupportedRecommendationPayload] = await (async () => {
      try {
        console.error = (...data) => {
          durationValidationLogText += JSON.stringify(data);
        };
        const currentResponse = await fetch(`${origin}/api/gpt/itineraries/recommend`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destination: "부산",
            durationDays: PLANME_EXTERNAL_MAX_DURATION_DAYS + 1,
            origin: "동탄",
            transportMode: "drive",
          }),
        });

        return [currentResponse, await currentResponse.json()] as const;
      } finally {
        console.error = originalDurationConsoleError;
      }
    })();
    const typedUnsupportedRecommendationPayload = unsupportedRecommendationPayload as {
      error?: string;
      validationIssues?: Array<{ message?: string; path?: string }>;
    };

    assert.equal(unsupportedRecommendationResponse.status, 400);
    assert.equal(
      typedUnsupportedRecommendationPayload.error,
      "INVALID_PLANME_RECOMMENDATION_REQUEST",
    );
    assert.ok(
      typedUnsupportedRecommendationPayload.validationIssues?.some(
        (issue) =>
          issue.path === "durationDays" &&
          issue.message === PLANME_EXTERNAL_DURATION_ERROR_MESSAGE,
      ),
    );
    assert.match(durationValidationLogText, /planme_gpts_request_validation_failure/);

    const originalConsoleInfo = console.info;
    let responseLogText = "";
    const [recommendationResponse, recommendationText] = await (async () => {
      try {
        console.info = (...data) => {
          responseLogText += JSON.stringify(data);
        };
        const currentResponse = await fetch(`${origin}/api/gpt/itineraries/recommend`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destination: "여수",
            durationDays: 2,
            transportMode: "자동차",
            origin: "서울",
          }),
        });

        return [currentResponse, await currentResponse.text()] as const;
      } finally {
        console.info = originalConsoleInfo;
      }
    })();

    // Provider outages are internal failures and must not be presented as missing user input.
    assert.equal(recommendationResponse.status, 500);
    assert.match(recommendationText, /PLANME_RECOMMENDATION_FAILED/);
    assert.match(recommendationText, /"stage":"place_resolution"/);
    assert.match(recommendationText, /"retryable":false/);
    assert.match(recommendationText, /"traceId":"[0-9a-f-]+"/i);
    assert.doesNotMatch(recommendationText, /needs_clarification|정확한 장소명|주소를 알려/);
    assert.doesNotMatch(recommendationText, /\/itinerary\//);
    assert.match(responseLogText, /planme_gpts_stage/);
    assert.match(
      responseLogText,
      /"traceId":"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"/i,
    );
  } finally {
    server.close();

    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
  }
}

/**
 * Starts the PlanME MCP server on an ephemeral local port for contract checks.
 */
async function startServer() {
  const server = await createPlanmeHttpServer();

  // Port 0 avoids collisions with the web demo and Vercel preview checks.
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const addressInfo = address as AddressInfo;

  return {
    server,
    url: new URL(`http://127.0.0.1:${addressInfo.port}/mcp`),
  };
}

/**
 * Verifies that PlanME MCP tools and resources satisfy the first GPT App PoC contract.
 */
async function main(): Promise<void> {
  assertGptActionMultiDayResponseContract();
  assertExternalDurationBoundaryContract();
  await assertOpenAiGeneratorContract();
  await assertCompactOpenAiGeneratorContract();
  await assertOpenAiFunctionCallingContract();
  await assertOpenAiMissingRequiredToolCallErrorContract();
  await assertOpenAiToolConcurrencyAndDedupContract();
  await assertOpenAiRetryAndTimeoutContract();
  await assertOpenAiPlaceCandidateDecisionContract();
  await assertDraftCoordinateResolverContract();
  await assertNaverGeocoderContract();
  await assertAccommodationCandidateContract();
  await assertAiRecommendationCoordinateResolutionContract();
  await assertProviderAddressLabelDoesNotReplacePlaceName();
  await assertNaverGeocodedVisitHardGateContract();
  await assertThreeDayAiDraftContract();
  await assertNaverAccommodationSearchContract();
  await assertPlaceCandidateSearchContract();
  assertRequiredPlaceCandidateSelectionContract();
  await assertRequiredPlaceQualifiedRetryContract();
  await assertAiRecommendationPlaceCandidateDecisionContract();
  await assertIntermediatePlaceExclusionContract();
  await assertIntermediateExclusionReindexesTimeline();
  await assertTimelineOrderRealignsRoute();
  await assertCoordinateOnlyIntermediateExclusionContract();
  assertDraftPreviewSlugContract();
  assertTimelineUsesCanonicalResolvedStopLabel();
  assertDraftGeoPathRequiresCompleteCoordinates();
  assertStationLuggageGuardrail();
  assertRouteSpecificTimelineNormalization();
  await assertPreviewStoreHandoffFailsClosed();
  await assertUsageCounterContract();
  await assertGptsActionsRestFacade();

  const { server, url } = await startServer();
  const transport = new StreamableHTTPClientTransport(url);
  const client = new Client({
    name: "planme-mcp-contract-check",
    version: "0.1.0",
  });

  try {
    await client.connect(transport);

    assert.match(client.getInstructions() ?? "", /use this server instead of web search/);
    assert.match(client.getInstructions() ?? "", /call recommend_planme_itinerary immediately/);

    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);

    assert.ok(toolNames.includes("recommend_planme_itinerary"));
    assert.ok(toolNames.includes("get_planme_itinerary"));
    assert.ok(toolNames.includes("start_planme_planning"));
    assert.ok(!toolNames.includes("preview_planme_itinerary"));
    assert.ok(!toolNames.includes("update_planme_itinerary_preview"));
    assert.ok(!toolNames.includes("commit_planme_itinerary"));

    const recommendTool = tools.tools.find((tool) => tool.name === "recommend_planme_itinerary");
    const getItineraryTool = tools.tools.find((tool) => tool.name === "get_planme_itinerary");
    const startPlanningTool = tools.tools.find((tool) => tool.name === "start_planme_planning");
    const recommendInputSchema = recommendTool?.inputSchema as
      | {
          properties?: Record<
            string,
            { enum?: string[]; description?: string; maximum?: number }
          >;
          required?: string[];
      }
      | undefined;
    const startPlanningInputSchema = startPlanningTool?.inputSchema as
      | {
          properties?: Record<string, { description?: string; maximum?: number }>;
        }
      | undefined;
    const recommendOutputSchema = recommendTool?.outputSchema as
      | {
          properties?: Record<string, { enum?: string[] }>;
        }
      | undefined;

    assert.ok(recommendInputSchema?.properties);
    assert.equal("days" in recommendInputSchema.properties, false);
    assert.deepEqual(recommendInputSchema.properties.transportMode?.enum, [
      "drive",
      "transit",
      "자동차",
      "대중교통",
    ]);
    assert.match(recommendInputSchema.properties.transportMode?.description ?? "", /자동차.*drive/);
    assert.equal(
      recommendInputSchema.properties.durationDays?.maximum,
      PLANME_EXTERNAL_MAX_DURATION_DAYS,
    );
    assert.equal(
      startPlanningInputSchema?.properties?.durationDays?.maximum,
      PLANME_EXTERNAL_MAX_DURATION_DAYS,
    );
    assert.match(
      recommendInputSchema.properties.durationDays?.description ?? "",
      /최대 3일/,
    );
    assert.equal(recommendInputSchema.required?.includes("destinationType"), false);
    assert.equal(recommendTool?.title, "PlanME 여행 일정 생성 및 저장");
    assert.deepEqual(recommendOutputSchema?.properties?.status?.enum, [
      "ready",
      "needs_clarification",
      "error",
    ]);
    assert.ok(recommendOutputSchema?.properties?.error);
    assert.ok(recommendOutputSchema?.properties?.retryable);
    assert.ok(recommendOutputSchema?.properties?.stage);
    assert.ok(recommendOutputSchema?.properties?.traceId);
    assert.ok(recommendOutputSchema?.properties?.days);
    assert.match(recommendTool?.description ?? "", /^Use this when/);
    assert.match(recommendTool?.description ?? "", /남해 1박 2일 여행 일정/);
    assert.match(recommendTool?.description ?? "", /before browsing or researching/);
    assert.match(recommendTool?.description ?? "", /Missing lodging and preferences are allowed/);
    assert.deepEqual(recommendTool?.annotations, {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    });
    assert.match(startPlanningTool?.description ?? "", /^Use this when/);
    assert.deepEqual(startPlanningTool?.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    assert.match(getItineraryTool?.description ?? "", /^Use this when/);
    assert.deepEqual(getItineraryTool?.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    assert.equal(recommendTool?._meta?.["openai/outputTemplate"], undefined);
    assert.equal(getItineraryTool?._meta?.["openai/outputTemplate"], "ui://planme/itinerary-widget-v2.html");

    const planningDraft = await client.callTool({
      name: "start_planme_planning",
      arguments: {
        destination: "여수",
      },
    });
    const planningDraftContent = planningDraft.structuredContent as PlanningContent | undefined;

    assert.equal(planningDraft.isError, undefined);
    assert.equal(planningDraftContent?.status, "needs_input");
    assert.equal(planningDraftContent?.nextAction, "ask_user");
    assert.ok(planningDraftContent?.missingSlots?.includes("origin"));
    assert.ok(planningDraftContent?.missingSlots?.includes("durationDays"));
    assert.ok(planningDraftContent?.questions?.some((question) => question.slot === "origin"));
    assert.ok(
      planningDraftContent?.questions?.some((question) => question.slot === "durationDays"),
    );

    const unsupportedDurationPlanning = await client.callTool({
      name: "start_planme_planning",
      arguments: {
        destination: "부산",
        durationDays: PLANME_EXTERNAL_MAX_DURATION_DAYS + 1,
        origin: "동탄",
        transportMode: "drive",
      },
    });
    const unsupportedDurationPlanningText = JSON.stringify(unsupportedDurationPlanning);

    assert.equal(unsupportedDurationPlanning.isError, true);
    assert.match(unsupportedDurationPlanningText, /durationDays/);
    assert.match(unsupportedDurationPlanningText, /최대 3일/);

    const unsupportedDurationRecommendation = await client.callTool({
      name: "recommend_planme_itinerary",
      arguments: {
        destination: "부산",
        durationDays: PLANME_EXTERNAL_MAX_DURATION_DAYS + 1,
        origin: "동탄",
        transportMode: "drive",
      },
    });
    const unsupportedDurationRecommendationText = JSON.stringify(
      unsupportedDurationRecommendation,
    );

    assert.equal(unsupportedDurationRecommendation.isError, true);
    assert.match(unsupportedDurationRecommendationText, /durationDays/);
    assert.match(unsupportedDurationRecommendationText, /최대 3일/);

    const transportOnlyPlanning = await client.callTool({
      name: "start_planme_planning",
      arguments: {
        destination: "여수",
        durationDays: 2,
        origin: "서울",
      },
    });
    const transportOnlyPlanningContent =
      transportOnlyPlanning.structuredContent as PlanningContent | undefined;

    assert.equal(transportOnlyPlanning.isError, undefined);
    assert.equal(transportOnlyPlanningContent?.status, "needs_input");
    assert.equal(transportOnlyPlanningContent?.nextAction, "ask_user");
    assert.deepEqual(transportOnlyPlanningContent?.missingSlots, ["transportMode"]);
    assert.deepEqual(
      transportOnlyPlanningContent?.questions?.map((question) => question.slot),
      ["transportMode"],
    );

    const readyPlanning = await client.callTool({
      name: "start_planme_planning",
      arguments: {
        destination: "여수",
        durationDays: 2, transportMode: "drive",
        origin: "서울",
      },
    });
    const readyPlanningContent = readyPlanning.structuredContent as PlanningContent | undefined;

    assert.equal(readyPlanning.isError, undefined);
    assert.equal(readyPlanningContent?.status, "ready");
    assert.equal(readyPlanningContent?.nextAction, "recommend_planme_itinerary");
    assert.deepEqual(readyPlanningContent?.missingSlots, []);
    assert.deepEqual(readyPlanningContent?.questions, []);

    const koreanPlanning = await client.callTool({
      name: "start_planme_planning",
      arguments: {
        destination: "여수",
        durationDays: 2,
        transportMode: "대중교통",
        origin: "서울",
      },
    });
    const koreanPlanningContent = koreanPlanning.structuredContent as PlanningContent | undefined;

    assert.equal(koreanPlanning.isError, undefined);
    assert.equal(koreanPlanningContent?.normalizedInput?.transportMode, "transit");

    const missingAiGeneratorRecommendation = await client.callTool({
      name: "recommend_planme_itinerary",
      arguments: {
        destination: "남해 아이 동반 가족여행",
        durationDays: 2, transportMode: "drive",
        travelerCount: 4,
        luggageCount: 2,
      },
    });
    const missingAiGeneratorPayload = JSON.stringify(missingAiGeneratorRecommendation);

    assert.equal(missingAiGeneratorRecommendation.isError, undefined);
    assert.match(missingAiGeneratorPayload, /needs_clarification/);
    assert.match(missingAiGeneratorPayload, /출발지/);
    assert.doesNotMatch(missingAiGeneratorPayload, /인천공항/);
    assert.doesNotMatch(missingAiGeneratorPayload, /여수 베네치아 호텔/);
    assert.doesNotMatch(missingAiGeneratorPayload, /부산 공연장/);

    const originalClientWebOrigin = process.env.PLANME_WEB_ORIGIN;
    const originalClientFetch = globalThis.fetch;
    try {
      process.env.PLANME_WEB_ORIGIN = "http://localhost:3000";
      const demoItinerary = getPlanmeItineraryById("busan-bts-1d1n");
      const parityItinerary = createGptActionMultiDayFixture();
      assert.ok(demoItinerary);
      const parityResponse = toGptActionItineraryResponse(
        parityItinerary,
        "http://localhost:3000/api/gpt/itineraries/response-parity-test",
      );
      globalThis.fetch = async (input, init) => {
        if (String(input).includes("/api/gpt/itineraries/busan-bts-1d1n")) {
          return new Response(
            JSON.stringify(
              toGptActionItineraryResponse(
                demoItinerary,
                "http://localhost:3000/api/gpt/itineraries/busan-bts-1d1n",
              ),
            ),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }

        if (String(input).includes("/api/gpt/itineraries/response-parity-test")) {
          return new Response(JSON.stringify(parityResponse), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }

        return originalClientFetch(input, init);
      };

      const demoLookup = await client.callTool({
        name: "get_planme_itinerary",
        arguments: {
          itineraryId: "busan-bts-1d1n",
        },
      });
      const demoLookupContent = demoLookup.structuredContent as RecommendationContent | undefined;

      assert.equal(demoLookup.isError, undefined);
      assert.equal(demoLookupContent?.itineraryId, "busan-bts-1d1n");
      assert.equal(demoLookupContent?.pageUrl, "http://localhost:3000/itinerary/busan-bts-1d1n");
      assert.equal(demoLookupContent?.days?.length, demoItinerary.days.length);

      const parityLookup = await client.callTool({
        name: "get_planme_itinerary",
        arguments: {
          itineraryId: "response-parity-test",
        },
      });
      const parityAppContent = parityLookup.structuredContent as RecommendationContent | undefined;
      const parityGptsContent = toGptsRestRecommendationResponse(parityResponse);

      assert.equal(parityLookup.isError, undefined);
      assert.ok(parityAppContent);
      assert.equal("itineraryId" in parityGptsContent, true);
      assert.deepEqual(
        toSharedRecommendationContract(parityAppContent),
        toSharedRecommendationContract(parityGptsContent),
        "GPTs Actions와 Apps의 다일 일정 요약 계약이 다릅니다.",
      );
      assert.deepEqual(parityAppContent.days, parityResponse.days);
    } finally {
      if (originalClientWebOrigin === undefined) {
        delete process.env.PLANME_WEB_ORIGIN;
      } else {
        process.env.PLANME_WEB_ORIGIN = originalClientWebOrigin;
      }

      globalThis.fetch = originalClientFetch;
    }

    const originalResourceWebOrigin = process.env.PLANME_WEB_ORIGIN;
    try {
      process.env.PLANME_WEB_ORIGIN = "http://localhost:3000/";

      const resource = await client.readResource({
        uri: "ui://planme/itinerary-widget-v2.html",
      });
      const legacyResource = await client.readResource({
        uri: "ui://planme/itinerary-widget.html",
      });

      const firstResource = resource.contents[0];
      const firstLegacyResource = legacyResource.contents[0];
      const firstResourceMeta = firstResource?._meta as PlanmeWidgetResourceMeta | undefined;

      assert.equal(firstResource?.mimeType, "text/html;profile=mcp-app");
      assert.ok(firstResource && "text" in firstResource);
      assert.equal(firstLegacyResource?.mimeType, "text/html;profile=mcp-app");
      assert.ok(firstLegacyResource && "text" in firstLegacyResource);
      assert.equal(firstResourceMeta?.ui?.csp?.frameDomains, undefined);
      assert.equal(firstResourceMeta?.["openai/widgetCSP"]?.frame_domains, undefined);
      assert.ok(firstResourceMeta?.ui?.csp?.connectDomains?.includes("http://localhost:3000"));
      assert.ok(firstResourceMeta?.ui?.csp?.resourceDomains?.includes("http://localhost:3000"));
      assert.ok(
        firstResourceMeta?.["openai/widgetCSP"]?.redirect_domains?.includes(
          "http://localhost:3000",
        ),
      );
      assert.ok(
        !firstResourceMeta?.ui?.csp?.connectDomains?.some((domain) => domain.includes("google")),
      );
      assert.ok(
        !firstResourceMeta?.ui?.csp?.resourceDomains?.some((domain) => domain.includes("google")),
      );
      assert.ok(
        !firstResourceMeta?.["openai/widgetCSP"]?.connect_domains?.some((domain) =>
          domain.includes("google"),
        ),
      );
      assert.ok(
        !firstResourceMeta?.["openai/widgetCSP"]?.resource_domains?.some((domain) =>
          domain.includes("google"),
        ),
      );
      assert.match(firstResource.text, /PlanME/);
      assert.match(firstResource.text, /window\.openai/);
      assert.match(firstResource.text, /toolOutput/);
      assert.match(firstResource.text, /openai:set_globals/);
      assert.match(firstResource.text, /ui\/notifications\/tool-result/);
      assert.doesNotMatch(firstResource.text, /부산 1박 2일/);
      assert.doesNotMatch(firstResource.text, /인천공항 도착/);
      assert.doesNotMatch(firstResource.text, /planme-route-preview/);
      assert.doesNotMatch(firstResource.text, /동선 미리보기/);
      assert.doesNotMatch(firstResource.text, /maps\.googleapis\.com/);
      assert.doesNotMatch(firstResource.text, /Google Maps/);
      assert.doesNotMatch(firstLegacyResource.text, /Google Maps/);
    } finally {
      if (originalResourceWebOrigin === undefined) {
        delete process.env.PLANME_WEB_ORIGIN;
      } else {
        process.env.PLANME_WEB_ORIGIN = originalResourceWebOrigin;
      }
    }
  } finally {
    await client.close();
    server.close();
  }

  console.log("PlanME MCP contract passed");
}

await main();
