const PLACES_URL = "https://places.googleapis.com/v1/places";
// Bound interactive Google requests so typing and submission can recover from provider failures.
const PLACES_TIMEOUT_MS = 3_000;
const SESSION_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PlanmePlaceSuggestion = { placeId: string; name: string; address: string };
export type PlanmePlaceSelection = PlanmePlaceSuggestion & { sessionToken: string };
export type PlanmePlaceAttribution = { provider: string; providerUri?: string };
export type PlanmePlaceSuggestionsResponse = { suggestions: PlanmePlaceSuggestion[]; message?: string };

export function isPlanmePlacesSessionToken(value: string) {
  return SESSION_TOKEN_PATTERN.test(value);
}

export function isPlanmePlaceId(value: string) {
  return /^[A-Za-z0-9_-]{1,255}$/.test(value);
}

export async function autocompletePlanmePlaces(query: string, sessionToken: string, signal?: AbortSignal): Promise<PlanmePlaceSuggestionsResponse> {
  const key = process.env.PLANME_GOOGLE_MAPS_API_KEY?.trim();
  if (!key) throw new Error("PLACES_UNAVAILABLE");
  const response = await fetch(`${PLACES_URL}:autocomplete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat",
    },
    body: JSON.stringify({
      input: query, languageCode: "ko", regionCode: "kr", sessionToken,
      // Explicit worldwide viewport avoids implicit server-IP proximity bias.
      locationBias: { rectangle: { low: { latitude: -90, longitude: -180 }, high: { latitude: 90, longitude: 180 } } },
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(PLACES_TIMEOUT_MS)]) : AbortSignal.timeout(PLACES_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("PLACES_UNAVAILABLE");
  const payload = await response.json() as {
    suggestions?: Array<{ placePrediction?: { placeId?: string; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } }>;
  };
  if (!Array.isArray(payload?.suggestions)) return { suggestions: [] };
  return {
    suggestions: payload.suggestions.flatMap(({ placePrediction: prediction }) => {
      const name = prediction?.structuredFormat?.mainText?.text;
      const address = prediction?.structuredFormat?.secondaryText?.text;
      return typeof prediction?.placeId === "string" && isPlanmePlaceId(prediction.placeId) && typeof name === "string" && name.trim()
        ? [{ placeId: prediction.placeId, name, address: typeof address === "string" ? address : "" }]
        : [];
    }).slice(0, 5),
  };
}

export async function resolveSelectedPlanmePlace(placeId: string, sessionToken: string) {
  const key = process.env.PLANME_GOOGLE_MAPS_API_KEY?.trim();
  if (!key || !isPlanmePlaceId(placeId) || (sessionToken && !isPlanmePlacesSessionToken(sessionToken))) return null;
  const parameters = new URLSearchParams({ languageCode: "ko" });
  if (sessionToken) parameters.set("sessionToken", sessionToken);
  try {
    const response = await fetch(`${PLACES_URL}/${encodeURIComponent(placeId)}?${parameters}`, {
      // displayName preserves selected POIs and uses the Place Details Pro billing tier.
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "id,displayName,formattedAddress,types,addressComponents,location,attributions" },
      signal: AbortSignal.timeout(PLACES_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await response.json() as {
      id?: string;
      formattedAddress?: string;
      displayName?: { text?: string };
      types?: string[];
      addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
      location?: { latitude?: number; longitude?: number };
      attributions?: PlanmePlaceAttribution[];
    };
    if (payload?.id !== placeId || !Array.isArray(payload.addressComponents) ||
      typeof payload.formattedAddress !== "string" || !payload.formattedAddress.trim() ||
      typeof payload.displayName?.text !== "string" || !payload.displayName.text.trim() ||
      !Array.isArray(payload.types) || !payload.types.every((type) => typeof type === "string")) return null;
    const name = payload.displayName.text.trim();
    const formattedAddress = payload.formattedAddress.trim();
    const searchText = formattedAddress.endsWith(name) ? formattedAddress : `${formattedAddress} ${name}`;
    if (searchText.length > 100) return null;
    const countries = payload.addressComponents.filter((component) => Array.isArray(component?.types) && component.types.includes("country"));
    const country = countries[0];
    const lat = payload.location?.latitude;
    const lng = payload.location?.longitude;
    if (countries.length !== 1 || typeof country?.shortText !== "string" || !/^[A-Z]{2}$/.test(country.shortText) ||
      typeof country.longText !== "string" || !country.longText.trim() ||
      typeof lat !== "number" || !Number.isFinite(lat) || Math.abs(lat) > 90 ||
      typeof lng !== "number" || !Number.isFinite(lng) || Math.abs(lng) > 180) return null;
    const attributions = Array.isArray(payload.attributions) ? payload.attributions.filter((item) => typeof item?.provider === "string").map((item) => ({
      provider: item.provider,
      ...(typeof item.providerUri === "string" && item.providerUri.startsWith("https://") ? { providerUri: item.providerUri } : {}),
    })) : [];
    return { countryCode: country.shortText, countryName: country.longText, name, formattedAddress, searchText, isAdministrativeArea: payload.types.includes("political"), coordinate: { lat, lng }, attributions };
  } catch {
    return null;
  }
}
