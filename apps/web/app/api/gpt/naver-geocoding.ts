import type { PlanmeDraftGeocoder } from "@planme/core";

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
 * Creates the web API route geocoder used by GPT Action itinerary generation.
 */
export function createWebNaverGeocoder(): PlanmeDraftGeocoder {
  return async ({ query }) => {
    const keyId = getNaverMapsKeyId();
    const secret = getNaverMapsSecret();

    if (!keyId || !secret) {
      return null;
    }

    const url = new URL("https://maps.apigw.ntruss.com/map-geocode/v2/geocode");
    url.searchParams.set("query", query);

    const response = await fetch(url, {
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
 * Checks whether the web runtime can call Naver Geocoding before adding warning issues.
 */
export function hasWebNaverGeocoderRuntimeConfig() {
  return Boolean(getNaverMapsKeyId() && getNaverMapsSecret());
}

/**
 * Reads the Naver REST API key id from server runtime configuration.
 */
function getNaverMapsKeyId() {
  return (
    process.env.NAVER_MAPS_CLIENT_ID ??
    process.env.NCP_MAPS_CLIENT_ID ??
    process.env.NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID ??
    ""
  ).trim();
}

/**
 * Reads the Naver REST API secret from server runtime configuration.
 */
function getNaverMapsSecret() {
  return (process.env.NAVER_MAPS_CLIENT_SECRET ?? process.env.NCP_MAPS_CLIENT_SECRET ?? "").trim();
}
