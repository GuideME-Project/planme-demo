import type { Coordinate, RouteSegment } from "./contracts.js";

// Estimated walking is only allowed within the approved 700 m straight-line boundary.
export const PLANME_V3_ESTIMATED_WALK_MAX_METERS = 700;
// Estimated walking uses a conservative fixed speed of 4 km/h.
export const PLANME_V3_ESTIMATED_WALK_METERS_PER_HOUR = 4_000;

export type OdsayFailureDecision =
  | { action: "retry"; maxAttempts: 1 }
  | { action: "try_walk" }
  | { action: "estimated_walk" }
  | { action: "exclude_optional_place" }
  | { action: "fail"; reason: "REQUIRED_ROUTE_UNAVAILABLE" | "INVALID_INPUT" | "UNCLASSIFIED" };

export type OdsayFailureInput = {
  kind: "transit" | "walk";
  code: string | number;
  straightDistanceMeters: number;
  requiredSegment: boolean;
  httpStatus?: number;
};

export function decideOdsayFailure(
  input: OdsayFailureInput,
): OdsayFailureDecision {
  const code = String(input.code);

  if (
    input.httpStatus === 408 ||
    input.httpStatus === 429 ||
    (input.httpStatus !== undefined && input.httpStatus >= 500) ||
    code === "-1"
  ) {
    return { action: "retry", maxAttempts: 1 };
  }

  if (input.kind === "transit" && code === "-98") {
    return input.straightDistanceMeters <= PLANME_V3_ESTIMATED_WALK_MAX_METERS
      ? { action: "try_walk" }
      : unavailableRouteDecision(input.requiredSegment);
  }

  if (
    input.kind === "walk" &&
    ["411", "412", "413", "414"].includes(code) &&
    input.straightDistanceMeters <= PLANME_V3_ESTIMATED_WALK_MAX_METERS
  ) {
    return { action: "estimated_walk" };
  }

  if (["3", "4", "5", "6", "-99", "411", "412", "413", "414"].includes(code)) {
    return unavailableRouteDecision(input.requiredSegment);
  }

  if (["-8", "-9"].includes(code)) {
    return { action: "fail", reason: "INVALID_INPUT" };
  }

  return { action: "fail", reason: "UNCLASSIFIED" };
}

export function createEstimatedWalkSegment(input: {
  fromRef: string;
  toRef: string;
  straightDistanceMeters: number;
}): RouteSegment | null {
  if (
    !Number.isFinite(input.straightDistanceMeters) ||
    input.straightDistanceMeters < 0 ||
    input.straightDistanceMeters > PLANME_V3_ESTIMATED_WALK_MAX_METERS
  ) {
    return null;
  }

  const durationMinutes = Math.max(
    1,
    Math.ceil(
      (input.straightDistanceMeters /
        PLANME_V3_ESTIMATED_WALK_METERS_PER_HOUR) *
        60,
    ),
  );

  return {
    fromRef: input.fromRef,
    toRef: input.toRef,
    mode: "walk",
    source: "estimated_walk",
    distanceMeters: input.straightDistanceMeters,
    durationSeconds: durationMinutes * 60,
    geometryStatus: "unavailable",
    paths: [],
  };
}

export function calculateStraightDistanceMeters(
  from: Coordinate,
  to: Coordinate,
) {
  const earthRadiusMeters = 6_371_000;
  const fromLat = toRadians(from.lat);
  const toLat = toRadians(to.lat);
  const latitudeDelta = toRadians(to.lat - from.lat);
  const longitudeDelta = toRadians(to.lng - from.lng);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLat) *
      Math.cos(toLat) *
      Math.sin(longitudeDelta / 2) ** 2;

  return Math.round(
    earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine)),
  );
}

function unavailableRouteDecision(requiredSegment: boolean): OdsayFailureDecision {
  return requiredSegment
    ? { action: "fail", reason: "REQUIRED_ROUTE_UNAVAILABLE" }
    : { action: "exclude_optional_place" };
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}
