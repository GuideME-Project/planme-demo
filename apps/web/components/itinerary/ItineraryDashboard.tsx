"use client";

import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import AttractionsRoundedIcon from "@mui/icons-material/AttractionsRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import DirectionsBusRoundedIcon from "@mui/icons-material/DirectionsBusRounded";
import DirectionsCarRoundedIcon from "@mui/icons-material/DirectionsCarRounded";
import DirectionsWalkRoundedIcon from "@mui/icons-material/DirectionsWalkRounded";
import DragIndicatorRoundedIcon from "@mui/icons-material/DragIndicatorRounded";
import FlightTakeoffRoundedIcon from "@mui/icons-material/FlightTakeoffRounded";
import HelpOutlineRoundedIcon from "@mui/icons-material/HelpOutlineRounded";
import HotelRoundedIcon from "@mui/icons-material/HotelRounded";
import LocationOnOutlinedIcon from "@mui/icons-material/LocationOnOutlined";
import MapOutlinedIcon from "@mui/icons-material/MapOutlined";
import PhoneIphoneRoundedIcon from "@mui/icons-material/PhoneIphoneRounded";
import RouteRoundedIcon from "@mui/icons-material/RouteRounded";
import ShieldRoundedIcon from "@mui/icons-material/ShieldRounded";
import TrainRoundedIcon from "@mui/icons-material/TrainRounded";
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
import type {
  BenefitItem,
  MapCoordinate,
  PlanmeItinerary,
  RoutePlan,
  RoutePlanId,
  RouteStop,
  TimelineEvent,
} from "@planme/core";
import { RouteMap } from "@/components/itinerary/RouteMap";
import { TimelinePanel } from "@/components/itinerary/TimelinePanel";
import { usePlanmeColorMode } from "@/theme/ThemeRegistry";

type ItineraryDashboardProps = {
  itinerary: PlanmeItinerary;
  compact: boolean;
};

type EditableDayPlan = Omit<PlanmeItinerary["days"][number], "day"> & {
  day: number;
  uiId: string;
};

type DestinationMode = "drive" | "transit" | "walk";

type DestinationRow = {
  coordinate?: MapCoordinate;
  id: string;
  mode: DestinationMode;
  name: string;
  placeId?: string;
};

type DestinationDragPreview = {
  label: string;
  width: number;
  x: number;
  y: number;
};

type DestinationCandidate = {
  mainText: string;
  placeId: string;
  secondaryText: string;
  text: string;
};

type PlacesAutocompleteApiResponse = {
  candidates?: DestinationCandidate[];
  message?: string;
};

type PlaceDetailsApiResponse = {
  message?: string;
  place?: {
    coordinate: MapCoordinate;
    placeId: string;
    secondaryText: string;
    text: string;
  };
};

type RouteCheckApiResponse = {
  message?: string;
  ok: boolean;
  path?: MapCoordinate[];
  segments?: Array<{
    distanceMeters: number;
    durationSeconds: number;
    mode: DestinationMode;
    path: MapCoordinate[];
    paths?: MapCoordinate[][];
  }>;
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
  path: MapCoordinate[];
  routeText: string;
  segments: MapCoordinate[][];
  stops: RouteStop[];
  timeline: TimelineEvent[];
};

type ComputedRouteState = Partial<
  Record<RoutePlanId, ComputedRouteResult>
>;

type RouteComputationPayload = Record<RoutePlanId, ComputedRouteResult>;

const stopIcons: Record<RouteStop["icon"], ReactNode> = {
  airport: <FlightTakeoffRoundedIcon />,
  attraction: <AttractionsRoundedIcon />,
  event: <AttractionsRoundedIcon />,
  hotel: <HotelRoundedIcon />,
  station: <TrainRoundedIcon />,
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
  value: DestinationMode;
}> = [
  { icon: <DirectionsCarRoundedIcon fontSize="small" />, label: "자동차", value: "drive" },
  { icon: <DirectionsBusRoundedIcon fontSize="small" />, label: "대중교통", value: "transit" },
  { icon: <DirectionsWalkRoundedIcon fontSize="small" />, label: "도보", value: "walk" },
];

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
  endX?: number;
  endY?: number;
  sectionTime?: number;
  startX?: number;
  startY?: number;
  trafficType?: number;
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
    uiId: `seed-day-${day.day}`,
  }));
}

