import assert from "node:assert/strict";
import {
  normalizeTourCandidates,
  resolveTripIntent,
  type PlanmeUsageCounterEvent,
  type TourPlaceSnapshot,
} from "@planme/core";
import {
  createTourApiClient,
  type TourCandidateQueryResult,
} from "../lib/planme-v3/tour-api-client";
import {
  PLANME_V3_LUNA_MODEL,
  PLANME_V3_LUNA_REASONING_EFFORT,
  createLunaRequestBody,
  planTourCandidatesWithLuna,
} from "../lib/planme-v3/luna-planner";
import { routePlanmeSegment } from "../lib/planme-v3/route-service";
import { geocodePlanmeAnchor } from "../lib/planme-v3/geocoding";

type CapturedLunaBody = {
  model?: string;
  reasoning?: { effort?: string };
  text?: { format?: { strict?: boolean; schema?: { additionalProperties?: boolean } } };
};

async function main() {
const geocodeUsageEvents: PlanmeUsageCounterEvent[] = [];
const requestedUrls: URL[] = [];
const geocodeResult = await geocodePlanmeAnchor("서울역", {
  naverMapsClientId: "server-id",
  naverMapsClientSecret: "server-secret",
  usageRecorder: (event) => {
    geocodeUsageEvents.push(event);
  },
  fetchImpl: async (_input, init) => {
    assert.equal(
      new Headers(init?.headers).get("x-ncp-apigw-api-key-id"),
      "server-id",
    );
    return jsonResponse({ addresses: [{ x: "126.9707", y: "37.5547" }] });
  },
});
assert.deepEqual(geocodeResult, {
  status: "ready",
  coordinate: { lat: 37.5547, lng: 126.9707 },
});
assert.deepEqual(geocodeUsageEvents, ["naver_geocode_request"]);

const localFallbackUsageEvents: PlanmeUsageCounterEvent[] = [];
const localFallbackResult = await geocodePlanmeAnchor("마포구청", {
  naverMapsClientId: "maps-id",
  naverMapsClientSecret: "maps-secret",
  naverSearchClientId: "search-id",
  naverSearchClientSecret: "search-secret",
  usageRecorder: (event) => {
    localFallbackUsageEvents.push(event);
  },
  fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "maps.apigw.ntruss.com") {
      return jsonResponse({ addresses: [] });
    }
    assert.equal(
      new Headers(init?.headers).get("X-Naver-Client-Id"),
      "search-id",
    );
    return jsonResponse({
      items: [
        {
          title: "마포구청",
          mapx: "1269018234",
          mapy: "375665921",
          roadAddress: "서울특별시 마포구 월드컵로 212",
        },
      ],
    });
  },
});
assert.deepEqual(localFallbackResult, {
  status: "ready",
  coordinate: { lat: 37.5665921, lng: 126.9018234 },
});
assert.deepEqual(localFallbackUsageEvents, [
  "naver_geocode_request",
  "naver_local_search_request",
]);

