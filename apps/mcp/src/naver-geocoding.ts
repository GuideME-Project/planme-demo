import {
  recordPlanmeUsageSafely,
  type PlanmeDraftGeocoder,
  type PlanmeUsageRecorder,
} from "@planme/core";

type NaverGeocoderOptions = {
  keyId?: string;
  secret?: string;
  fetchImpl?: typeof fetch;
  usageRecorder?: PlanmeUsageRecorder;
  timeoutMs?: number;
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

const DEFAULT_NAVER_GEOCODING_TIMEOUT_MS = 4_000;

/** Preserves a stable provider failure without exposing request credentials or response bodies. */
export class NaverGeocodingProviderError extends Error {
  readonly code = "NAVER_GEOCODING_PROVIDER_ERROR";

  constructor(
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super("Naver geocoding failed.");
    this.name = "NaverGeocodingProviderError";
  }
}

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

  return async ({ query, signal, timeoutMs }) => {
    if (!keyId || !secret) {
      return null;
    }

    const url = new URL("https://maps.apigw.ntruss.com/map-geocode/v2/geocode");
    url.searchParams.set("query", query);

    await recordPlanmeUsageSafely(options.usageRecorder, "naver_geocode_request");

    const response = await requestNaverGeocoding(
      fetchImpl,
      url,
      keyId,
      secret,
      signal,
      Math.min(
        timeoutMs ?? DEFAULT_NAVER_GEOCODING_TIMEOUT_MS,
        options.timeoutMs ?? DEFAULT_NAVER_GEOCODING_TIMEOUT_MS,
      ),
    );

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
      placeSource: "naver_geocode",
      placeSourceRef: [
        "naver_geocode",
        query,
        lat.toFixed(6),
        lng.toFixed(6),
      ].join(":"),
    };
  };
}

/** Retries only transient Naver failures once and bounds every attempt. */
async function requestNaverGeocoding(
  fetchImpl: typeof fetch,
  url: URL,
  keyId: string,
  secret: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromParent = () => controller.abort(signal?.reason);

    if (signal?.aborted) {
      abortFromParent();
    } else {
      signal?.addEventListener("abort", abortFromParent, { once: true });
    }

    try {
      const response = await fetchImpl(url, {
        headers: {
          "x-ncp-apigw-api-key-id": keyId,
          "x-ncp-apigw-api-key": secret,
        },
        signal: controller.signal,
      });
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;

      if (response.ok) {
        return response;
      }

      if (!retryable || attempt === 1) {
        throw new NaverGeocodingProviderError(retryable, response.status);
      }
    } catch (error) {
      if (signal?.aborted) {
        throw new NaverGeocodingProviderError(true, 408);
      }

      if (error instanceof NaverGeocodingProviderError) {
        throw error;
      }

      if (attempt === 1) {
        throw new NaverGeocodingProviderError(true);
      }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromParent);
    }
  }

  throw new NaverGeocodingProviderError(true);
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
