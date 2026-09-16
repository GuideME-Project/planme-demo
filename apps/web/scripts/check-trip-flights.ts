import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TripFlights } from "../components/itinerary/TripFlights";
import { flightRequestStatus, parseFlightCache, type TripFlightRequest } from "../lib/flights/contracts";

async function main() {
  const input: TripFlightRequest = { originIata: "SEL", destinationIata: "TYO", departureDate: "2026-10-28", originCountryCode: "KR", destinationCountryCode: "JP" };
  assert.equal(flightRequestStatus(input, false), "disabled");
  assert.equal(flightRequestStatus({ ...input, destinationCountryCode: "KR" }, true), "not_applicable");
  assert.equal(flightRequestStatus(input, true, "2026-09-16"), "eligible");
  for (const departureDate of ["2026-02-30", "2026-09-15", "2026-10", ""]) {
    assert.equal(flightRequestStatus({ ...input, departureDate }, true, "2026-09-16"), "invalid_request");
  }
  assert.equal(flightRequestStatus({ ...input, originIata: "서울" }, true, "2026-09-16"), "invalid_request");
  assert.equal(flightRequestStatus({ ...input, originCountryCode: "" }, true), "invalid_request");
  assert.equal(renderToStaticMarkup(createElement(TripFlights, {})), "");
  assert.equal(renderToStaticMarkup(createElement(TripFlights, { context: { status: "disabled" } })), "");
  assert.equal(renderToStaticMarkup(createElement(TripFlights, { context: { status: "not_applicable" } })), "");
  console.log("통과: 기본 비활성화, 국내 제외, 검증된 코드·날짜 필수 조건");
  if (process.argv.includes("--live")) {
    const token = process.env.TRAVELPAYOUTS_API_TOKEN;
    assert.ok(token, "서버 토큰 설정 필요");
    input.departureDate = process.env.FLIGHT_TEST_DATE ?? input.departureDate;
    const query = new URLSearchParams({ origin: input.originIata, destination: input.destinationIata, departure_at: input.departureDate, currency: "usd", one_way: "true", limit: "10", sorting: "price" });
    const response = await fetch(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${query}`, { headers: { "X-Access-Token": token }, signal: AbortSignal.timeout(8000) });
    assert.equal(response.status, 200);
    const flights = parseFlightCache(await response.text(), input);
    console.log(`통과: 실제 캐시 응답 검증 ${flights.length}개`);
  }
}
main().catch(() => { console.error("항공 모듈 검증 실패. 설정·조건·공급자 응답을 확인하세요."); process.exitCode = 1; });
