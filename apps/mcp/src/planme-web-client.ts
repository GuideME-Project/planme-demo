import { createHash } from "node:crypto";
import type {
  ExcludedRequestedPlace,
  ItineraryDisplayDto,
} from "@planme/core";

export type PlanmeV3StartInput = {
  origin: string;
  destination: string;
  transportMode: "drive" | "transit";
  durationDays: number;
  travelStartDate?: string;
  preferences?: string[];
  requestedPlaces?: string[];
  travelerCount?: number;
  luggageCount?: number;
};

export type PlanmeWebJobResponse =
  | {
      status: "processing";
      itineraryId: string;
      phase: string;
      retryAfterMs: number;
    }
  | {
      status: "ready";
      itineraryId: string;
      revision: number;
      pageUrl: string;
      widget: ItineraryDisplayDto;
      excludedRequestedPlaces: ExcludedRequestedPlace[];
    }
  | {
      status: "failed";
      itineraryId: string;
      errorCode: string;
      message: string;
    };

type ErrorPayload = { error?: string };

export class PlanmeWebClientHttpError extends Error {
  readonly status: number;
  readonly errorCode: string;

  constructor(status: number, errorCode: string) {
    super(errorCode);
    this.name = "PlanmeWebClientHttpError";
    this.status = status;
    this.errorCode = errorCode;
  }
}

export function createPlanmeIdempotencyKey(
  channel: "gpts" | "mcp",
  sourceId: string,
) {
  const namespaced = `${channel}:${sourceId}`;
  return namespaced.length <= 128
    ? namespaced
    : `${channel}:sha256:${createHash("sha256").update(sourceId).digest("hex")}`;
}

export async function startPlanmeV3Itinerary(
  input: PlanmeV3StartInput,
  idempotencyKey: string,
) {
  return requestPlanmeWebJob(
    "/api/internal/planme/v3/itineraries",
    {
      method: "POST",
      headers: {
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
    },
    8_000,
  );
}

export async function runPlanmeV3Itinerary(
  itineraryId: string,
  deadlineEpochMs: number,
) {
  return requestPlanmeWebJob(
    `/api/internal/planme/v3/itineraries/${encodeURIComponent(itineraryId)}/run`,
    { method: "POST", body: JSON.stringify({ deadlineEpochMs }) },
    48_000,
  );
}

export async function advancePlanmeV3Itinerary(itineraryId: string) {
  return requestPlanmeWebJob(
    `/api/internal/planme/v3/itineraries/${encodeURIComponent(itineraryId)}/advance`,
    { method: "POST" },
    15_000,
  );
}

export async function getPlanmeV3Itinerary(itineraryId: string) {
  return requestPlanmeWebJob(
    `/api/internal/planme/v3/itineraries/${encodeURIComponent(itineraryId)}`,
    { method: "GET" },
    8_000,
  );
}

async function requestPlanmeWebJob(
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<PlanmeWebJobResponse> {
  const token = process.env.PLANME_INTERNAL_API_TOKEN?.trim();
  if (!token) {
    throw new PlanmeWebClientHttpError(500, "INTERNAL_CONFIGURATION_ERROR");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL(path, `${getPlanmeWebOrigin()}/`), {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      let errorCode = `PLANME_WEB_HTTP_${response.status}`;
      try {
        const payload = JSON.parse(text) as ErrorPayload;
        errorCode = payload.error ?? errorCode;
      } catch {
        errorCode = `PLANME_WEB_HTTP_${response.status}`;
      }
      throw new PlanmeWebClientHttpError(response.status, errorCode);
    }
    return JSON.parse(text) as PlanmeWebJobResponse;
  } finally {
    clearTimeout(timeout);
  }
}

export function getPlanmeWebOrigin() {
  const value = process.env.PLANME_WEB_ORIGIN?.trim() || "https://planme-demo.vercel.app";
  return new URL(value).origin;
}
