import { NextResponse } from "next/server";
import { parseBrowserEditItineraryRequest } from "@/lib/planme-v3/api-contracts";
import { getPlanmeV3Runtime } from "@/lib/planme-v3/runtime";
import { verifyRouteFinalizationToken } from "@/lib/route-finalization-token";

type RouteContext = { params: Promise<{ itineraryId: string }> };

export const maxDuration = 45;

export async function POST(request: Request, context: RouteContext) {
  const parsed = parseBrowserEditItineraryRequest(await request.text());
  if (!parsed.ok) {
    return NextResponse.json({ error: "INVALID_EDIT_COMMAND" }, { status: 400 });
  }
  const { itineraryId } = await context.params;
  if (
    !verifyRouteFinalizationToken(
      parsed.token,
      itineraryId,
      parsed.value.baseRevision,
    )
  ) {
    return NextResponse.json({ error: "INVALID_EDIT_TOKEN" }, { status: 401 });
  }
  try {
    const runtime = getPlanmeV3Runtime(new URL(request.url).origin);
    let result = await runtime
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
    if (result.status === "processing") {
      result = await runtime.runUntilTerminal(
        itineraryId,
        Date.now() + 42_000,
        request.signal,
      ) ?? result;
    }
    return NextResponse.json(result, {
      status: result.status === "processing" ? 202 : 200,
    });
  } catch {
    return NextResponse.json({ error: "STORE_UNAVAILABLE" }, { status: 503 });
  }
}
