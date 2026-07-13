import type { MapCoordinate, RouteTransitMarker } from "@planme/core";
import { removeAdjacentDuplicateProviderStops } from "./shared";
import {
  RouteProviderError,
  type RouteProviderResult,
  type RouteProviderSegment,
  type RouteProviderStop,
  withRouteProviderSegmentContext,
} from "./types";

type OdsayError = {
  code?: string;
  message?: string;
};

type OdsayResponseWithError = {
  error?: OdsayError | OdsayError[];
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

type OdsayTransitPathResponse = OdsayResponseWithError & {
  result?: {
    path?: Array<{
      info?: {
        mapObj?: string;
        totalDistance?: number;
        totalTime?: number;
      };
      subPath?: OdsayTransitSubPath[];
    }>;
  };
};

type OdsayLoadLaneResponse = OdsayResponseWithError & {
  result?: {
    lane?: Array<{
      section?: Array<{
        graphPos?: Array<{
          x?: number;
          y?: number;
        }>;
      }>;
    }>;
  };
};

const ODSAY_API_ORIGIN = "https://api.odsay.com";
const DEFAULT_ODSAY_REFERER = "https://planme-demo.vercel.app/";
// The Basic key is sensitive to bursts; serialize starts within one finalization invocation.
const ODSAY_MINIMUM_REQUEST_INTERVAL_MS = 260;
// ODsay does not return public-transit routes when endpoints are within this direct distance.
const ODSAY_MINIMUM_TRANSIT_DISTANCE_METERS = 700;
const ESTIMATED_WALKING_SPEED_METERS_PER_SECOND = 4_000 / 3_600;
let lastOdsayRequestStartedAt = 0;
let odsayRequestQueue: Promise<void> = Promise.resolve();

/** Computes a public-transit route with ODsay and retries one transient failed leg once. */
export async function computeOdsayTransitRoute(
  inputStops: RouteProviderStop[],
  signal: AbortSignal,
): Promise<RouteProviderResult> {
  const stops = removeAdjacentDuplicateProviderStops(inputStops);

  if (!getOdsayApiKey()) {
    throw new RouteProviderError(
      "ODSAY_CONFIGURATION_MISSING",
      "ODsay 대중교통 경로 계산 설정이 없습니다.",
      false,
    );
  }

  if (stops.length < 2 || stops.some((stop) => !stop.coordinate)) {
    throw new RouteProviderError(
      "INVALID_ODSAY_STOPS",
      "ODsay 대중교통 경로 계산에는 좌표가 있는 행선지 2개 이상이 필요합니다.",
      false,
    );
  }

  const segments: RouteProviderSegment[] = [];

  for (let index = 0; index < stops.length - 1; index += 1) {
    const directDistanceMeters = calculateDirectDistanceMeters(
      stops[index].coordinate!,
      stops[index + 1].coordinate!,
    );

    if (directDistanceMeters <= ODSAY_MINIMUM_TRANSIT_DISTANCE_METERS) {
      segments.push(createShortTransitSegment(directDistanceMeters));
      continue;
    }

    // Keep traveler order stable and retry only the failed origin-destination leg.
    segments.push(
      await requestTransitSegmentWithRetry(stops[index], stops[index + 1], index, signal),
    );
  }

  const transitMarkers = segments.flatMap((segment) => segment.transitMarkers ?? []);

  return {
    geometryStatus: segments.some((segment) => segment.geometryStatus === "partial")
      ? "partial"
      : "complete",
    segments,
    totalDistanceMeters: segments.reduce((sum, segment) => sum + segment.distanceMeters, 0),
    totalDurationSeconds: segments.reduce((sum, segment) => sum + segment.durationSeconds, 0),
    transitMarkers,
  };
}

/** Completes a nearby leg without asking ODsay for a public-transit route it cannot return. */
function createShortTransitSegment(directDistanceMeters: number): RouteProviderSegment {
  const distanceMeters = Math.round(directDistanceMeters);

  return {
    distanceMeters,
    durationSeconds: Math.max(
      60,
      Math.round(distanceMeters / ESTIMATED_WALKING_SPEED_METERS_PER_SECOND),
    ),
    geometryStatus: "partial",
    mode: "transit",
    paths: [],
  };
}

/** Calculates the WGS84 endpoint distance used by ODsay's 700 m transit boundary. */
function calculateDirectDistanceMeters(origin: MapCoordinate, destination: MapCoordinate) {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const originLatitude = toRadians(origin.lat);
  const destinationLatitude = toRadians(destination.lat);
  const latitudeDelta = toRadians(destination.lat - origin.lat);
  const longitudeDelta = toRadians(destination.lng - origin.lng);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(destinationLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

/** Retries one transient ODsay leg exactly once within the shared deadline. */
async function requestTransitSegmentWithRetry(
  origin: RouteProviderStop,
  destination: RouteProviderStop,
  segmentIndex: number,
  signal: AbortSignal,
) {
  try {
    return await requestTransitSegment(origin, destination, segmentIndex, signal);
  } catch (error) {
    if (!(error instanceof RouteProviderError) || signal.aborted) {
      throw error;
    }

    if (!error.retriable) {
      throw withRouteProviderSegmentContext(error, origin, destination, segmentIndex);
    }

    // One short backoff prevents an immediate repeat of a provider burst response.
    await waitWithinSignal(400, signal);
    try {
      return await requestTransitSegment(origin, destination, segmentIndex, signal);
    } catch (retryError) {
      if (retryError instanceof RouteProviderError) {
        // Preserve that the provider failure was observed after the single allowed retry.
        throw withRouteProviderSegmentContext(
          retryError,
          origin,
          destination,
          segmentIndex,
          true,
        );
      }

      throw retryError;
    }
  }
}

/** Requests one origin-destination transit result and stores totalTime exactly once. */
async function requestTransitSegment(
  origin: RouteProviderStop,
  destination: RouteProviderStop,
  segmentIndex: number,
  signal: AbortSignal,
): Promise<RouteProviderSegment> {
  const data = await requestOdsay<OdsayTransitPathResponse>(
    "searchPubTransPathT",
    {
      EX: String(destination.coordinate?.lng),
      EY: String(destination.coordinate?.lat),
      SearchType: "0",
      SX: String(origin.coordinate?.lng),
      SY: String(origin.coordinate?.lat),
    },
    signal,
  );
  const firstPath = data.result?.path?.[0];
  const totalTimeMinutes = firstPath?.info?.totalTime;

  if (!Number.isFinite(totalTimeMinutes) || Number(totalTimeMinutes) <= 0) {
    throw new RouteProviderError(
      "ODSAY_ROUTE_MISSING",
      "ODsay 대중교통 경로에서 이동 시간을 찾지 못했습니다.",
      false,
    );
  }

  const paths = firstPath?.info?.mapObj
    ? await requestLanePaths(firstPath.info.mapObj, signal)
    : [];
  const longDistanceSubPaths = (firstPath?.subPath ?? []).filter(isLongDistanceSubPath);
  const transitMarkers =
    paths.length === 0
      ? createTransitMarkers(firstPath?.subPath ?? [], segmentIndex)
      : createTransitMarkers(longDistanceSubPaths, segmentIndex);

  return {
    distanceMeters: firstPath?.info?.totalDistance ?? 0,
    durationSeconds: Math.round(Number(totalTimeMinutes) * 60),
    geometryStatus: paths.length > 0 && longDistanceSubPaths.length === 0 ? "complete" : "partial",
    mode: "transit",
    paths,
    transitMarkers,
  };
}

/** Loads drawable bus and subway lane geometry for one ODsay map object. */
async function requestLanePaths(mapObject: string, signal: AbortSignal) {
  const data = await requestOdsay<OdsayLoadLaneResponse>(
    "loadLane",
    { mapObject: `0:0@${mapObject}` },
    signal,
  );

  return (
    data.result?.lane
      ?.flatMap((lane) => lane.section ?? [])
      .map((section) =>
        (section.graphPos ?? [])
          .map((coordinate): MapCoordinate | null => {
            if (!Number.isFinite(coordinate.x) || !Number.isFinite(coordinate.y)) {
              return null;
            }

            return { lat: Number(coordinate.y), lng: Number(coordinate.x) };
          })
          .filter((coordinate): coordinate is MapCoordinate => coordinate !== null),
      )
      .filter((path) => path.length > 2) ?? []
  );
}

/** Calls ODsay with the URI-scoped key and the registered production Referer. */
async function requestOdsay<T extends OdsayResponseWithError>(
  path: string,
  params: Record<string, string>,
  signal: AbortSignal,
): Promise<T> {
  await waitForOdsayRequestSlot(signal);
  const url = new URL(`/v1/api/${path}`, ODSAY_API_ORIGIN);

  Object.entries({ ...params, apiKey: getOdsayApiKey() }).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        Referer: DEFAULT_ODSAY_REFERER,
      },
      signal,
    });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    throw new RouteProviderError(
      "ODSAY_NETWORK_ERROR",
      "ODsay 대중교통 경로 요청에 실패했습니다.",
      true,
    );
  }

  if (!response.ok) {
    throw new RouteProviderError(
      `ODSAY_HTTP_${response.status}`,
      `ODsay 대중교통 경로 요청 실패(${response.status})`,
      response.status === 408 || response.status === 429 || response.status >= 500,
    );
  }

  const data = (await response.json()) as T;
  const error = getOdsayError(data);

  if (error) {
    const code = String(error.code ?? "ODSAY_ERROR");
    const message = error.message ?? "ODsay 대중교통 경로 요청에 실패했습니다.";
    const isAuthenticationError = message.includes("ApiKeyAuthFailed");

    throw new RouteProviderError(
      code,
      message,
      !isAuthenticationError && (code === "429" || code === "500"),
    );
  }

  return data;
}

