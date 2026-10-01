import { createHash, randomUUID } from "node:crypto";
import { createClientAddressHash } from "./planme-client-ip";
import { evalPlanmeScript, getPlanmeRedisUrl } from "./planme-redis";

export const PLANME_SEARCH_SESSION_COOKIE = "planme_search_session";
export const PLANME_SEARCH_MINUTE_LIMIT = 2;
export const PLANME_SEARCH_MINUTE_WINDOW_SECONDS = 60;
export const PLANME_SEARCH_DAILY_LIMIT = 20;

const PLANME_SEARCH_RATE_KEY_PREFIX = "planme:search-rate";
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PlanmeSearchRateLimitDecision = {
  allowed: boolean;
  blockedBy: "day" | "minute" | null;
};

export type PlanmeSearchRateLimitInput = {
  limits?: { minute: number; day: number };
  dayKey: string;
  dayTtlSeconds: number;
  minuteKey: string;
  minuteTtlSeconds: number;
  nowMs: number;
};

export type PlanmeSearchRateLimitStore = {
  consume(input: PlanmeSearchRateLimitInput): Promise<PlanmeSearchRateLimitDecision>;
};

export type PlanmeSearchSessionCookieStore = {
  get(name: string): { value: string } | undefined;
  set(
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      path: "/";
      sameSite: "lax";
      secure: boolean;
    },
  ): void;
};

export type PlanmeSearchRateLimitKeys = {
  dayKey: string;
  dayTtlSeconds: number;
  minuteKey: string;
  minuteTtlSeconds: number;
  sessionHash: string;
};

type PlanmeSearchRateLimitStoreOptions = {
  isProduction: boolean;
  redisConfigured?: boolean;
};

type PlanmeSearchRateLimitGlobal = typeof globalThis & {
  __planmeSearchMemoryRateLimitStore?: PlanmeSearchRateLimitStore;
};

let cachedPlanmeSearchRateLimitStore: PlanmeSearchRateLimitStore | null = null;

/**
 * Reads the anonymous requester session or creates a new session-only UUID cookie.
 */
export function getOrCreatePlanmeSearchSessionId(
  cookieStore: PlanmeSearchSessionCookieStore,
) {
  const currentSessionId = cookieStore.get(PLANME_SEARCH_SESSION_COOKIE)?.value;

  if (currentSessionId && UUID_V4_PATTERN.test(currentSessionId)) {
    return currentSessionId.toLowerCase();
  }

  const sessionId = randomUUID();
  cookieStore.set(
    PLANME_SEARCH_SESSION_COOKIE,
    sessionId,
    getPlanmeSearchSessionCookieOptions(),
  );
  return sessionId;
}

/** Returns the intentionally session-scoped cookie attributes for anonymous search requests. */
export function getPlanmeSearchSessionCookieOptions(isProduction = isProductionRuntime()) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: isProduction,
  } as const;
}

/**
 * Atomically consumes the anonymous requester's minute and UTC-day generation quotas.
 */
export async function consumePlanmeSearchRateLimit(
  sessionId: string,
  options: {
    nowMs?: number;
    store?: PlanmeSearchRateLimitStore;
  } = {},
) {
  const nowMs = options.nowMs ?? Date.now();
  const keys = createPlanmeSearchRateLimitKeys(sessionId, nowMs);
  const store = options.store ?? getPlanmeSearchRateLimitStore();

  return store.consume({
    dayKey: keys.dayKey,
    dayTtlSeconds: keys.dayTtlSeconds,
    minuteKey: keys.minuteKey,
    minuteTtlSeconds: keys.minuteTtlSeconds,
    nowMs,
  });
}

// Conservative demo defaults approved for this implementation, not Google quotas or settled product policy.
export const PLANME_AUTOCOMPLETE_LIMITS = { minute: 30, day: 200 };
export const PLANME_AUTOCOMPLETE_GLOBAL_LIMITS = { minute: 300, day: 3000 };

export async function consumePlanmeAutocompleteRateLimit(sessionId: string) {
  return consumeNamespacedRateLimit("autocomplete-rate", [
    [sessionId, PLANME_AUTOCOMPLETE_LIMITS],
    ["global", PLANME_AUTOCOMPLETE_GLOBAL_LIMITS],
  ]);
}

