import {
  createAiRecommendedItineraryResponse,
  isPlanmeClarificationResponse,
  normalizeRecommendItineraryRequest,
  removeReplaceableTransitStop,
  replaceTransitItineraryStop,
  toGptActionItineraryResponse,
  type AiRecommendedItineraryOptions,
  type GptActionItineraryResponse,
  type PlanmeClarificationResponse,
  type PlanmeItinerary,
  type PlanmeRecommendationResponse,
  type RecommendItineraryRequest,
  type ReplaceTransitStopOptions,
} from "@planme/core";
import { PreviewStoreHandoffError } from "./preview-store-handoff-error.js";

export type TransitPreflightContext = {
  dayIndex: number;
  placeConstraint: "fixed" | "replaceable";
  reason:
    | "destination_station_missing"
    | "origin_station_missing"
    | "walk_limit_exceeded"
    | "walk_path_missing";
  routeId: "carryme" | "standard";
  segmentIndex: number;
  stopRef: string;
};

export type TransitPreflightResult =
  | { estimatedSegmentCount: number; status: "accessible" }
  | { context: TransitPreflightContext; status: "confirmation_required" | "replacement_required" };

export type RecommendAndPersistResult =
  | { response: GptActionItineraryResponse; status: "ready" }
  | PlanmeClarificationResponse;

