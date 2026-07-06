import type { PlanmeDraftPreviewRequest } from "./draft-itineraries.js";
import type { RecommendItineraryRequest } from "./gpt-actions.js";

export type AiItineraryGenerator = (
  input: RecommendItineraryRequest,
) => Promise<PlanmeDraftPreviewRequest>;

type OpenAiItineraryGeneratorOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  model?: string;
};

type OpenAiResponsesApiResult = {
  error?: {
    message?: string;
  };
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
  }>;
  output_text?: string;
};

const OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

/**
 * Signals that PlanME AI generation cannot run because server configuration is missing.
 */
export class PlanmeAiConfigurationError extends Error {
  constructor(message = "OPENAI_API_KEY is required for PlanME AI itinerary generation.") {
    super(message);
    this.name = "PlanmeAiConfigurationError";
  }
}

/**
 * Converts an AI generation failure into a safe operational message without secrets.
 */
export function formatPlanmeAiGenerationError(error: Error): string {
  // OpenAI/Vercel errors should help debugging, but credentials must never be echoed back.
  return error.message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9._-]+/g, "sk-[redacted]");
}

/**
 * Generates a PlanME draft itinerary with OpenAI structured output.
 */
export async function generatePlanmeDraftWithOpenAi(
  input: RecommendItineraryRequest,
  options: OpenAiItineraryGeneratorOptions = {},
): Promise<PlanmeDraftPreviewRequest> {
  const apiKey = options.apiKey?.trim() || readRuntimeEnv("OPENAI_API_KEY");
  const model = options.model?.trim() || readRuntimeEnv("PLANME_OPENAI_MODEL") || DEFAULT_OPENAI_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!apiKey) {
    throw new PlanmeAiConfigurationError();
  }

  const response = await fetchImpl(OPENAI_RESPONSES_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: createItineraryGenerationPrompt(input),
      text: {
        format: {
          type: "json_schema",
          name: "planme_itinerary_draft",
          strict: true,
          schema: createPlanmeDraftJsonSchema(),
        },
      },
    }),
  });

  const payload = (await response.json()) as OpenAiResponsesApiResult;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "OpenAI itinerary generation failed.");
  }

  return normalizeGeneratedDraft(parseOpenAiDraftPayload(payload));
}

/**
 * Reads server-only runtime environment values without requiring Node globals in browser bundles.
 */
function readRuntimeEnv(name: string) {
  const runtime = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return runtime.process?.env?.[name]?.trim() ?? "";
}

/**
 * Builds the prompt that asks OpenAI to create concrete POIs instead of PlanME doing it locally.
 */
function createItineraryGenerationPrompt(input: RecommendItineraryRequest) {
  const durationDays = input.durationDays ?? 2;
  const preferences = input.preferences?.length ? input.preferences.join(", ") : "없음";
  const accommodationCandidates = input.accommodationCandidates ?? [];
  const accommodationInstruction =
    accommodationCandidates.length > 0
      ? "숙소가 명시되지 않았으면 아래 숙소 후보 중 하나만 숙소/짐 도착지로 사용하고, '<지역> 숙소' 같은 일반명을 쓰지 마세요."
      : "숙소가 명시되지 않았으면 '숙소 확인 필요'처럼 미정 상태를 쓰고, 특정 호텔명을 지어내지 마세요.";

  return [
    "너는 한국 여행 일정 플래너입니다.",
    "사용자 요청을 바탕으로 PlanME 위젯에 바로 넣을 수 있는 현실적인 일정 초안을 JSON으로 작성하세요.",
    "PlanME 서버는 장소를 보정하지 않으므로, 목적지의 실제 한국어 장소명을 직접 선택해야 합니다.",
    "공항이 명시되지 않았으면 인천공항, 김포공항, 김해공항 같은 기본 공항을 절대 만들지 마세요.",
    "사용자가 출발지를 말했으면 첫 타임라인은 '<출발지> 출발'로 작성하세요.",
    accommodationInstruction,
    "역/터미널/공항은 기본 수하물 보관·수령지가 아닙니다. luggageDestination은 숙소, 호텔, 또는 사용자가 명시한 CarryME 수령 지점에만 사용하세요.",
    "부산역 짐 보관, 부산역 짐 수령처럼 교통 거점에서 짐을 맡기거나 찾는 표현을 만들지 마세요.",
    "아이 동반, 가족 여행, 실내/야외 균형 같은 선호를 반영해 무리 없는 방문지 2-4개를 고르세요.",
    "",
    `목적지: ${input.destination ?? input.region ?? "미정"}`,
    `출발지: ${input.origin ?? "미정"}`,
    `여행 기간: ${durationDays}일`,
    `숙소: ${input.hotelName ?? "미정"}`,
    `인원: ${input.travelerCount ?? 1}명`,
    `짐 개수: ${input.luggageCount ?? 1}개`,
    `선호: ${preferences}`,
    createAccommodationCandidatePromptSection(accommodationCandidates),
  ].join("\n");
}

