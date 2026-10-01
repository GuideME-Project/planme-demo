import type { PlanmeUsageCounterEvent } from "@planme/core";
import { getPlanmeRedis, getPlanmeRedisUrl } from "./planme-redis";

type UsageCounterStore = {
  increment(event: PlanmeUsageCounterEvent, amount?: number): Promise<void>;
};

const USAGE_COUNTER_KEY_PREFIX = "planme:usage";
// Daily usage counters survive for eight days so short operational reviews can compare a week.
const USAGE_COUNTER_TTL_SECONDS = 60 * 60 * 24 * 8;
const memoryUsageCounters = new Map<string, number>();
let cachedUsageCounterStore: UsageCounterStore | null = null;

/**
 * Records a PlanME usage counter without sharing the preview itinerary store.
 */
export async function recordWebPlanmeUsage(
  event: PlanmeUsageCounterEvent,
  amount = 1,
): Promise<void> {
  await getUsageCounterStore().increment(event, amount);
}

class RedisUsageCounterStore implements UsageCounterStore {
  /**
   * Increments a daily counter and keeps the key expiring automatically.
   */
  async increment(event: PlanmeUsageCounterEvent, amount = 1): Promise<void> {
    const key = createUsageCounterKey(event);
    const redis = await getPlanmeRedis();

    await redis
      .multi()
      .incrBy(key, amount)
      .expire(key, USAGE_COUNTER_TTL_SECONDS)
      .exec();
  }
}

class MemoryUsageCounterStore implements UsageCounterStore {
  /**
   * Tracks counters locally when PLANME_REDIS_URL is not configured.
   */
  async increment(event: PlanmeUsageCounterEvent, amount = 1): Promise<void> {
    const key = createUsageCounterKey(event);

    memoryUsageCounters.set(key, (memoryUsageCounters.get(key) ?? 0) + amount);
  }
}

/**
 * Selects Redis in configured runtimes and memory in local development.
 */
function getUsageCounterStore(): UsageCounterStore {
  if (cachedUsageCounterStore) {
    return cachedUsageCounterStore;
  }

  cachedUsageCounterStore = getPlanmeRedisUrl()
    ? new RedisUsageCounterStore()
    : new MemoryUsageCounterStore();

  return cachedUsageCounterStore;
}

/**
 * Creates a UTC-day bucketed key with a namespace separate from preview storage.
 */
function createUsageCounterKey(event: PlanmeUsageCounterEvent) {
  return `${USAGE_COUNTER_KEY_PREFIX}:${new Date().toISOString().slice(0, 10)}:${event}`;
}