// Per-client-address demo defaults for public read/write endpoints; tune with real traffic.
export const PLANME_PUBLIC_API_LIMITS = {
  magazine: { minute: 60, day: 2000 },
  places: { minute: 30, day: 500 },
  usage: { minute: 120, day: 5000 },
} as const;

/** Limits one public endpoint per hashed client address using the shared Redis counters. */
export async function consumePlanmePublicApiRateLimit(
  endpoint: keyof typeof PLANME_PUBLIC_API_LIMITS,
  clientAddressHash: string,
) {
  return consumeNamespacedRateLimit(`api-rate:${endpoint}`, [
    [clientAddressHash, PLANME_PUBLIC_API_LIMITS[endpoint]],
  ]);
}

/**
 * Returns true when the caller exceeded the endpoint limit.
 * Storage failures are logged and allowed so a Redis outage cannot take public pages down.
 */
export async function isPlanmePublicApiRateLimited(
  endpoint: keyof typeof PLANME_PUBLIC_API_LIMITS,
  request: Request,
) {
  try {
    const decision = await consumePlanmePublicApiRateLimit(endpoint, createClientAddressHash(request));

    return !decision.allowed;
  } catch (error) {
    console.error("PLANME_PUBLIC_API_RATE_LIMIT_FAILED", {
      endpoint,
      message: error instanceof Error ? error.message : "unknown error",
    });
    return false;
  }
}

async function consumeNamespacedRateLimit(
  namespace: string,
  subjects: ReadonlyArray<readonly [string, { minute: number; day: number }]>,
) {
  const nowMs = Date.now();
  const store = getPlanmeSearchRateLimitStore();
  for (const [subject, limits] of subjects) {
    const keys = createPlanmeSearchRateLimitKeys(subject, nowMs);
    const result = await store.consume({
      ...keys,
      dayKey: keys.dayKey.replace(PLANME_SEARCH_RATE_KEY_PREFIX, `planme:${namespace}`),
      minuteKey: keys.minuteKey.replace(PLANME_SEARCH_RATE_KEY_PREFIX, `planme:${namespace}`),
      nowMs,
      limits,
    });
    if (!result.allowed) return result;
  }
  return { allowed: true, blockedBy: null } satisfies PlanmeSearchRateLimitDecision;
}

/**
 * Builds only hashed Redis keys so anonymous cookie values are never persisted.
 */
export function createPlanmeSearchRateLimitKeys(sessionId: string, nowMs: number) {
  const sessionHash = createHash("sha256").update(sessionId).digest("hex");
  const date = new Date(nowMs);
  const utcDay = date.toISOString().slice(0, 10);

  return {
    dayKey: `${PLANME_SEARCH_RATE_KEY_PREFIX}:day:${utcDay}:${sessionHash}`,
    dayTtlSeconds: getUtcDayTtlSeconds(nowMs),
    minuteKey: `${PLANME_SEARCH_RATE_KEY_PREFIX}:minute:${sessionHash}`,
    minuteTtlSeconds: PLANME_SEARCH_MINUTE_WINDOW_SECONDS,
    sessionHash,
  } satisfies PlanmeSearchRateLimitKeys;
}

/**
 * Selects Redis when configured, otherwise an equivalent process-local store outside production.
 */
export function createPlanmeSearchRateLimitStore(
  options: PlanmeSearchRateLimitStoreOptions,
): PlanmeSearchRateLimitStore {
  if (options.redisConfigured) {
    return new RedisPlanmeSearchRateLimitStore();
  }
  if (options.isProduction) {
    throw new Error("PLANME_SEARCH_RATE_LIMIT_REDIS_CONFIGURATION_MISSING");
  }

  return createMemoryPlanmeSearchRateLimitStore();
}

/** Creates an isolated memory implementation for local development and deterministic checks. */
export function createMemoryPlanmeSearchRateLimitStore(): PlanmeSearchRateLimitStore {
  return new MemoryPlanmeSearchRateLimitStore();
}

/**
 * Checks both quotas before changing either counter, then assigns first-window TTLs atomically.
 */
