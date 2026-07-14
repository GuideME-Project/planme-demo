import type { ResolvedTripIntent, TripIntentInput } from "./contracts.js";

export type TripIntentValidationResult =
  | { ok: true; value: ResolvedTripIntent }
  | {
      ok: false;
      missingSlots: Array<"origin" | "destination" | "transportMode" | "durationDays">;
      invalidSlots: Array<"origin" | "destination" | "transportMode" | "durationDays">;
    };

export function resolveTripIntent(
  input: TripIntentInput,
): TripIntentValidationResult {
  const origin = normalizeText(input.origin);
  const destination = normalizeText(input.destination);
  const missingSlots: Array<
    "origin" | "destination" | "transportMode" | "durationDays"
  > = [];
  const invalidSlots: Array<
    "origin" | "destination" | "transportMode" | "durationDays"
  > = [];

  if (!origin) {
    missingSlots.push("origin");
  }

  if (!destination) {
    missingSlots.push("destination");
  }

  if (input.transportMode === undefined) {
    missingSlots.push("transportMode");
  } else if (input.transportMode !== "drive" && input.transportMode !== "transit") {
    invalidSlots.push("transportMode");
  }

  if (input.durationDays === undefined) {
    missingSlots.push("durationDays");
  } else if (
    !Number.isInteger(input.durationDays) ||
    input.durationDays < 1 ||
    input.durationDays > 14
  ) {
    invalidSlots.push("durationDays");
  }

  if (missingSlots.length > 0 || invalidSlots.length > 0) {
    return { ok: false, missingSlots, invalidSlots };
  }

  if (!origin || !destination || !input.transportMode || !input.durationDays) {
    return { ok: false, missingSlots, invalidSlots };
  }

  return {
    ok: true,
    value: {
      origin,
      destination,
      transportMode: input.transportMode,
      durationDays: input.durationDays,
      travelStartDate: normalizeDate(input.travelStartDate),
      preferences: normalizeTextList(input.preferences),
      requestedPlaces: normalizeTextList(input.requestedPlaces),
      travelerCount: normalizeInteger(input.travelerCount, 1, 20, 1),
      luggageCount: normalizeInteger(input.luggageCount, 0, 20, 1),
    },
  };
}

function normalizeText(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeTextList(values: string[] | undefined) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function normalizeDate(value: string | undefined) {
  const normalized = normalizeText(value);
  return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? normalized
    : undefined;
}

function normalizeInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  return Number.isInteger(value) && value !== undefined && value >= minimum && value <= maximum
    ? value
    : fallback;
}
