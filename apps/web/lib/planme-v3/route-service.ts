import {
  calculateStraightDistanceMeters,
  createEstimatedWalkSegment,
  decideOdsayFailure,
  recordPlanmeUsageSafely,
  type Coordinate,
  type PlanmeUsageRecorder,
  type PlanmeV3TransportMode,
  type RouteSegment,
} from "@planme/core";

const ODSAY_ORIGIN = "https://api.odsay.com";
const NAVER_DIRECTIONS_URL =
  "https://maps.apigw.ntruss.com/map-direction/v1/driving";

type OdsayError = {
  code?: string | number;
  message?: string;
  msg?: string;
};

type OdsayTransitResponse = {
  error?: OdsayError | OdsayError[];
  result?: {
    path?: Array<{
      info?: {
        mapObj?: string;
        totalDistance?: number;
        totalTime?: number;
      };
    }>;
  };
};

type OdsayLaneResponse = {
  error?: OdsayError | OdsayError[];
  result?: {
    lane?: Array<{
      section?: Array<{
        graphPos?: Array<{ x?: number; y?: number }>;
      }>;
    }>;
  };
};

type OdsayWalkCoordinate = { x?: number; y?: number };
type OdsayWalkResponse = {
  error?: OdsayError | OdsayError[];
  result?: {
    path?: Array<{
      hasPathResult?: boolean;
      errorCode?: string | number;
      recommend?: {
        summary?: { distance?: number; duration?: number };
        routes?: Array<{
          coordinate?: OdsayWalkCoordinate | OdsayWalkCoordinate[];
        }>;
      };
    }>;
  };
};

type NaverDirectionsResponse = {
  route?: {
    trafast?: Array<{
      path?: Array<[number, number]>;
      summary?: { distance?: number; duration?: number };
    }>;
  };
};

export type PlanmeRoutePoint = {
  ref: string;
  coordinate: Coordinate;
};

export type PlanmeRouteResult =
  | { status: "ready"; segment: RouteSegment }
  | { status: "exclude_optional"; errorCode: string }
  | { status: "failed"; errorCode: string };

export type PlanmeRouteServiceOptions = {
  fetchImpl?: typeof fetch;
  odsayApiKey?: string;
  naverMapsClientId?: string;
  naverMapsClientSecret?: string;
  usageRecorder?: PlanmeUsageRecorder;
};

export async function routePlanmeSegment(
  input: {
    from: PlanmeRoutePoint;
    to: PlanmeRoutePoint;
    transportMode: PlanmeV3TransportMode;
    requiredSegment: boolean;
    signal?: AbortSignal;
  },
  options: PlanmeRouteServiceOptions = {},
): Promise<PlanmeRouteResult> {
  return input.transportMode === "drive"
    ? routeDriveSegment(input, options)
    : routeTransitSegment(input, options);
}