export const PLANME_SEARCH_RATE_LIMIT_LUA = `
  local minuteCount = tonumber(redis.call("GET", KEYS[1]) or "0")
  local dayCount = tonumber(redis.call("GET", KEYS[2]) or "0")
  local minuteLimit = tonumber(ARGV[1])
  local dayLimit = tonumber(ARGV[2])

  if minuteCount >= minuteLimit then
    return {0, "minute"}
  end
  if dayCount >= dayLimit then
    return {0, "day"}
  end

  if minuteCount == 0 then
    redis.call("SET", KEYS[1], 1, "EX", ARGV[3])
  else
    redis.call("INCR", KEYS[1])
  end
  if dayCount == 0 then
    redis.call("SET", KEYS[2], 1, "EX", ARGV[4])
  else
    redis.call("INCR", KEYS[2])
  end

  return {1, ""}
`;

class RedisPlanmeSearchRateLimitStore implements PlanmeSearchRateLimitStore {
  async consume(input: PlanmeSearchRateLimitInput): Promise<PlanmeSearchRateLimitDecision> {
    const result = await evalPlanmeScript<[number, "" | "day" | "minute"]>(
      PLANME_SEARCH_RATE_LIMIT_LUA,
      [input.minuteKey, input.dayKey],
      [
        input.limits?.minute ?? PLANME_SEARCH_MINUTE_LIMIT,
        input.limits?.day ?? PLANME_SEARCH_DAILY_LIMIT,
        input.minuteTtlSeconds,
        input.dayTtlSeconds,
      ],
    );

    return {
      allowed: result[0] === 1,
      blockedBy: result[1] === "day" || result[1] === "minute" ? result[1] : null,
    };
  }
}

class MemoryPlanmeSearchRateLimitStore implements PlanmeSearchRateLimitStore {
  private readonly counters = new Map<string, { count: number; expiresAt: number }>();

  async consume(input: PlanmeSearchRateLimitInput): Promise<PlanmeSearchRateLimitDecision> {
    const minute = this.getActiveCounter(input.minuteKey, input.nowMs);
    const day = this.getActiveCounter(input.dayKey, input.nowMs);

    if ((minute?.count ?? 0) >= (input.limits?.minute ?? PLANME_SEARCH_MINUTE_LIMIT)) {
      return { allowed: false, blockedBy: "minute" };
    }
    if ((day?.count ?? 0) >= (input.limits?.day ?? PLANME_SEARCH_DAILY_LIMIT)) {
      return { allowed: false, blockedBy: "day" };
    }

    this.increment(input.minuteKey, minute, input.minuteTtlSeconds, input.nowMs);
    this.increment(input.dayKey, day, input.dayTtlSeconds, input.nowMs);
    return { allowed: true, blockedBy: null };
  }

  private getActiveCounter(key: string, nowMs: number) {
    const counter = this.counters.get(key);

    if (counter && counter.expiresAt <= nowMs) {
      this.counters.delete(key);
      return undefined;
    }
    return counter;
  }

  private increment(
    key: string,
    current: { count: number; expiresAt: number } | undefined,
    ttlSeconds: number,
    nowMs: number,
  ) {
    if (current) {
      current.count += 1;
      return;
    }

    this.counters.set(key, {
      count: 1,
      expiresAt: nowMs + ttlSeconds * 1_000,
    });
  }
}

function getPlanmeSearchRateLimitStore() {
  if (cachedPlanmeSearchRateLimitStore) {
    return cachedPlanmeSearchRateLimitStore;
  }

  const isProduction = isProductionRuntime();

  if (!isProduction) {
    const developmentGlobal = globalThis as PlanmeSearchRateLimitGlobal;
    developmentGlobal.__planmeSearchMemoryRateLimitStore ??=
      createMemoryPlanmeSearchRateLimitStore();
    cachedPlanmeSearchRateLimitStore = developmentGlobal.__planmeSearchMemoryRateLimitStore;
    return cachedPlanmeSearchRateLimitStore;
  }

  cachedPlanmeSearchRateLimitStore = createPlanmeSearchRateLimitStore({
    isProduction,
    redisConfigured: getPlanmeRedisUrl() !== null,
  });
  return cachedPlanmeSearchRateLimitStore;
}

function getUtcDayTtlSeconds(nowMs: number) {
  const now = new Date(nowMs);
  const nextUtcDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );

  return Math.max(1, Math.ceil((nextUtcDay - nowMs) / 1_000));
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" &&
    process.env.PLANME_PROGRESS_UI_PREVIEW?.trim() !== "1";
}
