import { getItineraryById, getDemoItinerary, type PlanmeItinerary } from "@/lib/mock-data";

export type RecommendItineraryRequest = {
  destination?: string;
  durationDays?: number;
  arrivalAirport?: string;
  arrivalTime?: string;
  hotelName?: string;
  travelerCount?: number;
  luggageCount?: number;
  preferences?: string[];
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
  highlights: string[];
  itinerary: PlanmeItinerary;
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

  // ChatGPT can render this URL as a Markdown image when native link previews are unavailable.
  return new URL(`/og/itinerary/${itineraryId}`, url.origin).toString();
}

/**
 * Converts the demo itinerary into the compact response shape exposed to Custom GPT Actions.
 */
export function toGptActionItineraryResponse(
  itinerary: PlanmeItinerary,
  requestUrl: string,
): GptActionItineraryResponse {
  const firstDay = itinerary.days[0];
  const pageUrl = buildItineraryPageUrl(requestUrl, itinerary.id);
  const ogImageUrl = buildItineraryOgImageUrl(requestUrl, itinerary.id);

  // The technical validation endpoint keeps calculations deterministic by using the curated mock plan.
  return {
    itineraryId: itinerary.id,
    title: itinerary.title,
    summary: itinerary.carrymeSaving,
    standardTotalMinutes: firstDay.standard.durationMinutes,
    carrymeTotalMinutes: firstDay.carryme.durationMinutes,
    savedMinutes: firstDay.savingMinutes,
    pageUrl,
    ogImageUrl,
    highlights: itinerary.benefits.map((benefit) => benefit.title),
    itinerary: {
      ...itinerary,
      detailUrl: pageUrl,
    },
  };
}

/**
 * Creates the current technical-validation itinerary response for a GPT planning request.
 */
export function createRecommendedItineraryResponse(
  requestUrl: string,
  input: RecommendItineraryRequest,
) {
  const itinerary = getDemoItinerary();

  // The request input is echoed so GPT setup testing can confirm argument mapping.
  return {
    ...toGptActionItineraryResponse(itinerary, requestUrl),
    input: {
      destination: input.destination ?? itinerary.region,
      durationDays: input.durationDays ?? 2,
      arrivalAirport: input.arrivalAirport ?? "KIX",
      arrivalTime: input.arrivalTime ?? "10:00",
      hotelName: input.hotelName ?? null,
      travelerCount: input.travelerCount ?? 1,
      luggageCount: input.luggageCount ?? 1,
      preferences: input.preferences ?? ["USJ", "CarryME comparison"],
      theme: input.theme ?? "light",
    },
  };
}

/**
 * Finds the current demo itinerary and converts it for GPT Actions.
 */
export function getGptActionItineraryResponse(
  itineraryId: string,
  requestUrl: string,
): GptActionItineraryResponse | null {
  const itinerary = getItineraryById(itineraryId);

  // Invalid ids are intentionally returned as null so Route Handlers can map them to 404.
  return itinerary ? toGptActionItineraryResponse(itinerary, requestUrl) : null;
}

/**
 * Creates a share-link response for a generated PlanME itinerary.
 */
export function createItineraryShareResponse(itineraryId: string, requestUrl: string) {
  return {
    itineraryId,
    pageUrl: buildItineraryPageUrl(requestUrl, itineraryId),
    ogImageUrl: buildItineraryOgImageUrl(requestUrl, itineraryId),
    expiresAt: null,
  };
}
