import assert from "node:assert/strict";
import { resolvePlanmeDestinationCountry } from "../lib/planme-destination-country.ts";

// Uses the configured real provider, without fixtures or request interception.
// node --env-file=apps/web/.env.local apps/web/scripts/check-planme-global-country.mjs --confirm-external-api
if (!process.argv.includes("--confirm-external-api")) {
  throw new Error("실제 Google API 호출에 동의하려면 --confirm-external-api를 지정하세요.");
}
assert.ok(process.env.PLANME_GOOGLE_MAPS_API_KEY?.trim(), "기존 Google 서버 키가 필요합니다.");

const cases = [
  { query: "부산", status: "domestic", destination: "부산" },
  { query: "Seoul", status: "domestic", destination: "Seoul" },
  { query: "도쿄", status: "international", countryCode: "JP" },
  { query: "Paris", status: "international", countryCode: "FR" },
  { query: "카트만두", status: "international", countryCode: "NP" },
  { query: "나이로비", status: "international", countryCode: "KE" },
  { query: "zxqv987654321없는도시", status: "unresolved" },
  { query: "Springfield", status: "international", countryCode: "US" },
];
for (const testCase of cases) {
  const result = await resolvePlanmeDestinationCountry(testCase.query);
  assert.equal(result.status, testCase.status, `${testCase.query}: ${JSON.stringify(result)}`);
  if (testCase.countryCode) assert.equal(result.countryCode, testCase.countryCode);
  if (testCase.destination) assert.equal(result.destination, testCase.destination);
  console.log(`${testCase.query}: ${JSON.stringify(result)}`);
}

const configuredKey = process.env.PLANME_GOOGLE_MAPS_API_KEY;
try {
  delete process.env.PLANME_GOOGLE_MAPS_API_KEY;
  assert.deepEqual(await resolvePlanmeDestinationCountry("도쿄"), { status: "unavailable" });
  console.log("서버 키 미설정: 해외로 판정하지 않음");
} finally {
  process.env.PLANME_GOOGLE_MAPS_API_KEY = configuredKey;
}
