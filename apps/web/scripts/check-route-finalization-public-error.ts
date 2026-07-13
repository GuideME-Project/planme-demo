import assert from "node:assert/strict";
import { createPreviewStoreRouteFailureResponse } from "../app/api/gpt/itineraries/preview-store/route";
import { createTransitPreflightFailureResponse } from "../app/api/gpt/itineraries/transit-preflight/route";
import {
  RouteFinalizationError,
  RouteFinalizationTimeoutError,
} from "../lib/itinerary-route-finalizer";
import { computeOdsayTransitRoute } from "../lib/route-providers/odsay";
import { RouteProviderError } from "../lib/route-providers/types";
import { mapRouteFinalizationPublicError } from "../lib/route-finalization-public-error";

async function main() {
  assertPublicClassificationContract();
  await assertOdsayAuthenticationNormalizationContract();
  await assertHandlerResponseContract();
  console.log("PlanME route finalization public error contract passed");
}

function assertPublicClassificationContract() {
  const temporaryErrors = [
    createFinalizationError("NAVER_NETWORK_ERROR", true),
    createFinalizationError("NAVER_HTTP_408", true),
    createFinalizationError("NAVER_HTTP_503", true),
    createFinalizationError("500", true),
  ];

  for (const error of temporaryErrors) {
    const mapped = mapRouteFinalizationPublicError(error);

    assert.equal(mapped.httpStatus, 503);
    assert.deepEqual(mapped.body, {
      error: "ROUTE_PROVIDER_TEMPORARY_ERROR",
      retryable: true,
      stage: "route_calculation",
    });
    assert.doesNotMatch(JSON.stringify(mapped.body), new RegExp(error.internalCode));
  }

  for (const internalCode of ["NAVER_HTTP_429", "429", "PROVIDER_CALL_BUDGET_EXCEEDED"]) {
    const mapped = mapRouteFinalizationPublicError(
      createFinalizationError(internalCode, true),
    );

    assert.equal(mapped.httpStatus, 429);
    assert.deepEqual(mapped.body, {
      error: "RATE_LIMITED",
      retryable: true,
      stage: "route_calculation",
    });
  }

  for (const internalCode of [
    "NAVER_CONFIGURATION_MISSING",
    "ODSAY_AUTHENTICATION_FAILED",
    "ODSAY_HTTP_401",
    "TRANSIT_RECOVERY_CONFIGURATION_ERROR",
    "TRANSIT_RECOVERY_DISABLED",
  ]) {
    const mapped = mapRouteFinalizationPublicError(
      createFinalizationError(internalCode, false),
    );

    assert.equal(mapped.httpStatus, 503);
    assert.deepEqual(mapped.body, {
      error: "CONFIGURATION_ERROR",
      retryable: false,
      stage: "route_calculation",
    });
  }

  for (const internalCode of [
    "INVALID_NAVER_STOPS",
    "INVALID_TRANSIT_STOP_CONTRACT",
    "NAVER_GEOMETRY_MISSING",
    "ODSAY_ROUTE_MISSING",
    "ROUTE_TASK_RESULT_MISSING",
  ]) {
    const mapped = mapRouteFinalizationPublicError(
      createFinalizationError(internalCode, false),
    );

    assert.equal(mapped.httpStatus, 422);
    assert.deepEqual(mapped.body, {
      error: "RESULT_INVALID",
      retryable: false,
      stage: "route_calculation",
    });
  }

  assert.deepEqual(
    mapRouteFinalizationPublicError(new RouteFinalizationTimeoutError()),
    {
      body: {
        error: "ROUTE_FINALIZATION_TIMEOUT",
        retryable: true,
        stage: "route_calculation",
      },
      httpStatus: 504,
    },
  );

  assert.deepEqual(
    mapRouteFinalizationPublicError(
      new RouteFinalizationError("timeline contract detail", {
        internalCode: "CARRYME_DELIVERY_COUNT_INVALID",
        stage: "timeline_validation",
      }),
    ).body,
    {
      error: "RESULT_INVALID",
      retryable: false,
      stage: "itinerary_finalization",
    },
  );

  assert.deepEqual(
    mapRouteFinalizationPublicError(
      new RouteFinalizationError("coordinate contract detail", {
        internalCode: "ROUTE_STOP_COORDINATE_MISSING",
        stage: "coordinate_resolution",
      }),
    ).body,
    {
      error: "RESULT_INVALID",
      retryable: false,
      stage: "place_resolution",
    },
  );
}

