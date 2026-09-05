// Google Geocoding response contract: https://developers.google.com/maps/documentation/geocoding/requests-geocoding
const GOOGLE_GEOCODING_URL = "https://maps.googleapis.com/maps/api/geocode/json";
// Country lookup is a bounded preflight; provider failure must not block domestic generation.
const COUNTRY_LOOKUP_TIMEOUT_MS = 2_500;

type GeocodingComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

export type DestinationGeocodingResponse = {
  status?: string;
  results?: Array<{
    partial_match?: boolean;
    types?: string[];
    address_components?: GeocodingComponent[];
    geometry?: { location?: { lat?: number; lng?: number } };
  }>;
};

export type PlanmeDestinationCountry =
  | { status: "international"; countryCode: string; countryName: string }
  | { status: "domestic"; destination: string }
  | { status: "unresolved" }
  | { status: "unavailable" };

export async function resolvePlanmeDestinationCountry(destination: string): Promise<PlanmeDestinationCountry> {
  const key = process.env.PLANME_GOOGLE_MAPS_API_KEY?.trim();
  if (!key) return { status: "unavailable" };

  const url = new URL(GOOGLE_GEOCODING_URL);
  url.searchParams.set("address", destination);
  url.searchParams.set("language", "ko");
  url.searchParams.set("region", "kr");
  url.searchParams.set("key", key);
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(COUNTRY_LOOKUP_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return { status: "unavailable" };
    const payload = JSON.parse(await response.text()) as DestinationGeocodingResponse;
    return classifyPlanmeDestinationCountry(destination, payload);
  } catch {
    // Do not log the request URL: it contains the server API key.
    return { status: "unavailable" };
  }
}

export function classifyPlanmeDestinationCountry(
  destination: string,
  payload: DestinationGeocodingResponse,
): PlanmeDestinationCountry {
  if (payload?.status === "ZERO_RESULTS") return { status: "unresolved" };
  if (payload?.status !== "OK") return { status: "unavailable" };
  if (!Array.isArray(payload.results) || payload.results.length === 0) {
    return { status: "unresolved" };
  }
  const matches = payload.results.map((result) => classifyGeocodingResult(destination, result));
  // City and province results can both resolve to KR; retain the user's entire domestic query.
  if (matches.every((match) => match.status === "domestic")) {
    return { status: "domestic", destination };
  }
  const first = matches[0];
  // This preflight confirms the country, not one exact city or coordinate.
  if (first.status === "international" && matches.every((match) =>
    match.status === "international" && match.countryCode === first.countryCode,
  )) {
    return first;
  }
  return { status: "unresolved" };
}

function classifyGeocodingResult(
  destination: string,
  result: NonNullable<DestinationGeocodingResponse["results"]>[number],
): PlanmeDestinationCountry {
  if (!result || result.partial_match || !Array.isArray(result.address_components)) {
    return { status: "unresolved" };
  }
  const coordinate = result.geometry?.location;
  if (
    typeof coordinate?.lat !== "number" || !Number.isFinite(coordinate.lat) || Math.abs(coordinate.lat) > 90 ||
    typeof coordinate.lng !== "number" || !Number.isFinite(coordinate.lng) || Math.abs(coordinate.lng) > 180
  ) {
    return { status: "unresolved" };
  }
  const countries = result.address_components.filter((component) =>
    Array.isArray(component?.types) && component.types.includes("country"),
  );
  const country = countries[0];
  if (
    countries.length !== 1 || typeof country?.short_name !== "string" ||
    !/^[A-Z]{2}$/.test(country.short_name) || typeof country.long_name !== "string" || !country.long_name.trim()
  ) {
    return { status: "unresolved" };
  }
  if (country.short_name !== "KR") {
    return { status: "international", countryCode: country.short_name, countryName: country.long_name.trim() };
  }

  return { status: "domestic", destination };
}
