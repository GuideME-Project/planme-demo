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
  ) => Promise<PlanmeRecommendationResponse>;
  mode?: "off" | "on" | "smoke";
  now?: () => number;
  persist: (
    itinerary: PlanmeItinerary,
    traceId: string,
    timeoutMs: number,
  ) => Promise<{ itinerary: PlanmeItinerary }>;
  preflight?: (
    itinerary: PlanmeItinerary,
    traceId: string,
    timeoutMs: number,
  ) => Promise<TransitPreflightResult>;
  replacementOptions?: ReplaceTransitStopOptions;
};

export class ItineraryRecommendationFlowError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ItineraryRecommendationFlowError";
  }
}

const RECOMMENDATION_BUDGET_MS = 55_000;
const WEB_ROUTE_BUDGET_MAX_MS = 40_000;
// A successful preflight fills the shared route cache; measured final-store handoff is about 2s.
const MINIMUM_FINAL_STORE_BUDGET_MS = 4_000;
const MAX_REPLACEMENT_ATTEMPTS_PER_STOP = 3;

/** Runs generation, transit repair, and exactly one successful final-store call for both entrypoints. */
export async function recommendAndPersistItinerary(
  requestUrl: string,
  input: RecommendItineraryRequest,
  traceId: string,
  options: ItineraryRecommendationFlowOptions,
): Promise<RecommendAndPersistResult> {
  const now = options.now ?? Date.now;
  const deadline = now() + RECOMMENDATION_BUDGET_MS;
  const normalizedInput = normalizeRecommendItineraryRequest(input);
  const generated = await (options.generate ?? createAiRecommendedItineraryResponse)(
    requestUrl,
    normalizedInput,
    options.aiOptions,
  );

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
    let decision = await preflight(
      itinerary,
      traceId,
      getPreflightTimeout(deadline, now),
    );

    while (decision.status !== "accessible") {
      if (decision.status === "confirmation_required") {
        return createFixedPlaceClarification(itinerary, decision.context);
      }

      const stopRef = decision.context.stopRef;
      const attempt = attemptsByStopRef.get(stopRef) ?? 0;

      if (attempt < MAX_REPLACEMENT_ATTEMPTS_PER_STOP) {
        const nextAttempt = (attempt + 1) as 1 | 2 | 3;
        const excludedPlaceSourceRefs = excludedRefsByStopRef.get(stopRef) ??
          findPlaceSourceRefs(itinerary, stopRef);
        const replacement = await replaceTransitItineraryStop(
          {
            attempt: nextAttempt,
            excludedPlaceSourceRefs,
            itinerary,
            request: normalizedInput,
            stopRef,
          },
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
          },
        );

        attemptsByStopRef.set(stopRef, nextAttempt);

        if (replacement.status === "replaced") {
          itinerary = replacement.itinerary;
          resolutionLogs.push(replacement.resolutionLog);
          excludedRefsByStopRef.set(stopRef, findPlaceSourceRefs(itinerary, stopRef));
          decision = await preflight(
            itinerary,
            traceId,
            getPreflightTimeout(deadline, now),
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
      decision = await preflight(
        itinerary,
        traceId,
        getPreflightTimeout(deadline, now),
      );
    }
  }

  const remainingStoreBudget = deadline - now();

  if (remainingStoreBudget < MINIMUM_FINAL_STORE_BUDGET_MS) {
    throw new ItineraryRecommendationFlowError("RECOMMENDATION_DEADLINE_EXCEEDED");
  }

  let persisted: { itinerary: PlanmeItinerary };

  try {
    persisted = await options.persist(
      itinerary,
      traceId,
      Math.min(remainingStoreBudget, WEB_ROUTE_BUDGET_MAX_MS),
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
      const replacement = await replaceTransitItineraryStop(
        {
          attempt: nextAttempt,
          excludedPlaceSourceRefs:
            excludedRefsByStopRef.get(stopRef) ?? findPlaceSourceRefs(itinerary, stopRef),
          itinerary,
          request: normalizedInput,
          stopRef,
        },
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
        },
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

    const safetyDecision = await preflight(
      itinerary,
      traceId,
      getPreflightTimeout(deadline, now),
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

    persisted = await options.persist(
      itinerary,
      traceId,
      Math.min(safetyStoreBudget, WEB_ROUTE_BUDGET_MAX_MS),
    );
  }
  const response = {
    ...toGptActionItineraryResponse(persisted.itinerary, requestUrl),
    resolutionLogs,
    validationIssues: generated.validationIssues,
  };

  return { response, status: "ready" };
}

/** Creates the authenticated, no-save web preflight client used in on mode. */
export function createTransitPreflightClient(requestUrl: string) {
  return async (
    itinerary: PlanmeItinerary,
    traceId: string,
    timeoutMs: number,
  ): Promise<TransitPreflightResult> => {
    const token = process.env.PLANME_INTERNAL_API_TOKEN?.trim();

    if (!token) {
      throw new ItineraryRecommendationFlowError("PLANME_INTERNAL_API_TOKEN_REQUIRED");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
        const body = await readStableError(response);
        throw new ItineraryRecommendationFlowError(body);
      }

      return await response.json() as TransitPreflightResult;
    } catch (error) {
      if (error instanceof ItineraryRecommendationFlowError) {
        throw error;
      }

      throw new ItineraryRecommendationFlowError("TRANSIT_PREFLIGHT_REQUEST_FAILED");
    } finally {
      clearTimeout(timeout);
    }
  };
}

function getPreflightTimeout(deadline: number, now: () => number) {
  const remaining = deadline - now() - MINIMUM_FINAL_STORE_BUDGET_MS;

  if (remaining <= 0) {
    throw new ItineraryRecommendationFlowError("RECOMMENDATION_DEADLINE_EXCEEDED");
  }

  return Math.min(remaining, WEB_ROUTE_BUDGET_MAX_MS);
}

function readRecoveryMode() {
  const mode = process.env.PLANME_TRANSIT_ACCESS_RECOVERY_MODE?.trim() || "off";

  if (mode === "off" || mode === "on" || mode === "smoke") {
    return mode;
  }

  throw new ItineraryRecommendationFlowError("TRANSIT_RECOVERY_CONFIGURATION_ERROR");
}

function findPlaceSourceRefs(itinerary: PlanmeItinerary, stopRef: string) {
  return [...new Set(
    itinerary.days.flatMap((day) =>
      [...day.standard.stops, ...day.carryme.stops]
        .filter((stop) => stop.stopRef === stopRef)
        .map((stop) => stop.placeSourceRef)
        .filter((value): value is string => Boolean(value)),
    ),
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
    const body = await response.json() as { error?: string };
    const code = body.error?.trim() ?? "";

    return /^[A-Z][A-Z0-9_]{2,80}$/.test(code)
      ? code
      : "TRANSIT_PREFLIGHT_FAILED";
  } catch {
    return "TRANSIT_PREFLIGHT_FAILED";
  }
}
