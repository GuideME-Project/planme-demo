import { NextResponse } from "next/server";
import { parseStartItineraryRequest } from "@/lib/planme-v3/api-contracts";
import { isAuthorizedPlanmeInternalRequest } from "@/lib/planme-v3/internal-auth";
import { getPlanmeV3Runtime } from "@/lib/planme-v3/runtime";

export async function POST(request: Request) {
  if (!isAuthorizedPlanmeInternalRequest(request)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 128) {
    return NextResponse.json({ error: "INVALID_IDEMPOTENCY_KEY" }, { status: 400 });
  }
  const parsed = parseStartItineraryRequest(await request.text());
  if (!parsed.ok) {
    return NextResponse.json({ error: "INVALID_PLANNING_INPUT" }, { status: 400 });
  }

  try {
    const result = await getPlanmeV3Runtime(new URL(request.url).origin).startItinerary(
      parsed.value,
      idempotencyKey,
    );
    if (result.status === "invalid") {
      return NextResponse.json(
        {
          error: "INVALID_PLANNING_INPUT",
          missingSlots: result.missingSlots,
          invalidSlots: result.invalidSlots,
        },
        { status: 400 },
      );
    }
    if (result.status === "idempotency_conflict") {
      return NextResponse.json({ error: "IDEMPOTENCY_KEY_REUSED" }, { status: 409 });
    }
    return NextResponse.json(result, {
      status: result.status === "processing" ? 202 : 200,
    });
  } catch {
    return NextResponse.json({ error: "STORE_UNAVAILABLE" }, { status: 503 });
  }
}
