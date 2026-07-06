import { NextResponse } from "next/server";
import { toGptActionItineraryResponse } from "@planme/core";
import { findPlanmeItineraryForDetailPage } from "@/lib/preview-itinerary-store";

type ItineraryRouteContext = {
  params: Promise<{
    itineraryId: string;
  }>;
};

/**
 * Returns a generated PlanME itinerary by id for Custom GPT follow-up turns.
 */
export async function GET(request: Request, context: ItineraryRouteContext) {
  const { itineraryId } = await context.params;
  const itinerary = await findPlanmeItineraryForDetailPage(itineraryId);

  if (!itinerary) {
    // Missing ids use a compact JSON error because GPT Actions handles HTTP status directly.
    return NextResponse.json({ error: "ITINERARY_NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json(toGptActionItineraryResponse(itinerary, request.url));
}