const tourUsageEvents: PlanmeUsageCounterEvent[] = [];
const tourClient = createTourApiClient({
  serviceKey: "encoded%2Bservice%3Dkey",
  usageRecorder: (event) => {
    tourUsageEvents.push(event);
  },
  fetchImpl: async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url);

    if (url.pathname.endsWith("/ldongCode2")) {
      return jsonResponse({
        response: {
          header: { resultCode: "0000", resultMsg: "OK" },
          body: {
            totalCount: 10,
            items: {
              item: [
                { lDongRegnCd: "11", lDongRegnNm: "서울특별시" },
                {
                  lDongRegnCd: "11",
                  lDongRegnNm: "서울특별시",
                  lDongSignguCd: "11140",
                  lDongSignguNm: "중구",
                },
                { lDongRegnCd: "28", lDongRegnNm: "인천광역시" },
                {
                  lDongRegnCd: "28",
                  lDongRegnNm: "인천광역시",
                  lDongSignguCd: "28110",
                  lDongSignguNm: "중구",
                },
                {
                  lDongRegnCd: "26",
                  lDongRegnNm: "부산광역시",
                  lDongSignguCd: "26350",
                  lDongSignguNm: "해운대구",
                },
                {
                  lDongRegnCd: "27",
                  lDongRegnNm: "대구광역시",
                  lDongSignguCd: "27110",
                  lDongSignguNm: "중구",
                },
                { lDongRegnCd: "47", lDongRegnNm: "경상북도" },
                { lDongRegnCd: "48", lDongRegnNm: "경상남도" },
                {
                  lDongRegnCd: "47",
                  lDongRegnNm: "경상북도",
                  lDongSignguCd: "47190",
                  lDongSignguNm: "구미시",
                },
                {
                  lDongRegnCd: "47",
                  lDongRegnNm: "경상북도",
                  lDongSignguCd: "130",
                  lDongSignguNm: "경주시",
                },
                {
                  lDongRegnCd: "48",
                  lDongRegnNm: "경상남도",
                  lDongSignguCd: "48840",
                  lDongSignguNm: "남해군",
                },
              ],
            },
          },
        },
      });
    }

    if (url.pathname.endsWith("/searchKeyword2")) {
      return jsonResponse({
        response: {
          header: { resultCode: "0000", resultMsg: "OK" },
          body: {
            totalCount: 1,
            items: {
              item: {
                contentid: "gyeongju-world",
                contenttypeid: "12",
                title: "경주월드 어뮤즈먼트",
                mapx: "129.2822",
                mapy: "35.8366",
                addr1: "경상북도 경주시 보문로 544",
                lDongRegnCd: "47",
                lDongSignguCd: "130",
              },
            },
          },
        },
      });
    }

    if (url.pathname.endsWith("/searchStay2")) {
      return jsonResponse({
        response: {
          header: { resultCode: "0000", resultMsg: "OK" },
          body: {
            totalCount: 1,
            items: {
              item: {
                contentid: "lodging-1",
                contenttypeid: "32",
                title: "부산 호텔",
                mapx: "129.0756",
                mapy: "35.1796",
                lDongRegnCd: "26",
              },
            },
          },
        },
      });
    }

    return jsonResponse({
      response: {
        header: { resultCode: "0000", resultMsg: "OK" },
        body: {
          totalCount: 1,
          items: {
            item: {
              contentid: "visit-1",
              contenttypeid: "12",
              title: "해운대",
              mapx: "129.1587",
              mapy: "35.1587",
              lDongRegnCd: "26",
            },
          },
        },
      },
    });
  },
});

const region = await tourClient.resolveRegion("부산");
assert.deepEqual(region, { regionCode: "26", regionName: "부산광역시" });
assert.deepEqual(await tourClient.resolveRegion("부산 해운대구"), {
  regionCode: "26",
  regionName: "부산광역시",
  districtCode: "26350",
  districtName: "해운대구",
});
assert.deepEqual(await tourClient.resolveRegion("구미시"), {
  regionCode: "47",
  regionName: "경상북도",
  districtCode: "47190",
  districtName: "구미시",
});
assert.deepEqual(await tourClient.resolveRegion("남해"), {
  regionCode: "48",
  regionName: "경상남도",
  districtCode: "48840",
  districtName: "남해군",
});
assert.deepEqual(await tourClient.resolveRegion("남해군"), {
  regionCode: "48",
  regionName: "경상남도",
  districtCode: "48840",
  districtName: "남해군",
});
assert.deepEqual(await tourClient.resolveRegion("인천광역시 중구"), {
  regionCode: "28",
  regionName: "인천광역시",
  districtCode: "28110",
  districtName: "중구",
});
assert.equal(await tourClient.resolveRegion("중구"), null);
assert.equal(await tourClient.resolveRegion("경상"), null);
assert.deepEqual(await tourClient.resolveRegion("대구광역시 중구"), {
  regionCode: "27",
  regionName: "대구광역시",
  districtCode: "27110",
  districtName: "중구",
});
assert.deepEqual(await tourClient.resolveDestination("경주월드"), {
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
});
const tourResult: TourCandidateQueryResult = await tourClient.listCandidates({
  contentTypeId: 12,
  region,
});
assert.equal(tourResult.status, "success");
if (tourResult.status === "success") {
  assert.equal(tourResult.records[0].lDongRegnCd, "26");
}
const candidateRequest = requestedUrls.at(-1);
assert.equal(candidateRequest?.searchParams.get("lDongRegnCd"), "26");
assert.equal(candidateRequest?.searchParams.get("areaCode"), null);
assert.equal(candidateRequest?.searchParams.get("serviceKey"), "encoded+service=key");
const stayResult = await tourClient.listCandidates({
  contentTypeId: 32,
  region,
});
assert.equal(stayResult.status, "success");
const stayRequest = requestedUrls.at(-1);
assert.equal(stayRequest?.pathname.endsWith("/searchStay2"), true);
assert.equal(stayRequest?.searchParams.get("contentTypeId"), null);
assert.deepEqual(tourUsageEvents, [
  "tourapi_request",
  "tourapi_request",
  "tourapi_request",
  "tourapi_request",
  "tourapi_request",
  "tourapi_request",
  "tourapi_request",
  "tourapi_request",
  "tourapi_request",
  "tourapi_request",
  "tourapi_request",
  "tourapi_request",
  "tourapi_request",
]);