async function routeDriveSegment(
  input: {
    from: PlanmeRoutePoint;
    to: PlanmeRoutePoint;
    requiredSegment: boolean;
    signal?: AbortSignal;
  },
  options: PlanmeRouteServiceOptions,
): Promise<PlanmeRouteResult> {
  const clientId =
    options.naverMapsClientId?.trim() ||
    process.env.NAVER_MAPS_CLIENT_ID?.trim() ||
    process.env.NCP_MAPS_CLIENT_ID?.trim() ||
    "";
  const clientSecret =
    options.naverMapsClientSecret?.trim() ||
    process.env.NAVER_MAPS_CLIENT_SECRET?.trim() ||
    process.env.NCP_MAPS_CLIENT_SECRET?.trim() ||
    "";

  if (!clientId || !clientSecret) {
    return { status: "failed", errorCode: "NAVER_CONFIGURATION_MISSING" };
  }

  const url = new URL(NAVER_DIRECTIONS_URL);
  url.searchParams.set("start", `${input.from.coordinate.lng},${input.from.coordinate.lat}`);
  url.searchParams.set("goal", `${input.to.coordinate.lng},${input.to.coordinate.lat}`);
  url.searchParams.set("option", "trafast");
  const fetchImpl = options.fetchImpl ?? fetch;
  let lastStatus = 0;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let response: Response;
    try {
      await recordPlanmeUsageSafely(
        options.usageRecorder,
        "naver_directions_request",
      );
      response = await fetchImpl(url, {
        headers: {
          "x-ncp-apigw-api-key": clientSecret,
          "x-ncp-apigw-api-key-id": clientId,
        },
        signal: input.signal,
      });
    } catch {
      if (attempt === 1) {
        continue;
      }
      return unavailableResult(input.requiredSegment, "NAVER_NETWORK_ERROR");
    }

    lastStatus = response.status;
    if (!response.ok) {
      if (attempt === 1 && isTransientStatus(response.status)) {
        continue;
      }
      return unavailableResult(
        input.requiredSegment,
        `NAVER_HTTP_${response.status}`,
      );
    }

    let payload: NaverDirectionsResponse;
    try {
      payload = JSON.parse(await response.text()) as NaverDirectionsResponse;
    } catch {
      return unavailableResult(input.requiredSegment, "NAVER_INVALID_JSON");
    }

    const route = payload.route?.trafast?.[0];
    const path = (route?.path ?? []).flatMap(([lng, lat]) =>
      Number.isFinite(lat) && Number.isFinite(lng) ? [{ lat, lng }] : [],
    );
    const durationMilliseconds = route?.summary?.duration;
    if (
      path.length < 2 ||
      !Number.isFinite(durationMilliseconds) ||
      Number(durationMilliseconds) <= 0
    ) {
      return unavailableResult(input.requiredSegment, "NAVER_ROUTE_INVALID");
    }

    return {
      status: "ready",
      segment: {
        fromRef: input.from.ref,
        toRef: input.to.ref,
        mode: "drive",
        source: "naver",
        distanceMeters: Math.max(0, route?.summary?.distance ?? 0),
        durationSeconds: Math.ceil(Number(durationMilliseconds) / 1_000),
        geometryStatus: "complete",
        paths: [path],
      },
    };
  }

  return unavailableResult(input.requiredSegment, `NAVER_HTTP_${lastStatus}`);
}

async function routeTransitSegment(
  input: {
    from: PlanmeRoutePoint;
    to: PlanmeRoutePoint;
    requiredSegment: boolean;
    signal?: AbortSignal;
  },
  options: PlanmeRouteServiceOptions,
): Promise<PlanmeRouteResult> {
  const apiKey =
    options.odsayApiKey?.trim() || process.env.ODSAY_API_KEY?.trim() || "";
  if (!apiKey) {
    return { status: "failed", errorCode: "ODSAY_CONFIGURATION_MISSING" };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const straightDistanceMeters = calculateStraightDistanceMeters(
    input.from.coordinate,
    input.to.coordinate,
  );

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const transitResponse = await requestOdsay<OdsayTransitResponse>({
      apiKey,
      fetchImpl,
      operation: "searchPubTransPathT",
      params: {
        EX: String(input.to.coordinate.lng),
        EY: String(input.to.coordinate.lat),
        SX: String(input.from.coordinate.lng),
        SY: String(input.from.coordinate.lat),
        SearchType: "0",
      },
      signal: input.signal,
      usageRecorder: options.usageRecorder,
    });

    if (transitResponse.status === "http_failure") {
      if (attempt === 1 && isTransientStatus(transitResponse.httpStatus)) {
        continue;
      }
      return unavailableResult(
        input.requiredSegment,
        `ODSAY_HTTP_${transitResponse.httpStatus}`,
      );
    }

    if (transitResponse.status === "network_failure") {
      if (attempt === 1) {
        continue;
      }
      return unavailableResult(input.requiredSegment, "ODSAY_NETWORK_ERROR");
    }

    const providerError = getOdsayError(transitResponse.payload);
    if (providerError) {
      if (isOdsayAuthenticationFailure(providerError)) {
        return { status: "failed", errorCode: "ODSAY_CONFIGURATION_ERROR" };
      }
      const decision = decideOdsayFailure({
        code: providerError.code ?? "ODSAY_ERROR",
        kind: "transit",
        requiredSegment: input.requiredSegment,
        straightDistanceMeters,
      });

      if (decision.action === "retry" && attempt === 1) {
        continue;
      }
      if (decision.action === "try_walk") {
        return routeWalkSegment({
          ...input,
          apiKey,
          fetchImpl,
          straightDistanceMeters,
          usageRecorder: options.usageRecorder,
        });
      }
      if (decision.action === "exclude_optional_place") {
        return {
          status: "exclude_optional",
          errorCode: `ODSAY_${providerError.code}`,
        };
      }
      return { status: "failed", errorCode: `ODSAY_${providerError.code}` };
    }

    const path = transitResponse.payload.result?.path?.[0];
    const totalTime = path?.info?.totalTime;
    if (!Number.isFinite(totalTime) || Number(totalTime) <= 0) {
      return unavailableResult(input.requiredSegment, "ODSAY_ROUTE_INVALID");
    }

    const paths = path?.info?.mapObj
      ? await requestOdsayLanePaths({
          apiKey,
          fetchImpl,
          mapObject: path.info.mapObj,
          signal: input.signal,
          usageRecorder: options.usageRecorder,
        })
      : [];

    return {
      status: "ready",
      segment: {
        fromRef: input.from.ref,
        toRef: input.to.ref,
        mode: "transit",
        source: "odsay",
        distanceMeters: Math.max(0, path?.info?.totalDistance ?? 0),
        durationSeconds: Math.ceil(Number(totalTime) * 60),
        geometryStatus: paths.length > 0 ? "complete" : "unavailable",
        paths,
      },
    };
  }

  return unavailableResult(input.requiredSegment, "ODSAY_RETRY_EXHAUSTED");
}

