import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { PlanmeItinerary } from "@planme/core";
import {
  ROUTE_FINALIZATION_TIMEOUT_MS,
  RouteFinalizationError,
  RouteFinalizationTimeoutError,
  preflightTransitItineraryRoutes,
} from "@/lib/itinerary-route-finalizer";

type TransitPreflightRequest = {
  itinerary?: Partial<PlanmeItinerary>;
  timeoutMs?: number;
};

export const maxDuration = 45;

/** Checks transit accessibility and warms the route cache without saving an itinerary. */
export async function POST(request: Request) {
  const traceId = getTraceId(request);

  if (!isAuthorizedInternalRequest(request)) {
    return NextResponse.json({ error: "UNAUTHORIZED_INTERNAL_REQUEST" }, { status: 401 });
  }

  let body: TransitPreflightRequest;

  try {
    body = await request.json() as TransitPreflightRequest;
  } catch {
    return NextResponse.json(
      { error: "INVALID_TRANSIT_PREFLIGHT_REQUEST" },
      { status: 400 },
    );
  }

  if (!isTransitItinerary(body.itinerary) || !isValidTimeout(body.timeoutMs)) {
    return NextResponse.json(
      { error: "INVALID_TRANSIT_PREFLIGHT_REQUEST" },
      { status: 400 },
    );
  }

  try {
    const result = await preflightTransitItineraryRoutes(body.itinerary, {
      allowTransitRecoverySmoke:
        request.headers.get("x-planme-transit-recovery-smoke") === "1",
      timeoutMs: Math.min(body.timeoutMs, ROUTE_FINALIZATION_TIMEOUT_MS),
      traceId,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RouteFinalizationTimeoutError) {
      return NextResponse.json({ error: "ROUTE_PREFLIGHT_TIMEOUT" }, { status: 504 });
    }

    if (error instanceof RouteFinalizationError) {
      if (
        error.internalCode === "TRANSIT_PLACE_REPLACEMENT_REQUIRED" ||
        error.internalCode === "USER_PLACE_CONFIRMATION_REQUIRED"
      ) {
        return NextResponse.json({
          context: {
            dayIndex: error.dayIndex,
            placeConstraint: error.placeConstraint,
            reason: error.transitAccessReason,
            routeId: error.routeId,
            segmentIndex: error.segmentIndex,
            stopRef: error.stopRef,
          },
          status:
            error.internalCode === "TRANSIT_PLACE_REPLACEMENT_REQUIRED"
              ? "replacement_required"
              : "confirmation_required",
        });
      }

      const status = error.internalCode === "PROVIDER_CALL_BUDGET_EXCEEDED"
        ? 429
        : error.internalCode === "INVALID_TRANSIT_STOP_CONTRACT" ||
            error.internalCode === "INVALID_TRANSIT_PREFLIGHT_REQUEST"
          ? 400
          : 503;
      const safeCode = status === 429
        ? "PROVIDER_CALL_BUDGET_EXCEEDED"
        : error.internalCode === "TRANSIT_RECOVERY_DISABLED"
          ? "TRANSIT_RECOVERY_DISABLED"
          : "ROUTE_PROVIDER_CONFIGURATION_ERROR";

      console.error("PlanME transit preflight failed", {
        event: "planme_transit_preflight_failure",
        internalCode: error.internalCode,
        status,
        traceId,
      });
      return NextResponse.json({ error: safeCode }, { status });
    }

    return NextResponse.json(
      { error: "ROUTE_PROVIDER_CONFIGURATION_ERROR" },
      { status: 503 },
    );
  }
}

function isTransitItinerary(
  value: TransitPreflightRequest["itinerary"],
): value is PlanmeItinerary {
  return Boolean(
    value?.id &&
      value.title &&
      value.region &&
      value.duration &&
      value.transportMode === "transit" &&
      Array.isArray(value.days) &&
      value.days.length > 0,
  );
}

function isValidTimeout(value: number | undefined): value is number {
  return Number.isInteger(value) && (value ?? 0) > 0;
}

function getTraceId(request: Request) {
  const value = request.headers.get("x-planme-trace-id")?.trim() ?? "";

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? value
    : randomUUID();
}

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
