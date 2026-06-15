import { NextResponse } from "next/server";
import { getItineraryById } from "@/lib/mock-data";
import { createItineraryShareResponse } from "@/lib/gpt-actions";

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

  if (!getItineraryById(itineraryId)) {
    // The demo only exposes known itinerary ids to avoid GPT returning broken links.
    return NextResponse.json({ error: "ITINERARY_NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json(createItineraryShareResponse(itineraryId, request.url));
}