export type ItineraryRecommendationFlowOptions = {
  aiOptions?: AiRecommendedItineraryOptions;
  generate?: (
    requestUrl: string,
    input: RecommendItineraryRequest,
    options?: AiRecommendedItineraryOptions,
    signal?: AbortSignal,
  ) => Promise<PlanmeRecommendationResponse>;
  mode?: "off" | "on" | "smoke";
  now?: () => number;
  onStage?: (event: {
    elapsedMs: number;
    stage: "generation" | "persist" | "preflight";
    status: "failed" | "succeeded";
  }) => void;
  persist: (
    itinerary: PlanmeItinerary,
    traceId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<{ itinerary: PlanmeItinerary }>;
  preflight?: (
    itinerary: PlanmeItinerary,
    traceId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<TransitPreflightResult>;
  replacementOptions?: ReplaceTransitStopOptions;
};

export class ItineraryRecommendationFlowError extends Error {
  readonly failureStage?:
    | "itinerary_finalization"
    | "place_resolution"
    | "route_calculation";
  readonly retryable?: boolean;
  readonly stage = "recommendation_flow" as const;
  readonly upstreamStatus?: number;

  constructor(
    readonly code: string,
    options: {
      failureStage?: ItineraryRecommendationFlowError["failureStage"];
      retryable?: boolean;
      upstreamStatus?: number;
    } = {},
  ) {
    super(code);
    this.name = "ItineraryRecommendationFlowError";
    this.failureStage = options.failureStage;
    this.retryable = options.retryable;
    this.upstreamStatus = options.upstreamStatus;
  }
}

const RECOMMENDATION_BUDGET_MS = 55_000;
const GENERATION_BUDGET_MAX_MS = 22_000;
const WEB_ROUTE_BUDGET_MAX_MS = 40_000;
// Keep enough room for a complete web handoff instead of starting it at the serverless deadline.
const MINIMUM_FINAL_STORE_BUDGET_MS = 25_000;
const MAX_REPLACEMENT_ATTEMPTS_PER_STOP = 3;

type RecommendationDeadline = {
  controller: AbortController;
  deadline: number;
  now: () => number;
};

/** Runs generation, transit repair, and exactly one successful final-store call for both entrypoints. */
export async function recommendAndPersistItinerary(
  requestUrl: string,
  input: RecommendItineraryRequest,
  traceId: string,
  options: ItineraryRecommendationFlowOptions,
): Promise<RecommendAndPersistResult> {
  const now = options.now ?? Date.now;
  const deadline = now() + RECOMMENDATION_BUDGET_MS;
  const controller = new AbortController();
  const deadlineError = new ItineraryRecommendationFlowError(
    "RECOMMENDATION_DEADLINE_EXCEEDED",
  );
  const timeout = setTimeout(() => controller.abort(deadlineError), RECOMMENDATION_BUDGET_MS);

  try {
    return await recommendAndPersistWithinDeadline(
      requestUrl,
      input,
      traceId,
      options,
      { controller, deadline, now },
    );
  } finally {
    clearTimeout(timeout);

    // Cancel caller-aware provider work that may have outlived a raced stage.
    if (!controller.signal.aborted) {
      controller.abort();
    }
  }
}

async function recommendAndPersistWithinDeadline(
  requestUrl: string,
  input: RecommendItineraryRequest,
  traceId: string,
  options: ItineraryRecommendationFlowOptions,
  flow: RecommendationDeadline,
): Promise<RecommendAndPersistResult> {
  const { controller, deadline, now } = flow;
  const normalizedInput = normalizeRecommendItineraryRequest(input);
  const generationStartedAt = Date.now();
  const generationTimeoutMs = getStageTimeout(
    deadline,
    now,
    0,
    GENERATION_BUDGET_MAX_MS,
  );
  let generated: PlanmeRecommendationResponse;

  try {
    generated = await withStageTimeout(
      (signal) => {
        const generate = options.generate ?? (
          (
            currentRequestUrl: string,
            currentInput: RecommendItineraryRequest,
            aiOptions?: AiRecommendedItineraryOptions,
          ) => createAiRecommendedItineraryResponse(
            currentRequestUrl,
            currentInput,
            aiOptions,
          )
        );

        return generate(
          requestUrl,
          normalizedInput,
          {
            ...options.aiOptions,
            signal,
            timeoutMs: Math.min(
              generationTimeoutMs,
              options.aiOptions?.timeoutMs ?? generationTimeoutMs,
            ),
          },
          signal,
        );
      },
      generationTimeoutMs,
      "GENERATION_DEADLINE_EXCEEDED",
      controller,
    );
    assertFlowCanContinue(flow);
    options.onStage?.({
      elapsedMs: Date.now() - generationStartedAt,
      stage: "generation",
      status: "succeeded",
    });
  } catch (error) {
    options.onStage?.({
      elapsedMs: Date.now() - generationStartedAt,
      stage: "generation",
      status: "failed",
    });
    throw error;
  }

  if (isPlanmeClarificationResponse(generated)) {
    return generated;
  }

  let itinerary = generated.itinerary;
  const resolutionLogs = [...(generated.resolutionLogs ?? [])];
  const mode = options.mode ?? readRecoveryMode();
  const attemptsByStopRef = new Map<string, number>();
  const excludedRefsByStopRef = new Map<string, string[]>();
  const preflight = options.preflight ?? createTransitPreflightClient(requestUrl);

  if (normalizedInput.transportMode === "transit" && mode === "on") {
    let decision = await runPreflightStage(
      options,
      preflight,
      itinerary,
      traceId,
      getPreflightTimeout(deadline, now),
      flow,
    );

    while (decision.status !== "accessible") {
      if (decision.status === "confirmation_required") {
        return createFixedPlaceClarification(itinerary, decision.context);
      }

      const stopRef = decision.context.stopRef;
      const attempt = attemptsByStopRef.get(stopRef) ?? 0;

      if (attempt < MAX_REPLACEMENT_ATTEMPTS_PER_STOP) {
        const nextAttempt = (attempt + 1) as 1 | 2 | 3;
        const excludedPlaceSourceRefs = collectExcludedPlaceSourceRefs(
          itinerary,
          excludedRefsByStopRef.get(stopRef),
        );
        const replacement = await runReplacementStage(
          options,
          {
            attempt: nextAttempt,
            excludedPlaceSourceRefs,
            itinerary,
            request: normalizedInput,
            stopRef,
          },
          flow,
        );

        attemptsByStopRef.set(stopRef, nextAttempt);

        if (replacement.status === "replaced") {
          itinerary = replacement.itinerary;
          resolutionLogs.push(replacement.resolutionLog);
          excludedRefsByStopRef.set(
            stopRef,
            collectExcludedPlaceSourceRefs(itinerary, excludedPlaceSourceRefs),
          );
          decision = await runPreflightStage(
            options,
            preflight,
            itinerary,
            traceId,
            getPreflightTimeout(deadline, now),
            flow,
          );
          continue;
        }

        if (nextAttempt < MAX_REPLACEMENT_ATTEMPTS_PER_STOP) {
          continue;
        }
      }

      const removed = removeReplaceableTransitStop(itinerary, stopRef);

      if (removed.status === "no_visit_place_remained") {
        return createNoVisitPlaceClarification(stopRef);
      }

      itinerary = removed.itinerary;
      decision = await runPreflightStage(
        options,
        preflight,
        itinerary,
        traceId,
        getPreflightTimeout(deadline, now),
        flow,
      );
    }
  }

  const remainingStoreBudget = deadline - now();

  if (remainingStoreBudget < MINIMUM_FINAL_STORE_BUDGET_MS) {
    throw new ItineraryRecommendationFlowError("RECOMMENDATION_DEADLINE_EXCEEDED");
  }

  let persisted: { itinerary: PlanmeItinerary };

  try {
    persisted = await runPersistStage(
      options,
      itinerary,
      traceId,
      Math.min(remainingStoreBudget, WEB_ROUTE_BUDGET_MAX_MS),
      flow,
    );
  } catch (error) {
    if (
      mode !== "on" ||
      normalizedInput.transportMode !== "transit" ||
      !(error instanceof PreviewStoreHandoffError) ||
      !error.repairCode ||
      !error.repairContext
    ) {
      throw error;
    }

    if (error.repairCode === "USER_PLACE_CONFIRMATION_REQUIRED") {
      return createFixedPlaceClarification(itinerary, error.repairContext);
    }

    const stopRef = error.repairContext.stopRef;
    const attempt = attemptsByStopRef.get(stopRef) ?? 0;
    let repaired = false;

    if (attempt < MAX_REPLACEMENT_ATTEMPTS_PER_STOP) {
      const nextAttempt = (attempt + 1) as 1 | 2 | 3;
      const replacement = await runReplacementStage(
        options,
        {
          attempt: nextAttempt,
          excludedPlaceSourceRefs:
            collectExcludedPlaceSourceRefs(
              itinerary,
              excludedRefsByStopRef.get(stopRef),
            ),
          itinerary,
          request: normalizedInput,
          stopRef,
        },
        flow,
      );
      attemptsByStopRef.set(stopRef, nextAttempt);

      if (replacement.status === "replaced") {
        itinerary = replacement.itinerary;
        resolutionLogs.push(replacement.resolutionLog);
        repaired = true;
      }
    }

    if (!repaired) {
      const removed = removeReplaceableTransitStop(itinerary, stopRef);

      if (removed.status === "no_visit_place_remained") {
        return createNoVisitPlaceClarification(stopRef);
      }

      itinerary = removed.itinerary;
    }

    const safetyDecision = await runPreflightStage(
      options,
      preflight,
      itinerary,
      traceId,
      getPreflightTimeout(deadline, now),
      flow,
    );

    if (safetyDecision.status === "confirmation_required") {
      return createFixedPlaceClarification(itinerary, safetyDecision.context);
    }

    if (safetyDecision.status !== "accessible") {
      throw new ItineraryRecommendationFlowError("ROUTE_REPAIR_REQUIRED");
    }

    const safetyStoreBudget = deadline - now();

    if (safetyStoreBudget < MINIMUM_FINAL_STORE_BUDGET_MS) {
      throw new ItineraryRecommendationFlowError("RECOMMENDATION_DEADLINE_EXCEEDED");
    }

    persisted = await runPersistStage(
      options,
      itinerary,
      traceId,
      Math.min(safetyStoreBudget, WEB_ROUTE_BUDGET_MAX_MS),
      flow,
    );
  }
  const response = {
    ...toGptActionItineraryResponse(persisted.itinerary, requestUrl),
    resolutionLogs,
    validationIssues: generated.validationIssues,
  };

  return { response, status: "ready" };
}

/** Bounds one async stage and aborts every caller-aware provider on expiration. */
async function withStageTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  code: string,
  controller: AbortController,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectOnAbort: (() => void) | undefined;

  if (controller.signal.aborted) {
    throw getFlowAbortError(controller.signal, code);
  }

  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => {
            const error = new ItineraryRecommendationFlowError(code);

            controller.abort(error);
            reject(error);
          },
          timeoutMs,
        );
      }),
      new Promise<T>((_resolve, reject) => {
        rejectOnAbort = () => reject(getFlowAbortError(controller.signal, code));
        controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }

    if (rejectOnAbort) {
      controller.signal.removeEventListener("abort", rejectOnAbort);
    }
  }
}

