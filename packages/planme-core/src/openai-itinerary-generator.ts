import type { PlanmeDraftPreviewRequest } from "./draft-itineraries.js";
import type {
  PlanmePlaceCandidateDecision,
  PlanmePlaceCandidateDecider,
  PlanmeReplacementQuerySuggester,
  RecommendItineraryRequest,
} from "./gpt-actions.js";
import type { PlanmePlaceCandidateSearcher } from "./place-candidates.js";
import type { PlanmeResolvedRequiredPlaces } from "./place-candidates.js";
import {
  recordPlanmeUsageSafely,
  type PlanmeUsageRecorder,
} from "./usage-events.js";

export type AiGeneratedDraft = Omit<PlanmeDraftPreviewRequest, "transportMode"> & {
  transportMode?: PlanmeDraftPreviewRequest["transportMode"];
};

export type AiItineraryGenerator = (
  input: RecommendItineraryRequest,
  context?: AiItineraryGeneratorContext,
) => Promise<AiGeneratedDraft>;

export type AiItineraryGeneratorContext = {
  googleMapsReferer?: string;
  placeCandidateSearcher?: PlanmePlaceCandidateSearcher;
  requiredPlaces?: PlanmeResolvedRequiredPlaces;
  usageRecorder?: PlanmeUsageRecorder;
};

type OpenAiItineraryGeneratorOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  model?: string;
  usageRecorder?: PlanmeUsageRecorder;
};

type OpenAiResponsesApiResult = {
  error?: {
    message?: string;
  };
  id?: string;
  output?: Array<{
    arguments?: string;
    call_id?: string;
    content?: Array<{
      text?: string;
      type?: string;
    }>;
    name?: string;
    type?: string;
  }>;
  output_text?: string;
};

type OpenAiFunctionCallOutputItem = {
  call_id: string;
  output: string;
  type: "function_call_output";
};

type OpenAiPlaceCandidateDecisionInput = Parameters<PlanmePlaceCandidateDecider>[0];

const OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
// The widget supports longer drafts, but the schema still caps payload size for reliable MCP handoff.
const MAX_GENERATED_ITINERARY_DAYS = 14;
const MAX_OPENAI_TOOL_LOOP_COUNT = 3;

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
 * Creates the default OpenAI-backed place candidate decision function used after geocoding.
 */
export function createOpenAiPlaceCandidateDecider(
  options: OpenAiItineraryGeneratorOptions = {},
): PlanmePlaceCandidateDecider {
  return (input) => decidePlanmePlaceCandidateWithOpenAi(input, options);
}

/**
 * Creates a bounded AI helper that suggests one replacement search query per attempt.
 */
export function createOpenAiReplacementQuerySuggester(
  options: OpenAiItineraryGeneratorOptions = {},
): PlanmeReplacementQuerySuggester {
  return async ({ attempt, itinerary, stop }) => {
    const apiKey = options.apiKey?.trim() || readRuntimeEnv("OPENAI_API_KEY");
    const model = options.model?.trim() || readRuntimeEnv("PLANME_OPENAI_MODEL") || DEFAULT_OPENAI_MODEL;
    const fetchImpl = options.fetchImpl ?? fetch;

    if (!apiKey) {
      throw new PlanmeAiConfigurationError();
    }

    await recordPlanmeUsageSafely(options.usageRecorder, "openai_request");

    const response = await fetchImpl(OPENAI_RESPONSES_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          "한국 국내 여행 일정의 실제 대체 장소 검색어 하나를 작성하세요.",
          "원래 장소와 같은 지역, 일정 주제, 장소 종류를 최대한 유지하세요.",
          "장소나 좌표를 지어내지 말고 네이버 지역 검색에 넣을 짧은 한국어 검색어만 반환하세요.",
          `대체 시도: ${attempt}/2`,
          `원래 장소: ${stop.name}`,
          `원래 검색어: ${stop.addressQuery ?? stop.name}`,
          `목적지: ${itinerary.destination ?? itinerary.region ?? "미정"}`,
          `선호: ${(itinerary.preferences ?? []).join(", ") || "없음"}`,
        ].join("\n"),
        text: {
          format: {
            type: "json_schema",
            name: "planme_replacement_place_query",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["query"],
              properties: {
                query: { type: "string" },
              },
            },
          },
        },
      }),
    });
    const payload = (await response.json()) as OpenAiResponsesApiResult;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? "OpenAI replacement query generation failed.");
    }

    const outputText = extractOpenAiOutputText(payload);

    if (!outputText) {
      return null;
    }

    const parsed = JSON.parse(outputText) as { query?: string };

    return parsed.query?.trim() || null;
  };
}

