"use client";

import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import DirectionsBusRoundedIcon from "@mui/icons-material/DirectionsBusRounded";
import DirectionsCarRoundedIcon from "@mui/icons-material/DirectionsCarRounded";
import DragIndicatorRoundedIcon from "@mui/icons-material/DragIndicatorRounded";
import LocationOnOutlinedIcon from "@mui/icons-material/LocationOnOutlined";
import MapOutlinedIcon from "@mui/icons-material/MapOutlined";
import PhoneIphoneRoundedIcon from "@mui/icons-material/PhoneIphoneRounded";
import RouteRoundedIcon from "@mui/icons-material/RouteRounded";
import ShieldRoundedIcon from "@mui/icons-material/ShieldRounded";
import WbSunnyRoundedIcon from "@mui/icons-material/WbSunnyRounded";
import WorkRoundedIcon from "@mui/icons-material/WorkRounded";
import {
  alpha,
  Box,
  Button,
  Chip,
  Divider,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from "@mui/material";
import type {
  ChangeEvent,
  DragEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type {
  BenefitItem,
  MapCoordinate,
  PlanmeRowMode,
  PlanmeTransportMode,
  PlanmeStopRole,
  PlanmeItinerary,
  ProviderSegmentMode,
  RoutePlan,
  RoutePlanId,
  RouteStop,
  RouteTransitMarker,
  TimelineEvent,
} from "@planme/core";
import { RouteMap } from "@/components/itinerary/RouteMap";
import { TimelinePanel } from "@/components/itinerary/TimelinePanel";
import { usePlanmeColorMode } from "@/theme/ThemeRegistry";

type ItineraryDashboardProps = {
  itinerary: PlanmeItinerary;
  compact: boolean;
  editingEnabled?: boolean;
  finalizationToken?: string;
  routeFinalized?: boolean;
  routeRevision?: number;
};

type FinalizationApiResponse = {
  error?: string;
  itinerary?: PlanmeItinerary;
  message?: string;
  revision?: number;
  status?: "ready";
  token?: string;
};

type EditableDayPlan = Omit<PlanmeItinerary["days"][number], "day"> & {
  day: number;
  uiId: string;
};

type RouteGeometryStatus = "complete" | "partial" | "none";
type DestinationRow = {
  caption?: string;
  coordinate?: MapCoordinate;
  id: string;
  mode?: PlanmeRowMode;
  name: string;
  placeId?: string;
  placeSource?: RouteStop["placeSource"];
  placeSourceRef?: string;
  role?: PlanmeStopRole;
};

type ProviderRoutePoint = Pick<DestinationRow, "coordinate" | "id" | "name">;

type RouteBlockingReason = "missingCoordinate" | "missingRoleOrMode";

type DestinationDragPreview = {
  label: string;
  width: number;
  x: number;
  y: number;
};

type DestinationCandidate = {
  address?: string;
  candidateId: string;
  category?: string;
  coordinate: MapCoordinate;
  name: string;
  placeSource: "naver_local" | "naver_geocode";
  placeSourceRef: string;
};

type PlaceSearchApiResponse = {
  candidates?: DestinationCandidate[];
  message?: string;
};

type RouteCheckApiResponse = {
  geometryStatus?: RouteGeometryStatus;
  blockingReason?: RouteBlockingReason;
  message?: string;
  ok: boolean;
  path?: MapCoordinate[];
  segments?: Array<{
    distanceMeters: number;
    durationSeconds: number;
    geometryStatus?: RouteGeometryStatus;
    mode: ProviderSegmentMode;
    path: MapCoordinate[];
    paths?: MapCoordinate[][];
    transitMarkers?: RouteTransitMarker[];
  }>;
  transitMarkers?: RouteTransitMarker[];
  totalDurationSeconds?: number;
  totalDistanceMeters?: number;
  totalDurationLabel?: string;
  warnings?: string[];
};

type RouteCheckResult = {
  payload: RouteCheckApiResponse;
  responseOk: boolean;
};

type AsyncStatus = "idle" | "loading" | "success" | "error";

type ComputedRouteResult = {
  durationLabel?: string;
  durationMinutes?: number;
  geometryStatus?: RouteGeometryStatus;
  path: MapCoordinate[];
  routeText: string;
  segments: MapCoordinate[][];
  stops: RouteStop[];
  timeline: TimelineEvent[];
  transitMarkers: RouteTransitMarker[];
};

type ComputedRouteState = Partial<
  Record<RoutePlanId, ComputedRouteResult>
>;

type RouteComputationPayload = ComputedRouteState;

type EditedItineraryFinalizationResult = {
  message: string;
  ok: boolean;
};

type DisplayHeaderCopy = {
  summary: string;
  title: string;
};

const benefitIcons: Record<BenefitItem["icon"], ReactNode> = {
  shield: <ShieldRoundedIcon />,
  time: <AccessTimeRoundedIcon />,
  luggage: <WorkRoundedIcon />,
  phone: <PhoneIphoneRoundedIcon />,
};

const destinationModeOptions: Array<{
  icon: ReactNode;
  label: string;
  value: PlanmeRowMode;
}> = [
  { icon: <DirectionsCarRoundedIcon fontSize="small" />, label: "자동차", value: "drive" },
  { icon: <DirectionsBusRoundedIcon fontSize="small" />, label: "대중교통", value: "transit" },
];

/**
 * Keeps day tabs compact even when AI writes descriptive labels for each day.
 */
function formatDayToggleLabel(day: Pick<EditableDayPlan, "day">, index: number) {
  const dayNumber = Number.isFinite(day.day) && day.day > 0 ? Math.trunc(day.day) : index + 1;

  return `${dayNumber}일차`;
}

const odsayApiKey = process.env.NEXT_PUBLIC_ODSAY_API_KEY ?? "";
// Long-distance transit responses below this straight-line distance are treated as local routes.
const longDistanceTransitThresholdMeters = 50_000;
// Provider distance shorter than half the straight-line distance is not plausible for transit.
const minimumProviderDistanceRatio = 0.5;
// Successful ODsay responses are reusable while a user edits and recalculates the same route.
const odsayResponseCacheTtlMs = 10 * 60 * 1000;
// Browser-persisted ODsay success cache lives for one day to survive refresh/reopen in this demo.
const odsayPersistentResponseCacheTtlMs = 24 * 60 * 60 * 1000;
// Repeated 429 responses are cached briefly to avoid hammering an already-limited key.
const odsayRateLimitCacheTtlMs = 30 * 1000;
// Keep browser-side ODsay requests spaced out to reduce burst-limit failures.
const odsayMinimumRequestIntervalMs = 250;
const odsayPersistentCacheStoragePrefix = "planme:odsay-cache:v1:";
// Browser-persisted Naver route cache also lives for one day to avoid repeated car route calls.
const naverRoutePersistentResponseCacheTtlMs = 24 * 60 * 60 * 1000;
const naverRoutePersistentCacheStoragePrefix = "planme:naver-route-cache:v1:";
const inFlightOdsayRequests = new Map<string, Promise<OdsayResponseWithError>>();
const odsayResponseCache = new Map<string, CachedOdsayResponse>();
const naverRouteResponseCache = new Map<string, CachedNaverRouteResponse>();
let lastOdsayRequestStartedAt = 0;
let odsayRequestQueue: Promise<void> = Promise.resolve();

type OdsayError = {
  code?: string;
  message?: string;
};

type OdsayErrorPayload = OdsayError | OdsayError[];

type OdsayResponseWithError = {
  error?: OdsayErrorPayload;
};

type CachedOdsayResponse = {
  data: OdsayResponseWithError;
  expiresAt: number;
};

type PersistedOdsayResponse = {
  data?: OdsayResponseWithError;
  expiresAt?: number;
};

type CachedNaverRouteResponse = {
  data: RouteCheckApiResponse;
  expiresAt: number;
};

type PersistedNaverRouteResponse = {
  data?: RouteCheckApiResponse;
  expiresAt?: number;
};

type OdsayCoordinate = {
  x?: number;
  y?: number;
};

type OdsayWalkRouteResponse = OdsayResponseWithError & {
  result?: {
    path?: Array<{
      hasPathResult?: boolean;
      recommend?: {
        routes?: Array<{
          coordinate?: OdsayCoordinate[];
          distance?: number;
          duration?: number;
        }>;
        summary?: {
          distance?: number;
          duration?: number;
        };
      };
    }>;
  };
};

type OdsayTrainTerminal = {
  stationID?: number;
  stationName?: string;
  x?: number;
  y?: number;
};

type OdsayTrainTerminalResponse = OdsayResponseWithError & {
  result?:
    | OdsayTrainTerminal
    | OdsayTrainTerminal[]
    | {
        station?: OdsayTrainTerminal[];
        stations?: OdsayTrainTerminal[];
      };
};

type OdsayTrainPathResponse = OdsayResponseWithError & {
  result?: {
    path?: Array<{
      info?: {
        trainTravelDistance?: number;
        trainTravelTime?: number;
      };
      subPath?: Array<{
        distance?: number;
        sectionTime?: number;
        vertices?: OdsayCoordinate[];
      }>;
    }>;
  };
};

type OdsayTransitSubPath = {
  distance?: number;
  endName?: string;
  endX?: number;
  endY?: number;
  sectionTime?: number;
  startName?: string;
  startX?: number;
  startY?: number;
  trafficType?: number;
};

type ProviderRouteSegment = {
  distanceMeters: number;
  durationSeconds: number;
  geometryStatus?: RouteGeometryStatus;
  path: MapCoordinate[];
  paths: MapCoordinate[][];
  transitMarkers?: RouteTransitMarker[];
};

type OdsayTransitPath = {
  info?: {
    mapObj?: string;
    totalDistance?: number;
    totalTime?: number;
  };
  subPath?: OdsayTransitSubPath[];
};

type OdsayTransitPathResponse = OdsayResponseWithError & {
  result?: {
    path?: OdsayTransitPath[];
  };
};

type OdsayLoadLaneResponse = OdsayResponseWithError & {
  result?: {
    lane?: Array<{
      section?: Array<{
        graphPos?: OdsayCoordinate[];
      }>;
    }>;
  };
};

/**
 * Converts fixed itinerary days into local UI state that can add or remove days.
 */
function createEditableDays(days: PlanmeItinerary["days"]): EditableDayPlan[] {
  return days.map((day) => ({
    ...day,
    carryme: normalizeRoutePlanStops(day.carryme),
    standard: normalizeRoutePlanStops(day.standard),
    uiId: `seed-day-${day.day}`,
  }));
}

/**
 * Removes parcel-only and adjacent duplicate places from one traveler route plan.
 */
function normalizeRoutePlanStops(route: RoutePlan): RoutePlan {
  const travelerStops = route.stops.filter((stop, index) => {
    if (!isLuggageArrivalRouteStop(stop)) {
      return true;
    }

    return !route.stops.some(
      (candidate, candidateIndex) =>
        candidateIndex !== index &&
        !isLuggageArrivalRouteStop(candidate) &&
        isSameRouteLocation(stop, candidate),
    );
  });
  const stops = travelerStops.reduce<RouteStop[]>((normalized, stop) => {
    const previous = normalized[normalized.length - 1];

    if (previous && isSameRouteLocation(previous, stop)) {
      // Keep the later traveler event and remove only the zero-distance adjacent leg.
      normalized[normalized.length - 1] = stop;
      return normalized;
    }

    normalized.push(stop);
    return normalized;
  }, []);

  if (stops.length === route.stops.length) {
    return route;
  }

  return {
    ...route,
    routeText: stops.map((stop) => stop.label).join(" → "),
    stops,
  };
}

/**
 * Detects a CarryME parcel event that belongs in the timeline, not the traveler path.
 */
function isLuggageArrivalRouteStop(stop: RouteStop) {
  const caption = stop.caption.replace(/\s+/g, " ").trim();

  return stop.role === "숙소" && /짐.*도착|도착.*짐/.test(caption);
}

/**
 * Checks whether two rendered route stops resolve to the same physical place.
 */
function isSameRouteLocation(left: RouteStop, right: RouteStop) {
  if (left.placeSourceRef && right.placeSourceRef) {
    return left.placeSourceRef === right.placeSourceRef;
  }

  if (left.placeId && right.placeId) {
    return left.placeId === right.placeId;
  }

  if (left.coordinate && right.coordinate) {
    return (
      left.coordinate.lat === right.coordinate.lat &&
      left.coordinate.lng === right.coordinate.lng
    );
  }

  return left.label.trim() === right.label.trim();
}

/**
 * Builds editable destination rows from the CarryME route because that is the target optimized path.
 */
function createDestinationRows(route: RoutePlan): DestinationRow[] {
  return route.stops.map((stop, index) => ({
    caption: stop.caption,
    coordinate: stop.coordinate,
    id: `destination-${index}-${stop.label}`,
    mode: stop.mode,
    name: stop.label,
    placeId: stop.placeId,
    placeSource: stop.placeSource,
    placeSourceRef: stop.placeSourceRef,
    role: stop.role,
  }));
}

/**
 * Builds the API request rows for a route plan.
 */
function createRouteRequestRows(route: RoutePlan): DestinationRow[] {
  const rows = route.stops.map((stop, index) => ({
    caption: stop.caption,
    coordinate: stop.coordinate,
    id: `${route.id}-route-${index}-${stop.label}`,
    mode: stop.mode,
    name: stop.label,
    placeId: stop.placeId,
    placeSource: stop.placeSource,
    placeSourceRef: stop.placeSourceRef,
    role: stop.role,
  }));

  return removeAdjacentDuplicateRows(rows);
}

/**
 * Prevents an edited or legacy route from sending a same-place segment to a provider.
 */
function removeAdjacentDuplicateRows(rows: DestinationRow[]) {
  return rows.reduce<DestinationRow[]>((normalized, row) => {
    const previous = normalized[normalized.length - 1];

    if (previous && isSameDestinationRowLocation(previous, row)) {
      // The latest row carries the final role and caption shown after normalization.
      normalized[normalized.length - 1] = row;
      return normalized;
    }

    normalized.push(row);
    return normalized;
  }, []);
}

/**
 * Compares editable rows using provider identity before falling back to resolved coordinates.
 */
function isSameDestinationRowLocation(left: DestinationRow, right: DestinationRow) {
  if (left.placeSourceRef && right.placeSourceRef) {
    return left.placeSourceRef === right.placeSourceRef;
  }

  if (left.placeId && right.placeId) {
    return left.placeId === right.placeId;
  }

  if (left.coordinate && right.coordinate) {
    return (
      left.coordinate.lat === right.coordinate.lat &&
      left.coordinate.lng === right.coordinate.lng
    );
  }

  return left.name.trim() === right.name.trim();
}

/**
 * Converts editable destination rows into route stops for committed display state.
 */
function createRouteStopsFromRows(rows: DestinationRow[]): RouteStop[] {
  return rows.map((row) => ({
    caption: getDestinationRoleLabel(row),
    coordinate: row.coordinate,
    icon: getRouteStopIconForRole(row.role),
    label: row.name,
    mode: row.mode,
    placeId: row.placeId,
    placeSource: row.placeSource,
    placeSourceRef: row.placeSourceRef,
    role: row.role,
  }));
}

/**
 * Creates a compact timeline from committed destination rows.
 */
function createTimelineFromRows(rows: DestinationRow[], savingLabel?: string): TimelineEvent[] {
  const times = ["09:30", "10:20", "15:00", "21:30", "22:00"];

  return rows.map((row, index) => {
    const roleLabel = getDestinationRoleLabel(row);
    const category = getTimelineCategoryForRole(row.role);

    return {
      category,
      description: `경로 다시 계산 결과가 반영된 ${roleLabel}`,
      savingLabel: index === 1 ? savingLabel : undefined,
      time: times[index] ?? times[times.length - 1],
      title: `${row.name} ${roleLabel}`,
    };
  });
}

/**
 * Adds long-distance boarding/alighting events without listing every transfer.
 */
function createTimelineWithTransitMarkers(
  rows: DestinationRow[],
  transitMarkers: RouteTransitMarker[],
  savingLabel?: string,
): TimelineEvent[] {
  const baseTimeline = createTimelineFromRows(rows, savingLabel);

  if (transitMarkers.length === 0) {
    return baseTimeline;
  }

  const markerEvents = transitMarkers.map((marker, index): TimelineEvent => ({
    category: "transit",
    description:
      marker.role === "boarding"
        ? "장거리 대중교통 탑승 지점"
        : "장거리 대중교통 하차 지점",
    time: marker.role === "boarding" ? "10:20" : "15:00",
    title: marker.label,
    savingLabel: index === 0 ? savingLabel : undefined,
  }));

  const firstEvent = baseTimeline[0];

  return firstEvent ? [firstEvent, ...markerEvents, ...baseTimeline.slice(1)] : markerEvents;
}

/**
 * Converts ODsay WGS84 coordinate fields into the map coordinate shape.
 */
function toOdsayMapCoordinate(coordinate?: OdsayCoordinate): MapCoordinate | null {
  const lat = coordinate?.y;
  const lng = coordinate?.x;

  if (typeof lat !== "number" || typeof lng !== "number") {
    return null;
  }

  return { lat, lng };
}

/**
 * Avoids duplicate adjacent coordinates when combining provider path chunks.
 */
function appendMapCoordinate(path: MapCoordinate[], coordinate: MapCoordinate) {
  const previous = path[path.length - 1];

  // Provider responses often repeat the boundary coordinate of adjacent chunks.
  if (previous && previous.lat === coordinate.lat && previous.lng === coordinate.lng) {
    return;
  }

  path.push(coordinate);
}

/**
 * Computes a rough straight-line distance between two coordinates in meters.
 */
function getStraightLineDistanceMeters(origin: MapCoordinate, destination: MapCoordinate) {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (degree: number) => (degree * Math.PI) / 180;
  const originLat = toRadians(origin.lat);
  const destinationLat = toRadians(destination.lat);
  const latDelta = toRadians(destination.lat - origin.lat);
  const lngDelta = toRadians(destination.lng - origin.lng);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(originLat) * Math.cos(destinationLat) * Math.sin(lngDelta / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

/**
 * Computes the drawable provider path length in meters.
 */
function getPathDistanceMeters(path: MapCoordinate[]) {
  return path.slice(1).reduce(
    (sum, coordinate, index) =>
      sum + getStraightLineDistanceMeters(path[index], coordinate),
    0,
  );
}

/**
 * Rejects impossible long-distance transit responses before they update the UI.
 */
function assertPlausibleTransitSegment(
  origin: DestinationRow,
  destination: DestinationRow,
  segment: {
    distanceMeters: number;
    paths: MapCoordinate[][];
  },
) {
  if (origin.mode !== "transit" || !origin.coordinate || !destination.coordinate) {
    return;
  }

  const straightDistanceMeters = getStraightLineDistanceMeters(
    origin.coordinate,
    destination.coordinate,
  );

  if (straightDistanceMeters < longDistanceTransitThresholdMeters) {
    return;
  }

  // Long-distance transit without drawable geometry is handled as marker-only partial route.
  if (!segment.paths.some((path) => path.length > 2)) {
    return;
  }

  const drawableDistanceMeters = segment.paths.reduce(
    (sum, path) => sum + getPathDistanceMeters(path),
    0,
  );
  const effectiveDistanceMeters = Math.max(segment.distanceMeters, drawableDistanceMeters);

  // Some providers underreport long-distance train distance but still return a valid shape.
  if (effectiveDistanceMeters < straightDistanceMeters * minimumProviderDistanceRatio) {
    throw new Error(
      "경로 제공자 응답이 실제 이동거리보다 짧습니다. 장거리 대중교통 경유지는 현재 별도 검증이 필요합니다.",
    );
  }
}

/**
 * Normalizes ODsay error payloads because some endpoints return an object, not an array.
 */
function getOdsayErrors(data: OdsayResponseWithError) {
  if (!data.error) {
    return [];
  }

  return Array.isArray(data.error) ? data.error : [data.error];
}

/**
 * Checks whether an ODsay response contains an API-level error.
 */
function hasOdsayError(data: OdsayResponseWithError) {
  return getOdsayErrors(data).length > 0;
}

/**
 * Reads the first ODsay error message without exposing the API key.
 */
function getOdsayErrorMessage(data: OdsayResponseWithError) {
  const error = getOdsayErrors(data)[0];

  if (error?.code === "429") {
    return "ODsay 호출 제한(429)으로 경로 계산에 실패했습니다. 잠시 후 다시 시도해 주세요.";
  }

  return error?.message ?? "ODsay 경로 요청에 실패했습니다.";
}

/**
 * Logs ODsay provider failures with redacted request context for local debugging.
 */
function warnOdsayApiError(path: string, params: Record<string, string>, data: OdsayResponseWithError) {
  const error = getOdsayErrors(data)[0];

  if (!error) {
    return;
  }

  // Keep the API key out of logs while preserving route parameters needed for reproduction.
  console.warn("PlanME ODsay API error", {
    code: error.code,
    endpoint: path,
    message: error.message,
    params,
  });
}

/**
 * Checks whether an ODsay terminal payload is a single train terminal.
 */
function isOdsayTrainTerminal(value: OdsayTrainTerminalResponse["result"]): value is OdsayTrainTerminal {
  return Boolean(value && "stationID" in value);
}

/**
 * Calls ODsay from the browser origin because the current test key is URI-scoped.
 */
async function requestOdsay<T extends OdsayResponseWithError>(
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const cacheKey = createOdsayResponseCacheKey(path, params);
  const inFlightRequest = inFlightOdsayRequests.get(cacheKey);
  const cachedResponse = odsayResponseCache.get(cacheKey);

  if (cachedResponse) {
    if (cachedResponse.expiresAt > Date.now()) {
      return cachedResponse.data as T;
    }

    odsayResponseCache.delete(cacheKey);
  }

  const persistedResponse = readPersistentOdsayResponse(cacheKey);

  if (persistedResponse) {
    odsayResponseCache.set(cacheKey, persistedResponse);

    return persistedResponse.data as T;
  }

  if (inFlightRequest) {
    return (await inFlightRequest) as T;
  }

  const url = new URL(`https://api.odsay.com/v1/api/${path}`);

  Object.entries({ ...params, apiKey: odsayApiKey }).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const requestPromise = (async () => {
    await waitForOdsayRequestSlot();
    recordPlanmeBrowserUsage("odsay_request");

    const response = await fetch(url);
    const data = (await response.json()) as T;

    if (hasOdsayError(data)) {
      warnOdsayApiError(path, params, data);
      cacheOdsayRateLimitResponse(cacheKey, data);
    } else {
      cacheOdsaySuccessResponse(cacheKey, data);
    }

    return data;
  })();

  inFlightOdsayRequests.set(cacheKey, requestPromise);

  try {
    return await requestPromise;
  } finally {
    inFlightOdsayRequests.delete(cacheKey);
  }
}

/**
 * Records browser-only usage counters without blocking route calculation.
 */
function recordPlanmeBrowserUsage(event: "odsay_request") {
  void fetch("/api/planme/usage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event }),
  }).catch(() => undefined);
}

/**
 * Creates a stable ODsay cache key without including the API key.
 */
function createOdsayResponseCacheKey(path: string, params: Record<string, string>) {
  const searchParams = new URLSearchParams(
    Object.entries(params).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
  );

  return `${path}?${searchParams.toString()}`;
}

/**
 * Builds the localStorage key for a stable ODsay request cache key.
 */
function getPersistentOdsayStorageKey(cacheKey: string) {
  return `${odsayPersistentCacheStoragePrefix}${encodeURIComponent(cacheKey)}`;
}

/**
 * Reads a browser-persisted ODsay cache entry if it is still valid.
 */
function readPersistentOdsayResponse(cacheKey: string): CachedOdsayResponse | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storageKey = getPersistentOdsayStorageKey(cacheKey);

  try {
    const rawEntry = window.localStorage.getItem(storageKey);

    if (!rawEntry) {
      return null;
    }

    const entry = JSON.parse(rawEntry) as PersistedOdsayResponse;

    if (!entry.data || typeof entry.expiresAt !== "number") {
      window.localStorage.removeItem(storageKey);

      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      window.localStorage.removeItem(storageKey);

      return null;
    }

    return {
      data: entry.data,
      expiresAt: entry.expiresAt,
    };
  } catch {
    // Corrupt or quota-affected cache entries should not block route calculation.
    window.localStorage.removeItem(storageKey);

    return null;
  }
}

/**
 * Stores a successful ODsay response so refresh/reopen does not spend another provider call.
 */
function writePersistentOdsayResponse(cacheKey: string, data: OdsayResponseWithError) {
  if (typeof window === "undefined") {
    return;
  }

  const entry: CachedOdsayResponse = {
    data,
    expiresAt: Date.now() + odsayPersistentResponseCacheTtlMs,
  };

  try {
    window.localStorage.setItem(
      getPersistentOdsayStorageKey(cacheKey),
      JSON.stringify(entry),
    );
  } catch {
    // If the browser storage quota is full, keep the in-memory cache as the safe fallback.
  }
}

/**
 * Builds a stable cache key for one Naver car route segment.
 */
function createNaverDriveRouteCacheKey(origin: DestinationRow, destination: DestinationRow) {
  return `drive:${getRouteRowsSignature([origin, destination], "drive")}`;
}

/**
 * Builds the localStorage key for a Naver car route cache entry.
 */
function getPersistentNaverRouteStorageKey(cacheKey: string) {
  return `${naverRoutePersistentCacheStoragePrefix}${encodeURIComponent(cacheKey)}`;
}

/**
 * Reads a browser-persisted Naver route response if it is still valid.
 */
function readPersistentNaverRouteResponse(cacheKey: string): CachedNaverRouteResponse | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storageKey = getPersistentNaverRouteStorageKey(cacheKey);

  try {
    const rawEntry = window.localStorage.getItem(storageKey);

    if (!rawEntry) {
      return null;
    }

    const entry = JSON.parse(rawEntry) as PersistedNaverRouteResponse;

    if (!entry.data || typeof entry.expiresAt !== "number") {
      window.localStorage.removeItem(storageKey);

      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      window.localStorage.removeItem(storageKey);

      return null;
    }

    return {
      data: entry.data,
      expiresAt: entry.expiresAt,
    };
  } catch {
    // Broken browser cache should not block route calculation.
    window.localStorage.removeItem(storageKey);

    return null;
  }
}

/**
 * Stores one successful Naver car route response for repeated recalculation.
 */
function writePersistentNaverRouteResponse(cacheKey: string, data: RouteCheckApiResponse) {
  if (typeof window === "undefined") {
    return;
  }

  const entry: CachedNaverRouteResponse = {
    data,
    expiresAt: Date.now() + naverRoutePersistentResponseCacheTtlMs,
  };

  try {
    window.localStorage.setItem(
      getPersistentNaverRouteStorageKey(cacheKey),
      JSON.stringify(entry),
    );
  } catch {
    // If browser storage is full, the server-side cache still reduces provider calls.
  }
}

/**
 * Caches a successful Naver car route response in memory and browser storage.
 */
function cacheNaverRouteResponse(cacheKey: string, data: RouteCheckApiResponse) {
  const entry: CachedNaverRouteResponse = {
    data,
    expiresAt: Date.now() + naverRoutePersistentResponseCacheTtlMs,
  };

  naverRouteResponseCache.set(cacheKey, entry);
  writePersistentNaverRouteResponse(cacheKey, data);
}

/**
 * Returns a cached Naver car route response when available.
 */
function readCachedNaverRouteResponse(cacheKey: string) {
  const cachedResponse = naverRouteResponseCache.get(cacheKey);

  if (cachedResponse) {
    if (cachedResponse.expiresAt > Date.now()) {
      return cachedResponse.data;
    }

    naverRouteResponseCache.delete(cacheKey);
  }

  const persistedResponse = readPersistentNaverRouteResponse(cacheKey);

  if (!persistedResponse) {
    return null;
  }

  naverRouteResponseCache.set(cacheKey, persistedResponse);

  return persistedResponse.data;
}

/**
 * Waits until the browser-side ODsay request queue allows another provider call.
 */
async function waitForOdsayRequestSlot() {
  const previousRequest = odsayRequestQueue;
  let releaseCurrentRequest = () => {};

  odsayRequestQueue = new Promise<void>((resolve) => {
    releaseCurrentRequest = resolve;
  });

  await previousRequest;

  try {
    const elapsedMs = Date.now() - lastOdsayRequestStartedAt;

    // Space starts of ODsay requests to reduce burst-limit errors during recalculation.
    if (elapsedMs < odsayMinimumRequestIntervalMs) {
      await delay(odsayMinimumRequestIntervalMs - elapsedMs);
    }

    lastOdsayRequestStartedAt = Date.now();
  } finally {
    releaseCurrentRequest();
  }
}

/**
 * Resolves after the requested number of milliseconds.
 */
function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Caches a successful ODsay response for repeated route recalculations.
 */
function cacheOdsaySuccessResponse(cacheKey: string, data: OdsayResponseWithError) {
  odsayResponseCache.set(cacheKey, {
    data,
    expiresAt: Date.now() + odsayResponseCacheTtlMs,
  });
  writePersistentOdsayResponse(cacheKey, data);
}

/**
 * Caches ODsay 429 responses briefly to prevent repeated quota-limit calls.
 */
function cacheOdsayRateLimitResponse(cacheKey: string, data: OdsayResponseWithError) {
  const firstError = getOdsayErrors(data)[0];

  if (firstError?.code !== "429") {
    return;
  }

  // A short 429 cache prevents rapid retries while still allowing manual retry later.
  odsayResponseCache.set(cacheKey, {
    data,
    expiresAt: Date.now() + odsayRateLimitCacheTtlMs,
  });
}

/**
 * Flattens ODsay train terminal lookup responses.
 */
function getOdsayTrainTerminals(data: OdsayTrainTerminalResponse) {
  const result = data.result;

  if (!result) {
    return [];
  }

  if (Array.isArray(result)) {
    return result;
  }

  if ("station" in result && Array.isArray(result.station)) {
    return result.station;
  }

  if ("stations" in result && Array.isArray(result.stations)) {
    return result.stations;
  }

  return isOdsayTrainTerminal(result) ? [result] : [];
}

/**
 * Finds a train terminal id by name through ODsay.
 */
async function requestOdsayTrainTerminal(name: string) {
  const data = await requestOdsay<OdsayTrainTerminalResponse>("trainTerminals", {
    terminalName: name,
  });

  if (hasOdsayError(data)) {
    throw new Error(getOdsayErrorMessage(data));
  }

  const terminals = getOdsayTrainTerminals(data);

  return terminals.find((terminal) => terminal.stationName === name) ?? terminals[0];
}

/**
 * Converts a destination name into the ODsay train terminal search keyword.
 */
function getTrainTerminalName(row: DestinationRow) {
  return row.name.replace(/\s*역$/, "").trim();
}

/**
 * Checks whether a destination row represents a train station waypoint.
 */
function isTrainStationRow(row: DestinationRow) {
  return row.name.trim().endsWith("역");
}

/**
 * Converts an ODsay train terminal into an editable row shape.
 */
function createTrainTerminalRow(terminal: OdsayTrainTerminal, mode: PlanmeRowMode): DestinationRow {
  return {
    coordinate:
      typeof terminal.x === "number" && typeof terminal.y === "number"
        ? { lat: terminal.y, lng: terminal.x }
        : undefined,
    id: `odsay-terminal-${terminal.stationID ?? terminal.stationName}`,
    mode,
    name: terminal.stationName ?? "기차역",
  };
}

/**
 * Checks whether an ODsay transit chunk represents long-distance transport.
 */
function isOdsayLongDistanceTransitSubPath(subPath: OdsayTransitSubPath) {
  // ODsay returns rail, intercity bus, express bus, and air as endpoint-based chunks.
  return (
    subPath.trafficType === 4 ||
    subPath.trafficType === 5 ||
    subPath.trafficType === 6 ||
    subPath.trafficType === 7
  );
}

/**
 * Maps ODsay long-distance traffic codes into marker categories.
 */
function getTransitMarkerMode(trafficType?: number): RouteTransitMarker["mode"] {
  if (trafficType === 1) {
    return "subway";
  }

  if (trafficType === 4) {
    return "train";
  }

  if (trafficType === 5 || trafficType === 6) {
    return "bus";
  }

  return "transit";
}

/**
 * Extracts only the first boarding and final alighting point for long-distance transit.
 */
function createLongDistanceTransitMarkers(
  subPaths: OdsayTransitSubPath[],
  segmentIndex: number,
): RouteTransitMarker[] {
  const firstSubPath = subPaths.find(
    (subPath) => typeof subPath.startX === "number" && typeof subPath.startY === "number",
  );
  const lastSubPath = [...subPaths]
    .reverse()
    .find((subPath) => typeof subPath.endX === "number" && typeof subPath.endY === "number");
  const markers: RouteTransitMarker[] = [];

  if (typeof firstSubPath?.startX === "number" && typeof firstSubPath.startY === "number") {
    markers.push({
      coordinate: { lat: firstSubPath.startY, lng: firstSubPath.startX },
      id: `transit-${segmentIndex}-boarding`,
      label: `탑승: ${firstSubPath.startName?.trim() || "대중교통 탑승"}`,
      mode: getTransitMarkerMode(firstSubPath.trafficType),
      role: "boarding",
      segmentIndex,
    });
  }

  if (typeof lastSubPath?.endX === "number" && typeof lastSubPath.endY === "number") {
    markers.push({
      coordinate: { lat: lastSubPath.endY, lng: lastSubPath.endX },
      id: `transit-${segmentIndex}-alighting`,
      label: `하차: ${lastSubPath.endName?.trim() || "대중교통 하차"}`,
      mode: getTransitMarkerMode(lastSubPath.trafficType),
      role: "alighting",
      segmentIndex,
    });
  }

  return markers;
}

/**
 * Merges multiple drawable provider segments without inventing missing links.
 */
function combineOdsaySegments(segments: ProviderRouteSegment[]): ProviderRouteSegment {
  const path: MapCoordinate[] = [];
  const transitMarkers = segments.flatMap((segment) => segment.transitMarkers ?? []);
  const drawablePaths = segments
    .flatMap((segment) => segment.paths)
    .filter((segment) => segment.length > 2);

  for (const segment of segments) {
    for (const coordinate of segment.path) {
      appendMapCoordinate(path, coordinate);
    }
  }

  return {
    distanceMeters: segments.reduce((sum, segment) => sum + segment.distanceMeters, 0),
    durationSeconds: segments.reduce((sum, segment) => sum + segment.durationSeconds, 0),
    geometryStatus: segments.some((segment) => segment.geometryStatus === "partial")
      ? "partial"
      : "complete",
    path,
    paths: drawablePaths,
    transitMarkers,
  };
}

/**
 * Returns a drawable ODsay walking route for a local segment.
 */
async function requestOdsayWalkRoute(
  origin: ProviderRoutePoint,
  destination: ProviderRoutePoint,
): Promise<ProviderRouteSegment> {
  if (!origin.coordinate || !destination.coordinate) {
    throw new Error("ODsay 도보 경로 계산에는 좌표가 필요합니다.");
  }

  const data = await requestOdsay<OdsayWalkRouteResponse>("searchWalkPathV2", {
    loc: [
      origin.coordinate.lng,
      origin.coordinate.lat,
      destination.coordinate.lng,
      destination.coordinate.lat,
    ].join(","),
    opt: "reco",
  });

  if (hasOdsayError(data)) {
    throw new Error(getOdsayErrorMessage(data));
  }

  const route = data.result?.path?.[0]?.recommend;
  const path: MapCoordinate[] = [];

  for (const routeChunk of route?.routes ?? []) {
    for (const coordinate of routeChunk.coordinate ?? []) {
      const mapCoordinate = toOdsayMapCoordinate(coordinate);

      if (mapCoordinate) {
        appendMapCoordinate(path, mapCoordinate);
      }
    }
  }

  return {
    distanceMeters: route?.summary?.distance ?? 0,
    durationSeconds: route?.summary?.duration ?? 0,
    path,
    paths: path.length > 2 ? [path] : [],
  };
}

/**
 * Returns ODsay route graphic coordinates for bus/subway path chunks.
 */
async function requestOdsayLanePaths(mapObj: string) {
  const data = await requestOdsay<OdsayLoadLaneResponse>("loadLane", {
    mapObject: `0:0@${mapObj}`,
  });

  if (hasOdsayError(data)) {
    throw new Error(getOdsayErrorMessage(data));
  }

  return (
    data.result?.lane
      ?.flatMap((lane) => lane.section ?? [])
      .map((section) =>
        section.graphPos
          ?.map(toOdsayMapCoordinate)
          .filter((coordinate): coordinate is MapCoordinate => Boolean(coordinate)) ?? [],
      )
      .filter((path) => path.length > 2) ?? []
  );
}

/**
 * Safely requests a short access walking segment when ODsay has exact endpoints.
 */
async function requestOptionalOdsayWalkRoute(
  origin: ProviderRoutePoint,
  destination: ProviderRoutePoint,
): Promise<ProviderRouteSegment | null> {
  try {
    const segment = await requestOdsayWalkRoute(origin, destination);

    return segment.paths.length ? segment : null;
  } catch {
    return null;
  }
}

/**
 * Returns a local public-transit route using ODsay path search and lane graphics.
 */
async function requestOdsayLocalTransitRoute(
  origin: DestinationRow,
  destination: DestinationRow,
): Promise<ProviderRouteSegment> {
  if (!origin.coordinate || !destination.coordinate) {
    throw new Error("ODsay 대중교통 경로 계산에는 좌표가 필요합니다.");
  }

  const data = await requestOdsay<OdsayTransitPathResponse>("searchPubTransPathT", {
    EX: String(destination.coordinate.lng),
    EY: String(destination.coordinate.lat),
    SearchType: "0",
    SX: String(origin.coordinate.lng),
    SY: String(origin.coordinate.lat),
  });

  if (hasOdsayError(data)) {
    throw new Error(getOdsayErrorMessage(data));
  }

  const firstPath = data.result?.path?.[0];
  const transitSubPaths =
    firstPath?.subPath?.filter(
      (subPath) => subPath.trafficType === 1 || subPath.trafficType === 2,
    ) ?? [];
  const longDistanceSubPaths =
    firstPath?.subPath?.filter(isOdsayLongDistanceTransitSubPath) ?? [];
  const firstTransit = transitSubPaths[0] ?? longDistanceSubPaths[0];
  const lastTransit =
    transitSubPaths[transitSubPaths.length - 1] ??
    longDistanceSubPaths[longDistanceSubPaths.length - 1];
  const segments: ProviderRouteSegment[] = [];

  if (firstTransit?.startX && firstTransit.startY) {
    const accessWalk = await requestOptionalOdsayWalkRoute(origin, {
      coordinate: { lat: firstTransit.startY, lng: firstTransit.startX },
      id: `${origin.id}-access-walk`,
      name: "대중교통 승차 지점",
    });

    if (accessWalk) {
      segments.push(accessWalk);
    }
  }

  if (firstPath?.info?.mapObj) {
    const lanePaths = await requestOdsayLanePaths(firstPath.info.mapObj);
    const lanePath: MapCoordinate[] = [];

    lanePaths.forEach((path) => path.forEach((coordinate) => appendMapCoordinate(lanePath, coordinate)));
    segments.push({
      distanceMeters: firstPath.info.totalDistance ?? 0,
      durationSeconds: (firstPath.info.totalTime ?? 0) * 60,
      geometryStatus: lanePaths.length > 0 ? "complete" : "partial",
      path: lanePath,
      paths: lanePaths,
    });
  }

  if (longDistanceSubPaths.length > 0) {
    const longDistanceMeters = longDistanceSubPaths.reduce(
      (sum, subPath) => sum + (subPath.distance ?? 0),
      0,
    );
    const longDistanceSeconds =
      longDistanceSubPaths.reduce((sum, subPath) => sum + (subPath.sectionTime ?? 0), 0) *
      60;

    segments.push({
      distanceMeters: longDistanceMeters || (firstPath?.info?.totalDistance ?? 0),
      durationSeconds: longDistanceSeconds || (firstPath?.info?.totalTime ?? 0) * 60,
      geometryStatus: "partial",
      // ODsay long-distance bus/train chunks often expose only terminal boundary points.
      path: [],
      paths: [],
      transitMarkers: createLongDistanceTransitMarkers(longDistanceSubPaths, segments.length),
    });
  }

  if (lastTransit?.endX && lastTransit.endY) {
    const exitWalk = await requestOptionalOdsayWalkRoute(
      {
        coordinate: { lat: lastTransit.endY, lng: lastTransit.endX },
        id: `${destination.id}-exit-walk`,
        name: "대중교통 하차 지점",
      },
      destination,
    );

    if (exitWalk) {
      segments.push(exitWalk);
    }
  }

  return combineOdsaySegments(segments);
}

/**
 * Returns the Seoul-to-Busan KTX shape when public transit APIs expose train vertices.
 */
async function requestOdsayTrainRouteBetween(
  seoulStation: OdsayTrainTerminal,
  busanStation: OdsayTrainTerminal,
): Promise<ProviderRouteSegment> {
  if (!seoulStation.stationID || !busanStation.stationID) {
    throw new Error("ODsay 기차역 코드를 찾지 못했습니다.");
  }

  const data = await requestOdsay<OdsayTrainPathResponse>("searchTrainPath", {
    departureHour: "9",
    EID: String(busanStation.stationID),
    SID: String(seoulStation.stationID),
    weekDay: "1",
  });

  if (hasOdsayError(data)) {
    throw new Error(getOdsayErrorMessage(data));
  }

  const firstPath = data.result?.path?.[0];
  const trainSubPaths = firstPath?.subPath ?? [];
  const path: MapCoordinate[] = [];

  for (const subPath of trainSubPaths) {
    for (const coordinate of subPath.vertices ?? []) {
      const mapCoordinate = toOdsayMapCoordinate(coordinate);

      // ODsay can place train line vertices in later subPath chunks.
      if (mapCoordinate) {
        appendMapCoordinate(path, mapCoordinate);
      }
    }
  }

  const subPathDistance = trainSubPaths.reduce(
    (sum, subPath) => sum + (subPath.distance ?? 0),
    0,
  );
  const subPathDurationMinutes = trainSubPaths.reduce(
    (sum, subPath) => sum + (subPath.sectionTime ?? 0),
    0,
  );

  return {
    distanceMeters: subPathDistance || (firstPath?.info?.trainTravelDistance ?? 0),
    durationSeconds:
      (subPathDurationMinutes || (firstPath?.info?.trainTravelTime ?? 0)) * 60,
    path,
    paths: path.length > 2 ? [path] : [],
  };
}

/**
 * Composes the demo's Incheon Airport to Busan route without dropping access legs.
 */
async function requestOdsayBusanKtxRoute(
  origin: DestinationRow,
  destination: DestinationRow,
): Promise<ProviderRouteSegment> {
  const [seoulStation, busanStation] = await Promise.all([
    requestOdsayTrainTerminal("서울"),
    requestOdsayTrainTerminal("부산"),
  ]);
  const seoulRow = createTrainTerminalRow(seoulStation, "transit");
  const busanRow = createTrainTerminalRow(busanStation, "transit");

  const [accessRoute, trainRoute, arrivalRoute] = await Promise.all([
    requestOdsayLocalTransitRoute(origin, seoulRow),
    requestOdsayTrainRouteBetween(seoulStation, busanStation),
    requestOdsayLocalTransitRoute(busanRow, destination),
  ]);

  return combineOdsaySegments([accessRoute, trainRoute, arrivalRoute]);
}

/**
 * Composes an airport-to-train-station route through Seoul Station.
 */
async function requestOdsayAirportToTrainStationRoute(
  origin: DestinationRow,
  destination: DestinationRow,
): Promise<ProviderRouteSegment> {
  const [seoulStation, destinationStation] = await Promise.all([
    requestOdsayTrainTerminal("서울"),
    requestOdsayTrainTerminal(getTrainTerminalName(destination)),
  ]);
  const seoulRow = createTrainTerminalRow(seoulStation, "transit");

  const [accessRoute, trainRoute] = await Promise.all([
    requestOdsayLocalTransitRoute(origin, seoulRow),
    requestOdsayTrainRouteBetween(seoulStation, destinationStation),
  ]);

  return combineOdsaySegments([accessRoute, trainRoute]);
}

/**
 * Composes a train-station-to-Busan-destination route through Busan Station.
 */
async function requestOdsayTrainStationToBusanRoute(
  origin: DestinationRow,
  destination: DestinationRow,
): Promise<ProviderRouteSegment> {
  const [originStation, busanStation] = await Promise.all([
    requestOdsayTrainTerminal(getTrainTerminalName(origin)),
    requestOdsayTrainTerminal("부산"),
  ]);
  const busanRow = createTrainTerminalRow(busanStation, "transit");

  const [trainRoute, arrivalRoute] = await Promise.all([
    requestOdsayTrainRouteBetween(originStation, busanStation),
    requestOdsayLocalTransitRoute(busanRow, destination),
  ]);

  return combineOdsaySegments([trainRoute, arrivalRoute]);
}

/**
 * Checks whether the current segment is the demo's long-distance Busan KTX leg.
 */
function isBusanKtxSegment(origin: DestinationRow, destination: DestinationRow) {
  return (
    origin.mode === "transit" &&
    origin.name.includes("인천") &&
    isBusanDestinationRow(destination)
  );
}

/**
 * Checks whether the current segment is an airport-to-train-station long-distance leg.
 */
function isAirportToTrainStationSegment(origin: DestinationRow, destination: DestinationRow) {
  return origin.mode === "transit" && origin.name.includes("인천") && isTrainStationRow(destination);
}

/**
 * Checks whether the current segment is a train-station-to-Busan long-distance leg.
 */
function isTrainStationToBusanSegment(origin: DestinationRow, destination: DestinationRow) {
  return (
    origin.mode === "transit" &&
    isTrainStationRow(origin) &&
    isBusanDestinationRow(destination)
  );
}

/**
 * Limits the Busan KTX shortcut to Busan-specific rows instead of generic hotel/event names.
 */
function isBusanDestinationRow(row: DestinationRow) {
  return (
    row.name.includes("부산") ||
    row.name.includes("서면") ||
    row.name.includes("해운대")
  );
}

/**
 * Requests one Naver Directions segment for car routing inside a mixed provider route.
 */
async function requestNaverDriveSegmentRoute(
  origin: DestinationRow,
  destination: DestinationRow,
): Promise<ProviderRouteSegment> {
  const cacheKey = createNaverDriveRouteCacheKey(origin, destination);
  const cachedPayload = readCachedNaverRouteResponse(cacheKey);

  if (cachedPayload) {
    return createNaverDriveSegmentResult(cachedPayload);
  }

  const response = await fetch("/api/naver/directions/routes", {
    body: JSON.stringify({ stops: [origin, destination] }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const payload = (await response.json()) as RouteCheckApiResponse;

  if (response.ok && payload.ok) {
    cacheNaverRouteResponse(cacheKey, payload);
  }

  return createNaverDriveSegmentResult(payload, response.ok);
}

/**
 * Converts a Naver route API payload into one drawable route segment.
 */
function createNaverDriveSegmentResult(
  payload: RouteCheckApiResponse,
  responseOk = true,
): ProviderRouteSegment {
  const segment = payload.segments?.[0];

  if (!responseOk || !payload.ok || !segment) {
    throw new Error(payload.message ?? "Naver Directions 자동차 경로 계산에 실패했습니다.");
  }

  // Keep only provider-returned path chunks so missing coordinates are never joined manually.
  return {
    distanceMeters: payload.totalDistanceMeters ?? segment.distanceMeters,
    durationSeconds: payload.totalDurationSeconds ?? segment.durationSeconds,
    path: payload.path ?? segment.path,
    paths: getDrawableRouteSegments(payload),
  };
}

/**
 * Computes a browser-side ODsay route for the current local PoC key.
 */
async function computeOdsayRoute(rows: DestinationRow[]): Promise<RouteCheckApiResponse | null> {
  if (!odsayApiKey || rows.length < 2 || rows.some((row) => !row.coordinate)) {
    return null;
  }

  const path: MapCoordinate[] = [];
  const segments: NonNullable<RouteCheckApiResponse["segments"]> = [];
  const transitMarkers: RouteTransitMarker[] = [];
  let totalDistanceMeters = 0;
  let totalDurationSeconds = 0;
  let hasPartialGeometry = false;

  for (let index = 0; index < rows.length - 1; index += 1) {
    const origin = rows[index];
    const destination = rows[index + 1];
    const segmentMode = origin.mode;

    if (!segmentMode) {
      return null;
    }

    const segment = isAirportToTrainStationSegment(origin, destination)
      ? await requestOdsayAirportToTrainStationRoute(origin, destination)
      : isTrainStationToBusanSegment(origin, destination)
        ? await requestOdsayTrainStationToBusanRoute(origin, destination)
        : isBusanKtxSegment(origin, destination)
          ? await requestOdsayBusanKtxRoute(origin, destination)
          : segmentMode === "transit"
            ? await requestOdsayLocalTransitRoute(origin, destination)
            : segmentMode === "drive"
              ? await requestNaverDriveSegmentRoute(origin, destination)
              : null;

    if (!segment) {
      return null;
    }

    assertPlausibleTransitSegment(origin, destination, segment);

    for (const coordinate of segment.path) {
      appendMapCoordinate(path, coordinate);
    }

    totalDistanceMeters += segment.distanceMeters;
    totalDurationSeconds += segment.durationSeconds;
    transitMarkers.push(...(segment.transitMarkers ?? []));
    hasPartialGeometry = hasPartialGeometry || segment.geometryStatus === "partial";
    segments.push({
      distanceMeters: segment.distanceMeters,
      durationSeconds: segment.durationSeconds,
      geometryStatus: segment.geometryStatus,
      mode: segmentMode,
      path: segment.path,
      paths: segment.paths,
      transitMarkers: segment.transitMarkers,
    });
  }

  if (segments.every((segment) => !segment.paths?.length) && transitMarkers.length === 0) {
    return null;
  }

  return {
    geometryStatus:
      hasPartialGeometry || segments.some((segment) => !segment.paths?.length)
        ? "partial"
        : "complete",
    ok: true,
    path,
    segments,
    transitMarkers,
    totalDistanceMeters,
    totalDurationLabel: formatDurationFromSeconds(totalDurationSeconds),
    totalDurationSeconds,
    warnings:
      hasPartialGeometry || segments.some((segment) => !segment.paths?.length)
        ? ["장거리 대중교통 본선 좌표는 제공되지 않아 탑승/하차 지점만 표시합니다."]
        : undefined,
  };
}

/**
 * Formats provider duration seconds into the shared route label.
 */
function formatDurationFromSeconds(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));

  return formatDurationFromMinutes(minutes);
}

/**
 * Formats duration minutes into the shared Korean duration label.
 */
function formatDurationFromMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours <= 0) {
    return `약 ${remainingMinutes}분`;
  }

  return remainingMinutes === 0 ? `약 ${hours}시간` : `약 ${hours}시간 ${remainingMinutes}분`;
}

