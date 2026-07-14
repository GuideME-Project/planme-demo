import assert from "node:assert/strict";

import {
  arrangeTourCandidatesDeterministically,
  createEstimatedWalkSegment,
  createTripPlan,
  decideOdsayFailure,
  normalizeTourCandidates,
  parseAndValidateAiPlanSelection,
  resolveTripIntent,
  scheduleTripPlan,
} from "@planme/core";

const intentResult = resolveTripIntent({
  destination: " 부산 ",
  durationDays: 1,
  origin: " 서울 ",
  transportMode: "transit",
});
assert.equal(intentResult.ok, true);
if (!intentResult.ok) {
  throw new Error("Expected a valid V3 trip intent.");
}
assert.equal(intentResult.value.destination, "부산");
assert.equal(intentResult.value.travelerCount, 1);
assert.deepEqual(
  resolveTripIntent({ destination: "부산" }),
  {
    ok: false,
    missingSlots: ["origin", "transportMode", "durationDays"],
    invalidSlots: [],
  },
);
assert.equal(
  resolveTripIntent({
    origin: "서울",
    destination: "부산",
    transportMode: "transit",
    durationDays: 14,
  }).ok,
  true,
);
assert.equal(
  resolveTripIntent({
    origin: "서울",
    destination: "부산",
    transportMode: "transit",
    durationDays: 15,
  }).ok,
  false,
);

const records = [
  {
    contentid: "lodging-1",
    contenttypeid: "32",
    title: "<b>부산 호텔</b>",
    mapx: "129.0756",
    mapy: "35.1796",
    addr1: "부산광역시",
    lDongRegnCd: "26",
  },
  {
    contentid: "visit-1",
    contenttypeid: "12",
    title: "해운대 해수욕장",
    mapx: "129.1587",
    mapy: "35.1587",
    addr1: "부산광역시 해운대구",
    lDongRegnCd: "26",
  },
  {
    contentid: "visit-2",
    contenttypeid: "14",
    title: "부산 박물관",
    mapx: "129.092",
    mapy: "35.129",
    lDongRegnCd: "26",
  },
  {
    contentid: "restaurant-1",
    contenttypeid: "39",
    title: "부산 식당",
    mapx: "129.08",
    mapy: "35.18",
    lDongRegnCd: "26",
  },
  {
    contentid: "course-blocked",
    contenttypeid: "25",
    title: "AI가 쓰면 안 되는 여행코스",
    mapx: "129.1",
    mapy: "35.1",
    lDongRegnCd: "26",
  },
  {
    contentid: "festival-without-date",
    contenttypeid: "15",
    title: "날짜 없는 축제",
    mapx: "129.2",
    mapy: "35.2",
    lDongRegnCd: "26",
    eventstartdate: "20260701",
    eventenddate: "20260731",
  },
  {
    contentid: "invalid-coordinate",
    contenttypeid: "12",
    title: "좌표 없는 장소",
    mapx: "0",
    mapy: "0",
    lDongRegnCd: "26",
  },
  {
    contentid: "wrong-district",
    contenttypeid: "12",
    title: "다른 시군구 장소",
    mapx: "129.1",
    mapy: "35.1",
    lDongRegnCd: "26",
    lDongSignguCd: "99999",
  },
];

const candidates = normalizeTourCandidates(records, {
  expectedRegionCode: "26",
  fetchedAt: "2026-07-14T00:00:00.000Z",
  requestedPlaces: ["해운대 해수욕장"],
});
assert.deepEqual(
  candidates.map((candidate) => candidate.contentId),
  ["visit-1", "wrong-district", "visit-2", "lodging-1", "restaurant-1"],
);
assert.equal(
  candidates.find((candidate) => candidate.contentId === "lodging-1")?.title,
  "부산 호텔",
);
assert.equal(candidates.every((candidate) => candidate.source === "tourapi"), true);
assert.deepEqual(
  normalizeTourCandidates(records, {
    expectedContentTypeId: 32,
    expectedRegionCode: "26",
    fetchedAt: "2026-07-14T00:00:00.000Z",
  }).map((candidate) => candidate.contentId),
  ["lodging-1"],
);
assert.equal(
  normalizeTourCandidates(records, {
    expectedRegionCode: "26",
    expectedDistrictCode: "26350",
    fetchedAt: "2026-07-14T00:00:00.000Z",
  }).some((candidate) => candidate.contentId === "wrong-district"),
  false,
);