const intentResult = resolveTripIntent({
  destination: "부산",
  durationDays: 1,
  origin: "서울",
  transportMode: "transit",
});
assert.equal(intentResult.ok, true);
if (!intentResult.ok) {
  throw new Error("Expected provider test trip intent to be valid.");
}

const candidates: TourPlaceSnapshot[] = normalizeTourCandidates(
  [
    {
      contentid: "visit-1",
      contenttypeid: 12,
      title: "해운대",
      mapx: 129.1587,
      mapy: 35.1587,
      lDongRegnCd: "26",
    },
    {
      contentid: "lodging-1",
      contenttypeid: 32,
      title: "부산 호텔",
      mapx: 129.0756,
      mapy: 35.1796,
      lDongRegnCd: "26",
    },
  ],
  { expectedRegionCode: "26", fetchedAt: "2026-07-14T00:00:00.000Z" },
);
const validSelection = JSON.stringify({
  lodgingContentId: "lodging-1",
  days: [
    {
      day: 1,
      orderedVisitContentIds: ["visit-1"],
      restaurantContentIds: [],
    },
  ],
});
const longTripBody = createLunaRequestBody(
  { ...intentResult.value, durationDays: 14 },
  candidates,
);
const shortTripBody = createLunaRequestBody(intentResult.value, candidates);
const shortTripDaySchema =
  shortTripBody.text.format.schema.properties?.days?.items;
assert.equal(
  shortTripDaySchema?.properties?.orderedVisitContentIds?.maxItems,
  1,
);
assert.equal(
  shortTripDaySchema?.properties?.restaurantContentIds?.maxItems,
  1,
);
const longTripDaySchema =
  longTripBody.text.format.schema.properties?.days?.items;
assert.equal(
  longTripDaySchema?.properties?.orderedVisitContentIds?.maxItems,
  1,
);
assert.equal(
  longTripDaySchema?.properties?.restaurantContentIds?.maxItems,
  0,
);
const capturedBodies: CapturedLunaBody[] = [];
const lunaUsageEvents: PlanmeUsageCounterEvent[] = [];
let lunaAttempt = 0;
const lunaResult = await planTourCandidatesWithLuna(
  { candidates, intent: intentResult.value },
  {
    apiKey: "test-openai-key",
    usageRecorder: (event) => {
      lunaUsageEvents.push(event);
    },
    fetchImpl: async (_input, init) => {
      capturedBodies.push(JSON.parse(String(init?.body)) as CapturedLunaBody);
      lunaAttempt += 1;
      return jsonResponse({
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: lunaAttempt === 1 ? '{"invalid":true}' : validSelection,
              },
            ],
          },
        ],
      });
    },
  },
);
assert.equal(lunaResult.ok, true);
assert.equal(lunaResult.ok && lunaResult.source, "luna");
assert.equal(lunaResult.attempts, 2);
assert.equal(capturedBodies[0].model, PLANME_V3_LUNA_MODEL);
assert.equal(
  capturedBodies[0].reasoning?.effort,
  PLANME_V3_LUNA_REASONING_EFFORT,
);
assert.equal(capturedBodies[0].text?.format?.strict, true);
assert.equal(
  capturedBodies[0].text?.format?.schema?.additionalProperties,
  false,
);

