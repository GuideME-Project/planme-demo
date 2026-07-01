import { NextResponse } from "next/server";

type NaverRouteMode = "drive" | "transit" | "walk";

type NaverRouteStop = {
  coordinate?: {
    lat: number;
    lng: number;
  };
  id: string;
  mode: NaverRouteMode;
  name: string;
};

type NaverRouteRequestBody = {
  stops?: NaverRouteStop[];
};

type MapCoordinate = {
  lat: number;
  lng: number;
};

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

type NaverRouteApiResponse = {
  message?: string;
  ok: boolean;
  path?: MapCoordinate[];
  segments?: Array<{
    distanceMeters: number;
    durationSeconds: number;
    mode: NaverRouteMode;
    path: MapCoordinate[];
    paths: MapCoordinate[][];
  }>;
  totalDistanceMeters?: number;
  totalDurationLabel?: string;
  totalDurationSeconds?: number;
};

type CachedRoute = NaverRouteApiResponse & {
  cachedAt: number;
};

const routeCache = new Map<string, CachedRoute>();
// Route recalculation can be repeated during editing; keep successful responses briefly.
const routeCacheTtlMs = 10 * 60 * 1000;

/**
 * Returns the key id used by Naver Maps REST APIs.
 */
function getNaverMapsKeyId() {
  return (
    process.env.NAVER_MAPS_CLIENT_ID ??
    process.env.NCP_MAPS_CLIENT_ID ??
    process.env.NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID ??
    ""
  );
}

/**
 * Returns the secret key used by Naver Maps REST APIs.
 */
function getNaverMapsSecret() {
  return process.env.NAVER_MAPS_CLIENT_SECRET ?? process.env.NCP_MAPS_CLIENT_SECRET ?? "";
}

/**
 * Formats route duration seconds into a compact Korean label.
 */
function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours <= 0) {
    return `약 ${remainingMinutes}분`;
  }

  return remainingMinutes === 0 ? `약 ${hours}시간` : `약 ${hours}시간 ${remainingMinutes}분`;
}

/**
 * Converts Naver Directions coordinate tuples from lng/lat into the map coordinate shape.
 */
function toCoordinate(tuple: [number, number]): MapCoordinate | null {
  const [lng, lat] = tuple;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
}

/**
 * Avoids duplicate adjacent coordinates before drawing a polyline.
 */
function appendCoordinate(path: MapCoordinate[], coordinate: MapCoordinate) {
  const previous = path[path.length - 1];

  // Naver Directions can repeat boundary points when several segments are joined.
  if (previous && previous.lat === coordinate.lat && previous.lng === coordinate.lng) {
    return;
  }

  path.push(coordinate);
}

/**
 * Checks whether the incoming route asks Naver Directions to handle non-car modes.
 */
function routeContainsNonDriveSegment(stops: NaverRouteStop[]) {
  return stops.slice(0, -1).some((stop) => stop.mode !== "drive");
}

/**
 * Builds the Naver Directions query string for one car segment.
 */
function buildNaverDirectionsParams(origin: NaverRouteStop, destination: NaverRouteStop) {
  return new URLSearchParams({
    goal: `${destination.coordinate?.lng},${destination.coordinate?.lat}`,
    option: "trafast",
    start: `${origin.coordinate?.lng},${origin.coordinate?.lat}`,
  });
}

/**
 * Reads a Naver Directions error message while tolerating non-JSON error bodies.
 */
async function readNaverErrorMessage(response: Response) {
  const text = await response.text();

  try {
    const body = JSON.parse(text) as NaverErrorResponse;

    return (
      body.error?.message ??
      body.message ??
      `Naver Directions 자동차 경로 요청 실패(${response.status})`
    );
  } catch {
    return `Naver Directions 자동차 경로 요청 실패(${response.status})`;
  }
}

/**
 * Calls Naver Directions 5 for one car segment and converts it to PlanME route shape.
 */
async function requestDriveRoute(
  keyId: string,
  keySecret: string,
  origin: NaverRouteStop,
  destination: NaverRouteStop,
) {
  const searchParams = buildNaverDirectionsParams(origin, destination);
  const response = await fetch(
    `https://maps.apigw.ntruss.com/map-direction/v1/driving?${searchParams.toString()}`,
    {
      headers: {
        "x-ncp-apigw-api-key": keySecret,
        "x-ncp-apigw-api-key-id": keyId,
      },
    },
  );

  if (!response.ok) {
    throw new Error(await readNaverErrorMessage(response));
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

  if (path.length === 0) {
    throw new Error("Naver Directions 응답에서 지도에 그릴 자동차 경로 좌표를 찾지 못했습니다.");
  }

  return {
    path,
    paths: path.length > 1 ? [path] : [],
    totalDistanceMeters: route?.summary?.distance ?? 0,
    totalDurationSeconds: Math.round((route?.summary?.duration ?? 0) / 1000),
  };
}

/**
 * Computes a car-only Naver Directions route from editable PlanME stops.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as NaverRouteRequestBody;
  const stops = body.stops ?? [];

  if (routeContainsNonDriveSegment(stops)) {
    return NextResponse.json(
      {
        message: "Naver Directions 자동차 경로 API는 자동차 구간만 처리합니다. 대중교통은 ODsay 경로를 사용합니다.",
        ok: false,
      },
      { status: 400 },
    );
  }

  const keyId = getNaverMapsKeyId();
  const keySecret = getNaverMapsSecret();
  const cacheKey = JSON.stringify(stops);
  const cached = routeCache.get(cacheKey);

  if (!keyId || !keySecret) {
    return NextResponse.json(
      {
        message:
          "NAVER_MAPS_CLIENT_ID와 NAVER_MAPS_CLIENT_SECRET이 설정되어 있지 않습니다.",
        ok: false,
      },
      { status: 503 },
    );
  }

  if (cached && Date.now() - cached.cachedAt < routeCacheTtlMs) {
    return NextResponse.json(cached);
  }

  if (stops.length < 2 || stops.some((stop) => !stop.coordinate)) {
    return NextResponse.json(
      { message: "Naver Directions 경로 계산에는 좌표가 있는 행선지 2개 이상이 필요합니다.", ok: false },
      { status: 400 },
    );
  }

  try {
    const path: MapCoordinate[] = [];
    const segments: NonNullable<NaverRouteApiResponse["segments"]> = [];
    let totalDistanceMeters = 0;
    let totalDurationSeconds = 0;

    for (let index = 0; index < stops.length - 1; index += 1) {
      const origin = stops[index];
      const destination = stops[index + 1];
      const segment = await requestDriveRoute(keyId, keySecret, origin, destination);

      // Join provider-returned car paths in destination order without inventing links.
      for (const coordinate of segment.path) {
        appendCoordinate(path, coordinate);
      }

      totalDistanceMeters += segment.totalDistanceMeters;
      totalDurationSeconds += segment.totalDurationSeconds;
      segments.push({
        distanceMeters: segment.totalDistanceMeters,
        durationSeconds: segment.totalDurationSeconds,
        mode: origin.mode,
        path: segment.path,
        paths: segment.paths,
      });
    }

    const payload: CachedRoute = {
      cachedAt: Date.now(),
      ok: true,
      path,
      segments,
      totalDistanceMeters,
      totalDurationLabel: formatDuration(totalDurationSeconds),
      totalDurationSeconds,
    };

    routeCache.set(cacheKey, payload);

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Naver Directions 자동차 경로 계산에 실패했습니다.",
        ok: false,
      },
      { status: 502 },
    );
  }
}