/**
 * Serializes lodging candidates for the model without exposing provider credentials.
 */
function createAccommodationCandidatePromptSection(
  candidates: NonNullable<RecommendItineraryRequest["accommodationCandidates"]>,
) {
  if (candidates.length === 0) {
    return "숙소 후보: 없음";
  }

  return [
    "숙소 후보:",
    "아래 숙소 후보 중 하나를 luggageDestination 또는 finalDestination으로 사용하세요.",
    ...candidates.map((candidate, index) =>
      [
        `${index + 1}. ${candidate.name}`,
        `주소: ${candidate.address}`,
        `좌표: ${candidate.coordinate.lat}, ${candidate.coordinate.lng}`,
        `placeId: ${candidate.placeId ?? candidate.id}`,
      ].join(" | "),
    ),
  ].join("\n");
}

/**
 * Describes the exact JSON object PlanME can render as a draft preview.
 */
function createPlanmeDraftJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "region", "duration", "summary", "origin", "assumptions", "savedMinutes", "days"],
    properties: {
      title: { type: "string" },
      region: { type: "string" },
      duration: { type: "string" },
      summary: { type: "string" },
      origin: { type: "string" },
      assumptions: {
        type: "array",
        items: { type: "string" },
      },
      savedMinutes: { type: "integer", minimum: 0 },
      days: {
        type: "array",
        minItems: 1,
        maxItems: 2,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "day",
            "label",
            "stops",
            "timeline",
            "standardDurationMinutes",
            "carrymeDurationMinutes",
            "standardRouteText",
            "carrymeRouteText",
          ],
          properties: {
            day: { type: "integer", minimum: 1, maximum: 14 },
            label: { type: "string" },
            stops: {
              type: "array",
              minItems: 2,
              maxItems: 8,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "role", "caption"],
                properties: {
                  name: { type: "string" },
                  role: {
                    type: "string",
                    enum: ["origin", "visit", "luggageDestination", "finalDestination"],
                  },
                  caption: { type: "string" },
                },
              },
            },
            timeline: {
              type: "array",
              minItems: 2,
              maxItems: 8,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["time", "title", "description", "category", "highlight", "savingLabel"],
                properties: {
                  time: { type: "string" },
                  title: { type: "string" },
                  description: { type: "string" },
                  category: {
                    type: "string",
                    enum: ["arrival", "carryme", "transit", "meal", "hotel", "event"],
                  },
                  highlight: { type: "boolean" },
                  savingLabel: { type: "string" },
                },
              },
            },
            standardDurationMinutes: { type: "integer", minimum: 0 },
            carrymeDurationMinutes: { type: "integer", minimum: 0 },
            standardRouteText: { type: "string" },
            carrymeRouteText: { type: "string" },
          },
        },
      },
    },
  };
}

/**
 * Extracts the JSON string from a Responses API result.
 */
function parseOpenAiDraftPayload(payload: OpenAiResponsesApiResult): PlanmeDraftPreviewRequest {
  const outputText =
    payload.output_text ??
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text ?? "")
      .find((text) => text.trim().length > 0);

  if (!outputText) {
    throw new Error("OpenAI itinerary generation returned an empty response.");
  }

  return JSON.parse(outputText) as PlanmeDraftPreviewRequest;
}

/**
 * Trims generated strings and removes empty optional labels before PlanME validation.
 */
function normalizeGeneratedDraft(draft: PlanmeDraftPreviewRequest): PlanmeDraftPreviewRequest {
  return {
    ...draft,
    title: draft.title.trim(),
    region: draft.region?.trim(),
    duration: draft.duration?.trim(),
    summary: draft.summary?.trim(),
    origin: draft.origin?.trim(),
    assumptions: draft.assumptions?.map((assumption) => assumption.trim()).filter(Boolean),
    days: draft.days.map((day) => ({
      ...day,
      label: day.label?.trim(),
      standardRouteText: day.standardRouteText?.trim(),
      carrymeRouteText: day.carrymeRouteText?.trim(),
      stops: day.stops.map((stop) => ({
        ...stop,
        name: stop.name.trim(),
        caption: stop.caption?.trim(),
      })),
      timeline: day.timeline.map((event) => ({
        ...event,
        title: event.title.trim(),
        description: event.description.trim(),
        savingLabel: event.savingLabel?.trim() || undefined,
      })),
    })),
  };
}