/**
 * Asks OpenAI to judge whether searched place candidates match the user's itinerary intent.
 */
export async function decidePlanmePlaceCandidateWithOpenAi(
  input: OpenAiPlaceCandidateDecisionInput,
  options: OpenAiItineraryGeneratorOptions = {},
): Promise<PlanmePlaceCandidateDecision> {
  const apiKey = options.apiKey?.trim() || readRuntimeEnv("OPENAI_API_KEY");
  const model = options.model?.trim() || readRuntimeEnv("PLANME_OPENAI_MODEL") || DEFAULT_OPENAI_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!apiKey) {
    throw new PlanmeAiConfigurationError();
  }

  await recordPlanmeUsageSafely(options.usageRecorder, "openai_request");

  const response = await fetchImpl(OPENAI_RESPONSES_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: createPlaceCandidateDecisionPrompt(input),
      text: {
        format: {
          type: "json_schema",
          name: "planme_place_candidate_decision",
          strict: true,
          schema: createPlaceCandidateDecisionJsonSchema(),
        },
      },
    }),
  });
  const payload = (await response.json()) as OpenAiResponsesApiResult;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "OpenAI place candidate decision failed.");
  }

  return normalizePlaceCandidateDecision(parseOpenAiDecisionPayload(payload));
}

/**
 * Generates a PlanME draft itinerary with OpenAI structured output.
 */
export async function generatePlanmeDraftWithOpenAi(
  input: RecommendItineraryRequest,
  options: OpenAiItineraryGeneratorOptions = {},
  context: AiItineraryGeneratorContext = {},
): Promise<PlanmeDraftPreviewRequest> {
  const apiKey = options.apiKey?.trim() || readRuntimeEnv("OPENAI_API_KEY");
  const model = options.model?.trim() || readRuntimeEnv("PLANME_OPENAI_MODEL") || DEFAULT_OPENAI_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!apiKey) {
    throw new PlanmeAiConfigurationError();
  }

  const baseBody = createOpenAiItineraryRequestBody(model, input, context);
  const requiresPlaceSearchTools = Boolean(context.placeCandidateSearcher);
  let hasExecutedPlaceToolCall = false;
  let previousResponseId: string | undefined;
  let pendingInput: string | OpenAiFunctionCallOutputItem[] = baseBody.input;
  let retriedMissingToolCall = false;

  for (let attempt = 0; attempt < MAX_OPENAI_TOOL_LOOP_COUNT; attempt += 1) {
    await recordPlanmeUsageSafely(options.usageRecorder, "openai_request");

    const response = await fetchImpl(OPENAI_RESPONSES_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...baseBody,
        input: pendingInput,
        ...(requiresPlaceSearchTools && retriedMissingToolCall && !hasExecutedPlaceToolCall
          ? { tool_choice: "required" }
          : {}),
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
      }),
    });

    const payload = (await response.json()) as OpenAiResponsesApiResult;

    if (!response.ok) {
      throw new Error(payload.error?.message ?? "OpenAI itinerary generation failed.");
    }

    const toolOutputs = await executePlanmePlaceToolCalls(payload, input, context);

    if (toolOutputs.length === 0) {
      if (requiresPlaceSearchTools && !hasExecutedPlaceToolCall && !retriedMissingToolCall) {
        retriedMissingToolCall = true;
        pendingInput = createMissingToolCallRetryPrompt(input, context);
        previousResponseId = undefined;
        continue;
      }

      if (requiresPlaceSearchTools && !hasExecutedPlaceToolCall) {
        throw new Error("OpenAI itinerary generation did not request place search tools.");
      }

      return applyGeneratedTransportMode(
        normalizeGeneratedDraft(parseOpenAiDraftPayload(payload)),
        input.transportMode,
      );
    }

    hasExecutedPlaceToolCall = true;
    previousResponseId = payload.id;
    pendingInput = toolOutputs;
  }

  throw new Error("OpenAI itinerary generation did not finish after place search tool calls.");
}

