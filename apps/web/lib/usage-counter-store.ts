import { Redis } from "@upstash/redis";
import type { PlanmeUsageCounterEvent } from "@planme/core";

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

class UpstashUsageCounterStore implements UsageCounterStore {
  private readonly redis: Redis;

  /**
   * Creates a Redis-backed daily usage counter store.
   */
  constructor(url: string, token: string) {
    this.redis = new Redis({ token, url });
  }

  /**
   * Increments a daily counter and keeps the key expiring automatically.
   */
  async increment(event: PlanmeUsageCounterEvent, amount = 1): Promise<void> {
    const key = createUsageCounterKey(event);

    await this.redis.incrby(key, amount);
    await this.redis.expire(key, USAGE_COUNTER_TTL_SECONDS);
  }
}

class MemoryUsageCounterStore implements UsageCounterStore {
  /**
   * Tracks counters locally when Upstash env vars are not configured.
   */
  async increment(event: PlanmeUsageCounterEvent, amount = 1): Promise<void> {
    const key = createUsageCounterKey(event);

    memoryUsageCounters.set(key, (memoryUsageCounters.get(key) ?? 0) + amount);
  }
}

/**
 * Selects Upstash in configured runtimes and memory in local development.
 */
function getUsageCounterStore(): UsageCounterStore {
  if (cachedUsageCounterStore) {
    return cachedUsageCounterStore;
  }

  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  cachedUsageCounterStore =
    upstashUrl && upstashToken
      ? new UpstashUsageCounterStore(upstashUrl, upstashToken)
      : new MemoryUsageCounterStore();

  return cachedUsageCounterStore;
}

/**
 * Creates a UTC-day bucketed key with a namespace separate from preview storage.
 */
function createUsageCounterKey(event: PlanmeUsageCounterEvent) {
  return `${USAGE_COUNTER_KEY_PREFIX}:${new Date().toISOString().slice(0, 10)}:${event}`;
}
