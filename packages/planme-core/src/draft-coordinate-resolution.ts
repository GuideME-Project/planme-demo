import type {
  PlanmeDraftPreviewRequest,
  PlanmeDraftStop,
  PlanmeDraftValidationIssue,
} from "./draft-itineraries.js";
import type { MapCoordinate } from "./mock-data.js";
import type { PlanmePlaceCandidateSource } from "./place-candidates.js";

export type PlanmeDraftGeocoderInput = {
  query: string;
  stop: PlanmeDraftStop;
  region?: string;
  dayIndex: number;
  stopIndex: number;
};

export type PlanmeDraftGeocoderResult = {
  coordinate: MapCoordinate;
  matchedAddress?: string;
  placeId?: string;
  placeSource?: PlanmePlaceCandidateSource;
  placeSourceRef?: string;
} | null;

export type PlanmeDraftGeocoder = (
  input: PlanmeDraftGeocoderInput,
) => Promise<PlanmeDraftGeocoderResult>;

export type PlanmeDraftCoordinateResolutionResult = {
  draft: PlanmeDraftPreviewRequest;
  validationIssues: PlanmeDraftValidationIssue[];
};

/**
 * Adds provider-verified coordinates to AI-authored draft stops before PlanME renders the map.
 */
export async function resolvePlanmeDraftCoordinates(
  draft: PlanmeDraftPreviewRequest,
  geocoder: PlanmeDraftGeocoder,
): Promise<PlanmeDraftCoordinateResolutionResult> {
  const validationIssues: PlanmeDraftValidationIssue[] = [];
  const days = await Promise.all(
    draft.days.map(async (day, dayIndex) => {
      const stops = await Promise.all(
        day.stops.map(async (stop, stopIndex) => {
          if (stop.coordinate) {
            return stop;
          }

          // Use the model-provided address query first; fall back to region-qualified place text.
          const query = createDraftGeocodeQuery(draft.region, stop);
          const result = query
            ? await geocoder({ query, stop, region: draft.region, dayIndex, stopIndex })
            : null;

          if (!result) {
            validationIssues.push({
              code: "coordinate_resolution_failed",
              message: "일부 장소 좌표를 확인하지 못했습니다.",
              severity: "warning",
            });
            return stop;
          }

          return {
            ...stop,
            addressQuery: result.matchedAddress ?? stop.addressQuery,
            coordinate: result.coordinate,
            placeId: result.placeId,
            placeSource: result.placeSource ?? "naver_geocode",
            placeSourceRef:
              result.placeSourceRef ?? createDraftGeocodeSourceRef(query, result.coordinate),
          };
        }),
      );

      return { ...day, stops };
    }),
  );

  return {
    draft: { ...draft, days },
    validationIssues,
  };
}

/**
 * Creates the safest available Naver geocoding query for a draft stop.
 */
function createDraftGeocodeQuery(region: string | undefined, stop: PlanmeDraftStop) {
  const addressQuery = stop.addressQuery?.trim();

  if (addressQuery) {
    return addressQuery;
  }

  const name = stop.name.trim();
  const regionPrefix = region?.trim();

  return regionPrefix && !name.includes(regionPrefix) ? `${regionPrefix} ${name}` : name;
}

/**
 * Creates a reproducible source reference for geocoder-derived coordinates.
 */
function createDraftGeocodeSourceRef(query: string, coordinate: MapCoordinate) {
  return [
    "naver_geocode",
    query.trim(),
    coordinate.lat.toFixed(6),
    coordinate.lng.toFixed(6),
  ].join(":");
}
