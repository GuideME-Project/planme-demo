import assert from "node:assert/strict";
import { localizeMagazinePage } from "../lib/planme-magazine-translation";
import { parseMagazinePage } from "../lib/planme-magazine";

// Uses published articles and the real translation provider; no test doubles.
async function main() {
  const sourceBase = process.env.PLANME_MAGAZINE_SOURCE_BASE_URL;
  assert.ok(sourceBase, "Set PLANME_MAGAZINE_SOURCE_BASE_URL to an existing PlanME deployment");
  const response = await fetch(`${sourceBase}/api/magazine?countryCode=US&language=ko&skip=0`);
  assert.equal(response.status, 200);
  const page = parseMagazinePage(await response.text(), "US");
  assert.ok(page.list.length > 0);
  const original = JSON.stringify(page);
  assert.equal(await localizeMagazinePage(page, "ko"), page);
  const [english, simultaneous] = await Promise.all([
    localizeMagazinePage(page, "en"), localizeMagazinePage(page, "en"),
  ]);
  assert.deepEqual(english, simultaneous);
  assert.equal(JSON.stringify(page), original);
  assert.equal(english.count, page.count);
  assert.equal(english.list.length, page.list.length);
  english.list.forEach((article, index) => {
    const source = page.list[index];
    assert.equal(article.articleNo, source.articleNo);
    assert.equal(article.articleUrl, source.articleUrl);
    assert.equal(article.thumbnailUrl, source.thumbnailUrl);
    assert.equal(article.countryCode, source.countryCode);
    assert.equal(article.contentLanguage, "en");
    assert.ok(!/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(article.title + (article.summary ?? "")));
    if (source.summary === null) assert.equal(article.summary, null);
  });
  const key = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.deepEqual(await localizeMagazinePage(page, "en"), english);
    assert.equal(await localizeMagazinePage(english, "en"), english);
    // A real, uncached page must fail rather than return Korean when translation is unavailable.
    const nextResponse = await fetch(`${sourceBase}/api/magazine?countryCode=KR&language=ko&skip=0`);
    assert.equal(nextResponse.status, 200);
    const nextPage = parseMagazinePage(await nextResponse.text(), "KR");
    assert.ok(nextPage.list.some(article => article.contentLanguage === "ko"));
    assert.ok(!process.env.UPSTASH_REDIS_REST_URL, "Run this check without shared Redis to isolate cache-miss verification");
    await assert.rejects(localizeMagazinePage(nextPage, "en"), /configuration missing/);
  } finally {
    if (key !== undefined) process.env.OPENAI_API_KEY = key;
  }
  console.log(JSON.stringify({ result: "통과", articles: english.list.map(({ articleNo, title, summary }) => ({ articleNo, title, summary })),
    checked: "실제 기사 영문 번역·동시 요청·캐시 재사용·원본 불변·링크 유지·번역 불가 시 한국어 반환 차단" }, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Magazine check failed"); process.exitCode = 1; });
