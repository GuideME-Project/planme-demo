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
  const { itineraryId } = await context.params;
  const body = (await request.json()) as FinalizeRouteRequest;

  if (
    !Number.isInteger(body.baseRevision) ||
    typeof body.token !== "string" ||
    !verifyRouteFinalizationToken(body.token, itineraryId, Number(body.baseRevision))
  ) {
    return NextResponse.json({ error: "INVALID_FINALIZATION_TOKEN" }, { status: 401 });
  }

  const rateKey = `${itineraryId}:${createRequestSourceHash(request)}`;
  const rateAllowed = await consumePreviewFinalizationRateLimit(rateKey, 4, 5 * 60);

  if (!rateAllowed) {
    return NextResponse.json(
      { error: "ROUTE_FINALIZATION_RATE_LIMITED" },
      { status: 429 },
    );
  }

  const record = await getPreviewItineraryRecordById(itineraryId);

  if (!record) {
    return NextResponse.json({ error: "ITINERARY_NOT_FOUND" }, { status: 404 });
  }

  if (record.revision !== body.baseRevision) {
    return NextResponse.json(
      { error: "ITINERARY_VERSION_CONFLICT" },
      { status: 409 },
    );
  }

  const candidate = body.itinerary ?? record.itinerary;

  if (!isMatchingPlanmeItinerary(candidate, itineraryId)) {
    return NextResponse.json({ error: "INVALID_ITINERARY" }, { status: 400 });
  }

  const lockOwner = randomUUID();
  const lockAcquired = await acquirePreviewItineraryLock(itineraryId, lockOwner);

  if (!lockAcquired) {
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
    });
    const saved = await saveFinalizedPreviewItinerary(itinerary, record.revision);

    if (!saved) {
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
      return NextResponse.json(
        { error: "ROUTE_FINALIZATION_TIMEOUT", message },
        { status: 504 },
      );
    }

    if (error instanceof RouteFinalizationError) {
      return NextResponse.json(
        { error: "ROUTE_FINALIZATION_FAILED", message },
        { status: 422 },
      );
    }

    console.error("PlanME route finalization failed", message);
    return NextResponse.json(
      { error: "PREVIEW_STORE_UNAVAILABLE" },
      { status: 500 },
    );
  } finally {
    await releasePreviewItineraryLock(itineraryId, lockOwner);
  }
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
