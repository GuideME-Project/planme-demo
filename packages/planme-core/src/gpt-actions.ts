import {
  createGeneratedItinerary,
  getPlanmeItineraryById,
  type GeneratedItineraryRequest,
} from "./generated-itineraries.js";
import {
  createPlanmeDraftPreview,
  type PlanmeDraftPreviewRequest,
  type PlanmeDraftPreviewResult,
  type PlanmeDraftValidationIssue,
} from "./draft-itineraries.js";
import type { PlanmeItinerary } from "./mock-data.js";
import {
  createOpenAiPlaceCandidateDecider,
  generatePlanmeDraftWithOpenAi,
  type AiItineraryGenerator,
} from "./openai-itinerary-generator.js";
import {
  searchAccommodationCandidates,
  type AccommodationCandidate,
  type AccommodationCandidateSearcher,
} from "./accommodation-candidates.js";
import {
  resolvePlanmeDraftCoordinates,
  type PlanmeDraftGeocoder,
} from "./draft-coordinate-resolution.js";
import {
  hasPlanmePlaceCandidateHardGate,
  searchPlanmePlaceCandidates,
  type PlanmePlaceCandidate,
  type PlanmePlaceCandidateSearcher,
} from "./place-candidates.js";
import {
  recordPlanmeUsageSafely,
  type PlanmeUsageRecorder,
} from "./usage-events.js";

export type RecommendItineraryRequest = GeneratedItineraryRequest & {
  previewId?: string;
  baseVersion?: number;
  title?: string;
  region?: string;
  duration?: string;
  summary?: string;
  assumptions?: string[];
  savedMinutes?: number;
  accommodationCandidates?: AccommodationCandidate[];
  clarificationAnswers?: string | string[];
  clarificationContext?: PlanmeClarificationContext;
  days?: PlanmeDraftPreviewRequest["days"];
  theme?: "light" | "dark";
};

export type GptActionItineraryResponse = {
  itineraryId: string;
  title: string;
  summary: string;
  standardTotalMinutes: number;
  carrymeTotalMinutes: number;
  savedMinutes: number;
  pageUrl: string;
  ogImageUrl: string;
  previewMarkdown: string;
  highlights: string[];
  itinerary: PlanmeItinerary;
  previewId?: string;
  resolutionLogs?: PlanmePlaceResolutionLog[];
  status?: PlanmeDraftPreviewResult["status"];
  validationIssues?: PlanmeDraftPreviewResult["validationIssues"];
  version?: number;
};

export type PlanmePlaceResolutionLog = {
  decisionStatus: PlanmePlaceDecisionStatus;
  originalName: string;
  reason: string;
  resolvedName?: string;
  query?: string;
  radiusMeters?: number;
  source: PlanmePlaceCandidate["source"];
};

export type PlanmePlaceDecisionStatus = "accepted" | "ambiguous" | "rejected";

export type PlanmePlaceCandidateDecision = {
  feedbackMessage?: string;
  finalAttempt?: boolean;
  questions?: string[];
  reason: string;
  selectedCandidateId?: string;
  status: PlanmePlaceDecisionStatus;
};

type ResolvableDraftStop = NonNullable<PlanmeDraftPreviewRequest["days"][number]["stops"]>[number];

export type PlanmeClarificationContext = {
  previousAnswers: string[];
  previousQuestions: string[];
  round: number;
  unresolvedPlaces: string[];
};

export type PlanmeClarificationResponse = {
  clarificationContext: PlanmeClarificationContext;
  feedbackMessage?: string;
  message: string;
  questions: string[];
  resolutionLogs: PlanmePlaceResolutionLog[];
  status: "needs_clarification";
  unresolvedStops: string[];
  validationIssues: PlanmeDraftValidationIssue[];
};

export type PlanmeRecommendationResponse =
  | GptActionItineraryResponse
  | PlanmeClarificationResponse;

export type AiRecommendedItineraryOptions = {
  aiItineraryGenerator?: AiItineraryGenerator;
  accommodationCandidateSearcher?: AccommodationCandidateSearcher;
  draftGeocoder?: PlanmeDraftGeocoder;
  googleMapsReferer?: string;
  placeCandidateDecider?: PlanmePlaceCandidateDecider;
  placeCandidateSearcher?: PlanmePlaceCandidateSearcher;
  usageRecorder?: PlanmeUsageRecorder;
};

export type PlanmePlaceCandidateDecider = (input: {
  candidates: PlanmePlaceCandidate[];
  finalAttempt: boolean;
  input: RecommendItineraryRequest;
  round: number;
  searchedQueries: string[];
  stop: ResolvableDraftStop;
}) => Promise<PlanmePlaceCandidateDecision>;

type RecommendedItineraryResponseOptions = {
  extraValidationIssues?: PlanmeDraftValidationIssue[];
  resolutionLogs?: PlanmePlaceResolutionLog[];
};

type PlaceReplacement = {
  originalName: string;
  replacementName: string;
};

/**
 * Builds an absolute PlanME itinerary page URL from the current API request origin.
 */
export function buildItineraryPageUrl(requestUrl: string, itineraryId: string): string {
  const url = new URL(requestUrl);

  // Custom GPT Actions require an HTTPS deployment, but localhost remains useful for verification.
  return new URL(`/itinerary/${itineraryId}`, url.origin).toString();
}

/**
 * Builds an absolute dynamic preview image URL for a PlanME itinerary.
 */
