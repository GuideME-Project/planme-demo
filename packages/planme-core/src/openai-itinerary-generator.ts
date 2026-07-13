import type {
  PlanmeDraftPreviewRequest,
  PlanmeDraftRouteStop,
  PlanmeDraftTimelineEvent,
} from "./draft-itineraries.js";
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

export type OpenAiItineraryGeneratorOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  model?: string;
  retryDelayMs?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  usageRecorder?: PlanmeUsageRecorder;
};

export type PlanmeOpenAiErrorCode =
  | "OPENAI_INVALID_RESPONSE"
  | "OPENAI_PLACE_TOOL_REQUIRED"
  | "OPENAI_PROVIDER_ERROR"
  | "OPENAI_RATE_LIMITED"
  | "OPENAI_REQUEST_FAILED"
  | "OPENAI_REQUEST_REJECTED"
  | "OPENAI_REQUEST_TIMEOUT"
  | "OPENAI_TOOL_LOOP_EXCEEDED";

export type PlanmeOpenAiErrorStage =
  | "output_parsing"
  | "provider_response"
  | "request"
  | "tool_execution";

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

type OpenAiFunctionCallItem = NonNullable<OpenAiResponsesApiResult["output"]>[number];

type PreparedPlaceToolCall = {
  args: PlanmePlaceSearchToolArgs;
  functionCall: OpenAiFunctionCallItem;
  searchKey: string;
};

type PlanmePlaceToolSearchResult = {
  candidates: Awaited<ReturnType<PlanmePlaceCandidateSearcher>>["candidates"];
  searchedQueries: string[];
};

type OpenAiPlaceCandidateDecisionInput = Parameters<PlanmePlaceCandidateDecider>[0];

type OpenAiCompactVisit = {
  addressQuery: string;
  caption: string;
  name: string;
  requiredPlaceKind: "destination" | "must_visit" | null;
  stayDurationMinutes: number;
};

type OpenAiCompactItineraryDraft = {
  days: Array<{
    visits: OpenAiCompactVisit[];
  }>;
  summary: string;
  title: string;
};

const OPENAI_RESPONSES_API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";
const DEFAULT_OPENAI_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_OPENAI_RETRY_DELAY_MS = 150;
const MAX_OPENAI_RETRY_DELAY_MS = 1_000;
const MAX_OPENAI_REQUEST_ATTEMPTS = 2;
const MAX_PLACE_TOOL_CONCURRENCY = 3;
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
 * Preserves a stable failure contract across OpenAI transport, response, and tool-loop failures.
 */
export class PlanmeOpenAiError extends Error {
  readonly code: PlanmeOpenAiErrorCode;
  readonly retryable: boolean;
  readonly stage: PlanmeOpenAiErrorStage;
  readonly status?: number;

