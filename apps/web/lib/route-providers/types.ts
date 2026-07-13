import type {
  MapCoordinate,
  PlanmeTransportMode,
  RouteStop,
  RouteTransitMarker,
} from "@planme/core";

export type RouteGeometryStatus = "complete" | "partial";

export type RouteProviderStop = Pick<
  RouteStop,
  | "coordinate"
  | "label"
  | "placeConstraint"
  | "placeId"
  | "placeSourceRef"
  | "role"
  | "stopRef"
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
  durationSource: "provider" | "estimated";
  durationSeconds: number;
  geometryStatus: RouteGeometryStatus;
  mode: PlanmeTransportMode;
  paths: MapCoordinate[][];
  transitMarkers?: RouteTransitMarker[];
};

export type TransitAccessFailureReason =
  | "destination_station_missing"
  | "origin_station_missing"
  | "walk_limit_exceeded"
  | "walk_path_missing";

export type TransitAccessFailureStatus =
  | "confirmation_required"
  | "replacement_required";

/** Represents a safe, expected accessibility decision instead of a provider outage. */
export class TransitAccessDecisionError extends Error {
  readonly destinationStop: RouteProviderStop;
  readonly reason: TransitAccessFailureReason;
  readonly segmentIndex: number;
  readonly status: TransitAccessFailureStatus;

  constructor(
    destinationStop: RouteProviderStop,
    segmentIndex: number,
    reason: TransitAccessFailureReason,
  ) {
    super("대중교통 접근 정책에 따라 장소 확인 또는 교체가 필요합니다.");
    this.name = "TransitAccessDecisionError";
    this.destinationStop = destinationStop;
    this.reason = reason;
    this.segmentIndex = segmentIndex;
    this.status = destinationStop.placeConstraint === "replaceable"
      ? "replacement_required"
      : "confirmation_required";
  }
}

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
