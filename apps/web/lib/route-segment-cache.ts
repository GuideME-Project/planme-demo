import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import type { MapCoordinate } from "@planme/core";
import type { RouteProviderSegment } from "./route-providers/types";

export type TransitRecoveryMode = "off" | "on" | "smoke";

export type OdsayStationRecoveryPolicy = {
  aiWalkLimitMinutes: number;
  fixedWalkLimitMinutes: number;
  maxStationCandidates: number;
  policyVersion: string;
  searchRadiiMeters: number[];
};

export type RouteProviderOperation =
  | "point_search"
  | "retry"
  | "transit"
  | "walk";

export interface RouteSegmentCache {
  get(key: string): Promise<RouteProviderSegment | null>;
  set(key: string, value: RouteProviderSegment, ttlSeconds: number): Promise<void>;
}

export interface RouteProviderCallBudget {
  consume(operation: RouteProviderOperation): Promise<void>;
}

export class RouteProviderRuntimeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RouteProviderRuntimeError";
  }
}

export type TransitRecoveryRuntime = {
  budget: RouteProviderCallBudget;
  cache: RouteSegmentCache;
  mode: Exclude<TransitRecoveryMode, "off">;
  policy: OdsayStationRecoveryPolicy;
  traceId: string;
};

const ROUTE_SEGMENT_CACHE_TTL_SECONDS = 300;
const ROUTE_PROVIDER_BUDGET_TTL_SECONDS = 300;
const ROUTE_SEGMENT_PREFIX = "planme:route-segment";
const ROUTE_PROVIDER_BUDGET_PREFIX = "planme:route-provider-budget";
const memorySegments = new Map<string, { expiresAt: number; value: RouteProviderSegment }>();
const memoryBudgets = new Map<string, { count: number; expiresAt: number }>();

/** Keeps local and deployed transit recovery behavior aligned unless explicitly disabled. */
export function getTransitRecoveryMode(): TransitRecoveryMode {
  const raw = process.env.PLANME_TRANSIT_ACCESS_RECOVERY_MODE?.trim() || "on";

  if (raw === "off" || raw === "smoke" || raw === "on") {
    return raw;
  }

  throw new RouteProviderRuntimeError("TRANSIT_RECOVERY_CONFIGURATION_ERROR");
}

/** Creates the shared cache and provider-call budget used by preflight and final save. */
export function createTransitRecoveryRuntime(
  traceId: string,
  options: {
    allowSmoke?: boolean;
    budget?: RouteProviderCallBudget;
    cache?: RouteSegmentCache;
    mode?: TransitRecoveryMode;
    policy?: OdsayStationRecoveryPolicy;
  } = {},
): TransitRecoveryRuntime | null {
  const mode = options.mode ?? getTransitRecoveryMode();

  if (mode === "off" || (mode === "smoke" && !options.allowSmoke)) {
    return null;
  }

  const policy = options.policy ?? readRecoveryPolicy();
  const stores = options.budget && options.cache
    ? null
    : createConfiguredStores(
        traceId,
        readPositiveIntegerEnv("PLANME_ODSAY_MAX_REQUESTS_PER_TRACE"),
      );

  return {
    budget: options.budget ?? stores!.budget,
    cache: options.cache ?? stores!.cache,
    mode,
    policy,
    traceId,
  };
}

/** Produces a cache key that exposes only a trace UUID and a coordinate hash. */
export function createRouteSegmentCacheKey(
  traceId: string,
  origin: MapCoordinate,
  destination: MapCoordinate,
  policyVersion: string,
) {
  const coordinateHash = createHash("sha256")
    .update(
      [
        "odsay",
        "transit",
        normalizeCoordinate(origin),
        normalizeCoordinate(destination),
        policyVersion,
      ].join("|"),
    )
    .digest("hex");

  return `${ROUTE_SEGMENT_PREFIX}:${traceId}:${coordinateHash}`;
}

export { ROUTE_SEGMENT_CACHE_TTL_SECONDS };

/** In-memory cache used by local verification without external state. */
export class MemoryRouteSegmentCache implements RouteSegmentCache {
  async get(key: string) {
    const record = memorySegments.get(key);

    if (!record || record.expiresAt <= Date.now()) {
      memorySegments.delete(key);
      return null;
    }

    return structuredClone(record.value);
  }

