import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const baseUrl = process.env.PLANME_BASE_URL ?? "http://localhost:3009";
const itineraryDashboardPath = new URL("../apps/web/components/itinerary/ItineraryDashboard.tsx", import.meta.url);
const routeMapPath = new URL("../apps/web/components/itinerary/RouteMap.tsx", import.meta.url);

const requiredTexts = [
  "테마 버전",
  "총 이동 시간(예상)",
  "약 6시간 30분 → 5시간 20분",
  "절약 시간(예상)",
  "동선 비교",
  "상세 지도",
  "Standard 일정",
  "CarryME 일정",
  "캐리미 짐 탁송 완료",
  "CarryME로 짐 맡기기 (데모)",
  "안전한 짐 배송",
  "실시간 알림",
  "캐리미로 짐을 이동하니, 관광할 시간이 1시간 더 많아졌어요",
];

const requiredHtmlFragments = [
  "/roller/roller-flying.png",
  'data-planme-roller-motion="wing-flap"',
];

const requiredSourceFragments = [
  "캐리미로 짐을 이동하니, 편하게 관광할 수 있네요",
];

const forbiddenHtmlFragments = [
  "data-planme-roller-wing",
];

const forbiddenSourceFragments = [
  "standard: rows,",
];

async function fetchHtml(path) {
  const response = await fetch(`${baseUrl}${path}`);

  assert.equal(
    response.status,
    200,
    `${path} should return HTTP 200, got ${response.status}`,
  );

  return response.text();
}

const html = await fetchHtml("/itinerary/busan-bts-1d1n");
const itineraryDashboardSource = await readFile(itineraryDashboardPath, "utf8");
const routeMapSource = await readFile(routeMapPath, "utf8");

for (const text of requiredTexts) {
  assert.ok(html.includes(text), `Expected rendered detail page to include: ${text}`);
}

for (const fragment of requiredHtmlFragments) {
  assert.ok(html.includes(fragment), `Expected rendered detail page to include HTML fragment: ${fragment}`);
}

for (const fragment of requiredSourceFragments) {
  assert.ok(routeMapSource.includes(fragment), `Expected RouteMap source to include: ${fragment}`);
}

for (const fragment of forbiddenHtmlFragments) {
  assert.ok(!html.includes(fragment), `Expected rendered detail page not to include HTML fragment: ${fragment}`);
}

for (const fragment of forbiddenSourceFragments) {
  assert.ok(!itineraryDashboardSource.includes(fragment), `Expected ItineraryDashboard source not to include: ${fragment}`);
}

console.log("PlanME design contract passed");