/**
 * Applies the user-confirmed itinerary mode to every generated route stop.
 */
function applyGeneratedTransportMode(
  draft: PlanmeDraftPreviewRequest,
  transportMode: RecommendItineraryRequest["transportMode"],
): PlanmeDraftPreviewRequest {
  // The model may describe route details, but it cannot override the itinerary-wide mode.
  const applyToStops = <T extends { mode?: string }>(stops: T[] | undefined) =>
    stops?.map((stop) => ({ ...stop, mode: transportMode }));

  return {
    ...draft,
    transportMode,
    days: draft.days.map((day) => ({
      ...day,
      standardStops: applyToStops(day.standardStops),
      carrymeStops: applyToStops(day.carrymeStops),
      stops: applyToStops(day.stops),
    })),
  };
}

/**
 * Builds a stricter retry prompt when the model skipped required place-search tools.
 */
function createMissingToolCallRetryPrompt(
  input: RecommendItineraryRequest,
  context: AiItineraryGeneratorContext,
) {
  return [
    createItineraryGenerationPrompt(input, true, context.requiredPlaces),
    "",
    "이전 응답에는 장소 검색 함수 호출이 없었습니다.",
    "이번 응답에서는 일정 JSON을 바로 만들지 말고, 일정에 넣을 실제 장소 후보를 search_naver_places로 먼저 확인하세요.",
  ].join("\n");
}

/**
 * Builds the Responses API body shared by the initial prompt and tool-output follow-ups.
 */
function createOpenAiItineraryRequestBody(
  model: string,
  input: RecommendItineraryRequest,
  context: AiItineraryGeneratorContext,
) {
  const tools = context.placeCandidateSearcher ? createPlanmePlaceSearchTools() : undefined;

  return {
    model,
    input: createItineraryGenerationPrompt(input, Boolean(tools), context.requiredPlaces),
    ...(tools ? { tool_choice: "auto", tools } : {}),
    text: {
      format: {
        type: "json_schema",
        name: "planme_itinerary_draft",
        strict: true,
        schema: createPlanmeDraftJsonSchema(),
      },
    },
  };
}

/**
 * Builds a compact prompt for AI candidate fit judgment without exposing secrets.
 */
