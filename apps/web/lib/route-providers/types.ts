import type {
  MapCoordinate,
  PlanmeTransportMode,
  RouteStop,
  RouteTransitMarker,
} from "@planme/core";

export type RouteGeometryStatus = "complete" | "partial";

export type RouteProviderStop = Pick<
  RouteStop,
  "coordinate" | "label" | "placeId" | "placeSourceRef"
> & {
  id: string;
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
  readonly retried: boolean;
  readonly retriable: boolean;

  /** Creates a redacted route-provider error suitable for API responses and logs. */
  constructor(code: string, message: string, retriable: boolean, retried = false) {
    super(message);
    this.name = "RouteProviderError";
    this.code = code;
    this.retried = retried;
    this.retriable = retriable;
  }
}
