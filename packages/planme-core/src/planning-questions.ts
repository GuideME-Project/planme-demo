import type { RecommendItineraryRequest } from "./gpt-actions.js";

export type PlanmePlanningSlot =
  | "destination"
  | "origin"
  | "durationDays"
  | "hotelName"
  | "preferences";

export type PlanmePlanningQuestion = {
  slot: PlanmePlanningSlot;
  text: string;
  required: boolean;
  examples: string[];
};

export type PlanmePlanningAssessment = {
  status: "needs_input" | "ready";
  missingSlots: PlanmePlanningSlot[];
  questions: PlanmePlanningQuestion[];
  normalizedInput: {
    destination: string | null;
    origin: string | null;
    arrivalAirport: string | null;
    durationDays: number | null;
    hotelName: string | null;
    preferences: string[];
  };
  nextAction: "ask_user" | "recommend_planme_itinerary";
};

export type PlanmePlanningRequest = RecommendItineraryRequest & {
  message?: string;
};

/**
 * Assesses whether a PlanME planning request is ready for itinerary generation.
 */
export function assessPlanmePlanningInput(
  input: PlanmePlanningRequest,
): PlanmePlanningAssessment {
  const normalizedInput = {
    arrivalAirport: normalizeOptionalText(input.arrivalAirport),
    destination: normalizeOptionalText(input.destination),
    durationDays: normalizeDurationDays(input.durationDays),
    hotelName: normalizeOptionalText(input.hotelName),
    origin: normalizeOptionalText(input.origin),
    preferences: normalizePreferences(input.preferences),
  };
  const missingSlots = getMissingRequiredSlots(normalizedInput);
  const requiredQuestions = missingSlots.map(createRequiredQuestion);
  const optionalQuestion = createOptionalQuestion(normalizedInput);
  const questions =
    requiredQuestions.length > 0
      ? requiredQuestions
      : optionalQuestion
        ? [optionalQuestion]
        : [];
  const status = missingSlots.length > 0 ? "needs_input" : "ready";

  // The MCP server uses this action hint to decide whether ChatGPT should ask or draft.
  return {
    status,
    missingSlots,
    questions,
    normalizedInput,
    nextAction: status === "ready" ? "recommend_planme_itinerary" : "ask_user",
  };
}

/**
 * Trims optional text values while preserving null for missing planning slots.
 */
function normalizeOptionalText(value: string | undefined) {
  const normalizedValue = value?.trim();

  return normalizedValue && normalizedValue.length > 0 ? normalizedValue : null;
}

/**
 * Normalizes trip length into full days because PlanME labels 당일 as 1 day.
 */
function normalizeDurationDays(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return null;
  }

  return Math.round(value);
}

/**
 * Drops empty preference fragments so optional question logic is stable.
 */
function normalizePreferences(preferences: string[] | undefined) {
  return (preferences ?? []).map((preference) => preference.trim()).filter(Boolean);
}

/**
 * Finds missing required slots without treating a known arrival airport as missing origin.
 */
function getMissingRequiredSlots(
  normalizedInput: PlanmePlanningAssessment["normalizedInput"],
) {
  const missingSlots: PlanmePlanningSlot[] = [];

  if (!normalizedInput.destination) {
    missingSlots.push("destination");
  }

  if (!normalizedInput.origin && !normalizedInput.arrivalAirport) {
    missingSlots.push("origin");
  }

  if (!normalizedInput.durationDays) {
    missingSlots.push("durationDays");
  }

  return missingSlots;
}

/**
 * Builds the Korean follow-up question for each required slot.
 */
function createRequiredQuestion(slot: PlanmePlanningSlot): PlanmePlanningQuestion {
  if (slot === "destination") {
    return {
      slot,
      text: "어느 지역으로 여행하시나요?",
      required: true,
      examples: ["여수", "부산", "제주"],
    };
  }

  if (slot === "durationDays") {
    return {
      slot,
      text: "일정은 당일인가요, 1박 2일인가요?",
      required: true,
      examples: ["당일", "1박 2일", "2박 3일"],
    };
  }

  return {
    slot: "origin",
    text: "어디에서 출발하시나요?",
    required: true,
    examples: ["서울", "부산", "인천공항"],
  };
}

/**
 * Offers at most one optional question so the GPT conversation stays lightweight.
 */
function createOptionalQuestion(
  normalizedInput: PlanmePlanningAssessment["normalizedInput"],
): PlanmePlanningQuestion | null {
  if (!normalizedInput.hotelName) {
    return {
      slot: "hotelName",
      text: "짐을 받을 숙소나 보관 지점이 정해져 있나요?",
      required: false,
      examples: ["여수 베네치아 호텔", "아직 미정"],
    };
  }

  if (normalizedInput.preferences.length === 0) {
    return {
      slot: "preferences",
      text: "꼭 포함하고 싶은 장소나 여행 테마가 있나요?",
      required: false,
      examples: ["밤바다", "공연", "맛집"],
    };
  }

  return null;
}
