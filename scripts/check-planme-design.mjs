import assert from "node:assert/strict";

const baseUrl = process.env.PLANME_BASE_URL ?? "http://localhost:3009";

const requiredTexts = [
  "테마 버전",
  "이용 방법",
  "일정 URL 복사",
  "총 이동 시간(예상)",
  "약 8시간 10분 → 6시간 10분",
  "절약 시간(예상)",
  "동선 비교",
  "상세 지도",
  "Standard 일정",
  "CarryME 일정",
  "캐리미 짐 탁송 완료",
  "CarryME로 짐 맡기기 (데모)",
  "안전한 짐 배송",
  "실시간 알림",
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

const html = await fetchHtml("/itinerary/osaka-2d1n");

for (const text of requiredTexts) {
  assert.ok(html.includes(text), `Expected rendered detail page to include: ${text}`);
}

console.log("PlanME design contract passed");
