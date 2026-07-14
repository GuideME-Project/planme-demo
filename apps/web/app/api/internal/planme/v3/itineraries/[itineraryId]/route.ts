import { NextResponse } from "next/server";
import { isAuthorizedPlanmeInternalRequest } from "@/lib/planme-v3/internal-auth";
import {
  classifyPlanmeV3RuntimeError,
  getPlanmeV3ReadRuntime,
} from "@/lib/planme-v3/runtime";

type RouteContext = { params: Promise<{ itineraryId: string }> };

export async function GET(request: Request, context: RouteContext) {
  if (!isAuthorizedPlanmeInternalRequest(request)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const { itineraryId } = await context.params;
  try {
    const result = await getPlanmeV3ReadRuntime(new URL(request.url).origin)
      .getItineraryStatus(itineraryId);
    return result
      ? NextResponse.json(result)
      : NextResponse.json({ error: "ITINERARY_NOT_FOUND" }, { status: 404 });
  } catch (error) {
    const errorCode = classifyPlanmeV3RuntimeError(error instanceof Error ? error : null);
    console.error("PlanME V3 read failed", { errorCode });
    return NextResponse.json({ error: errorCode }, { status: 503 });
  }
}
