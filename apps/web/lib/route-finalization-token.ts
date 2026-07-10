import { createHmac, timingSafeEqual } from "node:crypto";

type RouteFinalizationTokenPayload = {
  expiresAt: number;
  itineraryId: string;
  revision: number;
};

// Browser finalization tokens are short-lived and bind one itinerary revision for 15 minutes.
const ROUTE_FINALIZATION_TOKEN_TTL_MS = 15 * 60 * 1000;

/** Creates a short-lived browser token without exposing the internal API master secret. */
export function createRouteFinalizationToken(itineraryId: string, revision: number) {
  const payload: RouteFinalizationTokenPayload = {
    expiresAt: Date.now() + ROUTE_FINALIZATION_TOKEN_TTL_MS,
    itineraryId,
    revision,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signPayload(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

/** Verifies expiry, itinerary id, revision, and HMAC signature for a browser request. */
export function verifyRouteFinalizationToken(
  token: string,
  itineraryId: string,
  revision: number,
) {
  const [encodedPayload, providedSignature, extraPart] = token.split(".");

  if (!encodedPayload || !providedSignature || extraPart) {
    return false;
  }

  const expectedSignature = signPayload(encodedPayload);
  const expected = Buffer.from(expectedSignature);
  const provided = Buffer.from(providedSignature);

  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return false;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as RouteFinalizationTokenPayload;

    return (
      payload.expiresAt > Date.now() &&
      payload.itineraryId === itineraryId &&
      payload.revision === revision
    );
  } catch {
    return false;
  }
}

/** Signs one encoded token payload with the server-only internal secret. */
function signPayload(encodedPayload: string) {
  const secret = process.env.PLANME_INTERNAL_API_TOKEN?.trim();

  if (!secret) {
    throw new Error("PLANME_INTERNAL_API_TOKEN is required.");
  }

  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}
