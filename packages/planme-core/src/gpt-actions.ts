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
  status?: PlanmeDraftPreviewResult["status"];
  validationIssues?: PlanmeDraftPreviewResult["validationIssues"];
  version?: number;
};

export type AiRecommendedItineraryOptions = {
  aiItineraryGenerator?: AiItineraryGenerator;
  accommodationCandidateSearcher?: AccommodationCandidateSearcher;
  draftGeocoder?: PlanmeDraftGeocoder;
  googleMapsReferer?: string;
};

type RecommendedItineraryResponseOptions = {
  extraValidationIssues?: PlanmeDraftValidationIssue[];
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
) {
  if (hasDraftDays(input)) {
    const resolution = await resolveDraftCoordinatesIfPossible(
      toDraftPreviewRequest(input),
      options.draftGeocoder,
    );

    return createRecommendedItineraryResponse(
      requestUrl,
      {
        ...input,
        title: resolution.draft.title,
        region: resolution.draft.region,
        duration: resolution.draft.duration,
        summary: resolution.draft.summary,
        origin: resolution.draft.origin ?? input.origin,
        assumptions: resolution.draft.assumptions ?? input.assumptions,
        savedMinutes: resolution.draft.savedMinutes ?? input.savedMinutes,
        days: resolution.draft.days,
      },
      { extraValidationIssues: resolution.validationIssues },
    );
  }

  const aiItineraryGenerator = options.aiItineraryGenerator ?? generatePlanmeDraftWithOpenAi;
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
  const candidateDraft = applyAccommodationCandidatesToDraft(
    await aiItineraryGenerator(generatorInput),
    accommodationCandidates,
  );
  const resolution = await resolveDraftCoordinatesIfPossible(
    candidateDraft,
    options.draftGeocoder,
  );
  const draft = resolution.draft;

  // OpenAI owns itinerary drafting; PlanME only validates and renders the returned draft.
  return createRecommendedItineraryResponse(
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
    { extraValidationIssues: resolution.validationIssues },
  );
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
      stops: day.stops.map((stop) => {
        if (
          isGenericAccommodationLabel(stop.name, region) ||
          isSameAccommodationCandidate(stop.name, candidate)
        ) {
          return {
            ...stop,
            name: candidate.name,
            coordinate: candidate.coordinate,
          };
        }

        return stop;
      }),
      timeline: day.timeline.map((event) => ({
        ...event,
        title: replaceGenericAccommodationText(event.title, region, candidate.name),
        description: replaceGenericAccommodationText(
          event.description,
          region,
          candidate.name,
        ),
      })),
    })),
  };
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

  const stopNames = draft.days.flatMap((day) => day.stops.map((stop) => stop.name));
  const matchedCandidate = candidates.find((candidate) =>
    stopNames.some((stopName) => isSameAccommodationCandidate(stopName, candidate)),
  );

  return matchedCandidate ?? candidates[0] ?? null;
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
