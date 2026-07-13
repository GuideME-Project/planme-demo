import { ImageResponse } from "next/og";
import { ItineraryOgPresentation } from "@/lib/itinerary-og-presentation";
import { findPlanmeItineraryForDetailPage } from "@/lib/preview-itinerary-store";

export const size = {
  width: 768,
  height: 1120,
};

export const contentType = "image/png";

type ItineraryOgRouteContext = {
  params: Promise<{
    itineraryId: string;
  }>;
};

/** Removes the optional .png suffix used by GPT and chat link previews. */
function normalizeItineraryIdParam(itineraryId: string): string {
  return itineraryId.endsWith(".png") ? itineraryId.slice(0, -4) : itineraryId;
}

/** Renders a compact all-day OpenGraph image for one saved PlanME itinerary. */
export async function GET(_request: Request, context: ItineraryOgRouteContext) {
  const { itineraryId: rawItineraryId } = await context.params;
  const itineraryId = normalizeItineraryIdParam(rawItineraryId);
  const itinerary = await findPlanmeItineraryForDetailPage(itineraryId);

  if (!itinerary) {
    return new Response("Itinerary not found", { status: 404 });
  }

  return new ImageResponse(<ItineraryOgPresentation itinerary={itinerary} />, size);
}