const validSelectionJson = JSON.stringify({
  lodgingContentId: "lodging-1",
  days: [
    {
      day: 1,
      orderedVisitContentIds: ["visit-1", "visit-2"],
      restaurantContentIds: ["restaurant-1"],
    },
  ],
});
const validSelection = parseAndValidateAiPlanSelection(
  validSelectionJson,
  candidates,
  1,
);
assert.equal(validSelection.ok, true);

assert.deepEqual(
  parseAndValidateAiPlanSelection(
    JSON.stringify({
      lodgingContentId: "lodging-1",
      title: "AI가 만든 이름",
      days: [],
    }),
    candidates,
    1,
  ),
  { ok: false, errorCode: "ADDITIONAL_PROPERTY" },
);
assert.deepEqual(
  parseAndValidateAiPlanSelection(
    JSON.stringify({
      lodgingContentId: "lodging-1",
      days: [
        {
          day: 1,
          orderedVisitContentIds: ["invented-place"],
          restaurantContentIds: [],
        },
      ],
    }),
    candidates,
    1,
  ),
  { ok: false, errorCode: "CANDIDATE_NOT_ALLOWED" },
);

const deterministicFirst = arrangeTourCandidatesDeterministically(candidates, 1);
const deterministicSecond = arrangeTourCandidatesDeterministically(candidates, 1);
assert.deepEqual(deterministicFirst, deterministicSecond);
assert.equal(deterministicFirst.ok, true);

assert.deepEqual(
  decideOdsayFailure({
    code: -98,
    kind: "transit",
    requiredSegment: false,
    straightDistanceMeters: 700,
  }),
  { action: "try_walk" },
);
assert.deepEqual(
  decideOdsayFailure({
    code: 411,
    kind: "walk",
    requiredSegment: false,
    straightDistanceMeters: 700,
  }),
  { action: "estimated_walk" },
);
for (const code of [411, 412, 413, 414]) {
  assert.deepEqual(
    decideOdsayFailure({
      code,
      kind: "walk",
      requiredSegment: false,
      straightDistanceMeters: 699,
    }),
    { action: "estimated_walk" },
  );
  assert.deepEqual(
    decideOdsayFailure({
      code,
      kind: "walk",
      requiredSegment: false,
      straightDistanceMeters: 701,
    }),
    { action: "exclude_optional_place" },
  );
}
for (const code of [3, 4, 5, 6, -99]) {
  assert.deepEqual(
    decideOdsayFailure({
      code,
      kind: "transit",
      requiredSegment: true,
      straightDistanceMeters: 2_000,
    }),
    { action: "fail", reason: "REQUIRED_ROUTE_UNAVAILABLE" },
  );
}
for (const code of [-8, -9]) {
  assert.deepEqual(
    decideOdsayFailure({
      code,
      kind: "transit",
      requiredSegment: false,
      straightDistanceMeters: 2_000,
    }),
    { action: "fail", reason: "INVALID_INPUT" },
  );
}
for (const httpStatus of [408, 429, 500]) {
  assert.deepEqual(
    decideOdsayFailure({
      code: "HTTP_ERROR",
      httpStatus,
      kind: "transit",
      requiredSegment: true,
      straightDistanceMeters: 2_000,
    }),
    { action: "retry", maxAttempts: 1 },
  );
}
assert.deepEqual(
  decideOdsayFailure({
    code: -98,
    kind: "transit",
    requiredSegment: false,
    straightDistanceMeters: 701,
  }),
  { action: "exclude_optional_place" },
);
const estimatedWalk = createEstimatedWalkSegment({
  fromRef: "visit-1",
  toRef: "visit-2",
  straightDistanceMeters: 700,
});
assert.equal(estimatedWalk?.durationSeconds, 11 * 60);
assert.equal(estimatedWalk?.geometryStatus, "unavailable");
assert.deepEqual(estimatedWalk?.paths, []);