  constructor(
    code: PlanmeOpenAiErrorCode,
    stage: PlanmeOpenAiErrorStage,
    retryable: boolean,
    message: string,
    status?: number,
  ) {
    super(message);
    this.code = code;
    this.name = "PlanmeOpenAiError";
    this.retryable = retryable;
    this.stage = stage;
    this.status = status;
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
 * Calls the Responses API within one caller-owned deadline and retries only transient failures.
 */
async function requestOpenAiResponse(
  body: object,
  apiKey: string,
  options: OpenAiItineraryGeneratorOptions,
  deadline: number,
): Promise<OpenAiResponsesApiResult> {
  const fetchImpl = options.fetchImpl ?? fetch;

  for (let attempt = 0; attempt < MAX_OPENAI_REQUEST_ATTEMPTS; attempt += 1) {
    if (options.signal?.aborted) {
      throw createOpenAiTimeoutError();
    }

    await recordPlanmeUsageSafely(options.usageRecorder, "openai_request");

    const remainingMs = deadline - Date.now();

    if (remainingMs <= 0) {
      throw createOpenAiTimeoutError();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remainingMs);
    const abortFromParent = () => controller.abort(options.signal?.reason);

    if (options.signal?.aborted) {
      abortFromParent();
    } else {
      options.signal?.addEventListener("abort", abortFromParent, { once: true });
    }

    try {
      const response = await fetchImpl(OPENAI_RESPONSES_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await readOpenAiResponsePayload(response);

      if (response.ok) {
        return payload;
      }

      const responseError = createOpenAiResponseError(response.status, payload.error?.message);

      if (
        attempt + 1 < MAX_OPENAI_REQUEST_ATTEMPTS &&
        responseError.retryable &&
        await waitForOpenAiRetry(response, options, deadline)
      ) {
        continue;
      }

      throw responseError;
    } catch (error) {
      if (error instanceof PlanmeOpenAiError) {
        throw error;
      }

      const requestError = controller.signal.aborted
        ? createOpenAiTimeoutError()
        : new PlanmeOpenAiError(
            "OPENAI_REQUEST_FAILED",
            "request",
            true,
            "OpenAI request failed.",
          );

      if (
        attempt + 1 < MAX_OPENAI_REQUEST_ATTEMPTS &&
        requestError.retryable &&
        !controller.signal.aborted &&
        !options.signal?.aborted &&
        await waitForOpenAiRetry(undefined, options, deadline)
      ) {
        continue;
      }

      throw requestError;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortFromParent);
    }
  }

  throw new PlanmeOpenAiError(
    "OPENAI_REQUEST_FAILED",
    "request",
    true,
    "OpenAI request failed.",
  );
}

/** Preserves retryable status handling even when an error response body is not JSON. */
async function readOpenAiResponsePayload(response: Response): Promise<OpenAiResponsesApiResult> {
  try {
    return (await response.json()) as OpenAiResponsesApiResult;
  } catch {
    if (!response.ok) {
      return {};
    }

    throw new PlanmeOpenAiError(
      "OPENAI_INVALID_RESPONSE",
      "provider_response",
      false,
      "OpenAI returned an invalid JSON response.",
      response.status,
    );
  }
}

/** Maps provider status families into a stable retry contract. */
function createOpenAiResponseError(status: number, providerMessage?: string) {
  if (status === 408) {
    return new PlanmeOpenAiError(
      "OPENAI_REQUEST_TIMEOUT",
      "provider_response",
      true,
      providerMessage ?? "OpenAI request timed out.",
      status,
    );
  }

  if (status === 429) {
    return new PlanmeOpenAiError(
      "OPENAI_RATE_LIMITED",
      "provider_response",
      true,
      providerMessage ?? "OpenAI request was rate limited.",
      status,
    );
  }

  if (status >= 500) {
    return new PlanmeOpenAiError(
      "OPENAI_PROVIDER_ERROR",
      "provider_response",
      true,
      providerMessage ?? "OpenAI provider request failed.",
      status,
    );
  }

  return new PlanmeOpenAiError(
    "OPENAI_REQUEST_REJECTED",
    "provider_response",
    false,
    providerMessage ?? "OpenAI rejected the request.",
    status,
  );
}

/** Creates the stable timeout used for both elapsed deadlines and aborted fetches. */
function createOpenAiTimeoutError() {
  return new PlanmeOpenAiError(
    "OPENAI_REQUEST_TIMEOUT",
    "request",
    true,
    "OpenAI request timed out.",
  );
}

/** Waits only when a second attempt can start before the shared deadline. */
async function waitForOpenAiRetry(
  response: Response | undefined,
  options: OpenAiItineraryGeneratorOptions,
  deadline: number,
) {
  const delayMs = getOpenAiRetryDelayMs(response, options.retryDelayMs);

  if (deadline - Date.now() <= delayMs) {
    return false;
  }

  if (options.signal?.aborted) {
    return false;
  }

  if (delayMs > 0) {
    await waitForOpenAiRetryDelay(delayMs, options.signal);
  }

  return deadline > Date.now() && !options.signal?.aborted;
}

async function waitForOpenAiRetryDelay(delayMs: number, signal?: AbortSignal) {
  await new Promise<void>((resolve) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (timeout) {
        clearTimeout(timeout);
      }

      signal?.removeEventListener("abort", finish);
      resolve();
    };

    timeout = setTimeout(finish, delayMs);

    if (signal?.aborted) {
      finish();
    } else {
      signal?.addEventListener("abort", finish, { once: true });
    }
  });
}

