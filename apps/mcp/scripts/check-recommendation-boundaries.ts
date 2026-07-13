import assert from "node:assert/strict";
import {
  getPlanmeItineraryById,
  PlanmeAiConfigurationError,
  PlanmeOpenAiError,
  PlanmeRequiredPlaceResolutionError,
  recordPlanmeUsageSafely,
  toGptActionItineraryResponse,
  type RecommendItineraryRequest,
} from "@planme/core";
import {
  createTransitPreflightClient,
  ItineraryRecommendationFlowError,
  recommendAndPersistItinerary,
} from "../src/itinerary-recommendation-flow.js";
import { PreviewStoreHandoffError } from "../src/preview-store-handoff-error.js";
import { persistItineraryForDetailPage } from "../src/planme-mcp.js";
import {
  classifyPlanmeRecommendationFailure,
  createPlanmePublicFailurePayload,
  mapPlanmeFailureToCompletionStage,
  mapPlanmeMeasurementToCompletionStage,
  PLANME_COMPLETION_STAGES,
  PLANME_PUBLIC_FAILURE_STAGES,
} from "../src/recommendation-error-response.js";

const requestUrl = "http://localhost:3000/api/gpt/itineraries/recommend";
const request: RecommendItineraryRequest = {
  destination: "부산",
  durationDays: 2,
  origin: "동탄",
  transportMode: "transit",
};

async function main(): Promise<void> {
  assertSafeFailureClassification();
  await assertTransitPreflightFailureBoundary();
  await assertPreviewStoreFailureBoundary();
  await assertUsageRecordingDoesNotBlockGeneration();
  await assertStageMeasurementContract();
  console.log("PlanME recommendation error and latency contract passed");
}