const fallbackResult = await planTourCandidatesWithLuna(
  { candidates, intent: intentResult.value },
  {
    apiKey: "test-openai-key",
    usageRecorder: (event) => {
      lunaUsageEvents.push(event);
    },
    fetchImpl: async () => jsonResponse({ output: [] }),
  },
);
assert.equal(fallbackResult.ok, true);
assert.equal(fallbackResult.ok && fallbackResult.source, "deterministic");
assert.equal(fallbackResult.attempts, 2);
const longTripFallback = await planTourCandidatesWithLuna(
  {
    candidates,
    intent: { ...intentResult.value, durationDays: 14 },
  },
  {
    apiKey: "test-openai-key",
    fetchImpl: async () => jsonResponse({ output: [] }),
  },
);
assert.equal(longTripFallback.ok, true);
if (longTripFallback.ok) {
  assert.equal(longTripFallback.selection.days.length, 14);
  assert.equal(
    longTripFallback.selection.days.every(
      (day) =>
        day.orderedVisitContentIds.length <= 1 &&
        day.restaurantContentIds.length === 0,
    ),
    true,
  );
}
assert.deepEqual(lunaUsageEvents, [
  "openai_request",
  "openai_request",
  "openai_request",
  "openai_request",
]);

const nearbyFrom = {
  ref: "visit-1",
  coordinate: { lat: 37.5, lng: 127 },
};
const nearbyTo = {
  ref: "visit-2",
  coordinate: { lat: 37.504, lng: 127 },
};
const odsayCalls: URL[] = [];
const odsayReferers: Array<string | null> = [];
const routeUsageEvents: PlanmeUsageCounterEvent[] = [];
const estimatedWalkResult = await routePlanmeSegment(
  {
    from: nearbyFrom,
    to: nearbyTo,
    transportMode: "transit",
    requiredSegment: false,
  },
  {
    odsayApiKey: "server-only-odsay-key",
    odsayReferer: "https://planme.example/itinerary/example",
    usageRecorder: (event) => {
      routeUsageEvents.push(event);
    },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      odsayCalls.push(url);
      odsayReferers.push(new Headers(init?.headers).get("referer"));
      return url.pathname.endsWith("/searchWalkPathV2")
        ? jsonResponse({
            result: {
              path: [{ hasPathResult: false, errorCode: "411" }],
            },
          })
        : jsonResponse({ error: { code: "-98", msg: "nearby" } });
    },
  },
);
assert.equal(estimatedWalkResult.status, "ready");
if (estimatedWalkResult.status === "ready") {
  assert.equal(estimatedWalkResult.segment.source, "estimated_walk");
  assert.equal(estimatedWalkResult.segment.geometryStatus, "unavailable");
  assert.deepEqual(estimatedWalkResult.segment.paths, []);
}
assert.equal(odsayCalls.length, 2);
assert.equal(odsayCalls[1].pathname.endsWith("/searchWalkPathV2"), true);
assert.deepEqual(odsayReferers, [
  "https://planme.example/",
  "https://planme.example/",
]);

let retriedWalkCalls = 0;
const retriedWalkResult = await routePlanmeSegment(
  {
    from: nearbyFrom,
    to: nearbyTo,
    transportMode: "transit",
    requiredSegment: false,
  },
  {
    odsayApiKey: "server-only-odsay-key",
    usageRecorder: (event) => {
      routeUsageEvents.push(event);
    },
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (!url.pathname.endsWith("/searchWalkPathV2")) {
        return jsonResponse({ error: { code: "-98", msg: "nearby" } });
      }
      retriedWalkCalls += 1;
      return retriedWalkCalls === 1
        ? jsonResponse({ error: "temporary" }, 429)
        : jsonResponse({ error: { code: "412", msg: "walk unavailable" } });
    },
  },
);
assert.equal(retriedWalkCalls, 2);
assert.equal(retriedWalkResult.status, "ready");
if (retriedWalkResult.status === "ready") {
  assert.equal(retriedWalkResult.segment.source, "estimated_walk");
}

const distantResult = await routePlanmeSegment(
  {
    from: nearbyFrom,
    to: { ref: "distant", coordinate: { lat: 37.51, lng: 127 } },
    transportMode: "transit",
    requiredSegment: false,
  },
  {
    odsayApiKey: "server-only-odsay-key",
    usageRecorder: (event) => {
      routeUsageEvents.push(event);
    },
    fetchImpl: async () =>
      jsonResponse({ error: { code: "-98", msg: "nearby" } }),
  },
);
assert.deepEqual(distantResult, {
  status: "exclude_optional",
  errorCode: "ODSAY_-98",
});