async function assertOdsayAuthenticationNormalizationContract() {
  const originalApiKey = process.env.NEXT_PUBLIC_ODSAY_API_KEY;

  try {
    process.env.NEXT_PUBLIC_ODSAY_API_KEY = "test-odsay-key";
    await assert.rejects(
      () => computeOdsayTransitRoute(
        [
          {
            coordinate: { lat: 37.5, lng: 127 },
            id: "auth-origin",
            label: "출발지",
          },
          {
            coordinate: { lat: 35.18, lng: 129.08 },
            id: "auth-destination",
            label: "방문지",
          },
        ],
        new AbortController().signal,
        {
          fetchImpl: async () => new Response(
            JSON.stringify({ error: { code: "-8", message: "ApiKeyAuthFailed" } }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          ),
          skipRequestSpacing: true,
        },
      ),
      (error) =>
        error instanceof RouteProviderError &&
        error.code === "ODSAY_AUTHENTICATION_FAILED" &&
        error.retriable === false,
    );
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.NEXT_PUBLIC_ODSAY_API_KEY;
    } else {
      process.env.NEXT_PUBLIC_ODSAY_API_KEY = originalApiKey;
    }
  }
}

async function assertHandlerResponseContract() {
  const temporary = mapRouteFinalizationPublicError(
    createFinalizationError("ODSAY_HTTP_500", true),
  );
  const previewTemporaryResponse = createPreviewStoreRouteFailureResponse(temporary);

  assert.equal(previewTemporaryResponse.status, 503);
  assert.deepEqual(await previewTemporaryResponse.json(), {
    error: "ROUTE_PROVIDER_TEMPORARY_ERROR",
    retryable: true,
    stage: "route_calculation",
  });

  const rateLimited = mapRouteFinalizationPublicError(
    createFinalizationError("PROVIDER_CALL_BUDGET_EXCEEDED", true),
  );
  const preflightRateLimitResponse = createTransitPreflightFailureResponse(rateLimited);

  assert.equal(preflightRateLimitResponse.status, 429);
  assert.deepEqual(await preflightRateLimitResponse.json(), {
    error: "RATE_LIMITED",
    retryable: true,
    stage: "route_calculation",
  });

  const repair = mapRouteFinalizationPublicError(
    new RouteFinalizationError("provider repair detail", {
      dayIndex: 1,
      internalCode: "TRANSIT_PLACE_REPLACEMENT_REQUIRED",
      placeConstraint: "replaceable",
      routeId: "carryme",
      segmentIndex: 2,
      stage: "route_provider",
      stopRef: "day-2-stop-3",
      transitAccessReason: "destination_station_missing",
    }),
  );
  const previewRepairResponse = createPreviewStoreRouteFailureResponse(repair);
  const preflightRepairResponse = createTransitPreflightFailureResponse(repair);

  assert.equal(previewRepairResponse.status, 422);
  assert.deepEqual(await previewRepairResponse.json(), {
    code: "TRANSIT_PLACE_REPLACEMENT_REQUIRED",
    context: {
      dayIndex: 1,
      placeConstraint: "replaceable",
      reason: "destination_station_missing",
      routeId: "carryme",
      segmentIndex: 2,
      stopRef: "day-2-stop-3",
    },
    error: "ROUTE_REPAIR_REQUIRED",
    retryable: false,
    stage: "route_calculation",
    status: "repair_required",
  });
  assert.equal(preflightRepairResponse.status, 200);
  assert.deepEqual(await preflightRepairResponse.json(), {
    context: {
      dayIndex: 1,
      placeConstraint: "replaceable",
      reason: "destination_station_missing",
      routeId: "carryme",
      segmentIndex: 2,
      stopRef: "day-2-stop-3",
    },
    retryable: false,
    stage: "route_calculation",
    status: "replacement_required",
  });

  const preflightTimeoutResponse = createTransitPreflightFailureResponse(
    mapRouteFinalizationPublicError(new RouteFinalizationTimeoutError()),
  );

  assert.equal(preflightTimeoutResponse.status, 504);
  assert.deepEqual(await preflightTimeoutResponse.json(), {
    error: "ROUTE_PREFLIGHT_TIMEOUT",
    retryable: true,
    stage: "route_calculation",
  });
}

function createFinalizationError(internalCode: string, retriable: boolean) {
  return new RouteFinalizationError("provider body must stay private", {
    internalCode,
    provider: "odsay",
    retriable,
    stage: "route_provider",
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