/** Returns the existing browser key for server-side URI authentication. */
function getOdsayApiKey() {
  return process.env.NEXT_PUBLIC_ODSAY_API_KEY?.trim() ?? "";
}

/** Serializes ODsay request starts to reduce Basic-plan burst failures. */
async function waitForOdsayRequestSlot(signal: AbortSignal) {
  const previousRequest = odsayRequestQueue;
  let releaseCurrentRequest = () => {};

  odsayRequestQueue = new Promise<void>((resolve) => {
    releaseCurrentRequest = resolve;
  });

  await previousRequest;

  try {
    const remainingDelay = ODSAY_MINIMUM_REQUEST_INTERVAL_MS -
      (Date.now() - lastOdsayRequestStartedAt);

    if (remainingDelay > 0) {
      await waitWithinSignal(remainingDelay, signal);
    }

    lastOdsayRequestStartedAt = Date.now();
  } finally {
    releaseCurrentRequest();
  }
}

/** Waits for a provider backoff while honoring the global finalization signal. */
function waitWithinSignal(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("Route calculation aborted"));
      return;
    }

    const handleAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason instanceof Error ? signal.reason : new Error("Route calculation aborted"));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);

    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

/** Normalizes ODsay's object-or-array error contract. */
function getOdsayError(data: OdsayResponseWithError) {
  return Array.isArray(data.error) ? data.error[0] : data.error;
}