/**
 * Formats the saved time label from two route durations.
 */
function formatSavingLabelFromMinutes(standardMinutes: number, carrymeMinutes: number) {
  const savedMinutes = standardMinutes - carrymeMinutes;

  return savedMinutes > 0
    ? `${formatDurationFromMinutes(savedMinutes)} 절약`
    : "시간 절약 없음 · 짐 없이 바로 이동";
}

/**
 * Checks whether the route includes a public-transit segment.
 */
function routeUsesTransit(transportMode: PlanmeTransportMode) {
  return transportMode === "transit";
}

/**
 * Creates a stable route signature so identical comparison routes can share one provider call.
 */
function getRouteRowsSignature(
  rows: DestinationRow[],
  transportMode: PlanmeTransportMode,
) {
  return JSON.stringify(
    {
      transportMode,
      stops: rows.map((row) => ({
        lat: row.coordinate?.lat,
        lng: row.coordinate?.lng,
        name: row.name,
        placeSourceRef: row.placeSourceRef,
      })),
    },
  );
}

/**
 * Lists destination names that cannot be sent to route providers yet.
 */
function getRowsWithoutCoordinates(rows: DestinationRow[]) {
  return rows.filter((row) => !row.coordinate).map((row) => row.name);
}

/**
 * Lists rows that cannot be trusted for provider calls because route semantics are missing.
 */
