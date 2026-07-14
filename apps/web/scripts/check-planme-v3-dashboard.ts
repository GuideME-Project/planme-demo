import assert from "node:assert/strict";
import {
  createV3DashboardItinerary,
  type Coordinate,
  type ItineraryRevision,
  type ResolvedTripIntent,
  type RouteSegment,
  type TourPlaceSnapshot,
} from "@planme/core";

const origin = { lat: 37.5547, lng: 126.9707 };
const lodging = place("lodging", 32, "인천 TourAPI 호텔", 37.49, 126.62);
const visit = place("visit", 12, "인천 TourAPI 관광지", 37.48, 126.61);
const restaurant = place("restaurant", 39, "인천 TourAPI 음식점", 37.47, 126.6);
const standardSegments = [
  segment("origin", "lodging", origin, lodging.coordinate),
  segment("lodging", "visit", lodging.coordinate, visit.coordinate),
  segment("visit", "restaurant", visit.coordinate, restaurant.coordinate, true),
  segment("restaurant", "origin", restaurant.coordinate, origin),
];
const carrymeSegments = [
  segment("origin", "visit", origin, visit.coordinate),
  segment("visit", "restaurant", visit.coordinate, restaurant.coordinate),
  segment("restaurant", "origin", restaurant.coordinate, origin),
];
const intent = {
  origin: "서울역",
  destination: "인천광역시 중구",
  transportMode: "transit",
  durationDays: 1,
  preferences: [],
  requestedPlaces: [],
  travelerCount: 1,
  luggageCount: 1,
} satisfies ResolvedTripIntent;
const revision: ItineraryRevision = {
  schemaVersion: 3,
  itineraryId: "planme-v3-dashboard-test",
  revision: 1,
  createdAt: "2026-07-14T00:00:00.000Z",
  intent,
  plan: {
    intent,
    lodging,
    selectedPlaces: { lodging, visit, restaurant },
    days: [
      {
        day: 1,
        visits: [
          { contentId: "visit", stayMinutes: 90 },
          { contentId: "restaurant", stayMinutes: 60 },
        ],
        meals: [{ kind: "lunch", contentId: "restaurant" }],
        freeTimePolicy: "free_time",
      },
    ],
    excludedRequestedPlaces: [],
  },
  standard: {
    kind: "standard",
    totalMinutes: 120,
    days: [
      {
        day: 1,
        startMinute: 600,
        endMinute: 1080,
        returnTravelStartMinute: 1020,
        visits: [
          { contentId: "visit", startMinute: 660, endMinute: 750 },
          { contentId: "restaurant", startMinute: 780, endMinute: 840 },
        ],
        meals: [
          {
            kind: "lunch",
            contentId: "restaurant",
            startMinute: 780,
            endMinute: 840,
            locationStatus: "tourapi",
          },
        ],
        idleBlocks: [],
      },
    ],
    segments: standardSegments,
    luggageSegments: [],
    luggageEvents: [],
  },
  carryme: {
    kind: "carryme",
    totalMinutes: 95,
    days: [
      {
        day: 1,
        startMinute: 590,
        endMinute: 1080,
        returnTravelStartMinute: 1020,
        visits: [
          { contentId: "visit", startMinute: 630, endMinute: 720 },
          { contentId: "restaurant", startMinute: 780, endMinute: 840 },
        ],
        meals: [
          {
            kind: "lunch",
            contentId: "restaurant",
            startMinute: 780,
            endMinute: 840,
            locationStatus: "tourapi",
          },
        ],
        idleBlocks: [],
      },
    ],
    segments: carrymeSegments,
    luggageSegments: [segment("origin", "lodging", origin, lodging.coordinate)],
    luggageEvents: [
      { kind: "handoff", day: 1, minute: 540, locationRef: "origin" },
      { kind: "delivered", day: 1, minute: 600, locationRef: "lodging" },
    ],
  },
  selectedPlaceSnapshots: { lodging, visit, restaurant },
};

const dashboard = createV3DashboardItinerary(
  revision,
  "https://planme.example/itinerary/planme-v3-dashboard-test",
);
assert.ok(dashboard);

assert.equal(dashboard.title, "인천광역시 중구 여행 일정");
assert.equal(dashboard.days[0].standard.routeText, "서울역 → 인천 TourAPI 호텔 → 인천 TourAPI 관광지 → 인천 TourAPI 음식점 → 서울역");
assert.equal(dashboard.days[0].carryme.routeText, "서울역 → 인천 TourAPI 관광지 → 인천 TourAPI 음식점 → 서울역");
assert.equal(dashboard.days[0].standard.geoSegments?.length, 3);
assert.equal(dashboard.days[0].standard.geoSegments?.some((path) => path.length === 0), false);
assert.match(dashboard.days[0].standard.description, /예상 도보 1개 구간은 지도선 없음/);
assert.equal(
  dashboard.days[0].standardTimeline?.filter((event) => event.title === restaurant.title).length,
  1,
);
assert.equal(dashboard.days[0].standardTimeline?.[0]?.time, "09:30");
assert.equal(
  dashboard.days[0].standardTimeline?.some(
    (event) => event.title === `${lodging.title} 수하물 보관` && event.time === "10:00",
  ),
  true,
);
assert.equal(
  dashboard.days[0].carrymeTimeline?.some((event) => event.title === "CarryME 수하물 인계"),
  true,
);
assert.equal(JSON.stringify(dashboard).includes("확인되지 않은 장소"), false);

const mismatchedRevision = structuredClone(revision);
mismatchedRevision.standard.segments[0].toRef = "visit";
assert.equal(
  createV3DashboardItinerary(
    mismatchedRevision,
    "https://planme.example/itinerary/mismatched",
  ),
  null,
);

console.log("PlanME V3 dashboard adapter checks passed.");

function place(
  contentId: string,
  contentTypeId: TourPlaceSnapshot["contentTypeId"],
  title: string,
  lat: number,
  lng: number,
): TourPlaceSnapshot {
  return {
    contentId,
    contentTypeId,
    title,
    coordinate: { lat, lng },
    fetchedAt: "2026-07-14T00:00:00.000Z",
    cacheStatus: "fresh",
    source: "tourapi",
  };
}

function segment(
  fromRef: string,
  toRef: string,
  from: Coordinate,
  to: Coordinate,
  estimated = false,
): RouteSegment {
  return {
    fromRef,
    toRef,
    mode: estimated ? "walk" : "transit",
    source: estimated ? "estimated_walk" : "odsay",
    distanceMeters: 1_000,
    durationSeconds: 1_800,
    geometryStatus: estimated ? "unavailable" : "complete",
    paths: estimated ? [] : [[from, to]],
  };
}
