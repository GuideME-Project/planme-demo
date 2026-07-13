import {
  DEFAULT_RECOMMENDATION_DESTINATION_TYPE,
  type PlanmeClarificationContext,
  type PlanmeClarificationResponse,
  type RecommendItineraryRequest,
} from "./gpt-actions.js";
import {
  PLANME_EXTERNAL_DURATION_ERROR_MESSAGE,
  PLANME_EXTERNAL_MAX_DURATION_DAYS,
} from "./external-duration-contract.js";
import type { PlanmeTransportMode } from "./mock-data.js";

export type PlanmePlanningSlot =
  | "destination"
  | "origin"
  | "durationDays"
  | "transportMode"
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
    destinationType: "region" | "place" | null;
    origin: string | null;
    arrivalAirport: string | null;
    durationDays: number | null;
    hotelName: string | null;
    preferences: string[];
    mustVisitPlaces: string[];
    transportMode: PlanmeTransportMode | null;
  };
  nextAction: "ask_user" | "recommend_planme_itinerary";
};

export type PlanmePlanningRequest = Partial<RecommendItineraryRequest> & {
  latestUserMessage?: string;
  message?: string;
};

export type PlanmeModelRecommendationInput = Omit<
  RecommendItineraryRequest,
  "transportMode"
> & {
  transportMode?: RecommendItineraryRequest["transportMode"];
};

export type PlanmeConfirmedRecommendationRun<T> =
  | { status: "needs_transport_confirmation" }
  | { status: "confirmed"; value: T };

export const PLANME_TRANSPORT_MODE_QUESTION =
  "자동차와 대중교통 중 어떤 이동 수단으로 안내할까요?";

const DRIVE_USER_MESSAGE_PATTERNS = [
  /^(?:자동차|자차|자가용|렌터카|렌트카)(?:(?:로|으로|를|을)?\s*(?:이용(?:할게(?:요)?|해(?:요)?|해줘|해주세요)?|선택(?:할게(?:요)?|해(?:요)?|해줘|해주세요)?|갈게(?:요)?|할게(?:요)?|안내(?:해줘|해주세요)?|검색(?:해줘|해주세요)?|해줘|해주세요))?(?:이요|요)?[.!?]?$/i,
  /(?:^|[\s,，/])(?:자동차|자차|자가용|렌터카|렌트카)(?:로|으로|를|을)\s*(?:이용|선택|안내|검색|여행|갈|가|할|해)(?:$|[\s,.!?，/])/i,
  /(?:^|[,，/]\s*|\s)(?:자동차|자차|자가용|렌터카|렌트카)(?:이요|요)?[.!?]?$/i,
  /(?:^|[\s,，/])(?:자동차|자차|자가용|렌터카|렌트카)\s+여행(?:$|[\s,.!?，/])/i,
  /\bby\s+car\b/i,
  /^(?:car|drive|driving)[.!?]?$/i,
];
const TRANSIT_USER_MESSAGE_PATTERNS = [
  /^대중교통(?:(?:으로|을)?\s*(?:이용(?:할게(?:요)?|해(?:요)?|해줘|해주세요)?|선택(?:할게(?:요)?|해(?:요)?|해줘|해주세요)?|갈게(?:요)?|할게(?:요)?|안내(?:해줘|해주세요)?|검색(?:해줘|해주세요)?|해줘|해주세요))?(?:이요|요)?[.!?]?$/i,
  /(?:^|[\s,，/])대중교통(?:으로|을)\s*(?:이용|선택|안내|검색|여행|갈|가|할|해)(?:$|[\s,.!?，/])/i,
  /(?:^|[,，/]\s*|\s)대중교통(?:이요|요)?[.!?]?$/i,
  /(?:^|[\s,，/])대중교통\s+여행(?:$|[\s,.!?，/])/i,
  /^(?:public\s+transport(?:ation)?|public\s+transit|transit)[.!?]?$/i,
];
const TRANSPORT_NEGATION_PATTERN =
  /(?:자동차|자차|자가용|렌터카|렌트카|대중교통)(?:\s*(?:은|는|을|를|로|으로))?\s*(?:없이|제외|말고|아니|안\s*(?:타|탈|쓰|이용|갈|가|할)|사용하지|(?:이용|선택|안내|검색)\s*(?:안|않|하지))/i;

/**
 * Assesses whether a PlanME planning request is ready for itinerary generation.
 */
