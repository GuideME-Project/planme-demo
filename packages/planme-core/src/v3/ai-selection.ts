import type {
  AiPlanSelection,
  AiPlanSelectionDay,
  JsonObject,
  JsonValue,
  TourPlaceSnapshot,
} from "./contracts.js";

export type AiSelectionValidationErrorCode =
  | "INVALID_JSON"
  | "INVALID_SHAPE"
  | "ADDITIONAL_PROPERTY"
  | "DAY_MISMATCH"
  | "CANDIDATE_NOT_ALLOWED"
  | "CONTENT_TYPE_MISMATCH"
  | "DUPLICATE_CONTENT_ID";

export type AiSelectionValidationResult =
  | { ok: true; value: AiPlanSelection }
  | { ok: false; errorCode: AiSelectionValidationErrorCode };

const ROOT_KEYS = ["lodgingContentId", "days"];
const DAY_KEYS = [
  "day",
  "orderedVisitContentIds",
  "restaurantContentIds",
];

export function parseAndValidateAiPlanSelection(
  rawJson: string,
  candidates: TourPlaceSnapshot[],
  durationDays: number,
): AiSelectionValidationResult {
  let parsed: JsonValue;

  try {
    parsed = JSON.parse(rawJson) as JsonValue;
  } catch {
    return { ok: false, errorCode: "INVALID_JSON" };
  }

  return validateAiPlanSelection(parsed, candidates, durationDays);
}

export function validateAiPlanSelection(
  value: JsonValue,
  candidates: TourPlaceSnapshot[],
  durationDays: number,
): AiSelectionValidationResult {
  if (!isJsonObject(value)) {
    return { ok: false, errorCode: "INVALID_SHAPE" };
  }

  if (!hasExactKeys(value, ROOT_KEYS)) {
    return {
      ok: false,
      errorCode: hasRequiredKeys(value, ROOT_KEYS)
        ? "ADDITIONAL_PROPERTY"
        : "INVALID_SHAPE",
    };
  }

  if (
    typeof value.lodgingContentId !== "string" ||
    !Array.isArray(value.days)
  ) {
    return { ok: false, errorCode: "INVALID_SHAPE" };
  }

  const days: AiPlanSelectionDay[] = [];
  for (const dayValue of value.days) {
    if (!isJsonObject(dayValue)) {
      return { ok: false, errorCode: "INVALID_SHAPE" };
    }

    if (!hasExactKeys(dayValue, DAY_KEYS)) {
      return {
        ok: false,
        errorCode: hasRequiredKeys(dayValue, DAY_KEYS)
          ? "ADDITIONAL_PROPERTY"
          : "INVALID_SHAPE",
      };
    }

    if (
      typeof dayValue.day !== "number" ||
      !Number.isInteger(dayValue.day) ||
      !isStringArray(dayValue.orderedVisitContentIds) ||
      !isStringArray(dayValue.restaurantContentIds)
    ) {
      return { ok: false, errorCode: "INVALID_SHAPE" };
    }

    days.push({
      day: dayValue.day,
      orderedVisitContentIds: [...dayValue.orderedVisitContentIds],
      restaurantContentIds: [...dayValue.restaurantContentIds],
    });
  }

  if (
    days.length !== durationDays ||
    days.some((day, index) => day.day !== index + 1)
  ) {
    return { ok: false, errorCode: "DAY_MISMATCH" };
  }

  const candidateById = new Map(
    candidates.map((candidate) => [candidate.contentId, candidate]),
  );
  const lodging = candidateById.get(value.lodgingContentId);
  if (!lodging) {
    return { ok: false, errorCode: "CANDIDATE_NOT_ALLOWED" };
  }

  if (lodging.contentTypeId !== 32) {
    return { ok: false, errorCode: "CONTENT_TYPE_MISMATCH" };
  }

  const usedContentIds = new Set<string>();
  for (const day of days) {
    for (const contentId of day.orderedVisitContentIds) {
      const candidate = candidateById.get(contentId);
      if (!candidate) {
        return { ok: false, errorCode: "CANDIDATE_NOT_ALLOWED" };
      }
      if (![12, 14, 15, 28, 38].includes(candidate.contentTypeId)) {
        return { ok: false, errorCode: "CONTENT_TYPE_MISMATCH" };
      }
      if (usedContentIds.has(contentId)) {
        return { ok: false, errorCode: "DUPLICATE_CONTENT_ID" };
      }
      usedContentIds.add(contentId);
    }

    for (const contentId of day.restaurantContentIds) {
      const candidate = candidateById.get(contentId);
      if (!candidate) {
        return { ok: false, errorCode: "CANDIDATE_NOT_ALLOWED" };
      }
      if (candidate.contentTypeId !== 39) {
        return { ok: false, errorCode: "CONTENT_TYPE_MISMATCH" };
      }
      if (usedContentIds.has(contentId)) {
        return { ok: false, errorCode: "DUPLICATE_CONTENT_ID" };
      }
      usedContentIds.add(contentId);
    }
  }

  return {
    ok: true,
    value: {
      lodgingContentId: value.lodgingContentId,
      days,
    },
  };
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: JsonValue | undefined): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasRequiredKeys(value: JsonObject, keys: string[]) {
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function hasExactKeys(value: JsonObject, keys: string[]) {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && hasRequiredKeys(value, keys);
}