function getRowsWithMissingRouteContract(rows: DestinationRow[]) {
  return rows
    .filter((row) => !row.role || !row.placeSourceRef)
    .map((row) => row.name);
}

/**
 * Uses ODsay for transit routes and Naver Directions for car-only fallback.
 */
async function requestRouteCheck(
  rows: DestinationRow[],
  transportMode: PlanmeTransportMode,
): Promise<RouteCheckResult> {
  const providerRows = rows.map((row) => ({ ...row, mode: transportMode }));
  const usesTransit = routeUsesTransit(transportMode);
  let odsayErrorMessage = "ODsay 대중교통 경로 요청에 실패했습니다.";
  const missingContractRows = getRowsWithMissingRouteContract(rows);

  if (missingContractRows.length > 0) {
    const missingNames = missingContractRows.join(", ");

    return {
      payload: {
        blockingReason: "missingRoleOrMode",
        message: `역할 또는 이동수단 확인이 필요한 행선지가 있습니다: ${missingNames}.`,
        ok: false,
      },
      responseOk: false,
    };
  }

  const missingCoordinateRows = getRowsWithoutCoordinates(rows);

  if (missingCoordinateRows.length > 0) {
    const missingNames = missingCoordinateRows.join(", ");

    return {
      payload: {
        blockingReason: "missingCoordinate",
        message: `좌표가 없는 행선지가 있습니다: ${missingNames}. 검색 결과에서 장소를 선택해 주세요.`,
        ok: false,
      },
      responseOk: false,
    };
  }

  try {
    const odsayPayload = await computeOdsayRoute(providerRows);

    if (odsayPayload?.ok) {
      return { payload: odsayPayload, responseOk: true };
    }
  } catch (error) {
    odsayErrorMessage = error instanceof Error ? error.message : odsayErrorMessage;
  }

  if (usesTransit) {
    return {
      payload: {
        message: odsayErrorMessage,
        ok: false,
      },
      responseOk: false,
    };
  }

  const response = await fetch("/api/naver/directions/routes", {
    body: JSON.stringify({ stops: providerRows }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const payload = (await response.json()) as RouteCheckApiResponse;

  return { payload, responseOk: response.ok };
}

/**
 * Converts a successful route API payload into committed display state.
 */
function createComputedRouteResult(
  rows: DestinationRow[],
  payload: RouteCheckApiResponse,
  savingLabel?: string,
): ComputedRouteResult | null {
  const segments = getDrawableRouteSegments(payload);
  const transitMarkers = payload.transitMarkers ?? [];

  if ((!payload.path?.length || segments.length === 0) && transitMarkers.length === 0) {
    return null;
  }

  const durationMinutes =
    typeof payload.totalDurationSeconds === "number"
      ? Math.max(1, Math.round(payload.totalDurationSeconds / 60))
      : undefined;

  return {
    durationLabel: payload.totalDurationLabel,
    durationMinutes,
    geometryStatus: payload.geometryStatus ?? (segments.length > 0 ? "complete" : "partial"),
    path: payload.path ?? [],
    routeText: rows.map((row) => row.name).join(" → "),
    segments,
    stops: createRouteStopsFromRows(rows),
    timeline: createTimelineWithTransitMarkers(rows, transitMarkers, savingLabel),
    transitMarkers,
  };
}

/**
 * Applies a computed provider path to an existing route plan.
 */
function applyComputedRoute(route: RoutePlan, computedRoute?: ComputedRouteState[RoutePlanId]) {
  if (!computedRoute) {
    return route;
  }

  return {
    ...route,
    durationLabel: computedRoute.durationLabel ?? route.durationLabel,
    durationMinutes: computedRoute.durationMinutes ?? route.durationMinutes,
    geoPath: computedRoute.path.length > 2 ? computedRoute.path : undefined,
    geoSegments: computedRoute.segments.length > 0 ? computedRoute.segments : undefined,
    routeText: computedRoute.routeText,
    stops: computedRoute.stops,
    transitMarkers: computedRoute.transitMarkers,
  };
}

/**
 * Suppresses stale or invented geometry when one provider route is unavailable.
 */
function createUnavailableComputedRoute(rows: DestinationRow[]): ComputedRouteResult {
  return {
    path: [],
    routeText: rows.map((row) => row.name).join(" → "),
    segments: [],
    stops: createRouteStopsFromRows(rows),
    timeline: createTimelineFromRows(rows),
    transitMarkers: [],
  };
}

/**
 * Extracts the visible origin and destination from the current route.
 */
function getRouteEndpointLabels(route: RoutePlan) {
  const originLabel = route.stops[0]?.label ?? "출발지";
  const destinationLabel = route.stops[route.stops.length - 1]?.label ?? "도착지";

  return { destinationLabel, originLabel };
}

/**
 * Builds header copy from the committed route after manual recalculation.
 */
function createRecalculatedHeaderCopy(route: RoutePlan): DisplayHeaderCopy {
  const { destinationLabel, originLabel } = getRouteEndpointLabels(route);

  return {
    summary: `${originLabel}에서 ${destinationLabel}(으)로 이동하는 CarryME 동선을 확인하세요.`,
    title: `${originLabel} → ${destinationLabel} 추천 일정`,
  };
}

/**
 * Removes the brand prefix from itinerary page headings.
 */
function normalizeDisplayTitle(title: string) {
  return title.replace(/^PlanME\s+/i, "").trim();
}

/**
 * Keeps route comparison copy product-facing even for already-stored generated itineraries.
 */
function normalizeRouteDescription(description: string) {
  const normalizedDescription = description
    .replace(/^ChatGPT\s*초안을\s*기준으로\s*한\s*/i, "")
    .trim();

  return normalizedDescription === "일반 이동 흐름"
    ? "짐을 직접 들고 이동하는 일반 동선"
    : normalizedDescription;
}

/**
 * Builds route-independent benefit copy so edited routes never leak demo city names.
 */
function createGenericBenefits(): BenefitItem[] {
  return [
    {
      description: "수하물은 안전하게 보관하고 목적지까지 배송됩니다.",
      icon: "shield",
      title: "안전한 짐 배송",
    },
    {
      description: "수하물 보관소를 직접 경유하지 않아 이동 시간을 줄일 수 있습니다.",
      icon: "time",
      title: "시간 절약",
    },
    {
      description: "짐 없이 일정과 주변 여행을 편하게 즐길 수 있습니다.",
      icon: "luggage",
      title: "가벼운 여행",
    },
    {
      description: "수거부터 도착까지 진행 상태를 알림으로 확인할 수 있습니다.",
      icon: "phone",
      title: "실시간 알림",
    },
  ];
}

/**
 * Returns route chunks that can be drawn without connecting missing coordinates.
 */
function getDrawableRouteSegments(payload: RouteCheckApiResponse) {
  return (
    payload.segments
      ?.flatMap((segment) => segment.paths ?? [])
      // Two-point paths are endpoint-only data, not a drawable route shape.
      .filter((path) => path.length > 2) ?? []
  );
}

/**
 * Returns the display label supplied by AI, falling back only for legacy preview display.
 */
function getDestinationRoleLabel(row: DestinationRow) {
  return row.role ?? row.caption ?? "확인 필요";
}

/**
 * Maps a stop role to the existing map icon vocabulary without using place-name keywords.
 */
function getRouteStopIconForRole(role: PlanmeStopRole | undefined): RouteStop["icon"] {
  if (role === "숙소") {
    return "hotel";
  }

  if (role === "출발지" || role === "복귀지") {
    return "station";
  }

  return "attraction";
}

/**
 * Maps a stop role to timeline categories without inferring meaning from place names.
 */
function getTimelineCategoryForRole(role: PlanmeStopRole | undefined): TimelineEvent["category"] {
  if (role === "숙소") {
    return "hotel";
  }

  if (role === "출발지") {
    return "arrival";
  }

  if (role === "복귀지") {
    return "transit";
  }

  return "event";
}

/** Hides non-final provider values while retaining AI places and map markers. */
function createPendingRoute(route: RoutePlan, durationLabel: string): RoutePlan {
  return {
    ...route,
    durationLabel,
    geoPath: undefined,
    geoSegments: undefined,
    transitMarkers: undefined,
  };
}

/**
 * Renders the PlanME itinerary detail surface shown after the ChatGPT handoff.
 */
export function ItineraryDashboard({
  itinerary,
  compact,
  editingEnabled = true,
  finalizationToken,
  routeFinalized = false,
  routeRevision = 0,
}: ItineraryDashboardProps) {
  const theme = useTheme();
  const { mode } = usePlanmeColorMode();
  const [selectedDay, setSelectedDay] = useState(1);
  const [editableDays, setEditableDays] = useState<EditableDayPlan[]>(() =>
    createEditableDays(itinerary.days),
  );
  const [activeView, setActiveView] = useState<"compare" | "map">("compare");
  const [visibleRoutes, setVisibleRoutes] = useState<Record<RoutePlanId, boolean>>({
    standard: true,
    carryme: true,
  });
  const [computedRoutes, setComputedRoutes] = useState<ComputedRouteState>({});
  const [transportMode, setTransportMode] = useState<PlanmeTransportMode>(
    itinerary.transportMode,
  );
  const [routesFinalized, setRoutesFinalized] = useState(routeFinalized);
  const [activeFinalizationToken, setActiveFinalizationToken] = useState(finalizationToken);
  const [activeRouteRevision, setActiveRouteRevision] = useState(routeRevision);
  const [finalizationStatus, setFinalizationStatus] = useState<AsyncStatus>(
    routeFinalized ? "success" : finalizationToken ? "loading" : "idle",
  );
  const [finalizationMessage, setFinalizationMessage] = useState<string | null>(null);

  const isDark = mode === "dark";
  const selectedDayPlan = useMemo(
    () => editableDays.find((day) => day.day === selectedDay) ?? editableDays[0],
    [editableDays, selectedDay],
  );
  const standardRoute = useMemo(
    () => applyComputedRoute(selectedDayPlan.standard, computedRoutes.standard),
    [computedRoutes.standard, selectedDayPlan.standard],
  );
  const carrymeRoute = useMemo(
    () => applyComputedRoute(selectedDayPlan.carryme, computedRoutes.carryme),
    [computedRoutes.carryme, selectedDayPlan.carryme],
  );
  const hasComputedRoute = Boolean(
    computedRoutes.standard?.segments?.length || computedRoutes.carryme?.segments?.length,
  );
  const displayTitle = useMemo(
    () =>
      hasComputedRoute
        ? createRecalculatedHeaderCopy(carrymeRoute).title
        : normalizeDisplayTitle(itinerary.title),
    [carrymeRoute, hasComputedRoute, itinerary.title],
  );
  const displayBenefits = useMemo(() => createGenericBenefits(), []);
  const totalDurationLabel = `${standardRoute.durationLabel} → ${carrymeRoute.durationLabel}`;
  const savingLabel = formatSavingLabelFromMinutes(
    standardRoute.durationMinutes,
    carrymeRoute.durationMinutes,
  );
  const shouldHideProviderResult = Boolean(activeFinalizationToken) && !routesFinalized;
  const hiddenDurationLabel = finalizationStatus === "error" ? "계산 실패" : "계산 중";
  const displayStandardRoute = shouldHideProviderResult
    ? createPendingRoute(standardRoute, hiddenDurationLabel)
    : standardRoute;
  const displayCarrymeRoute = shouldHideProviderResult
    ? createPendingRoute(carrymeRoute, hiddenDurationLabel)
    : carrymeRoute;
  const displaySavingLabel = shouldHideProviderResult ? hiddenDurationLabel : savingLabel;

  useEffect(() => {
    if (routesFinalized || !activeFinalizationToken) {
      return;
    }

    let cancelled = false;

    async function finalizeStoredItinerary() {
      try {
        const response = await fetch(
          `/api/gpt/itineraries/${encodeURIComponent(itinerary.id)}/routes/finalize`,
          {
            body: JSON.stringify({
              baseRevision: activeRouteRevision,
              token: activeFinalizationToken,
            }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          },
        );
        const payload = (await response.json()) as FinalizationApiResponse;

        if (!response.ok || payload.status !== "ready" || !payload.itinerary) {
          throw new Error(payload.message ?? "일정을 완성하지 못했습니다. 다시 요청해주세요.");
        }

        if (cancelled) {
          return;
        }

        // Replace every day only after the server has atomically finalized the entire itinerary.
        setEditableDays(createEditableDays(payload.itinerary.days));
        setTransportMode(payload.itinerary.transportMode);
        setActiveRouteRevision(payload.revision ?? activeRouteRevision + 1);
        setActiveFinalizationToken(payload.token);
        setComputedRoutes({});
        setRoutesFinalized(true);
        setFinalizationStatus("success");
        setFinalizationMessage(null);
      } catch (error) {
        if (!cancelled) {
          setFinalizationStatus("error");
          setFinalizationMessage(
            error instanceof Error
              ? error.message
              : "일정을 완성하지 못했습니다. 다시 요청해주세요.",
          );
        }
      }
    }

    void finalizeStoredItinerary();

    return () => {
      cancelled = true;
    };
  }, [
    activeFinalizationToken,
    activeRouteRevision,
    itinerary.id,
    routesFinalized,
  ]);

  useEffect(() => {
    if (routesFinalized || activeFinalizationToken) {
      return;
    }

    let cancelled = false;
    const standardRows = createRouteRequestRows(selectedDayPlan.standard);
    const carrymeRows = createRouteRequestRows(selectedDayPlan.carryme);

    queueMicrotask(() => {
      if (!cancelled) {
        setComputedRoutes({});
      }
    });

    async function computeInitialRoute(rows: DestinationRow[], routeId: RoutePlanId) {
      try {
        // Initial map rendering uses verified provider coordinates instead of bundled demo lines.
        const { payload, responseOk } = await requestRouteCheck(rows, transportMode);

        if (cancelled || !responseOk || !payload.ok || !payload.path?.length) {
          if (!cancelled) {
            setComputedRoutes((current) => ({
              ...current,
              [routeId]: createUnavailableComputedRoute(rows),
            }));
          }
          return;
        }

        const result = createComputedRouteResult(
          rows,
          payload,
          itinerary.savedDurationLabel,
        );

        if (!result) {
          return;
        }

        setComputedRoutes((current) => ({
          ...current,
          [routeId]: result,
        }));
      } catch {
        if (!cancelled) {
          setComputedRoutes((current) => ({
            ...current,
            [routeId]: createUnavailableComputedRoute(rows),
          }));
        }
      }
    }

    void computeInitialRoute(standardRows, "standard");
    void computeInitialRoute(carrymeRows, "carryme");

    return () => {
      cancelled = true;
    };
  }, [
    activeFinalizationToken,
    itinerary.savedDurationLabel,
    routesFinalized,
    selectedDayPlan,
  ]);

  /**
   * Applies a successful CarryME recalculation as committed display state.
   */
  const handleRoutesComputed = (payload: RouteComputationPayload) => {
    setComputedRoutes(payload);
  };

  /** Finalizes an edited day on the server and commits it only after every route succeeds. */
  const handleFinalizeEditedItinerary = async (
    carrymeRows: DestinationRow[],
  ): Promise<EditedItineraryFinalizationResult> => {
    if (!activeFinalizationToken) {
      return { message: "서버 저장 일정이 아니어서 기존 경로 계산을 사용합니다.", ok: false };
    }

    const days = editableDays.map((day) => {
      const { uiId: _uiId, ...storedDay } = day;

      if (day.day !== selectedDayPlan.day) {
        return storedDay;
      }

      return {
        ...storedDay,
        carryme: {
          ...storedDay.carryme,
          routeText: carrymeRows.map((row) => row.name).join(" → "),
          stops: createRouteStopsFromRows(
            carrymeRows.map((row) => ({ ...row, mode: transportMode })),
          ),
        },
      };
    });
    const candidate: PlanmeItinerary = {
      ...itinerary,
      days,
      transportMode,
    };

    try {
      const response = await fetch(
        `/api/gpt/itineraries/${encodeURIComponent(itinerary.id)}/routes/finalize`,
        {
          body: JSON.stringify({
            baseRevision: activeRouteRevision,
            itinerary: candidate,
            token: activeFinalizationToken,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const payload = (await response.json()) as FinalizationApiResponse;

      if (!response.ok || payload.status !== "ready" || !payload.itinerary) {
        return {
          message: payload.message ?? "변경한 일정의 경로를 계산하지 못했습니다.",
          ok: false,
        };
      }

      // The previous successful itinerary remains visible until this full replacement succeeds.
      setEditableDays(createEditableDays(payload.itinerary.days));
      setTransportMode(payload.itinerary.transportMode);
      setActiveRouteRevision(payload.revision ?? activeRouteRevision + 1);
      setActiveFinalizationToken(payload.token);
      setComputedRoutes({});
      setRoutesFinalized(true);

      return { message: "변경한 일정과 경로를 저장했습니다.", ok: true };
    } catch {
      return { message: "변경한 일정의 경로를 계산하지 못했습니다.", ok: false };
    }
  };

  /**
   * Stores one itinerary-wide mode and suppresses paths computed with the previous mode.
   */
  const handleTransportModeChange = (nextMode: PlanmeTransportMode) => {
    setTransportMode(nextMode);

    if (!selectedDayPlan) {
      setComputedRoutes({});
      return;
    }

    setComputedRoutes({
      standard: createUnavailableComputedRoute(
        createRouteRequestRows(selectedDayPlan.standard),
      ),
      carryme: createUnavailableComputedRoute(
        createRouteRequestRows(selectedDayPlan.carryme),
      ),
    });
  };

  /**
   * Updates the selected itinerary day from the segmented control.
   */
  const handleDayChange = (
    _: MouseEvent<HTMLElement>,
    value: number | null,
  ) => {
    if (value) {
      // Hide the previous day's provider geometry until the selected day finishes routing.
      setComputedRoutes({});
      setSelectedDay(value);
    }
  };

  /**
   * Adds a new local day tab by cloning the currently selected day structure.
   */
  const handleAddDay = () => {
    const templateDay = selectedDayPlan ?? editableDays[0];
    const nextDayNumber = editableDays.length + 1;

    if (!templateDay) {
      return;
    }

    // Clone the current demo day so the visual layout remains filled while data APIs are pending.
    setEditableDays((current) => [
      ...current,
      {
        ...templateDay,
        day: nextDayNumber,
        label: `Day ${nextDayNumber}`,
        uiId: `local-day-${Date.now()}-${nextDayNumber}`,
      },
    ]);
    // A cloned day must also start with markers only until its route is recalculated.
    setComputedRoutes({});
    setSelectedDay(nextDayNumber);
  };

  /**
   * Updates the active dashboard view tab.
   */
  const handleViewChange = (
    _: MouseEvent<HTMLElement>,
    value: "compare" | "map" | null,
  ) => {
    if (value) {
      setActiveView(value);
    }
  };

  /**
   * Toggles a route overlay in the mock map.
   */
  const handleRouteToggle = (routeId: RoutePlanId) => {
    setVisibleRoutes((current) => ({
      ...current,
      [routeId]: !current[routeId],
    }));
  };

  if (!selectedDayPlan) {
    return null;
  }

  return (
    <Box
      sx={{
        color: "text.primary",
        mx: "auto",
        width: "100%",
      }}
    >
      <Stack spacing={3}>
        <TopBar />

        <Box
          sx={{
            alignItems: { xs: "flex-start", lg: "center" },
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", lg: "1fr auto" },
          }}
        >
          <Box>
            <Typography variant="h1">{displayTitle}</Typography>
          </Box>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            sx={{ width: { xs: "100%", lg: "auto" } }}
          >
            <MetricCard
              icon={<AccessTimeRoundedIcon />}
              label="총 이동 시간"
              tone="primary"
              value={shouldHideProviderResult ? hiddenDurationLabel : totalDurationLabel}
            />
            <MetricCard
              icon={<WbSunnyRoundedIcon />}
              label="절약 시간"
              tone="error"
              value={displaySavingLabel}
            />
          </Stack>
        </Box>

        <Box
          sx={{
            bgcolor: "background.paper",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 2,
            boxShadow: isDark
              ? "0 20px 70px rgba(0,0,0,0.24)"
              : "0 18px 60px rgba(23, 32, 51, 0.08)",
            overflow: "hidden",
          }}
        >
          <Box
            sx={{
              alignItems: "center",
              borderBottom: "1px solid",
              borderColor: "divider",
              display: "grid",
              gap: 2,
              gridTemplateColumns: {
                xs: "1fr",
                md: "1fr auto 1fr",
              },
              p: { xs: 1.5, md: 2 },
            }}
          >
            <ToggleButtonGroup
              exclusive
              color="primary"
              onChange={handleViewChange}
              value={activeView}
              sx={{
                justifySelf: { xs: "stretch", md: "start" },
                width: { xs: "100%", md: "auto" },
                "& .MuiToggleButtonGroup-grouped": {
                  flex: { xs: 1, md: "initial" },
                },
              }}
            >
              <ToggleButton value="compare">
                <RouteRoundedIcon sx={{ mr: 1 }} />
                동선 비교
              </ToggleButton>
              <ToggleButton value="map">
                <MapOutlinedIcon sx={{ mr: 1 }} />
                상세 지도
              </ToggleButton>
            </ToggleButtonGroup>

            <Stack
              direction="row"
              spacing={0.75}
              sx={{
                alignItems: "center",
                justifySelf: { xs: "stretch", md: "center" },
                width: { xs: "100%", md: "auto" },
              }}
            >
              <ToggleButtonGroup
                exclusive
                color="primary"
                onChange={handleDayChange}
                value={selectedDay}
                sx={{ flex: { xs: 1, md: "initial" }, minWidth: 0 }}
              >
                {editableDays.map((day, index) => (
                  <ToggleButton
                    key={day.uiId}
                    value={day.day}
                    sx={{
                      flex: { xs: 1, md: "initial" },
                      minWidth: { xs: 0, sm: 112 },
                      position: "relative",
                      px: { xs: 1, sm: 2.8 },
                    }}
                  >
                    {formatDayToggleLabel(day, index)}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              {editingEnabled ? (
                <Button
                  aria-label="일자 추가"
                  onClick={handleAddDay}
                  size="small"
                  sx={{ minWidth: 42, px: 1 }}
                  variant="outlined"
                >
                  <AddRoundedIcon fontSize="small" />
                </Button>
              ) : null}
            </Stack>

            <Stack
              direction="row"
              spacing={1}
              sx={{
                alignItems: "center",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1.5,
                justifySelf: { xs: "stretch", md: "end" },
                px: 1.5,
                py: 1,
              }}
            >
              <RouteToggleButton
                active={visibleRoutes.standard}
                color={theme.palette.primary.main}
                label="Standard"
                onClick={() => handleRouteToggle("standard")}
              />
              <Divider flexItem orientation="vertical" />
              <RouteToggleButton
                active={visibleRoutes.carryme}
                color={theme.palette.secondary.main}
                label="CarryME"
                onClick={() => handleRouteToggle("carryme")}
              />
            </Stack>
          </Box>

          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: { xs: "1fr" },
              p: { xs: 1.5, md: 2 },
            }}
          >
            {finalizationMessage ? (
              <Box
                role="alert"
                sx={{
                  borderBottom: "1px solid",
                  borderColor: "error.light",
                  color: "error.main",
                  px: 2,
                  py: 1.5,
                }}
              >
                {finalizationMessage}
              </Box>
            ) : null}
            <Stack spacing={1.5}>
              <Box
                sx={{
                  display: activeView === "compare" ? "grid" : "none",
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 2,
                  gap: 0,
                  gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                  overflow: "hidden",
                }}
              >
                <RouteComparisonCard
                  position="left"
                  route={displayStandardRoute}
                  tone="primary"
                />
                <RouteComparisonCard
                  position="right"
                  route={displayCarrymeRoute}
                  tone="secondary"
                />
              </Box>

              {activeView === "compare" ? (
                <>
                  <TimelinePanel
                    carrymeDurationLabel={displayCarrymeRoute.durationLabel}
                    carrymeEvents={
                      selectedDayPlan.carrymeTimeline ??
                      computedRoutes.carryme?.timeline ??
                      selectedDayPlan.timeline
                    }
                    carrymeStops={displayCarrymeRoute.stops}
                    isFinalDay={
                      selectedDayPlan.day === editableDays.at(-1)?.day
                    }
                    mode={mode}
                    savingLabel={displaySavingLabel}
                    standardDurationLabel={displayStandardRoute.durationLabel}
                    standardEvents={
                      computedRoutes.standard?.timeline ??
                      selectedDayPlan.standardTimeline ??
                      selectedDayPlan.timeline
                    }
                    standardStops={displayStandardRoute.stops}
                  />

                  {editingEnabled ? <Box
                    aria-busy={finalizationStatus === "loading"}
                    sx={{
                      opacity: finalizationStatus === "loading" ? 0.55 : 1,
                      pointerEvents: finalizationStatus === "loading" ? "none" : "auto",
                    }}
                  >
                    <DestinationEditor
                      key={selectedDayPlan.uiId}
                      initialRows={createDestinationRows(carrymeRoute)}
                      mode={mode}
                      onRoutesComputed={handleRoutesComputed}
                      onFinalizeItinerary={
                        activeFinalizationToken ? handleFinalizeEditedItinerary : undefined
                      }
                      savingLabel={displaySavingLabel}
                      standardRoute={selectedDayPlan.standard}
                      carrymeTimeline={selectedDayPlan.carrymeTimeline ?? selectedDayPlan.timeline}
                      transportMode={transportMode}
                      onTransportModeChange={handleTransportModeChange}
                    />
                  </Box> : null}
                </>
              ) : null}

              <RouteMap
                carrymeRoute={displayCarrymeRoute}
                expanded={activeView === "map"}
                savingLabel={displaySavingLabel}
                showCarryme={visibleRoutes.carryme}
                showStandard={visibleRoutes.standard}
                standardRoute={displayStandardRoute}
                attachedToComparison={activeView === "compare"}
                themeMode={mode}
              />
            </Stack>
          </Box>

        </Box>

        <BenefitStrip benefits={displayBenefits} />

        {!compact ? (
          <Typography color="text.secondary" variant="body2">
            이 화면은 Custom GPT Actions가 반환한 링크를 누른 뒤 PlanME 웹에서
            확인하는 상세 화면 예시입니다.
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}

/**
 * Renders the compact PlanME brand header.
 */
function TopBar() {
  return (
    <Stack
      direction="row"
      sx={{
        alignItems: "center",
        gap: 2,
        justifyContent: "space-between",
      }}
    >
      <Box sx={{ maxWidth: "100%", width: { xs: 240, sm: 264 } }}>
        <Image
          alt="PlanME by GuideME"
          height={237}
          priority
          src="/brand/planme-logo.png"
          style={{ display: "block", height: "auto", width: "100%" }}
          width={1414}
        />
      </Box>
    </Stack>
  );
}

type MetricCardProps = {
  icon: ReactNode;
  label: string;
  tone: "primary" | "error";
  value: string;
};

/**
 * Renders a top KPI card for travel duration and time saved.
 */
function MetricCard({ icon, label, tone, value }: MetricCardProps) {
  const theme = useTheme();
  const color =
    tone === "error" ? theme.palette.error.main : theme.palette.primary.main;

  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        alignItems: "center",
        bgcolor: alpha(color, theme.palette.mode === "dark" ? 0.08 : 0.04),
        border: "1px solid",
        borderColor: alpha(color, 0.18),
        borderRadius: 2,
        minWidth: { sm: 260 },
        px: 2,
        py: 1.6,
      }}
    >
      <Box sx={{ color, display: "flex" }}>{icon}</Box>
      <Box>
        <Typography color={tone} sx={{ fontSize: 13, fontWeight: 800 }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: 18, fontWeight: 900 }}>{value}</Typography>
      </Box>
    </Stack>
  );
}

type RouteToggleButtonProps = {
  active: boolean;
  color: string;
  label: string;
  onClick: () => void;
};

/**
 * Renders a legend item that also toggles a route overlay.
 */
function RouteToggleButton({
  active,
  color,
  label,
  onClick,
}: RouteToggleButtonProps) {
  return (
    <Button
      color="inherit"
      onClick={onClick}
      size="small"
      sx={{ opacity: active ? 1 : 0.45 }}
    >
      <Box
        sx={{
          bgcolor: color,
          borderRadius: 999,
          height: 4,
          mr: 1,
          width: 24,
        }}
      />
      {label}
    </Button>
  );
}

type RouteComparisonCardProps = {
  position: "left" | "right";
  route: RoutePlan;
  tone: "primary" | "secondary";
};

/**
 * Renders one Standard or CarryME route comparison summary.
 */
function RouteComparisonCard({
  position,
  route,
  tone,
}: RouteComparisonCardProps) {
  const theme = useTheme();
  const dividerColor =
    theme.palette.mode === "dark"
      ? alpha("#94a3b8", 0.18)
      : alpha("#172033", 0.1);

  return (
    <Box
      sx={{
        borderBottom: {
          xs: position === "left" ? `1px solid ${dividerColor}` : 0,
          md: 0,
        },
        borderRight: {
          xs: 0,
          md: position === "left" ? `1px solid ${dividerColor}` : 0,
        },
        p: { xs: 1.75, md: 2.5 },
      }}
    >
      <Stack spacing={1.7}>
        <Chip
          color={tone}
          label={route.badge}
          size="small"
          sx={{ alignSelf: "flex-start" }}
        />
        <Box>
          <Typography sx={{ fontSize: 20, fontWeight: 900 }}>
            {route.routeText}
          </Typography>
          <Typography color={tone} sx={{ fontSize: 14, fontWeight: 800, mt: 0.5 }}>
            {normalizeRouteDescription(route.description)}
          </Typography>
        </Box>
      </Stack>
    </Box>
  );
}

type DestinationEditorProps = {
  carrymeTimeline: TimelineEvent[];
  initialRows: DestinationRow[];
  mode: "light" | "dark";
  onRoutesComputed: (payload: RouteComputationPayload) => void;
  onFinalizeItinerary?: (
    carrymeRows: DestinationRow[],
  ) => Promise<EditedItineraryFinalizationResult>;
  savingLabel: string;
  standardRoute: RoutePlan;
  transportMode: PlanmeTransportMode;
  onTransportModeChange: (transportMode: PlanmeTransportMode) => void;
};

/**
 * Renders the local destination editor prototype between the comparison cards and map.
 */
function DestinationEditor({
  carrymeTimeline,
  initialRows,
  mode,
  onRoutesComputed,
  onFinalizeItinerary,
  savingLabel,
  standardRoute,
  transportMode,
  onTransportModeChange,
}: DestinationEditorProps) {
  const theme = useTheme();
  const [rows, setRows] = useState<DestinationRow[]>(initialRows);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<DestinationCandidate[]>([]);
  const [suggestionStatus, setSuggestionStatus] = useState<AsyncStatus>("idle");
  const [suggestionMessage, setSuggestionMessage] = useState<string | null>(null);
  const [routeStatus, setRouteStatus] = useState<AsyncStatus>("idle");
  const [routeMessage, setRouteMessage] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DestinationDragPreview | null>(null);
  const pointerDraggingIdRef = useRef<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const isDark = mode === "dark";

  const activeRow = rows.find((row) => row.id === activeRowId);

  /**
   * Starts the shared drag state used by pointer and mouse gestures.
   */
  const startDestinationDrag = (rowId: string, clientX: number, clientY: number) => {
    pointerDraggingIdRef.current = rowId;
    const row = rows.find((candidate) => candidate.id === rowId);
    const rect = rowRefs.current[rowId]?.getBoundingClientRect();

    // Render a separate floating preview so the real row can stay stable for reorder math.
    setDragPreview({
      label: row?.name ?? "",
      width: rect?.width ?? 280,
      x: rect?.left ?? clientX,
      y: rect?.top ?? clientY,
    });
    setDraggingId(rowId);
  };

  /**
   * Moves the shared floating drag preview.
   */
  const moveDestinationDragPreview = (clientY: number) => {
    if (!pointerDraggingIdRef.current) {
      return;
    }

    // Keep the preview slightly above the cursor so the destination row remains visible.
    setDragPreview((current) =>
      current ? { ...current, y: clientY - 22 } : current,
    );
  };

  /**
   * Moves a destination row to an insertion index in the current visible order.
   */
  const moveDestinationToIndex = (draggedId: string, rawInsertIndex: number) => {
    // Adjust the insertion point after removing the dragged row from the current list.
    setRows((current) => {
      const draggedRow = current.find((row) => row.id === draggedId);
      const draggedIndex = current.findIndex((row) => row.id === draggedId);

      if (!draggedRow || draggedIndex < 0) {
        return current;
      }

      const withoutDragged = current.filter((row) => row.id !== draggedId);
      const adjustedIndex =
        draggedIndex < rawInsertIndex ? rawInsertIndex - 1 : rawInsertIndex;
      const insertIndex = Math.max(0, Math.min(adjustedIndex, withoutDragged.length));

      return [
        ...withoutDragged.slice(0, insertIndex),
        draggedRow,
        ...withoutDragged.slice(insertIndex),
      ];
    });
    setRouteStatus("idle");
    setRouteMessage(null);
  };

  /**
   * Completes the shared drag state at the provided viewport Y position.
   */
  const completeDestinationDrag = (clientY: number) => {
    const draggedId = pointerDraggingIdRef.current;

    if (!draggedId) {
      return;
    }

    const rawInsertIndex = rows.findIndex((row) => {
      const rect = rowRefs.current[row.id]?.getBoundingClientRect();

      return rect ? clientY < rect.top + rect.height / 2 : false;
    });

    moveDestinationToIndex(
      draggedId,
      rawInsertIndex >= 0 ? rawInsertIndex : rows.length,
    );
    pointerDraggingIdRef.current = null;
    setDragPreview(null);
    setDraggingId(null);
  };

  useEffect(() => {
    const handleDocumentMouseMove = (event: globalThis.MouseEvent) => {
      moveDestinationDragPreview(event.clientY);
    };

    const handleDocumentMouseUp = (event: globalThis.MouseEvent) => {
      completeDestinationDrag(event.clientY);
    };

    document.addEventListener("mousemove", handleDocumentMouseMove);
    document.addEventListener("mouseup", handleDocumentMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleDocumentMouseMove);
      document.removeEventListener("mouseup", handleDocumentMouseUp);
    };
  });

  useEffect(() => {
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (target.closest("[data-destination-search]")) {
        return;
      }

      setActiveRowId(null);
      setSuggestions([]);
      setSuggestionStatus("idle");
      setSuggestionMessage(null);
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown);
    };
  }, []);

  useEffect(() => {
    if (!activeRow || activeRow.name.trim().length < 2) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setSuggestionStatus("loading");
      setSuggestionMessage(null);

      try {
        // Ask the server route for candidates so the browser does not own API contracts.
        const response = await fetch("/api/places/search", {
          body: JSON.stringify({
            query: activeRow.name,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        const payload = (await response.json()) as PlaceSearchApiResponse;

        if (!response.ok) {
          setSuggestions([]);
          setSuggestionStatus("error");
          setSuggestionMessage(payload.message ?? "장소 검색에 실패했습니다.");
          return;
        }

        setSuggestions(payload.candidates ?? []);
        setSuggestionStatus("success");
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setSuggestions([]);
        setSuggestionStatus("error");
        setSuggestionMessage("장소 검색 요청을 완료하지 못했습니다.");
      }
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [activeRow]);

  /**
   * Adds a waypoint before the final destination so start and end stay visually stable.
   */
  const handleAddWaypoint = () => {
    const newRow: DestinationRow = {
      id: `destination-local-${Date.now()}`,
      name: "새 행선지",
      role: "방문지",
    };

    // Insert before the last row because new stops are usually intermediate waypoints.
    setRows((current) => {
      if (current.length <= 1) {
        return [...current, newRow];
      }

      return [...current.slice(0, -1), newRow, current[current.length - 1]];
    });
    setActiveRowId(newRow.id);
    setRouteStatus("idle");
    setRouteMessage(null);
  };

  /**
   * Deletes a destination row from the local editor.
   */
  const handleDeleteDestination = (rowId: string) => {
    if (rows.length <= 1) {
      return;
    }

    // Keep at least one row visible so the editing surface does not collapse.
    setRows((current) => current.filter((row) => row.id !== rowId));
    setRouteStatus("idle");
    setRouteMessage(null);
  };

  /**
   * Updates the clicked destination text directly in the row.
   */
  const updateDestinationName = (rowId: string, nextName: string) => {
    // Clear the selected place because typing means the coordinate may no longer match.
    setRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? {
              ...row,
              coordinate: undefined,
              name: nextName,
              placeId: undefined,
              placeSource: undefined,
              placeSourceRef: undefined,
            }
          : row,
      ),
    );
    setActiveRowId(rowId);
    if (nextName.trim().length < 2) {
      setSuggestions([]);
      setSuggestionStatus("idle");
      setSuggestionMessage(null);
    }
    setRouteStatus("idle");
    setRouteMessage(null);
  };

  /**
   * Handles React input change events from the editable destination text.
   */
  const handleDestinationNameChange = (
    rowId: string,
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    updateDestinationName(rowId, event.target.value);
  };

  /**
   * Updates the one itinerary-wide transport mode without calling route providers.
   */
  const handleTransportModeSelect = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const nextMode = event.target.value as PlanmeTransportMode;

    if (!destinationModeOptions.some((option) => option.value === nextMode)) {
      return;
    }

    onTransportModeChange(nextMode);
    setRouteStatus("idle");
    setRouteMessage("경로 다시 계산이 필요합니다.");
  };

  /**
   * Applies a coordinate-bearing Naver candidate without a second details call.
   */
  const handleSelectCandidate = (
    rowId: string,
    candidate: DestinationCandidate,
  ) => {
    setRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? {
              ...row,
              coordinate: candidate.coordinate,
              name: candidate.name,
              placeId: undefined,
              placeSource: candidate.placeSource,
              placeSourceRef: candidate.placeSourceRef,
            }
          : row,
      ),
    );
    setActiveRowId(null);
    setSuggestions([]);
    setSuggestionStatus("idle");
    setRouteStatus("idle");
    setRouteMessage(null);
  };

  /**
   * Checks the current destination order and travel modes through route APIs.
   */
  const handleCheckRoute = async () => {
    const standardRows = createRouteRequestRows(standardRoute);
    const allRows = [...standardRows, ...rows];

    if (
      getRowsWithoutCoordinates(allRows).length > 0 ||
      getRowsWithMissingRouteContract(allRows).length > 0
    ) {
      setRouteStatus("error");
      setRouteMessage("장소를 선택해 주세요");
      return;
    }

    setRouteStatus("loading");
    setRouteMessage("경로를 확인하는 중입니다.");

    if (onFinalizeItinerary) {
      const finalized = await onFinalizeItinerary(rows);

      setRouteStatus(finalized.ok ? "success" : "error");
      setRouteMessage(finalized.message);
      return;
    }

    const [standardSettled, carrymeSettled] = await Promise.allSettled([
      requestRouteCheck(standardRows, transportMode),
      requestRouteCheck(rows, transportMode),
    ]);
    const toComputedResult = (
      settled: PromiseSettledResult<RouteCheckResult>,
      routeRows: DestinationRow[],
    ) => {
      if (
        settled.status !== "fulfilled" ||
        !settled.value.responseOk ||
        !settled.value.payload.ok
      ) {
        return null;
      }

      return createComputedRouteResult(routeRows, settled.value.payload, savingLabel);
    };
    const standardResult = toComputedResult(standardSettled, standardRows);
    const carrymeResult = toComputedResult(carrymeSettled, rows);

    onRoutesComputed({
      standard: standardResult ?? createUnavailableComputedRoute(standardRows),
      carryme: carrymeResult ?? createUnavailableComputedRoute(rows),
    });

    if (standardResult && carrymeResult) {
      setRouteStatus("success");
      setRouteMessage("Standard와 CarryME 경로를 계산했습니다.");
      return;
    }

    setRouteStatus("error");
    setRouteMessage(
      [
        standardResult ? null : "Standard: 경로를 확인하지 못했습니다",
        carrymeResult ? null : "CarryME: 경로를 확인하지 못했습니다",
      ]
        .filter(Boolean)
        .join(" · "),
    );
  };

  /**
   * Allows the row to receive a dragged destination.
   */
  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  /**
   * Starts dragging a destination row with a browser-native payload.
   */
  const handleDragStart = (rowId: string, event: DragEvent<HTMLDivElement>) => {
    // Keep the dragged row id in the native drag payload so drop does not depend on React state timing.
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", rowId);
    startDestinationDrag(rowId, event.clientX, event.clientY);
  };

  /**
   * Starts pointer-based row dragging from the grip handle.
   */
  const handlePointerDragStart = (
    rowId: string,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) {
      return;
    }

    // Capture the pointer so releasing below another row still completes the reorder.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startDestinationDrag(rowId, event.clientX, event.clientY);
  };

  /**
   * Moves the floating drag preview with the pointer.
   */
  const handlePointerDragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    moveDestinationDragPreview(event.clientY);
  };

  /**
   * Completes pointer-based row dragging by converting the release Y to an insert index.
   */
  const handlePointerDragEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    completeDestinationDrag(event.clientY);
  };

  /**
   * Starts mouse-based row dragging for browser automation and ordinary desktop input.
   */
  const handleMouseDragStart = (rowId: string, event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    startDestinationDrag(rowId, event.clientX, event.clientY);
  };

  /**
   * Cancels pointer-based row dragging when the browser aborts the pointer stream.
   */
  const handlePointerDragCancel = () => {
    pointerDraggingIdRef.current = null;
    setDragPreview(null);
    setDraggingId(null);
  };

  /**
   * Moves the dragged destination row before or after the row it was dropped on.
   */
  const handleDropDestination = (targetId: string, event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData("text/plain") || draggingId;

    if (!draggedId || draggedId === targetId) {
      setDraggingId(null);
      setDragPreview(null);
      return;
    }

    const draggedIndex = rows.findIndex((row) => row.id === draggedId);
    const targetIndex = rows.findIndex((row) => row.id === targetId);

    if (draggedIndex >= 0 && targetIndex >= 0) {
      moveDestinationToIndex(
        draggedId,
        draggedIndex < targetIndex ? targetIndex + 1 : targetIndex,
      );
    }
    setDraggingId(null);
    setDragPreview(null);
  };

  return (
    <Box
      data-testid="destination-editor"
      sx={{
        bgcolor: "background.paper",
        borderLeft: "1px solid",
        borderRight: "1px solid",
        borderBottom: 0,
        borderTop: "1px solid",
        borderColor: "divider",
        borderTopColor: isDark ? alpha("#94a3b8", 0.18) : "#e5e7eb",
        px: { xs: 1.25, md: 1.5 },
        py: 1,
      }}
    >
      <Stack spacing={0.8}>
        <Stack
          spacing={1}
          sx={{
            alignItems: { xs: "stretch", sm: "center" },
            columnGap: 0.75,
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              md: "minmax(0, 1fr) auto",
            },
            px: 0.75,
            rowGap: 1,
          }}
        >
          <Stack
            direction="row"
            spacing={1.4}
            sx={{
              alignItems: "baseline",
              gridColumn: "1",
              minWidth: 0,
            }}
          >
            <Typography sx={{ fontSize: 15, fontWeight: 900 }}>
              행선지 편집
            </Typography>
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            sx={{
              gridColumn: { xs: "1", md: "2" },
              justifyContent: "flex-end",
            }}
          >
            <TextField
              data-testid="itinerary-transport-mode"
              select
              label="이동 수단"
              onChange={handleTransportModeSelect}
              size="small"
              value={transportMode}
              sx={{ minWidth: 132 }}
            >
              {destinationModeOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    {option.icon}
                    <span>{option.label}</span>
                  </Stack>
                </MenuItem>
              ))}
            </TextField>
            <Button
              aria-label="경유지 추가"
              onClick={handleAddWaypoint}
              size="small"
              startIcon={<AddRoundedIcon />}
              sx={{ minHeight: 34, whiteSpace: "nowrap" }}
              variant="outlined"
            >
              추가
            </Button>
            <Button
              aria-label={routeStatus === "loading" ? "경로 계산 중" : "경로 다시 계산"}
              disabled={routeStatus === "loading" || rows.length < 2}
              onClick={handleCheckRoute}
              size="small"
              startIcon={<RouteRoundedIcon />}
              sx={{ minHeight: 34, whiteSpace: "nowrap" }}
              variant="contained"
            >
              {routeStatus === "loading" ? "계산 중" : "재계산"}
            </Button>
          </Stack>
        </Stack>

        {routeMessage ? (
          <Box
            sx={{
              bgcolor:
                routeStatus === "error"
                  ? alpha(theme.palette.error.main, 0.06)
                  : alpha(theme.palette.secondary.main, 0.08),
              border: "1px solid",
              borderColor:
                routeStatus === "error"
                  ? alpha(theme.palette.error.main, 0.26)
                  : alpha(theme.palette.secondary.main, 0.2),
              borderRadius: 1.2,
              color: routeStatus === "error" ? "error.main" : "secondary.main",
              fontSize: 13,
              fontWeight: 800,
              px: 1.5,
              py: 0.8,
            }}
          >
            {routeMessage}
          </Box>
        ) : null}

        <Stack spacing={0.35}>
          {rows.map((row, index) => {
            const nextRow = rows[index + 1];
            const isDraggingRow = draggingId === row.id;
            const isActiveSearchRow = activeRowId === row.id;

            return (
              <Fragment key={row.id}>
                <Box
                  data-testid="destination-row"
                  ref={(element: HTMLDivElement | null) => {
                    rowRefs.current[row.id] = element;
                  }}
                  draggable
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDragPreview(null);
                  }}
                  onDragOver={handleDragOver}
                  onDragStart={(event) => handleDragStart(row.id, event)}
                  onDrop={(event) => handleDropDestination(row.id, event)}
                  sx={{
                    alignItems: "center",
                    bgcolor:
                      isDraggingRow
                        ? alpha(theme.palette.primary.main, 0.08)
                        : isDark
                          ? alpha("#1f2937", 0.68)
                          : alpha("#f8fafc", 0.9),
                    border: "1px solid",
                    borderColor:
                      isDraggingRow
                        ? alpha(theme.palette.primary.main, 0.45)
                        : "divider",
                    borderRadius: 1.2,
                    boxShadow: isDraggingRow
                      ? isDark
                        ? "0 18px 38px rgba(0,0,0,0.42)"
                        : "0 18px 38px rgba(15,23,42,0.2)"
                      : "0 1px 2px rgba(15,23,42,0.04)",
                    display: "grid",
                    gap: 0.75,
                    gridTemplateColumns: {
                      xs: "28px 32px minmax(0, 1fr)",
                      md: "28px 32px minmax(0, 1fr) 92px",
                    },
                    minHeight: 40,
                    opacity: isDraggingRow ? 0.96 : 1,
                    position: "relative",
                    px: 0.75,
                    py: 0.45,
                    transform: isDraggingRow
                      ? "translate3d(0, -2px, 0) scale(1.015)"
                      : "translate3d(0, 0, 0) scale(1)",
                    transition: isDraggingRow
                      ? "box-shadow 120ms ease, border-color 120ms ease, opacity 120ms ease"
                      : "transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease, opacity 160ms ease",
                    willChange: isDraggingRow ? "transform" : "auto",
                    zIndex: isDraggingRow ? 8 : isActiveSearchRow ? 6 : 1,
                  }}
                >
                  <Box
                    data-testid="destination-drag-handle"
                    draggable
                    onPointerCancel={handlePointerDragCancel}
                    onPointerDown={(event) => handlePointerDragStart(row.id, event)}
                    onPointerMove={handlePointerDragMove}
                    onPointerUp={handlePointerDragEnd}
                    onMouseDown={(event) => handleMouseDragStart(row.id, event)}
                    sx={{
                      alignItems: "center",
                      color: "text.secondary",
                      cursor: isDraggingRow ? "grabbing" : "grab",
                      display: "flex",
                      justifyContent: "center",
                      touchAction: "none",
                    }}
                  >
                    <DragIndicatorRoundedIcon fontSize="small" />
                  </Box>
                  <Box
                    sx={{
                      alignItems: "center",
                      border: "1px solid",
                      borderColor: "primary.main",
                      borderRadius: "999px",
                      color: "primary.main",
                      display: "flex",
                      fontSize: 13,
                      fontWeight: 900,
                      height: 26,
                      justifyContent: "center",
                      width: 26,
                    }}
                  >
                    {index + 1}
                  </Box>
                  <Box
                    data-destination-search
                    sx={{
                      alignItems: "center",
                      bgcolor: "transparent",
                      border: 0,
                      borderRadius: 1,
                      display: "grid",
                      gap: 0.75,
                      gridTemplateColumns: "20px auto auto minmax(0, 1fr)",
                      height: 34,
                      minWidth: 0,
                      position: "relative",
                      px: 0.5,
                      "&:hover": {
                        bgcolor: isDark
                          ? alpha("#94a3b8", 0.08)
                          : alpha(theme.palette.primary.main, 0.04),
                      },
                    }}
                  >
                    <LocationOnOutlinedIcon color="action" fontSize="small" />
                    <Box
                      aria-label={`${getDestinationRoleLabel(row)} 행선지`}
                      component="input"
                      onChange={(event) => handleDestinationNameChange(row.id, event)}
                      onFocus={() => setActiveRowId(row.id)}
                      onInput={(event) =>
                        updateDestinationName(row.id, event.currentTarget.value)
                      }
                      value={row.name}
                      sx={{
                        bgcolor: "transparent",
                        border: 0,
                        color: "text.primary",
                        font: "inherit",
                        fontSize: 14,
                        fontWeight: 900,
                        minWidth: 0,
                        outline: 0,
                        p: 0,
                        width: `${Math.max(row.name.length + 1, 4)}em`,
                      }}
                    />
                    <Typography
                      color="text.secondary"
                      sx={{ fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}
                    >
                      {getDestinationRoleLabel(row)}
                    </Typography>
                    {activeRowId === row.id &&
                    (suggestionStatus === "loading" ||
                      suggestionStatus === "error" ||
                      suggestionStatus === "success" ||
                      suggestions.length > 0) ? (
                      <Box
                        data-destination-suggestion-popup
                        data-testid="destination-suggestion-popup"
                        sx={{
                          bgcolor: "background.paper",
                          border: "1px solid",
                          borderColor: "divider",
                          borderRadius: 1.3,
                          boxShadow: isDark
                            ? "0 18px 36px rgba(0,0,0,0.38)"
                            : "0 18px 36px rgba(15,23,42,0.14)",
                          left: 0,
                          maxHeight: 220,
                          minWidth: { xs: 260, md: 380 },
                          overflowY: "auto",
                          position: "absolute",
                          top: 38,
                          width: "max-content",
                          zIndex: 30,
                        }}
                      >
                        {suggestionStatus === "loading" ? (
                          <Typography color="text.secondary" sx={{ fontSize: 13, p: 1.2 }}>
                            장소를 검색하는 중입니다.
                          </Typography>
                        ) : null}
                        {suggestionStatus === "error" ? (
                          <Typography color="error" sx={{ fontSize: 13, p: 1.2 }}>
                            {suggestionMessage ?? "장소 검색에 실패했습니다."}
                          </Typography>
                        ) : null}
                        {suggestionStatus !== "loading"
                          ? suggestions.map((candidate) => (
                              <Box
                                key={candidate.candidateId}
                                component="button"
                                data-testid="destination-suggestion-option"
                                draggable={false}
                                onPointerDown={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  handleSelectCandidate(row.id, candidate);
                                }}
                                sx={{
                                  bgcolor: "transparent",
                                  border: 0,
                                  borderBottom: "1px solid",
                                  borderColor: "divider",
                                  color: "text.primary",
                                  cursor: "pointer",
                                  display: "block",
                                  font: "inherit",
                                  px: 1.2,
                                  py: 1,
                                  textAlign: "left",
                                  width: "100%",
                                  "&:hover": {
                                    bgcolor: alpha(theme.palette.primary.main, 0.06),
                                  },
                                  "&:last-of-type": {
                                    borderBottom: 0,
                                  },
                                }}
                              >
                                <Typography sx={{ fontSize: 13.5, fontWeight: 900 }}>
                                  {candidate.name}
                                </Typography>
                                {candidate.address ? (
                                  <Typography
                                    color="text.secondary"
                                    sx={{ fontSize: 12, mt: 0.2 }}
                                  >
                                    {candidate.address}
                                  </Typography>
                                ) : null}
                              </Box>
                            ))
                          : null}
                        {suggestionStatus === "success" && suggestions.length === 0 ? (
                          <Typography color="text.secondary" sx={{ fontSize: 13, p: 1.2 }}>
                            검색 결과가 없습니다.
                          </Typography>
                        ) : null}
                      </Box>
                    ) : null}
                  </Box>
                  <Button
                    color="error"
                    disabled={rows.length <= 1}
                    onClick={() => handleDeleteDestination(row.id)}
                    size="small"
                    startIcon={<DeleteOutlineRoundedIcon fontSize="small" />}
                    sx={{
                      display: { xs: "none", md: "inline-flex" },
                      height: 34,
                      minWidth: 92,
                      px: 1,
                    }}
                    variant="outlined"
                  >
                    삭제
                  </Button>
                </Box>

                {nextRow ? (
                  <Box
                    sx={{
                      alignItems: "center",
                      display: "grid",
                      gap: 0.75,
                      gridTemplateColumns: {
                        xs: "28px 32px minmax(0, 1fr)",
                        md: "28px 32px minmax(0, 1fr) 92px",
                      },
                      minHeight: 38,
                      px: 0.75,
                    }}
                  >
                    <Box />
                    <Box
                      sx={{
                        bgcolor: alpha(theme.palette.primary.main, 0.24),
                        borderRadius: 999,
                        height: 32,
                        justifySelf: "center",
                        width: 2,
                      }}
                    />
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={0.75}
                      sx={{
                        alignItems: { xs: "stretch", sm: "center" },
                        gridColumn: { xs: "3", md: "3 / 5" },
                        minWidth: 0,
                      }}
                    >
                      <Typography
                        color="text.secondary"
                        sx={{
                          flex: 1,
                          fontSize: 12,
                          fontWeight: 800,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {row.name} → {nextRow.name}
                      </Typography>
                    </Stack>
                  </Box>
                ) : null}
              </Fragment>
            );
          })}
        </Stack>
        {dragPreview ? (
          <Box
            data-testid="destination-drag-preview"
            sx={{
              alignItems: "center",
              bgcolor: "background.paper",
              border: "1px solid",
              borderColor: alpha(theme.palette.primary.main, 0.42),
              borderRadius: 1.2,
              boxShadow: isDark
                ? "0 22px 46px rgba(0,0,0,0.46)"
                : "0 22px 46px rgba(15,23,42,0.24)",
              color: "text.primary",
              display: "flex",
              fontSize: 14,
              fontWeight: 900,
              gap: 1,
              left: dragPreview.x,
              maxWidth: "calc(100vw - 32px)",
              minHeight: 40,
              opacity: 0.96,
              pointerEvents: "none",
              position: "fixed",
              px: 1.4,
              py: 0.8,
              top: dragPreview.y,
              transform: "scale(1.015)",
              width: dragPreview.width,
              zIndex: 1400,
            }}
          >
            <DragIndicatorRoundedIcon fontSize="small" />
            {dragPreview.label}
          </Box>
        ) : null}
      </Stack>
    </Box>
  );
}