async function routeWalkSegment(input: {
  from: PlanmeRoutePoint;
  to: PlanmeRoutePoint;
  requiredSegment: boolean;
  signal?: AbortSignal;
  apiKey: string;
  fetchImpl: typeof fetch;
  straightDistanceMeters: number;
  usageRecorder?: PlanmeUsageRecorder;
}): Promise<PlanmeRouteResult> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await requestOdsay<OdsayWalkResponse>({
      apiKey: input.apiKey,
      fetchImpl: input.fetchImpl,
      operation: "searchWalkPathV2",
      params: {
        loc: [
          input.from.coordinate.lng,
          input.from.coordinate.lat,
          input.to.coordinate.lng,
          input.to.coordinate.lat,
        ].join(","),
        opt: "reco",
      },
      signal: input.signal,
      usageRecorder: input.usageRecorder,
    });

    if (response.status === "network_failure") {
      if (attempt === 1) continue;
      return unavailableResult(input.requiredSegment, "ODSAY_WALK_NETWORK_ERROR");
    }
    if (response.status === "http_failure") {
      if (attempt === 1 && isTransientStatus(response.httpStatus)) continue;
      return unavailableResult(
        input.requiredSegment,
        `ODSAY_WALK_HTTP_${response.httpStatus}`,
      );
    }

    const path = response.payload.result?.path?.[0];
    const providerError = getOdsayError(response.payload);
    if (providerError && isOdsayAuthenticationFailure(providerError)) {
      return { status: "failed", errorCode: "ODSAY_CONFIGURATION_ERROR" };
    }
    const failureCode = providerError?.code ??
      (!path?.hasPathResult ? path?.errorCode ?? "ODSAY_WALK_ERROR" : null);
    if (failureCode !== null) {
      const decision = decideOdsayFailure({
        code: failureCode,
        kind: "walk",
        requiredSegment: input.requiredSegment,
        straightDistanceMeters: input.straightDistanceMeters,
      });
      if (decision.action === "retry" && attempt === 1) continue;
      if (decision.action === "estimated_walk") {
        const estimated = createEstimatedWalkSegment({
          fromRef: input.from.ref,
          toRef: input.to.ref,
          straightDistanceMeters: input.straightDistanceMeters,
        });
        return estimated
          ? { status: "ready", segment: estimated }
          : unavailableResult(
              input.requiredSegment,
              "ODSAY_WALK_ESTIMATE_REJECTED",
            );
      }
      if (decision.action === "exclude_optional_place") {
        return {
          status: "exclude_optional",
          errorCode: `ODSAY_WALK_${failureCode}`,
        };
      }
      return unavailableResult(
        input.requiredSegment,
        `ODSAY_WALK_${failureCode}`,
      );
    }

    const summary = path?.recommend?.summary;
    const coordinates = (path?.recommend?.routes ?? []).flatMap((route) => {
      const values = route.coordinate;
      const list = values === undefined ? [] : Array.isArray(values) ? values : [values];
      return list.flatMap((coordinate) =>
        Number.isFinite(coordinate.x) && Number.isFinite(coordinate.y)
          ? [{ lat: Number(coordinate.y), lng: Number(coordinate.x) }]
          : [],
      );
    });

    if (!Number.isFinite(summary?.duration) || Number(summary?.duration) <= 0) {
      return unavailableResult(input.requiredSegment, "ODSAY_WALK_ROUTE_INVALID");
    }

    return {
      status: "ready",
      segment: {
        fromRef: input.from.ref,
        toRef: input.to.ref,
        mode: "walk",
        source: "odsay",
        distanceMeters: Math.max(0, summary?.distance ?? input.straightDistanceMeters),
        durationSeconds: Math.ceil(Number(summary?.duration)),
        geometryStatus: coordinates.length > 1 ? "complete" : "unavailable",
        paths: coordinates.length > 1 ? [coordinates] : [],
      },
    };
  }

  return unavailableResult(input.requiredSegment, "ODSAY_WALK_RETRY_EXHAUSTED");
}