/** Honors a short Retry-After value while bounding provider-controlled delay. */
function getOpenAiRetryDelayMs(response: Response | undefined, configuredDelayMs?: number) {
  const retryAfter = response?.headers.get("retry-after")?.trim();
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : Number.NaN;
  const retryAfterDateMs = retryAfter && !Number.isFinite(retryAfterSeconds)
    ? Date.parse(retryAfter) - Date.now()
    : Number.NaN;
  const requestedDelayMs = Number.isFinite(retryAfterSeconds)
    ? retryAfterSeconds * 1_000
    : Number.isFinite(retryAfterDateMs)
      ? retryAfterDateMs
      : configuredDelayMs ?? DEFAULT_OPENAI_RETRY_DELAY_MS;

  return Math.max(0, Math.min(MAX_OPENAI_RETRY_DELAY_MS, Math.trunc(requestedDelayMs)));
}

/** Creates one total deadline shared by every Responses API call in an operation. */
function createOpenAiDeadline(timeoutMs?: number) {
  const normalizedTimeoutMs = typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
    ? Math.max(1, Math.trunc(timeoutMs))
    : DEFAULT_OPENAI_REQUEST_TIMEOUT_MS;

  return Date.now() + normalizedTimeoutMs;
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

    if (!apiKey) {
      throw new PlanmeAiConfigurationError();
    }

    const payload = await requestOpenAiResponse(
      {
        model,
        input: [
          "한국 국내 여행 일정의 실제 대체 장소 검색어 하나를 작성하세요.",
          "원래 장소와 같은 지역, 일정 주제, 장소 종류를 최대한 유지하세요.",
          "장소나 좌표를 지어내지 말고 네이버 지역 검색에 넣을 짧은 한국어 검색어만 반환하세요.",
          `대체 시도: ${attempt}/3`,
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
      },
      apiKey,
      options,
      createOpenAiDeadline(options.timeoutMs),
    );

    const outputText = extractOpenAiOutputText(payload);

    if (!outputText) {
      return null;
    }

    const parsed = parseOpenAiJsonOutput<{ query?: string }>(outputText);

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

  if (!apiKey) {
    throw new PlanmeAiConfigurationError();
  }

  const payload = await requestOpenAiResponse(
    {
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
    },
    apiKey,
    options,
    createOpenAiDeadline(options.timeoutMs),
  );

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

  if (!apiKey) {
    throw new PlanmeAiConfigurationError();
  }

  const deadline = createOpenAiDeadline(options.timeoutMs);
  const requiresPlaceSearchTools = Boolean(context.placeCandidateSearcher);
  const usesCompactOutput = !requiresPlaceSearchTools;
  const baseBody = createOpenAiItineraryRequestBody(model, input, context, usesCompactOutput);
  let hasExecutedPlaceToolCall = false;
  let previousResponseId: string | undefined;
  let pendingInput: string | OpenAiFunctionCallOutputItem[] = baseBody.input;

  for (let attempt = 0; attempt < MAX_OPENAI_TOOL_LOOP_COUNT; attempt += 1) {
    const payload = await requestOpenAiResponse(
      {
        ...baseBody,
        input: pendingInput,
        ...(requiresPlaceSearchTools
          ? { tool_choice: hasExecutedPlaceToolCall ? "auto" : "required" }
          : {}),
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
      },
      apiKey,
      options,
      deadline,
    );

    const toolOutputs = await executePlanmePlaceToolCalls(payload, input, context);

    if (toolOutputs.length === 0) {
      if (requiresPlaceSearchTools && !hasExecutedPlaceToolCall) {
        throw new PlanmeOpenAiError(
          "OPENAI_PLACE_TOOL_REQUIRED",
          "tool_execution",
          false,
          "OpenAI itinerary generation did not request required place search tools.",
        );
      }

      const generatedDraft = usesCompactOutput
        ? parseAndExpandCompactDraftPayload(payload, input, context)
        : normalizeGeneratedDraft(parseOpenAiDraftPayload(payload));

      return applyGeneratedTransportMode(generatedDraft, input.transportMode);
    }

    if (!payload.id) {
      throw new PlanmeOpenAiError(
        "OPENAI_INVALID_RESPONSE",
        "tool_execution",
        false,
        "OpenAI place tool response did not include a response id.",
      );
    }

    hasExecutedPlaceToolCall = true;
    previousResponseId = payload.id;
    pendingInput = toolOutputs;
  }

  throw new PlanmeOpenAiError(
    "OPENAI_TOOL_LOOP_EXCEEDED",
    "tool_execution",
    false,
    "OpenAI itinerary generation did not finish after place search tool calls.",
  );
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
 * Builds the Responses API body shared by the initial prompt and tool-output follow-ups.
 */
function createOpenAiItineraryRequestBody(
  model: string,
  input: RecommendItineraryRequest,
  context: AiItineraryGeneratorContext,
  usesCompactOutput: boolean,
) {
  const tools = context.placeCandidateSearcher ? createPlanmePlaceSearchTools() : undefined;

  return {
    model,
    ...createOpenAiReasoningConfig(model),
    input: usesCompactOutput
      ? createCompactItineraryGenerationPrompt(input, context.requiredPlaces)
      : createItineraryGenerationPrompt(input, Boolean(tools), context.requiredPlaces),
    ...(tools ? { tools } : {}),
    text: {
      format: {
        type: "json_schema",
        name: usesCompactOutput ? "planme_compact_itinerary_draft" : "planme_itinerary_draft",
        strict: true,
        schema: usesCompactOutput
          ? createPlanmeCompactDraftJsonSchema(
              input.durationDays ?? 2,
              input.transportMode,
            )
          : createPlanmeDraftJsonSchema(),
      },
    },
  };
}

/** Uses the lowest supported reasoning effort for the production GPT-5.4/5.6 families. */
function createOpenAiReasoningConfig(model: string) {
  return /^gpt-5\.(?:4|6)(?:-|$)/.test(model)
    ? { reasoning: { effort: "none" as const } }
    : {};
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
    throw new PlanmeOpenAiError(
      "OPENAI_INVALID_RESPONSE",
      "output_parsing",
      false,
      "OpenAI place candidate decision returned an empty response.",
    );
  }

  return parseOpenAiJsonOutput<PlanmePlaceCandidateDecision>(outputText);
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
 * Asks the model only for editorial choices; routing, lodging boundaries, and luggage are server-owned.
 */
function createCompactItineraryGenerationPrompt(
  input: RecommendItineraryRequest,
  requiredPlaces?: PlanmeResolvedRequiredPlaces,
) {
  const durationDays = input.durationDays ?? 2;
  const requiredDestinations = requiredPlaces?.destinations ?? [];
  const maximumVisitsPerDay = input.transportMode === "transit" ? 2 : 3;

  return [
    "한국 여행의 날짜별 방문지만 추천하세요.",
    `days는 정확히 ${durationDays}개이고 배열 순서가 1일차부터 마지막 날입니다.`,
    `각 day의 visits는 실제 운영 중인 관광지·식당·체험 장소 1~${maximumVisitsPerDay}개만 넣으세요.`,
    "숙소, 출발지, 복귀지, 짐 배송, 이동 경로와 시각은 서버가 추가하므로 visits에 넣지 마세요.",
    "name은 실제 고유 장소명, addressQuery는 네이버 검색 가능한 '<지역> <장소명>' 형식으로 작성하세요.",
    "사용자가 지정한 필수 장소는 누락하지 말고 requiredPlaceKind를 destination 또는 must_visit으로 표시하세요.",
    "그 밖의 AI 추천 장소는 requiredPlaceKind를 null로 두세요.",
    "stayDurationMinutes는 현실적인 체류 분 단위이며 30~180 사이입니다.",
    `목적지: ${input.destination ?? input.region ?? "미정"}`,
    `출발지: ${input.origin ?? "미정"}`,
    `기간: ${durationDays}일`,
    `선호: ${(input.preferences ?? []).join(", ") || "없음"}`,
    requiredDestinations.length > 0
      ? `서버 확정 필수 장소: ${requiredDestinations
          .map((place) => `${place.name}(${place.kind})`)
          .join(", ")}`
      : "서버 확정 필수 장소: 없음",
  ].join("\n");
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
    "requiredPlaceKind는 사용자 출발지면 origin, destinationType=place인 목적지면 destination, mustVisitPlaces의 장소면 must_visit, 그 밖의 중간 장소면 null입니다.",
    `일정 전체 이동 수단은 ${input.transportMode}이며 모든 대표 구간에 동일하게 적용됩니다. stop별로 다른 이동 수단을 결정하지 마세요.`,
    "같은 day의 Standard와 CarryME는 반드시 같은 실제 장소에서 시작하고 같은 실제 장소에서 끝내세요.",
    "마지막 날이 아닌 모든 day는 두 경로 모두 같은 실제 숙소에서 끝내고, 다음 day는 그 숙소에서 시작하세요.",
    "여행 마지막 day는 두 경로 모두 최초 출발지로 복귀해 끝내고, 호텔/숙소 복귀나 추가 숙박을 넣지 마세요.",
    "Standard 경로는 짐을 놓기 위해 호텔/숙소를 중간 방문하여 체크인하는 경로입니다.",
    "Standard의 첫 호텔/숙소 중간 방문은 '<호텔명> 체크인'으로 작성하고 통상적인 오후 시간대에 배치하세요.",
    "여행 마지막 날이 아니면 Standard에서 관광 후 같은 호텔/숙소로 돌아갈 때 '<호텔명> 복귀' 또는 숙박 의미로 작성하세요.",
    "여행 마지막 날에는 Standard와 CarryME 모두 관광 후 호텔/숙소 복귀·숙박 이벤트를 만들지 말고 최종 복귀지에서 일정을 끝내세요. 단, 사용자가 지정한 최종 목적지 자체가 호텔/숙소이면 유지하세요.",
    "Standard 타임라인에는 '짐 숙소 도착'이나 CarryME 배송 이벤트를 작성하지 말고 category에 carryme를 사용하지 마세요.",
    "CarryME 경로는 사람이 호텔/숙소 중간 방문 없이 바로 관광지 또는 최종 목적지로 이동하는 경로입니다.",
    "마지막 날이 아닌 CarryME 타임라인에는 Standard에서 사람이 그날 숙소에 도착하는 시각과 같은 시각의 '짐 <실제 숙소명> 도착' 이벤트를 하나 넣고 category는 반드시 carryme로 작성하세요.",
    "여행 마지막 날 CarryME 타임라인에는 최초 출발지 복귀 시각과 같은 시각의 '짐 <최초 출발지명> 도착' 이벤트를 하나 넣고, 사용자가 출발지를 집이라고 하지 않았다면 집이라고 바꾸지 마세요.",
    "짐 도착 이벤트는 출발/배송 접수 뒤에 배치하고 CarryME 여행자의 같은 목적지 도착보다 늦게 배치하지 마세요.",
    "짐 도착은 CarryME 타임라인 이벤트일 뿐 여행자의 행선지가 아니므로 carrymeStops에 넣지 마세요.",
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
      ? `고정 사용자 방문지: ${requiredPlaces.destinations.length > 0
        ? requiredPlaces.destinations
            .map(
              (place) =>
                `${place.name} | ${place.address ?? "주소 없음"} | ${place.coordinate.lat}, ${place.coordinate.lng} | ${place.kind}`,
            )
            .join(" / ")
        : "없음"}`
      : "고정 사용자 방문지: 미확인",
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
 * Executes unique searches with bounded concurrency and restores the model's call order.
 */
async function executePlanmePlaceToolCalls(
  payload: OpenAiResponsesApiResult,
  input: RecommendItineraryRequest,
  context: AiItineraryGeneratorContext,
): Promise<OpenAiFunctionCallOutputItem[]> {
  const searcher = context.placeCandidateSearcher;

  if (!searcher) {
    return [];
  }

  const functionCalls = (payload.output ?? []).filter(
    (item) => item.type === "function_call" && item.call_id && item.name,
  );
  const preparedCalls = functionCalls.map((functionCall) =>
    preparePlaceToolCall(functionCall, input),
  );
  const uniqueCalls = preparedCalls.filter(
    (preparedCall, index, calls) =>
      calls.findIndex((candidate) => candidate.searchKey === preparedCall.searchKey) === index,
  );
  const resultsBySearchKey = new Map<string, PlanmePlaceToolSearchResult>();
  let nextIndex = 0;
  const workerCount = Math.min(MAX_PLACE_TOOL_CONCURRENCY, uniqueCalls.length);

  const runWorker = async () => {
    while (nextIndex < uniqueCalls.length) {
      const preparedCall = uniqueCalls[nextIndex];
      nextIndex += 1;

      if (!preparedCall) {
        return;
      }

      const result = await executePlanmePlaceToolSearch(
        preparedCall.args,
        input,
        searcher,
        context.usageRecorder,
      );
      resultsBySearchKey.set(preparedCall.searchKey, result);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return preparedCalls.map(({ functionCall, searchKey }) => {
    const result = resultsBySearchKey.get(searchKey) ?? {
      candidates: [],
      searchedQueries: [],
    };

    return {
      call_id: functionCall.call_id ?? "",
      output: JSON.stringify({ ...result, toolName: functionCall.name }),
      type: "function_call_output",
    };
  });
}

/**
 * Normalizes one model-authored search so equivalent calls share one provider request.
 */
function preparePlaceToolCall(
  functionCall: OpenAiFunctionCallItem,
  input: RecommendItineraryRequest,
): PreparedPlaceToolCall {
  const args = parsePlanmePlaceSearchArgs(functionCall.arguments ?? "{}");
  const query = args.query || args.userIntent || input.destination || input.region || "장소 후보";
  const preferences = args.userIntent ? [args.userIntent] : input.preferences ?? [];
  const searchKey = [
    normalizePlaceToolSearchKeyPart(query),
    normalizePlaceToolSearchKeyPart(args.region || input.region || ""),
    normalizePlaceToolSearchKeyPart(input.destination || ""),
    preferences.map(normalizePlaceToolSearchKeyPart).join("|"),
    String(args.maxCandidates ?? 5),
  ].join("::");

  return { args: { ...args, query }, functionCall, searchKey };
}

/** Routes one unique normalized search into the configured place provider. */
async function executePlanmePlaceToolSearch(
  args: PlanmePlaceSearchToolArgs,
  input: RecommendItineraryRequest,
  searcher: PlanmePlaceCandidateSearcher,
  usageRecorder?: PlanmeUsageRecorder,
): Promise<PlanmePlaceToolSearchResult> {
  const query = args.query || args.userIntent || input.destination || input.region || "장소 후보";

  await recordPlanmeUsageSafely(usageRecorder, "function_place_search_call");

  const result = await searcher({
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
    candidates: result.candidates.slice(0, args.maxCandidates ?? 5),
    searchedQueries: result.searchedQueries,
  };
}

/** Makes whitespace, case, and Unicode-equivalent search text share one key. */
function normalizePlaceToolSearchKeyPart(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
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

/** Keeps model output small by limiting it to day-level editorial visit choices. */
function createPlanmeCompactDraftJsonSchema(
  durationDays: number,
  transportMode: RecommendItineraryRequest["transportMode"],
) {
  const exactDayCount = Math.max(1, Math.min(MAX_GENERATED_ITINERARY_DAYS, durationDays));
  const maximumVisitsPerDay = transportMode === "transit" ? 2 : 3;

  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "summary", "days"],
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      days: {
        type: "array",
        minItems: exactDayCount,
        maxItems: exactDayCount,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["visits"],
          properties: {
            visits: {
              type: "array",
              minItems: 1,
              maxItems: maximumVisitsPerDay,
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "name",
                  "caption",
                  "addressQuery",
                  "requiredPlaceKind",
                  "stayDurationMinutes",
                ],
                properties: {
                  name: { type: "string" },
                  caption: { type: "string" },
                  addressQuery: { type: "string" },
                  requiredPlaceKind: {
                    type: ["string", "null"],
                    enum: ["destination", "must_visit", null],
                  },
                  stayDurationMinutes: {
                    type: "integer",
                    minimum: 30,
                    maximum: 180,
                  },
                },
              },
            },
          },
        },
      },
    },
  };
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
          enum: ["origin", "destination", "must_visit", null],
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
      required: [
        "time",
        "title",
        "description",
        "category",
        "highlight",
        "savingLabel",
        "stopIndex",
        "stayDurationMinutes",
      ],
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
        stopIndex: { type: ["integer", "null"], minimum: 0 },
        stayDurationMinutes: { type: "integer", minimum: 0 },
      },
    },
  };
}