/** Identifies long-distance rail, bus, and air segments in ODsay responses. */
function isLongDistanceSubPath(subPath: OdsayTransitSubPath) {
  return [4, 5, 6, 7].includes(subPath.trafficType ?? 0);
}

/** Creates only provider-backed boarding and alighting markers for missing route geometry. */
function createTransitMarkers(
  subPaths: OdsayTransitSubPath[],
  segmentIndex: number,
): RouteTransitMarker[] {
  const first = subPaths.find(
    (subPath) => Number.isFinite(subPath.startX) && Number.isFinite(subPath.startY),
  );
  const last = [...subPaths]
    .reverse()
    .find((subPath) => Number.isFinite(subPath.endX) && Number.isFinite(subPath.endY));
  const markers: RouteTransitMarker[] = [];

  if (first && Number.isFinite(first.startX) && Number.isFinite(first.startY)) {
    markers.push({
      coordinate: { lat: Number(first.startY), lng: Number(first.startX) },
      id: `transit-${segmentIndex}-boarding`,
      label: `탑승: ${first.startName?.trim() || "대중교통 탑승"}`,
      mode: getTransitMarkerMode(first.trafficType),
      role: "boarding",
      segmentIndex,
    });
  }

  if (last && Number.isFinite(last.endX) && Number.isFinite(last.endY)) {
    markers.push({
      coordinate: { lat: Number(last.endY), lng: Number(last.endX) },
      id: `transit-${segmentIndex}-alighting`,
      label: `하차: ${last.endName?.trim() || "대중교통 하차"}`,
      mode: getTransitMarkerMode(last.trafficType),
      role: "alighting",
      segmentIndex,
    });
  }

  return markers;
}

/** Maps ODsay traffic types to the existing map-marker vocabulary. */
function getTransitMarkerMode(trafficType?: number): RouteTransitMarker["mode"] {
  if (trafficType === 1) {
    return "subway";
  }

  if (trafficType === 4) {
    return "train";
  }

  if (trafficType === 2 || trafficType === 5 || trafficType === 6) {
    return "bus";
  }

  return "transit";
}
