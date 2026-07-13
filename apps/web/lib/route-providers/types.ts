import type {
  MapCoordinate,
  PlanmeTransportMode,
  RouteStop,
  RouteTransitMarker,
} from "@planme/core";

export type RouteGeometryStatus = "complete" | "partial";

export type RouteProviderStop = Pick<
  RouteStop,
  "coordinate" | "label" | "placeId" | "placeSourceRef" | "role"
> & {
  id: string;
};

export type RouteProviderErrorContext = {
  destinationStop?: RouteProviderStop;
  originStop?: RouteProviderStop;
  segmentIndex?: number;
};

export type RouteProviderSegment = {
  distanceMeters: number;
  durationSeconds: number;
  geometryStatus: RouteGeometryStatus;
  mode: PlanmeTransportMode;
  paths: MapCoordinate[][];
  transitMarkers?: RouteTransitMarker[];
};

export type RouteProviderResult = {
  geometryStatus: RouteGeometryStatus;
  segments: RouteProviderSegment[];
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  transitMarkers: RouteTransitMarker[];
};

/** Represents a provider failure while retaining whether one automatic retry is safe. */
export class RouteProviderError extends Error {
  readonly code: string;
  readonly destinationStop?: RouteProviderStop;
  readonly originStop?: RouteProviderStop;
  readonly retried: boolean;
  readonly retriable: boolean;
  readonly segmentIndex?: number;

  /** Creates an internal provider error whose location context is redacted at the log boundary. */
  constructor(
    code: string,
    message: string,
    retriable: boolean,
    retried = false,
    context: RouteProviderErrorContext = {},
  ) {
    super(message);
    this.name = "RouteProviderError";
    this.code = code;
    this.destinationStop = context.destinationStop;
    this.originStop = context.originStop;
    this.retried = retried;
    this.retriable = retriable;
    this.segmentIndex = context.segmentIndex;
  }
}

/** Adds one failed leg to a provider error without changing its retry classification. */
export function withRouteProviderSegmentContext(
  error: RouteProviderError,
  originStop: RouteProviderStop,
  destinationStop: RouteProviderStop,
  segmentIndex: number,
  retried = error.retried,
) {
  return new RouteProviderError(error.code, error.message, error.retriable, retried, {
    destinationStop,
    originStop,
    segmentIndex,
  });
}
