import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";
import { isLocale, localizedPath } from "../lib/i18n/routing";
import { translate, translateError } from "../lib/i18n/messages";
import en from "../lib/i18n/en.json";
import ko from "../lib/i18n/ko.json";

assert.deepEqual(Object.keys(en).sort(), Object.keys(ko).sort());
assert.equal(isLocale("fr"), false);
assert.equal(localizedPath("/ko/itinerary/abc", "en"), "/en/itinerary/abc");
assert.equal(localizedPath("/en", "ko"), "/ko");
assert.equal(translate("ko", "Departure"), "출발지");
assert.equal(translate("en", "목적지를 입력해 주세요."), "Enter your destination.");
assert.equal(translate("en", "1박 2일"), "1 night / 2 days");
assert.equal(translate("en", "2박 3일"), "2 nights / 3 days");
assert.equal(translate("en", "약 1시간 20분 절약"), "About 1 hr 20 min saved");
assert.equal(translate("en", "약 6시간 30분 → 5시간 20분"), "About 6 hr 30 min → 5 hr 20 min");
assert.equal(translate("en", "2일차"), "Day 2");
assert.equal(translate("en", "서울역 출발"), "Depart from 서울역");
assert.equal(translate("en", "경복궁"), "경복궁");
assert.equal(translateError("en", "새로운 제공자 오류"), "We couldn't complete this request. Please try again.");

for (const [path, cookie, expected] of [
  ["/?q=Seoul", "", "/ko?q=Seoul"],
  ["/?q=Seoul", "planme-locale=en", "/en?q=Seoul"],
  ["/", "planme-locale=fr", "/ko"],
  ["/itinerary/abc?ref=gpt", "planme-locale=en", "/ko/itinerary/abc?ref=gpt"],
]) {
  const response = proxy(new NextRequest(`https://www.planme.kr${path}`, { headers: { cookie } }));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), `https://www.planme.kr${expected}`);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
}
const explicit = proxy(new NextRequest("https://www.planme.kr/en", { headers: { cookie: "planme-locale=ko", "x-planme-locale": "ko" } }));
assert.equal(explicit.headers.get("x-middleware-request-x-planme-locale"), "en");
assert.equal(explicit.headers.get("location"), null);
console.log("언어 사전·기간·원문 대체·주소 정책 검사 통과");

async function checkHttp(): Promise<void> {
const base: string | undefined = process.env.PLANME_BASE_URL;
if (base) {
  for (const locale of ["ko", "en"]) {
    const response: Response = await fetch(`${base}/${locale}?q=Seoul`);
    assert.equal(response.status, 200);
    const html: string = await response.text();
    assert.ok(html.includes(`lang="${locale}"`));
    assert.ok(html.includes(`rel="canonical" href="https://www.planme.kr/${locale}"`));
    assert.ok(html.includes('hrefLang="ko"') || html.includes('hreflang="ko"'));
    assert.ok(html.includes(`content="${locale === "ko" ? "ko_KR" : "en_US"}"`));
    assert.ok(html.includes(locale === "ko" ? "자주 묻는 질문" : "Frequently Asked Questions"));
    const image: Response = await fetch(`${base}/og?locale=${locale}`);
    assert.equal(image.status, 200);
    assert.match(image.headers.get("content-type") ?? "", /image\/png/);
    const png: Buffer = Buffer.from(await image.arrayBuffer());
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
  }
  const redirect: Response = await fetch(`${base}/?q=Seoul`, { redirect: "manual", headers: { cookie: "planme-locale=en" } });
  assert.equal(new URL(redirect.headers.get("location")!, base).pathname, "/en");
  assert.equal(new URL(redirect.headers.get("location")!, base).search, "?q=Seoul");
  assert.equal((await fetch(`${base}/fr`)).status, 404);
  const legacy: Response = await fetch(`${base}/itinerary/busan-bts-1d1n`, { redirect: "manual" });
  assert.equal(new URL(legacy.headers.get("location")!, base).pathname, "/ko/itinerary/busan-bts-1d1n");
  assert.equal((await fetch(`${base}/api/gpt/openapi`)).status, 200);
  console.log("한·영 HTTP 응답·메타데이터·공유 이미지·기존 링크 검사 통과");
}

}
void checkHttp();
