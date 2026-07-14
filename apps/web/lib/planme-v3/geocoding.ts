import {
  recordPlanmeUsageSafely,
  type Coordinate,
  type PlanmeUsageRecorder,
} from "@planme/core";

const NAVER_GEOCODING_URL =
  "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";

type NaverGeocodingResponse = {
  addresses?: Array<{
    roadAddress?: string;
    jibunAddress?: string;
    x?: string;
    y?: string;
  }>;
};

export type PlanmeAnchorGeocodeResult =
  | { status: "ready"; coordinate: Coordinate }
  | { status: "not_found" }
  | { status: "failed"; errorCode: string };

export async function geocodePlanmeAnchor(
  query: string,
  options: {
    fetchImpl?: typeof fetch;
    naverMapsClientId?: string;
    naverMapsClientSecret?: string;
    usageRecorder?: PlanmeUsageRecorder;
    signal?: AbortSignal;
  } = {},
): Promise<PlanmeAnchorGeocodeResult> {
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

  const url = new URL(NAVER_GEOCODING_URL);
  url.searchParams.set("query", query);
  let response: Response;
  try {
    await recordPlanmeUsageSafely(
      options.usageRecorder,
      "naver_geocode_request",
    );
    response = await (options.fetchImpl ?? fetch)(url, {
      headers: {
        "x-ncp-apigw-api-key": clientSecret,
        "x-ncp-apigw-api-key-id": clientId,
      },
      signal: options.signal,
    });
  } catch {
    return { status: "failed", errorCode: "NAVER_NETWORK_ERROR" };
  }

  if (!response.ok) {
    return {
      status: "failed",
      errorCode: `NAVER_HTTP_${response.status}`,
    };
  }

  let payload: NaverGeocodingResponse;
  try {
    payload = JSON.parse(await response.text()) as NaverGeocodingResponse;
  } catch {
    return { status: "failed", errorCode: "NAVER_INVALID_JSON" };
  }

  const first = payload.addresses?.[0];
  const lat = Number(first?.y);
  const lng = Number(first?.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { status: "not_found" };
  }
  return { status: "ready", coordinate: { lat, lng } };
}
