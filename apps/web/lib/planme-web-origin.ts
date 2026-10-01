// Public origin used when PLANME_WEB_ORIGIN is not configured (canonical host; planme.kr redirects here).
export const DEFAULT_PLANME_WEB_ORIGIN = "https://www.planme.kr";

/** Resolves the public web origin from PLANME_WEB_ORIGIN, falling back to the production domain. */
export function getPlanmeWebOrigin() {
  return new URL(process.env.PLANME_WEB_ORIGIN?.trim() || DEFAULT_PLANME_WEB_ORIGIN).origin;
}
