import type { MapCoordinate } from "./mock-data.js";

export type AccommodationCandidate = {
  id: string;
  name: string;
  address: string;
  coordinate: MapCoordinate;
  placeId?: string;
  types: string[];
  rating?: number;
  userRatingCount?: number;
};

export type AccommodationCandidateSearchInput = {
  destination?: string;
  region?: string;
  preferences?: string[];
};

export type AccommodationCandidateSearcher = (
  input: AccommodationCandidateSearchInput,
) => Promise<AccommodationCandidate[]>;

type GooglePlacesTextSearchResponse = {
  places?: GooglePlace[];
  error?: {
    message?: string;
  };
};

type GooglePlace = {
  displayName?: {
    text?: string;
  };
  formattedAddress?: string;
  id?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  rating?: number;
  types?: string[];
  userRatingCount?: number;
};

type SearchAccommodationCandidatesOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  maxCandidates?: number;
  referer?: string;
};

const GOOGLE_PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const DEFAULT_MAX_CANDIDATES = 5;
const LODGING_NAME_PATTERN = /(호텔|펜션|리조트|숙소|모텔|게스트\s*하우스|풀빌라|민박|스테이)/;
const GOOGLE_MAPS_API_KEY_ENV_NAMES = [
  "PLANME_GOOGLE_MAPS_API_KEY",
  "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY",
] as const;
const LODGING_TYPES = new Set([
  "hotel",
  "lodging",
  "motel",
  "guest_house",
  "resort_hotel",
  "hostel",
]);

/**
 * Searches real accommodation candidates that PlanME can safely pass into AI generation.
 */
export async function searchAccommodationCandidates(
  input: AccommodationCandidateSearchInput,
  options: SearchAccommodationCandidatesOptions = {},
): Promise<AccommodationCandidate[]> {
  const apiKey = readGoogleMapsApiKey(options.apiKey);
  const textQuery = createAccommodationTextQuery(input);
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;

  if (!apiKey || !textQuery) {
    return [];
  }

  try {
    const response = await fetchImpl(GOOGLE_PLACES_TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...createGoogleMapsRefererHeader(options.referer),
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.userRatingCount",
      },
      body: JSON.stringify({
        languageCode: "ko",
        regionCode: "KR",
        textQuery,
      }),
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as GooglePlacesTextSearchResponse;

    return normalizeGooglePlaces(payload.places ?? []).slice(0, maxCandidates);
  } catch {
    // External search should improve recommendations, not block the whole PlanME widget.
    return [];
  }
}

/**
 * Builds a lodging-oriented Korean text query from the user's destination and preferences.
 */
function createAccommodationTextQuery(input: AccommodationCandidateSearchInput) {
  const destination = input.destination?.trim() || input.region?.trim() || "";
  const preferences = input.preferences?.map((preference) => preference.trim()).filter(Boolean) ?? [];

  if (!destination) {
    return "";
  }

  return [destination, ...preferences, "호텔", "펜션", "리조트", "숙소"].join(" ");
}

/**
 * Converts Google Places responses into the small candidate shape used by PlanME.
 */
function normalizeGooglePlaces(places: GooglePlace[]) {
  const seen = new Set<string>();
  const candidates: AccommodationCandidate[] = [];

  for (const place of places) {
    const name = place.displayName?.text?.trim() ?? "";
    const address = place.formattedAddress?.trim() ?? "";
    const latitude = place.location?.latitude;
    const longitude = place.location?.longitude;
    const types = place.types ?? [];
    const id = place.id?.trim() || `${name}:${address}`;

    if (
      !name ||
      !address ||
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      seen.has(id) ||
      !isLodgingCandidate(name, types)
    ) {
      continue;
    }

    seen.add(id);
    candidates.push({
      id,
      name,
      address,
      coordinate: { lat: latitude, lng: longitude },
      placeId: place.id,
      rating: place.rating,
      types,
      userRatingCount: place.userRatingCount,
    });
  }

  return candidates;
}

/**
 * Keeps only hotel/pension/lodging-like places from broad text search results.
 */
function isLodgingCandidate(name: string, types: string[]) {
  return types.some((type) => LODGING_TYPES.has(type)) || LODGING_NAME_PATTERN.test(name);
}

/**
 * Reads the Google Maps key from either the dedicated server name or the existing Vercel public name.
 */
function readGoogleMapsApiKey(apiKeyOverride?: string) {
  const explicitApiKey = apiKeyOverride?.trim();

  if (explicitApiKey) {
    return explicitApiKey;
  }

  // Keep compatibility with deployments that already configured only NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.
  return GOOGLE_MAPS_API_KEY_ENV_NAMES
    .map((name) => readRuntimeEnv(name))
    .find(Boolean) ?? "";
}

/**
 * Adds only the origin-level referrer needed by HTTP-referrer-restricted Google API keys.
 */
function createGoogleMapsRefererHeader(referer?: string): Record<string, string> {
  const normalizedReferer = normalizeGoogleMapsReferer(referer);

  return normalizedReferer ? { Referer: normalizedReferer } : {};
}

/**
 * Normalizes request URLs to an origin referrer so route details are not sent to Google.
 */
function normalizeGoogleMapsReferer(referer?: string) {
  const trimmedReferer = referer?.trim();

  if (!trimmedReferer) {
    return "";
  }

  try {
    const url = new URL(trimmedReferer);

    return `${url.origin}/`;
  } catch {
    return trimmedReferer.endsWith("/") ? trimmedReferer : `${trimmedReferer}/`;
  }
}

/**
 * Reads server runtime variables without exposing them to browser bundles.
 */
function readRuntimeEnv(name: string) {
  const runtime = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return runtime.process?.env?.[name]?.trim() ?? "";
}
