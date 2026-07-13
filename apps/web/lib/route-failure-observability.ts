import type { PlanmeItinerary, RouteStop } from "@planme/core";
import type { RouteFinalizationError } from "./itinerary-route-finalizer";

export type PlanmeWebFailureStage =
  | RouteFinalizationError["stage"]
  | "authorization"
  | "lock_acquisition"
  | "preview_persistence"
  | "rate_limit"
  | "record_lookup"
  | "request_validation"
  | "route_finalization";

type RouteFailureContext = {
  dayIndex?: number;
  destinationCoordinate?: RouteFinalizationError["destinationCoordinate"];
  destinationPlaceName?: string;
  originCoordinate?: RouteFinalizationError["originCoordinate"];
  originPlaceName?: string;
  provider?: "naver-directions" | "odsay";
  retried?: boolean;
  routeId?: "standard" | "carryme";
  segmentIndex?: number;
  stopRef?: string;
};

/** Maps web finalization failures to the shared completion-criteria vocabulary. */
export function mapPlanmeWebFailureToCompletionStage(stage: PlanmeWebFailureStage) {
  switch (stage) {
    case "authorization":
    case "rate_limit":
    case "request_validation":
      return "input_interpretation" as const;
    case "coordinate_resolution":
      return "place_resolution" as const;
    case "route_provider":
    case "route_result":
      return "route_calculation" as const;
    case "route_finalization":
    case "timeline_validation":
      return "itinerary_finalization" as const;
    case "lock_acquisition":
    case "preview_persistence":
    case "record_lookup":
      return "storage" as const;
  }
}

/** Builds a stable log object while removing the user's original/return place on either leg side. */
export function createPlanmeRouteFailureLog(input: {
  error?: RouteFinalizationError;
  event: "planme_preview_store_failure" | "planme_route_finalization_failure";
  internalCode: string;
  itinerary?: PlanmeItinerary;
  stage: PlanmeWebFailureStage;
  status: number;
  traceId: string;
}) {
  return {
    completionStage: mapPlanmeWebFailureToCompletionStage(input.stage),
    event: input.event,
    internalCode: input.internalCode,
    stage: input.stage,
    status: input.status,
    traceId: input.traceId,
    ...createSafeRouteFailureContext(input.error, input.itinerary),
  };
}

/** Retains AI-generated stop diagnostics but redacts original-trip identities in both directions. */
function createSafeRouteFailureContext(
  error: RouteFinalizationError | undefined,
  itinerary: PlanmeItinerary | undefined,
): RouteFailureContext {
  if (!error) {
    return {};
  }

  const privateStops = itinerary ? collectPrivateOriginStops(itinerary) : [];
  const hideOrigin = isPrivateOrigin(
    privateStops,
    error.originPlaceName,
    error.originCoordinate,
  );
  const hideDestination = isPrivateOrigin(
    privateStops,
    error.destinationPlaceName,
    error.destinationCoordinate,
  );

  return {
    dayIndex: error.dayIndex,
    destinationCoordinate: hideDestination ? undefined : error.destinationCoordinate,
    destinationPlaceName: hideDestination ? undefined : error.destinationPlaceName,
    originCoordinate: hideOrigin ? undefined : error.originCoordinate,
    originPlaceName: hideOrigin ? undefined : error.originPlaceName,
    provider: error.provider,
    retried: error.retried,
    routeId: error.routeId,
    segmentIndex: error.segmentIndex,
    stopRef: error.stopRef,
  };
}

function collectPrivateOriginStops(itinerary: PlanmeItinerary) {
  const roleBoundaries = itinerary.days.flatMap((day) =>
    [...day.standard.stops, ...day.carryme.stops].filter(
      (stop) => stop.role === "출발지" || stop.role === "복귀지",
    ),
  );
  const firstDay = itinerary.days[0];
  const initialOrigins = [
    firstDay?.standard.stops[0],
    firstDay?.carryme.stops[0],
  ].filter((stop): stop is RouteStop => Boolean(stop));

  // Legacy records may omit role; the first physical stop is still the user-provided origin.
  return [...initialOrigins, ...roleBoundaries];
}

function isPrivateOrigin(
  privateStops: RouteStop[],
  placeName: string | undefined,
  coordinate: RouteFinalizationError["originCoordinate"],
) {
  return privateStops.some((stop) => {
    const sameName = Boolean(
      placeName && stop.label.trim() === placeName.trim(),
    );
    const sameCoordinate = Boolean(
      coordinate &&
        stop.coordinate &&
        coordinate.lat === stop.coordinate.lat &&
        coordinate.lng === stop.coordinate.lng,
    );

    return sameName || sameCoordinate;
  });
}
