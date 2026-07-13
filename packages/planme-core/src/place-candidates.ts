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

export type PlanmeRequiredPlaceKind = "origin" | "destination" | "must_visit";

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
  destinations: PlanmeResolvedRequiredPlace[];
  origin: PlanmeResolvedRequiredPlace;
};

export type PlanmePlaceCandidateSearchInput = {
  destination?: string;
  maxCandidates?: number;
  preferences?: string[];
  query?: string;
  region?: string;
  signal?: AbortSignal;
  stop: PlanmeDraftStop;
  timeoutMs?: number;
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
  timeoutMs?: number;
  usageRecorder?: PlanmeUsageRecorder;
};

const NAVER_LOCAL_SEARCH_URL = "https://openapi.naver.com/v1/search/local.json";
const DEFAULT_NAVER_LOCAL_TIMEOUT_MS = 4_000;
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
      signal: input.signal ?? options.signal,
      timeoutMs: Math.min(
        input.timeoutMs ?? DEFAULT_NAVER_LOCAL_TIMEOUT_MS,
        options.timeoutMs ?? DEFAULT_NAVER_LOCAL_TIMEOUT_MS,
      ),
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
 * Selects a required user place only when the provider name matches the requested place boundary.
 *
 * Local search can rank businesses that merely contain a landmark name above the landmark itself,
 * for example a hair salon named after 동탄호수공원. Required anchors must not silently drift to
 * those nearby businesses.
 */
export function selectPlanmeRequiredPlaceCandidate(
  inputText: string,
  candidates: PlanmePlaceCandidate[],
): PlanmePlaceCandidate | null {
  const expectedName = normalizeRequiredPlaceName(inputText);
  const validCandidates = candidates.filter(hasPlanmePlaceCandidateHardGate);

  if (!expectedName) {
    return null;
  }

  const exactCandidate = validCandidates.find(
    (candidate) => normalizeRequiredPlaceName(candidate.name) === expectedName,
  );

  if (exactCandidate) {
    return exactCandidate;
  }

  const boundaryCandidates = validCandidates
    .map((candidate, index) => ({
      candidate,
      index,
      normalizedName: normalizeRequiredPlaceName(candidate.name),
    }))
    .filter(({ normalizedName }) =>
      isRequiredPlaceBoundaryMatch(expectedName, normalizedName),
    )
    .sort((left, right) =>
      left.normalizedName.length - right.normalizedName.length || left.index - right.index,
    );

  const boundaryCandidate = boundaryCandidates[0]?.candidate;

  if (boundaryCandidate) {
    return boundaryCandidate;
  }

  // Government-office local searches can return an amenity inside the exact
  // building instead of the building POI. Accept it only when the provider
  // address itself names the requested office, and preserve the user's label.
  if (/(?:구청|시청|군청|도청)$/.test(expectedName)) {
    const addressCandidate = validCandidates.find((candidate) =>
      normalizeRequiredPlaceName(candidate.address ?? "").includes(expectedName),
    );

    if (addressCandidate) {
      return { ...addressCandidate, name: inputText.trim() };
    }
  }

  return null;
}

/** Keeps exact landmarks and benign provider qualifiers while rejecting embedded branch names. */
function isRequiredPlaceBoundaryMatch(expectedName: string, candidateName: string) {
  if (candidateName.endsWith(expectedName)) {
    return true;
  }

  if (!candidateName.startsWith(expectedName)) {
    return false;
  }

  const suffix = candidateName.slice(expectedName.length);

  return /^(?:\d+호선|\d+번출구)$/.test(suffix);
}

/** Normalizes provider decoration without weakening the place-name boundary check. */
function normalizeRequiredPlaceName(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]/gu, "");
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
  timeoutMs,
  usageRecorder,
}: {
  clientId: string;
  clientSecret: string;
  fetchImpl: typeof fetch;
  maxCandidates: number;
  query: string;
  signal?: AbortSignal;
  timeoutMs: number;
  usageRecorder?: PlanmeUsageRecorder;
}) {
  const url = new URL(NAVER_LOCAL_SEARCH_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(maxCandidates));
  url.searchParams.set("start", "1");
  url.searchParams.set("sort", "random");

  await recordPlanmeUsageSafely(usageRecorder, "naver_local_search_request");

  const response = await requestNaverLocalSearch(
    fetchImpl,
    url,
    clientId,
    clientSecret,
    signal,
    timeoutMs,
  );

  const payload = (await response.json()) as NaverLocalSearchResponse;

  return normalizeNaverLocalItems(payload.items ?? [], query).slice(0, maxCandidates);
}

/** Retries only transient local-search failures once and bounds every attempt. */
async function requestNaverLocalSearch(
  fetchImpl: typeof fetch,
  url: URL,
  clientId: string,
  clientSecret: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromParent = () => controller.abort(signal?.reason);

    if (signal?.aborted) {
      abortFromParent();
    } else {
      signal?.addEventListener("abort", abortFromParent, { once: true });
    }

    try {
      const response = await fetchImpl(url, {
        headers: {
          "X-Naver-Client-Id": clientId,
          "X-Naver-Client-Secret": clientSecret,
        },
        method: "GET",
        signal: controller.signal,
      });
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;

      if (response.ok) {
        return response;
      }

      if (!retryable || attempt === 1) {
        throw new PlanmePlaceSearchProviderError(response.status);
      }
    } catch (error) {
      if (signal?.aborted) {
        throw new PlanmePlaceSearchProviderError(408);
      }

      if (error instanceof PlanmePlaceSearchProviderError) {
        throw error;
      }

      if (attempt === 1) {
        throw new PlanmePlaceSearchProviderError(503);
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromParent);
    }
  }

  throw new PlanmePlaceSearchProviderError(503);
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
