import { NextResponse } from "next/server";
import { getGptActionItineraryResponse } from "@planme/core";

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
  const response = getGptActionItineraryResponse(itineraryId, request.url);

  if (!response) {
    // Missing ids use a compact JSON error because GPT Actions handles HTTP status directly.
    return NextResponse.json({ error: "ITINERARY_NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json(response);
}
