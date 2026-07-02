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
  "CarryME로 짐을 먼저 보내두면",
  "더 여유로워요",
  "상세 길안내는 지도 앱에서 이어서 확인해요",
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

console.log("PlanME design contract passed");
