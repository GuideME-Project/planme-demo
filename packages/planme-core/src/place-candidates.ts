import type { PlanmeDraftStop } from "./draft-itineraries.js";
import type { MapCoordinate } from "./mock-data.js";
import {
  recordPlanmeUsageSafely,
  type PlanmeUsageRecorder,
} from "./usage-events.js";

export type PlanmePlaceCandidateSource =
  | "google_text_search"
  | "google_nearby_search"
  | "naver_geocode"
  | "input";

export type PlanmePlaceCandidate = {
  candidateId: string;
  id: string;
  name: string;
  address?: string;
  coordinate: MapCoordinate;
  placeId?: string;
  primaryType?: string;
  query?: string;
  radiusMeters?: number;
  source: PlanmePlaceCandidateSource;
  sourceRef: string;
  types?: string[];
};

export type PlanmePlaceCandidateSearchInput = {
  center?: MapCoordinate;
  destination?: string;
  preferences?: string[];
  radiusMeters?: number;
  region?: string;
  searchMode?: "text" | "nearby";
  stop: PlanmeDraftStop;
};

export type PlanmePlaceCandidateSearchResult = {
  candidates: PlanmePlaceCandidate[];
  searchedQueries: string[];
};

export type PlanmePlaceCandidateSearcher = (
  input: PlanmePlaceCandidateSearchInput,
) => Promise<PlanmePlaceCandidateSearchResult>;

type GooglePlacesSearchResponse = {
  places?: GooglePlace[];
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
  primaryType?: string;
  types?: string[];
};

type SearchPlanmePlaceCandidateOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  referer?: string;
  usageRecorder?: PlanmeUsageRecorder;
};

export const PLANME_NEARBY_RADIUS_METERS = [5000, 10000, 20000] as const;
const DEFAULT_PLANME_PLACE_CANDIDATE_LIMIT = 5;
const MAX_PLANME_PLACE_CANDIDATE_LIMIT = 10;

const GOOGLE_PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const GOOGLE_PLACES_NEARBY_SEARCH_URL = "https://places.googleapis.com/v1/places:searchNearby";
const GOOGLE_PLACES_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types";
const GOOGLE_MAPS_API_KEY_ENV_NAMES = [
  "PLANME_GOOGLE_MAPS_API_KEY",
  "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY",
] as const;

/**
 * Resolves a non-lodging PlanME stop into searchable Google Places candidates.
 */
export async function searchPlanmePlaceCandidates(
  input: PlanmePlaceCandidateSearchInput,
  options: SearchPlanmePlaceCandidateOptions = {},
): Promise<PlanmePlaceCandidateSearchResult> {
  const apiKey = readGoogleMapsApiKey(options.apiKey);
  const fetchImpl = options.fetchImpl ?? fetch;
  const searchedQueries = createPlanmePlaceTextQueries(input);
  const searchCenter = input.center ?? input.stop.coordinate;
  const sourceCandidate = createSourceBackedStopCandidate(input.stop, searchedQueries[0]);

  if (!apiKey || searchedQueries.length === 0) {
    return {
      candidates: sourceCandidate ? [sourceCandidate] : [],
      searchedQueries,
    };
  }

  if (input.searchMode === "nearby") {
    if (!searchCenter) {
      return {
        candidates: sourceCandidate ? [sourceCandidate] : [],
        searchedQueries,
      };
    }

    const candidates = await requestGoogleNearbyCandidates({
      apiKey,
      center: searchCenter,
      fetchImpl,
      query: searchedQueries[0] ?? input.stop.name,
      radiusMeters: normalizeNearbyRadius(input.radiusMeters),
      referer: options.referer,
      usageRecorder: options.usageRecorder,
    });

    return {
      candidates: appendSourceBackedCandidate(candidates, sourceCandidate),
      searchedQueries,
    };
  }

  for (const query of searchedQueries) {
    const candidates = await requestGoogleTextSearchCandidates({
      apiKey,
      center: searchCenter,
      fetchImpl,
      query,
      referer: options.referer,
      usageRecorder: options.usageRecorder,
    });

    if (candidates.length > 0) {
      return {
        candidates: appendSourceBackedCandidate(candidates, sourceCandidate),
        searchedQueries,
      };
    }
  }

  if (!searchCenter) {
    return {
      candidates: sourceCandidate ? [sourceCandidate] : [],
      searchedQueries,
    };
  }

  for (const radiusMeters of PLANME_NEARBY_RADIUS_METERS) {
    const candidates = await requestGoogleNearbyCandidates({
      apiKey,
      center: searchCenter,
      fetchImpl,
      query: searchedQueries[0] ?? input.stop.name,
      radiusMeters: normalizeNearbyRadius(radiusMeters),
      referer: options.referer,
      usageRecorder: options.usageRecorder,
    });

    if (candidates.length > 0) {
      return {
        candidates: appendSourceBackedCandidate(candidates, sourceCandidate),
        searchedQueries,
      };
    }
  }

  return {
    candidates: sourceCandidate ? [sourceCandidate] : [],
    searchedQueries,
  };
}

