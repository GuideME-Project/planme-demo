import type { PlanmeDraftGeocoder } from "@planme/core";

type NaverGeocoderOptions = {
  keyId?: string;
  secret?: string;
  fetchImpl?: typeof fetch;
};

type NaverGeocodingAddress = {
  roadAddress?: string;
  jibunAddress?: string;
  x?: string;
  y?: string;
};

type NaverGeocodingResponse = {
  addresses?: NaverGeocodingAddress[];
};

/**
 * Creates a server-side Naver geocoder for AI-authored Korean address queries.
 */
export function createNaverGeocoder(options: NaverGeocoderOptions = {}): PlanmeDraftGeocoder {
  const keyId =
    options.keyId ?? readRuntimeEnv("NAVER_MAPS_CLIENT_ID") ?? readRuntimeEnv("NCP_MAPS_CLIENT_ID");
  const secret =
    options.secret ??
    readRuntimeEnv("NAVER_MAPS_CLIENT_SECRET") ??
    readRuntimeEnv("NCP_MAPS_CLIENT_SECRET");
  const fetchImpl = options.fetchImpl ?? fetch;

  return async ({ query }) => {
    if (!keyId || !secret) {
      return null;
    }

    const url = new URL("https://maps.apigw.ntruss.com/map-geocode/v2/geocode");
    url.searchParams.set("query", query);

    const response = await fetchImpl(url, {
      headers: {
        "x-ncp-apigw-api-key-id": keyId,
        "x-ncp-apigw-api-key": secret,
      },
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as NaverGeocodingResponse;
    const firstAddress = payload.addresses?.[0];
    const lat = Number(firstAddress?.y);
    const lng = Number(firstAddress?.x);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }

    return {
      coordinate: { lat, lng },
      matchedAddress: firstAddress?.roadAddress || firstAddress?.jibunAddress,
    };
  };
}

/**
 * Checks whether runtime Naver credentials exist before enabling coordinate enrichment.
 */
export function hasNaverGeocoderRuntimeConfig() {
  const keyId = readRuntimeEnv("NAVER_MAPS_CLIENT_ID") ?? readRuntimeEnv("NCP_MAPS_CLIENT_ID");
  const secret =
    readRuntimeEnv("NAVER_MAPS_CLIENT_SECRET") ?? readRuntimeEnv("NCP_MAPS_CLIENT_SECRET");

  return Boolean(keyId && secret);
}

/**
 * Reads only server runtime variables so Naver secrets never reach widget payloads.
 */
function readRuntimeEnv(name: string) {
  return process.env[name]?.trim() || undefined;
}