export function buildItineraryOgImageUrl(requestUrl: string, itineraryId: string): string {
  const url = new URL(requestUrl);

  // Keep a visible .png suffix so chat clients can classify the dynamic image URL more reliably.
  return new URL(`/og/itinerary/${itineraryId}.png`, url.origin).toString();
}

/**
 * Builds Markdown that ChatGPT can render directly as an itinerary preview image.
 */
export function buildItineraryPreviewMarkdown(ogImageUrl: string): string {
  // Keep this as a complete Markdown image so the GPT can copy it without formatting decisions.
  return `![PlanME 일정 미리보기](${ogImageUrl})`;
}

/**
 * Converts a PlanME itinerary into the compact response shape exposed to Custom GPT Actions.
 */
export function toGptActionItineraryResponse(
  itinerary: PlanmeItinerary,
  requestUrl: string,
): GptActionItineraryResponse {
  const firstDay = itinerary.days[0];
  const pageUrl = buildItineraryPageUrl(requestUrl, itinerary.id);
  const ogImageUrl = buildItineraryOgImageUrl(requestUrl, itinerary.id);
  const previewMarkdown = buildItineraryPreviewMarkdown(ogImageUrl);

  return {
    itineraryId: itinerary.id,
    title: itinerary.title,
    summary: itinerary.carrymeSaving,
    standardTotalMinutes: firstDay.standard.durationMinutes,
    carrymeTotalMinutes: firstDay.carryme.durationMinutes,
    savedMinutes: firstDay.savingMinutes,
    pageUrl,
    ogImageUrl,
    previewMarkdown,
    highlights: itinerary.benefits.map((benefit) => benefit.title),
    itinerary: {
      ...itinerary,
      detailUrl: pageUrl,
    },
  };
}

/**
 * Converts a ChatGPT-authored PlanME draft preview into the GPT Actions response shape.
 */
export function toDraftGptActionItineraryResponse(
  result: PlanmeDraftPreviewResult,
  requestUrl: string,
): GptActionItineraryResponse {
  const response = toGptActionItineraryResponse(result.itinerary, requestUrl);
  const pageUrl = buildItineraryPageUrl(requestUrl, result.previewId);

  // Draft previews use the same short detail URL shape as generated recommendations.
  return {
    ...response,
    itineraryId: result.previewId,
    ogImageUrl: buildItineraryOgImageUrl(requestUrl, result.previewId),
    previewMarkdown: buildItineraryPreviewMarkdown(
      buildItineraryOgImageUrl(requestUrl, result.previewId),
    ),
    pageUrl,
    itinerary: {
      ...response.itinerary,
      id: result.previewId,
      detailUrl: pageUrl,
    },
    previewId: result.previewId,
    status: result.status,
    validationIssues: result.validationIssues,
    version: result.version,
  };
}

/**
 * Creates a generated itinerary response for a GPT planning request.
 */
export function createRecommendedItineraryResponse(
  requestUrl: string,
  input: RecommendItineraryRequest,
  options: RecommendedItineraryResponseOptions = {},
) {
  if (hasDraftDays(input)) {
    const result = createPlanmeDraftPreview(toDraftPreviewRequest(input), {
      extraValidationIssues: options.extraValidationIssues,
    });

    // Recommendations with concrete ChatGPT stops should preserve those stops in the widget.
    return {
      ...toDraftGptActionItineraryResponse(result, requestUrl),
      resolutionLogs: options.resolutionLogs,
      input: {
        destination: input.destination ?? result.itinerary.region,
        durationDays: input.durationDays ?? result.itinerary.days.length,
        arrivalAirport: input.arrivalAirport ?? null,
        arrivalTime: input.arrivalTime ?? "09:30",
        hotelName: input.hotelName ?? null,
        origin: input.origin ?? null,
        travelerCount: input.travelerCount ?? 1,
        luggageCount: input.luggageCount ?? 1,
        preferences: input.preferences ?? [],
        theme: input.theme ?? "light",
        title: input.title ?? result.itinerary.title,
        region: input.region ?? result.itinerary.region,
        duration: input.duration ?? result.itinerary.duration,
        assumptions: input.assumptions ?? [],
      },
    };
  }

  const itinerary = createGeneratedItinerary(input);

  // Echo normalized request fields so GPT setup testing can confirm argument mapping.
  return {
    ...toGptActionItineraryResponse(itinerary, requestUrl),
    input: {
      destination: input.destination ?? itinerary.region,
      durationDays: input.durationDays ?? 2,
      arrivalAirport: input.arrivalAirport ?? null,
      arrivalTime: input.arrivalTime ?? "09:30",
      hotelName: input.hotelName ?? null,
      origin: input.origin ?? null,
      travelerCount: input.travelerCount ?? 1,
      luggageCount: input.luggageCount ?? 1,
      preferences: input.preferences ?? ["BTS 공연", "CarryME comparison"],
      theme: input.theme ?? "light",
    },
  };
}

/**
 * Creates a PlanME response from an AI-authored draft instead of local POI templates.
 */