/** Parses the compact outline and expands server-owned route boundaries deterministically. */
function parseAndExpandCompactDraftPayload(
  payload: OpenAiResponsesApiResult,
  input: RecommendItineraryRequest,
  context: AiItineraryGeneratorContext,
): PlanmeDraftPreviewRequest {
  const outputText = extractOpenAiOutputText(payload);

  if (!outputText) {
    throw new PlanmeOpenAiError(
      "OPENAI_INVALID_RESPONSE",
      "output_parsing",
      false,
      "OpenAI itinerary generation returned an empty response.",
    );
  }

  const parsed = parseOpenAiJsonOutput<OpenAiCompactItineraryDraft | PlanmeDraftPreviewRequest>(
    outputText,
  );

  // Preserve compatibility with injected generators and older mocked Responses fixtures.
  if (isExpandedDraftPayload(parsed)) {
    return normalizeGeneratedDraft(parsed);
  }

  return expandCompactDraft(parsed, input, context);
}

/** Detects the previous full draft shape without trusting an arbitrary payload blindly. */
function isExpandedDraftPayload(
  draft: OpenAiCompactItineraryDraft | PlanmeDraftPreviewRequest,
): draft is PlanmeDraftPreviewRequest {
  const firstDay = draft.days?.[0] as
    | PlanmeDraftPreviewRequest["days"][number]
    | { visits?: OpenAiCompactVisit[] }
    | undefined;

  return Boolean(
    firstDay &&
      ("standardStops" in firstDay || "carrymeStops" in firstDay || "stops" in firstDay),
  );
}

