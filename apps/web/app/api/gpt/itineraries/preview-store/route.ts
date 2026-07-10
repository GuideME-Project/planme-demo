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

type PreviewStoreRequest = {
  baseRevision?: number;
  itinerary?: Partial<PlanmeItinerary>;
};

export const maxDuration = 45;

/** Finalizes and atomically stores an MCP-produced PlanME itinerary. */
export async function POST(request: Request) {
  if (!isAuthorizedInternalRequest(request)) {
    return NextResponse.json(
      { error: "UNAUTHORIZED_INTERNAL_REQUEST" },
      { status: 401 },
    );
  }

  const body = (await request.json()) as PreviewStoreRequest;

  if (!isPlanmeItinerary(body.itinerary)) {
    return NextResponse.json({ error: "INVALID_ITINERARY" }, { status: 400 });
  }

  const currentRecord = await getPreviewItineraryRecordById(body.itinerary.id);
  const expectedRevision = body.baseRevision ?? currentRecord?.revision ?? 0;

  if (body.baseRevision !== undefined && currentRecord?.revision !== body.baseRevision) {
    return NextResponse.json(
      { error: "ITINERARY_VERSION_CONFLICT" },
      { status: 409 },
    );
  }

  const lockOwner = randomUUID();
  const lockAcquired = await acquirePreviewItineraryLock(body.itinerary.id, lockOwner);

  if (!lockAcquired) {
    return NextResponse.json(
      { error: "ITINERARY_VERSION_CONFLICT" },
      { status: 409 },
    );
  }

  try {
    const itinerary = await finalizeItineraryRoutes(body.itinerary);
    const savedPreview = await saveFinalizedPreviewItinerary(itinerary, expectedRevision);

    if (!savedPreview) {
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
    const safeMessage = error instanceof Error ? error.message : "일정 경로 계산 실패";

    if (error instanceof RouteFinalizationTimeoutError) {
      return NextResponse.json(
        { error: "ROUTE_FINALIZATION_TIMEOUT", message: safeMessage },
        { status: 504 },
      );
    }

    if (error instanceof RouteFinalizationError) {
      return NextResponse.json(
        { error: "ROUTE_FINALIZATION_FAILED", message: safeMessage },
        { status: 422 },
      );
    }

    console.error("PlanME finalized preview store failed", safeMessage);
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