/** Measures the final atomic handoff separately from AI generation. */
async function runPersistStage(
  options: ItineraryRecommendationFlowOptions,
  itinerary: PlanmeItinerary,
  traceId: string,
  timeoutMs: number,
  flow: RecommendationDeadline,
) {
  const startedAt = Date.now();

  try {
    const result = await withStageTimeout(
      (signal) => options.persist(itinerary, traceId, timeoutMs, signal),
      timeoutMs,
      "RECOMMENDATION_DEADLINE_EXCEEDED",
      flow.controller,
    );
    assertFlowCanContinue(flow);

    options.onStage?.({
      elapsedMs: Date.now() - startedAt,
      stage: "persist",
      status: "succeeded",
    });
    return result;
  } catch (error) {
    options.onStage?.({
      elapsedMs: Date.now() - startedAt,
      stage: "persist",
      status: "failed",
    });
    throw error;
  }
}

/** Measures every transit accessibility check without logging itinerary data. */
async function runPreflightStage(
  options: ItineraryRecommendationFlowOptions,
  preflight: NonNullable<ItineraryRecommendationFlowOptions["preflight"]>,
  itinerary: PlanmeItinerary,
  traceId: string,
  timeoutMs: number,
  flow: RecommendationDeadline,
) {
  const startedAt = Date.now();

  try {
    const result = await withStageTimeout(
      (signal) => preflight(itinerary, traceId, timeoutMs, signal),
      timeoutMs,
      "RECOMMENDATION_DEADLINE_EXCEEDED",
      flow.controller,
    );
    assertFlowCanContinue(flow);

    options.onStage?.({
      elapsedMs: Date.now() - startedAt,
      stage: "preflight",
      status: "succeeded",
    });
    return result;
  } catch (error) {
    options.onStage?.({
      elapsedMs: Date.now() - startedAt,
      stage: "preflight",
      status: "failed",
    });
    throw error;
  }
}

