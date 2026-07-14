import { NextResponse } from "next/server";
import { parseEditItineraryRequest } from "@/lib/planme-v3/api-contracts";
import { isAuthorizedPlanmeInternalRequest } from "@/lib/planme-v3/internal-auth";
import {
  classifyPlanmeV3RuntimeError,
  getPlanmeV3Runtime,
} from "@/lib/planme-v3/runtime";

type RouteContext = { params: Promise<{ itineraryId: string }> };

export async function POST(request: Request, context: RouteContext) {
  if (!isAuthorizedPlanmeInternalRequest(request)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const parsed = parseEditItineraryRequest(await request.text());
  if (!parsed.ok) {
    return NextResponse.json({ error: "INVALID_EDIT_COMMAND" }, { status: 400 });
  }
  const { itineraryId } = await context.params;
  try {
    const result = await getPlanmeV3Runtime(new URL(request.url).origin)
      .startItineraryEdit(itineraryId, parsed.value);
    if (result.status === "invalid") {
      return NextResponse.json({ error: "INVALID_EDIT_COMMAND" }, { status: 400 });
    }
    if (result.status === "not_found") {
      return NextResponse.json({ error: "ITINERARY_NOT_FOUND" }, { status: 404 });
    }
    if (
      result.status === "revision_conflict" ||
      result.status === "edit_already_running"
    ) {
      return NextResponse.json({ error: "ITINERARY_VERSION_CONFLICT" }, { status: 409 });
    }
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    const errorCode = classifyPlanmeV3RuntimeError(error instanceof Error ? error : null);
    console.error("PlanME V3 edit failed", { errorCode });
    return NextResponse.json({ error: errorCode }, { status: 503 });
  }
}
