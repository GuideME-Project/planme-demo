import {
  createGeneratedItinerary,
  getPlanmeItineraryById,
  type GeneratedItineraryRequest,
} from "./generated-itineraries.js";
import {
  createPlanmeDraftPreview,
  type PlanmeDraftPreviewRequest,
  type PlanmeDraftPreviewResult,
  type PlanmeDraftRouteStop,
  type PlanmeDraftValidationIssue,
} from "./draft-itineraries.js";
import {
  normalizePlanmeDraftDomainContract,
  type PlanmeDraftDomainContractIssue,
} from "./itinerary-domain-contract.js";
import type {
  ItineraryDay,
  PlanmeItinerary,
  RoutePlan,
  RouteStop,
  TimelineEvent,
} from "./mock-data.js";
import {
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
  PlanmePlaceSearchConfigurationError,
  PlanmePlaceSearchProviderError,
  searchPlanmePlaceCandidates,
  selectPlanmeBroadOriginCandidate,
  selectPlanmeRequiredPlaceCandidate,
  type PlanmePlaceCandidate,
  type PlanmePlaceCandidateSearcher,
  type PlanmeRequiredPlaceKind,
  type PlanmeResolvedRequiredPlace,
  type PlanmeResolvedRequiredPlaces,
} from "./place-candidates.js";
import {
  recordPlanmeUsageSafely,
  type PlanmeUsageRecorder,
} from "./usage-events.js";

