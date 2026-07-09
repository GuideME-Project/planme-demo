import type { PlanmeUsageCounterEvent, PlanmeUsageRecorder } from "@planme/core";

type UsageCounterOptions = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  token?: string;
  url?: string;
};

const USAGE_COUNTER_KEY_PREFIX = "planme:usage";
// Daily counters are kept slightly longer than a week so weekend debugging can inspect prior days.
const USAGE_COUNTER_TTL_SECONDS = 60 * 60 * 24 * 8;
const memoryUsageCounters = new Map<string, number>();

/**
 * Creates the MCP usage recorder backed by Upstash REST Redis when configured.
 */
export function createPlanmeUsageRecorder(
  options: UsageCounterOptions = {},
): PlanmeUsageRecorder {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const url = options.url ?? process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = options.token ?? process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  return async (event, amount = 1) => {
    const key = createUsageCounterKey(event, now());

    if (!url || !token) {
      incrementMemoryCounter(key, amount);
      return;
    }

    await writeUpstashCounter({
      amount,
      fetchImpl,
      key,
      token,
      url,
    });
  };
}

/**
 * Reads a local memory counter for contract tests that do not configure Upstash.
 */
export function readMemoryUsageCounter(event: PlanmeUsageCounterEvent, date = new Date()) {
  return memoryUsageCounters.get(createUsageCounterKey(event, date)) ?? 0;
}

/**
 * Clears memory counters so MCP contract tests can assert fresh increments.
 */
export function clearMemoryUsageCounters(): void {
  memoryUsageCounters.clear();
}

/**
 * Creates a namespaced daily Redis key for one usage event.
 */
function createUsageCounterKey(event: PlanmeUsageCounterEvent, date: Date) {
  return `${USAGE_COUNTER_KEY_PREFIX}:${toUsageDateKey(date)}:${event}`;
}

/**
 * Converts a date to the UTC day bucket used for daily usage reporting.
 */
function toUsageDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Tracks usage locally when Upstash env vars are absent during local development.
 */
function incrementMemoryCounter(key: string, amount: number): void {
  memoryUsageCounters.set(key, (memoryUsageCounters.get(key) ?? 0) + amount);
}

/**
 * Sends INCRBY and EXPIRE together through Upstash REST pipeline.
 */
async function writeUpstashCounter({
  amount,
  fetchImpl,
  key,
  token,
  url,
}: {
  amount: number;
  fetchImpl: typeof fetch;
  key: string;
  token: string;
  url: string;
}) {
  const response = await fetchImpl(new URL("/pipeline", normalizeUpstashUrl(url)), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCRBY", key, amount],
      ["EXPIRE", key, USAGE_COUNTER_TTL_SECONDS],
    ]),
  });

  if (!response.ok) {
    throw new Error(`PlanME usage counter write failed with status ${response.status}`);
  }
}

/**
 * Normalizes Upstash REST URLs before appending command paths.
 */
function normalizeUpstashUrl(url: string) {
  return url.endsWith("/") ? url : `${url}/`;
}
