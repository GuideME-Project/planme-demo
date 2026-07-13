import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { PlanmeItinerary } from "@planme/core";
import { validateEditedItineraryPlaces } from "@/lib/edited-itinerary-validator";
import {
  ROUTE_FINALIZATION_TIMEOUT_MS,
  RouteFinalizationError,
  RouteFinalizationTimeoutError,
  finalizeItineraryRoutes,
} from "@/lib/itinerary-route-finalizer";
import { createRouteFinalizationToken, verifyRouteFinalizationToken } from "@/lib/route-finalization-token";
import {
  acquirePreviewItineraryLock,
  consumePreviewFinalizationRateLimit,
  getPreviewItineraryRecordById,
  releasePreviewItineraryLock,
  saveFinalizedPreviewItinerary,
} from "@/lib/preview-itinerary-store";
import {
  createPlanmeRouteFailureLog,
  type PlanmeWebFailureStage,
} from "@/lib/route-failure-observability";

type FinalizeRouteContext = {
  params: Promise<{
    itineraryId: string;
  }>;
};

type FinalizeRouteRequest = {
  baseRevision?: number;
  itinerary?: Partial<PlanmeItinerary>;
  token?: string;
};

export const maxDuration = 45;

/** Finalizes a saved legacy or edited itinerary under a revision-bound browser token. */
export async function POST(request: Request, context: FinalizeRouteContext) {
  const startedAt = Date.now();
  const traceId = getRouteFinalizationTraceId(request);
  const { itineraryId } = await context.params;
  let body: FinalizeRouteRequest;

  try {
    body = (await request.json()) as FinalizeRouteRequest;
  } catch {
    logRouteFinalizationFailure(traceId, 400, "INVALID_JSON", "request_validation");
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  if (
    !Number.isInteger(body.baseRevision) ||
    typeof body.token !== "string" ||
    !verifyRouteFinalizationToken(body.token, itineraryId, Number(body.baseRevision))
  ) {
    logRouteFinalizationFailure(
      traceId,
      401,
      "INVALID_FINALIZATION_TOKEN",
      "authorization",
    );
    return NextResponse.json({ error: "INVALID_FINALIZATION_TOKEN" }, { status: 401 });
  }

  const rateKey = `${itineraryId}:${createRequestSourceHash(request)}`;
  let rateAllowed: boolean;

  try {
    rateAllowed = await consumePreviewFinalizationRateLimit(rateKey, 4, 5 * 60);
  } catch {
    logRouteFinalizationFailure(
      traceId,
      500,
      "FINALIZATION_RATE_LIMIT_LOOKUP_FAILED",
      "rate_limit",
    );
    return NextResponse.json({ error: "PREVIEW_STORE_UNAVAILABLE" }, { status: 500 });
  }

  if (!rateAllowed) {
    logRouteFinalizationFailure(
      traceId,
      429,
      "ROUTE_FINALIZATION_RATE_LIMITED",
      "rate_limit",
    );
    return NextResponse.json(
      { error: "ROUTE_FINALIZATION_RATE_LIMITED" },
      { status: 429 },
    );
  }

  let record: Awaited<ReturnType<typeof getPreviewItineraryRecordById>>;

  try {
    record = await getPreviewItineraryRecordById(itineraryId);
  } catch {
    logRouteFinalizationFailure(
      traceId,
      500,
      "PREVIEW_STORE_LOOKUP_FAILED",
      "record_lookup",
    );
    return NextResponse.json({ error: "PREVIEW_STORE_UNAVAILABLE" }, { status: 500 });
  }

  if (!record) {
    logRouteFinalizationFailure(traceId, 404, "ITINERARY_NOT_FOUND", "record_lookup");
    return NextResponse.json({ error: "ITINERARY_NOT_FOUND" }, { status: 404 });
  }

  if (record.revision !== body.baseRevision) {
    logRouteFinalizationFailure(
      traceId,
      409,
      "ITINERARY_VERSION_CONFLICT",
      "record_lookup",
    );
    return NextResponse.json(
      { error: "ITINERARY_VERSION_CONFLICT" },
      { status: 409 },
    );
  }

  const candidate = body.itinerary ?? record.itinerary;

  if (!isMatchingPlanmeItinerary(candidate, itineraryId)) {
    logRouteFinalizationFailure(traceId, 400, "INVALID_ITINERARY", "request_validation");
    return NextResponse.json({ error: "INVALID_ITINERARY" }, { status: 400 });
  }

  const lockOwner = randomUUID();
  let lockAcquired: boolean;

  try {
    lockAcquired = await acquirePreviewItineraryLock(itineraryId, lockOwner);
  } catch {
    logRouteFinalizationFailure(
      traceId,
      500,
      "PREVIEW_STORE_LOCK_FAILED",
      "lock_acquisition",
    );
    return NextResponse.json({ error: "PREVIEW_STORE_UNAVAILABLE" }, { status: 500 });
  }

  if (!lockAcquired) {
    logRouteFinalizationFailure(
      traceId,
      409,
      "ITINERARY_VERSION_CONFLICT",
      "lock_acquisition",
    );
    return NextResponse.json(
      { error: "ITINERARY_VERSION_CONFLICT" },
      { status: 409 },
    );
  }

  try {
    const coordinateController = new AbortController();
    const coordinateTimeout = setTimeout(
      () => coordinateController.abort(new RouteFinalizationTimeoutError()),
      ROUTE_FINALIZATION_TIMEOUT_MS,
    );
    let verifiedCandidate: PlanmeItinerary;

    try {
      verifiedCandidate = body.itinerary
        ? await validateEditedItineraryPlaces(
            candidate,
            record.itinerary,
            coordinateController.signal,
          )
        : candidate;
    } catch (error) {
      if (coordinateController.signal.aborted) {
        throw new RouteFinalizationTimeoutError();
      }

      throw error;
    } finally {
      clearTimeout(coordinateTimeout);
    }

    const remainingTimeMs = ROUTE_FINALIZATION_TIMEOUT_MS - (Date.now() - startedAt);

    if (remainingTimeMs <= 0) {
      throw new RouteFinalizationTimeoutError();
    }

    const itinerary = await finalizeItineraryRoutes(verifiedCandidate, {
      timeoutMs: remainingTimeMs,
      traceId,
    });
    const saved = await saveFinalizedPreviewItinerary(itinerary, record.revision);

    if (!saved) {
      logRouteFinalizationFailure(
        traceId,
        409,
        "ITINERARY_VERSION_CONFLICT",
        "preview_persistence",
      );
      return NextResponse.json(
        { error: "ITINERARY_VERSION_CONFLICT" },
        { status: 409 },
      );
    }

    return NextResponse.json({
      status: "ready",
      expiresAt: saved.expiresAt,
      itinerary,
      revision: saved.revision,
      token: createRouteFinalizationToken(itineraryId, saved.revision),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "일정 경로 계산 실패";

    if (error instanceof RouteFinalizationTimeoutError) {
      logRouteFinalizationFailure(
        traceId,
        504,
        "ROUTE_FINALIZATION_TIMEOUT",
        "route_finalization",
      );
      return NextResponse.json(
        { error: "ROUTE_FINALIZATION_TIMEOUT", message },
        { status: 504 },
      );
    }

    if (error instanceof RouteFinalizationError) {
      logRouteFinalizationFailure(
        traceId,
        422,
        error.internalCode,
        error.stage,
        error,
        candidate,
      );
      return NextResponse.json(
        { error: "ROUTE_FINALIZATION_FAILED", message },
        { status: 422 },
      );
    }

    logRouteFinalizationFailure(
      traceId,
      500,
      "PREVIEW_STORE_UNAVAILABLE",
      "route_finalization",
    );
    return NextResponse.json(
      { error: "PREVIEW_STORE_UNAVAILABLE" },
      { status: 500 },
    );
  } finally {
    try {
      await releasePreviewItineraryLock(itineraryId, lockOwner);
    } catch {
      logRouteFinalizationFailure(
        traceId,
        500,
        "PREVIEW_STORE_LOCK_RELEASE_FAILED",
        "lock_acquisition",
      );
    }
  }
}

/** Reads a valid cross-service trace id or creates a safe browser correlation id. */
function getRouteFinalizationTraceId(request: Request) {
  const providedTraceId = request.headers.get("x-planme-trace-id")?.trim() ?? "";

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    providedTraceId,
  )
    ? providedTraceId
    : randomUUID();
}

/** Emits stable route failure fields without logging the request payload or provider response. */
function logRouteFinalizationFailure(
  traceId: string,
  status: number,
  internalCode: string,
  stage: PlanmeWebFailureStage,
  error?: RouteFinalizationError,
  itinerary?: PlanmeItinerary,
) {
  console.error("PlanME route finalization failed", createPlanmeRouteFailureLog({
    error,
    event: "planme_route_finalization_failure",
    internalCode,
    itinerary,
    stage,
    status,
    traceId,
  }));
}

/** Validates that an edited payload cannot replace a different stored itinerary id. */
function isMatchingPlanmeItinerary(
  value: FinalizeRouteRequest["itinerary"],
  itineraryId: string,
): value is PlanmeItinerary {
  return Boolean(
    value?.id === itineraryId &&
      value.title &&
      value.region &&
      (value.transportMode === "drive" || value.transportMode === "transit") &&
      Array.isArray(value.days) &&
      value.days.length > 0,
  );
}

/** Hashes the request source so rate-limit storage never contains a raw client address. */
function createRequestSourceHash(request: Request) {
  const source = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}