/**
 * Builds editable destination rows from the CarryME route because that is the target optimized path.
 */
function createDestinationRows(route: RoutePlan): DestinationRow[] {
  return route.stops.map((stop, index) => ({
    coordinate: stop.coordinate,
    id: `destination-${index}-${stop.label}`,
    mode: index === 0 ? "transit" : "walk",
    name: stop.label,
  }));
}

/**
 * Builds the API request rows for a route plan.
 */
function createRouteRequestRows(route: RoutePlan): DestinationRow[] {
  return route.stops.map((stop, index) => ({
    coordinate: stop.coordinate,
    id: `${route.id}-route-${index}-${stop.label}`,
    mode: index === 0 ? "transit" : "walk",
    name: stop.label,
  }));
}

/**
 * Converts editable destination rows into route stops for committed display state.
 */
function createRouteStopsFromRows(rows: DestinationRow[]): RouteStop[] {
  return rows.map((row, index) => {
    const role = getDestinationRole(index, rows.length);
    const icon = row.name.includes("호텔")
      ? "hotel"
      : row.name.includes("공연")
        ? "event"
        : row.name.includes("공항")
          ? "airport"
          : row.name.includes("역")
            ? "station"
            : "attraction";

    return {
      caption: role,
      coordinate: row.coordinate,
      icon,
      label: row.name,
    };
  });
}

/**
 * Creates a compact timeline from committed destination rows.
 */