function createPlaceCandidateDecisionPrompt(input: OpenAiPlaceCandidateDecisionInput) {
  return [
    "너는 PlanME 일정의 장소 후보 검증자입니다.",
    "서버가 네이버 API로 찾은 후보만 보고 판단하세요.",
    "외부 후보 없이 장소 존재나 좌표를 추정하지 마세요.",
    "사용자 의도와 후보가 자연스럽게 맞으면 accepted를 반환하고 selectedCandidateId를 지정하세요.",
    "후보가 여러 의미로 해석되거나 의도 조건이 부족하면 ambiguous를 반환하세요.",
    "후보가 사용자 의도와 맞지 않으면 rejected를 반환하세요.",
    "ambiguous 또는 rejected의 questions는 최대 2개입니다.",
    input.finalAttempt
      ? "이번은 2라운드 이후 마지막 내부 판단입니다. 후보 중 사용자 의도에 가장 근접하고 좌표/출처가 있는 후보가 있으면 accepted로 확정하고, 후보가 명백히 부적합할 때만 rejected를 반환하세요."
      : "이번이 마지막 판단이 아니면, 의도가 부족할 때 최대 2개 질문으로 되물을 수 있습니다.",
    "",
    `원래 장소명: ${input.stop.name}`,
    `주소 검색어: ${input.stop.addressQuery ?? "없음"}`,
    `지역: ${input.input.destination ?? input.input.region ?? "미정"}`,
    `출발지: ${input.input.origin ?? "미정"}`,
    `선호: ${(input.input.preferences ?? []).join(", ") || "없음"}`,
    `검색어: ${input.searchedQueries.join(", ") || "없음"}`,
    `clarification round: ${input.round}`,
    `finalAttempt: ${input.finalAttempt ? "true" : "false"}`,
    "후보:",
    JSON.stringify(
      input.candidates.map((candidate) => ({
        address: candidate.address,
        candidateId: candidate.candidateId,
        coordinate: candidate.coordinate,
        category: candidate.category,
        name: candidate.name,
        placeId: candidate.placeId,
        source: candidate.source,
        sourceRef: candidate.sourceRef,
      })),
    ),
  ].join("\n");
}

/**
 * Describes the candidate decision JSON object PlanME needs before saving a stop.
 */
function createPlaceCandidateDecisionJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["status", "reason", "questions", "selectedCandidateId", "feedbackMessage"],
    properties: {
      feedbackMessage: { type: "string" },
      questions: {
        type: "array",
        maxItems: 2,
        items: { type: "string" },
      },
      reason: { type: "string" },
      selectedCandidateId: { type: "string" },
      status: { type: "string", enum: ["accepted", "ambiguous", "rejected"] },
    },
  };
}

/**
 * Extracts and parses the decision JSON from a Responses API result.
 */
function parseOpenAiDecisionPayload(
  payload: OpenAiResponsesApiResult,
): PlanmePlaceCandidateDecision {
  const outputText = extractOpenAiOutputText(payload);

  if (!outputText) {
    throw new Error("OpenAI place candidate decision returned an empty response.");
  }

  return JSON.parse(outputText) as PlanmePlaceCandidateDecision;
}

/**
 * Keeps model output within the MCP clarification contract.
 */