type BenefitStripProps = {
  benefits: BenefitItem[];
};

/**
 * Renders the bottom benefit strip from the selected UI concept.
 */
function BenefitStrip({ benefits }: BenefitStripProps) {
  const theme = useTheme();

  return (
    <Box
      sx={{
        bgcolor: "background.paper",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        display: "grid",
        gap: 0,
        gridTemplateColumns: { xs: "1fr", md: "repeat(4, 1fr)" },
        overflow: "hidden",
      }}
    >
      {benefits.map((benefit, index) => (
        <Stack
          key={benefit.title}
          direction="row"
          spacing={1.5}
          sx={{
            alignItems: "center",
            position: "relative",
            "&::before": {
              bgcolor:
                theme.palette.mode === "dark"
                  ? alpha("#94a3b8", 0.18)
                  : "#e5e7eb",
              content: '""',
              display: {
                xs: "none",
                md: index === 0 ? "none" : "block",
              },
              height: 44,
              left: 0,
              position: "absolute",
              top: "50%",
              transform: "translateY(-50%)",
              width: "1px",
            },
            p: 2,
          }}
        >
          <Box
            sx={{
              alignItems: "center",
              bgcolor: alpha(
                index % 2 === 0 ? theme.palette.secondary.main : theme.palette.primary.main,
                0.14,
              ),
              borderRadius: "999px",
              color: index % 2 === 0 ? "secondary.main" : "primary.main",
              display: "flex",
              height: 46,
              justifyContent: "center",
              width: 46,
            }}
          >
            {benefitIcons[benefit.icon]}
          </Box>
          <Box>
            <Typography sx={{ fontWeight: 900 }}>{benefit.title}</Typography>
            <Typography color="text.secondary" sx={{ fontSize: 13 }}>
              {benefit.description}
            </Typography>
          </Box>
        </Stack>
      ))}
    </Box>
  );
}
