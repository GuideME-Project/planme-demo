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
            totalCount: 2,
            items: {
              item: [
                { lDongRegnCd: "11", lDongRegnNm: "서울특별시" },
                { lDongRegnCd: "26", lDongRegnNm: "부산광역시" },
                {
                  lDongRegnCd: "26",
                  lDongRegnNm: "부산광역시",
                  lDongSignguCd: "26350",
                  lDongSignguNm: "해운대구",
                },
                { lDongRegnCd: "47", lDongRegnNm: "경상북도" },
                {
                  lDongRegnCd: "47",
                  lDongRegnNm: "경상북도",
                  lDongSignguCd: "47190",
                  lDongSignguNm: "구미시",
                },
              ],
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
assert.deepEqual(tourUsageEvents, [
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
    usageRecorder: (event) => {
      routeUsageEvents.push(event);
    },
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      odsayCalls.push(url);
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
  8,
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