function normalizePlaceCandidateDecision(
  decision: PlanmePlaceCandidateDecision,
): PlanmePlaceCandidateDecision {
  return {
    feedbackMessage: decision.feedbackMessage?.trim(),
    questions: (decision.questions ?? []).map((question) => question.trim()).filter(Boolean).slice(0, 2),
    reason: decision.reason.trim() || "후보 판단 사유가 비어 있습니다.",
    selectedCandidateId: decision.selectedCandidateId?.trim(),
    status: decision.status,
  };
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
 * Builds the prompt that asks OpenAI to draft concrete POIs with PlanME tool evidence.
 */
function createItineraryGenerationPrompt(
  input: RecommendItineraryRequest,
  hasPlaceSearchTools = false,
  requiredPlaces?: PlanmeResolvedRequiredPlaces,
) {
  const durationDays = input.durationDays ?? 2;
  const preferences = input.preferences?.length ? input.preferences.join(", ") : "없음";
  const accommodationCandidates = input.accommodationCandidates ?? [];
  const accommodationInstruction =
    accommodationCandidates.length > 0
      ? "숙소가 명시되지 않았으면 아래 숙소 후보 중 하나만 호텔/숙소로 사용하고, '<지역> 숙소' 같은 일반명을 쓰지 마세요."
      : "숙소가 명시되지 않았으면 '숙소 확인 필요'처럼 미정 상태를 쓰고, 특정 호텔명을 지어내지 마세요.";

  return [
    "너는 한국 여행 일정 플래너입니다.",
    "사용자 요청을 바탕으로 PlanME 위젯에 바로 넣을 수 있는 현실적인 일정 초안을 JSON으로 작성하세요.",
    "장소는 검색 후보와 좌표 출처로 검증되며, 실제 후보 없이 장소 존재나 좌표를 추정하지 마세요.",
    "공항이 명시되지 않았으면 인천공항, 김포공항, 김해공항 같은 기본 공항을 절대 만들지 마세요.",
    "사용자가 출발지를 말했으면 첫 타임라인은 '<출발지> 출발'로 작성하세요.",
    "days 배열은 여행 기간 일수와 반드시 같아야 합니다. 예: 2박 3일 또는 여행 기간 3일이면 day 1, day 2, day 3 총 3개를 작성하세요.",
    accommodationInstruction,
    "각 day는 standardStops, carrymeStops, standardTimeline, carrymeTimeline을 모두 작성하세요.",
    "각 standardStops/carrymeStops stop은 name, caption, role, requiredPlaceKind를 모두 작성하세요.",
    "role은 반드시 출발지, 방문지, 숙소, 복귀지 중 하나입니다.",
    "requiredPlaceKind는 사용자 출발지면 origin, 사용자 목적지면 destination, 그 밖의 중간 장소면 null입니다.",
    `일정 전체 이동 수단은 ${input.transportMode}이며 모든 대표 구간에 동일하게 적용됩니다. stop별로 다른 이동 수단을 결정하지 마세요.`,
    "Standard 경로는 짐 때문에 호텔/숙소를 중간 방문하는 기본 경로입니다.",
    "CarryME 경로는 사람이 호텔/숙소 중간 방문 없이 바로 관광지 또는 최종 목적지로 이동하는 경로입니다.",
    "CarryME 타임라인에는 Standard에서 사람이 호텔/숙소에 도착하는 시간과 같은 시간의 '짐 숙소 도착' 이벤트를 넣으세요.",
    "'짐 숙소 도착'은 CarryME 타임라인 이벤트일 뿐 여행자의 행선지가 아니므로 carrymeStops에 넣지 마세요.",
    "호텔/숙소가 최종 목적지이면 CarryME 경로의 최종 목적지로 유지하세요.",
    "역/터미널/공항은 기본 수하물 보관·수령지가 아닙니다. 호텔/숙소 또는 사용자가 명시한 CarryME 수령 지점만 사용하세요.",
    "부산역 짐 보관, 부산역 짐 수령처럼 교통 거점에서 짐을 맡기거나 찾는 표현을 만들지 마세요.",
    "아이 동반, 가족 여행, 실내/야외 균형 같은 선호를 반영해 무리 없는 방문지 2-4개를 고르세요.",
    "각 stops 항목에는 실제 장소명(name)과 네이버 지오코딩에 넣을 한국어 주소형 검색어(addressQuery)를 반드시 함께 작성하세요.",
    "addressQuery에는 위도/경도를 쓰지 말고, 가능한 도로명/지번/행정구역을 포함한 한국어 검색어를 쓰세요.",
    "정확한 주소를 모르면 '<광역/시군구> <장소명>' 형태로 작성하고 좌표는 절대 추측하지 마세요.",
    hasPlaceSearchTools
      ? "일정에 넣을 실제 장소는 search_naver_places 함수로 후보를 확인한 뒤, 후보에 있는 실제 장소명을 사용하세요."
      : "",
    "",
    `목적지: ${input.destination ?? input.region ?? "미정"}`,
    `출발지: ${input.origin ?? "미정"}`,
    `여행 기간: ${durationDays}일`,
    `숙소: ${input.hotelName ?? "미정"}`,
    `인원: ${input.travelerCount ?? 1}명`,
    `짐 개수: ${input.luggageCount ?? 1}개`,
    `선호: ${preferences}`,
    requiredPlaces
      ? `고정 출발지: ${requiredPlaces.origin.name} | ${requiredPlaces.origin.address ?? "주소 없음"} | ${requiredPlaces.origin.coordinate.lat}, ${requiredPlaces.origin.coordinate.lng}`
      : "고정 출발지: 미확인",
    requiredPlaces
      ? `고정 사용자 목적지: ${requiredPlaces.destination.name} | ${requiredPlaces.destination.address ?? "주소 없음"} | ${requiredPlaces.destination.coordinate.lat}, ${requiredPlaces.destination.coordinate.lng}`
      : "고정 사용자 목적지: 미확인",
    createAccommodationCandidatePromptSection(accommodationCandidates),
  ].join("\n");
}

/**
 * Defines the app-side place search functions available to OpenAI.
 */
function createPlanmePlaceSearchTools() {
  return [
    {
      type: "function",
      name: "search_naver_places",
      description: "Search verified Korean Naver place candidates with coordinates.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["maxCandidates", "query", "region", "userIntent"],
        properties: {
          maxCandidates: { type: ["integer", "null"], minimum: 1, maximum: 5 },
          query: { type: "string" },
          region: { type: ["string", "null"] },
          userIntent: { type: ["string", "null"] },
        },
      },
      strict: true,
    },
  ];
}