export async function createAiRecommendedItineraryResponse(
  requestUrl: string,
  input: RecommendItineraryRequest,
  options: AiRecommendedItineraryOptions = {},
): Promise<PlanmeRecommendationResponse> {
  if (hasDraftDays(input)) {
    const resolution = await resolveDraftCoordinatesIfPossible(
      toDraftPreviewRequest(input),
      options.draftGeocoder,
    );
    const placeResolution = await resolveDraftPlaceCandidatesIfPossible(
      resolution.draft,
      input,
      options,
    );

    if (placeResolution.status === "needs_clarification") {
      await recordPlanmeUsageSafely(options.usageRecorder, "needs_clarification");
      return placeResolution;
    }

    const readyResponse = createRecommendedItineraryResponse(
      requestUrl,
      {
        ...input,
        title: placeResolution.draft.title,
        region: placeResolution.draft.region,
        duration: placeResolution.draft.duration,
        summary: placeResolution.draft.summary,
        origin: placeResolution.draft.origin ?? input.origin,
        assumptions: placeResolution.draft.assumptions ?? input.assumptions,
        savedMinutes: placeResolution.draft.savedMinutes ?? input.savedMinutes,
        days: placeResolution.draft.days,
      },
      {
        extraValidationIssues: createResolvedValidationIssues(
          resolution.validationIssues,
          placeResolution.validationIssues,
        ),
        resolutionLogs: placeResolution.resolutionLogs,
      },
    );

    await recordPlanmeUsageSafely(options.usageRecorder, "itinerary_ready");

    return readyResponse;
  }

  const aiItineraryGenerator = options.aiItineraryGenerator;
  const placeCandidateSearcher = createPlaceCandidateSearcher(options);
  const accommodationCandidateSearcher =
    options.accommodationCandidateSearcher ??
    ((searchInput) =>
      searchAccommodationCandidates(searchInput, {
        referer: options.googleMapsReferer,
      }));
  const accommodationCandidates = await resolveAccommodationCandidates(
    input,
    accommodationCandidateSearcher,
  );
  const generatorInput =
    accommodationCandidates.length > 0
      ? { ...input, accommodationCandidates }
      : input;
  const generatedDraft = aiItineraryGenerator
    ? await aiItineraryGenerator(generatorInput, {
        googleMapsReferer: options.googleMapsReferer,
        placeCandidateSearcher,
        usageRecorder: options.usageRecorder,
      })
    : await generatePlanmeDraftWithOpenAi(
        generatorInput,
        { usageRecorder: options.usageRecorder },
        {
          googleMapsReferer: options.googleMapsReferer,
          placeCandidateSearcher,
          usageRecorder: options.usageRecorder,
        },
      );
  const candidateDraft = applyAccommodationCandidatesToDraft(
    generatedDraft,
    accommodationCandidates,
  );
  const resolution = await resolveDraftCoordinatesIfPossible(
    candidateDraft,
    options.draftGeocoder,
  );
  const placeResolution = await resolveDraftPlaceCandidatesIfPossible(
    resolution.draft,
    input,
    options,
  );

  if (placeResolution.status === "needs_clarification") {
    await recordPlanmeUsageSafely(options.usageRecorder, "needs_clarification");
    return placeResolution;
  }

  const draft = placeResolution.draft;

  // OpenAI owns itinerary drafting; PlanME only validates and renders the returned draft.
  const readyResponse = createRecommendedItineraryResponse(
    requestUrl,
    {
      ...input,
      title: draft.title,
      region: draft.region,
      duration: draft.duration,
      summary: draft.summary,
      origin: draft.origin ?? input.origin,
      assumptions: draft.assumptions ?? input.assumptions,
      savedMinutes: draft.savedMinutes ?? input.savedMinutes,
      days: draft.days,
    },
    {
      extraValidationIssues: createResolvedValidationIssues(
        resolution.validationIssues,
        placeResolution.validationIssues,
      ),
      resolutionLogs: placeResolution.resolutionLogs,
    },
  );

  await recordPlanmeUsageSafely(options.usageRecorder, "itinerary_ready");

  return readyResponse;
}

/**
 * Distinguishes a generated PlanME response from a clarification prompt.
 */
export function isPlanmeClarificationResponse(
  response: PlanmeRecommendationResponse,
): response is PlanmeClarificationResponse {
  return response.status === "needs_clarification";
}

/**
 * Keeps ready itineraries free of stale geocoder warnings once Places replacement succeeded.
 */
function createResolvedValidationIssues(
  geocoderIssues: PlanmeDraftValidationIssue[],
  placeIssues: PlanmeDraftValidationIssue[],
) {
  return [
    ...geocoderIssues.filter((issue) => issue.code !== "coordinate_resolution_failed"),
    ...placeIssues.filter((issue) => issue.severity === "error"),
  ];
}

/**
 * Resolves draft coordinates only when the MCP server provides a geocoder.
 */
async function resolveDraftCoordinatesIfPossible(
  draft: PlanmeDraftPreviewRequest,
  geocoder?: PlanmeDraftGeocoder,
) {
  if (!geocoder) {
    return { draft, validationIssues: [] };
  }

  return resolvePlanmeDraftCoordinates(draft, geocoder);
}

/**
 * Guarantees draft stop coordinates only after a candidate decision passes hard gate.
 */
async function resolveDraftPlaceCandidatesIfPossible(
  draft: PlanmeDraftPreviewRequest,
  input: RecommendItineraryRequest,
  options: AiRecommendedItineraryOptions,
): Promise<
  | {
      draft: PlanmeDraftPreviewRequest;
      resolutionLogs: PlanmePlaceResolutionLog[];
      status: "resolved";
      validationIssues: PlanmeDraftValidationIssue[];
    }
  | PlanmeClarificationResponse
