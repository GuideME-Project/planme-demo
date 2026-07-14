import type { PlanmeDraftStop } from "./draft-itineraries.js";
import type { MapCoordinate } from "./mock-data.js";
import {
  recordPlanmeUsageSafely,
  type PlanmeUsageRecorder,
} from "./usage-events.js";

export type PlanmePlaceCandidateSource =
  | "naver_local"
  | "naver_geocode"
  | "input";

export type PlanmePlaceCandidate = {
  candidateId: string;
  id: string;
  name: string;
  address?: string;
  category?: string;
  coordinate: MapCoordinate;
  placeId?: string;
  query?: string;
  source: PlanmePlaceCandidateSource;
  sourceRef: string;
};

export type PlanmeRequiredPlaceKind = "origin" | "destination";

export type PlanmeResolvedRequiredPlace = {
  address?: string;
  coordinate: MapCoordinate;
  inputText: string;
  kind: PlanmeRequiredPlaceKind;
  name: string;
  source: PlanmePlaceCandidateSource;
  sourceRef: string;
};

export type PlanmeResolvedRequiredPlaces = {
  destination: PlanmeResolvedRequiredPlace;
  origin: PlanmeResolvedRequiredPlace;
};

export type PlanmePlaceCandidateSearchInput = {
  destination?: string;
  maxCandidates?: number;
  preferences?: string[];
  query?: string;
  region?: string;
  stop: PlanmeDraftStop;
  userIntent?: string;
};

export type PlanmePlaceCandidateSearchResult = {
  candidates: PlanmePlaceCandidate[];
  searchedQueries: string[];
};

export type PlanmePlaceCandidateSearcher = (
  input: PlanmePlaceCandidateSearchInput,
) => Promise<PlanmePlaceCandidateSearchResult>;

type NaverLocalSearchItem = {
  address?: string;
  category?: string;
  link?: string;
  mapx?: string;
  mapy?: string;
  roadAddress?: string;
  title?: string;
};

type NaverLocalSearchResponse = {
  items?: NaverLocalSearchItem[];
};

type SearchPlanmePlaceCandidateOptions = {
  clientId?: string;
  clientSecret?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  usageRecorder?: PlanmeUsageRecorder;
};

const NAVER_LOCAL_SEARCH_URL = "https://openapi.naver.com/v1/search/local.json";
const DEFAULT_PLANME_PLACE_CANDIDATE_LIMIT = 5;
const MAX_PLANME_PLACE_CANDIDATE_LIMIT = 5;
const NAVER_LOCAL_COORDINATE_SCALE = 10_000_000;

/**
 * Signals that NAVER Developers local-search credentials are unavailable.
 */
export class PlanmePlaceSearchConfigurationError extends Error {
  constructor() {
    super("NAVER_SEARCH_CLIENT_ID and NAVER_SEARCH_CLIENT_SECRET are required.");
    this.name = "PlanmePlaceSearchConfigurationError";
  }
}

/**
 * Preserves a safe provider status without exposing the provider response body.
 */
export class PlanmePlaceSearchProviderError extends Error {
  constructor(readonly status: number) {
    super("Naver local place search failed.");
    this.name = "PlanmePlaceSearchProviderError";
  }
}

/**
 * Searches coordinate-bearing Korean place candidates through Naver Local Search.
 */