async function requestOdsayLanePaths(input: {
  apiKey: string;
  fetchImpl: typeof fetch;
  mapObject: string;
  signal?: AbortSignal;
  usageRecorder?: PlanmeUsageRecorder;
}) {
  const response = await requestOdsay<OdsayLaneResponse>({
    apiKey: input.apiKey,
    fetchImpl: input.fetchImpl,
    operation: "loadLane",
    params: { mapObject: `0:0@${input.mapObject}` },
    signal: input.signal,
    usageRecorder: input.usageRecorder,
  });

  if (response.status !== "success" || getOdsayError(response.payload)) {
    return [];
  }

  return (
    response.payload.result?.lane
      ?.flatMap((lane) => lane.section ?? [])
      .map((section) =>
        (section.graphPos ?? []).flatMap((coordinate) =>
          Number.isFinite(coordinate.x) && Number.isFinite(coordinate.y)
            ? [{ lat: Number(coordinate.y), lng: Number(coordinate.x) }]
            : [],
        ),
      )
      .filter((path) => path.length > 1) ?? []
  );
}

async function requestOdsay<Payload>(input: {
  apiKey: string;
  fetchImpl: typeof fetch;
  operation: string;
  params: Record<string, string>;
  signal?: AbortSignal;
  usageRecorder?: PlanmeUsageRecorder;
}): Promise<
  | { status: "success"; payload: Payload }
  | { status: "http_failure"; httpStatus: number }
  | { status: "network_failure" }
> {
  const url = new URL(`/v1/api/${input.operation}`, ODSAY_ORIGIN);
  Object.entries({ ...input.params, apiKey: input.apiKey }).forEach(([key, value]) =>
    url.searchParams.set(key, value),
  );

  let response: Response;
  try {
    await recordPlanmeUsageSafely(input.usageRecorder, "odsay_request");
    response = await input.fetchImpl(url, { signal: input.signal });
  } catch {
    return { status: "network_failure" };
  }

  if (!response.ok) {
    return { status: "http_failure", httpStatus: response.status };
  }

  try {
    return {
      status: "success",
      payload: JSON.parse(await response.text()) as Payload,
    };
  } catch {
    return { status: "http_failure", httpStatus: 422 };
  }
}

function getOdsayError(payload: {
  error?: OdsayError | OdsayError[];
}) {
  return Array.isArray(payload.error) ? payload.error[0] : payload.error;
}

function isOdsayAuthenticationFailure(error: OdsayError) {
  const message = error.message ?? error.msg ?? "";
  return String(error.code) === "500" && message.includes("ApiKeyAuthFailed");
}

function unavailableResult(
  requiredSegment: boolean,
  errorCode: string,
): PlanmeRouteResult {
  return requiredSegment
    ? { status: "failed", errorCode }
    : { status: "exclude_optional", errorCode };
}

function isTransientStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}
