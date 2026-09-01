import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PLANME_SEARCH_RATE_LIMIT_LUA,
  PLANME_SEARCH_SESSION_COOKIE,
  consumePlanmeSearchRateLimit,
  createMemoryPlanmeSearchRateLimitStore,
  createPlanmeSearchRateLimitKeys,
  createPlanmeSearchRateLimitStore,
  getPlanmeSearchSessionCookieOptions,
  getOrCreatePlanmeSearchSessionId,
  type PlanmeSearchRateLimitStore,
  type PlanmeSearchSessionCookieStore,
} from "../lib/planme-search-rate-limit";

const SESSION_A = "3e60f7d5-c7ec-4b3e-9988-8b39e5d32e67";
const SESSION_B = "a26a0916-d6bf-4a83-9057-d935b001b5b4";

async function main() {
  assertCookieContract();
  await assertMinuteLimitAndWindowExpiry();
  await assertRejectedMinuteRequestsDoNotConsumeDailyQuota();
  await assertDailyLimitAndUtcBoundary();
  await assertSessionsAreIndependent();
  await assertConcurrentRequestsAreAtomic();
  await assertRateLimitStorageFailurePropagates();
  assertProductionRequiresUpstash();
  assertLuaChecksBeforeMutating();
  assertActionConsumesBeforeV3Start();

  console.log("PlanME search rate limit contract passed");
}

function assertCookieContract() {
  const cookieStore = createCookieStore();
  const sessionId = getOrCreatePlanmeSearchSessionId(cookieStore);

  assert.match(sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(cookieStore.setCalls.length, 1);
  assert.deepEqual(cookieStore.setCalls[0], {
    name: PLANME_SEARCH_SESSION_COOKIE,
    value: sessionId,
    options: {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: false,
    },
  });
  assert.equal(getOrCreatePlanmeSearchSessionId(cookieStore), sessionId);
  assert.equal(cookieStore.setCalls.length, 1);

  const malformedCookieStore = createCookieStore("not-a-uuid");
  const replacement = getOrCreatePlanmeSearchSessionId(malformedCookieStore);

  assert.match(replacement, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(replacement, "not-a-uuid");
  assert.equal(malformedCookieStore.setCalls.length, 1);
  assert.equal(getPlanmeSearchSessionCookieOptions(true).secure, true);

  const keys = createPlanmeSearchRateLimitKeys(sessionId, Date.parse("2026-08-31T12:00:00.000Z"));
  assert.doesNotMatch(keys.minuteKey, new RegExp(sessionId));
  assert.doesNotMatch(keys.dayKey, new RegExp(sessionId));
  assert.match(keys.sessionHash, /^[a-f0-9]{64}$/);
}

async function assertMinuteLimitAndWindowExpiry() {
  const store = createMemoryPlanmeSearchRateLimitStore();
  const startedAt = Date.parse("2026-08-31T12:00:00.000Z");

  assert.equal((await consumePlanmeSearchRateLimit(SESSION_A, { nowMs: startedAt, store })).allowed, true);
  assert.equal((await consumePlanmeSearchRateLimit(SESSION_A, { nowMs: startedAt + 59_000, store })).allowed, true);
  const blocked = await consumePlanmeSearchRateLimit(SESSION_A, {
    nowMs: startedAt + 59_500,
    store,
  });
  assert.deepEqual(blocked, { allowed: false, blockedBy: "minute" });

  const nextWindow = await consumePlanmeSearchRateLimit(SESSION_A, {
    nowMs: startedAt + 60_000,
    store,
  });
  assert.deepEqual(nextWindow, { allowed: true, blockedBy: null });
}

async function assertRejectedMinuteRequestsDoNotConsumeDailyQuota() {
  const store = createMemoryPlanmeSearchRateLimitStore();
  const startedAt = Date.parse("2026-08-31T12:00:00.000Z");

  await consumePlanmeSearchRateLimit(SESSION_A, { nowMs: startedAt, store });
  await consumePlanmeSearchRateLimit(SESSION_A, { nowMs: startedAt, store });
  assert.equal(
    (await consumePlanmeSearchRateLimit(SESSION_A, { nowMs: startedAt, store })).allowed,
    false,
  );

  for (let request = 1; request <= 18; request += 1) {
    const result = await consumePlanmeSearchRateLimit(SESSION_A, {
      nowMs: startedAt + request * 60_000,
      store,
    });
    assert.equal(result.allowed, true);
  }

  const dailyBlocked = await consumePlanmeSearchRateLimit(SESSION_A, {
    nowMs: startedAt + 19 * 60_000,
    store,
  });
  assert.deepEqual(dailyBlocked, { allowed: false, blockedBy: "day" });
}

async function assertDailyLimitAndUtcBoundary() {
  const store = createMemoryPlanmeSearchRateLimitStore();
  const startedAt = Date.parse("2026-08-30T12:00:00.000Z");

  for (let request = 0; request < 20; request += 1) {
    const result = await consumePlanmeSearchRateLimit(SESSION_A, {
      nowMs: startedAt + request * 60_000,
      store,
    });
    assert.equal(result.allowed, true);
  }

  const overDailyLimit = await consumePlanmeSearchRateLimit(SESSION_A, {
    nowMs: startedAt + 20 * 60_000,
    store,
  });
  assert.deepEqual(overDailyLimit, { allowed: false, blockedBy: "day" });

  const beforeUtcMidnight = createPlanmeSearchRateLimitKeys(
    SESSION_A,
    Date.parse("2026-08-30T23:59:59.500Z"),
  );
  const afterUtcMidnight = createPlanmeSearchRateLimitKeys(
    SESSION_A,
    Date.parse("2026-08-31T00:00:00.000Z"),
  );
  assert.notEqual(beforeUtcMidnight.dayKey, afterUtcMidnight.dayKey);
  assert.equal(beforeUtcMidnight.dayTtlSeconds, 1);
  assert.equal(afterUtcMidnight.dayTtlSeconds, 86_400);

  const nextUtcDay = await consumePlanmeSearchRateLimit(SESSION_A, {
    nowMs: Date.parse("2026-08-31T12:00:00.000Z"),
    store,
  });
  assert.deepEqual(nextUtcDay, { allowed: true, blockedBy: null });
}

async function assertSessionsAreIndependent() {
  const store = createMemoryPlanmeSearchRateLimitStore();
  const nowMs = Date.parse("2026-08-31T12:00:00.000Z");

  await consumePlanmeSearchRateLimit(SESSION_A, { nowMs, store });
  await consumePlanmeSearchRateLimit(SESSION_A, { nowMs, store });
  assert.equal((await consumePlanmeSearchRateLimit(SESSION_A, { nowMs, store })).allowed, false);
  assert.equal((await consumePlanmeSearchRateLimit(SESSION_B, { nowMs, store })).allowed, true);
}

async function assertConcurrentRequestsAreAtomic() {
  const store = createMemoryPlanmeSearchRateLimitStore();
  const nowMs = Date.parse("2026-08-31T12:00:00.000Z");
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      consumePlanmeSearchRateLimit(SESSION_A, { nowMs, store }),
    ),
  );

  assert.equal(results.filter((result) => result.allowed).length, 2);
  assert.equal(results.filter((result) => result.blockedBy === "minute").length, 6);
}

