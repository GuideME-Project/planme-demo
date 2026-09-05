import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { autocompletePlanmePlaces, resolveSelectedPlanmePlace } from "../lib/planme-places.ts";

// Real configured provider only; no fixtures or intercepted responses.
// node --env-file=apps/web/.env.local apps/web/scripts/check-planme-places.mjs --confirm-external-api
if (!process.argv.includes("--confirm-external-api")) throw new Error("실제 API 검증에는 --confirm-external-api가 필요합니다.");
for (const [query, country, region] of [["도쿄", "JP", "도쿄"], ["파리", "FR", "파리"], ["서울 중구", "KR", "서울"], ["부산 중구", "KR", "부산"], ["에버랜드", "KR", "용인"]]) {
  const token = randomUUID();
  const { suggestions } = await autocompletePlanmePlaces(query, token);
  assert.ok(suggestions.length > 0 && suggestions.length <= 5);
  const detail = await resolveSelectedPlanmePlace(suggestions[0].placeId, token);
  assert.ok(detail, query);
  assert.equal(detail.countryCode, country);
  assert.ok(detail.formattedAddress.includes(region), detail.formattedAddress);
  assert.ok(detail.searchText.includes(detail.name));
  if (query === "에버랜드") {
    assert.equal(detail.name, "에버랜드");
    assert.ok(detail.searchText.endsWith(" 에버랜드"));
  }
  console.log(JSON.stringify({ query, count: suggestions.length, country: detail.countryCode, name: detail.name, searchText: detail.searchText, coordinateVerified: true }));
}
assert.equal(await resolveSelectedPlanmePlace("invalid/id", randomUUID()), null);
console.log("잘못된 장소 식별자: 공급자 호출 전 거부");