/**
 * Executes all OpenAI-requested PlanME place search calls and serializes their outputs.
 */
async function executePlanmePlaceToolCalls(
  payload: OpenAiResponsesApiResult,
  input: RecommendItineraryRequest,
  context: AiItineraryGeneratorContext,
): Promise<OpenAiFunctionCallOutputItem[]> {
  if (!context.placeCandidateSearcher) {
    return [];
  }

  const functionCalls = (payload.output ?? []).filter(
    (item) => item.type === "function_call" && item.call_id && item.name,
  );
  const outputs: OpenAiFunctionCallOutputItem[] = [];

  for (const functionCall of functionCalls) {
    const result = await executePlanmePlaceToolCall(functionCall, input, context);

    outputs.push({
      call_id: functionCall.call_id ?? "",
      output: JSON.stringify(result),
      type: "function_call_output",
    });
  }

  return outputs;
}

/**
 * Routes one model function call into the configured PlanME place candidate searcher.
 */
async function executePlanmePlaceToolCall(
  functionCall: NonNullable<OpenAiResponsesApiResult["output"]>[number],
  input: RecommendItineraryRequest,
  context: AiItineraryGeneratorContext,
) {
  const args = parsePlanmePlaceSearchArgs(functionCall.arguments ?? "{}");
  const query = args.query || args.userIntent || input.destination || input.region || "장소 후보";

  await recordPlanmeUsageSafely(context.usageRecorder, "function_place_search_call");

  const result = await context.placeCandidateSearcher?.({
    destination: input.destination,
    maxCandidates: args.maxCandidates ?? undefined,
    preferences: args.userIntent ? [args.userIntent] : input.preferences,
    query,
    region: args.region || input.region,
    stop: {
      addressQuery: query,
      name: query,
      role: "visit",
    },
  });

  return {
    candidates: (result?.candidates ?? []).slice(0, args.maxCandidates ?? 5),
    searchedQueries: result?.searchedQueries ?? [],
    toolName: functionCall.name,
  };
}

type PlanmePlaceSearchToolArgs = {
  maxCandidates?: number | null;
  query?: string | null;
  region?: string | null;
  userIntent?: string | null;
};

/**
 * Parses model-authored function arguments defensively without letting bad JSON crash generation.
 */
function parsePlanmePlaceSearchArgs(rawArguments: string): PlanmePlaceSearchToolArgs {
  try {
    const parsed = JSON.parse(rawArguments) as PlanmePlaceSearchToolArgs;

    return {
      maxCandidates: normalizeToolCandidateLimit(parsed.maxCandidates),
      query: parsed.query?.trim(),
      region: parsed.region?.trim(),
      userIntent: parsed.userIntent?.trim(),
    };
  } catch {
    return {};
  }
}

/**
 * Keeps model-requested candidate count within the product token/cost cap.
 */