export async function searchPlanmePlaceCandidates(
  input: PlanmePlaceCandidateSearchInput,
  options: SearchPlanmePlaceCandidateOptions = {},
): Promise<PlanmePlaceCandidateSearchResult> {
  const searchedQueries = createPlanmePlaceTextQueries(input);
  const sourceCandidate = createSourceBackedStopCandidate(input.stop, searchedQueries[0]);

  if (searchedQueries.length === 0) {
    return {
      candidates: sourceCandidate ? [sourceCandidate] : [],
      searchedQueries,
    };
  }

  const clientId = options.clientId?.trim() || readRuntimeEnv("NAVER_SEARCH_CLIENT_ID");
  const clientSecret =
    options.clientSecret?.trim() || readRuntimeEnv("NAVER_SEARCH_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    if (sourceCandidate) {
      return { candidates: [sourceCandidate], searchedQueries };
    }

    throw new PlanmePlaceSearchConfigurationError();
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const maxCandidates = normalizeCandidateLimit(input.maxCandidates);

  for (const query of searchedQueries) {
    const candidates = await requestNaverLocalCandidates({
      clientId,
      clientSecret,
      fetchImpl,
      maxCandidates,
      query,
      signal: options.signal,
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
 * Builds deterministic Korean text queries without destination-biasing explicit queries.
 */
export function createPlanmePlaceTextQueries(
  input: PlanmePlaceCandidateSearchInput,
): string[] {
  const explicitQuery = input.query?.trim() || input.stop.addressQuery?.trim() || "";
  const stopName = input.stop.name.trim();
  const region = input.region?.trim() || input.destination?.trim() || "";
  const queries = [
    explicitQuery,
    joinQueryParts(region, stopName),
    ...createPreferenceQueries(region, input.userIntent, input.preferences ?? []),
  ];

  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
}

/**
 * Checks the minimum evidence needed before a candidate can become a saved stop.
 */
export function hasPlanmePlaceCandidateHardGate(
  candidate: PlanmePlaceCandidate,
): boolean {
  return isValidCoordinate(candidate.coordinate) && Boolean(candidate.sourceRef.trim());
}

/**
 * Calls the official Naver local-search endpoint with a bounded result count.
 */
async function requestNaverLocalCandidates({
  clientId,
  clientSecret,
  fetchImpl,
  maxCandidates,
  query,
  signal,
  usageRecorder,
}: {
  clientId: string;
  clientSecret: string;
  fetchImpl: typeof fetch;
  maxCandidates: number;
  query: string;
  signal?: AbortSignal;
  usageRecorder?: PlanmeUsageRecorder;
}) {
  const url = new URL(NAVER_LOCAL_SEARCH_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(maxCandidates));
  url.searchParams.set("start", "1");
  url.searchParams.set("sort", "random");

  await recordPlanmeUsageSafely(usageRecorder, "naver_local_search_request");

  const response = await fetchImpl(url, {
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
    method: "GET",
    signal,
  });

  if (!response.ok) {
    throw new PlanmePlaceSearchProviderError(response.status);
  }

  const payload = (await response.json()) as NaverLocalSearchResponse;

  return normalizeNaverLocalItems(payload.items ?? [], query).slice(0, maxCandidates);
}

/**
 * Converts Naver Local Search items into PlanME's provider-neutral candidate shape.
 */
function normalizeNaverLocalItems(items: NaverLocalSearchItem[], query: string) {
  const candidates: PlanmePlaceCandidate[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const name = stripNaverHighlightMarkup(item.title ?? "");
    const coordinate = normalizeNaverLocalCoordinate(item.mapx, item.mapy);
    const address = item.roadAddress?.trim() || item.address?.trim() || undefined;

    if (!name || !coordinate) {
      continue;
    }

    const id = item.link?.trim() || address || name;
    const sourceRef = createPlanmePlaceSourceRef({
      coordinate,
      id,
      source: "naver_local",
    });

    if (seen.has(sourceRef)) {
      continue;
    }

    seen.add(sourceRef);
    candidates.push({
      address,
      candidateId: sourceRef,
      category: item.category?.trim() || undefined,
      coordinate,
      id,
      name,
      query,
      source: "naver_local",
      sourceRef,
    });
  }

  return candidates;
}

/**
 * Converts Naver's integer WGS84 representation into decimal longitude and latitude.
 */
function normalizeNaverLocalCoordinate(
  mapx: string | undefined,
  mapy: string | undefined,
): MapCoordinate | null {
  const lng = Number(mapx) / NAVER_LOCAL_COORDINATE_SCALE;
  const lat = Number(mapy) / NAVER_LOCAL_COORDINATE_SCALE;
  const coordinate = { lat, lng };

  return isValidCoordinate(coordinate) ? coordinate : null;
}

/**
 * Drops the small HTML highlight vocabulary returned in Naver place titles.
 */
function stripNaverHighlightMarkup(value: string) {
  return value.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim();
}

/**
 * Reuses already provider-backed coordinates without issuing another provider request.
 */
function createSourceBackedStopCandidate(
  stop: PlanmeDraftStop,
  query: string | undefined,
): PlanmePlaceCandidate | null {
  if (!stop.coordinate || !stop.placeSourceRef?.trim() || !isValidCoordinate(stop.coordinate)) {
    return null;
  }

  const source = stop.placeSource ?? "input";
  const id = stop.placeSourceRef.trim();

  return {
    candidateId: id,
    id,
    name: stop.name.trim(),
    address: stop.addressQuery?.trim(),
    coordinate: stop.coordinate,
    query,
    source,
    sourceRef: id,
  };
}

/**
 * Adds a geocoded/input candidate without duplicating the Naver Local result.
 */
function appendSourceBackedCandidate(
  candidates: PlanmePlaceCandidate[],
  sourceCandidate: PlanmePlaceCandidate | null,
) {
  if (!sourceCandidate) {
    return candidates;
  }

  const alreadyIncluded = candidates.some(
    (candidate) => candidate.sourceRef === sourceCandidate.sourceRef,
  );

  return alreadyIncluded ? candidates : [...candidates, sourceCandidate];
}

/**
 * Keeps user and AI result counts inside the official Naver maximum of five.
 */
function normalizeCandidateLimit(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PLANME_PLACE_CANDIDATE_LIMIT;
  }

  return Math.max(1, Math.min(MAX_PLANME_PLACE_CANDIDATE_LIMIT, Math.trunc(value)));
}

/**
 * Builds extra text queries from the user's travel intent without coordinate bias.
 */
function createPreferenceQueries(
  region: string,
  userIntent: string | undefined,
  preferences: string[],
) {
  return [userIntent, ...preferences]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean)
    .map((value) => joinQueryParts(region, value));
}

/**
 * Joins region and keyword without duplicating an existing region qualifier.
 */
function joinQueryParts(region: string, value: string) {
  return region && value && !value.includes(region) ? `${region} ${value}` : value;
}

/**
 * Checks finite latitude and longitude ranges before a candidate reaches the hard gate.
 */
function isValidCoordinate(coordinate: MapCoordinate) {
  return (
    Number.isFinite(coordinate.lat) &&
    Number.isFinite(coordinate.lng) &&
    coordinate.lat >= -90 &&
    coordinate.lat <= 90 &&
    coordinate.lng >= -180 &&
    coordinate.lng <= 180
  );
}

/**
 * Creates a reproducible source reference without storing the raw search query.
 */
function createPlanmePlaceSourceRef({
  coordinate,
  id,
  source,
}: {
  coordinate: MapCoordinate;
  id: string;
  source: PlanmePlaceCandidateSource;
}) {
  return [
    source,
    id.trim(),
    coordinate.lat.toFixed(7),
    coordinate.lng.toFixed(7),
  ].join(":");
}

/**
 * Reads server runtime configuration without exposing values to browser payloads.
 */
function readRuntimeEnv(name: string) {
  const runtime = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return runtime.process?.env?.[name]?.trim() ?? "";
}