/**
 * Builds specific Korean Places queries from the draft stop and user travel intent.
 */
export function createPlanmePlaceTextQueries(input: PlanmePlaceCandidateSearchInput): string[] {
  const region = input.destination?.trim() || input.region?.trim() || "";
  const stopName = input.stop.name.trim();
  const addressQuery = input.stop.addressQuery?.trim() ?? "";
  const queries = [
    addressQuery,
    joinQueryParts(region, stopName),
    ...createPreferenceQueries(region, stopName, input.preferences ?? []),
  ];

  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
}

/**
 * Calls Google Places Text Search (New) and returns coordinate-bearing candidates.
 */
async function requestGoogleTextSearchCandidates({
  apiKey,
  center,
  fetchImpl,
  query,
  referer,
  usageRecorder,
}: {
  apiKey: string;
  center?: MapCoordinate;
  fetchImpl: typeof fetch;
  query: string;
  referer?: string;
  usageRecorder?: PlanmeUsageRecorder;
}) {
  try {
    await recordPlanmeUsageSafely(usageRecorder, "google_places_request");

    const response = await fetchImpl(GOOGLE_PLACES_TEXT_SEARCH_URL, {
      method: "POST",
      headers: createGooglePlacesHeaders(apiKey, referer),
      body: JSON.stringify({
        languageCode: "ko",
        regionCode: "KR",
        textQuery: query,
        ...(center
          ? {
              locationBias: {
                circle: {
                  center: toGoogleLatLng(center),
                  radius: PLANME_NEARBY_RADIUS_METERS[PLANME_NEARBY_RADIUS_METERS.length - 1],
                },
              },
            }
          : {}),
      }),
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as GooglePlacesSearchResponse;

    return normalizeGooglePlaces(payload.places ?? [], {
      query,
      source: "google_text_search",
    });
  } catch {
    return [];
  }
}

/**
 * Calls Google Places Nearby Search (New) with the product-capped radius ladder.
 */
async function requestGoogleNearbyCandidates({
  apiKey,
  center,
  fetchImpl,
  query,
  radiusMeters,
  referer,
  usageRecorder,
}: {
  apiKey: string;
  center: MapCoordinate;
  fetchImpl: typeof fetch;
  query: string;
  radiusMeters: number;
  referer?: string;
  usageRecorder?: PlanmeUsageRecorder;
}) {
  try {
    await recordPlanmeUsageSafely(usageRecorder, "google_places_request");

    const response = await fetchImpl(GOOGLE_PLACES_NEARBY_SEARCH_URL, {
      method: "POST",
      headers: createGooglePlacesHeaders(apiKey, referer),
      body: JSON.stringify({
        languageCode: "ko",
        locationRestriction: {
          circle: {
            center: toGoogleLatLng(center),
            radius: radiusMeters,
          },
        },
        maxResultCount: DEFAULT_PLANME_PLACE_CANDIDATE_LIMIT,
        rankPreference: "DISTANCE",
        regionCode: "KR",
      }),
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as GooglePlacesSearchResponse;

    return normalizeGooglePlaces(payload.places ?? [], {
      query,
      radiusMeters,
      source: "google_nearby_search",
    });
  } catch {
    return [];
  }
}

/**
 * Converts Google Places responses into compact PlanME place candidate shapes.
 */
function normalizeGooglePlaces(
  places: GooglePlace[],
  context: Pick<PlanmePlaceCandidate, "query" | "radiusMeters" | "source">,
) {
  const candidates: PlanmePlaceCandidate[] = [];

  for (const place of places) {
    const name = place.displayName?.text?.trim() ?? "";
    const address = place.formattedAddress?.trim();
    const latitude = place.location?.latitude;
    const longitude = place.location?.longitude;

    if (!name || typeof latitude !== "number" || typeof longitude !== "number") {
      continue;
    }

    const id = place.id?.trim() || `${name}:${address ?? ""}`;
    const sourceRef = createPlanmePlaceSourceRef({
      coordinate: { lat: latitude, lng: longitude },
      id,
      query: context.query,
      source: context.source,
    });

    candidates.push({
      candidateId: sourceRef,
      id,
      name,
      address,
      coordinate: { lat: latitude, lng: longitude },
      placeId: place.id?.trim(),
      primaryType: place.primaryType,
      sourceRef,
      types: place.types ?? [],
      ...context,
    });

    // Product UX only needs a short list; the cap also contains provider cost and token usage.
    if (candidates.length >= MAX_PLANME_PLACE_CANDIDATE_LIMIT) {
      break;
    }
  }

  return candidates;
}

/**
 * Converts a provider-backed draft stop, such as Naver geocoding, into the shared candidate model.
 */
function createSourceBackedStopCandidate(
  stop: PlanmeDraftStop,
  query: string | undefined,
): PlanmePlaceCandidate | null {
  if (!stop.coordinate || (!stop.placeId?.trim() && !stop.placeSourceRef?.trim())) {
    return null;
  }

  const source = stop.placeSource ?? "input";
  const id = stop.placeId?.trim() || stop.placeSourceRef?.trim() || stop.name.trim();
  const sourceRef =
    stop.placeSourceRef?.trim() ||
    createPlanmePlaceSourceRef({
      coordinate: stop.coordinate,
      id,
      query,
      source,
    });

  // Keep provider-derived coordinates available to the AI judge without auto-accepting them.
  return {
    candidateId: sourceRef,
    id,
    name: stop.name.trim(),
    address: stop.addressQuery?.trim(),
    coordinate: stop.coordinate,
    placeId: stop.placeId?.trim(),
    query,
    source,
    sourceRef,
  };
}

/**
 * Adds the draft stop's provider-backed candidate without duplicating Google results.
 */
function appendSourceBackedCandidate(
  candidates: PlanmePlaceCandidate[],
  sourceCandidate: PlanmePlaceCandidate | null,
) {
  if (!sourceCandidate) {
    return candidates;
  }

  const alreadyIncluded = candidates.some(
    (candidate) =>
      candidate.placeId === sourceCandidate.placeId ||
      candidate.sourceRef === sourceCandidate.sourceRef,
  );

  return alreadyIncluded ? candidates : [...candidates, sourceCandidate];
}

/**
 * Keeps Nearby Search requests inside PlanME's product cap of 20km.
 */
function normalizeNearbyRadius(radiusMeters: number | undefined) {
  const maxRadiusMeters = 20000;
  const normalizedRadiusMeters =
    typeof radiusMeters === "number" && Number.isFinite(radiusMeters)
      ? radiusMeters
      : maxRadiusMeters;

  return Math.max(1, Math.min(maxRadiusMeters, Math.trunc(normalizedRadiusMeters)));
}

/**
 * Checks the minimum evidence needed before a candidate can become a saved PlanME stop.
 */
export function hasPlanmePlaceCandidateHardGate(candidate: PlanmePlaceCandidate): boolean {
  return (
    typeof candidate.coordinate.lat === "number" &&
    typeof candidate.coordinate.lng === "number" &&
    Boolean(candidate.placeId?.trim() || candidate.sourceRef.trim())
  );
}

/**
 * Creates a reproducible source reference for non-Google candidates that do not have placeId.
 */
function createPlanmePlaceSourceRef({
  coordinate,
  id,
  query,
  source,
}: {
  coordinate: MapCoordinate;
  id: string;
  query?: string;
  source: PlanmePlaceCandidateSource;
}) {
  return [
    source,
    id,
    query?.trim() ?? "",
    coordinate.lat.toFixed(6),
    coordinate.lng.toFixed(6),
  ].join(":");
}

/**
 * Uses travel preferences to widen vague POI labels into searchable Korean place queries.
 */
function createPreferenceQueries(region: string, stopName: string, preferences: string[]) {
  const fishingPreference = [stopName, ...preferences].some((value) => /낚시/.test(value));

  if (fishingPreference) {
    return [
      joinQueryParts(region, "바다낚시"),
      joinQueryParts(region, "낚시터"),
      joinQueryParts(region, "낚시공원"),
    ];
  }

  return preferences
    .map((preference) => preference.trim())
    .filter(Boolean)
    .map((preference) => joinQueryParts(region, preference));
}

/**
 * Joins region and keyword without duplicating already region-qualified text.
 */
function joinQueryParts(region: string, value: string) {
  if (!value) {
    return "";
  }

  return region && !value.includes(region) ? `${region} ${value}` : value;
}

/**
 * Builds the Google Places headers while preserving API-key secrecy.
 */
function createGooglePlacesHeaders(apiKey: string, referer?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...createGoogleMapsRefererHeader(referer),
    "X-Goog-Api-Key": apiKey,
    "X-Goog-FieldMask": GOOGLE_PLACES_FIELD_MASK,
  };
}

/**
 * Converts PlanME's coordinate shape into Google Places request JSON.
 */
function toGoogleLatLng(coordinate: MapCoordinate) {
  return {
    latitude: coordinate.lat,
    longitude: coordinate.lng,
  };
}

/**
 * Reads the Google Maps key from either the dedicated server name or existing Vercel public name.
 */
function readGoogleMapsApiKey(apiKeyOverride?: string) {
  const explicitApiKey = apiKeyOverride?.trim();

  if (explicitApiKey) {
    return explicitApiKey;
  }

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