/** Reserves the final atomic store budget before any optional stop replacement starts. */
async function runReplacementStage(
  options: ItineraryRecommendationFlowOptions,
  input: Parameters<typeof replaceTransitItineraryStop>[0],
  flow: RecommendationDeadline,
) {
  const timeoutMs = getPreflightTimeout(flow.deadline, flow.now);

  return await withStageTimeout(
    (signal) => replaceTransitItineraryStop(
      input,
      {
        ...options.replacementOptions,
        placeCandidateSearcher:
          options.replacementOptions?.placeCandidateSearcher ??
          options.aiOptions?.placeCandidateSearcher,
        replacementQuerySuggester:
          options.replacementOptions?.replacementQuerySuggester ??
          options.aiOptions?.replacementQuerySuggester,
        usageRecorder:
          options.replacementOptions?.usageRecorder ?? options.aiOptions?.usageRecorder,
        signal,
        timeoutMs,
      },
    ),
    timeoutMs,
    "RECOMMENDATION_DEADLINE_EXCEEDED",
    flow.controller,
  );
}

/** Creates the authenticated, no-save web preflight client used in on mode. */
export function createTransitPreflightClient(requestUrl: string) {
  return async (
    itinerary: PlanmeItinerary,
    traceId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<TransitPreflightResult> => {
    const token = process.env.PLANME_INTERNAL_API_TOKEN?.trim();

    if (!token) {
      throw new ItineraryRecommendationFlowError("PLANME_INTERNAL_API_TOKEN_REQUIRED");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromFlow = () => controller.abort(signal?.reason);

    if (signal?.aborted) {
      abortFromFlow();
    } else {
      signal?.addEventListener("abort", abortFromFlow, { once: true });
    }

    try {
      const response = await fetch(
        new URL("/api/gpt/itineraries/transit-preflight", requestUrl),
        {
          body: JSON.stringify({ itinerary, timeoutMs }),
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-PlanME-Trace-Id": traceId,
          },
          method: "POST",
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const failure = await readStableError(response);
        throw new ItineraryRecommendationFlowError(failure.code, {
          failureStage: failure.failureStage,
          retryable: failure.retryable,
          upstreamStatus: response.status,
        });
      }

      return await response.json() as TransitPreflightResult;
    } catch (error) {
      if (error instanceof ItineraryRecommendationFlowError) {
        throw error;
      }

      throw new ItineraryRecommendationFlowError("TRANSIT_PREFLIGHT_REQUEST_FAILED");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromFlow);
    }
  };
}

function getStageTimeout(
  deadline: number,
  now: () => number,
  reservedMs: number,
  maxMs: number,
) {
  const remaining = deadline - now() - reservedMs;

  if (remaining <= 0) {
    throw new ItineraryRecommendationFlowError("RECOMMENDATION_DEADLINE_EXCEEDED");
  }

  return Math.min(remaining, maxMs);
}

function getPreflightTimeout(deadline: number, now: () => number) {
  return getStageTimeout(
    deadline,
    now,
    MINIMUM_FINAL_STORE_BUDGET_MS,
    WEB_ROUTE_BUDGET_MAX_MS,
  );
}

function assertFlowCanContinue(flow: RecommendationDeadline) {
  if (flow.controller.signal.aborted) {
    throw getFlowAbortError(
      flow.controller.signal,
      "RECOMMENDATION_DEADLINE_EXCEEDED",
    );
  }

  if (flow.deadline - flow.now() <= 0) {
    const error = new ItineraryRecommendationFlowError(
      "RECOMMENDATION_DEADLINE_EXCEEDED",
    );

    flow.controller.abort(error);
    throw error;
  }
}

function getFlowAbortError(signal: AbortSignal, fallbackCode: string) {
  return signal.reason instanceof ItineraryRecommendationFlowError
    ? signal.reason
    : new ItineraryRecommendationFlowError(fallbackCode);
}

function readRecoveryMode() {
  const mode = process.env.PLANME_TRANSIT_ACCESS_RECOVERY_MODE?.trim() || "on";

  if (mode === "off" || mode === "on" || mode === "smoke") {
    return mode;
  }

  throw new ItineraryRecommendationFlowError("TRANSIT_RECOVERY_CONFIGURATION_ERROR");
}

function collectExcludedPlaceSourceRefs(
  itinerary: PlanmeItinerary,
  previous: string[] = [],
) {
  return [...new Set(
    [
      ...previous,
      ...itinerary.days.flatMap((day) =>
        [...day.standard.stops, ...day.carryme.stops]
          .map((stop) => stop.placeSourceRef)
          .filter((value): value is string => Boolean(value)),
      ),
    ],
  )];
}

function findStopLabel(itinerary: PlanmeItinerary, stopRef: string) {
  for (const day of itinerary.days) {
    const stop = [...day.standard.stops, ...day.carryme.stops].find(
      (candidate) => candidate.stopRef === stopRef,
    );

    if (stop) {
      return stop.label;
    }
  }

  return "필수 방문 장소";
}

function createFixedPlaceClarification(
  itinerary: PlanmeItinerary,
  context: TransitPreflightContext,
): PlanmeClarificationResponse {
  const label = findStopLabel(itinerary, context.stopRef);
  const question = `${label}은 대중교통 접근 시간이 길 수 있습니다. 이 장소를 그대로 유지할지 알려주세요.`;

  return {
    clarificationContext: {
      previousAnswers: [],
      previousQuestions: [question],
      round: 0,
      unresolvedPlaces: [label],
    },
    message: "사용자가 지정한 장소의 대중교통 접근 여부를 확인해야 합니다.",
    questions: [question],
    resolutionLogs: [],
    status: "needs_clarification",
    unresolvedStops: [label],
    validationIssues: [
      {
        code: "user_place_confirmation_required",
        message: "고정 장소의 대중교통 접근 여부를 확인해야 합니다.",
        severity: "error",
      },
    ],
  };
}

function createNoVisitPlaceClarification(stopRef: string): PlanmeClarificationResponse {
  const question = "대중교통으로 방문할 지역이나 꼭 가고 싶은 장소를 하나 더 알려주세요.";

  return {
    clarificationContext: {
      previousAnswers: [],
      previousQuestions: [question],
      round: 0,
      unresolvedPlaces: [stopRef],
    },
    message: "대중교통으로 확정할 방문 장소가 남아 있지 않습니다.",
    questions: [question],
    resolutionLogs: [],
    status: "needs_clarification",
    unresolvedStops: [stopRef],
    validationIssues: [
      {
        code: "no_visit_place_remained",
        message: "대중교통 일정에 방문 장소가 하나 이상 필요합니다.",
        severity: "error",
      },
    ],
  };
}

async function readStableError(response: Response) {
  try {
    const body = await response.json() as {
      error?: string;
      retryable?: boolean;
      stage?: string;
    };
    const code = body.error?.trim() ?? "";

    return {
      code: /^[A-Z][A-Z0-9_]{2,80}$/.test(code)
        ? code
        : "TRANSIT_PREFLIGHT_FAILED",
      failureStage: parsePreflightFailureStage(body.stage),
      retryable:
        typeof body.retryable === "boolean"
          ? body.retryable
          : response.status === 408 || response.status === 429 || response.status >= 500,
    };
  } catch {
    return {
      code: "TRANSIT_PREFLIGHT_FAILED",
      failureStage: "route_calculation" as const,
      retryable: response.status === 408 || response.status === 429 || response.status >= 500,
    };
  }
}

/** A preflight response always belongs to a known processing stage, even from an older server. */
function parsePreflightFailureStage(
  stage: string | undefined,
): NonNullable<ItineraryRecommendationFlowError["failureStage"]> {
  if (
    stage === "itinerary_finalization" ||
    stage === "place_resolution" ||
    stage === "route_calculation"
  ) {
    return stage;
  }

  return "route_calculation";
}
