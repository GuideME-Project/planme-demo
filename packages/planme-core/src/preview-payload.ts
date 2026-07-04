import { Buffer } from "node:buffer";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { PlanmeItinerary } from "./mock-data.js";

export const PLANME_PREVIEW_DATA_PARAM = "data";
const compressedPayloadPrefix = "z.";

/**
 * Encodes a draft PlanME itinerary into a URL-safe payload for stateless web handoff.
 */
export function encodePlanmePreviewPayload(itinerary: PlanmeItinerary): string {
  const json = JSON.stringify(itinerary);

  // The payload is still visible in the URL; compression only keeps ChatGPT links manageable.
  return `${compressedPayloadPrefix}${deflateRawSync(Buffer.from(json, "utf8")).toString("base64url")}`;
}

/**
 * Decodes a URL-safe PlanME preview payload into an itinerary when the shape is valid.
 */
export function decodePlanmePreviewPayload(payload: string): PlanmeItinerary | null {
  try {
    return parsePlanmePreviewJson(decodePayloadToJson(payload));
  } catch {
    return null;
  }
}

/**
 * Decodes either the compact compressed payload or the legacy raw base64url payload.
 */
function decodePayloadToJson(payload: string): string {
  if (payload.startsWith(compressedPayloadPrefix)) {
    const compressedPayload = payload.slice(compressedPayloadPrefix.length);

    // New preview links use raw deflate to avoid long URL failures in chat clients.
    return inflateRawSync(Buffer.from(compressedPayload, "base64url")).toString("utf8");
  }

  // Keep previously generated long links working while new links use the compressed format.
  return Buffer.from(payload, "base64url").toString("utf8");
}

/**
 * Parses preview JSON only when the minimum render shape is present.
 */
function parsePlanmePreviewJson(json: string): PlanmeItinerary | null {
  const parsed = JSON.parse(json) as Partial<PlanmeItinerary> | null;

  if (!isPlanmeItineraryLike(parsed)) {
    return null;
  }

  return parsed;
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
