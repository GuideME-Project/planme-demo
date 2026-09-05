import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname } from "node:path";
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith(".") && !extname(specifier) ? `${specifier}.ts` : specifier, context);
} });
const { resolvePlanmeGlobalTrip } = await import("../lib/planme-global-trip.ts");
const { autocompletePlanmePlaces, resolveSelectedPlanmePlace } = await import("../lib/planme-places.ts");

// Uses real configured providers only; no fixtures or request interception.
if (!process.argv.includes("--confirm-external-api")) throw new Error("실제 API 검증에는 --confirm-external-api가 필요합니다.");
async function select(query) {
  const token = crypto.randomUUID();
  const { suggestions } = await autocompletePlanmePlaces(query, token);
  assert.ok(suggestions.length);
  const selected = await resolveSelectedPlanmePlace(suggestions[0].placeId, token);
  assert.ok(selected);
  return selected;
}
const selectedOrigin = await select("로스앤젤레스");
const selectedDestination = await select("부산");
assert.equal(selectedOrigin.countryCode, "US");
assert.equal(selectedDestination.countryCode, "KR");
const selected = await resolvePlanmeGlobalTrip({ origin: "로스앤젤레스", destination: "부산", selectedOrigin, selectedDestination });
assert.equal(selected.internationalSide, "origin");
assert.equal(selected.countryName, selectedOrigin.countryName);
assert.equal(selected.destination, selectedDestination.name);
console.log(JSON.stringify({ scenario: "선택 LA → 부산", result: selected }));

for (const [origin, destination, side] of [["LA", "부산", "origin"], ["서울", "도쿄", "destination"], ["Seoul", "부산", null], ["로스앤젤레스", "도쿄", "destination"], ["zxqv987654321없는도시", "부산", null]]) {
  const result = await resolvePlanmeGlobalTrip({ origin, destination, selectedOrigin: null, selectedDestination: null });
  assert.equal(result?.internationalSide ?? null, side, `${origin} → ${destination}`);
  console.log(JSON.stringify({ scenario: `${origin} → ${destination}`, result }));
}
const key = process.env.PLANME_GOOGLE_MAPS_API_KEY;
try {
  delete process.env.PLANME_GOOGLE_MAPS_API_KEY;
  assert.equal(await resolvePlanmeGlobalTrip({ origin: "LA", destination: "도쿄", selectedOrigin: null, selectedDestination: null }), null);
  console.log("키 미설정: 해외로 단정하지 않음");
} finally {
  process.env.PLANME_GOOGLE_MAPS_API_KEY = key;
}
