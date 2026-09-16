export type TripFlightRequest = {
  originIata: string;
  destinationIata: string;
  departureDate: string;
  originCountryCode: string;
  destinationCountryCode: string;
};
export type TripFlight = {
  originAirport: string;
  destinationAirport: string;
  airline: string;
  flightNumber: string;
  departureAt: string;
  durationMinutes: number | null;
  transfers: number;
  referencePrice: number;
  currency: "USD";
  searchUrl: string;
};
export type TripFlightContext =
  | { status: "disabled" | "not_applicable" | "invalid_request" | "unavailable" }
  | { status: "ready" | "empty"; source: "aviasales_cache"; queriedAt: string; flights: TripFlight[] };

export function flightRequestStatus(input: TripFlightRequest, enabled: boolean, today = new Date().toISOString().slice(0, 10)) {
  if (!enabled) return "disabled";
  if (!/^[A-Z]{2}$/.test(input.originCountryCode) || !/^[A-Z]{2}$/.test(input.destinationCountryCode)) return "invalid_request";
  if (input.originCountryCode === input.destinationCountryCode) return "not_applicable";
  const date = new Date(`${input.departureDate}T00:00:00Z`);
  if (!/^[A-Z]{3}$/.test(input.originIata) || !/^[A-Z]{3}$/.test(input.destinationIata) ||
    input.originIata === input.destinationIata || !/^\d{4}-\d{2}-\d{2}$/.test(input.departureDate) ||
    !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.departureDate || input.departureDate < today) return "invalid_request";
  return "eligible";
}

type ProviderFlight = {
  origin?: string; destination?: string; origin_airport?: string; destination_airport?: string;
  airline?: string; flight_number?: string; departure_at?: string; duration_to?: number;
  transfers?: number; price?: number; link?: string;
};
export function parseFlightCache(text: string, input: TripFlightRequest): TripFlight[] {
  const body = JSON.parse(text) as { success?: boolean; data?: ProviderFlight[] } | null;
  if (body?.success !== true || !Array.isArray(body.data) || body.data.length > 10) throw new Error("Invalid flight response");
  return body.data.map(item => {
    if (!item || (item.origin !== input.originIata && item.origin_airport !== input.originIata) ||
      (item.destination !== input.destinationIata && item.destination_airport !== input.destinationIata) ||
      typeof item.origin_airport !== "string" || !/^[A-Z]{3}$/.test(item.origin_airport) ||
      typeof item.destination_airport !== "string" || !/^[A-Z]{3}$/.test(item.destination_airport) ||
      typeof item.airline !== "string" || !/^[A-Z0-9]{2,3}$/.test(item.airline) ||
      typeof item.flight_number !== "string" || !/^[A-Z0-9]{1,8}$/.test(item.flight_number) ||
      typeof item.departure_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(item.departure_at) ||
      !Number.isFinite(Date.parse(item.departure_at)) || item.departure_at.slice(0,10) !== input.departureDate ||
      typeof item.price !== "number" || !Number.isFinite(item.price) || item.price <= 0 ||
      typeof item.transfers !== "number" || !Number.isSafeInteger(item.transfers) || item.transfers < 0 ||
      typeof item.link !== "string" || !item.link.startsWith("/search/") || /[\\\s]/.test(item.link)) throw new Error("Invalid flight response");
    const url = new URL(item.link, "https://www.aviasales.com");
    if (url.origin !== "https://www.aviasales.com" || !url.pathname.startsWith("/search/")) throw new Error("Invalid flight link");
    if (item.duration_to != null && (!Number.isSafeInteger(item.duration_to) || item.duration_to <= 0)) throw new Error("Invalid flight duration");
    return { originAirport: item.origin_airport, destinationAirport: item.destination_airport,
      airline: item.airline, flightNumber: item.flight_number, departureAt: item.departure_at,
      durationMinutes: item.duration_to ?? null, transfers: item.transfers, referencePrice: item.price,
      currency: "USD", searchUrl: url.href };
  });
}