> {
  const searcher = createPlaceCandidateSearcher(options);
  const decider = createPlaceCandidateDecider(options);
  const resolutionLogs: PlanmePlaceResolutionLog[] = [];
  const validationIssues: PlanmeDraftValidationIssue[] = [];
  const unresolvedStops: string[] = [];
  const clarificationQuestions: string[] = [];
  const feedbackMessages: string[] = [];
  let center = findRepresentativeCoordinate(draft);
  const days: PlanmeDraftPreviewRequest["days"] = [];
  const round = normalizeClarificationRound(input);
  const isFinalAttempt = shouldUseFinalPlaceDecision(input);

  for (const day of draft.days) {
    const replacements: PlaceReplacement[] = [];

    const resolveStopList = async <T extends ResolvableDraftStop>(stopList: T[] | undefined) => {
      if (!stopList) {
        return undefined;
      }

      const resolvedStops: T[] = [];

      for (const stop of stopList) {
        if (stop.coordinate) {
          if (!hasDraftStopHardGate(stop)) {
            await recordPlanmeUsageSafely(options.usageRecorder, "hard_gate_failed");
            unresolvedStops.push(stop.name);
            validationIssues.push({
              code: "place_source_missing",
              message: `${stop.name} 좌표의 검색 출처를 확인하지 못했습니다.`,
              severity: "error",
            });
            resolvedStops.push(stop);
            continue;
          }

          if (shouldVerifyCoordinateStopWithCandidate(stop)) {
            const result = await searcher({
              center: stop.coordinate,
              destination: input.destination,
              preferences: input.preferences,
              region: draft.region ?? input.region,
              stop,
            });

            if (result.candidates.length === 0) {
              unresolvedStops.push(stop.name);
              validationIssues.push({
                code: "place_candidate_not_found",
                message: `${stop.name} 좌표는 있으나 실제 장소 후보를 확인하지 못했습니다.`,
                severity: "error",
              });
              resolvedStops.push(stop);
              continue;
            }

            const decision = await decider({
              candidates: result.candidates,
              finalAttempt: isFinalAttempt,
              input,
              round,
              searchedQueries: result.searchedQueries,
              stop,
            });
            const selectedCandidate = findSelectedPlaceCandidate(result.candidates, decision);
            const finalSelectedCandidate =
              isFinalAttempt && (decision.status !== "accepted" || !selectedCandidate)
                ? selectFinalCandidate(result.candidates)
                : selectedCandidate;
            const finalDecision =
              finalSelectedCandidate && (decision.status !== "accepted" || !selectedCandidate)
                ? createFinalPlaceCandidateDecision(stop.name, finalSelectedCandidate, decision)
                : decision;

            if (
              finalDecision.status !== "accepted" ||
              !finalSelectedCandidate ||
              !hasPlanmePlaceCandidateHardGate(finalSelectedCandidate)
            ) {
              if (finalDecision.status === "accepted") {
                await recordPlanmeUsageSafely(options.usageRecorder, "hard_gate_failed");
              }

              unresolvedStops.push(stop.name);
              if (!isFinalAttempt) {
                clarificationQuestions.push(...(finalDecision.questions ?? []));
              }
              if (finalDecision.feedbackMessage?.trim()) {
                feedbackMessages.push(finalDecision.feedbackMessage.trim());
              }
              validationIssues.push({
                code:
                  finalDecision.status === "accepted"
                    ? "place_candidate_hard_gate_failed"
                    : `place_candidate_${finalDecision.status}`,
                message: `${stop.name} 후보를 확정하지 못했습니다: ${finalDecision.reason}`,
                severity: "error",
              });
              resolutionLogs.push({
                decisionStatus: finalDecision.status,
                originalName: stop.name,
                reason: finalDecision.reason,
                source: result.candidates[0]?.source ?? "google_text_search",
              });
              resolvedStops.push(stop);
              continue;
            }

            const replacementStop = applyPlaceCandidateToStop(stop, finalSelectedCandidate);

            center ??= finalSelectedCandidate.coordinate;
            await recordFinalAiDecisionIfNeeded(finalDecision, options.usageRecorder);
            replacements.push({
              originalName: stop.name,
              replacementName: replacementStop.name,
            });
            resolutionLogs.push({
              decisionStatus: finalDecision.status,
              originalName: stop.name,
              query: finalSelectedCandidate.query,
              radiusMeters: finalSelectedCandidate.radiusMeters,
              reason: finalDecision.reason,
              resolvedName: replacementStop.name,
              source: finalSelectedCandidate.source,
            });
            validationIssues.push({
              code: "place_candidate_resolved",
              message: `${stop.name} 후보를 ${replacementStop.name}(으)로 확정했습니다.`,
              severity: "warning",
            });
            resolvedStops.push(replacementStop);
            continue;
          }

          center ??= stop.coordinate;
          resolvedStops.push(stop);
          continue;
        }

        const result = await searcher({
          center,
          destination: input.destination,
          preferences: input.preferences,
          region: draft.region ?? input.region,
          stop,
        });

        if (result.candidates.length === 0) {
          unresolvedStops.push(stop.name);
          validationIssues.push({
            code: "place_candidate_not_found",
            message: `${stop.name} 좌표를 확인하지 못했습니다.`,
            severity: "error",
          });
          resolvedStops.push(stop);
          continue;
        }

        const decision = await decider({
          candidates: result.candidates,
          finalAttempt: isFinalAttempt,
          input,
          round,
          searchedQueries: result.searchedQueries,
          stop,
        });
        const selectedCandidate = findSelectedPlaceCandidate(result.candidates, decision);

        const finalSelectedCandidate =
          isFinalAttempt && (decision.status !== "accepted" || !selectedCandidate)
            ? selectFinalCandidate(result.candidates)
            : selectedCandidate;
        const finalDecision =
          finalSelectedCandidate && (decision.status !== "accepted" || !selectedCandidate)
            ? createFinalPlaceCandidateDecision(stop.name, finalSelectedCandidate, decision)
            : decision;

        if (
          finalDecision.status !== "accepted" ||
          !finalSelectedCandidate ||
          !hasPlanmePlaceCandidateHardGate(finalSelectedCandidate)
        ) {
          if (finalDecision.status === "accepted") {
            await recordPlanmeUsageSafely(options.usageRecorder, "hard_gate_failed");
          }

          unresolvedStops.push(stop.name);
          if (!isFinalAttempt) {
            clarificationQuestions.push(...(finalDecision.questions ?? []));
          }
          if (finalDecision.feedbackMessage?.trim()) {
            feedbackMessages.push(finalDecision.feedbackMessage.trim());
          }
          validationIssues.push({
            code:
              finalDecision.status === "accepted"
                ? "place_candidate_hard_gate_failed"
                : `place_candidate_${finalDecision.status}`,
            message: `${stop.name} 후보를 확정하지 못했습니다: ${finalDecision.reason}`,
            severity: "error",
          });
          resolutionLogs.push({
            decisionStatus: finalDecision.status,
            originalName: stop.name,
            reason: finalDecision.reason,
            source: result.candidates[0]?.source ?? "google_text_search",
          });
          resolvedStops.push(stop);
          continue;
        }

        const replacementStop = applyPlaceCandidateToStop(stop, finalSelectedCandidate);

        center ??= finalSelectedCandidate.coordinate;
        await recordFinalAiDecisionIfNeeded(finalDecision, options.usageRecorder);
        replacements.push({
          originalName: stop.name,
          replacementName: replacementStop.name,
        });
        resolutionLogs.push({
          decisionStatus: finalDecision.status,
          originalName: stop.name,
          query: finalSelectedCandidate.query,
          radiusMeters: finalSelectedCandidate.radiusMeters,
          reason: finalDecision.reason,
          resolvedName: replacementStop.name,
          source: finalSelectedCandidate.source,
        });
        validationIssues.push({
          code: "place_candidate_resolved",
          message: `${stop.name} 후보를 ${replacementStop.name}(으)로 확정했습니다.`,
          severity: "warning",
        });
        resolvedStops.push(replacementStop);
      }

      return resolvedStops;
    };

    const standardStops = await resolveStopList(day.standardStops);
    const carrymeStops = await resolveStopList(day.carrymeStops);
    const stops = await resolveStopList(day.stops);

    days.push(applyPlaceReplacementCopy({ ...day, standardStops, carrymeStops, stops }, replacements));
  }

  if (unresolvedStops.length > 0) {
    const questions = createClarificationQuestions(clarificationQuestions, unresolvedStops);

    return {
      clarificationContext: {
        previousAnswers: normalizeClarificationAnswers(input),
        previousQuestions: questions,
        round,
        unresolvedPlaces: [...new Set(unresolvedStops)],
      },
      feedbackMessage: feedbackMessages[0],
      message: "일부 방문지의 실제 장소와 좌표를 확정하지 못했습니다.",
      questions,
      resolutionLogs,
      status: "needs_clarification",
      unresolvedStops: [...new Set(unresolvedStops)],
      validationIssues,
    };
  }

  return {
    draft: { ...draft, days },
    resolutionLogs,
    status: "resolved",
    validationIssues,
  };
}

