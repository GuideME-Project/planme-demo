import { once } from "node:events";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  createAiRecommendedItineraryResponse,
  createGeneratedItinerary,
  createPlanmeDraftPreview,
  generatePlanmeDraftWithOpenAi,
  resolvePlanmeDraftCoordinates,
  searchAccommodationCandidates,
  type PlanmeDraftGeocoder,
} from "@planme/core";
import { createNaverGeocoder } from "../src/naver-geocoding.js";
import { persistItineraryForDetailPage } from "../src/planme-mcp.js";
import { createPlanmeHttpServer } from "../src/server.js";

type RecommendationContent = {
  itineraryId?: string;
  pageUrl?: string;
  title?: string;
  savedMinutes?: number;
  timeline?: Array<{
    title?: string;
  }>;
};

type PlanningContent = {
  status?: "needs_input" | "ready";
  missingSlots?: string[];
  nextAction?: "ask_user" | "recommend_planme_itinerary";
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
    resource_domains?: string[];
  };
};

/**
 * Verifies the OpenAI generator boundary without calling the real OpenAI API.
 */
async function assertOpenAiGeneratorContract(): Promise<void> {
  let capturedBody = "";
  const generatedDraft = await generatePlanmeDraftWithOpenAi(
    {
      destination: "남해 가족여행",
      durationDays: 2,
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
                    {
                      name: "남해 숙소",
                      role: "luggageDestination",
                      caption: "짐 도착",
                      addressQuery: "경상남도 남해군 남해 숙소",
                    },
                  ],
                  timeline: [
                    {
                      time: "09:00",
                      title: "동탄 출발",
                      description: "가족 여행을 시작합니다.",
                      category: "arrival",
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
  assert.equal(generatedDraft.days[0]?.timeline[0]?.title, "동탄 출발");
  assert.equal(
    generatedDraft.days[0]?.stops[1]?.addressQuery,
    "경상남도 남해군 삼동면 독일로 89-7 남해 독일마을",
  );
  assert.match(capturedBody, /json_schema/);
  assert.match(capturedBody, /addressQuery/);
  assert.match(capturedBody, /역\/터미널\/공항은 기본 수하물 보관·수령지가 아닙니다/);
  assert.match(capturedBody, /luggageDestination/);
  assert.match(capturedBody, /펜션 사랑가/);
  assert.match(capturedBody, /아래 숙소 후보 중 하나/);
  assert.match(capturedBody, /PLANME_OPENAI_MODEL|test-model/);
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

  assert.equal(result.draft.days[0]?.stops[0]?.coordinate?.lat, 34.7983);
  assert.equal(result.draft.days[0]?.stops[0]?.coordinate?.lng, 128.0406);
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
  assert.match(calls[0]?.url ?? "", /query=/);
  assert.equal(calls[0]?.headers["x-ncp-apigw-api-key-id"], "test-key-id");
  assert.equal(calls[0]?.headers["x-ncp-apigw-api-key"], "test-secret");
}

/**
 * Verifies AI recommendations can enrich non-lodging stops with Naver-resolved coordinates.
 */
async function assertAiRecommendationCoordinateResolutionContract(): Promise<void> {
  const response = await createAiRecommendedItineraryResponse(
    "http://localhost:3000/api/gpt/itineraries/recommend",
    { destination: "남해", origin: "동탄", durationDays: 2 },
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
      draftGeocoder: async ({ query }) =>
        query.includes("남해 독일마을")
          ? { coordinate: { lat: 34.7983, lng: 128.0406 } }
          : { coordinate: { lat: 37.2001, lng: 127.0951 } },
    },
  );

  const standardRoute = response.itinerary.days[0]?.standard;

  assert.equal(standardRoute?.stops.every((stop) => Boolean(stop.coordinate)), true);
  assert.ok(
    (standardRoute?.geoPath?.length ?? 0) >= 2,
    "Expected resolved coordinates to create a renderable Naver geoPath",
  );
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
      durationDays: 2,
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
              stops: [
                { name: "남해 숙소", role: "luggageDestination", caption: "짐 도착" },
                { name: "상주은모래비치", role: "visit", caption: "해변 산책" },
                { name: "독일마을", role: "visit", caption: "관광" },
                { name: "남해 숙소", role: "finalDestination", caption: "휴식" },
              ],
              timeline: [
                {
                  time: "오전",
                  title: "남해 숙소 도착",
                  description: "숙소에 짐을 맡기고 여행을 시작합니다.",
                  category: "arrival",
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
    },
  );
  const firstStandardStop = response.itinerary.days[0]?.standard.stops[0];
  const renderedPayload = JSON.stringify(response.itinerary);

  assert.equal(searchCallCount, 1);
  assert.match(generatorInput, /펜션 사랑가/);
  assert.equal(firstStandardStop?.label, "펜션 사랑가");
  assert.deepEqual(firstStandardStop?.coordinate, { lat: 34.7601, lng: 127.9001 });
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
      durationDays: 3,
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
              { name: "서울", role: "origin", caption: "출발" },
              { name: "남해 독일마을", role: "visit", caption: "관광" },
              { name: "남해 비치호텔", role: "luggageDestination", caption: "짐 도착" },
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
              { name: "남해 비치호텔", role: "origin", caption: "출발" },
              { name: "물건방조어부림", role: "visit", caption: "해안 산책" },
              { name: "남해 비치호텔", role: "finalDestination", caption: "휴식" },
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
              { name: "남해 비치호텔", role: "origin", caption: "출발" },
              { name: "상주은모래비치", role: "visit", caption: "산책" },
              { name: "서울", role: "finalDestination", caption: "귀가" },
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
    },
  );

  assert.equal(response.itinerary.days.length, 3);
  assert.equal(response.itinerary.days[2]?.day, 3);
  assert.equal(response.itinerary.days[2]?.label, "셋째 날: 바다 산책 후 귀가");
}