  async set(key: string, value: RouteProviderSegment, ttlSeconds: number) {
    memorySegments.set(key, {
      expiresAt: Date.now() + ttlSeconds * 1_000,
      value: structuredClone(value),
    });
  }
}

/** In-memory atomic-equivalent budget used by single-process tests. */
export class MemoryRouteProviderCallBudget implements RouteProviderCallBudget {
  constructor(
    private readonly traceId: string,
    private readonly maxRequests: number,
  ) {}

  async consume() {
    const current = memoryBudgets.get(this.traceId);
    const count = current && current.expiresAt > Date.now() ? current.count + 1 : 1;

    memoryBudgets.set(this.traceId, {
      count,
      expiresAt: Date.now() + ROUTE_PROVIDER_BUDGET_TTL_SECONDS * 1_000,
    });

    if (count > this.maxRequests) {
      throw new RouteProviderRuntimeError("PROVIDER_CALL_BUDGET_EXCEEDED");
    }
  }
}

class UpstashRouteSegmentCache implements RouteSegmentCache {
  constructor(private readonly redis: Redis) {}

  async get(key: string) {
    const value = await this.redis.get<RouteProviderSegment | string>(key);

    if (!value) {
      return null;
    }

    return typeof value === "string"
      ? JSON.parse(value) as RouteProviderSegment
      : value;
  }

  async set(key: string, value: RouteProviderSegment, ttlSeconds: number) {
    await this.redis.set(key, JSON.stringify(value), { ex: ttlSeconds });
  }
}

class UpstashRouteProviderCallBudget implements RouteProviderCallBudget {
  constructor(
    private readonly redis: Redis,
    private readonly traceId: string,
    private readonly maxRequests: number,
  ) {}

  async consume() {
    const count = await this.redis.eval(
      `
        local current = redis.call("INCR", KEYS[1])
        if current == 1 then
          redis.call("EXPIRE", KEYS[1], ARGV[1])
        end
        return current
      `,
      [`${ROUTE_PROVIDER_BUDGET_PREFIX}:${this.traceId}`],
      [ROUTE_PROVIDER_BUDGET_TTL_SECONDS],
    ) as number;

    if (count > this.maxRequests) {
      throw new RouteProviderRuntimeError("PROVIDER_CALL_BUDGET_EXCEEDED");
    }
  }
}

function createConfiguredStores(traceId: string, maxRequests: number) {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (url && token) {
    const redis = new Redis({ token, url });

    return {
      budget: new UpstashRouteProviderCallBudget(redis, traceId, maxRequests),
      cache: new UpstashRouteSegmentCache(redis),
    };
  }

  if (process.env.NODE_ENV === "production") {
    throw new RouteProviderRuntimeError("ROUTE_PROVIDER_CONFIGURATION_ERROR");
  }

  return {
    budget: new MemoryRouteProviderCallBudget(traceId, maxRequests),
    cache: new MemoryRouteSegmentCache(),
  };
}

function readRecoveryPolicy(): OdsayStationRecoveryPolicy {
  const radii = (process.env.PLANME_ODSAY_STATION_SEARCH_RADII_METERS ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  const isStrictlyIncreasing = radii.every(
    (value, index) => index === 0 || value > radii[index - 1],
  );

  if (radii.length === 0 || !isStrictlyIncreasing) {
    throw new RouteProviderRuntimeError("ROUTE_PROVIDER_CONFIGURATION_ERROR");
  }

  return {
    aiWalkLimitMinutes: 30,
    fixedWalkLimitMinutes: 90,
    maxStationCandidates: 2,
    policyVersion: process.env.PLANME_ODSAY_RECOVERY_POLICY_VERSION?.trim() || "v1",
    searchRadiiMeters: radii,
  };
}

function readPositiveIntegerEnv(name: string) {
  const parsed = Number(process.env[name]);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new RouteProviderRuntimeError("ROUTE_PROVIDER_CONFIGURATION_ERROR");
  }

  return parsed;
}

function normalizeCoordinate(coordinate: MapCoordinate) {
  return `${coordinate.lat.toFixed(6)},${coordinate.lng.toFixed(6)}`;
}