/**
 * Checks already-coordinate-bearing stops against the same source hard gate.
 */
function hasDraftStopHardGate(
  stop: ResolvableDraftStop,
) {
  return Boolean(stop.coordinate && (stop.placeId?.trim() || stop.placeSourceRef?.trim()));
}

/**
 * Sends Naver-geocoded visit stops through candidate judgment before saving them.
 */
function shouldVerifyCoordinateStopWithCandidate(
  stop: ResolvableDraftStop,
) {
  return (stop.role === "방문지" || stop.role === "visit") && !stop.placeId?.trim();
}

/**
 * Builds the default Places searcher while keeping tests injectable.
 */
function createPlaceCandidateSearcher(options: AiRecommendedItineraryOptions) {
  return (
    options.placeCandidateSearcher ??
    ((searchInput) =>
      searchPlanmePlaceCandidates(searchInput, {
        referer: options.googleMapsReferer,
        usageRecorder: options.usageRecorder,
      }))
  );
}

/**
 * Uses an injected AI decision function, or falls back to a conservative clarification decision.
 */
function createPlaceCandidateDecider(
  options: AiRecommendedItineraryOptions,
): PlanmePlaceCandidateDecider {
  return (
    options.placeCandidateDecider ??
    createOpenAiPlaceCandidateDecider({ usageRecorder: options.usageRecorder })
  );
}

/**
 * Updates a draft stop with the selected coordinate-bearing Places candidate.
 */
