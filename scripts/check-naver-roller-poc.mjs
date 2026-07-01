import assert from "node:assert/strict";

const baseUrl = process.env.PLANME_BASE_URL ?? "http://localhost:3000";

/**
 * Fetches a local PlanME path for the Naver Roller PoC contract.
 */
async function fetchText(path) {
  const response = await fetch(`${baseUrl}${path}`);

  assert.equal(response.status, 200, `${path} should return HTTP 200`);

  return response.text();
}

const html = await fetchText("/poc/naver-roller-map");

for (const text of [
  "PlanME 네이버 롤러 지도 PoC",
  "NAVER 지도 SDK + PlanME 오버레이",
  "지도 키 등록 완료",
  "목적지 근접",
  "경로 이탈",
]) {
  assert.ok(html.includes(text), `Expected PoC page to include: ${text}`);
}

const apiBody = JSON.parse(await fetchText("/api/naver/directions/demo"));

assert.equal(typeof apiBody.configured, "boolean");
assert.equal(apiBody.ok, true);
assert.ok(Array.isArray(apiBody.route.path));
assert.ok(apiBody.route.path.length >= 2);
assert.ok(Array.isArray(apiBody.route.guides));
assert.ok(apiBody.route.guides.length >= 1);

console.log("Naver Roller PoC contract passed");