async function assertPreviewStoreFailureBoundary(): Promise<void> {
  const itinerary = getPlanmeItineraryById("busan-bts-1d1n");
  assert.ok(itinerary);
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.PLANME_INTERNAL_API_TOKEN;
  const originalOrigin = process.env.PLANME_WEB_ORIGIN;
  process.env.PLANME_INTERNAL_API_TOKEN = "boundary-test-token";
  process.env.PLANME_WEB_ORIGIN = "http://localhost:3000";

  try {
    for (const failure of [
      { code: "ROUTE_PROVIDER_TEMPORARY_ERROR", retryable: true, status: 503 },
      { code: "ROUTE_PROVIDER_RATE_LIMITED", retryable: true, status: 429 },
      { code: "ROUTE_PROVIDER_CONFIGURATION_ERROR", retryable: false, status: 503 },
    ]) {
      globalThis.fetch = async () => new Response(
        JSON.stringify({
          error: failure.code,
          retryable: failure.retryable,
          stage: "route_calculation",
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: failure.status,
        },
      );

      await assert.rejects(
        () => persistItineraryForDetailPage(
          itinerary,
          "00000000-0000-4000-8000-000000000307",
          1_000,
        ),
        (error: unknown) => {
          assert.ok(error instanceof PreviewStoreHandoffError);
          assert.equal(error.internalCode, failure.code);
          assert.equal(error.failureStage, "route_calculation");
          assert.equal(error.retryable, failure.retryable);
          assert.equal(error.status, failure.status);
          const classified = classifyPlanmeRecommendationFailure(error);
          assert.equal(classified.stage, "transit_preflight");
          assert.equal(classified.retryable, failure.retryable);
          assert.equal(mapPlanmeFailureToCompletionStage(classified), "route_calculation");
          return true;
        },
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.PLANME_INTERNAL_API_TOKEN;
    } else {
      process.env.PLANME_INTERNAL_API_TOKEN = originalToken;
    }
    if (originalOrigin === undefined) {
      delete process.env.PLANME_WEB_ORIGIN;
    } else {
      process.env.PLANME_WEB_ORIGIN = originalOrigin;
    }
  }
}

async function assertTransitPreflightFailureBoundary(): Promise<void> {
  const itinerary = getPlanmeItineraryById("busan-bts-1d1n");
  assert.ok(itinerary);
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.PLANME_INTERNAL_API_TOKEN;
  process.env.PLANME_INTERNAL_API_TOKEN = "boundary-test-token";

  try {
    for (const failure of [
      {
        code: "ROUTE_PROVIDER_TEMPORARY_ERROR",
        retryable: true,
        stage: "route_calculation",
        status: 503,
      },
      {
        code: "ROUTE_PROVIDER_RATE_LIMITED",
        retryable: true,
        stage: "route_calculation",
        status: 429,
      },
      {
        code: "ROUTE_PROVIDER_CONFIGURATION_ERROR",
        retryable: false,
        stage: "route_calculation",
        status: 503,
      },
      {
        code: "INVALID_TRANSIT_PREFLIGHT_REQUEST",
        retryable: false,
        stage: undefined,
        status: 400,
      },
    ]) {
      globalThis.fetch = async () => new Response(
        JSON.stringify({
          error: failure.code,
          retryable: failure.retryable,
          stage: failure.stage,
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: failure.status,
        },
      );

      await assert.rejects(
        () => createTransitPreflightClient(requestUrl)(
          { ...itinerary, transportMode: "transit" },
          "00000000-0000-4000-8000-000000000306",
          1_000,
        ),
        (error: unknown) => {
          assert.ok(error instanceof ItineraryRecommendationFlowError);
          assert.equal(error.code, failure.code);
          assert.equal(error.failureStage, "route_calculation");
          assert.equal(error.retryable, failure.retryable);
          assert.equal(error.upstreamStatus, failure.status);
          return true;
        },
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.PLANME_INTERNAL_API_TOKEN;
    } else {
      process.env.PLANME_INTERNAL_API_TOKEN = originalToken;
    }
  }
}

function assertSafeFailureClassification(): void {
  const providerFailure = classifyPlanmeRecommendationFailure(
    new PlanmeOpenAiError(
      "OPENAI_PROVIDER_ERROR",
      "provider_response",
      true,
      "provider payload sk-sensitive-token at 동탄호수공원",
      503,
    ),
  );
  const providerPayload = createPlanmePublicFailurePayload(
    providerFailure,
    "00000000-0000-4000-8000-000000000301",
  );

  assert.equal(providerPayload.error, "PLANME_RECOMMENDATION_FAILED");
  assert.equal(providerPayload.retryable, true);
  assert.equal(providerPayload.stage, "ai_provider");
  assert.equal(providerPayload.status, "error");
  assert.ok(PLANME_PUBLIC_FAILURE_STAGES.includes(providerPayload.stage));
  assert.equal(mapPlanmeFailureToCompletionStage(providerFailure), "ai_generation");
  assert.doesNotMatch(JSON.stringify(providerPayload), /sk-sensitive|동탄호수공원|provider payload/);

  const placeFailure = classifyPlanmeRecommendationFailure(
    new PlanmeRequiredPlaceResolutionError("PLACE_SEARCH_PROVIDER_ERROR", true),
  );
  assert.equal(placeFailure.stage, "place_resolution");
  assert.equal(placeFailure.retryable, true);
  assert.equal(mapPlanmeFailureToCompletionStage(placeFailure), "place_resolution");

  const unresolvedOriginFailure = classifyPlanmeRecommendationFailure(
    new PlanmeRequiredPlaceResolutionError("ORIGIN_PLACE_NOT_FOUND", false),
  );
  const unresolvedOriginPayload = createPlanmePublicFailurePayload(
    unresolvedOriginFailure,
    "00000000-0000-4000-8000-000000000303",
  );
  assert.equal(unresolvedOriginPayload.stage, "place_resolution");
  assert.equal(unresolvedOriginPayload.retryable, false);
  assert.doesNotMatch(
    JSON.stringify(unresolvedOriginPayload),
    /정확한 장소명|주소를 알려|동탄호수공원/,
  );

  const configurationFailure = classifyPlanmeRecommendationFailure(
    new PlanmeAiConfigurationError("secret configuration detail"),
  );
  assert.equal(configurationFailure.publicError, "OPENAI_API_KEY_REQUIRED");
  assert.equal(configurationFailure.stage, "configuration");
  assert.equal(configurationFailure.retryable, false);
  assert.doesNotMatch(configurationFailure.message, /secret configuration detail/);

  const handoffFailure = classifyPlanmeRecommendationFailure(
    new PreviewStoreHandoffError(
      "00000000-0000-4000-8000-000000000302",
      "PREVIEW_STORE_UNAVAILABLE",
      503,
    ),
  );
  assert.equal(handoffFailure.stage, "preview_store_handoff");
  assert.equal(handoffFailure.retryable, true);
  assert.equal(mapPlanmeFailureToCompletionStage(handoffFailure), "storage");

  const deadlineFailure = classifyPlanmeRecommendationFailure(
    new ItineraryRecommendationFlowError("GENERATION_DEADLINE_EXCEEDED"),
  );
  assert.equal(deadlineFailure.stage, "ai_request");
  assert.equal(deadlineFailure.retryable, true);
  assert.equal(mapPlanmeFailureToCompletionStage(deadlineFailure), "ai_generation");

  const internalTokenFailure = classifyPlanmeRecommendationFailure(
    new ItineraryRecommendationFlowError("PLANME_INTERNAL_API_TOKEN_REQUIRED"),
  );
  assert.equal(internalTokenFailure.stage, "configuration");
  assert.equal(internalTokenFailure.retryable, false);
  assert.equal(mapPlanmeFailureToCompletionStage(internalTokenFailure), "storage");

  const temporaryRouteFailure = classifyPlanmeRecommendationFailure(
    new ItineraryRecommendationFlowError("ROUTE_PROVIDER_TEMPORARY_ERROR", {
      failureStage: "route_calculation",
      retryable: true,
      upstreamStatus: 503,
    }),
  );
  assert.equal(temporaryRouteFailure.stage, "transit_preflight");
  assert.equal(temporaryRouteFailure.retryable, true);
  assert.equal(temporaryRouteFailure.upstreamStatus, 503);
  assert.equal(
    mapPlanmeFailureToCompletionStage(temporaryRouteFailure),
    "route_calculation",
  );

  const routeConfigurationFailure = classifyPlanmeRecommendationFailure(
    new ItineraryRecommendationFlowError("ROUTE_PROVIDER_CONFIGURATION_ERROR", {
      failureStage: "route_calculation",
      retryable: false,
      upstreamStatus: 503,
    }),
  );
  assert.equal(routeConfigurationFailure.stage, "transit_preflight");
  assert.equal(routeConfigurationFailure.retryable, false);
  assert.equal(
    mapPlanmeFailureToCompletionStage(routeConfigurationFailure),
    "route_calculation",
  );

  const routeHandoffFailure = classifyPlanmeRecommendationFailure(
    new PreviewStoreHandoffError(
      "00000000-0000-4000-8000-000000000305",
      "ROUTE_PROVIDER_RATE_LIMITED",
      429,
      undefined,
      { failureStage: "route_calculation", retryable: true },
    ),
  );
  assert.equal(routeHandoffFailure.stage, "transit_preflight");
  assert.equal(routeHandoffFailure.retryable, true);
  assert.equal(
    mapPlanmeFailureToCompletionStage(routeHandoffFailure),
    "route_calculation",
  );

  const finalizationHandoffFailure = classifyPlanmeRecommendationFailure(
    new PreviewStoreHandoffError(
      "00000000-0000-4000-8000-000000000308",
      "RESULT_INVALID",
      422,
      undefined,
      { failureStage: "itinerary_finalization", retryable: false },
    ),
  );
  assert.equal(finalizationHandoffFailure.stage, "domain_contract");
  assert.equal(finalizationHandoffFailure.retryable, false);
  assert.equal(
    mapPlanmeFailureToCompletionStage(finalizationHandoffFailure),
    "itinerary_finalization",
  );

  const coordinateHandoffFailure = classifyPlanmeRecommendationFailure(
    new PreviewStoreHandoffError(
      "00000000-0000-4000-8000-000000000309",
      "RESULT_INVALID",
      422,
      undefined,
      { failureStage: "place_resolution", retryable: false },
    ),
  );
  assert.equal(coordinateHandoffFailure.stage, "place_resolution");
  assert.equal(
    mapPlanmeFailureToCompletionStage(coordinateHandoffFailure),
    "place_resolution",
  );
  assert.deepEqual(
    ["generation", "preflight", "persist"].map((stage) =>
      mapPlanmeMeasurementToCompletionStage(
        stage as "generation" | "persist" | "preflight",
      ),
    ),
    ["ai_generation", "route_calculation", "storage"],
  );
  assert.ok(PLANME_COMPLETION_STAGES.includes("input_interpretation"));
  assert.ok(PLANME_COMPLETION_STAGES.includes("itinerary_finalization"));
  assert.ok(PLANME_COMPLETION_STAGES.includes("response_delivery"));
}

async function assertUsageRecordingDoesNotBlockGeneration(): Promise<void> {
  let releaseRecorder = () => undefined;
  let recorderSettled = false;
  const pendingRecorder = new Promise<void>((resolve) => {
    releaseRecorder = () => {
      recorderSettled = true;
      resolve();
    };
  });
  const returnValue = recordPlanmeUsageSafely(
    () => pendingRecorder,
    "openai_request",
  );

  assert.equal(returnValue, undefined);
  assert.equal(recorderSettled, false);
  releaseRecorder();
  await pendingRecorder;

  // A rejected diagnostic write is consumed and does not become an unhandled request failure.
  recordPlanmeUsageSafely(
    () => Promise.reject(new Error("diagnostic backend failed")),
    "itinerary_ready",
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function assertStageMeasurementContract(): Promise<void> {
  const itinerary = getPlanmeItineraryById("busan-bts-1d1n");
  assert.ok(itinerary);

  const stageEvents: string[] = [];
  const result = await recommendAndPersistItinerary(
    requestUrl,
    request,
    "00000000-0000-4000-8000-000000000303",
    {
      generate: async () => toGptActionItineraryResponse(itinerary, requestUrl),
      mode: "on",
      onStage: (event) => {
        stageEvents.push(`${event.stage}:${event.status}`);
        assert.ok(event.elapsedMs >= 0);
      },
      persist: async (candidate) => ({ itinerary: candidate }),
      preflight: async () => ({ estimatedSegmentCount: 1, status: "accessible" }),
    },
  );

  assert.equal(result.status, "ready");
  assert.deepEqual(stageEvents, [
    "generation:succeeded",
    "preflight:succeeded",
    "persist:succeeded",
  ]);

  const failedStageEvents: string[] = [];
  await assert.rejects(
    () => recommendAndPersistItinerary(
      requestUrl,
      request,
      "00000000-0000-4000-8000-000000000304",
      {
        generate: async () => toGptActionItineraryResponse(itinerary, requestUrl),
        mode: "on",
        onStage: (event) => {
          failedStageEvents.push(`${event.stage}:${event.status}`);
        },
        persist: async (candidate) => ({ itinerary: candidate }),
        preflight: async () => {
          throw new ItineraryRecommendationFlowError("TRANSIT_PREFLIGHT_REQUEST_FAILED");
        },
      },
    ),
    (error) =>
      error instanceof ItineraryRecommendationFlowError &&
      error.code === "TRANSIT_PREFLIGHT_REQUEST_FAILED",
  );
  assert.deepEqual(failedStageEvents, [
    "generation:succeeded",
    "preflight:failed",
  ]);
}

await main();
