import { NextResponse } from "next/server";
import type { MapCoordinate } from "@planme/core";
import { computeNaverDirectionsRoute } from "@/lib/route-providers/naver-directions";
import { appendCoordinate, formatRouteDuration } from "@/lib/route-providers/shared";
import { RouteProviderError, type RouteProviderStop } from "@/lib/route-providers/types";

type NaverRouteStop = {
  coordinate?: MapCoordinate;
  id: string;
  mode: string;
  name: string;
  placeId?: string;
  placeSourceRef?: string;
};

type NaverRouteRequestBody = {
  stops?: NaverRouteStop[];
};

type NaverRouteApiResponse = {
  cachedAt?: number;
  geometryStatus?: "complete" | "partial";
  message?: string;
  ok: boolean;
  path?: MapCoordinate[];
  segments?: Array<{
    distanceMeters: number;
    durationSeconds: number;
    geometryStatus: "complete" | "partial";
    mode: "drive";
    path: MapCoordinate[];
    paths: MapCoordinate[][];
  }>;
  totalDistanceMeters?: number;
  totalDurationLabel?: string;
  totalDurationSeconds?: number;
};

const routeCache = new Map<string, NaverRouteApiResponse>();
// Editing can repeat an identical calculation; retain successful normalized results for 10 minutes.
const ROUTE_CACHE_TTL_MS = 10 * 60 * 1000;

/** Computes a car-only route using the same server provider module as final itinerary storage. */
export async function POST(request: Request) {
  const body = (await request.json()) as NaverRouteRequestBody;
  const inputStops = body.stops ?? [];

  if (inputStops.slice(0, -1).some((stop) => stop.mode !== "drive")) {
    return NextResponse.json(
      {
        message:
          "Naver Directions 자동차 경로 API는 자동차 구간만 처리합니다. 대중교통은 ODsay 경로를 사용합니다.",
        ok: false,
      },
      { status: 400 },
    );
  }

  const cacheKey = JSON.stringify(inputStops);
  const cached = routeCache.get(cacheKey);

  if (cached?.cachedAt && Date.now() - cached.cachedAt < ROUTE_CACHE_TTL_MS) {
    return NextResponse.json(cached);
  }

  try {
    const result = await computeNaverDirectionsRoute(
      inputStops.map(toProviderStop),
      request.signal,
    );
    const path: MapCoordinate[] = [];

    result.segments.forEach((segment) => {
      segment.paths.forEach((segmentPath) => {
        segmentPath.forEach((coordinate) => appendCoordinate(path, coordinate));
      });
    });

    const payload: NaverRouteApiResponse = {
      cachedAt: Date.now(),
      geometryStatus: result.geometryStatus,
      ok: true,
      path,
      segments: result.segments.map((segment) => ({
        distanceMeters: segment.distanceMeters,
        durationSeconds: segment.durationSeconds,
        geometryStatus: segment.geometryStatus,
        mode: "drive" as const,
        path: segment.paths[0] ?? [],
        paths: segment.paths,
      })),
      totalDistanceMeters: result.totalDistanceMeters,
      totalDurationLabel: formatRouteDuration(result.totalDurationSeconds),
      totalDurationSeconds: result.totalDurationSeconds,
    };

    routeCache.set(cacheKey, payload);
    return NextResponse.json(payload);
  } catch (error) {
    const safeError = error instanceof Error ? error : new Error("자동차 경로 계산 실패");
    const status = getProviderErrorStatus(safeError);

    return NextResponse.json(
      {
        message:
          safeError.message || "Naver Directions 자동차 경로 계산에 실패했습니다.",
        ok: false,
      },
      { status },
    );
  }
}

/** Converts the browser editing contract into the shared provider stop contract. */
function toProviderStop(stop: NaverRouteStop): RouteProviderStop {
  return {
    coordinate: stop.coordinate,
    id: stop.id,
    label: stop.name,
    placeId: stop.placeId,
    placeSourceRef: stop.placeSourceRef,
  };
}

/** Maps stable provider failures to the legacy route API status contract. */
function getProviderErrorStatus(error: Error | RouteProviderError) {
  if (!(error instanceof RouteProviderError)) {
    return 502;
  }

  if (error.code === "NAVER_CONFIGURATION_MISSING") {
    return 503;
  }

  return error.code === "INVALID_NAVER_STOPS" ? 400 : 502;
}