/**
 * Turns one compact visit outline into the canonical route that the domain normalizer expands.
 */
function expandCompactDraft(
  outline: OpenAiCompactItineraryDraft,
  input: RecommendItineraryRequest,
  context: AiItineraryGeneratorContext,
): PlanmeDraftPreviewRequest {
  const durationDays = input.durationDays ?? outline.days.length;
  const origin = createCompactOriginStop(input, context.requiredPlaces);
  const lodging = createCompactLodgingStop(input);
  const days = outline.days.map((day, dayIndex) => {
    const isFinalDay = dayIndex === durationDays - 1;
    const start = dayIndex === 0
      ? origin
      : { ...lodging, caption: "숙소 출발", role: "숙소" as const };
    const end = isFinalDay
      ? { ...origin, caption: "여행 종료", role: "복귀지" as const }
      : { ...lodging, caption: "숙박", role: "숙소" as const };
    const visits = day.visits.map(createCompactVisitStop);
    const canonicalStops = [start, ...visits, end];
    const canonicalTimeline = createCompactCanonicalTimeline(
      canonicalStops,
      day.visits,
      dayIndex === 0 ? 8 * 60 : 9 * 60,
    );
    const durationMinutes = Math.max(
      0,
      (canonicalStops.length - 1) * 15 +
        day.visits.reduce((total, visit) => total + visit.stayDurationMinutes, 0),
    );

    return {
      day: dayIndex + 1,
      label: `Day ${dayIndex + 1}`,
      standardStops: canonicalStops.map((stop) => ({ ...stop })),
      carrymeStops: canonicalStops.map((stop) => ({ ...stop })),
      stops: canonicalStops.map((stop) => ({ ...stop })),
      standardTimeline: canonicalTimeline.map((event) => ({ ...event })),
      carrymeTimeline: canonicalTimeline.map((event) => ({ ...event })),
      timeline: canonicalTimeline.map((event) => ({ ...event })),
      standardDurationMinutes: durationMinutes,
      carrymeDurationMinutes: durationMinutes,
      standardRouteText: canonicalStops.map((stop) => stop.name).join(" → "),
      carrymeRouteText: canonicalStops.map((stop) => stop.name).join(" → "),
    };
  });

  return normalizeGeneratedDraft({
    assumptions: [],
    days,
    duration: `${durationDays}일`,
    origin: origin.name,
    region: input.destination ?? input.region,
    savedMinutes: 0,
    summary: outline.summary,
    title: outline.title,
    transportMode: input.transportMode,
  });
}