if (!validSelection.ok) {
  throw new Error("Expected strict AI selection validation to succeed.");
}
const tripPlan = createTripPlan({
  candidates,
  intent: intentResult.value,
  selection: validSelection.value,
});
assert.ok(tripPlan);
const scheduled = scheduleTripPlan({
  plan: tripPlan,
  firstDayArrivalMinute: 14 * 60,
  routeDurations: [
    { day: 1, toFirstVisitMinutes: 10, betweenVisitMinutes: [10] },
  ],
});
assert.equal(scheduled.ok, true);
if (scheduled.ok) {
  assert.equal(scheduled.days[0].returnTravelStartMinute, 17 * 60);
  assert.equal(scheduled.days[0].visits.length, 1);
  assert.deepEqual(scheduled.excludedContentIds, ["restaurant-1", "visit-2"]);
}
assert.deepEqual(
  scheduleTripPlan({
    plan: tripPlan,
    firstDayArrivalMinute: 16 * 60,
    routeDurations: [
      { day: 1, toFirstVisitMinutes: 10, betweenVisitMinutes: [10] },
    ],
  }),
  {
    ok: false,
    errorCode: "ACTUAL_VISIT_REQUIRED",
    excludedContentIds: ["visit-1", "restaurant-1", "visit-2"],
    deferredMoves: [],
  },
);

const twoDayIntent = {
  ...intentResult.value,
  durationDays: 2,
};
const twoDayPlan = createTripPlan({
  candidates,
  intent: twoDayIntent,
  selection: {
    lodgingContentId: "lodging-1",
    days: [
      {
        day: 1,
        orderedVisitContentIds: ["visit-1", "visit-2"],
        restaurantContentIds: ["restaurant-1"],
      },
      { day: 2, orderedVisitContentIds: [], restaurantContentIds: [] },
    ],
  },
});
assert.ok(twoDayPlan);
const mealSchedule = scheduleTripPlan({
  plan: twoDayPlan,
  firstDayArrivalMinute: 9 * 60 + 30,
  routeDurations: [
    { day: 1, toFirstVisitMinutes: 10, betweenVisitMinutes: [10] },
    { day: 2, toFirstVisitMinutes: 0, betweenVisitMinutes: [] },
  ],
});
assert.equal(mealSchedule.ok, true);
if (mealSchedule.ok) {
  assert.deepEqual(
    mealSchedule.days[0].meals.map((meal) => [
      meal.kind,
      meal.startMinute,
      meal.endMinute,
      meal.locationStatus,
    ]),
    [
      ["lunch", 12 * 60, 13 * 60, "tourapi"],
      ["dinner", 18 * 60, 19 * 60, "unlocated"],
    ],
  );
}
const deferredSchedule = scheduleTripPlan({
  plan: twoDayPlan,
  firstDayArrivalMinute: 20 * 60,
  routeDurations: [
    { day: 1, toFirstVisitMinutes: 10, betweenVisitMinutes: [10] },
    { day: 2, toFirstVisitMinutes: 0, betweenVisitMinutes: [] },
  ],
});
assert.deepEqual(deferredSchedule.deferredMoves, [
  { contentId: "visit-1", fromDay: 1, toDay: 2 },
  { contentId: "visit-2", fromDay: 1, toDay: 2 },
]);

console.log("PlanME V3 core policy checks passed (V3-01, V3-03, V3-04, V3-05).");
