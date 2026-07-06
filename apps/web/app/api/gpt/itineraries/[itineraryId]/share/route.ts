import { NextResponse } from "next/server";
import { createItineraryShareResponse } from "@planme/core";
import { findPlanmeItineraryForDetailPage } from "@/lib/preview-itinerary-store";

type ItineraryShareRouteContext = {
  params: Promise<{
    itineraryId: string;
  }>;
};

/**
 * Creates a shareable PlanME page URL for Custom GPT Actions.
 */
export async function POST(request: Request, context: ItineraryShareRouteContext) {
  const { itineraryId } = await context.params;
  const itinerary = await findPlanmeItineraryForDetailPage(itineraryId);

  if (!itinerary) {
    // The API only exposes generated or known demo itinerary ids to avoid broken links.
    return NextResponse.json({ error: "ITINERARY_NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json(createItineraryShareResponse(itineraryId, request.url));
}
