import "server-only";

import { parsePlanmeRollers, PLANME_ROLLER_GROUPS, type PlanmeRoller, type PlanmeRollerCards, type PlanmeRollerGroup } from "./planme-rollers";

// GuideME API origin/develop f5c3f554 (GUI-339): GET /api/v1/service/planme/rollers?group=STAR|PRO.
// Server-only on purpose: the GuideME API origin is never sent to the browser (no NEXT_PUBLIC_ prefix).
const DEFAULT_GUIDEME_API_BASE_URL = "https://api.guidemetrip.co.kr";
// Universal link domain registered in GuideME-App (applinks); development builds use dev-api.guideme-trip.com.
const DEFAULT_GUIDEME_APP_LINK_BASE_URL = "https://mguideme.com";
// Keep the home page responsive when the GuideME API is slow; the static cards are the fallback.
const ROLLERS_TIMEOUT_MS = 3_000;
// The card lists change only when operators edit planme_star_roller_cards, so a short cache is enough.
const ROLLERS_REVALIDATE_SECONDS = 300;

function guidemeApiBaseUrl() {
  const configured = process.env.GUIDEME_API_BASE_URL?.trim();
  return (configured || DEFAULT_GUIDEME_API_BASE_URL).replace(/\/+$/, "");
}

function guidemeAppLinkBaseUrl() {
  return process.env.GUIDEME_APP_LINK_BASE_URL?.trim() || DEFAULT_GUIDEME_APP_LINK_BASE_URL;
}

async function fetchGroup(group: PlanmeRollerGroup): Promise<PlanmeRoller[]> {
  const response = await fetch(`${guidemeApiBaseUrl()}/api/v1/service/planme/rollers?group=${group}`, {
    next: { revalidate: ROLLERS_REVALIDATE_SECONDS },
    signal: AbortSignal.timeout(ROLLERS_TIMEOUT_MS),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`PlanME rollers HTTP ${response.status}`);
  return parsePlanmeRollers(await response.json(), guidemeAppLinkBaseUrl());
}

/** Returns null when either group is unavailable so the home page keeps its static roller cards. */
export async function fetchPlanmeRollerCards(): Promise<PlanmeRollerCards | null> {
  try {
    const [star, pro] = await Promise.all(PLANME_ROLLER_GROUPS.map(fetchGroup));
    return star.length && pro.length ? { STAR: star, PRO: pro } : null;
  } catch {
    return null;
  }
}
