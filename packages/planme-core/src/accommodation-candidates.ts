import type { MapCoordinate } from "./mock-data.js";
import {
  searchPlanmePlaceCandidates,
  type PlanmePlaceCandidateSearcher,
} from "./place-candidates.js";

export type AccommodationCandidate = {
  id: string;
  name: string;
  address: string;
  coordinate: MapCoordinate;
  placeId?: string;
  types: string[];
};

export type AccommodationCandidateSearchInput = {
  destination?: string;
  region?: string;
  preferences?: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type AccommodationCandidateSearcher = (
  input: AccommodationCandidateSearchInput,
) => Promise<AccommodationCandidate[]>;

type SearchAccommodationCandidatesOptions = {
  maxCandidates?: number;
  placeCandidateSearcher?: PlanmePlaceCandidateSearcher;
};

const DEFAULT_MAX_CANDIDATES = 5;
const LODGING_PATTERN = /(호텔|펜션|리조트|숙소|모텔|게스트\s*하우스|풀빌라|민박|스테이)/;

/**
 * Finds real accommodation candidates through the shared Naver place searcher.
 */
export async function searchAccommodationCandidates(
  input: AccommodationCandidateSearchInput,
  options: SearchAccommodationCandidatesOptions = {},
): Promise<AccommodationCandidate[]> {
  const destination = input.destination?.trim() || input.region?.trim() || "";

  if (!destination) {
    return [];
  }

  const query = [
    destination,
    ...(input.preferences ?? []).map((value) => value.trim()).filter(Boolean),
    "숙소",
  ].join(" ");
  const searcher = options.placeCandidateSearcher ?? searchPlanmePlaceCandidates;
  const result = await searcher({
    destination,
    maxCandidates: options.maxCandidates ?? DEFAULT_MAX_CANDIDATES,
    preferences: input.preferences,
    query,
    region: input.region,
    signal: input.signal,
    stop: {
      addressQuery: query,
      name: "숙소",
      role: "숙소",
    },
    timeoutMs: input.timeoutMs,
  });

  return result.candidates
    .filter((candidate) =>
      LODGING_PATTERN.test(`${candidate.name} ${candidate.category ?? ""}`),
    )
    .slice(0, options.maxCandidates ?? DEFAULT_MAX_CANDIDATES)
    .map((candidate) => ({
      address: candidate.address ?? "",
      coordinate: candidate.coordinate,
      id: candidate.sourceRef,
      name: candidate.name,
      types: ["lodging"],
    }));
}
