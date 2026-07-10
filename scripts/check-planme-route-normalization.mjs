import assert from "node:assert/strict";

import { createPlanmeDraftPreview } from "@planme/core";

const origin = {
  caption: "출발지",
  coordinate: { lat: 37.1998621, lng: 127.0954914 },
  mode: "drive",
  name: "동탄역",
  placeSourceRef: "naver_local:origin",
  role: "출발지",
};
const attraction = {
  caption: "방문지",
  coordinate: { lat: 35.1593434, lng: 129.1609912 },
  mode: "drive",
  name: "부산 아쿠아리움",
  placeSourceRef: "naver_local:attraction",
  role: "방문지",
};
const luggageHotel = {
  caption: "짐 숙소 도착",
  coordinate: { lat: 35.1669953, lng: 129.1317598 },
  mode: "drive",
  name: "부산 호텔",
  placeSourceRef: "naver_local:hotel",
  role: "숙소",
};
const travelerHotel = {
  ...luggageHotel,
  caption: "하루 마무리 숙소",
};
const timeline = [
  {
    category: "arrival",
    description: "부산으로 출발합니다.",
    time: "08:00",
    title: "동탄역 출발",
  },
  {
    category: "hotel",
    description: "짐은 먼저 숙소에 도착합니다.",
    time: "13:30",
    title: "짐 부산 호텔 도착",
  },
  {
    category: "hotel",
    description: "여행자가 숙소에 도착합니다.",
    time: "17:30",
    title: "부산 호텔 도착",
  },
];

const preview = createPlanmeDraftPreview({
  days: [
    {
      carrymeDurationMinutes: 540,
      carrymeRouteText: "동탄역 → 부산 아쿠아리움 → 부산 호텔 → 부산 호텔",
      carrymeStops: [origin, attraction, luggageHotel, travelerHotel],
      carrymeTimeline: timeline,
      day: 1,
      label: "Day 1",
      standardDurationMinutes: 600,
      standardRouteText: "동탄역 → 부산 호텔 → 부산 아쿠아리움 → 부산 호텔",
      standardStops: [origin, travelerHotel, attraction, travelerHotel],
      standardTimeline: timeline,
    },
  ],
  duration: "1박 2일",
  origin: "동탄역",
  region: "부산",
  savedMinutes: 60,
  summary: "연속된 동일 숙소 정규화 테스트",
  title: "부산 일정",
  transportMode: "drive",
});
const carryme = preview.itinerary.days[0].carryme;

assert.deepEqual(
  carryme.stops.map((stop) => stop.label),
  ["동탄역", "부산 아쿠아리움", "부산 호텔"],
);
assert.equal(
  carryme.routeText,
  "동탄역 → 부산 아쿠아리움 → 부산 호텔",
);
assert.equal(
  preview.itinerary.days[0].carrymeTimeline?.some((event) => event.title.includes("짐 부산 호텔 도착")),
  true,
);

console.log("PlanME traveler routes remove duplicate luggage stops while retaining timeline events.");