function createTimelineFromRows(rows: DestinationRow[], savingLabel?: string): TimelineEvent[] {
  const times = ["09:30", "10:20", "15:00", "21:30", "22:00"];

  return rows.map((row, index) => {
    const isFirst = index === 0;
    const isLast = index === rows.length - 1;
    const category: TimelineEvent["category"] = row.name.includes("호텔")
      ? "hotel"
      : row.name.includes("공연")
        ? "event"
        : isFirst
          ? "arrival"
          : "transit";

    return {
      category,
      description: isFirst
        ? "경로 다시 계산 결과가 반영된 출발지"
        : isLast
          ? "경로 다시 계산 결과가 반영된 도착지"
          : "경로 다시 계산 결과가 반영된 방문지",
      savingLabel: index === 1 ? savingLabel : undefined,
      time: times[index] ?? times[times.length - 1],
      title: isFirst
        ? `${row.name} 출발`
        : isLast
          ? `${row.name} 도착`
          : `${row.name} 방문`,
    };
  });
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

  // Long-distance transit must include a real drawable route, not just endpoint markers.
  if (!segment.paths.some((path) => path.length > 2)) {
    throw new Error("지도에 표시할 장거리 대중교통 경로 좌표를 확인하지 못했습니다.");
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
  return `drive:${getRouteRowsSignature([origin, destination])}`;
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
function createTrainTerminalRow(terminal: OdsayTrainTerminal, mode: DestinationMode): DestinationRow {
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
 * Builds a drawable coarse path from ODsay long-distance chunk endpoints.
 */
function getOdsaySubPathBoundaryPath(subPaths: OdsayTransitSubPath[]) {
  const path: MapCoordinate[] = [];

  for (const subPath of subPaths) {
    const startCoordinate = toOdsayMapCoordinate({ x: subPath.startX, y: subPath.startY });
    const endCoordinate = toOdsayMapCoordinate({ x: subPath.endX, y: subPath.endY });

    // Keep only provider-supplied transfer endpoints; never join rows without provider points.
    if (startCoordinate) {
      appendMapCoordinate(path, startCoordinate);
    }

    if (endCoordinate) {
      appendMapCoordinate(path, endCoordinate);
    }
  }

  return path;
}

/**
 * Merges multiple drawable provider segments without inventing missing links.
 */
function combineOdsaySegments(
  segments: Array<{
    distanceMeters: number;
    durationSeconds: number;
    path: MapCoordinate[];
    paths: MapCoordinate[][];
  }>,
) {
  const path: MapCoordinate[] = [];

  for (const segment of segments) {
    for (const coordinate of segment.path) {
      appendMapCoordinate(path, coordinate);
    }
  }

  return {
    distanceMeters: segments.reduce((sum, segment) => sum + segment.distanceMeters, 0),
    durationSeconds: segments.reduce((sum, segment) => sum + segment.durationSeconds, 0),
    path,
    paths: segments.flatMap((segment) => segment.paths).filter((segment) => segment.length > 2),
  };
}

/**
 * Returns a drawable ODsay walking route for a local segment.
 */
async function requestOdsayWalkRoute(origin: DestinationRow, destination: DestinationRow) {
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
async function requestOptionalOdsayWalkRoute(origin: DestinationRow, destination: DestinationRow) {
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
async function requestOdsayLocalTransitRoute(origin: DestinationRow, destination: DestinationRow) {
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
  const segments: Array<{
    distanceMeters: number;
    durationSeconds: number;
    path: MapCoordinate[];
    paths: MapCoordinate[][];
  }> = [];

  if (firstTransit?.startX && firstTransit.startY) {
    const accessWalk = await requestOptionalOdsayWalkRoute(origin, {
      coordinate: { lat: firstTransit.startY, lng: firstTransit.startX },
      id: `${origin.id}-access-walk`,
      mode: "walk",
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
      path: lanePath,
      paths: lanePaths,
    });
  }

  if (longDistanceSubPaths.length > 0) {
    const longDistancePath = getOdsaySubPathBoundaryPath(longDistanceSubPaths);
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
      path: longDistancePath,
      paths: longDistancePath.length > 2 ? [longDistancePath] : [],
    });
  }

  if (lastTransit?.endX && lastTransit.endY) {
    const exitWalk = await requestOptionalOdsayWalkRoute(
      {
        coordinate: { lat: lastTransit.endY, lng: lastTransit.endX },
        id: `${destination.id}-exit-walk`,
        mode: "walk",
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
) {
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
async function requestOdsayBusanKtxRoute(origin: DestinationRow, destination: DestinationRow) {
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
) {
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
) {
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
async function requestNaverDriveSegmentRoute(origin: DestinationRow, destination: DestinationRow) {
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
function createNaverDriveSegmentResult(payload: RouteCheckApiResponse, responseOk = true) {
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
  let totalDistanceMeters = 0;
  let totalDurationSeconds = 0;

  for (let index = 0; index < rows.length - 1; index += 1) {
    const origin = rows[index];
    const destination = rows[index + 1];
    const segment = isAirportToTrainStationSegment(origin, destination)
      ? await requestOdsayAirportToTrainStationRoute(origin, destination)
      : isTrainStationToBusanSegment(origin, destination)
        ? await requestOdsayTrainStationToBusanRoute(origin, destination)
        : isBusanKtxSegment(origin, destination)
          ? await requestOdsayBusanKtxRoute(origin, destination)
          : origin.mode === "walk"
            ? await requestOdsayWalkRoute(origin, destination)
            : origin.mode === "transit"
              ? await requestOdsayLocalTransitRoute(origin, destination)
              : origin.mode === "drive"
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
    segments.push({
      distanceMeters: segment.distanceMeters,
      durationSeconds: segment.durationSeconds,
      mode: origin.mode,
      path: segment.path,
      paths: segment.paths,
    });
  }

  if (segments.every((segment) => !segment.paths?.length)) {
    return null;
  }

  return {
    ok: true,
    path,
    segments,
    totalDistanceMeters,
    totalDurationLabel: formatDurationFromSeconds(totalDurationSeconds),
    totalDurationSeconds,
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

  return savedMinutes > 0 ? `${formatDurationFromMinutes(savedMinutes)} 절약` : "절약 없음";
}

/**
 * Checks whether the route includes a public-transit segment.
 */
function routeUsesTransit(rows: DestinationRow[]) {
  return rows.slice(0, -1).some((row) => row.mode === "transit");
}

/**
 * Creates a stable route signature so identical comparison routes can share one provider call.
 */
function getRouteRowsSignature(rows: DestinationRow[]) {
  return JSON.stringify(
    rows.map((row) => ({
      lat: row.coordinate?.lat,
      lng: row.coordinate?.lng,
      mode: row.mode,
      name: row.name,
      placeId: row.placeId,
    })),
  );
}

/**
 * Lists destination names that cannot be sent to route providers yet.
 */
function getRowsWithoutCoordinates(rows: DestinationRow[]) {
  return rows.filter((row) => !row.coordinate).map((row) => row.name);
}

/**
 * Uses ODsay for transit routes and Naver Directions for car-only fallback.
 */
async function requestRouteCheck(rows: DestinationRow[]): Promise<RouteCheckResult> {
  const usesTransit = routeUsesTransit(rows);
  let odsayErrorMessage = "ODsay 대중교통 경로 요청에 실패했습니다.";

  const missingCoordinateRows = getRowsWithoutCoordinates(rows);

  if (missingCoordinateRows.length > 0) {
    const missingNames = missingCoordinateRows.join(", ");

    return {
      payload: {
        message: `좌표가 없는 행선지가 있습니다: ${missingNames}. 검색 결과에서 장소를 선택해 주세요.`,
        ok: false,
      },
      responseOk: false,
    };
  }

  try {
    const odsayPayload = await computeOdsayRoute(rows);

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
    body: JSON.stringify({ stops: rows }),
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

  if (!payload.path?.length || segments.length === 0) {
    return null;
  }

  const durationMinutes =
    typeof payload.totalDurationSeconds === "number"
      ? Math.max(1, Math.round(payload.totalDurationSeconds / 60))
      : undefined;

  return {
    durationLabel: payload.totalDurationLabel,
    durationMinutes,
    path: payload.path,
    routeText: rows.map((row) => row.name).join(" → "),
    segments,
    stops: createRouteStopsFromRows(rows),
    timeline: createTimelineFromRows(rows, savingLabel),
  };
}

/**
 * Applies a computed provider path to an existing route plan.
 */
function applyComputedRoute(route: RoutePlan, computedRoute?: ComputedRouteState[RoutePlanId]) {
  if (!computedRoute?.segments?.length) {
    return route;
  }

  return {
    ...route,
    durationLabel: computedRoute.durationLabel ?? route.durationLabel,
    durationMinutes: computedRoute.durationMinutes ?? route.durationMinutes,
    geoPath: computedRoute.path,
    geoSegments: computedRoute.segments,
    routeText: computedRoute.routeText,
    stops: computedRoute.stops,
  };
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
 * Returns the Korean role label for a route stop position.
 */
function getDestinationRole(index: number, total: number) {
  if (index === 0) {
    return "출발지";
  }

  if (index === total - 1) {
    return "도착지";
  }

  return "방문지";
}

/**
 * Renders the PlanME itinerary detail surface shown after the ChatGPT handoff.
 */
export function ItineraryDashboard({
  itinerary,
  compact,
}: ItineraryDashboardProps) {
  const theme = useTheme();
  const { mode, toggleMode } = usePlanmeColorMode();
  const [selectedDay, setSelectedDay] = useState(1);
  const [editableDays, setEditableDays] = useState<EditableDayPlan[]>(() =>
    createEditableDays(itinerary.days),
  );
  const [activeView, setActiveView] = useState<"compare" | "map">("compare");
  const [visibleRoutes, setVisibleRoutes] = useState<Record<RoutePlanId, boolean>>({
    standard: true,
    carryme: true,
  });
  const [copyLabel, setCopyLabel] = useState("일정 URL 복사");
  const [computedRoutes, setComputedRoutes] = useState<ComputedRouteState>({});

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
  const totalDurationLabel = `${standardRoute.durationLabel} → ${carrymeRoute.durationLabel}`;
  const savingLabel = formatSavingLabelFromMinutes(
    standardRoute.durationMinutes,
    carrymeRoute.durationMinutes,
  );

  useEffect(() => {
    let cancelled = false;
    const routes = [selectedDayPlan.standard, selectedDayPlan.carryme];

    setComputedRoutes({});

    async function computeInitialRoute(route: RoutePlan) {
      try {
        // Initial map rendering uses verified provider coordinates instead of bundled demo lines.
        const rows = createRouteRequestRows(route);
        const { payload, responseOk } = await requestRouteCheck(rows);

        if (cancelled || !responseOk || !payload.ok || !payload.path?.length) {
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
          [route.id]: result,
        }));
      } catch {
        // Keep the static demo path when the live route APIs are temporarily unavailable.
      }
    }

    routes.forEach((route) => {
      void computeInitialRoute(route);
    });

    return () => {
      cancelled = true;
    };
  }, [itinerary.savedDurationLabel, selectedDayPlan]);

  /**
   * Applies a successful Standard and CarryME recalculation as one committed state.
   */
  const handleRoutesComputed = (payload: RouteComputationPayload) => {
    setComputedRoutes(payload);
  };

  /**
   * Updates the selected itinerary day from the segmented control.
   */
  const handleDayChange = (
    _: MouseEvent<HTMLElement>,
    value: number | null,
  ) => {
    if (value) {
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

  /**
   * Copies the public itinerary URL for the demo handoff flow.
   */
  const handleCopyUrl = async () => {
    try {
      // Use the current browser origin when available so local demos copy a usable URL.
      const url =
        typeof window === "undefined"
          ? itinerary.detailUrl
          : `${window.location.origin}/itinerary/${itinerary.id}`;

      await navigator.clipboard.writeText(url);
      setCopyLabel("복사 완료");
      window.setTimeout(() => setCopyLabel("일정 URL 복사"), 1600);
    } catch {
      setCopyLabel("복사 실패");
      window.setTimeout(() => setCopyLabel("일정 URL 복사"), 1600);
    }
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
        <TopBar
          copyLabel={copyLabel}
          mode={mode}
          onCopyUrl={handleCopyUrl}
          onToggleMode={toggleMode}
        />

        <Box
          sx={{
            alignItems: { xs: "flex-start", lg: "center" },
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", lg: "1fr auto" },
          }}
        >
          <Box>
            <Typography variant="h1">{itinerary.title}</Typography>
            <Typography color="text.secondary" sx={{ fontSize: 18, mt: 1 }}>
              {itinerary.summary}
            </Typography>
          </Box>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            sx={{ width: { xs: "100%", lg: "auto" } }}
          >
            <MetricCard
              icon={<AccessTimeRoundedIcon />}
              label="총 이동 시간(예상)"
              tone="primary"
              value={totalDurationLabel}
            />
            <MetricCard
              icon={<WbSunnyRoundedIcon />}
              label="절약 시간(예상)"
              tone="error"
              value={savingLabel}
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
              sx={{ justifySelf: { xs: "stretch", md: "start" } }}
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
              sx={{ alignItems: "center", justifySelf: "center" }}
            >
              <ToggleButtonGroup
                exclusive
                color="primary"
                onChange={handleDayChange}
                value={selectedDay}
              >
                {editableDays.map((day) => (
                  <ToggleButton
                    key={day.uiId}
                    value={day.day}
                    sx={{ minWidth: 112, position: "relative", px: 2.8 }}
                  >
                    {day.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              <Button
                aria-label="일자 추가"
                onClick={handleAddDay}
                size="small"
                sx={{ minWidth: 42, px: 1 }}
                variant="outlined"
              >
                <AddRoundedIcon fontSize="small" />
              </Button>
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
              gridTemplateColumns: { xs: "1fr", md: "minmax(0, 2fr) minmax(300px, 0.95fr)" },
              p: { xs: 1.5, md: 2 },
            }}
          >
            <Stack spacing={0}>
              <Box
                sx={{
                  display: activeView === "compare" ? "grid" : "none",
                  border: "1px solid",
                  borderBottom: 0,
                  borderColor: "divider",
                  borderRadius: "8px 8px 0 0",
                  gap: 0,
                  gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                  mb: 0,
                  overflow: "hidden",
                }}
              >
                <RouteComparisonCard
                  position="left"
                  route={standardRoute}
                  tone="primary"
                />
                <RouteComparisonCard
                  position="right"
                  route={carrymeRoute}
                  savingLabel={savingLabel}
                  tone="secondary"
                />
              </Box>

              <DestinationEditor
                key={selectedDayPlan.uiId}
                initialRows={createDestinationRows(carrymeRoute)}
                mode={mode}
                onRoutesComputed={handleRoutesComputed}
                savingLabel={savingLabel}
              />

              <RouteMap
                carrymeRoute={carrymeRoute}
                showCarryme={visibleRoutes.carryme}
                showStandard={visibleRoutes.standard}
                standardRoute={standardRoute}
                attachedToComparison={activeView === "compare"}
                themeMode={mode}
              />
            </Stack>

            <TimelinePanel
              carrymeDurationLabel={carrymeRoute.durationLabel}
              carrymeEvents={computedRoutes.carryme?.timeline ?? selectedDayPlan.timeline}
              mode={mode}
              savingLabel={savingLabel}
              standardDurationLabel={standardRoute.durationLabel}
              standardEvents={computedRoutes.standard?.timeline ?? selectedDayPlan.timeline}
            />
          </Box>

        </Box>

        <BenefitStrip benefits={itinerary.benefits} />

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

type TopBarProps = {
  copyLabel: string;
  mode: "light" | "dark";
  onCopyUrl: () => void;
  onToggleMode: () => void;
};

/**
 * Renders the compact PlanME header controls.
 */
function TopBar({ copyLabel, mode, onCopyUrl, onToggleMode }: TopBarProps) {
  return (
    <Stack
      direction="row"
      sx={{
        alignItems: "center",
        gap: 2,
        justifyContent: "space-between",
      }}
    >
      <Stack direction="row" spacing={1.4} sx={{ alignItems: "center" }}>
        <RouteRoundedIcon color="primary" sx={{ fontSize: 38 }} />
        <Typography color="primary" sx={{ fontSize: 28, fontWeight: 900 }}>
          PlanME
        </Typography>
        <Typography color="text.secondary" sx={{ fontWeight: 700 }}>
          by GuideME
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Button onClick={onToggleMode} size="small" variant="outlined">
          테마 버전
          <Typography component="span" sx={{ ml: 0.8, fontSize: 12 }}>
            {mode === "dark" ? "Dark" : "Light"}
          </Typography>
        </Button>
        <Button
          color="inherit"
          size="small"
          startIcon={<HelpOutlineRoundedIcon />}
          variant="text"
        >
          이용 방법
        </Button>
        <Button
          onClick={onCopyUrl}
          startIcon={<ContentCopyRoundedIcon />}
          variant="contained"
        >
          {copyLabel}
        </Button>
      </Stack>
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
  savingLabel?: string;
  tone: "primary" | "secondary";
};

/**
 * Renders one Standard or CarryME route comparison summary.
 */
function RouteComparisonCard({
  position,
  route,
  savingLabel,
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
            {route.description}
          </Typography>
        </Box>

        <Box
          sx={{
            display: "grid",
            gap: 1,
            gridTemplateColumns: "1fr auto 1fr auto 1fr",
            mb: 0.2,
          }}
        >
          {route.stops.map((stop, index) => (
            <RouteStopCell
              key={`${route.id}-${stop.label}`}
              showArrow={index < route.stops.length - 1}
              stop={stop}
            />
          ))}
        </Box>

        <Stack
          direction="row"
          sx={{
            alignItems: "center",
            bgcolor: tone === "secondary" ? "rgba(34, 197, 94, 0.1)" : "rgba(37, 99, 235, 0.08)",
            borderRadius: 1.2,
            gap: 1,
            justifyContent: "center",
            minHeight: 46,
            px: 1.5,
            py: 1.05,
          }}
        >
          <AccessTimeRoundedIcon color={tone} fontSize="small" />
          <Typography
            color={tone}
            sx={{ fontSize: 13, fontWeight: 800, whiteSpace: "nowrap" }}
          >
            총 이동 시간(예상)
          </Typography>
          <Typography color={tone} sx={{ fontWeight: 900, whiteSpace: "nowrap" }}>
            {route.durationLabel}
          </Typography>
          {savingLabel ? (
            <Chip color="error" label={savingLabel} size="small" />
          ) : null}
        </Stack>
      </Stack>
    </Box>
  );
}

type DestinationEditorProps = {
  initialRows: DestinationRow[];
  mode: "light" | "dark";
  onRoutesComputed: (payload: RouteComputationPayload) => void;
  savingLabel: string;
};

/**
 * Renders the local destination editor prototype between the comparison cards and map.
 */
function DestinationEditor({
  initialRows,
  mode,
  onRoutesComputed,
  savingLabel,
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
  const [sessionToken] = useState(
    () => `planme-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
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
        // Ask the server route for autocomplete so the browser does not own API contracts.
        const response = await fetch("/api/places/autocomplete", {
          body: JSON.stringify({
            input: activeRow.name,
            sessionToken,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        const payload = (await response.json()) as PlacesAutocompleteApiResponse;

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
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [activeRow, sessionToken]);

  /**
   * Adds a waypoint before the final destination so start and end stay visually stable.
   */
  const handleAddWaypoint = () => {
    const newRow: DestinationRow = {
      id: `destination-local-${Date.now()}`,
      mode: "transit",
      name: "새 행선지",
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
          ? { ...row, coordinate: undefined, name: nextName, placeId: undefined }
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
   * Updates the local transport mode for the segment after a destination row.
   */
  const handleDestinationModeChange = (
    rowId: string,
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const nextMode = event.target.value as DestinationMode;

    // Store the selected segment mode locally until the route recalculation runs.
    setRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, mode: nextMode } : row)),
    );
    setRouteStatus("idle");
    setRouteMessage(null);
  };

  /**
   * Resolves an autocomplete result into a coordinate and stores it in the row.
   */
  const handleSelectCandidate = async (
    rowId: string,
    candidate: DestinationCandidate,
  ) => {
    setSuggestionStatus("loading");
    setSuggestionMessage(null);

    try {
      // Details lookup finalizes the coordinate used by route checks.
      const response = await fetch("/api/places/details", {
        body: JSON.stringify({
          placeId: candidate.placeId,
          sessionToken,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as PlaceDetailsApiResponse;

      if (!response.ok || !payload.place) {
        setSuggestionStatus("error");
        setSuggestionMessage(payload.message ?? "장소 좌표를 확인하지 못했습니다.");
        return;
      }

      setRows((current) =>
        current.map((row) =>
          row.id === rowId
            ? {
                ...row,
                coordinate: payload.place?.coordinate,
                name: payload.place?.text ?? candidate.mainText,
                placeId: payload.place?.placeId,
              }
            : row,
        ),
      );
      setActiveRowId(null);
      setSuggestions([]);
      setSuggestionStatus("idle");
      setRouteStatus("idle");
      setRouteMessage(null);
    } catch {
      setSuggestionStatus("error");
      setSuggestionMessage("장소 상세 조회 요청을 완료하지 못했습니다.");
    }
  };

  /**
   * Checks the current destination order and travel modes through route APIs.
   */
  const handleCheckRoute = async () => {
    setRouteStatus("loading");
    setRouteMessage("경로를 확인하는 중입니다.");

    try {
      const requestRowsByRoute: Record<RoutePlanId, DestinationRow[]> = {
        carryme: rows,
        standard: rows,
      };
      const hasSameComparisonRoute =
        getRouteRowsSignature(requestRowsByRoute.standard) ===
        getRouteRowsSignature(requestRowsByRoute.carryme);

      let standardResultPayload: RouteCheckResult;
      let carrymeResultPayload: RouteCheckResult;

      if (hasSameComparisonRoute) {
        // Identical comparison routes share one provider calculation to avoid duplicate quota usage.
        standardResultPayload = await requestRouteCheck(requestRowsByRoute.standard);
        carrymeResultPayload = standardResultPayload;
      } else {
        // Run route checks sequentially so ODsay is not hit twice at the same moment.
        standardResultPayload = await requestRouteCheck(requestRowsByRoute.standard);
        carrymeResultPayload = await requestRouteCheck(requestRowsByRoute.carryme);
      }

      const standardPayload = standardResultPayload.payload;
      const carrymePayload = carrymeResultPayload.payload;

      if (!standardResultPayload.responseOk || !standardPayload.ok) {
        setRouteStatus("error");
        setRouteMessage(standardPayload.message ?? "Standard 경로 체크에 실패했습니다.");
        return;
      }

      if (!carrymeResultPayload.responseOk || !carrymePayload.ok) {
        setRouteStatus("error");
        setRouteMessage(carrymePayload.message ?? "CarryME 경로 체크에 실패했습니다.");
        return;
      }

      const standardResult = createComputedRouteResult(
        requestRowsByRoute.standard,
        standardPayload,
        savingLabel,
      );
      const carrymeResult = createComputedRouteResult(
        requestRowsByRoute.carryme,
        carrymePayload,
        savingLabel,
      );

      if (!standardResult || !carrymeResult) {
        setRouteStatus("error");
        setRouteMessage("경로 표시 좌표를 확인하지 못했습니다.");
        return;
      }

      onRoutesComputed({
        carryme: carrymeResult,
        standard: standardResult,
      });

      const responseDistanceMeters =
        carrymePayload.totalDistanceMeters ?? standardPayload.totalDistanceMeters;
      const responseDurationLabel =
        carrymePayload.totalDurationLabel ?? standardPayload.totalDurationLabel;
      const hasWarnings =
        Boolean(standardPayload.warnings?.length) || Boolean(carrymePayload.warnings?.length);

      const distanceKm =
        typeof responseDistanceMeters === "number"
          ? ` · 약 ${(responseDistanceMeters / 1000).toFixed(1)}km`
          : "";

      setRouteStatus("success");
      setRouteMessage(
        `경로 체크 완료 · ${responseDurationLabel ?? "시간 확인 완료"}${distanceKm}${
          hasWarnings ? " · 일부 구간 확인 필요" : ""
        }`,
      );
    } catch {
      setRouteStatus("error");
      setRouteMessage("경로 체크 요청을 완료하지 못했습니다.");
    }
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
              md: "28px 32px minmax(0, 1fr) 92px 136px",
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
              gridColumn: { xs: "1", md: "1 / 4" },
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
              gridColumn: { xs: "1", md: "4 / 6" },
              justifyContent: "flex-end",
            }}
          >
            <Button
              onClick={handleAddWaypoint}
              size="small"
              startIcon={<AddRoundedIcon />}
              sx={{ minHeight: 34 }}
              variant="outlined"
            >
              경유지 추가
            </Button>
            <Button
              disabled={routeStatus === "loading" || rows.length < 2}
              onClick={handleCheckRoute}
              size="small"
              startIcon={<RouteRoundedIcon />}
              sx={{ minHeight: 34 }}
              variant="contained"
            >
              {routeStatus === "loading" ? "계산 중" : "경로 다시 계산"}
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
                      aria-label={`${getDestinationRole(index, rows.length)} 행선지`}
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
                      {getDestinationRole(index, rows.length)}
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
                                key={candidate.placeId}
                                component="button"
                                data-testid="destination-suggestion-option"
                                draggable={false}
                                onPointerDown={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  void handleSelectCandidate(row.id, candidate);
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
                                  {candidate.mainText || candidate.text}
                                </Typography>
                                {candidate.secondaryText ? (
                                  <Typography
                                    color="text.secondary"
                                    sx={{ fontSize: 12, mt: 0.2 }}
                                  >
                                    {candidate.secondaryText}
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
                      <TextField
                        data-testid="destination-segment-mode"
                        select
                        hiddenLabel
                        onChange={(event) => handleDestinationModeChange(row.id, event)}
                        size="small"
                        value={row.mode}
                        sx={{
                          "& .MuiInputBase-root": {
                            bgcolor: "background.paper",
                            borderRadius: 1,
                            fontSize: 13,
                            height: 34,
                            width: { xs: "100%", sm: 136 },
                          },
                          "& .MuiSelect-select": {
                            alignItems: "center",
                            display: "flex",
                            justifyContent: "center",
                            minWidth: 96,
                            py: 0,
                            textAlign: "center",
                            whiteSpace: "nowrap",
                          },
                          "& .MuiSelect-select .MuiStack-root": {
                            justifyContent: "center",
                            width: "100%",
                          },
                        }}
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

type RouteStopCellProps = {
  showArrow: boolean;
  stop: RouteStop;
};

/**
 * Renders one stop in a compact route summary.
 */
function RouteStopCell({ showArrow, stop }: RouteStopCellProps) {
  return (
    <>
      <Stack spacing={0.7} sx={{ alignItems: "center", minWidth: 0 }}>
        <Box
          sx={{
            alignItems: "center",
            bgcolor: "action.hover",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: "999px",
            color: "text.primary",
            display: "flex",
            height: 48,
            justifyContent: "center",
            width: 48,
          }}
        >
          {stopIcons[stop.icon]}
        </Box>
        <Typography
          sx={{
            fontSize: 13,
            fontWeight: 800,
            textAlign: "center",
            whiteSpace: { md: "nowrap" },
          }}
        >
          {stop.label}
        </Typography>
        <Typography
          color="text.secondary"
          sx={{
            fontSize: 12,
            textAlign: "center",
            whiteSpace: { md: "nowrap" },
          }}
        >
          {stop.caption}
        </Typography>
      </Stack>
      {showArrow ? (
        <Typography
          color="text.secondary"
          sx={{ alignSelf: "center", fontSize: 28, fontWeight: 500 }}
        >
          →
        </Typography>
      ) : null}
    </>
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