export type RecommendItineraryRequest = GeneratedItineraryRequest & {
  destinationType?: "region" | "place";
  mustVisitPlaces?: string[];
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

export const DEFAULT_RECOMMENDATION_DESTINATION_TYPE = "region" as const;

/** Applies the backward-compatible destination intent used by GPTs and Apps clients. */
export function normalizeRecommendItineraryRequest(
  input: RecommendItineraryRequest,
): RecommendItineraryRequest & { destinationType: "region" | "place" } {
  return {
    ...input,
    destinationType: input.destinationType ?? DEFAULT_RECOMMENDATION_DESTINATION_TYPE,
  };
}

export type GptActionItineraryResponse = {
  itineraryId: string;
  title: string;
  summary: string;
  standardTotalMinutes: number;
  carrymeTotalMinutes: number;
  savingStatus: "verified" | "hidden_estimated";
  savedMinutes?: number;
  days: GptActionItineraryDaySummary[];
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

export type GptActionRouteSummary = {
  durationMinutes: number;
  end: string;
  endTime?: string;
  start: string;
  startTime?: string;
};

export type GptActionLuggageDeliverySummary = {
  target: string;
  targetRole?: RouteStop["role"];
  time: string;
};

export type GptActionItineraryDaySummary = {
  carryme: GptActionRouteSummary;
  day: number;
  isFinalDay: boolean;
  label: string;
  luggageDelivery?: GptActionLuggageDeliverySummary;
  returnsToTripOrigin: boolean;
  sameEndpoints: boolean;
  savedMinutes?: number;
  savingStatus: "verified" | "hidden_estimated";
  standard: GptActionRouteSummary;
};

export type PlanmePlaceResolutionLog = {
  decisionStatus: PlanmePlaceDecisionStatus;
  originalName: string;
  reason: string;
  resolvedName?: string;
  query?: string;
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

/** Prevents structurally invalid AI drafts from reaching route calculation or persistence. */
export class PlanmeDraftDomainContractError extends Error {
  readonly code = "PLANME_DRAFT_DOMAIN_CONTRACT_FAILED";
  readonly retryable = true;
  readonly stage = "domain_contract" as const;

  constructor(readonly issues: PlanmeDraftDomainContractIssue[]) {
    super(issues.map((issue) => issue.code).join(","));
    this.name = "PlanmeDraftDomainContractError";
  }
}

export type AiRecommendedItineraryOptions = {
  aiItineraryGenerator?: AiItineraryGenerator;
  accommodationCandidateSearcher?: AccommodationCandidateSearcher;
  draftGeocoder?: PlanmeDraftGeocoder;
  googleMapsReferer?: string;
  placeCandidateDecider?: PlanmePlaceCandidateDecider;
  placeCandidateSearcher?: PlanmePlaceCandidateSearcher;
  replacementQuerySuggester?: PlanmeReplacementQuerySuggester;
  signal?: AbortSignal;
  timeoutMs?: number;
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

export type PlanmeReplacementQuerySuggester = (input: {
  attempt: 1 | 2 | 3;
  itinerary: RecommendItineraryRequest;
  signal?: AbortSignal;
  stop: ResolvableDraftStop;
  timeoutMs?: number;
}) => Promise<string | null>;

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
  const pageUrl = buildItineraryPageUrl(requestUrl, itinerary.id);
  const ogImageUrl = buildItineraryOgImageUrl(requestUrl, itinerary.id);
  const previewMarkdown = buildItineraryPreviewMarkdown(ogImageUrl);
  const standardTotalMinutes = sumRouteDuration(itinerary.days, "standard");
  const carrymeTotalMinutes = sumRouteDuration(itinerary.days, "carryme");
  const days = createGptActionDaySummaries(itinerary);
  const savingStatus = days.some(
    (day) => day.savingStatus === "hidden_estimated",
  )
    ? "hidden_estimated"
    : "verified";
  const savedMinutes = Math.max(0, standardTotalMinutes - carrymeTotalMinutes);

  return {
    itineraryId: itinerary.id,
    title: itinerary.title,
    summary:
      savingStatus === "verified"
        ? formatGptActionSavingSummary(savedMinutes)
        : "짐 없이 바로 이동 가능!",
    standardTotalMinutes,
    carrymeTotalMinutes,
    savingStatus,
    ...(savingStatus === "verified" ? { savedMinutes } : {}),
    days,
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

/** Sums every finalized day so GPTs and Apps do not report first-day-only totals. */
function sumRouteDuration(days: ItineraryDay[], routeId: "standard" | "carryme") {
  return days.reduce((total, day) => total + day[routeId].durationMinutes, 0);
}

/** Builds compact, model-visible evidence for route endpoints and luggage delivery. */
function createGptActionDaySummaries(
  itinerary: PlanmeItinerary,
): GptActionItineraryDaySummary[] {
  const tripOrigin = itinerary.days[0]?.standard.stops[0];
  const finalDayIndex = itinerary.days.length - 1;

  return itinerary.days.map((day, dayIndex) => {
    const standard = toGptActionRouteSummary(
      day.standard,
      day.standardTimeline ?? [],
    );
    const carryme = toGptActionRouteSummary(
      day.carryme,
      day.carrymeTimeline ?? day.timeline,
    );
    const standardStart = day.standard.stops[0];
    const standardEnd = day.standard.stops.at(-1);
    const carrymeStart = day.carryme.stops[0];
    const carrymeEnd = day.carryme.stops.at(-1);
    const sameEndpoints =
      areSamePhysicalStop(standardStart, carrymeStart) &&
      areSamePhysicalStop(standardEnd, carrymeEnd);
    const savingStatus = getGptActionDaySavingStatus(day, sameEndpoints);
    const savedMinutes = Math.max(
      0,
      day.standard.durationMinutes - day.carryme.durationMinutes,
    );
    const isFinalDay = dayIndex === finalDayIndex;

    return {
      carryme,
      day: day.day,
      isFinalDay,
      label: day.label,
      ...createLuggageDeliverySummary(day),
      returnsToTripOrigin:
        isFinalDay &&
        areSamePhysicalStop(standardEnd, tripOrigin) &&
        areSamePhysicalStop(carrymeEnd, tripOrigin),
      sameEndpoints,
      ...(savingStatus === "verified" ? { savedMinutes } : {}),
      savingStatus,
      standard,
    };
  });
}

/** Hides savings whenever either route still contains an estimated duration. */
function getGptActionDaySavingStatus(
  day: ItineraryDay,
  sameEndpoints: boolean,
): GptActionItineraryDaySummary["savingStatus"] {
  if (
    !sameEndpoints ||
    day.savingStatus === "hidden_estimated" ||
    day.standard.durationSource === "estimated" ||
    day.carryme.durationSource === "estimated"
  ) {
    return "hidden_estimated";
  }

  return "verified";
}

/** Reduces one route to the fields needed to verify day-boundary invariants. */
function toGptActionRouteSummary(
  route: RoutePlan,
  timeline: TimelineEvent[],
): GptActionRouteSummary {
  const travelerTimeline = timeline.filter(
    (event) => event.eventKind !== "luggage_delivery",
  );
  const startTime = travelerTimeline[0]?.time;
  const endTime = travelerTimeline.at(-1)?.time;

  return {
    durationMinutes: route.durationMinutes,
    end: route.stops.at(-1)?.label ?? "",
    ...(endTime ? { endTime } : {}),
    start: route.stops[0]?.label ?? "",
    ...(startTime ? { startTime } : {}),
  };
}

/** Exposes only explicit luggage-delivery events with a resolvable physical target. */
function createLuggageDeliverySummary(day: ItineraryDay): {
  luggageDelivery?: GptActionLuggageDeliverySummary;
} {
  const event = findLuggageDeliveryEvent(day);

  if (!event) {
    return {};
  }

  const target = findDeliveryTarget(day, event);

  if (!target) {
    return {};
  }

  return {
    luggageDelivery: {
      target: target.label,
      ...(target.role ? { targetRole: target.role } : {}),
      time: event.time,
    },
  };
}

/** Selects the dedicated CarryME side event without parsing user-visible copy. */
function findLuggageDeliveryEvent(day: ItineraryDay) {
  return [...(day.carrymeTimeline ?? []), ...day.timeline].find(
    (event) => event.eventKind === "luggage_delivery",
  );
}

/** Resolves the delivery target from stable references rather than a place-name guess. */
function findDeliveryTarget(day: ItineraryDay, event: TimelineEvent) {
  const stops = [...day.standard.stops, ...day.carryme.stops];

  if (event.deliveryTargetStopRef) {
    const target = stops.find(
      (stop) => stop.stopRef === event.deliveryTargetStopRef,
    );

    if (target) {
      return target;
    }
  }

  if (event.deliveryTargetPlaceRef) {
    return stops.find(
      (stop) => stop.placeRef === event.deliveryTargetPlaceRef,
    );
  }

  return undefined;
}

/** Compares endpoint identity from strongest provider-backed evidence to a label fallback. */
function areSamePhysicalStop(left: RouteStop | undefined, right: RouteStop | undefined) {
  if (!left || !right) {
    return false;
  }

  if (left.placeRef && right.placeRef) {
    return left.placeRef === right.placeRef;
  }

  if (left.placeSourceRef && right.placeSourceRef) {
    return left.placeSourceRef === right.placeSourceRef;
  }

  if (left.placeId && right.placeId) {
    return left.placeId === right.placeId;
  }

  if (left.coordinate && right.coordinate) {
    return (
      left.coordinate.lat.toFixed(6) === right.coordinate.lat.toFixed(6) &&
      left.coordinate.lng.toFixed(6) === right.coordinate.lng.toFixed(6)
    );
  }

  return normalizePhysicalStopLabel(left.label) === normalizePhysicalStopLabel(right.label);
}

function normalizePhysicalStopLabel(label: string) {
  return label.trim().replace(/\s+/g, "").toLowerCase();
}

function formatGptActionSavingSummary(savedMinutes: number) {
  return savedMinutes > 0 ? `약 ${savedMinutes}분 절약` : "시간 절약 없음";
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
        destinationType: input.destinationType ?? DEFAULT_RECOMMENDATION_DESTINATION_TYPE,
        mustVisitPlaces: input.mustVisitPlaces ?? [],
        durationDays: input.durationDays ?? result.itinerary.days.length,
        arrivalAirport: input.arrivalAirport ?? null,
        arrivalTime: input.arrivalTime ?? "09:30",
        hotelName: input.hotelName ?? null,
        origin: input.origin ?? null,
        travelerCount: input.travelerCount ?? 1,
        luggageCount: input.luggageCount ?? 1,
        preferences: input.preferences ?? [],
        transportMode: input.transportMode,
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
      destinationType: input.destinationType ?? DEFAULT_RECOMMENDATION_DESTINATION_TYPE,
      mustVisitPlaces: input.mustVisitPlaces ?? [],
      durationDays: input.durationDays ?? 2,
      arrivalAirport: input.arrivalAirport ?? null,
      arrivalTime: input.arrivalTime ?? "09:30",
      hotelName: input.hotelName ?? null,
      origin: input.origin ?? null,
      travelerCount: input.travelerCount ?? 1,
      luggageCount: input.luggageCount ?? 1,
      preferences: input.preferences ?? ["BTS 공연", "CarryME comparison"],
      transportMode: input.transportMode,
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
  const placeCandidateSearcher = createPlaceCandidateSearcher(options);
  const requiredPlaceResolution = await resolveRequiredPlaces(
    input,
    options,
    placeCandidateSearcher,
  );

  if ("status" in requiredPlaceResolution) {
    await recordPlanmeUsageSafely(options.usageRecorder, "needs_clarification");
    return requiredPlaceResolution;
  }

  const requiredPlaces = requiredPlaceResolution.requiredPlaces;

  if (hasDraftDays(input)) {
    const anchoredDraft = applyRequiredPlacesToDraft(
      toDraftPreviewRequest(input),
      requiredPlaces,
      input.transportMode,
    );
    const resolution = await resolveDraftCoordinatesIfPossible(
      anchoredDraft,
      options.draftGeocoder,
      options,
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

    const finalDraft = enforceDraftDomainContract(
      placeResolution.draft,
      input,
      requiredPlaces,
    );
    const readyResponse = createRecommendedItineraryResponse(
      requestUrl,
      {
        ...input,
        title: finalDraft.title,
        region: finalDraft.region,
        duration: finalDraft.duration,
        summary: finalDraft.summary,
        origin: finalDraft.origin ?? input.origin,
        assumptions: finalDraft.assumptions ?? input.assumptions,
        savedMinutes: finalDraft.savedMinutes ?? input.savedMinutes,
        days: finalDraft.days,
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
  const accommodationCandidateSearcher =
    options.accommodationCandidateSearcher ??
    ((searchInput) =>
      searchAccommodationCandidates(searchInput, {
        placeCandidateSearcher,
      }));
  const accommodationCandidates = await resolveAccommodationCandidates(
    input,
    accommodationCandidateSearcher,
    options,
  );
  const generatorInput =
    accommodationCandidates.length > 0
      ? { ...input, accommodationCandidates }
      : input;
  let lastDomainError: PlanmeDraftDomainContractError | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const generatedDraft = aiItineraryGenerator
      ? await aiItineraryGenerator(generatorInput, {
          googleMapsReferer: options.googleMapsReferer,
          placeCandidateSearcher,
          requiredPlaces,
          usageRecorder: options.usageRecorder,
        })
      : await generatePlanmeDraftWithOpenAi(
        generatorInput,
          {
            signal: options.signal,
            timeoutMs: options.timeoutMs,
            usageRecorder: options.usageRecorder,
          },
          {
            googleMapsReferer: options.googleMapsReferer,
            // Keep production generation to one Responses API round trip. Every authored
            // visit stop is still hard-gated by resolveDraftPlaceCandidatesIfPossible below.
            requiredPlaces,
            usageRecorder: options.usageRecorder,
          },
        );
    const candidateDraft = applyRequiredPlacesToDraft(
      applyAccommodationCandidatesToDraft(
        { ...generatedDraft, transportMode: input.transportMode },
        accommodationCandidates,
      ),
      requiredPlaces,
      input.transportMode,
    );
    const resolution = await resolveDraftCoordinatesIfPossible(
      candidateDraft,
      options.draftGeocoder,
      options,
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

    let draft: PlanmeDraftPreviewRequest;

    try {
      draft = enforceDraftDomainContract(placeResolution.draft, input, requiredPlaces);
    } catch (error) {
      if (error instanceof PlanmeDraftDomainContractError && attempt === 0) {
        lastDomainError = error;
        continue;
      }

      throw error;
    }

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

  throw lastDomainError ?? new PlanmeDraftDomainContractError([]);
}

/** Applies server-owned multi-day boundaries before any draft can be rendered or persisted. */
function enforceDraftDomainContract(
  draft: PlanmeDraftPreviewRequest,
  input: RecommendItineraryRequest,
  requiredPlaces: PlanmeResolvedRequiredPlaces,
) {
  const hasStableGeneratedContract = draft.days.every((day) =>
    Boolean(day.standardStops && day.carrymeStops && day.standardTimeline && day.carrymeTimeline) &&
    [...(day.standardTimeline ?? []), ...(day.carrymeTimeline ?? [])].some(
      (event) => event.stopIndex !== undefined || event.stayDurationMinutes !== undefined,
    ),
  );

  // Legacy injected drafts remain readable; strict OpenAI output always carries this contract.
  if (!hasStableGeneratedContract) {
    return draft;
  }

  const origin = applyRequiredPlaceToStop<PlanmeDraftRouteStop>(
    undefined,
    requiredPlaces.origin,
    input.transportMode,
    "출발지",
  );
  const result = normalizePlanmeDraftDomainContract({
    draft,
    durationDays: input.durationDays ?? draft.days.length,
    origin,
    transportMode: input.transportMode,
  });

  if (!result.ok) {
    throw new PlanmeDraftDomainContractError(result.issues);
  }

  return result.draft;
}

/**
 * Resolves the user-confirmed origin and destination before itinerary generation.
 */
async function resolveRequiredPlaces(
  input: RecommendItineraryRequest,
  options: AiRecommendedItineraryOptions,
  searcher: PlanmePlaceCandidateSearcher,
): Promise<
  | { requiredPlaces: PlanmeResolvedRequiredPlaces }
  | PlanmeClarificationResponse
> {
  const originText = input.origin?.trim() || input.arrivalAirport?.trim() || "";
  const destinationText = input.destination?.trim() || input.region?.trim() || "";
  const destinationType = input.destinationType ?? DEFAULT_RECOMMENDATION_DESTINATION_TYPE;
  const mustVisitPlaces = normalizeRequiredPlaceTexts(input.mustVisitPlaces);

  if (!originText) {
    return createRequiredPlaceClarification("origin", "출발지");
  }

  if (!destinationText) {
    return createRequiredPlaceClarification("destination", "목적지");
  }

  const origin = await resolveRequiredPlace(
    "origin",
    originText,
    input,
    options.draftGeocoder,
    searcher,
    options,
  );
  if (!origin) {
    if (isBroadOriginLabel(originText)) {
      throw new PlanmeRequiredPlaceResolutionError(
        "ORIGIN_REPRESENTATIVE_NOT_FOUND",
        false,
      );
    }

    return createRequiredPlaceClarification("origin", originText);
  }

  const requiredPlaceInputs = normalizeRequiredPlaceInputs([
    ...(destinationType === "place"
      ? [{ kind: "destination" as const, text: destinationText }]
      : []),
    ...mustVisitPlaces.map((text) => ({ kind: "must_visit" as const, text })),
  ]);
  const destinations: PlanmeResolvedRequiredPlace[] = [];

  for (const requiredPlaceInput of requiredPlaceInputs) {
    const destination = await resolveRequiredPlace(
      requiredPlaceInput.kind,
      requiredPlaceInput.text,
      input,
      options.draftGeocoder,
      searcher,
      options,
    );

    if (!destination) {
      return createRequiredPlaceClarification(
        requiredPlaceInput.kind,
        requiredPlaceInput.text,
      );
    }

    destinations.push(destination);
  }

  return { requiredPlaces: { destinations, origin } };
}

function normalizeRequiredPlaceTexts(values: string[] | undefined) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function normalizeRequiredPlaceInputs(
  inputs: Array<{ kind: "destination" | "must_visit"; text: string }>,
) {
  const seen = new Set<string>();

  return inputs.filter((input) => {
    const key = normalizeComparableText(input.text);

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

/**
 * Uses geocoding first for broad origins and local search first for destinations.
 */
async function resolveRequiredPlace(
  kind: PlanmeRequiredPlaceKind,
  inputText: string,
  input: RecommendItineraryRequest,
  geocoder: PlanmeDraftGeocoder | undefined,
  searcher: PlanmePlaceCandidateSearcher,
  options: Pick<AiRecommendedItineraryOptions, "signal" | "timeoutMs">,
): Promise<PlanmeResolvedRequiredPlace | null> {
  const geocodedCandidate = async () => {
    if (!geocoder) {
      return null;
    }

    const result = await geocoder({
      dayIndex: -1,
      query: inputText,
      region: kind === "origin" ? undefined : input.region,
      signal: options.signal,
      stop: {
        addressQuery: inputText,
        name: inputText,
        requiredPlaceKind: kind,
        role: kind === "origin" ? "출발지" : "방문지",
      },
      stopIndex: -1,
      timeoutMs: options.timeoutMs,
    });

    if (!result || !result.placeSourceRef?.trim()) {
      return null;
    }

    const candidate: PlanmePlaceCandidate = {
      address: result.matchedAddress,
      candidateId: result.placeSourceRef,
      coordinate: result.coordinate,
      id: result.placeSourceRef,
      name: createGeocodedRequiredPlaceDisplayName(kind, inputText, result.matchedAddress),
      query: inputText,
      source: result.placeSource ?? "naver_geocode",
      sourceRef: result.placeSourceRef,
    };

    return hasPlanmePlaceCandidateHardGate(candidate) ? candidate : null;
  };
  const localCandidate = async () => {
    for (const query of createRequiredPlaceSearchQueries(inputText)) {
      try {
        const result = await searcher({
          destination: kind === "origin" ? undefined : input.destination,
          maxCandidates: 5,
          query,
          region: kind === "origin" ? undefined : input.region,
          signal: options.signal,
          stop: {
            addressQuery: inputText,
            name: inputText,
            requiredPlaceKind: kind,
            role: kind === "origin" ? "출발지" : "방문지",
          },
          timeoutMs: options.timeoutMs,
        });
        const candidate =
          kind === "origin" && isBroadOriginLabel(inputText)
            ? selectPlanmeBroadOriginCandidate(inputText, result.candidates)
            : selectPlanmeRequiredPlaceCandidate(inputText, result.candidates);

        if (candidate) {
          return candidate;
        }
      } catch (error) {
        if (
          error instanceof PlanmePlaceSearchConfigurationError ||
          error instanceof PlanmePlaceSearchProviderError
        ) {
          throw new PlanmeRequiredPlaceResolutionError(
            error instanceof PlanmePlaceSearchConfigurationError
              ? "PLACE_SEARCH_CONFIGURATION_ERROR"
              : "PLACE_SEARCH_PROVIDER_ERROR",
            error instanceof PlanmePlaceSearchProviderError
              ? error.status === 408 || error.status === 429 || error.status >= 500
              : false,
          );
        }

        throw error;
      }
    }

    return null;
  };

  // Broad origins such as 동탄 are safer through the address coordinate provider.
  const candidate =
    kind === "origin"
      ? (await geocodedCandidate()) ?? (await localCandidate())
      : (await localCandidate()) ?? (await geocodedCandidate());

  if (!candidate) {
    return null;
  }

  return {
    address: candidate.address,
    coordinate: candidate.coordinate,
    inputText,
    kind,
    name: candidate.name,
    source: candidate.source,
    sourceRef: candidate.sourceRef,
  };
}

/** Makes a broad origin's selected coordinate visible without renaming exact user landmarks. */
function createGeocodedRequiredPlaceDisplayName(
  kind: PlanmeRequiredPlaceKind,
  inputText: string,
  matchedAddress: string | undefined,
) {
  const inputLabel = inputText.trim();
  const addressLabel = matchedAddress?.trim();

  if (kind !== "origin" || !addressLabel || !isBroadOriginLabel(inputLabel)) {
    return inputLabel;
  }

  return `${inputLabel} · ${addressLabel}`;
}

/** Distinguishes a region-like origin from a station, park, office, or street address. */
function isBroadOriginLabel(value: string) {
  const normalized = normalizeComparableText(value);

  if (!normalized || /\d/.test(normalized)) {
    return false;
  }

  return !/(?:역|공원|구청|시청|군청|도청|터미널|공항|해수욕장|박물관|미술관|수목원|시장|호텔|리조트|펜션|숙소|대학교|정류장|항구|선착장|마을|사찰)$/.test(
    normalized,
  );
}

/** Distinguishes provider outages from a genuine no-match user place. */
export class PlanmeRequiredPlaceResolutionError extends Error {
  readonly stage = "place_resolution" as const;

  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "PlanmeRequiredPlaceResolutionError";
  }
}

/** Adds one place-type-qualified retry when local search ranks nearby branches first. */
function createRequiredPlaceSearchQueries(inputText: string) {
  const normalizedInput = normalizeComparableText(inputText);
  const isGovernmentOffice = /(?:구청|시청|군청|도청)$/.test(normalizedInput);

  if (isGovernmentOffice) {
    return [inputText, `${inputText} 청사`];
  }

  const placeType = [
    "해수욕장",
    "터미널",
    "박물관",
    "미술관",
    "수목원",
    "공항",
    "공원",
    "시장",
    "호수",
    "역",
  ].find((candidate) => normalizedInput.endsWith(candidate));

  return placeType ? [inputText, `${inputText} ${placeType}`] : [inputText];
}

/**
 * Returns one user-facing clarification only for a required anchor.
 */
function createRequiredPlaceClarification(
  kind: PlanmeRequiredPlaceKind,
  place: string,
): PlanmeClarificationResponse {
  const label =
    kind === "origin" ? "출발지" : kind === "must_visit" ? "필수 장소" : "목적지";
  const question = `${place} ${label}의 정확한 장소명이나 주소를 알려주세요.`;

  return {
    clarificationContext: {
      previousAnswers: [],
      previousQuestions: [question],
      round: 0,
      unresolvedPlaces: [place],
    },
    message: `${label}의 실제 장소와 좌표를 확인하지 못했습니다.`,
    questions: [question],
    resolutionLogs: [
      {
        decisionStatus: "rejected",
        originalName: place,
        reason: `${label} 후보를 확정하지 못했습니다.`,
        source: "input",
      },
    ],
    status: "needs_clarification",
    unresolvedStops: [place],
    validationIssues: [
      {
        code: "required_place_not_found",
        message: `${label} 좌표를 확인하지 못했습니다.`,
        severity: "error",
      },
    ],
  };
}

/**
 * Injects immutable anchors and the itinerary-wide mode into generated stop lists.
 */
function applyRequiredPlacesToDraft(
  draft: PlanmeDraftPreviewRequest,
  requiredPlaces: PlanmeResolvedRequiredPlaces,
  transportMode: RecommendItineraryRequest["transportMode"],
): PlanmeDraftPreviewRequest {
  const lastDayIndex = Math.max(0, draft.days.length - 1);
  const requiredPlaceDayIndexes = new Map(
    requiredPlaces.destinations.map((place, placeIndex) => [
      place.sourceRef,
      findRequiredPlaceDayIndex(draft, place, placeIndex),
    ]),
  );

  return {
    ...draft,
    origin: requiredPlaces.origin.name,
    transportMode,
    days: draft.days.map((day, dayIndex) => {
      const normalizeList = <T extends ResolvableDraftStop>(stops: T[] | undefined) => {
        if (!stops) {
          return undefined;
        }

        const nextIndexByOriginalIndex = new Map(
          stops.map((_stop, index) => [index, index]),
        );
        const shiftOriginalIndexes = (insertIndex: number) => {
          for (const [originalIndex, nextIndex] of nextIndexByOriginalIndex) {
            if (nextIndex >= insertIndex) {
              nextIndexByOriginalIndex.set(originalIndex, nextIndex + 1);
            }
          }
        };
        let nextStops = stops.map((stop) => {
          const requiredPlace = findRequiredPlaceForStop(
            stop,
            requiredPlaces.destinations,
          );

          if (requiredPlace) {
            return applyRequiredPlaceToStop(
              stop,
              requiredPlace,
              transportMode,
              "방문지",
            );
          }

          // Only server-resolved user inputs may become fixed places. A model can
          // mislabel its own regional recommendations as required destinations.
          return { ...stop, mode: transportMode, requiredPlaceKind: undefined };
        }) as T[];

        if (dayIndex === 0) {
          const first = nextStops[0];
          const firstIsOrigin = Boolean(
            first &&
              (first.role === "origin" ||
                first.role === "출발지" ||
                first.requiredPlaceKind === "origin" ||
                isSameRequiredPlace(first.name, requiredPlaces.origin)),
          );
          const originStop = applyRequiredPlaceToStop(
            firstIsOrigin ? first : undefined,
            requiredPlaces.origin,
            transportMode,
            "출발지",
          ) as T;

          nextStops = firstIsOrigin
            ? [originStop, ...nextStops.slice(1)]
            : [originStop, ...nextStops];

          if (!firstIsOrigin) {
            shiftOriginalIndexes(0);
          }
        }

        for (const requiredPlace of requiredPlaces.destinations) {
          if (
            requiredPlaceDayIndexes.get(requiredPlace.sourceRef) !== dayIndex ||
            nextStops.some((stop) => isSameRequiredPlace(stop.name, requiredPlace))
          ) {
            continue;
          }

          const requiredStop = applyRequiredPlaceToStop(
            undefined,
            requiredPlace,
            transportMode,
            "방문지",
          ) as T;
          const insertIndex = Math.max(
            1,
            nextStops.length - (dayIndex === lastDayIndex ? 1 : 0),
          );

          shiftOriginalIndexes(insertIndex);
          nextStops = [
            ...nextStops.slice(0, insertIndex),
            requiredStop,
            ...nextStops.slice(insertIndex),
          ];
        }

        if (dayIndex === lastDayIndex) {
          const last = nextStops[nextStops.length - 1];
          const returnStop = applyRequiredPlaceToStop(
            last?.role === "복귀지" || last?.requiredPlaceKind === "origin" ? last : undefined,
            requiredPlaces.origin,
            transportMode,
            "복귀지",
          ) as T;

          nextStops =
            last?.role === "복귀지" || last?.requiredPlaceKind === "origin"
              ? [...nextStops.slice(0, -1), returnStop]
              : [...nextStops, returnStop];
        }

        return { nextIndexByOriginalIndex, stops: nextStops };
      };
      const standard = normalizeList(day.standardStops);
      const carryme = normalizeList(day.carrymeStops);
      const legacy = normalizeList(day.stops);
      const standardStops = standard?.stops;
      const carrymeStops = carryme?.stops;
      const stops = legacy?.stops;

      return {
        ...day,
        standardStops,
        carrymeStops,
        stops,
        standardTimeline: remapTimelineStopIndexes(
          day.standardTimeline,
          standard?.nextIndexByOriginalIndex,
        ),
        carrymeTimeline: remapTimelineStopIndexes(
          day.carrymeTimeline,
          carryme?.nextIndexByOriginalIndex,
        ),
        timeline: remapTimelineStopIndexes(
          day.timeline,
          legacy?.nextIndexByOriginalIndex,
        ),
        standardRouteText:
          standardStops?.map((stop) => stop.name).join(" → ") ?? day.standardRouteText,
        carrymeRouteText:
          carrymeStops?.map((stop) => stop.name).join(" → ") ?? day.carrymeRouteText,
      };
    }),
  };
}

/** Keeps AI timeline references attached to their original stops after server anchor insertion. */
function remapTimelineStopIndexes(
  timeline: PlanmeDraftPreviewRequest["days"][number]["timeline"],
  nextIndexByOriginalIndex: ReadonlyMap<number, number> | undefined,
) {
  if (!timeline || !nextIndexByOriginalIndex) {
    return timeline;
  }

  return timeline.map((event) => ({
    ...event,
    stopIndex:
      typeof event.stopIndex === "number"
        ? nextIndexByOriginalIndex.get(event.stopIndex) ?? event.stopIndex
        : event.stopIndex,
  }));
}

function findRequiredPlaceDayIndex(
  draft: PlanmeDraftPreviewRequest,
  place: PlanmeResolvedRequiredPlace,
  fallbackIndex: number,
) {
  const matchingDayIndex = draft.days.findIndex((day) =>
    [day.standardStops, day.carrymeStops, day.stops].some((stops) =>
      stops?.some(
        (stop) =>
          isSameRequiredPlace(stop.name, place) ||
          (place.kind === "destination" && stop.requiredPlaceKind === "destination"),
      ),
    ),
  );

  if (matchingDayIndex >= 0) {
    return matchingDayIndex;
  }

  return draft.days.length > 0 ? fallbackIndex % draft.days.length : 0;
}

function findRequiredPlaceForStop(
  stop: ResolvableDraftStop,
  places: PlanmeResolvedRequiredPlace[],
) {
  const exactMatch = places.find((place) => isSameRequiredPlace(stop.name, place));

  if (exactMatch) {
    return exactMatch;
  }

  if (stop.requiredPlaceKind === "destination") {
    return places.find((place) => place.kind === "destination");
  }

  return undefined;
}

/**
 * Applies a resolved required place without trusting model-authored coordinates.
 */
function applyRequiredPlaceToStop<T extends ResolvableDraftStop>(
  stop: T | undefined,
  place: PlanmeResolvedRequiredPlace,
  transportMode: RecommendItineraryRequest["transportMode"],
  role: "출발지" | "방문지" | "복귀지",
) {
  return {
    ...(stop ?? {}),
    addressQuery: place.address ?? place.inputText,
    caption: stop?.caption ?? (role === "출발지" ? "출발" : role === "복귀지" ? "복귀" : "방문"),
    coordinate: place.coordinate,
    mode: transportMode,
    name: place.name,
    placeId: undefined,
    placeSource: place.source,
    placeSourceRef: place.sourceRef,
    requiredPlaceKind: place.kind,
    role,
  };
}

/**
 * Matches a user destination only when the normalized names clearly overlap.
 */
function isSameRequiredPlace(name: string, place: PlanmeResolvedRequiredPlace) {
  const normalizedName = normalizeComparableText(name);
  const normalizedResolved = normalizeComparableText(place.name);
  const normalizedInput = normalizeComparableText(place.inputText);

  return (
    normalizedName === normalizedResolved ||
    normalizedName === normalizedInput
  );
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
  options: Pick<AiRecommendedItineraryOptions, "signal" | "timeoutMs"> = {},
) {
  if (!geocoder) {
    return { draft, validationIssues: [] };
  }

  return resolvePlanmeDraftCoordinates(draft, geocoder, options);
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
  const replacementQuerySuggester = createReplacementQuerySuggester(options);
  const resolutionLogs: PlanmePlaceResolutionLog[] = [];
  const validationIssues: PlanmeDraftValidationIssue[] = [];
  const unresolvedStops: string[] = [];
  const days: PlanmeDraftPreviewRequest["days"] = [];
  const runPlaceSearch = createAsyncConcurrencyLimiter(3);
  const logicalPlaceResolutions = new Map<
    string,
    Promise<{ attempt: 0 | 1 | 2; candidate: PlanmePlaceCandidate } | null>
  >();

  const resolveLogicalPlace = (stop: ResolvableDraftStop) => {
    const key = [
      normalizeComparableText(stop.name),
      normalizeComparableText(stop.addressQuery ?? ""),
      draft.region ?? input.region ?? input.destination ?? "",
    ].join("|");
    const existing = logicalPlaceResolutions.get(key);

    if (existing) {
      return existing;
    }

    const promise = (async () => {
      const searchAndDecide = async (
        query: string,
        attempt: 0 | 1 | 2,
      ) => {
        const result = await runPlaceSearch(() =>
          searcher({
            destination: input.destination,
            maxCandidates: 5,
            preferences: input.preferences,
            query,
            region: draft.region ?? input.region,
            signal: options.signal,
            stop: { ...stop, addressQuery: query },
            timeoutMs: options.timeoutMs,
          }),
        );

        if (result.candidates.length === 0) {
          return null;
        }

        const decision = await decider({
          candidates: result.candidates,
          finalAttempt: true,
          input,
          round: 2,
          searchedQueries: result.searchedQueries,
          stop,
        });
        const selected =
          findSelectedPlaceCandidate(result.candidates, decision) ??
          selectFinalCandidate(result.candidates);

        if (!selected || !hasPlanmePlaceCandidateHardGate(selected)) {
          return null;
        }

        await recordFinalAiDecisionIfNeeded(decision, options.usageRecorder);
        return { attempt, candidate: selected };
      };

      const direct = await searchAndDecide(stop.addressQuery ?? stop.name, 0);

      if (direct) {
        return direct;
      }

      for (const attempt of [1, 2] as const) {
        const replacementQuery = await replacementQuerySuggester({
          attempt,
          itinerary: input,
          signal: options.signal,
          stop,
          timeoutMs: options.timeoutMs,
        });

        if (!replacementQuery) {
          continue;
        }

        const replacement = await searchAndDecide(replacementQuery, attempt);

        if (replacement) {
          return replacement;
        }
      }

      return null;
    })();

    logicalPlaceResolutions.set(key, promise);
    return promise;
  };

  for (const day of draft.days) {
    const replacements: PlaceReplacement[] = [];
    const exclusions = new Set<string>();

    const resolveStopList = async <T extends ResolvableDraftStop>(stopList: T[] | undefined) => {
      if (!stopList) {
        return undefined;
      }

      const resolvedStops = await Promise.all(stopList.map(async (stop) => {
        if (hasDraftStopHardGate(stop)) {
          return stop;
        }

        if (stop.requiredPlaceKind) {
          await recordPlanmeUsageSafely(options.usageRecorder, "hard_gate_failed");
          unresolvedStops.push(stop.name);
          validationIssues.push({
            code: "required_place_hard_gate_failed",
            message: `${stop.name} 필수 장소의 좌표와 검색 출처를 확인하지 못했습니다.`,
            severity: "error",
          });
          return stop;
        }

        const resolved = await resolveLogicalPlace(stop);

        if (!resolved) {
          exclusions.add(stop.name);
          validationIssues.push({
            code: "intermediate_place_excluded",
            message: `${stop.name} 중간 장소를 두 번 대체한 뒤 일정에서 제외했습니다.`,
            severity: "warning",
          });
          resolutionLogs.push({
            decisionStatus: "rejected",
            originalName: stop.name,
            reason: "중간 장소의 네이버 후보를 최대 2회 대체 후에도 확정하지 못했습니다.",
            source: "input",
          });
          return null;
        }

        const replacementStop = applyPlaceCandidateToStop(stop, resolved.candidate);

        replacements.push({
          originalName: stop.name,
          replacementName: replacementStop.name,
        });
        resolutionLogs.push({
          decisionStatus: "accepted",
          originalName: stop.name,
          query: resolved.candidate.query,
          reason:
            resolved.attempt === 0
              ? "원래 장소의 네이버 후보를 확정했습니다."
              : `${resolved.attempt}번째 AI 대체 검색으로 네이버 후보를 확정했습니다.`,
          resolvedName: replacementStop.name,
          source: resolved.candidate.source,
        });
        validationIssues.push({
          code: "place_candidate_resolved",
          message: `${stop.name} 후보를 ${replacementStop.name}(으)로 확정했습니다.`,
          severity: "warning",
        });
        return replacementStop;
      }));

      return resolvedStops.reduce<T[]>((compacted, stop) => {
        if (stop !== null) {
          compacted.push(stop as T);
        }

        return compacted;
      }, []);
    };

    const standardStops = await resolveStopList(day.standardStops);
    const carrymeStops = await resolveStopList(day.carrymeStops);
    const stops = await resolveStopList(day.stops);

    const replacedDay = applyPlaceReplacementCopy(
      { ...day, standardStops, carrymeStops, stops },
      replacements,
    );

    days.push(applyPlaceExclusionCopy(replacedDay, day, [...exclusions]));
  }

  if (unresolvedStops.length > 0) {
    const questions = createClarificationQuestions([], unresolvedStops);

    return {
      clarificationContext: {
        previousAnswers: normalizeClarificationAnswers(input),
        previousQuestions: questions,
        round: normalizeClarificationRound(input),
        unresolvedPlaces: [...new Set(unresolvedStops)],
      },
      message: "필수 장소의 실제 장소와 좌표를 확정하지 못했습니다.",
      questions,
      resolutionLogs,
      status: "needs_clarification",
      unresolvedStops: [...new Set(unresolvedStops)],
      validationIssues,
    };
  }

  return {
    draft: alignDraftRoutesToTimelineOrder({ ...draft, days }),
    resolutionLogs,
    status: "resolved",
    validationIssues,
  };
}

/** Runs independent provider lookups concurrently without exceeding the provider burst limit. */
function createAsyncConcurrencyLimiter(maxConcurrent: number) {
  let activeCount = 0;
  const waiters: Array<() => void> = [];

  return async function run<T>(operation: () => Promise<T>): Promise<T> {
    if (activeCount >= maxConcurrent) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }

    activeCount += 1;

    try {
      return await operation();
    } finally {
      activeCount -= 1;
      waiters.shift()?.();
    }
  };
}

/** Makes the chronological timeline the source of truth when model route order disagrees. */
function alignDraftRoutesToTimelineOrder(
  draft: PlanmeDraftPreviewRequest,
): PlanmeDraftPreviewRequest {
  return {
    ...draft,
    days: draft.days.map((day) => {
      const standard = alignStopsAndTimeline(day.standardStops, day.standardTimeline);
      const carryme = alignStopsAndTimeline(day.carrymeStops, day.carrymeTimeline);
      const legacy = alignStopsAndTimeline(day.stops, day.timeline);

      return {
        ...day,
        carrymeRouteText: carryme.stops
          ? carryme.stops.map((stop) => stop.name).join(" → ")
          : day.carrymeRouteText,
        carrymeStops: carryme.stops,
        carrymeTimeline: carryme.timeline,
        standardRouteText: standard.stops
          ? standard.stops.map((stop) => stop.name).join(" → ")
          : day.standardRouteText,
        standardStops: standard.stops,
        standardTimeline: standard.timeline,
        stops: legacy.stops,
        timeline: legacy.timeline,
      };
    }),
  };
}

function alignStopsAndTimeline<
  TStop extends ResolvableDraftStop,
  TTimeline extends PlanmeDraftPreviewRequest["days"][number]["timeline"],
>(stops: TStop[] | undefined, timeline: TTimeline) {
  if (!stops || !timeline) {
    return { stops, timeline };
  }

  const referencedIndexes = timeline
    .map((event) => event.stopIndex)
    .filter((value): value is number => typeof value === "number");
  const uniqueIndexes = [...new Set(referencedIndexes)];
  const validContract =
    uniqueIndexes.length > 0 &&
    uniqueIndexes.every((index) => Number.isInteger(index) && index >= 0 && index < stops.length);

  if (!validContract) {
    return { stops, timeline };
  }

  const referencedIndexSet = new Set(uniqueIndexes);
  const unreferencedIndexes = stops
    .map((_stop, index) => index)
    .filter((index) => !referencedIndexSet.has(index));
  const leadingAnchorIndexes = unreferencedIndexes.filter(
    (index) => stops[index].role === "출발지",
  );
  const trailingAnchorIndexes = unreferencedIndexes.filter(
    (index) => stops[index].role === "복귀지",
  );
  const remainingIndexes = unreferencedIndexes.filter(
    (index) =>
      stops[index].role !== "출발지" &&
      stops[index].role !== "복귀지",
  );
  const orderedIndexes = [
    ...leadingAnchorIndexes,
    ...uniqueIndexes,
    ...remainingIndexes,
    ...trailingAnchorIndexes,
  ];

  const newIndexByOldIndex = new Map(
    orderedIndexes.map((oldIndex, newIndex) => [oldIndex, newIndex]),
  );

  return {
    stops: orderedIndexes.map((index) => stops[index]),
    timeline: timeline.map((event) => ({
      ...event,
      stopIndex:
        typeof event.stopIndex === "number"
          ? newIndexByOldIndex.get(event.stopIndex)
          : event.stopIndex,
    })) as TTimeline,
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
 * Builds the default Places searcher while keeping tests injectable.
 */
function createPlaceCandidateSearcher(options: AiRecommendedItineraryOptions) {
  return (
    options.placeCandidateSearcher ??
    ((searchInput) =>
      searchPlanmePlaceCandidates(searchInput, {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        usageRecorder: options.usageRecorder,
      }))
  );
}

/**
 * Uses an injected decision function, otherwise accepts the first provider-backed candidate.
 */
function createPlaceCandidateDecider(
  options: AiRecommendedItineraryOptions,
): PlanmePlaceCandidateDecider {
  if (options.placeCandidateDecider) {
    return options.placeCandidateDecider;
  }

  return async ({ candidates }) => {
    const selected = candidates.find(hasPlanmePlaceCandidateHardGate);

    return selected
      ? {
          reason: "네이버 검색 출처와 좌표가 확인된 후보입니다.",
          selectedCandidateId: selected.candidateId,
          status: "accepted",
        }
      : {
          reason: "출처와 좌표를 모두 확인할 수 있는 후보가 없습니다.",
          status: "rejected",
        };
  };
}

/**
 * Uses an injected replacement-query helper; the default Naver search already tries bounded variants.
 */
function createReplacementQuerySuggester(
  options: AiRecommendedItineraryOptions,
): PlanmeReplacementQuerySuggester {
  return options.replacementQuerySuggester ?? (async () => null);
}

/**
 * Updates a draft stop with the selected coordinate-bearing Places candidate.
 */
function applyPlaceCandidateToStop<T extends ResolvableDraftStop>(
  stop: T,
  candidate: PlanmePlaceCandidate,
): T {
  const displayName = selectDisplayNameForPlaceCandidate(stop.name, candidate);

  return {
    ...stop,
    addressQuery: candidate.address ?? stop.addressQuery,
    coordinate: candidate.coordinate,
    name: displayName,
    placeId: candidate.placeId,
    placeSource: candidate.source,
    placeSourceRef: candidate.sourceRef,
  } as T;
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
 * Selects a final candidate only when the hard gate can still be satisfied.
 */
function selectFinalCandidate(candidates: PlanmePlaceCandidate[]) {
  return candidates.find(hasPlanmePlaceCandidateHardGate) ?? null;
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
 * Removes copy that still references an intermediate place excluded after two attempts.
 */
function applyPlaceExclusionCopy(
  day: PlanmeDraftPreviewRequest["days"][number],
  sourceDay: PlanmeDraftPreviewRequest["days"][number],
  exclusions: string[],
) {
  if (exclusions.length === 0) {
    return day;
  }

  const filterTimeline = (
    timeline: PlanmeDraftPreviewRequest["days"][number]["timeline"],
    sourceStops: PlanmeDraftPreviewRequest["days"][number]["stops"],
  ) => {
    const removedIndexes = new Set(
      (sourceStops ?? [])
        .map((stop, index) =>
          exclusions.some((place) => stop.name.includes(place)) ? index : -1,
        )
        .filter((index) => index >= 0),
    );

    return timeline?.flatMap((event) => {
      if (typeof event.stopIndex === "number") {
        if (removedIndexes.has(event.stopIndex)) {
          return [];
        }

        const removedBefore = [...removedIndexes].filter(
          (index) => index < event.stopIndex!,
        ).length;

        return [{ ...event, stopIndex: event.stopIndex - removedBefore }];
      }

      return exclusions.every(
        (place) => !event.title.includes(place) && !event.description.includes(place),
      )
        ? [event]
        : [];
    });
  };

  return {
    ...day,
    carrymeRouteText: removeExcludedRouteParts(day.carrymeRouteText, exclusions),
    standardRouteText: removeExcludedRouteParts(day.standardRouteText, exclusions),
    carrymeTimeline: filterTimeline(
      day.carrymeTimeline,
      sourceDay.carrymeStops ?? sourceDay.stops,
    ),
    standardTimeline: filterTimeline(
      day.standardTimeline,
      sourceDay.standardStops ?? sourceDay.stops,
    ),
    timeline: filterTimeline(
      day.timeline,
      sourceDay.stops ?? sourceDay.carrymeStops ?? sourceDay.standardStops,
    ),
  };
}

/**
 * Rebuilds arrow-delimited route copy after excluded stops are removed.
 */
function removeExcludedRouteParts(value: string | undefined, exclusions: string[]) {
  if (!value) {
    return value;
  }

  return value
    .split("→")
    .map((part) => part.trim())
    .filter((part) => part && exclusions.every((place) => !part.includes(place)))
    .join(" → ");
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
 * Resolves real lodging candidates only when the user did not already name a hotel.
 */
async function resolveAccommodationCandidates(
  input: RecommendItineraryRequest,
  searcher: AccommodationCandidateSearcher,
  options: Pick<AiRecommendedItineraryOptions, "signal" | "timeoutMs">,
) {
  if (input.accommodationCandidates?.length) {
    return input.accommodationCandidates;
  }

  if (input.hotelName?.trim() || !(input.destination?.trim() || input.region?.trim())) {
    return [];
  }

  return searcher({
    ...input,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });
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
    "naver_local",
    candidate.id,
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
        placeId: undefined,
        placeSource: "naver_local",
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
    transportMode: input.transportMode,
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
