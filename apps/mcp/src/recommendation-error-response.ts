import {
  PlanmeAiConfigurationError,
  PlanmeDraftDomainContractError,
  PlanmeOpenAiError,
  PlanmePlaceSearchConfigurationError,
  PlanmePlaceSearchProviderError,
  PlanmeRequiredPlaceResolutionError,
} from "@planme/core";
import { ItineraryRecommendationFlowError } from "./itinerary-recommendation-flow.js";
import { NaverGeocodingProviderError } from "./naver-geocoding.js";
import { PreviewStoreHandoffError } from "./preview-store-handoff-error.js";

export const PLANME_PUBLIC_FAILURE_STAGES = [
  "configuration",
  "ai_request",
  "ai_provider",
  "ai_tool",
  "ai_output",
  "place_resolution",
  "domain_contract",
  "transit_preflight",
  "preview_store_handoff",
  "recommendation_flow",
] as const;

export type PlanmePublicFailureStage = (typeof PLANME_PUBLIC_FAILURE_STAGES)[number];

export const PLANME_COMPLETION_STAGES = [
  "input_interpretation",
  "ai_generation",
  "place_resolution",
  "route_calculation",
  "itinerary_finalization",
  "storage",
  "response_delivery",
] as const;

export type PlanmeCompletionStage = (typeof PLANME_COMPLETION_STAGES)[number];

export type PlanmeRecommendationFailure = {
  internalCode: string;
  message: string;
  publicError: "OPENAI_API_KEY_REQUIRED" | "PLANME_RECOMMENDATION_FAILED";
  retryable: boolean;
  stage: PlanmePublicFailureStage;
  upstreamStatus?: number;
};

export type PlanmePublicFailurePayload = {
  error: PlanmeRecommendationFailure["publicError"];
  message: string;
  retryable: boolean;
  stage: PlanmePublicFailureStage;
  status: "error";
  traceId: string;
};

/** Maps internal failures to a small public contract without exposing provider payloads. */
export function classifyPlanmeRecommendationFailure(
  error: Error,
): PlanmeRecommendationFailure {
  if (error instanceof PlanmeAiConfigurationError) {
    return createFailure("OPENAI_API_KEY_REQUIRED", "configuration", false, {
      publicError: "OPENAI_API_KEY_REQUIRED",
    });
  }

  if (error instanceof PlanmeOpenAiError) {
    return createFailure(
      stableInternalCode(error.code),
      mapOpenAiStage(error.stage),
      error.retryable,
      { upstreamStatus: error.status },
    );
  }

  if (error instanceof PlanmeRequiredPlaceResolutionError) {
    return createFailure(
      stableInternalCode(error.code),
      "place_resolution",
      error.retryable,
    );
  }

  if (error instanceof PlanmePlaceSearchConfigurationError) {
    return createFailure("PLACE_SEARCH_CONFIGURATION_ERROR", "configuration", false);
  }

  if (error instanceof PlanmePlaceSearchProviderError) {
    return createFailure(
      "PLACE_SEARCH_PROVIDER_ERROR",
      "place_resolution",
      isRetryableStatus(error.status),
      { upstreamStatus: error.status },
    );
  }

  if (error instanceof NaverGeocodingProviderError) {
    return createFailure(
      error.code,
      "place_resolution",
      error.retryable,
      { upstreamStatus: error.status },
    );
  }

  if (error instanceof PlanmeDraftDomainContractError) {
    return createFailure(error.code, "domain_contract", error.retryable);
  }

  if (error instanceof PreviewStoreHandoffError) {
    return createFailure(
      stableInternalCode(error.internalCode),
      mapPreviewStoreFailureStage(error.failureStage),
      error.retryable ?? (error.status === undefined || isRetryableStatus(error.status)),
      { upstreamStatus: error.status },
    );
  }

  if (error instanceof ItineraryRecommendationFlowError) {
    return createFailure(
      stableInternalCode(error.code),
      error.failureStage
        ? mapUpstreamFailureStage(error.failureStage)
        : mapRecommendationFlowStage(error.code),
      error.retryable ?? isRecommendationFlowRetryable(error.code),
      { upstreamStatus: error.upstreamStatus },
    );
  }

  return createFailure("PLANME_RECOMMENDATION_FLOW_FAILED", "recommendation_flow", true);
}

/** Creates the identical safe failure payload used by GPTs Actions and the ChatGPT App. */
export function createPlanmePublicFailurePayload(
  failure: PlanmeRecommendationFailure,
  traceId: string,
): PlanmePublicFailurePayload {
  return {
    error: failure.publicError,
    message: failure.message,
    retryable: failure.retryable,
    stage: failure.stage,
    status: "error",
    traceId,
  };
}

