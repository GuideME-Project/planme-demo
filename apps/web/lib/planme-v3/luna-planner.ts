import {
  arrangeTourCandidatesDeterministically,
  parseAndValidateAiPlanSelection,
  recordPlanmeUsageSafely,
  type AiPlanSelection,
  type DeterministicArrangementOptions,
  type PlanmeUsageRecorder,
  type ResolvedTripIntent,
  type TourPlaceSnapshot,
} from "@planme/core";

export const PLANME_V3_LUNA_MODEL = "gpt-5.6-luna";
export const PLANME_V3_LUNA_REASONING_EFFORT = "low";
const LONG_TRIP_THRESHOLD_DAYS = 4;

type OpenAiResponsePayload = {
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
};

type LunaRequestBody = {
  model: string;
  reasoning: { effort: string };
  instructions: string;
  input: string;
  max_output_tokens: number;
  store: boolean;
  text: {
    format: {
      type: "json_schema";
      name: string;
      strict: true;
      schema: JsonSchema;
    };
  };
};

type JsonSchema = {
  type: string;
  additionalProperties?: boolean;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
};

export type PlanWithLunaOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  usageRecorder?: PlanmeUsageRecorder;
  signal?: AbortSignal;
};

export type LunaPlanResult =
  | {
      ok: true;
      selection: AiPlanSelection;
      source: "luna" | "deterministic";
      attempts: number;
    }
  | {
      ok: false;
      errorCode: "OPENAI_CONFIGURATION_MISSING" | "CANDIDATES_INSUFFICIENT";
      attempts: number;
    };

export async function planTourCandidatesWithLuna(
  input: {
    intent: ResolvedTripIntent;
    candidates: TourPlaceSnapshot[];
  },
  options: PlanWithLunaOptions = {},
): Promise<LunaPlanResult> {
  const apiKey = options.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
  if (!apiKey) {
    return { ok: false, errorCode: "OPENAI_CONFIGURATION_MISSING", attempts: 0 };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const selectionLimits = getSelectionLimits(input.intent.durationDays);
  const requestBody = createLunaRequestBody(
    input.intent,
    input.candidates,
    selectionLimits,
  );

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await recordPlanmeUsageSafely(options.usageRecorder, "openai_request");
    const rawSelection = await requestLunaSelection({
      apiKey,
      fetchImpl,
      requestBody,
      signal: options.signal,
    });

    if (rawSelection) {
      const validation = parseAndValidateAiPlanSelection(
        rawSelection,
        input.candidates,
        input.intent.durationDays,
      );
      if (validation.ok) {
        return {
          ok: true,
          selection: validation.value,
          source: "luna",
          attempts: attempt,
        };
      }
    }
  }

  const deterministic = arrangeTourCandidatesDeterministically(
    input.candidates,
    input.intent.durationDays,
    selectionLimits,
  );
  return deterministic.ok
    ? {
        ok: true,
        selection: deterministic.value,
        source: "deterministic",
        attempts: 2,
      }
    : { ok: false, errorCode: "CANDIDATES_INSUFFICIENT", attempts: 2 };
}

export function createLunaRequestBody(
  intent: ResolvedTripIntent,
  candidates: TourPlaceSnapshot[],
  selectionLimits = getSelectionLimits(intent.durationDays),
): LunaRequestBody {
  return {
    model: PLANME_V3_LUNA_MODEL,
    reasoning: { effort: PLANME_V3_LUNA_REASONING_EFFORT },
    instructions: [
      "TourAPI가 제공한 후보 ID만 선택하세요.",
      "후보에 없는 장소나 ID를 만들지 마세요.",
      "장소명, 주소, 좌표, 방문 시각, 체류시간, 이동시간, 설명을 출력하지 마세요.",
      "숙소는 하나만 선택하고 방문 장소와 음식점은 중복하지 마세요.",
      `일차별 방문 장소는 최대 ${selectionLimits.maxVisitsPerDay}개, 음식점은 최대 ${selectionLimits.maxRestaurantsPerDay}개만 선택하세요.`,
      "JSON schema 이외의 필드를 출력하지 마세요.",
    ].join(" "),
    input: JSON.stringify({
      trip: {
        destination: intent.destination,
        durationDays: intent.durationDays,
        transportMode: intent.transportMode,
        travelStartDate: intent.travelStartDate,
        preferences: intent.preferences,
        requestedPlaces: intent.requestedPlaces,
      },
      candidates: candidates.map((candidate) => ({
        contentId: candidate.contentId,
        contentTypeId: candidate.contentTypeId,
        title: candidate.title,
      })),
    }),
    max_output_tokens: 1_000,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "planme_v3_selection",
        strict: true,
        schema: createAiSelectionSchema(intent.durationDays, selectionLimits),
      },
    },
  };
}

async function requestLunaSelection(input: {
  apiKey: string;
  fetchImpl: typeof fetch;
  requestBody: LunaRequestBody;
  signal?: AbortSignal;
}) {
  let response: Response;
  try {
    response = await input.fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.requestBody),
      signal: input.signal,
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  let payload: OpenAiResponsePayload;
  try {
    payload = JSON.parse(await response.text()) as OpenAiResponsePayload;
  } catch {
    return null;
  }

  for (const output of payload.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === "output_text" && content.text) {
        return content.text;
      }
      if (content.refusal) {
        return null;
      }
    }
  }

  return null;
}

function createAiSelectionSchema(
  durationDays: number,
  selectionLimits: Required<
    Pick<
      DeterministicArrangementOptions,
      "maxVisitsPerDay" | "maxRestaurantsPerDay"
    >
  >,
): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      lodgingContentId: { type: "string" },
      days: {
        type: "array",
        minItems: durationDays,
        maxItems: durationDays,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            day: { type: "integer", minimum: 1, maximum: durationDays },
            orderedVisitContentIds: {
              type: "array",
              maxItems: selectionLimits.maxVisitsPerDay,
              items: { type: "string" },
            },
            restaurantContentIds: {
              type: "array",
              maxItems: selectionLimits.maxRestaurantsPerDay,
              items: { type: "string" },
            },
          },
          required: [
            "day",
            "orderedVisitContentIds",
            "restaurantContentIds",
          ],
        },
      },
    },
    required: ["lodgingContentId", "days"],
  };
}

function getSelectionLimits(durationDays: number) {
  return durationDays >= LONG_TRIP_THRESHOLD_DAYS
    ? { maxVisitsPerDay: 1, maxRestaurantsPerDay: 0 }
    : { maxVisitsPerDay: 1, maxRestaurantsPerDay: 1 };
}
