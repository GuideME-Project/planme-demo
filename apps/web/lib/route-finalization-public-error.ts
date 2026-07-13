import {
  RouteFinalizationError,
  RouteFinalizationTimeoutError,
} from "./itinerary-route-finalizer";

export type RouteCalculationPublicErrorCode =
  | "CONFIGURATION_ERROR"
  | "RATE_LIMITED"
  | "RESULT_INVALID"
  | "ROUTE_FINALIZATION_TIMEOUT"
  | "ROUTE_PROVIDER_TEMPORARY_ERROR";

export type RouteCalculationPublicErrorPayload = {
  error: RouteCalculationPublicErrorCode;
  retryable: boolean;
  stage: "itinerary_finalization" | "place_resolution" | "route_calculation";
};

export type RouteRepairPublicPayload = {
  code: "TRANSIT_PLACE_REPLACEMENT_REQUIRED" | "USER_PLACE_CONFIRMATION_REQUIRED";
  context: {
    dayIndex?: number;
    placeConstraint?: RouteFinalizationError["placeConstraint"];
    reason?: RouteFinalizationError["transitAccessReason"];
    routeId?: RouteFinalizationError["routeId"];
    segmentIndex?: number;
    stopRef?: string;
  };
  error: "ROUTE_REPAIR_REQUIRED";
  retryable: false;
  stage: "route_calculation";
};

export type RouteFinalizationPublicError = {
  body: RouteCalculationPublicErrorPayload | RouteRepairPublicPayload;
  httpStatus: 422 | 429 | 503 | 504;
  repairStatus?: "confirmation_required" | "replacement_required";
};

/** Maps internal provider diagnostics to the stable web API error contract. */
export function mapRouteFinalizationPublicError(
  error: RouteFinalizationError | RouteFinalizationTimeoutError,
): RouteFinalizationPublicError {
  if (error instanceof RouteFinalizationTimeoutError) {
    return createPublicError(
      "ROUTE_FINALIZATION_TIMEOUT",
      504,
      true,
      "route_calculation",
    );
  }

  if (isRepairError(error)) {
    return {
      body: {
        code: error.internalCode,
        context: {
          dayIndex: error.dayIndex,
          placeConstraint: error.placeConstraint,
          reason: error.transitAccessReason,
          routeId: error.routeId,
          segmentIndex: error.segmentIndex,
          stopRef: error.stopRef,
        },
        error: "ROUTE_REPAIR_REQUIRED",
        retryable: false,
        stage: "route_calculation",
      },
      httpStatus: 422,
      repairStatus:
        error.internalCode === "TRANSIT_PLACE_REPLACEMENT_REQUIRED"
          ? "replacement_required"
          : "confirmation_required",
    };
  }

  const code = error.internalCode.trim().toUpperCase();
  const stage = getPublicFailureStage(error);

  if (isRateLimitCode(code)) {
    return createPublicError("RATE_LIMITED", 429, true, stage);
  }

  if (isConfigurationCode(code)) {
    return createPublicError("CONFIGURATION_ERROR", 503, false, stage);
  }

  if (isTemporaryProviderCode(code) || error.retriable) {
    return createPublicError("ROUTE_PROVIDER_TEMPORARY_ERROR", 503, true, stage);
  }

  return createPublicError("RESULT_INVALID", 422, false, stage);
}

function createPublicError(
  error: RouteCalculationPublicErrorCode,
  httpStatus: RouteFinalizationPublicError["httpStatus"],
  retryable: boolean,
  stage: RouteCalculationPublicErrorPayload["stage"],
): RouteFinalizationPublicError {
  return {
    body: { error, retryable, stage },
    httpStatus,
  };
}

/** Separates coordinate resolution and timeline contracts from provider route failures. */
function getPublicFailureStage(
  error: RouteFinalizationError,
): RouteCalculationPublicErrorPayload["stage"] {
  if (error.stage === "coordinate_resolution") {
    return "place_resolution";
  }

  if (error.stage === "timeline_validation") {
    return "itinerary_finalization";
  }

  if (error.stage === "route_provider" || error.provider) {
    return "route_calculation";
  }

  const code = error.internalCode.toUpperCase();

  return /^(INVALID_(NAVER|ODSAY|TRANSIT)|NAVER_|ODSAY_|PROVIDER_|ROUTE_PROVIDER_|TRANSIT_RECOVERY_)/.test(
    code,
  )
    ? "route_calculation"
    : "itinerary_finalization";
}

function isRepairError(
  error: RouteFinalizationError,
): error is RouteFinalizationError & {
  internalCode: RouteRepairPublicPayload["code"];
} {
  return error.internalCode === "TRANSIT_PLACE_REPLACEMENT_REQUIRED" ||
    error.internalCode === "USER_PLACE_CONFIRMATION_REQUIRED";
}

function isRateLimitCode(code: string) {
  return code === "PROVIDER_CALL_BUDGET_EXCEEDED" ||
    code === "429" ||
    code.endsWith("_HTTP_429") ||
    code.includes("RATE_LIMIT");
}

function isConfigurationCode(code: string) {
  return code === "401" ||
    code === "403" ||
    code.includes("CONFIGURATION") ||
    code.includes("AUTH") ||
    code.includes("API_KEY") ||
    code.endsWith("_HTTP_401") ||
    code.endsWith("_HTTP_403") ||
    code === "TRANSIT_RECOVERY_DISABLED";
}

function isTemporaryProviderCode(code: string) {
  const httpStatusMatch = /_HTTP_(\d{3})$/.exec(code);
  const httpStatus = Number(httpStatusMatch?.[1]);

  return code.endsWith("_NETWORK_ERROR") ||
    code === "408" ||
    code === "500" ||
    code === "ROUTE_PROVIDER_UNCLASSIFIED_FAILURE" ||
    code === "TRANSIT_PREFLIGHT_FAILED" ||
    httpStatus === 408 ||
    httpStatus >= 500;
}