function applyPlaceCandidateToStop<T extends ResolvableDraftStop>(
  stop: T,
  candidate: PlanmePlaceCandidate,
) {
  const displayName = selectDisplayNameForPlaceCandidate(stop.name, candidate);

  return {
    ...stop,
    addressQuery: candidate.address ?? stop.addressQuery,
    coordinate: candidate.coordinate,
    name: displayName,
    placeId: candidate.placeId,
    placeSource: candidate.source,
    placeSourceRef: candidate.sourceRef,
  };
}

/**
 * Keeps AI-authored place labels when provider candidates expose only a lot number or broad area.
 */
function selectDisplayNameForPlaceCandidate(
  originalName: string,
  candidate: PlanmePlaceCandidate,
) {
  const originalLabel = originalName.trim();
  const candidateLabel = candidate.name.trim();

  if (!candidateLabel) {
    return originalLabel;
  }

  if (!originalLabel) {
    return candidateLabel;
  }

  if (isLotNumberLikePlaceName(candidateLabel)) {
    return originalLabel;
  }

  if (
    isAdministrativePlaceName(candidateLabel) &&
    !normalizeComparableText(originalLabel).includes(normalizeComparableText(candidateLabel))
  ) {
    return originalLabel;
  }

  return candidateLabel;
}

/**
 * Detects provider labels like `62-15` that are useful as an address but poor as display names.
 */
function isLotNumberLikePlaceName(value: string) {
  return /^\d+(?:-\d+)?$/.test(value.trim());
}

/**
 * Detects broad administrative labels that should not replace a specific POI name.
 */
function isAdministrativePlaceName(value: string) {
  return /(특별시|광역시|특별자치시|특별자치도|도|시|군|구|읍|면|동|리)$/.test(value.trim());
}

/**
 * Finds the model-selected candidate without treating provider rank as an acceptance signal.
 */
function findSelectedPlaceCandidate(
  candidates: PlanmePlaceCandidate[],
  decision: PlanmePlaceCandidateDecision,
) {
  if (!decision.selectedCandidateId?.trim()) {
    return null;
  }

  return (
    candidates.find(
      (candidate) =>
        candidate.candidateId === decision.selectedCandidateId ||
        candidate.id === decision.selectedCandidateId,
    ) ?? null
  );
}

/**
 * Keeps clarification rounds bounded by the MCP contract.
 */
function normalizeClarificationRound(input: RecommendItineraryRequest) {
  const currentRound = input.clarificationContext?.round ?? 0;

  return Math.min(currentRound + 1, 2);
}

/**
 * Uses the second clarification follow-up as the final internal AI attempt.
 */
function shouldUseFinalPlaceDecision(input: RecommendItineraryRequest) {
  return (input.clarificationContext?.round ?? 0) >= 2;
}

/**
 * Selects a final candidate only when the hard gate can still be satisfied.
 */
function selectFinalCandidate(candidates: PlanmePlaceCandidate[]) {
  return candidates.find(hasPlanmePlaceCandidateHardGate) ?? null;
}

/**
 * Converts a still-ambiguous second-round decision into a final accepted decision with evidence.
 */
function createFinalPlaceCandidateDecision(
  originalName: string,
  candidate: PlanmePlaceCandidate,
  decision: PlanmePlaceCandidateDecision,
): PlanmePlaceCandidateDecision {
  return {
    feedbackMessage: decision.feedbackMessage,
    finalAttempt: true,
    questions: [],
    reason: `2라운드 이후 마지막 검색 후보 중 hard gate를 통과한 ${candidate.name}을(를) 내부 AI 최후 확정으로 선택했습니다. 이전 판단: ${decision.reason || originalName}`,
    selectedCandidateId: candidate.candidateId,
    status: "accepted",
  };
}

/**
 * Counts only the final two-round fallback decision, not ordinary accepted candidates.
 */
async function recordFinalAiDecisionIfNeeded(
  decision: PlanmePlaceCandidateDecision,
  usageRecorder?: PlanmeUsageRecorder,
) {
  if (!decision.finalAttempt) {
    return;
  }

  await recordPlanmeUsageSafely(usageRecorder, "final_ai_decision");
}

/**
 * Normalizes single or repeated user answers into the context shape.
 */
function normalizeClarificationAnswers(input: RecommendItineraryRequest) {
  const newAnswers = Array.isArray(input.clarificationAnswers)
    ? input.clarificationAnswers
    : input.clarificationAnswers
      ? [input.clarificationAnswers]
      : [];

  return [
    ...(input.clarificationContext?.previousAnswers ?? []),
    ...newAnswers.map((answer) => answer.trim()).filter(Boolean),
  ];
}

/**
 * Returns at most two user-facing questions for ChatGPT to ask in conversation.
 */
function createClarificationQuestions(candidateQuestions: string[], unresolvedStops: string[]) {
  const questions = candidateQuestions.map((question) => question.trim()).filter(Boolean);

  if (questions.length > 0) {
    return [...new Set(questions)].slice(0, 2);
  }

  return [...new Set(unresolvedStops)]
    .slice(0, 2)
    .map((place) => `${place}은(는) 실제 장소 후보를 확정하지 못했습니다.`);
}

/**
 * Keeps visible route and timeline copy aligned with automatically replaced stops.
 */
