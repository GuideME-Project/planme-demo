import { NextResponse } from "next/server";

type RouteCheckMode = "drive" | "transit" | "walk";

type GoogleTravelMode = "DRIVE" | "TRANSIT" | "WALK";

type RouteCheckStop = {
  coordinate?: {
    lat: number;
    lng: number;
  };
  id: string;
  mode: RouteCheckMode;
  name: string;
  placeId?: string;
};

type RouteCheckRequestBody = {
  stops?: RouteCheckStop[];
};

type RouteWaypoint = {
  address?: string;
  location?: {
    latLng: {
      latitude: number;
      longitude: number;
    };
  };
  placeId?: string;
};

type ComputeRouteResponse = {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
    localizedValues?: {
      distance?: {
        text?: string;
      };
      duration?: {
        text?: string;
      };
    };
  }>;
};

type GoogleErrorResponse = {
  error?: {
    message?: string;
  };
};

type ComputeRouteResult =
  | {
      data: ComputeRouteResponse;
      ok: true;
    }
  | {
      message: string;
      ok: false;
      status: number;
    };

/**
 * Returns the server-side Google Maps API key used for Places and Routes checks.
 */
function getGoogleMapsApiKey() {
  return process.env.PLANME_GOOGLE_MAPS_API_KEY ?? "";
}

/**
 * Converts a PlanME destination into a Google Routes waypoint.
 */
function toWaypoint(stop: RouteCheckStop): RouteWaypoint {
  if (stop.coordinate) {
    return {
      location: {
        latLng: {
          latitude: stop.coordinate.lat,
          longitude: stop.coordinate.lng,
        },
      },
    };
  }

  if (stop.placeId) {
    return { placeId: stop.placeId };
  }

  return { address: stop.name };
}

/**
 * Converts the destination row mode into the Google Routes travel mode.
 */
function toTravelMode(mode: RouteCheckMode): GoogleTravelMode {
  if (mode === "walk") {
    return "WALK";
  }

  if (mode === "drive") {
    return "DRIVE";
  }

  return "TRANSIT";
}

/**
 * Requests one segment from Google Routes using the provided travel mode.
 */
async function requestComputeRoute({
  apiKey,
  destination,
  origin,
  travelMode,
}: {
  apiKey: string;
  destination: RouteCheckStop;
  origin: RouteCheckStop;
  travelMode: GoogleTravelMode;
}): Promise<ComputeRouteResult> {
  // Each segment is requested independently because transit does not support intermediate stops.
  const googleResponse = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      body: JSON.stringify({
        computeAlternativeRoutes: false,
        destination: toWaypoint(destination),
        languageCode: "ko",
        origin: toWaypoint(origin),
        travelMode,
        units: "METRIC",
      }),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "routes.duration,routes.distanceMeters,routes.localizedValues",
      },
      method: "POST",
    },
  );

  if (!googleResponse.ok) {
    const errorBody = (await googleResponse.json()) as GoogleErrorResponse;

    return {
      message:
        errorBody.error?.message ??
        "Google Routes 경로 체크 요청을 처리하지 못했습니다.",
      ok: false,
      status: googleResponse.status,
    };
  }

  return {
    data: (await googleResponse.json()) as ComputeRouteResponse,
    ok: true,
  };
}

/**
 * Returns the Korean label used in warnings for a Google travel mode.
 */
function formatTravelModeLabel(travelMode: GoogleTravelMode) {
  if (travelMode === "DRIVE") {
    return "자동차";
  }

  if (travelMode === "TRANSIT") {
    return "대중교통";
  }

  return "도보";
}

/**
 * Parses Google duration strings like "1234s" into seconds.
 */
function parseDurationSeconds(duration?: string) {
  if (!duration?.endsWith("s")) {
    return 0;
  }

  return Number(duration.slice(0, -1)) || 0;
}

/**
 * Formats a duration in seconds into a compact Korean label.
 */
function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours <= 0) {
    return `약 ${remainingMinutes}분`;
  }

  if (remainingMinutes === 0) {
    return `약 ${hours}시간`;
  }

  return `약 ${hours}시간 ${remainingMinutes}분`;
}

/**
 * Checks the editable PlanME destination sequence against Google Routes.
 */
export async function POST(request: Request) {
  const apiKey = getGoogleMapsApiKey();
  const body = (await request.json()) as RouteCheckRequestBody;
  const stops = body.stops ?? [];

  if (!apiKey) {
    return NextResponse.json(
      { message: "PLANME_GOOGLE_MAPS_API_KEY가 설정되어 있지 않습니다.", ok: false },
      { status: 503 },
    );
  }

  if (stops.length < 2) {
    return NextResponse.json(
      { message: "경로 체크에는 최소 2개 행선지가 필요합니다.", ok: false },
      { status: 400 },
    );
  }

  const segments = [];
  const warnings: string[] = [];
  let totalDistanceMeters = 0;
  let totalDurationSeconds = 0;

  for (let index = 0; index < stops.length - 1; index += 1) {
    const origin = stops[index];
    const destination = stops[index + 1];
    const requestedTravelMode = toTravelMode(origin.mode);

    const routeResult = await requestComputeRoute({
      apiKey,
      destination,
      origin,
      travelMode: requestedTravelMode,
    });

    if (!routeResult.ok) {
      return NextResponse.json(
        {
          failedSegment: {
            destination: destination.name,
            origin: origin.name,
          },
          message: routeResult.message,
          ok: false,
        },
        { status: routeResult.status },
      );
    }

    const route = routeResult.data.routes?.[0];

    if (!route) {
      return NextResponse.json(
        {
          failedSegment: {
            destination: destination.name,
            origin: origin.name,
          },
          message: `${formatTravelModeLabel(
            requestedTravelMode,
          )} 경로를 찾지 못했습니다. Google Maps Platform 지원 범위 또는 도로 데이터 제약을 확인해야 합니다.`,
          ok: false,
        },
        { status: 502 },
      );
    }

    const durationSeconds = parseDurationSeconds(route.duration);
    const distanceMeters = route.distanceMeters ?? 0;

    totalDistanceMeters += distanceMeters;
    totalDurationSeconds += durationSeconds;
    segments.push({
      destination: destination.name,
      distanceLabel: route.localizedValues?.distance?.text ?? `${distanceMeters}m`,
      distanceMeters,
      durationLabel: route.localizedValues?.duration?.text ?? formatDuration(durationSeconds),
      durationSeconds,
      origin: origin.name,
      requestedTravelMode,
      travelMode: requestedTravelMode,
    });
  }

  return NextResponse.json({
    ok: true,
    segments,
    totalDistanceMeters,
    totalDurationLabel: formatDuration(totalDurationSeconds),
    totalDurationSeconds,
    warnings,
  });
}
