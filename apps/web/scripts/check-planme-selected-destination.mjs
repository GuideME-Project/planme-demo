import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { extname } from "node:path";

// Resolve local TypeScript source without adding a test runner dependency.
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier.startsWith(".") && !extname(specifier) ? `${specifier}.ts` : specifier, context);
} });
const { autocompletePlanmePlaces, resolveSelectedPlanmePlace } = await import("../lib/planme-places.ts");
const { resolveSelectedDomesticDestination } = await import("../lib/planme-selected-destination.ts");

// Actual Google and TourAPI calls, without request interception or provider doubles.
async function main() {
  if (!process.argv.includes("--confirm-external-api")) throw new Error("실제 API 검증에는 --confirm-external-api가 필요합니다.");
  for (const query of ["에버랜드", "경복궁", "서울역"]) {
    const token = randomUUID();
    const { suggestions } = await autocompletePlanmePlaces(query, token);
    assert.ok(suggestions.length);
    const selected = await resolveSelectedPlanmePlace(suggestions[0].placeId, token);
    assert.ok(selected);
    assert.equal(selected.countryCode, "KR");
    assert.equal(selected.isAdministrativeArea, false);
    const result = await resolveSelectedDomesticDestination(selected);
    if (query === "에버랜드") {
      assert.ok(result?.placeTitle, `${query}: 실제 TourAPI place 연결 실패`);
      assert.equal(result.searchText, selected.name);
      console.log(JSON.stringify({ query, searchText: result.searchText, tourPlace: result.placeTitle, distanceMeters: result.distanceMeters }));
    } else {
      // Current real resolver cannot return a unique POI for these inputs.
      assert.equal(result, null, `${query}: 공급자 결과 변경 시 기대 재검토 필요`);
      console.log(JSON.stringify({ query, result: "선택 필드 오류: 지역 여행으로 자동 변경하지 않음" }));
    }
  }
}
void main();
