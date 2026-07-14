import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { computeOdsayTransitRoute } from "../lib/route-providers/odsay";
import type { RouteProviderStop } from "../lib/route-providers/types";

const itineraryDashboardPath = resolve(
  process.cwd(),
  "apps/web/components/itinerary/ItineraryDashboard.tsx",
);
const routeMapPath = resolve(process.cwd(), "apps/web/components/itinerary/RouteMap.tsx");

/** Guards the still-valid GUI-157 partial-transit display contract. */
async function main() {
  await assertMarkerOnlyPartialTransitRoute();
  await assertPartialTransitUiContract();

  console.log("PlanME GUI-157 partial transit completion criteria passed");
}

/** Verifies provider-backed markers never turn missing long-distance geometry into a line. */
async function assertMarkerOnlyPartialTransitRoute() {
  const originalApiKey = process.env.NEXT_PUBLIC_ODSAY_API_KEY;
  const originalFetch = globalThis.fetch;
  const stops: RouteProviderStop[] = [
    {
      coordinate: { lat: 38.075392, lng: 128.61885 },
      id: "origin",
      label: "양양종합여객터미널",
      placeSourceRef: "test:origin",
    },
    {
      coordinate: { lat: 34.888103, lng: 128.623902 },
      id: "destination",
      label: "고현버스터미널",
      placeSourceRef: "test:destination",
    },
  ];

  try {
    process.env.NEXT_PUBLIC_ODSAY_API_KEY = "completion-criteria-test-key";
    globalThis.fetch = async (input) => {
      const url = input instanceof Request ? input.url : String(input);

      assert.match(url, /\/v1\/api\/searchPubTransPathT\?/);

      return Response.json({
        result: {
          path: [
            {
              info: {
                totalDistance: 342_000,
                totalTime: 390,
              },
              subPath: [
                {
                  endName: "고현버스터미널",
                  endX: 128.623902,
                  endY: 34.888103,
                  startName: "양양종합여객터미널",
                  startX: 128.61885,
                  startY: 38.075392,
                  trafficType: 5,
                },
              ],
            },
          ],
        },
      });
    };

    const result = await computeOdsayTransitRoute(stops, new AbortController().signal);

    assert.equal(result.geometryStatus, "partial");
    assert.equal(result.segments.length, 1);
    assert.equal(result.segments[0].geometryStatus, "partial");
    assert.deepEqual(result.segments[0].paths, []);
    assert.deepEqual(
      result.transitMarkers.map((marker) => ({
        coordinate: marker.coordinate,
        label: marker.label,
        role: marker.role,
      })),
      [
        {
          coordinate: { lat: 38.075392, lng: 128.61885 },
          label: "탑승: 양양종합여객터미널",
          role: "boarding",
        },
        {
          coordinate: { lat: 34.888103, lng: 128.623902 },
          label: "하차: 고현버스터미널",
          role: "alighting",
        },
      ],
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

/** Guards map markers, timeline events, and partial-status wording against UI regressions. */
async function assertPartialTransitUiContract() {
  const [dashboardSource, routeMapSource] = await Promise.all([
    readFile(itineraryDashboardPath, "utf8"),
    readFile(routeMapPath, "utf8"),
  ]);

  assert.match(dashboardSource, /function createTimelineWithTransitMarkers\(/);
  assert.match(dashboardSource, /장거리 대중교통 탑승 지점/);
  assert.match(dashboardSource, /장거리 대중교통 하차 지점/);
  assert.match(dashboardSource, /장거리 대중교통 본선 좌표는 제공되지 않아 탑승\/하차 지점만 표시합니다\./);
  assert.doesNotMatch(dashboardSource, /경로 체크 완료/);
  assert.match(routeMapSource, /data-testid=\{`transit-marker-\$\{marker\.role\}`\}/);
  assert.doesNotMatch(routeMapSource, /strokeDasharray="5 4"/);
}

void main();
