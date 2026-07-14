import { NextResponse } from "next/server";
import { toGptActionItineraryResponse } from "@planme/core";
import { getPreviewItineraryRecordById } from "@/lib/preview-itinerary-store";
import { getPlanmeV3ReadRuntime } from "@/lib/planme-v3/runtime";

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

  if (itineraryId.startsWith("planme-v3-")) {
    try {
      const result = await getPlanmeV3ReadRuntime(new URL(request.url).origin)
        .getItineraryStatus(itineraryId);
      return result
        ? NextResponse.json(result)
        : NextResponse.json({ error: "ITINERARY_NOT_FOUND" }, { status: 404 });
    } catch {
      return NextResponse.json({ error: "STORE_UNAVAILABLE" }, { status: 503 });
    }
  }

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
