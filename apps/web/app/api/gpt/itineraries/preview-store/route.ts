import { NextResponse } from "next/server";
import type { PlanmeItinerary } from "@planme/core";
import { buildItineraryPageUrl, buildItineraryOgImageUrl } from "@planme/core";
import { savePreviewItinerary } from "@/lib/preview-itinerary-store";

type PreviewStoreRequest = {
  itinerary?: Partial<PlanmeItinerary>;
};

/**
 * Stores a PlanME preview itinerary produced by a separate MCP deployment.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as PreviewStoreRequest;

  if (!isPlanmeItinerary(body.itinerary)) {
    return NextResponse.json({ error: "INVALID_ITINERARY" }, { status: 400 });
  }

  const savedPreview = await savePreviewItinerary(body.itinerary);

  return NextResponse.json({
    itineraryId: savedPreview.itineraryId,
    pageUrl: buildItineraryPageUrl(request.url, savedPreview.itineraryId),
    ogImageUrl: buildItineraryOgImageUrl(request.url, savedPreview.itineraryId),
    expiresAt: savedPreview.expiresAt,
  });
}

/**
 * Validates the minimal shape needed before trusting an externally produced preview payload.
 */
function isPlanmeItinerary(value: PreviewStoreRequest["itinerary"]): value is PlanmeItinerary {
  return Boolean(
    value?.id &&
      value.title &&
      value.region &&
      value.duration &&
      Array.isArray(value.days) &&
      value.days.length > 0,
  );
}
