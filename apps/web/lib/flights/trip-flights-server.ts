import "server-only";
import { flightRequestStatus, parseFlightCache, type TripFlightContext, type TripFlightRequest } from "./contracts";

/** 글로벌 2단계의 서버에서 검증한 여행 날짜·국가·IATA 코드를 전달합니다. AI가 코드를 추측해서는 안 됩니다. */
export async function prepareTripFlights(input: TripFlightRequest): Promise<TripFlightContext> {
  // 글로벌 2단계: 해외 일정 생성과 입력 검증·저장·공유 연결을 완료한 뒤 PLANME_GLOBAL_FLIGHTS_ENABLED=1로 활성화합니다.
  // 코드 주석 해제는 필요 없습니다. 국내 일정은 항상 제외하며, 캐시로 도착 시각이나 예약 확정을 만들지 않습니다.
  const status = flightRequestStatus(input, process.env.PLANME_GLOBAL_FLIGHTS_ENABLED === "1");
  if (status !== "eligible") return { status };
  const token = process.env.TRAVELPAYOUTS_API_TOKEN?.trim();
  if (!token) return { status: "unavailable" };
  try {
    const query = new URLSearchParams({ origin: input.originIata, destination: input.destinationIata,
      departure_at: input.departureDate, one_way: "true", currency: "usd", sorting: "price", limit: "10" });
    // 공급자 대기 상한 8초. 조회 시각은 캐시 생성 시각이 아닙니다.
    const response = await fetch(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${query}`, {
      headers: { "X-Access-Token": token }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { status: "unavailable" };
    const flights = parseFlightCache(await response.text(), input);
    return { status: flights.length ? "ready" : "empty", flights, source: "aviasales_cache", queriedAt: new Date().toISOString() };
  } catch {
    return { status: "unavailable" };
  }
}