let transientAttempt = 0;
const retryResult = await routePlanmeSegment(
  {
    from: nearbyFrom,
    to: { ref: "transit-destination", coordinate: { lat: 37.52, lng: 127 } },
    transportMode: "transit",
    requiredSegment: true,
  },
  {
    odsayApiKey: "server-only-odsay-key",
    usageRecorder: (event) => {
      routeUsageEvents.push(event);
    },
    fetchImpl: async () => {
      transientAttempt += 1;
      return transientAttempt === 1
        ? jsonResponse({ error: { code: "-1", msg: "temporary" } })
        : jsonResponse({
            result: {
              path: [{ info: { totalDistance: 2000, totalTime: 15 } }],
            },
          });
    },
  },
);
assert.equal(retryResult.status, "ready");
assert.equal(transientAttempt, 2);

let providerRateLimitAttempt = 0;
const providerRateLimitResult = await routePlanmeSegment(
  {
    from: nearbyFrom,
    to: { ref: "rate-limited-destination", coordinate: { lat: 37.52, lng: 127 } },
    transportMode: "transit",
    requiredSegment: true,
  },
  {
    odsayApiKey: "server-only-odsay-key",
    usageRecorder: (event) => {
      routeUsageEvents.push(event);
    },
    fetchImpl: async () => {
      providerRateLimitAttempt += 1;
      return providerRateLimitAttempt === 1
        ? jsonResponse({ error: { code: "429", msg: "rate limited" } })
        : jsonResponse({
            result: {
              path: [{ info: { totalDistance: 2000, totalTime: 15 } }],
            },
          });
    },
  },
);
assert.equal(providerRateLimitResult.status, "ready");
assert.equal(providerRateLimitAttempt, 2);

const laneReferers: Array<string | null> = [];
const laneResult = await routePlanmeSegment(
  {
    from: nearbyFrom,
    to: { ref: "lane-destination", coordinate: { lat: 37.52, lng: 127 } },
    transportMode: "transit",
    requiredSegment: true,
  },
  {
    odsayApiKey: "server-only-odsay-key",
    odsayReferer: "https://planme.example/path?ignored=true",
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      laneReferers.push(new Headers(init?.headers).get("referer"));
      return url.pathname.endsWith("/loadLane")
        ? jsonResponse({
            result: {
              lane: [{ section: [{ graphPos: [{ x: 127, y: 37.5 }, { x: 127.01, y: 37.51 }] }] }],
            },
          })
        : jsonResponse({
            result: {
              path: [{ info: { mapObj: "1:2", totalDistance: 2000, totalTime: 15 } }],
            },
          });
    },
  },
);
assert.equal(laneResult.status, "ready");
assert.deepEqual(laneReferers, [
  "https://planme.example/",
  "https://planme.example/",
]);

const authenticationFailureResult = await routePlanmeSegment(
  {
    from: nearbyFrom,
    to: nearbyTo,
    transportMode: "transit",
    requiredSegment: true,
  },
  {
    odsayApiKey: "invalid-server-key",
    fetchImpl: async () =>
      jsonResponse({
        error: [
          {
            code: "500",
            message: "[ApiKeyAuthFailed] ApiKey authentication failed.",
          },
        ],
      }),
  },
);
assert.deepEqual(authenticationFailureResult, {
  status: "failed",
  errorCode: "ODSAY_CONFIGURATION_ERROR",
});

const driveResult = await routePlanmeSegment(
  {
    from: nearbyFrom,
    to: nearbyTo,
    transportMode: "drive",
    requiredSegment: true,
  },
  {
    naverMapsClientId: "server-id",
    naverMapsClientSecret: "server-secret",
    usageRecorder: (event) => {
      routeUsageEvents.push(event);
    },
    fetchImpl: async () =>
      jsonResponse({
        route: {
          trafast: [
            {
              path: [
                [127, 37.5],
                [127, 37.504],
              ],
              summary: { distance: 500, duration: 120_000 },
            },
          ],
        },
      }),
  },
);
assert.equal(driveResult.status, "ready");
if (driveResult.status === "ready") {
  assert.equal(driveResult.segment.durationSeconds, 120);
  assert.equal(driveResult.segment.source, "naver");
}
assert.equal(
  routeUsageEvents.filter((event) => event === "odsay_request").length,
  10,
);
assert.equal(
  routeUsageEvents.filter((event) => event === "naver_directions_request").length,
  1,
);

console.log("PlanME V3 provider contract checks passed (TourAPI, Luna retry/fallback).");
}

void main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});

function jsonResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