function applyPlaceReplacementCopy(
  day: PlanmeDraftPreviewRequest["days"][number],
  replacements: PlaceReplacement[],
) {
  if (replacements.length === 0) {
    return day;
  }

  return {
    ...day,
    carrymeRouteText: replacePlaceNames(day.carrymeRouteText, replacements),
    standardRouteText: replacePlaceNames(day.standardRouteText, replacements),
    carrymeTimeline: replacePlaceNamesInTimeline(day.carrymeTimeline, replacements),
    standardTimeline: replacePlaceNamesInTimeline(day.standardTimeline, replacements),
    timeline: replacePlaceNamesInTimeline(day.timeline, replacements),
  };
}

/**
 * Replaces place names inside optional timeline variants without dropping absent legacy payloads.
 */
function replacePlaceNamesInTimeline(
  timeline: PlanmeDraftPreviewRequest["days"][number]["timeline"],
  replacements: PlaceReplacement[],
) {
  return timeline?.map((event) => ({
    ...event,
    description: replacePlaceNames(event.description, replacements) ?? event.description,
    title: replacePlaceNames(event.title, replacements) ?? event.title,
  }));
}

/**
 * Replaces literal model-authored place labels without trying to parse route grammar.
 */
function replacePlaceNames(
  value: string | undefined,
  replacements: PlaceReplacement[],
) {
  if (!value) {
    return value;
  }

  return replacements.reduce(
    (currentValue, replacement) =>
      currentValue.replaceAll(replacement.originalName, replacement.replacementName),
    value,
  );
}

/**
 * Chooses the best available coordinate for Nearby Search fallback.
 */
function findRepresentativeCoordinate(draft: PlanmeDraftPreviewRequest) {
  const stops = draft.days.flatMap((day) => [
    ...(day.standardStops ?? []),
    ...(day.carrymeStops ?? []),
    ...(day.stops ?? []),
  ]);

  return (
    stops.find((stop) => stop.role === "숙소" && stop.coordinate)?.coordinate ??
    stops.find((stop) => stop.role === "luggageDestination" && stop.coordinate)?.coordinate ??
    stops.find((stop) => stop.role === "finalDestination" && stop.coordinate)?.coordinate ??
    stops.find((stop) => stop.coordinate)?.coordinate
  );
}

/**
 * Resolves real lodging candidates only when the user did not already name a hotel.
 */
async function resolveAccommodationCandidates(
  input: RecommendItineraryRequest,
  searcher: AccommodationCandidateSearcher,
) {
  if (input.accommodationCandidates?.length) {
    return input.accommodationCandidates;
  }

  if (input.hotelName?.trim() || !(input.destination?.trim() || input.region?.trim())) {
    return [];
  }

  return searcher(input);
}

/**
 * Replaces generic lodging labels with a real candidate and keeps its map coordinate.
 */
function applyAccommodationCandidatesToDraft(
  draft: PlanmeDraftPreviewRequest,
  candidates: AccommodationCandidate[],
): PlanmeDraftPreviewRequest {
  const candidate = selectAccommodationCandidate(draft, candidates);

  if (!candidate) {
    return draft;
  }

  const region = draft.region?.trim() || "";

  return {
    ...draft,
    assumptions: [
      ...(draft.assumptions ?? []),
      `숙소 후보로 ${candidate.name} 사용`,
    ],
    days: draft.days.map((day) => ({
      ...day,
      standardRouteText: replaceGenericAccommodationText(
        day.standardRouteText ?? "",
        region,
        candidate.name,
      ),
      carrymeRouteText: replaceGenericAccommodationText(
        day.carrymeRouteText ?? "",
        region,
        candidate.name,
      ),
      standardStops: replaceAccommodationStops(day.standardStops, region, candidate),
      carrymeStops: replaceAccommodationStops(day.carrymeStops, region, candidate),
      stops: replaceAccommodationStops(day.stops, region, candidate),
      standardTimeline: replaceAccommodationTimeline(day.standardTimeline, region, candidate),
      carrymeTimeline: replaceAccommodationTimeline(day.carrymeTimeline, region, candidate),
      timeline: replaceAccommodationTimeline(day.timeline, region, candidate),
    })),
  };
}

/**
 * Creates a source reference for accommodation candidates selected before draft rendering.
 */
function createAccommodationCandidateSourceRef(candidate: AccommodationCandidate) {
  return [
    "google_text_search",
    candidate.placeId ?? candidate.id,
    candidate.name,
    candidate.coordinate.lat.toFixed(6),
    candidate.coordinate.lng.toFixed(6),
  ].join(":");
}

/**
 * Chooses the model-selected lodging candidate, falling back to the top search result.
 */
function selectAccommodationCandidate(
  draft: PlanmeDraftPreviewRequest,
  candidates: AccommodationCandidate[],
) {
  if (candidates.length === 0) {
    return null;
  }

  const stopNames = draft.days.flatMap((day) =>
    [
      ...(day.standardStops ?? []),
      ...(day.carrymeStops ?? []),
      ...(day.stops ?? []),
    ].map((stop) => stop.name),
  );
  const matchedCandidate = candidates.find((candidate) =>
    stopNames.some((stopName) => isSameAccommodationCandidate(stopName, candidate)),
  );

  return matchedCandidate ?? candidates[0] ?? null;
}

/**
 * Applies the selected accommodation candidate to any generated route stop list.
 */
function replaceAccommodationStops<
  T extends {
    coordinate?: AccommodationCandidate["coordinate"];
    name: string;
    placeId?: string;
    placeSource?: string;
    placeSourceRef?: string;
  },
