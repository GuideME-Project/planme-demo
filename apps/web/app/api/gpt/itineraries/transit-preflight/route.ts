import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { PlanmeItinerary } from "@planme/core";
import {
  ROUTE_FINALIZATION_TIMEOUT_MS,
  RouteFinalizationError,
  RouteFinalizationTimeoutError,
  preflightTransitItineraryRoutes,
} from "@/lib/itinerary-route-finalizer";
import {
  mapRouteFinalizationPublicError,
  type RouteFinalizationPublicError,
} from "@/lib/route-finalization-public-error";

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
    if (
      error instanceof RouteFinalizationTimeoutError ||
      error instanceof RouteFinalizationError
    ) {
      const publicError = mapRouteFinalizationPublicError(error);

      if ("code" in publicError.body) {
        return createTransitPreflightFailureResponse(publicError);
      }

      console.error("PlanME transit preflight failed", {
        event: "planme_transit_preflight_failure",
        internalCode:
          error instanceof RouteFinalizationError
            ? error.internalCode
            : "ROUTE_FINALIZATION_TIMEOUT",
        status: publicError.httpStatus,
        traceId,
      });
      return createTransitPreflightFailureResponse(publicError);
    }

    return NextResponse.json(
      {
        error: "CONFIGURATION_ERROR",
        retryable: false,
        stage: "route_calculation",
      },
      { status: 503 },
    );
  }
}

/** Builds the transit-preflight response while preserving its repair decision status. */
export function createTransitPreflightFailureResponse(
  publicError: RouteFinalizationPublicError,
) {
  if ("code" in publicError.body) {
    return NextResponse.json(
      {
        context: publicError.body.context,
        retryable: false,
        stage: "route_calculation",
        status: publicError.repairStatus,
      },
      { status: 200 },
    );
  }

  if (publicError.body.error === "ROUTE_FINALIZATION_TIMEOUT") {
    return NextResponse.json(
      { ...publicError.body, error: "ROUTE_PREFLIGHT_TIMEOUT" },
      { status: 504 },
    );
  }

  return NextResponse.json(publicError.body, { status: publicError.httpStatus });
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
