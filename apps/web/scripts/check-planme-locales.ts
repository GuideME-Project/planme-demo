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

const redirectCases = [
  ["/?q=Seoul", "", "/en?q=Seoul"],
  ["/?q=Seoul", "planme-locale=en", "/en?q=Seoul"],
  ["/?q=Seoul", "planme-locale=ko", "/ko?q=Seoul"],
  ["/", "planme-locale=fr", "/en"],
  ["/itinerary/abc?ref=gpt", "", "/en/itinerary/abc?ref=gpt"],
  ["/itinerary/abc?ref=gpt", "planme-locale=en", "/en/itinerary/abc?ref=gpt"],
  ["/itinerary/abc?ref=gpt", "planme-locale=ko", "/ko/itinerary/abc?ref=gpt"],
  ["/itinerary/abc?ref=gpt", "planme-locale=fr", "/en/itinerary/abc?ref=gpt"],
];
for (const [path, cookie, expected] of redirectCases) {
  const response = proxy(new NextRequest(`https://www.planme.kr${path}`, { headers: { cookie } }));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), `https://www.planme.kr${expected}`);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
}
for (const locale of ["ko", "en"]) {
  const otherLocale = locale === "ko" ? "en" : "ko";
  const explicit = proxy(new NextRequest(`https://www.planme.kr/${locale}`, { headers: { cookie: `planme-locale=${otherLocale}`, "x-planme-locale": otherLocale } }));
  assert.equal(explicit.headers.get("x-middleware-request-x-planme-locale"), locale);
  assert.equal(explicit.headers.get("location"), null);
}
console.log("언어 사전·기간·원문 대체·주소 정책 검사 통과");

async function checkHttp(): Promise<void> {
const base: string | undefined = process.env.PLANME_BASE_URL;
if (base) {
  for (const locale of ["ko", "en"]) {
    const response: Response = await fetch(`${base}/${locale}?q=Seoul`, { headers: { cookie: `planme-locale=${locale === "ko" ? "en" : "ko"}` } });
    assert.equal(response.status, 200);
    const html: string = await response.text();
    assert.ok(html.includes(`lang="${locale}"`));
    assert.ok(html.includes(`rel="canonical" href="https://www.planme.kr/${locale}"`));
    const head = html.slice(0, html.indexOf("</head>")).toLowerCase();
    for (const [language, path] of [["ko", "ko"], ["en", "en"], ["x-default", "en"]]) {
      assert.ok(head.includes(`rel="alternate" hreflang="${language}" href="https://www.planme.kr/${path}"`));
    }
    assert.ok(html.includes(`content="${locale === "ko" ? "ko_KR" : "en_US"}"`));
    assert.ok(html.includes(`aria-label="${locale === "ko" ? "여행 일정 검색" : "Search for an itinerary"}"`));
    const image: Response = await fetch(`${base}/og?locale=${locale}`);
    assert.equal(image.status, 200);
    assert.match(image.headers.get("content-type") ?? "", /image\/png/);
    const png: Buffer = Buffer.from(await image.arrayBuffer());
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
  }
  for (const [path, cookie, expected] of redirectCases) {
    const response: Response = await fetch(`${base}${path}`, { redirect: "manual", headers: { cookie, "Accept-Language": "ko-KR,ko;q=0.9" } });
    assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get("location")!, base).href, `${base}${expected}`);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal((await fetch(`${base}/fr`)).status, 404);
  const defaultImage: Buffer = Buffer.from(await (await fetch(`${base}/og`)).arrayBuffer());
  const englishImage: Buffer = Buffer.from(await (await fetch(`${base}/og?locale=en`)).arrayBuffer());
  assert.deepEqual(defaultImage, englishImage);
  assert.equal((await fetch(`${base}/api/gpt/openapi`)).status, 200);
  console.log("한·영 HTTP 응답·메타데이터·공유 이미지·기존 링크 검사 통과");
}

}
void checkHttp();