/** Uses only server-resolved origin evidence when it is available. */
function createCompactOriginStop(
  input: RecommendItineraryRequest,
  requiredPlaces?: PlanmeResolvedRequiredPlaces,
): PlanmeDraftRouteStop {
  const origin = requiredPlaces?.origin;

  return {
    addressQuery: origin?.address ?? origin?.inputText ?? input.origin,
    caption: "여행 출발",
    coordinate: origin?.coordinate,
    mode: input.transportMode,
    name: origin?.name ?? input.origin?.trim() ?? "출발지 확인 필요",
    placeSource: origin?.source,
    placeSourceRef: origin?.sourceRef,
    requiredPlaceKind: "origin",
    role: "출발지",
  };
}

/** Selects a concrete pre-searched lodging label; the caller applies its provider evidence next. */
function createCompactLodgingStop(input: RecommendItineraryRequest): PlanmeDraftRouteStop {
  const candidate = input.accommodationCandidates?.[0];
  const destination = input.destination ?? input.region ?? "여행지";

  return {
    addressQuery: candidate?.address ?? input.hotelName ?? `${destination} 숙소`,
    caption: "숙박",
    coordinate: candidate?.coordinate,
    mode: input.transportMode,
    name: input.hotelName?.trim() || candidate?.name || `${destination} 숙소`,
    placeId: candidate?.placeId,
    role: "숙소",
  };
}