/**
 * Verifies server code can reuse the already-configured public Google Maps key name.
 */
async function assertGoogleMapsKeyFallbackContract(): Promise<void> {
  const originalServerKey = process.env.PLANME_GOOGLE_MAPS_API_KEY;
  const originalPublicKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  let capturedApiKey = "";
  let capturedReferer = "";

  try {
    delete process.env.PLANME_GOOGLE_MAPS_API_KEY;
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = "fallback-google-key";

    const candidates = await searchAccommodationCandidates(
      {
        destination: "남해",
        preferences: ["가족 여행"],
      },
      {
        referer: "https://planme-demo.vercel.app/",
        fetchImpl: async (_url, init) => {
          const headers = init?.headers as Record<string, string> | undefined;
          capturedApiKey = headers?.["X-Goog-Api-Key"] ?? "";
          capturedReferer = headers?.Referer ?? "";

          return new Response(
            JSON.stringify({
              places: [
                {
                  displayName: { text: "남해 비치호텔" },
                  formattedAddress: "경상남도 남해군 남면 남면로 999",
                  id: "places/namhae-beach-hotel",
                  location: { latitude: 34.7301, longitude: 127.9001 },
                  types: ["lodging"],
                },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        },
      },
    );

    assert.equal(capturedApiKey, "fallback-google-key");
    assert.equal(capturedReferer, "https://planme-demo.vercel.app/");
    assert.equal(candidates[0]?.name, "남해 비치호텔");
  } finally {
    if (originalServerKey === undefined) {
      delete process.env.PLANME_GOOGLE_MAPS_API_KEY;
    } else {
      process.env.PLANME_GOOGLE_MAPS_API_KEY = originalServerKey;
    }

    if (originalPublicKey === undefined) {
      delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    } else {
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = originalPublicKey;
    }
  }
}

/**
 * Verifies generated detail URLs stay readable without repeating region tokens.
 */
function assertDraftPreviewSlugContract(): void {
  const preview = createPlanmeDraftPreview({
    title: "남해 2일 가족 여행",
    region: "경상남도 남해",
    duration: "2일",
    summary: "아이 동반 가족이 남해를 무리 없이 보는 일정입니다.",
    days: [
      {
        day: 1,
        label: "Day 1",
        stops: [
          { name: "남해 숙소", role: "origin", caption: "출발" },
          { name: "상주은모래비치", role: "visit", caption: "해변" },
          { name: "독일마을", role: "visit", caption: "관광" },
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

/**
 * Verifies that plain train or subway stations are not rendered as CarryME luggage handoff points.
 */
function assertStationLuggageGuardrail(): void {
  const problematicDraft = createPlanmeDraftPreview({
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
          { name: "서울역", role: "origin", caption: "출발" },
          { name: "부산역", role: "luggageDestination", caption: "짐 보관" },
          { name: "감천문화마을", role: "visit", caption: "관광" },
          { name: "부산역 인근 숙소", role: "finalDestination", caption: "체크인" },
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
    durationDays: 2,
    origin: "서울역",
    preferences: ["감천문화마을"],
  });
  const generatedPayload = JSON.stringify(generatedBusan);

  assert.doesNotMatch(generatedPayload, /부산역[^"]*(?:짐|수하물)[^"]*(?:보관|수령|회수|챙)/);
  assert.doesNotMatch(generatedPayload, /(?:짐|수하물)[^"]*(?:보관|수령|회수|챙)[^"]*부산역/);
}

/**
 * Verifies MCP does not return a usable detail URL when the web handoff store fails.
 */
async function assertPreviewStoreHandoffFailsClosed(): Promise<void> {
  const originalVercel = process.env.VERCEL;
  const originalWebOrigin = process.env.PLANME_WEB_ORIGIN;
  const originalFetch = globalThis.fetch;

  try {
    process.env.VERCEL = "1";
    process.env.PLANME_WEB_ORIGIN = "https://planme-demo.test";
    globalThis.fetch = async () => new Response("store unavailable", { status: 500 });

    await assert.rejects(
      () =>
        persistItineraryForDetailPage(
          createGeneratedItinerary({
            destination: "여수",
            durationDays: 2,
            origin: "서울",
          }),
        ),
      /preview store/i,
    );
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

    globalThis.fetch = originalFetch;
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
  await assertOpenAiGeneratorContract();
  await assertDraftCoordinateResolverContract();
  await assertNaverGeocoderContract();
  await assertAccommodationCandidateContract();
  await assertAiRecommendationCoordinateResolutionContract();
  await assertThreeDayAiDraftContract();
  await assertGoogleMapsKeyFallbackContract();
  assertDraftPreviewSlugContract();
  assertStationLuggageGuardrail();
  await assertPreviewStoreHandoffFailsClosed();

  const { server, url } = await startServer();
  const transport = new StreamableHTTPClientTransport(url);
  const client = new Client({
    name: "planme-mcp-contract-check",
    version: "0.1.0",
  });

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);

    assert.ok(toolNames.includes("recommend_planme_itinerary"));
    assert.ok(toolNames.includes("get_planme_itinerary"));
    assert.ok(toolNames.includes("start_planme_planning"));
    assert.ok(!toolNames.includes("preview_planme_itinerary"));
    assert.ok(!toolNames.includes("update_planme_itinerary_preview"));
    assert.ok(!toolNames.includes("commit_planme_itinerary"));

    const recommendTool = tools.tools.find((tool) => tool.name === "recommend_planme_itinerary");
    const recommendInputSchema = recommendTool?.inputSchema as
      | { properties?: Record<string, unknown> }
      | undefined;

    assert.ok(recommendInputSchema?.properties);
    assert.equal("days" in recommendInputSchema.properties, false);

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

    const readyPlanning = await client.callTool({
      name: "start_planme_planning",
      arguments: {
        destination: "여수",
        durationDays: 2,
        origin: "서울",
      },
    });
    const readyPlanningContent = readyPlanning.structuredContent as PlanningContent | undefined;

    assert.equal(readyPlanning.isError, undefined);
    assert.equal(readyPlanningContent?.status, "ready");
    assert.equal(readyPlanningContent?.nextAction, "recommend_planme_itinerary");
    assert.deepEqual(readyPlanningContent?.missingSlots, []);

    const missingAiGeneratorRecommendation = await client.callTool({
      name: "recommend_planme_itinerary",
      arguments: {
        destination: "남해 아이 동반 가족여행",
        durationDays: 2,
        travelerCount: 4,
        luggageCount: 2,
      },
    });
    const missingAiGeneratorPayload = JSON.stringify(missingAiGeneratorRecommendation);

    assert.equal(missingAiGeneratorRecommendation.isError, true);
    assert.match(missingAiGeneratorPayload, /OPENAI_API_KEY/);
    assert.doesNotMatch(missingAiGeneratorPayload, /인천공항/);
    assert.doesNotMatch(missingAiGeneratorPayload, /여수 베네치아 호텔/);
    assert.doesNotMatch(missingAiGeneratorPayload, /부산 공연장/);

    const demoLookup = await client.callTool({
      name: "get_planme_itinerary",
      arguments: {
        itineraryId: "busan-bts-1d1n",
      },
    });
    const demoLookupContent = demoLookup.structuredContent as RecommendationContent | undefined;

    assert.equal(demoLookup.isError, undefined);
    assert.equal(demoLookupContent?.itineraryId, "busan-bts-1d1n");

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
    assert.ok(!firstResourceMeta?.ui?.csp?.connectDomains?.some((domain) => domain.includes("google")));
    assert.ok(!firstResourceMeta?.ui?.csp?.resourceDomains?.some((domain) => domain.includes("google")));
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
    await client.close();
    server.close();
  }

  console.log("PlanME MCP contract passed");
}

await main();
