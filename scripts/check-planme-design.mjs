import assert from "node:assert/strict";

const baseUrl = process.env.PLANME_BASE_URL ?? "http://localhost:3009";

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

for (const text of requiredTexts) {
  assert.ok(html.includes(text), `Expected rendered detail page to include: ${text}`);
}

for (const fragment of requiredHtmlFragments) {
  assert.ok(html.includes(fragment), `Expected rendered detail page to include HTML fragment: ${fragment}`);
}

console.log("PlanME design contract passed");