>(
  stops: T[] | undefined,
  region: string,
  candidate: AccommodationCandidate,
) {
  return stops?.map((stop) => {
    if (
      isGenericAccommodationLabel(stop.name, region) ||
      isSameAccommodationCandidate(stop.name, candidate)
    ) {
      return {
        ...stop,
        name: candidate.name,
        coordinate: candidate.coordinate,
        placeId: candidate.placeId ?? candidate.id ?? stop.placeId,
        placeSource: "google_text_search",
        placeSourceRef: createAccommodationCandidateSourceRef(candidate),
      };
    }

    return stop;
  });
}

/**
 * Applies the selected accommodation candidate to any generated timeline list.
 */
function replaceAccommodationTimeline<
  T extends { description: string; title: string },
>(
  timeline: T[] | undefined,
  region: string,
  candidate: AccommodationCandidate,
) {
  return timeline?.map((event) => ({
    ...event,
    title: replaceGenericAccommodationText(event.title, region, candidate.name),
    description: replaceGenericAccommodationText(
      event.description,
      region,
      candidate.name,
    ),
  }));
}

/**
 * Detects whether a stop already refers to a specific accommodation candidate.
 */
function isSameAccommodationCandidate(value: string, candidate: AccommodationCandidate) {
  const normalizedValue = normalizeComparableText(value);

  return (
    normalizedValue === normalizeComparableText(candidate.name) ||
    normalizedValue === normalizeComparableText(candidate.address)
  );
}

/**
 * Detects generic lodging labels that should be replaced after real candidates are available.
 */
function isGenericAccommodationLabel(value: string, region: string) {
  const normalized = value.trim();

  if (!normalized) {
    return false;
  }

  const genericLabels = [
    "숙소",
    "숙소 확인 필요",
    region ? `${region} 숙소` : "",
    region ? `${region} 가족 숙소` : "",
  ].filter(Boolean);

  return genericLabels.includes(normalized) || /(인근|근처|가족)\s*숙소$/.test(normalized);
}

/**
 * Rewrites visible generic lodging copy to the selected real accommodation.
 */
function replaceGenericAccommodationText(value: string, region: string, replacement: string) {
  if (!value) {
    return value;
  }

  const regionPrefix = region ? `${escapeRegExp(region)}\\s*` : "";

  return value
    .replace(new RegExp(`${regionPrefix}숙소`, "g"), replacement)
    .replace(/숙소\s*확인\s*필요/g, replacement)
    .replace(/(?:인근|근처|가족)\s*숙소/g, replacement)
    .replace(/숙소/g, replacement);
}

/**
 * Creates a stable comparison key for model-authored labels and Places candidates.
 */
function normalizeComparableText(value: string) {
  return value.replace(/\s+/g, "").trim().toLowerCase();
}

/**
 * Escapes user-facing region text before building a targeted replacement pattern.
 */
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Detects whether the legacy recommendation endpoint received a concrete ChatGPT itinerary draft.
 */
function hasDraftDays(
  input: RecommendItineraryRequest,
): input is RecommendItineraryRequest & { days: PlanmeDraftPreviewRequest["days"] } {
  return Array.isArray(input.days) && input.days.length > 0;
}

/**
 * Maps a recommendation request with concrete days into the draft preview contract.
 */
function toDraftPreviewRequest(
  input: RecommendItineraryRequest & { days: PlanmeDraftPreviewRequest["days"] },
): PlanmeDraftPreviewRequest {
  return {
    previewId: input.previewId,
    baseVersion: input.baseVersion,
    title: input.title?.trim() || createDraftTitle(input),
    region: input.region?.trim() || input.destination?.trim(),
    duration: input.duration?.trim() || formatDurationDays(input.durationDays),
    summary: input.summary,
    origin: input.origin,
    assumptions: input.assumptions ?? input.preferences,
    savedMinutes: input.savedMinutes,
    days: input.days,
  };
}

/**
 * Creates a fallback title for ChatGPT draft data sent through the legacy recommendation tool.
 */
function createDraftTitle(input: RecommendItineraryRequest) {
  const destination = input.destination?.trim() || input.region?.trim() || "PlanME";

  return `PlanME ${destination} ${formatDurationDays(input.durationDays)} 초안`;
}

/**
 * Formats numeric trip days into the user-facing Korean trip length label.
 */
function formatDurationDays(durationDays: number | undefined) {
  if (!durationDays || durationDays <= 1) {
    return "당일";
  }

  return `${durationDays - 1}박 ${durationDays}일`;
}

/**
 * Finds a generated or demo itinerary and converts it for GPT Actions.
 */
export function getGptActionItineraryResponse(
  itineraryId: string,
  requestUrl: string,
): GptActionItineraryResponse | null {
  const itinerary = getPlanmeItineraryById(itineraryId);

  // Invalid ids are intentionally returned as null so Route Handlers can map them to 404.
  return itinerary ? toGptActionItineraryResponse(itinerary, requestUrl) : null;
}

/**
 * Creates a share-link response for a generated PlanME itinerary.
 */
export function createItineraryShareResponse(itineraryId: string, requestUrl: string) {
  const ogImageUrl = buildItineraryOgImageUrl(requestUrl, itineraryId);

  return {
    itineraryId,
    pageUrl: buildItineraryPageUrl(requestUrl, itineraryId),
    ogImageUrl,
    previewMarkdown: buildItineraryPreviewMarkdown(ogImageUrl),
    expiresAt: null,
  };
}
