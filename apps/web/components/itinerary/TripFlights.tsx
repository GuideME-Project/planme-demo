"use client";
import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import type { TripFlightContext } from "@/lib/flights/contracts";
import { useLocale } from "@/components/i18n/LocaleProvider";

export function TripFlights({ context }: { context?: TripFlightContext }) {
  const { locale } = useLocale();
  const en = locale === "en";
  if (!context || context.status === "disabled" || context.status === "not_applicable") return null;
  if (context.status === "invalid_request" || context.status === "unavailable") return <Alert severity="info">{en ? "Flight references are unavailable. Please check your travel details and try again later." : "항공편 참고 정보를 확인하지 못했습니다. 여행 조건을 확인하고 나중에 다시 시도해 주세요."}</Alert>;
  if (!("flights" in context)) return null;
  return <Stack component="section" aria-label={en ? "Flight references" : "여행 항공편 참고 정보"} spacing={2}>
    <Typography variant="h2">{en ? "Flights for this trip" : "이 여행의 항공편"}</Typography>
    <Alert severity="info">{en ? "Cached one-way fares found by Aviasales users in the last 48 hours. Check current prices and availability via the links." : "최근 48시간 동안 Aviasales 이용자가 검색한 편도 참고 가격입니다. 현재 가격과 예약 가능 여부는 링크에서 다시 확인해 주세요."}</Alert>
    {!context.flights.length && <Typography role="status">{en ? "No cached flights match these dates. This does not mean flights are sold out." : "해당 날짜의 항공편 검색 캐시가 없습니다. 매진을 의미하지 않습니다."}</Typography>}
    {context.flights.map((flight, index) => <Box key={`${flight.searchUrl}-${index}`} sx={{ p: 2, border: 1, borderColor: "divider", borderRadius: 2 }}>
      <Typography sx={{ fontWeight: 700 }}>{flight.originAirport} → {flight.destinationAirport} · {flight.airline}{flight.flightNumber}</Typography>
      <Typography>{en ? "Departure" : "출발"} <time dateTime={flight.departureAt}>{flight.departureAt.slice(0,16).replace("T", " ")}</time> (UTC{flight.departureAt.endsWith("Z") ? "+00:00" : flight.departureAt.slice(-6)})</Typography>
      <Typography>{en ? "Stops" : "경유"} {flight.transfers}{flight.durationMinutes !== null && ` · ${flight.durationMinutes}${en ? " min" : "분"}`}</Typography>
      <Typography>{en ? "Reference fare" : "참고 가격"} {new Intl.NumberFormat(locale, { style: "currency", currency: flight.currency, currencyDisplay: "code" }).format(flight.referencePrice)}</Typography>
      <Button href={flight.searchUrl} target="_blank" rel="noopener noreferrer">{en ? "Check flight on Aviasales (new tab)" : "Aviasales에서 항공편 확인 (새 탭)"}</Button>
    </Box>)}
  </Stack>;
}
