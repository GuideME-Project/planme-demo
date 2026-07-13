import type { MapCoordinate } from "@planme/core";
import { appendCoordinate, removeAdjacentDuplicateProviderStops } from "./shared";
import {
  RouteProviderError,
  type RouteProviderResult,
  type RouteProviderSegment,
  type RouteProviderStop,
  withRouteProviderSegmentContext,
} from "./types";

type NaverDirectionsResult = {
  path?: Array<[number, number]>;
  summary?: {
    distance?: number;
    duration?: number;
  };
};

type NaverDirectionsResponse = {
  route?: {
    trafast?: NaverDirectionsResult[];
  };
};

type NaverErrorResponse = {
  error?: {
    message?: string;
  };
  message?: string;
};

/** Computes a complete car route with Naver Directions and retries transient failed legs once. */
export async function computeNaverDirectionsRoute(
  inputStops: RouteProviderStop[],
  signal: AbortSignal,
): Promise<RouteProviderResult> {
  const stops = removeAdjacentDuplicateProviderStops(inputStops);
  const keyId = getNaverMapsKeyId();
  const keySecret = getNaverMapsSecret();

  if (!keyId || !keySecret) {
    throw new RouteProviderError(
      "NAVER_CONFIGURATION_MISSING",
      "네이버 자동차 경로 계산 설정이 없습니다.",
      false,
    );
  }

  if (stops.length < 2 || stops.some((stop) => !stop.coordinate)) {
    throw new RouteProviderError(
      "INVALID_NAVER_STOPS",
      "네이버 자동차 경로 계산에는 좌표가 있는 행선지 2개 이상이 필요합니다.",
      false,
    );
  }

  const segments: RouteProviderSegment[] = [];

  for (let index = 0; index < stops.length - 1; index += 1) {
    // A route keeps provider legs sequential while only a failed transient leg is retried.
    segments.push(
      await requestNaverSegmentWithRetry(
        stops[index],
        stops[index + 1],
        index,
        keyId,
        keySecret,
        signal,
      ),
    );
  }

  return {
    geometryStatus: "complete",
    segments,
    totalDistanceMeters: segments.reduce((sum, segment) => sum + segment.distanceMeters, 0),
    totalDurationSeconds: segments.reduce((sum, segment) => sum + segment.durationSeconds, 0),
    transitMarkers: [],
  };
}

/** Returns the Naver Maps REST client id without exposing it to the browser. */
function getNaverMapsKeyId() {
  return (
    process.env.NAVER_MAPS_CLIENT_ID ??
    process.env.NCP_MAPS_CLIENT_ID ??
    process.env.NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID ??
    ""
  );
}

/** Returns the Naver Maps REST secret used only by the server runtime. */
function getNaverMapsSecret() {
  return process.env.NAVER_MAPS_CLIENT_SECRET ?? process.env.NCP_MAPS_CLIENT_SECRET ?? "";
}

/** Retries one transient Naver leg once within the caller's shared deadline signal. */
async function requestNaverSegmentWithRetry(
  origin: RouteProviderStop,
  destination: RouteProviderStop,
  segmentIndex: number,
  keyId: string,
  keySecret: string,
  signal: AbortSignal,
) {
  try {
    return await requestNaverSegment(origin, destination, keyId, keySecret, signal);
  } catch (error) {
    if (!(error instanceof RouteProviderError) || signal.aborted) {
      throw error;
    }

    if (!error.retriable) {
      throw withRouteProviderSegmentContext(error, origin, destination, segmentIndex);
    }

    // Retry only the failed provider leg so successful legs are never requested twice.
    try {
      return await requestNaverSegment(origin, destination, keyId, keySecret, signal);
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

/** Requests and normalizes one Naver Directions car leg. */
async function requestNaverSegment(
  origin: RouteProviderStop,
  destination: RouteProviderStop,
  keyId: string,
  keySecret: string,
  signal: AbortSignal,
): Promise<RouteProviderSegment> {
  const params = new URLSearchParams({
    goal: `${destination.coordinate?.lng},${destination.coordinate?.lat}`,
    option: "trafast",
    start: `${origin.coordinate?.lng},${origin.coordinate?.lat}`,
  });
  let response: Response;

  try {
    response = await fetch(
      `https://maps.apigw.ntruss.com/map-direction/v1/driving?${params.toString()}`,
      {
        headers: {
          "x-ncp-apigw-api-key": keySecret,
          "x-ncp-apigw-api-key-id": keyId,
        },
        signal,
      },
    );
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    throw new RouteProviderError(
      "NAVER_NETWORK_ERROR",
      "네이버 자동차 경로 요청에 실패했습니다.",
      true,
    );
  }

  if (!response.ok) {
    throw new RouteProviderError(
      `NAVER_HTTP_${response.status}`,
      await readNaverErrorMessage(response),
      response.status === 408 || response.status === 429 || response.status >= 500,
    );
  }

  const data = (await response.json()) as NaverDirectionsResponse;
  const route = data.route?.trafast?.[0];
  const path: MapCoordinate[] = [];

  for (const tuple of route?.path ?? []) {
    const coordinate = toCoordinate(tuple);

    if (coordinate) {
      appendCoordinate(path, coordinate);
    }
  }

  if (path.length < 3) {
    throw new RouteProviderError(
      "NAVER_GEOMETRY_MISSING",
      "네이버 자동차 경로에서 지도 형상을 찾지 못했습니다.",
      false,
    );
  }

  return {
    distanceMeters: route?.summary?.distance ?? 0,
    durationSource: "provider",
    durationSeconds: Math.max(1, Math.round((route?.summary?.duration ?? 0) / 1000)),
    geometryStatus: "complete",
    mode: "drive",
    paths: [path],
  };
}

/** Reads a provider error without assuming that the body is valid JSON. */
async function readNaverErrorMessage(response: Response) {
  const text = await response.text();

  try {
    const body = JSON.parse(text) as NaverErrorResponse;

    return body.error?.message ?? body.message ?? `네이버 자동차 경로 요청 실패(${response.status})`;
  } catch {
    return `네이버 자동차 경로 요청 실패(${response.status})`;
  }
}

/** Converts Naver longitude/latitude tuples to PlanME coordinates. */
function toCoordinate(tuple: [number, number]): MapCoordinate | null {
  const [lng, lat] = tuple;

  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}
