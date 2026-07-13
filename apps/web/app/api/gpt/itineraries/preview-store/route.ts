import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { PlanmeItinerary } from "@planme/core";
import { buildItineraryPageUrl, buildItineraryOgImageUrl } from "@planme/core";
import {
  RouteFinalizationError,
  RouteFinalizationTimeoutError,
  finalizeItineraryRoutes,
} from "@/lib/itinerary-route-finalizer";
import {
  acquirePreviewItineraryLock,
  getPreviewItineraryRecordById,
  releasePreviewItineraryLock,
  saveFinalizedPreviewItinerary,
} from "@/lib/preview-itinerary-store";
import {
  createPlanmeRouteFailureLog,
  type PlanmeWebFailureStage,
} from "@/lib/route-failure-observability";
import {
  mapRouteFinalizationPublicError,
  type RouteFinalizationPublicError,
} from "@/lib/route-finalization-public-error";

type PreviewStoreRequest = {
  baseRevision?: number;
  itinerary?: Partial<PlanmeItinerary>;
  timeoutMs?: number;
};

export const maxDuration = 45;

/** Finalizes and atomically stores an MCP-produced PlanME itinerary. */
export async function POST(request: Request) {
  const traceId = getPreviewStoreTraceId(request);

  if (!isAuthorizedInternalRequest(request)) {
    logPreviewStoreFailure(traceId, 401, "UNAUTHORIZED_INTERNAL_REQUEST", "authorization");
    return NextResponse.json(
      { error: "UNAUTHORIZED_INTERNAL_REQUEST" },
      { status: 401 },
    );
  }

  let body: PreviewStoreRequest;

  try {
    body = (await request.json()) as PreviewStoreRequest;
  } catch {
    logPreviewStoreFailure(traceId, 400, "INVALID_JSON", "request_validation");
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  if (!isPlanmeItinerary(body.itinerary)) {
    logPreviewStoreFailure(traceId, 400, "INVALID_ITINERARY", "request_validation");
    return NextResponse.json({ error: "INVALID_ITINERARY" }, { status: 400 });
  }

  if (body.timeoutMs !== undefined && (!Number.isInteger(body.timeoutMs) || body.timeoutMs <= 0)) {
    logPreviewStoreFailure(traceId, 400, "INVALID_TIMEOUT", "request_validation");
    return NextResponse.json({ error: "INVALID_ITINERARY" }, { status: 400 });
  }

  let currentRecord: Awaited<ReturnType<typeof getPreviewItineraryRecordById>>;

  try {
    currentRecord = await getPreviewItineraryRecordById(body.itinerary.id);
  } catch {
    logPreviewStoreFailure(traceId, 500, "PREVIEW_STORE_LOOKUP_FAILED", "record_lookup");
    return NextResponse.json(
      { error: "PREVIEW_STORE_UNAVAILABLE" },
      { status: 500 },
    );
  }

  // A generation handoff has no base revision. Once that deterministic ID is finalized,
  // replaying the same AI draft is idempotent and must never rewrite an existing link.
  if (body.baseRevision === undefined && currentRecord?.routeFinalized) {
    return NextResponse.json({
      status: "ready",
      itineraryId: currentRecord.itinerary.id,
      pageUrl: buildItineraryPageUrl(request.url, currentRecord.itinerary.id),
      ogImageUrl: buildItineraryOgImageUrl(request.url, currentRecord.itinerary.id),
      expiresAt: currentRecord.expiresAt,
      revision: currentRecord.revision,
      itinerary: currentRecord.itinerary,
    });
  }

  const expectedRevision = body.baseRevision ?? currentRecord?.revision ?? 0;

  if (body.baseRevision !== undefined && currentRecord?.revision !== body.baseRevision) {
    logPreviewStoreFailure(traceId, 409, "ITINERARY_VERSION_CONFLICT", "record_lookup");
    return NextResponse.json(
      { error: "ITINERARY_VERSION_CONFLICT" },
      { status: 409 },
    );
  }

  const lockOwner = randomUUID();
  let lockAcquired = false;

  try {
    lockAcquired = await acquirePreviewItineraryLock(body.itinerary.id, lockOwner);
  } catch {
    logPreviewStoreFailure(traceId, 500, "PREVIEW_STORE_LOCK_FAILED", "lock_acquisition");
    return NextResponse.json(
      { error: "PREVIEW_STORE_UNAVAILABLE" },
      { status: 500 },
    );
  }

  if (!lockAcquired) {
    logPreviewStoreFailure(traceId, 409, "ITINERARY_VERSION_CONFLICT", "lock_acquisition");
    return NextResponse.json(
      { error: "ITINERARY_VERSION_CONFLICT" },
      { status: 409 },
    );
  }

  try {
    const itinerary = await finalizeItineraryRoutes(body.itinerary, {
      allowTransitRecoverySmoke:
        request.headers.get("x-planme-transit-recovery-smoke") === "1",
      timeoutMs: Math.min(body.timeoutMs ?? 40_000, 40_000),
      traceId,
    });
    const savedPreview = await saveFinalizedPreviewItinerary(itinerary, expectedRevision);

    if (!savedPreview) {
      logPreviewStoreFailure(traceId, 409, "ITINERARY_VERSION_CONFLICT", "preview_persistence");
      return NextResponse.json(
        { error: "ITINERARY_VERSION_CONFLICT" },
        { status: 409 },
      );
    }

    return NextResponse.json({
      status: "ready",
      itineraryId: savedPreview.itineraryId,
      pageUrl: buildItineraryPageUrl(request.url, savedPreview.itineraryId),
      ogImageUrl: buildItineraryOgImageUrl(request.url, savedPreview.itineraryId),
      expiresAt: savedPreview.expiresAt,
      revision: savedPreview.revision,
      itinerary,
    });
  } catch (error) {
    if (
      error instanceof RouteFinalizationTimeoutError ||
      error instanceof RouteFinalizationError
    ) {
      const publicError = mapRouteFinalizationPublicError(error);
      logPreviewStoreFailure(
        traceId,
        publicError.httpStatus,
        error instanceof RouteFinalizationError
          ? error.internalCode
          : "ROUTE_FINALIZATION_TIMEOUT",
        error instanceof RouteFinalizationError ? error.stage : "route_finalization",
        error instanceof RouteFinalizationError ? error : undefined,
        body.itinerary,
      );
      return createPreviewStoreRouteFailureResponse(publicError);
    }

    logPreviewStoreFailure(
      traceId,
      500,
      "PREVIEW_STORE_UNAVAILABLE",
      "preview_persistence",
    );
    return NextResponse.json(
      {
        error: "PREVIEW_STORE_UNAVAILABLE",
        message: "PlanME generated itinerary store is unavailable.",
      },
      { status: 500 },
    );
  } finally {
    await releasePreviewItineraryLock(body.itinerary.id, lockOwner);
  }
}

/** Builds the preview-store route response while retaining its repair-required marker. */
export function createPreviewStoreRouteFailureResponse(
  publicError: RouteFinalizationPublicError,
) {
  if ("code" in publicError.body) {
    return NextResponse.json(
      { ...publicError.body, status: "repair_required" },
      { status: publicError.httpStatus },
    );
  }

  return NextResponse.json(publicError.body, { status: publicError.httpStatus });
}

/** Reads a valid cross-service trace id or creates a safe local replacement. */
function getPreviewStoreTraceId(request: Request) {
  const providedTraceId = request.headers.get("x-planme-trace-id")?.trim() ?? "";

  // Only UUIDs enter structured logs, preventing arbitrary request-header content from being logged.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    providedTraceId,
  )
    ? providedTraceId
    : randomUUID();
}

/** Writes only safe diagnostic fields needed to correlate MCP and web failures. */
function logPreviewStoreFailure(
  traceId: string,
  status: number,
  internalCode: string,
  stage: PlanmeWebFailureStage,
  error?: RouteFinalizationError,
  itinerary?: PlanmeItinerary,
) {
  console.error("PlanME preview store failure", createPlanmeRouteFailureLog({
    error,
    event: "planme_preview_store_failure",
    internalCode,
    itinerary,
    stage,
    status,
    traceId,
  }));
}

/** Compares the internal bearer token without leaking length or content through normal string checks. */
function isAuthorizedInternalRequest(request: Request) {
  const expectedToken = process.env.PLANME_INTERNAL_API_TOKEN?.trim();
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const providedToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (!expectedToken || !providedToken) {
    return false;
  }

  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(providedToken);

  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

/** Validates the minimum finalized-route input contract before provider calls. */
function isPlanmeItinerary(value: PreviewStoreRequest["itinerary"]): value is PlanmeItinerary {
  return Boolean(
    value?.id &&
      value.title &&
      value.region &&
      value.duration &&
      (value.transportMode === "drive" || value.transportMode === "transit") &&
      Array.isArray(value.days) &&
      value.days.length > 0,
  );
}
