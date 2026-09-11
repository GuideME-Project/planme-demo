import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Calls the running route and configured provider; no intercepted responses.
// node apps/web/scripts/check-planme-autocomplete-route.mjs http://localhost:3107 --confirm-external-api
assert.ok(process.argv.includes("--confirm-external-api"), "실제 API 검증에는 --confirm-external-api가 필요합니다.");
const origin = new URL(process.argv[2]).origin;
let cookie = "";
for (const [query, status, sameOrigin] of [
  ["동탄", 200, true],
  ["zxqv987654321없는도시", 200, true],
  ["동", 400, true],
  ["동탄", 403, false],
]) {
  const headers = { "Content-Type": "application/json" };
  if (sameOrigin) headers.Origin = origin;
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${origin}/api/places/autocomplete`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, sessionToken: randomUUID() }),
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(response.status, status, `${query}: 예상 HTTP ${status}, 실제 ${response.status}`);
  assert.ok(response.headers.get("content-type")?.includes("application/json"));
  assert.equal(response.headers.get("cache-control"), "no-store");
  cookie = response.headers.getSetCookie().find((value) => value.startsWith("planme_search_session="))?.split(";")[0] ?? cookie;
  const payload = await response.json();
  assert.ok(Array.isArray(payload.suggestions));
  if (query === "동탄" && status === 200) {
    assert.ok(payload.suggestions.length > 0 && payload.suggestions.length <= 5);
    assert.ok(payload.suggestions.some((place) => place.name.includes("동탄") && place.address.includes("화성")));
    assert.equal(payload.message, undefined);
  } else {
    assert.equal(payload.suggestions.length, 0);
    if (status === 200) assert.equal(payload.message, undefined);
    else assert.ok(payload.message);
  }
  console.log(JSON.stringify({ query, status: response.status, count: payload.suggestions.length, message: payload.message }));
}