/** Emits only stable operational fields that can be correlated by trace ID. */
export function logPlanmeRecommendationFailure(
  channel: "apps" | "gpts",
  traceId: string,
  failure: PlanmeRecommendationFailure,
): void {
  console.error("PlanME recommendation failure", {
    channel,
    completionStage: mapPlanmeFailureToCompletionStage(failure),
    event: "planme_recommendation_failure",
    internalCode: failure.internalCode,
    retryable: failure.retryable,
    stage: failure.stage,
    traceId,
    upstreamStatus: failure.upstreamStatus,
  });
}

/** Maps internal failure categories onto the completion-criteria stages used in operations. */
export function mapPlanmeFailureToCompletionStage(
  failure: PlanmeRecommendationFailure,
): PlanmeCompletionStage {
  switch (failure.stage) {
    case "ai_request":
    case "ai_provider":
    case "ai_tool":
    case "ai_output":
      return "ai_generation";
    case "place_resolution":
      return "place_resolution";
    case "transit_preflight":
      return "route_calculation";
    case "domain_contract":
      return "itinerary_finalization";
    case "preview_store_handoff":
      return "storage";
    case "configuration":
      if (/PLACE_SEARCH|GEOCOD/i.test(failure.internalCode)) {
        return "place_resolution";
      }

      if (/ODSAY|DIRECTION|ROUTE/i.test(failure.internalCode)) {
        return "route_calculation";
      }

      if (/INTERNAL_API_TOKEN|PREVIEW_STORE|WEB_ORIGIN/i.test(failure.internalCode)) {
        return "storage";
      }

      return "ai_generation";
    case "recommendation_flow":
      return "itinerary_finalization";
  }
}

/** Maps timed recommendation stages onto the same completion-criteria vocabulary. */
export function mapPlanmeMeasurementToCompletionStage(
  stage: "generation" | "persist" | "preflight",
): PlanmeCompletionStage {
  switch (stage) {
    case "generation":
      return "ai_generation";
    case "preflight":
      return "route_calculation";
    case "persist":
      return "storage";
  }
}

function createFailure(
  internalCode: string,
  stage: PlanmePublicFailureStage,
  retryable: boolean,
  options: {
    publicError?: PlanmeRecommendationFailure["publicError"];
    upstreamStatus?: number;
  } = {},
): PlanmeRecommendationFailure {
  return {
    internalCode,
    message:
      stage === "configuration"
        ? "PlanME 서버 설정 오류로 일정 생성에 실패했습니다."
        : retryable
          ? "PlanME 내부 처리 단계에서 일정 생성에 실패했습니다. 잠시 후 다시 시도해 주세요."
          : "PlanME 내부 처리 단계에서 일정 생성에 실패했습니다. 추적 ID를 확인해 주세요.",
    publicError: options.publicError ?? "PLANME_RECOMMENDATION_FAILED",
    retryable,
    stage,
    upstreamStatus: options.upstreamStatus,
  };
}

function mapOpenAiStage(stage: PlanmeOpenAiError["stage"]): PlanmePublicFailureStage {
  switch (stage) {
    case "request":
      return "ai_request";
    case "provider_response":
      return "ai_provider";
    case "tool_execution":
      return "ai_tool";
    case "output_parsing":
      return "ai_output";
  }
}

function mapRecommendationFlowStage(code: string): PlanmePublicFailureStage {
  if (code === "GENERATION_DEADLINE_EXCEEDED") {
    return "ai_request";
  }

  if (
    code.startsWith("TRANSIT_") ||
    code === "ROUTE_REPAIR_REQUIRED" ||
    /^(ODSAY|NAVER|PROVIDER|ROUTE_PROVIDER|ROUTE_PREFLIGHT)_/.test(code)
  ) {
    return code.endsWith("CONFIGURATION_ERROR")
      ? "configuration"
      : "transit_preflight";
  }

  if (code.endsWith("_REQUIRED")) {
    return "configuration";
  }

  return "recommendation_flow";
}

function mapPreviewStoreFailureStage(
  stage: PreviewStoreHandoffError["failureStage"],
): PlanmePublicFailureStage {
  if (stage === "route_calculation") {
    return "transit_preflight";
  }

  if (stage === "place_resolution") {
    return "place_resolution";
  }

  if (stage === "itinerary_finalization") {
    return "domain_contract";
  }

  return "preview_store_handoff";
}

function mapUpstreamFailureStage(
  stage: NonNullable<ItineraryRecommendationFlowError["failureStage"]>,
): PlanmePublicFailureStage {
  if (stage === "route_calculation") {
    return "transit_preflight";
  }

  if (stage === "place_resolution") {
    return "place_resolution";
  }

  return "domain_contract";
}

function isRecommendationFlowRetryable(code: string): boolean {
  return !(
    code.endsWith("_REQUIRED") ||
    code.endsWith("CONFIGURATION_ERROR")
  );
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function stableInternalCode(value: string): string {
  return /^[A-Z][A-Z0-9_]{2,80}$/.test(value)
    ? value
    : "PLANME_RECOMMENDATION_FLOW_FAILED";
}
