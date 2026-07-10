import { NextResponse } from "next/server";
import { toGptActionItineraryResponse } from "@planme/core";
import { getPreviewItineraryRecordById } from "@/lib/preview-itinerary-store";

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
  const record = await getPreviewItineraryRecordById(itineraryId);

  if (!record) {
    // Missing ids use a compact JSON error because GPT Actions handles HTTP status directly.
    return NextResponse.json({ error: "ITINERARY_NOT_FOUND" }, { status: 404 });
  }

  if (!record.routeFinalized) {
    return NextResponse.json(
      { error: "ROUTE_FINALIZATION_REQUIRED" },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ...toGptActionItineraryResponse(record.itinerary, request.url),
    revision: record.revision,
    status: "ready",
  });
}