async function assertRateLimitStorageFailurePropagates() {
  const unavailableStore: PlanmeSearchRateLimitStore = {
    async consume() {
      throw new Error("REDIS_UNAVAILABLE");
    },
  };

  await assert.rejects(
    () =>
      consumePlanmeSearchRateLimit(SESSION_A, {
        nowMs: Date.parse("2026-08-31T12:00:00.000Z"),
        store: unavailableStore,
      }),
    /REDIS_UNAVAILABLE/,
  );
}

function assertProductionRequiresUpstash() {
  assert.throws(
    () => createPlanmeSearchRateLimitStore({ isProduction: true }),
    /PLANME_SEARCH_RATE_LIMIT_REDIS_CONFIGURATION_MISSING/,
  );
}

function assertLuaChecksBeforeMutating() {
  const minuteCheck = PLANME_SEARCH_RATE_LIMIT_LUA.indexOf("if minuteCount >= minuteLimit");
  const dayCheck = PLANME_SEARCH_RATE_LIMIT_LUA.indexOf("if dayCount >= dayLimit");
  const firstMutation = PLANME_SEARCH_RATE_LIMIT_LUA.indexOf('redis.call("SET", KEYS[1]');

  assert.ok(minuteCheck >= 0 && dayCheck >= 0 && firstMutation >= 0);
  assert.ok(minuteCheck < firstMutation);
  assert.ok(dayCheck < firstMutation);
}

function assertActionConsumesBeforeV3Start() {
  const actionSource = readFileSync(
    join(process.cwd(), "app/planme-search-actions.ts"),
    "utf8",
  );
  const consumeIndex = actionSource.indexOf("consumePlanmeSearchRateLimit(sessionId)");
  const startIndex = actionSource.indexOf("runtime.startItinerary(");

  assert.ok(consumeIndex >= 0 && startIndex >= 0);
  assert.ok(consumeIndex < startIndex);
  assert.match(actionSource, /현재 검색 요청을 처리할 수 없습니다/);
}

function createCookieStore(initialValue?: string) {
  const values = new Map<string, string>();
  const setCalls: Array<{
    name: string;
    options: {
      httpOnly: boolean;
      path: "/";
      sameSite: "lax";
      secure: boolean;
    };
    value: string;
  }> = [];

  if (initialValue) {
    values.set(PLANME_SEARCH_SESSION_COOKIE, initialValue);
  }

  const cookieStore: PlanmeSearchSessionCookieStore = {
    get(name) {
      const value = values.get(name);
      return value ? { value } : undefined;
    },
    set(name, value, options) {
      values.set(name, value);
      setCalls.push({ name, value, options });
    },
  };

  return { ...cookieStore, setCalls };
}

void main();
