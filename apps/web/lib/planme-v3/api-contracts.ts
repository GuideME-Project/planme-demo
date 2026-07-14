import type { JsonObject, JsonValue } from "@planme/core";
import type { StartItineraryRequest } from "./orchestrator";
import type { EditItineraryRequest } from "./orchestrator";

const START_KEYS = new Set([
  "origin",
  "destination",
  "transportMode",
  "durationDays",
  "travelStartDate",
  "preferences",
  "requestedPlaces",
  "travelerCount",
  "luggageCount",
]);

export function parseStartItineraryRequest(text: string):
  | { ok: true; value: StartItineraryRequest }
  | { ok: false } {
  const parsed = parseJsonObject(text);
  if (
    !parsed ||
    Object.keys(parsed).some((key) => !START_KEYS.has(key)) ||
    typeof parsed.origin !== "string" ||
    typeof parsed.destination !== "string" ||
    (parsed.transportMode !== "drive" && parsed.transportMode !== "transit") ||
    typeof parsed.durationDays !== "number" ||
    !Number.isInteger(parsed.durationDays) ||
    !isOptionalString(parsed.travelStartDate) ||
    !isOptionalStringArray(parsed.preferences) ||
    !isOptionalStringArray(parsed.requestedPlaces) ||
    !isOptionalInteger(parsed.travelerCount) ||
    !isOptionalInteger(parsed.luggageCount)
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      origin: parsed.origin,
      destination: parsed.destination,
      transportMode: parsed.transportMode,
      durationDays: parsed.durationDays,
      ...(typeof parsed.travelStartDate === "string"
        ? { travelStartDate: parsed.travelStartDate }
        : {}),
      ...(Array.isArray(parsed.preferences)
        ? { preferences: [...parsed.preferences] as string[] }
        : {}),
      ...(Array.isArray(parsed.requestedPlaces)
        ? { requestedPlaces: [...parsed.requestedPlaces] as string[] }
        : {}),
      ...(typeof parsed.travelerCount === "number"
        ? { travelerCount: parsed.travelerCount }
        : {}),
      ...(typeof parsed.luggageCount === "number"
        ? { luggageCount: parsed.luggageCount }
        : {}),
    },
  };
}

export function parseRunRequest(text: string):
  | { ok: true; deadlineEpochMs: number }
  | { ok: false } {
  const parsed = parseJsonObject(text);
  if (
    !parsed ||
    Object.keys(parsed).length !== 1 ||
    typeof parsed.deadlineEpochMs !== "number" ||
    !Number.isInteger(parsed.deadlineEpochMs) ||
    parsed.deadlineEpochMs <= 0
  ) {
    return { ok: false };
  }
  return { ok: true, deadlineEpochMs: parsed.deadlineEpochMs };
}

export function parseEditItineraryRequest(text: string):
  | { ok: true; value: EditItineraryRequest }
  | { ok: false } {
  const parsed = parseJsonObject(text);
  return parseEditObject(parsed, false);
}

export function parseBrowserEditItineraryRequest(text: string):
  | { ok: true; token: string; value: EditItineraryRequest }
  | { ok: false } {
  const parsed = parseJsonObject(text);
  if (!parsed || typeof parsed.token !== "string") {
    return { ok: false };
  }
  const result = parseEditObject(parsed, true);
  return result.ok
    ? { ok: true, token: parsed.token, value: result.value }
    : { ok: false };
}

function parseJsonObject(text: string): JsonObject | null {
  let value: JsonValue;
  try {
    value = JSON.parse(text) as JsonValue;
  } catch {
    return null;
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
}

function isOptionalString(value: JsonValue | undefined) {
  return value === undefined || typeof value === "string";
}

function isOptionalStringArray(value: JsonValue | undefined) {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

function isOptionalInteger(value: JsonValue | undefined) {
  return value === undefined || (typeof value === "number" && Number.isInteger(value));
}

function parseEditObject(
  parsed: JsonObject | null,
  allowToken: boolean,
): { ok: true; value: EditItineraryRequest } | { ok: false } {
  const allowedKeys = new Set([
    "baseRevision",
    "transportMode",
    "lodgingContentId",
    "days",
    ...(allowToken ? ["token"] : []),
  ]);
  if (
    !parsed ||
    Object.keys(parsed).some((key) => !allowedKeys.has(key)) ||
    typeof parsed.baseRevision !== "number" ||
    !Number.isInteger(parsed.baseRevision) ||
    parsed.baseRevision < 1 ||
    !isOptionalTransportMode(parsed.transportMode) ||
    !isOptionalNonEmptyString(parsed.lodgingContentId) ||
    !Array.isArray(parsed.days)
  ) {
    return { ok: false };
  }

  const days: EditItineraryRequest["days"] = [];
  for (const dayValue of parsed.days) {
    if (
      !isJsonObject(dayValue) ||
      Object.keys(dayValue).some(
        (key) => !["day", "orderedVisitContentIds", "restaurantContentIds"].includes(key),
      ) ||
      typeof dayValue.day !== "number" ||
      !Number.isInteger(dayValue.day) ||
      !isStringArray(dayValue.orderedVisitContentIds) ||
      !isOptionalStringArray(dayValue.restaurantContentIds)
    ) {
      return { ok: false };
    }
    days.push({
      day: dayValue.day,
      orderedVisitContentIds: [...dayValue.orderedVisitContentIds],
      ...(Array.isArray(dayValue.restaurantContentIds)
        ? { restaurantContentIds: [...dayValue.restaurantContentIds] as string[] }
        : {}),
    });
  }
  return {
    ok: true,
    value: {
      baseRevision: parsed.baseRevision,
      days,
      ...(typeof parsed.transportMode === "string"
        ? { transportMode: parsed.transportMode as "drive" | "transit" }
        : {}),
      ...(typeof parsed.lodgingContentId === "string"
        ? { lodgingContentId: parsed.lodgingContentId }
        : {}),
    },
  };
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: JsonValue | undefined): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalTransportMode(value: JsonValue | undefined) {
  return value === undefined || value === "drive" || value === "transit";
}

function isOptionalNonEmptyString(value: JsonValue | undefined) {
  return value === undefined || (typeof value === "string" && value.trim().length > 0);
}
