import {
  createGeneratedItinerary,
  getPlanmeItineraryById,
  type GeneratedItineraryRequest,
} from "./generated-itineraries.js";
import {
  createPlanmeDraftPreview,
  type PlanmeDraftPreviewRequest,
  type PlanmeDraftPreviewResult,
} from "./draft-itineraries.js";
import type { PlanmeItinerary } from "./mock-data.js";
import {
  generatePlanmeDraftWithOpenAi,
  type AiItineraryGenerator,
} from "./openai-itinerary-generator.js";
import {
  encodePlanmePreviewPayload,
  PLANME_PREVIEW_DATA_PARAM,
} from "./preview-payload.js";

export type RecommendItineraryRequest = GeneratedItineraryRequest & {
  title?: string;
  region?: string;
  duration?: string;
  summary?: string;
  assumptions?: string[];
  savedMinutes?: number;
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
 * Builds the stable PlanME draft preview URL used for stateless ChatGPT link handoff.
 */
export function buildPlanmePreviewPageUrl(
  requestUrl: string,
  itinerary: PlanmeItinerary,
): string {
  const url = new URL(requestUrl);

  // Draft previews are not persisted yet, so the web page receives the itinerary through the URL.
  const previewUrl = new URL("/itinerary/preview", url.origin);
  previewUrl.searchParams.set(PLANME_PREVIEW_DATA_PARAM, encodePlanmePreviewPayload(itinerary));

  return previewUrl.toString();
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
  const pageUrl = buildPlanmePreviewPageUrl(requestUrl, result.itinerary);

  // Draft preview pages use an encoded payload rather than a generated detail route.
  return {
    ...response,
    pageUrl,
    itinerary: {
      ...response.itinerary,
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
) {
  if (hasDraftDays(input)) {
    const result = createPlanmeDraftPreview(toDraftPreviewRequest(input));

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
    return createRecommendedItineraryResponse(requestUrl, input);
  }

  const aiItineraryGenerator = options.aiItineraryGenerator ?? generatePlanmeDraftWithOpenAi;
  const draft = await aiItineraryGenerator(input);

  // OpenAI owns itinerary drafting; PlanME only validates and renders the returned draft.
  return createRecommendedItineraryResponse(requestUrl, {
    ...input,
    title: draft.title,
    region: draft.region,
    duration: draft.duration,
    summary: draft.summary,
    origin: draft.origin ?? input.origin,
    assumptions: draft.assumptions ?? input.assumptions,
    savedMinutes: draft.savedMinutes ?? input.savedMinutes,
    days: draft.days,
  });
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
