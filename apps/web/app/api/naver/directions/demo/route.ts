import { NextResponse } from "next/server";

type NaverMapPoint = {
  lat: number;
  lng: number;
};

type NaverRouteGuide = {
  distanceMeters: number;
  durationMs: number;
  instruction: string;
  pointIndex: number;
};

type NaverDemoRoute = {
  guides: NaverRouteGuide[];
  path: NaverMapPoint[];
  summary: {
    distanceMeters: number;
    durationMs: number;
  };
};

type NaverDirectionsResponse = {
  route?: {
    trafast?: Array<{
      guide?: Array<{
        distance?: number;
        duration?: number;
        instructions?: string;
        pointIndex?: number;
      }>;
      path?: Array<[number, number]>;
      summary?: {
        distance?: number;
        duration?: number;
      };
    }>;
  };
};

type NaverErrorResponse = {
  error?: {
    message?: string;
  };
  message?: string;
};

const demoFallbackRoute: NaverDemoRoute = {
  guides: [
    {
      distanceMeters: 160,
      durationMs: 120000,
      instruction: "서울역 4번 출구 방면으로 이동",
      pointIndex: 0,
    },
    {
      distanceMeters: 980,
      durationMs: 420000,
      instruction: "세종대로를 따라 명동 방면으로 이동",
      pointIndex: 1,
    },
    {
      distanceMeters: 240,
      durationMs: 180000,
      instruction: "명동 호텔 입구까지 우측 골목으로 진입",
      pointIndex: 3,
    },
  ],
  path: [
    { lat: 37.554722, lng: 126.970833 },
    { lat: 37.55756, lng: 126.97625 },
    { lat: 37.55982, lng: 126.98212 },
    { lat: 37.56104, lng: 126.98648 },
  ],
  summary: {
    distanceMeters: 1380,
    durationMs: 720000,
  },
};

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
 * Converts a Naver Directions API response into the compact PoC route shape.
 */
function toDemoRoute(data: NaverDirectionsResponse): NaverDemoRoute | null {
  const route = data.route?.trafast?.[0];

  if (!route?.path?.length) {
    return null;
  }

  // Directions paths are returned as [longitude, latitude] pairs.
  const path = route.path.map(([lng, lat]) => ({ lat, lng }));

  return {
    guides:
      route.guide?.map((guide) => ({
        distanceMeters: guide.distance ?? 0,
        durationMs: guide.duration ?? 0,
        instruction: guide.instructions ?? "경로 안내",
        pointIndex: guide.pointIndex ?? 0,
      })) ?? demoFallbackRoute.guides,
    path,
    summary: {
      distanceMeters: route.summary?.distance ?? 0,
      durationMs: route.summary?.duration ?? 0,
    },
  };
}

/**
 * Returns a demo route that uses Naver Directions when keys exist and mock data otherwise.
 */
export async function GET() {
  const keyId = getNaverMapsKeyId();
  const keySecret = getNaverMapsSecret();
  const configured = Boolean(keyId && keySecret);

  if (!configured) {
    return NextResponse.json({
      configured,
      message:
        "NAVER_MAPS_CLIENT_ID와 NAVER_MAPS_CLIENT_SECRET을 등록하면 실제 Directions 5 응답을 사용합니다.",
      ok: true,
      route: demoFallbackRoute,
      source: "mock",
    });
  }

  const searchParams = new URLSearchParams({
    goal: "126.98648,37.56104",
    option: "trafast",
    start: "126.970833,37.554722",
  });

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
    const errorBody = (await response.json()) as NaverErrorResponse;

    return NextResponse.json(
      {
        configured,
        message:
          errorBody.error?.message ??
          errorBody.message ??
          "Naver Directions 경로 요청을 처리하지 못했습니다.",
        ok: false,
        route: demoFallbackRoute,
        source: "naver-error",
      },
      { status: response.status },
    );
  }

  const route = toDemoRoute((await response.json()) as NaverDirectionsResponse);

  if (!route) {
    return NextResponse.json(
      {
        configured,
        message: "Naver Directions 응답에 경로 데이터가 없습니다.",
        ok: false,
        route: demoFallbackRoute,
        source: "naver-empty",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    configured,
    ok: true,
    route,
    source: "naver",
  });
}
