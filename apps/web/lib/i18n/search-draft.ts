import type { PlanmeSearchActionState } from "@/app/planme-search-actions";
import type { PlanmePlaceSelection } from "@/lib/planme-places";

export const searchDraftKey = "planme-search-language-draft-v1";
export type SearchDraft = {
  query: string;
  origin: string;
  destination: string;
  durationDays: string;
  transportMode: "drive" | "transit" | "";
  submissionId: string;
  originSelection: PlanmePlaceSelection | null;
  destinationSelection: PlanmePlaceSelection | null;
  consumedTokens: string[];
  state: PlanmeSearchActionState;
};
function isSelection(value: PlanmePlaceSelection | null | undefined) {
  return value === null || Boolean(value && typeof value === "object" &&
    typeof value.placeId === "string" && typeof value.name === "string" &&
    typeof value.address === "string" && typeof value.sessionToken === "string");
}
export function readSearchDraft(storage: Pick<Storage, "getItem">, query: string): SearchDraft | null {
  try {
    const text = storage.getItem(searchDraftKey);
    if (!text) return null;
    const data = JSON.parse(text) as Partial<SearchDraft> | null;
    if (!data || !isSelection(data.originSelection) || !isSelection(data.destinationSelection) || data.query !== query || typeof data.origin !== "string" || typeof data.destination !== "string" ||
      typeof data.durationDays !== "string" || typeof data.submissionId !== "string" ||
      !["", "drive", "transit"].includes(data.transportMode ?? "invalid") ||
      !Array.isArray(data.consumedTokens) || !data.consumedTokens.every(token => typeof token === "string") ||
      !data.state || typeof data.state !== "object") return null;
    return data as SearchDraft;
  } catch { return null; }
}
export function saveSearchDraft(storage: Pick<Storage, "setItem">, draft: SearchDraft) {
  // Keep the itinerary identity; reload the current revision rather than storing a stale itinerary.
  const result = draft.state.itineraryResult;
  const state = result ? { ...draft.state, itineraryResult: { ...result, itinerary: null } } : draft.state;
  storage.setItem(searchDraftKey, JSON.stringify({ ...draft, state }));
}
