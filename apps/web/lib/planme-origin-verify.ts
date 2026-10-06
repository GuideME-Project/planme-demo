import { constantTimeTextEqual } from "./planme-v3/internal-auth";

/** Cloudflare adds this header (with the shared secret) to every request it forwards to the origin. */
export const PLANME_ORIGIN_VERIFY_HEADER = "x-planme-origin-verify";

/**
 * True only when the secret is configured and the request carries the matching header,
 * which a request that bypasses Cloudflare cannot produce.
 */
export function isPlanmeOriginVerified(headers: Headers) {
  const secret = process.env.PLANME_ORIGIN_VERIFY_SECRET?.trim() ?? "";
  const provided = headers.get(PLANME_ORIGIN_VERIFY_HEADER)?.trim() ?? "";
  return Boolean(secret && provided && constantTimeTextEqual(secret, provided));
}

/**
 * Rejects requests without the verified header only when PLANME_ORIGIN_VERIFY_ENFORCE is exactly "true".
 * Without the secret nothing is rejected, so a missing parameter cannot take the site down.
 */
export function shouldRejectUnverifiedOrigin(headers: Headers) {
  if (process.env.PLANME_ORIGIN_VERIFY_ENFORCE?.trim() !== "true") return false;
  if (!process.env.PLANME_ORIGIN_VERIFY_SECRET?.trim()) {
    console.error("PLANME_ORIGIN_VERIFY_ENFORCE_WITHOUT_SECRET");
    return false;
  }
  return !isPlanmeOriginVerified(headers);
}
