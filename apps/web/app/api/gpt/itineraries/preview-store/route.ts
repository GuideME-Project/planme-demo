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

  let savedPreview;

  try {
    savedPreview = await savePreviewItinerary(body.itinerary);
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : "unknown error";

    // Do not log the itinerary payload; storage errors are enough to diagnose handoff failures.
    console.error("PlanME preview store save failed", safeMessage);

    return NextResponse.json(
      {
        error: "PREVIEW_STORE_UNAVAILABLE",
        message: "PlanME generated itinerary store is unavailable.",
      },
      { status: 500 },
    );
  }

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
