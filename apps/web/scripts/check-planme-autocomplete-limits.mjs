import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { consumePlanmeAutocompleteRateLimit, consumePlanmeSearchRateLimit, createMemoryPlanmeSearchRateLimitStore, PLANME_AUTOCOMPLETE_LIMITS, PLANME_AUTOCOMPLETE_GLOBAL_LIMITS } from "../lib/planme-search-rate-limit.ts";

// Real local memory limiter; no provider calls or test doubles.
// NODE_ENV=development node --experimental-transform-types apps/web/scripts/check-planme-autocomplete-limits.mjs
assert.equal(process.env.NODE_ENV, "development");
const session = randomUUID();
for (let index = 0; index < 30; index++) assert.equal((await consumePlanmeAutocompleteRateLimit(session)).allowed, true);
assert.deepEqual(await consumePlanmeAutocompleteRateLimit(session), { allowed: false, blockedBy: "minute" });
for (let index = 0; index < 2; index++) assert.equal((await consumePlanmeSearchRateLimit(session)).allowed, true);
assert.deepEqual(await consumePlanmeSearchRateLimit(session), { allowed: false, blockedBy: "minute" });
for (let index = 0; index < 270; index++) assert.equal((await consumePlanmeAutocompleteRateLimit(randomUUID())).allowed, true);
assert.deepEqual(await consumePlanmeAutocompleteRateLimit(randomUUID()), { allowed: false, blockedBy: "minute" });
for (const limits of [PLANME_AUTOCOMPLETE_LIMITS, PLANME_AUTOCOMPLETE_GLOBAL_LIMITS]) {
  const store = createMemoryPlanmeSearchRateLimitStore();
  const start = Date.now();
  for (let index = 0; index < limits.day; index++) {
    const result = await store.consume({ dayKey: "day", minuteKey: "minute", dayTtlSeconds: 86400, minuteTtlSeconds: 60, nowMs: start + Math.floor(index / limits.minute) * 60000, limits });
    assert.equal(result.allowed, true);
  }
  assert.deepEqual(await store.consume({ dayKey: "day", minuteKey: "minute", dayTtlSeconds: 86400, minuteTtlSeconds: 60, nowMs: start + 3600000, limits }), { allowed: false, blockedBy: "day" });
}
console.log("세션 30/분·200/일, 전체 300/분·3000/일 차단 및 일정 생성 2/분 카운터 분리 통과");
