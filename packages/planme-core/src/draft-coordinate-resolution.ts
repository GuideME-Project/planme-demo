import type {
  PlanmeDraftPreviewRequest,
  PlanmeDraftStop,
  PlanmeDraftValidationIssue,
} from "./draft-itineraries.js";
import type { MapCoordinate } from "./mock-data.js";

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
} | null;

export type PlanmeDraftGeocoder = (
  input: PlanmeDraftGeocoderInput,
) => Promise<PlanmeDraftGeocoderResult>;

export type PlanmeDraftCoordinateResolutionResult = {
  draft: PlanmeDraftPreviewRequest;
  validationIssues: PlanmeDraftValidationIssue[];
};

/**
 * Adds provider-verified coordinates to AI draft stops before PlanME renders the map.
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

          // Prefer the AI-authored address query, then fall back to a region-qualified place name.
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
            coordinate: result.coordinate,
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
 * Creates a geocoding query from the safest available draft place text.
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
