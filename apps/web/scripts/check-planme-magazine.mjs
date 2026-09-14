import assert from "node:assert/strict";
import { MAGAZINE_API_URL, fetchMagazinePage, parseMagazinePage } from "../lib/planme-magazine.ts";

// Public read-only HTTP calls; no fixtures, generated articles, or intercepted responses.
const japanese = await fetchMagazinePage("JP", "ko");
assert.ok(japanese.count > 0);
assert.ok(japanese.list.length > 0);
assert.ok(japanese.list.every(article => article.countryCode === "JP"));
const french = await fetchMagazinePage("FR", "ko");
assert.ok(french.list.every(article => article.countryCode === "FR"));
assert.ok(french.list.length > 0);
const english = await fetchMagazinePage("JP", "en");
assert.ok(english.list.every(article => ["ko", "en"].includes(article.contentLanguage)));
const next = await fetchMagazinePage("JP", "ko", 6);
assert.ok(next.list.every(article => !japanese.list.some(first => first.articleNo === article.articleNo)));
const empty = await fetchMagazinePage("VA", "en");
assert.equal(empty.count, 0);
assert.deepEqual(empty.list, []);
const pastEnd = await fetchMagazinePage("JP", "ko", japanese.count);
assert.equal(pastEnd.count, japanese.count);
assert.deepEqual(pastEnd.list, []);
const actual = await fetch(`${MAGAZINE_API_URL}?countryCode=JP&take=6`);
const text = await actual.text();
assert.throws(() => parseMagazinePage(text, "FR"), /Invalid magazine response/);
const invalid = await fetch(`${MAGAZINE_API_URL}?countryCode=ZZ`);
assert.equal(invalid.status, 400);
const invalidText = await invalid.text();
assert.throws(() => parseMagazinePage(invalidText, "JP"));

for (const article of japanese.list.slice(0, 1)) {
  assert.equal((await fetch(article.articleUrl)).status, 200);
  if (article.thumbnailUrl) assert.equal((await fetch(article.thumbnailUrl)).status, 200);
}
const base = process.env.PLANME_BASE_URL;
if (base) {
  for (const countryCode of ["JP", "FR", "VA"]) {
    for (const language of ["ko", "en"]) {
      const response = await fetch(`${base}/api/magazine?countryCode=${countryCode}&language=${language}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      parseMagazinePage(await response.text(), countryCode);
    }
  }
  for (const query of ["countryCode=Japan", "countryCode=ZZ", "countryCode=JP&language=fr", "countryCode=JP&skip=-1"]) {
    assert.equal((await fetch(`${base}/api/magazine?${query}`)).status, 400);
  }
}
console.log(JSON.stringify({ result: "통과", japan: japanese.count, france: french.count,
  vatican: empty.count, englishLanguages: [...new Set(english.list.map(article => article.contentLanguage))],
  checked: "실제 국가별 데이터·국가 불일치 거절·빈 결과·다음 페이지·입력 오류·원문과 이미지 HTTP·로컬 프록시" }));