function normalizeToolCandidateLimit(limit: number | null | undefined) {
  if (typeof limit !== "number") {
    return 5;
  }

  return Math.max(1, Math.min(5, Math.trunc(limit)));
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
    "아래 숙소 후보 중 하나를 호텔/숙소로 사용하세요.",
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
        maxItems: MAX_GENERATED_ITINERARY_DAYS,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "day",
            "label",
            "standardStops",
            "carrymeStops",
            "standardTimeline",
            "carrymeTimeline",
            "standardDurationMinutes",
            "carrymeDurationMinutes",
            "standardRouteText",
            "carrymeRouteText",
          ],
          properties: {
            day: { type: "integer", minimum: 1, maximum: 14 },
            label: { type: "string" },
            standardStops: createRouteStopsSchema(),
            carrymeStops: createRouteStopsSchema(),
            standardTimeline: createTimelineSchema(),
            carrymeTimeline: createTimelineSchema(),
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
 * Describes one generated route's concrete stop list with role and mode semantics.
 */
function createRouteStopsSchema() {
  return {
    type: "array",
    minItems: 2,
    maxItems: 8,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["name", "caption", "role", "requiredPlaceKind", "addressQuery"],
      properties: {
        name: { type: "string" },
        caption: { type: "string" },
        role: {
          type: "string",
          enum: ["출발지", "방문지", "숙소", "복귀지"],
        },
        requiredPlaceKind: {
          type: ["string", "null"],
          enum: ["origin", "destination", null],
        },
        addressQuery: { type: "string" },
      },
    },
  };
}

/**
 * Describes route-specific timeline rows authored by AI.
 */
function createTimelineSchema() {
  return {
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
  };
}

/**
 * Extracts the JSON string from a Responses API result.
 */
function parseOpenAiDraftPayload(payload: OpenAiResponsesApiResult): PlanmeDraftPreviewRequest {
  const outputText = extractOpenAiOutputText(payload);

  if (!outputText) {
    throw new Error("OpenAI itinerary generation returned an empty response.");
  }

  return JSON.parse(outputText) as PlanmeDraftPreviewRequest;
}

/**
 * Reads text output from either Responses API convenience output_text or content items.
 */
function extractOpenAiOutputText(payload: OpenAiResponsesApiResult) {
  return (
    payload.output_text ??
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text ?? "")
      .find((text) => text.trim().length > 0)
  );
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
      standardStops: normalizeGeneratedStops(day.standardStops),
      carrymeStops: normalizeGeneratedStops(day.carrymeStops),
      stops: normalizeGeneratedStops(day.stops),
      standardTimeline: normalizeGeneratedTimeline(day.standardTimeline),
      carrymeTimeline: normalizeGeneratedTimeline(day.carrymeTimeline),
      timeline: normalizeGeneratedTimeline(day.timeline),
    })),
  };
}

/**
 * Trims AI-authored stops while preserving optional legacy payloads.
 */
function normalizeGeneratedStops<
  T extends {
    addressQuery?: string;
    caption?: string;
    mode?: string;
    name: string;
    placeId?: string;
    placeSourceRef?: string;
  },
>(
  stops: T[] | undefined,
) {
  return stops?.map((stop) => ({
    ...stop,
    name: stop.name.trim(),
    addressQuery: stop.addressQuery?.trim() || undefined,
    caption: stop.caption?.trim(),
    mode: stop.mode?.trim(),
    placeId: stop.placeId?.trim(),
    placeSourceRef: stop.placeSourceRef?.trim(),
  }));
}

/**
 * Trims AI-authored timeline text while preserving optional legacy payloads.
 */
function normalizeGeneratedTimeline(events: PlanmeDraftPreviewRequest["days"][number]["timeline"]) {
  return events?.map((event) => ({
    ...event,
    title: event.title.trim(),
    description: event.description.trim(),
    savingLabel: event.savingLabel?.trim() || undefined,
  }));
}