export function assessPlanmePlanningInput(
  input: PlanmePlanningRequest,
): PlanmePlanningAssessment {
  const normalizedInput = {
    arrivalAirport: normalizeOptionalText(input.arrivalAirport),
    destination: normalizeOptionalText(input.destination),
    destinationType: normalizeDestinationType(input.destinationType),
    durationDays: normalizeDurationDays(input.durationDays),
    hotelName: normalizeOptionalText(input.hotelName),
    origin: normalizeOptionalText(input.origin),
    preferences: normalizePreferences(input.preferences),
    mustVisitPlaces: [...new Set(normalizePreferences(input.mustVisitPlaces))],
    transportMode: normalizeTransportMode(input.transportMode),
  };
  const missingSlots = getMissingRequiredSlots(normalizedInput);
  const questions = missingSlots.map(createRequiredQuestion);
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
 * Accepts a transport mode only when the latest user-authored message names one choice.
 */
export function resolvePlanmeTransportModeFromUserMessage(
  latestUserMessage: string | null | undefined,
): PlanmeTransportMode | null {
  const message = latestUserMessage?.trim();

  if (!message) {
    return null;
  }

  const normalizedMessage = message.replace(/\s+/g, " ").replace(/해 주세요/g, "해주세요");

  if (TRANSPORT_NEGATION_PATTERN.test(normalizedMessage)) {
    return null;
  }

  if (normalizedMessage.includes("자동차") && normalizedMessage.includes("대중교통")) {
    return null;
  }

  const mentionsDrive = DRIVE_USER_MESSAGE_PATTERNS.some((pattern) =>
    pattern.test(normalizedMessage),
  );
  const mentionsTransit = TRANSIT_USER_MESSAGE_PATTERNS.some((pattern) =>
    pattern.test(normalizedMessage),
  );

  if (mentionsDrive === mentionsTransit) {
    return null;
  }

  return mentionsDrive ? "drive" : "transit";
}

/**
 * Runs generation only after deriving one supported mode from the latest user message.
 */
export async function runPlanmeUserConfirmedRecommendation<T>(
  latestUserMessage: string | null | undefined,
  input: PlanmeModelRecommendationInput,
  runner: (confirmedInput: RecommendItineraryRequest) => Promise<T>,
): Promise<PlanmeConfirmedRecommendationRun<T>> {
  const explicitTransportMode = resolvePlanmeTransportModeFromUserMessage(latestUserMessage);

  if (!explicitTransportMode) {
    return { status: "needs_transport_confirmation" };
  }

  const { transportMode: _modelTransportMode, ...transportIndependentInput } = input;
  const value = await runner({
    ...transportIndependentInput,
    transportMode: explicitTransportMode,
  });

  return { status: "confirmed", value };
}

/**
 * Returns the shared transport-mode question used when a model supplies an unconfirmed mode.
 */
export function createPlanmeTransportModeClarification(
  context?: PlanmeClarificationContext,
): PlanmeClarificationResponse {
  return {
    clarificationContext: {
      previousAnswers: context?.previousAnswers ?? [],
      previousQuestions: [
        ...new Set([...(context?.previousQuestions ?? []), PLANME_TRANSPORT_MODE_QUESTION]),
      ],
      round: context?.round ?? 0,
      unresolvedPlaces: context?.unresolvedPlaces ?? [],
    },
    message: "일정 생성 전에 이동 수단 선택이 필요합니다.",
    questions: [PLANME_TRANSPORT_MODE_QUESTION],
    resolutionLogs: [],
    status: "needs_clarification",
    unresolvedStops: [],
    validationIssues: [],
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
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 1 ||
    value > PLANME_EXTERNAL_MAX_DURATION_DAYS
  ) {
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
 * Keeps only the two user-facing itinerary transport modes.
 */
function normalizeTransportMode(value: PlanmeTransportMode | undefined) {
  return value === "drive" || value === "transit" ? value : null;
}

/**
 * Preserves the explicit destination meaning without turning legacy omission into a question.
 */
function normalizeDestinationType(value: RecommendItineraryRequest["destinationType"]) {
  return value === "region" || value === "place"
    ? value
    : DEFAULT_RECOMMENDATION_DESTINATION_TYPE;
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

  if (!normalizedInput.transportMode) {
    missingSlots.push("transportMode");
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
      text: PLANME_EXTERNAL_DURATION_ERROR_MESSAGE,
      required: true,
      examples: ["당일", "1박 2일", "2박 3일"],
    };
  }

  if (slot === "transportMode") {
    return {
      slot,
      text: PLANME_TRANSPORT_MODE_QUESTION,
      required: true,
      examples: ["자동차", "대중교통"],
    };
  }

  return {
    slot: "origin",
    text: "어디에서 출발하시나요?",
    required: true,
    examples: ["서울", "부산", "인천공항"],
  };
}