/** Converts one AI-authored visit into an unresolved provider-gated route stop. */
function createCompactVisitStop(visit: OpenAiCompactVisit): PlanmeDraftRouteStop {
  return {
    addressQuery: visit.addressQuery.trim(),
    caption: visit.caption.trim(),
    name: visit.name.trim(),
    requiredPlaceKind: visit.requiredPlaceKind ?? undefined,
    role: "방문지",
  };
}

/** Creates only traveler anchors; luggage delivery is synthesized after route normalization. */
function createCompactCanonicalTimeline(
  stops: readonly PlanmeDraftRouteStop[],
  visits: readonly OpenAiCompactVisit[],
  startMinutes: number,
): PlanmeDraftTimelineEvent[] {
  return stops.map((stop, stopIndex) => {
    const visit = stopIndex > 0 && stopIndex < stops.length - 1
      ? visits[stopIndex - 1]
      : undefined;
    const isStart = stopIndex === 0;
    const isEnd = stopIndex === stops.length - 1;
    const title = isStart
      ? `${stop.name} 출발`
      : stop.role === "복귀지"
        ? `${stop.name} 복귀`
        : stop.role === "숙소"
          ? `${stop.name} 도착`
          : `${stop.name} 방문`;

    return {
      category: stop.role === "숙소" ? "hotel" : isStart || isEnd ? "arrival" : "event",
      description: visit?.caption.trim() || stop.caption || title,
      highlight: Boolean(visit),
      savingLabel: "",
      stayDurationMinutes: visit?.stayDurationMinutes ?? 0,
      stopIndex,
      time: formatCompactTimelineTime(startMinutes + stopIndex * 15),
      title,
    };
  });
}

/** Formats bounded provisional minutes; the web route finalizer later replaces them. */
function formatCompactTimelineTime(totalMinutes: number) {
  const normalized = Math.max(0, Math.min(23 * 60 + 59, Math.trunc(totalMinutes)));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

/**
 * Extracts the JSON string from a Responses API result.
 */
function parseOpenAiDraftPayload(payload: OpenAiResponsesApiResult): PlanmeDraftPreviewRequest {
  const outputText = extractOpenAiOutputText(payload);

  if (!outputText) {
    throw new PlanmeOpenAiError(
      "OPENAI_INVALID_RESPONSE",
      "output_parsing",
      false,
      "OpenAI itinerary generation returned an empty response.",
    );
  }

  return parseOpenAiJsonOutput<PlanmeDraftPreviewRequest>(outputText);
}

/** Converts malformed structured output into the same stable error contract. */
function parseOpenAiJsonOutput<T>(outputText: string): T {
  try {
    return JSON.parse(outputText) as T;
  } catch {
    throw new PlanmeOpenAiError(
      "OPENAI_INVALID_RESPONSE",
      "output_parsing",
      false,
      "OpenAI returned malformed structured output.",
    );
  }
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
