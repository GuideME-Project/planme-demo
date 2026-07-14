import { createPlanmeV3Orchestrator } from "./orchestrator";
import {
  createMemoryPlanmeV3JobStore,
  createUpstashPlanmeV3JobStore,
  type PlanmeV3JobStore,
} from "./job-store";
import {
  createMemoryPlanmeV3TourCache,
  createUpstashPlanmeV3TourCache,
  type PlanmeV3TourCache,
} from "./tour-cache";
import { createTourApiClient } from "./tour-api-client";
import { planTourCandidatesWithLuna } from "./luna-planner";
import { geocodePlanmeAnchor } from "./geocoding";
import {
  createPlanmeV3LocalFixtureRuntime,
  isPlanmeV3LocalFixtureEnabled,
} from "./local-fixture-runtime";
import { routePlanmeSegment } from "./route-service";
import { recordWebPlanmeUsage } from "../usage-counter-store";

let cachedRuntime: ReturnType<typeof createPlanmeV3Orchestrator> | null = null;
let cachedStorage: {
  jobStore: PlanmeV3JobStore;
  tourCache: PlanmeV3TourCache;
} | null = null;

type PlanmeV3DevelopmentGlobal = typeof globalThis & {
  __planmeV3MemoryStorage?: {
    jobStore: PlanmeV3JobStore;
    tourCache: PlanmeV3TourCache;
  };
};

export function getPlanmeV3Runtime(requestOrigin?: string) {
  if (cachedRuntime) {
    return cachedRuntime;
  }

  const storage = getPlanmeV3Storage();
  if (isPlanmeV3LocalFixtureEnabled()) {
    cachedRuntime = createPlanmeV3LocalFixtureRuntime({
      jobStore: storage.jobStore,
      tourCache: storage.tourCache,
      pageOrigin: resolvePageOrigin(requestOrigin),
      usageRecorder: recordWebPlanmeUsage,
    });
    return cachedRuntime;
  }

  const tourApi = createTourApiClient({
    usageRecorder: recordWebPlanmeUsage,
  });
  cachedRuntime = createPlanmeV3Orchestrator({
    jobStore: storage.jobStore,
    tourCache: storage.tourCache,
    pageOrigin: resolvePageOrigin(requestOrigin),
    usageRecorder: recordWebPlanmeUsage,
    resolveRegion: tourApi.resolveRegion,
    listCandidates: tourApi.listCandidates,
    planCandidates: ({ signal, ...input }) =>
      planTourCandidatesWithLuna(input, {
        signal,
        usageRecorder: recordWebPlanmeUsage,
      }),
    geocodeAnchor: (query, signal) => geocodePlanmeAnchor(query, {
      signal,
      usageRecorder: recordWebPlanmeUsage,
    }),
    routeSegment: (input) => routePlanmeSegment(input, {
      usageRecorder: recordWebPlanmeUsage,
    }),
  });
  return cachedRuntime;
}

export function getPlanmeV3ReadRuntime(requestOrigin?: string) {
  const storage = getPlanmeV3Storage();
  const runtime = createPlanmeV3Orchestrator({
    jobStore: storage.jobStore,
    tourCache: storage.tourCache,
    pageOrigin: resolvePageOrigin(requestOrigin),
    resolveRegion: async () => null,
    listCandidates: async () => ({
      status: "failure",
      errorCode: "READ_ONLY_RUNTIME",
      retriable: false,
    }),
    planCandidates: async () => ({
      ok: false,
      errorCode: "OPENAI_CONFIGURATION_MISSING",
      attempts: 0,
    }),
    geocodeAnchor: async () => ({ status: "not_found" }),
    routeSegment: async () => ({
      status: "failed",
      errorCode: "READ_ONLY_RUNTIME",
    }),
  });
  return { getItineraryStatus: runtime.getItineraryStatus };
}

export function getPlanmeV3Storage() {
  if (cachedStorage) {
    return cachedStorage;
  }
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!isPlanmeV3LocalFixtureEnabled() && url && token) {
    cachedStorage = {
      jobStore: createUpstashPlanmeV3JobStore({ url, token }),
      tourCache: createUpstashPlanmeV3TourCache({ url, token }),
    };
    return cachedStorage;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("PLANME_V3_STORAGE_CONFIGURATION_MISSING");
  }
  const developmentGlobal = globalThis as PlanmeV3DevelopmentGlobal;
  developmentGlobal.__planmeV3MemoryStorage ??= {
    jobStore: createMemoryPlanmeV3JobStore(),
    tourCache: createMemoryPlanmeV3TourCache(),
  };
  cachedStorage = developmentGlobal.__planmeV3MemoryStorage;
  return cachedStorage;
}

export function classifyPlanmeV3RuntimeError(error: Error | null) {
  if (error?.message === "PLANME_V3_STORAGE_CONFIGURATION_MISSING") {
    return "STORE_CONFIGURATION_MISSING" as const;
  }
  if (error?.message === "PLANME_V3_REDIS_CONNECTION_FAILED") {
    return "STORE_CONNECTION_FAILED" as const;
  }
  if (error?.message === "PLANME_V3_REDIS_SCRIPTING_FAILED") {
    return "STORE_SCRIPTING_FAILED" as const;
  }
  if (error?.message === "PLANME_V3_REDIS_CREATE_GENERATION_FAILED") {
    return "STORE_CREATE_GENERATION_FAILED" as const;
  }
  return "STORE_UNAVAILABLE" as const;
}

function resolvePageOrigin(requestOrigin: string | undefined) {
  const configured = process.env.PLANME_WEB_ORIGIN?.trim();
  const candidate = configured || requestOrigin || "http://localhost:3000";
  return new URL(candidate).origin;
}
