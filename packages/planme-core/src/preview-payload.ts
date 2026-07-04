import type { PlanmeItinerary } from "./mock-data.js";

export const PLANME_PREVIEW_DATA_PARAM = "data";

/**
 * Encodes a draft PlanME itinerary into a URL-safe payload for stateless web handoff.
 */
export function encodePlanmePreviewPayload(itinerary: PlanmeItinerary): string {
  const json = JSON.stringify(itinerary);
  const bytes = new TextEncoder().encode(json);
  let binary = "";

  // URL payloads are visible to users, so this is transport encoding, not secret storage.
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

/**
 * Decodes a URL-safe PlanME preview payload into an itinerary when the shape is valid.
 */
export function decodePlanmePreviewPayload(payload: string): PlanmeItinerary | null {
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(paddedBase64);
    const bytes = new Uint8Array(binary.length);

    // Decode as UTF-8 so Korean itinerary names survive round-tripping through the URL.
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<PlanmeItinerary> | null;

    if (!isPlanmeItineraryLike(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Checks only the fields required before rendering the preview page.
 */
function isPlanmeItineraryLike(value: Partial<PlanmeItinerary> | null): value is PlanmeItinerary {
  return Boolean(
    value &&
      typeof value.id === "string" &&
      typeof value.title === "string" &&
      typeof value.summary === "string" &&
      typeof value.detailUrl === "string" &&
      Array.isArray(value.days) &&
      Array.isArray(value.benefits),
  );
}
