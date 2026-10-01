import { createClient } from "redis";

export type PlanmeRedisScriptArgument = string | number;

// ECS 작업이 Redis 장애로 오래 멈추지 않도록 최초 연결 대기 시간을 제한한다(밀리초).
const REDIS_CONNECT_TIMEOUT_MS = 5_000;
// 연결이 끊기면 최대 1초 간격으로 계속 재연결한다(밀리초).
const REDIS_RECONNECT_MAX_DELAY_MS = 1_000;

type PlanmeRedisClient = ReturnType<typeof createPlanmeRedisClient>;

let cachedClient: Promise<PlanmeRedisClient> | null = null;

function createPlanmeRedisClient(url: string) {
  return createClient({
    url,
    socket: {
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      reconnectStrategy: (retries) =>
        Math.min(retries * 100, REDIS_RECONNECT_MAX_DELAY_MS),
    },
  });
}

/** Returns the Redis TCP URL (`redis://host:port`), or null when it is not configured. */
export function getPlanmeRedisUrl() {
  return process.env.PLANME_REDIS_URL?.trim() || null;
}

/**
 * Lazily connects one shared Redis client per process.
 * A failed first connection is discarded so the next request retries.
 */
export function getPlanmeRedis(): Promise<PlanmeRedisClient> {
  const url = getPlanmeRedisUrl();

  if (!url) {
    return Promise.reject(new Error("PLANME_REDIS_URL_MISSING"));
  }
  if (cachedClient) {
    return cachedClient;
  }

  const client = createPlanmeRedisClient(url);

  // Never log the URL because it may contain credentials.
  client.on("error", (error: Error) => {
    console.error("PlanME Redis error", error.message);
  });

  const connecting = withTimeout(client.connect(), REDIS_CONNECT_TIMEOUT_MS).then(
    () => client,
    (error: Error) => {
      client.destroy();
      cachedClient = null;
      throw error;
    },
  );

  cachedClient = connecting;
  return connecting;
}

/** Runs a Lua script atomically. Keys are passed as KEYS and values as ARGV. */
export async function evalPlanmeScript<Reply extends number | string | Array<number | string>>(
  script: string,
  keys: string[],
  args: PlanmeRedisScriptArgument[],
): Promise<Reply> {
  const redis = await getPlanmeRedis();

  return redis.sendCommand<Reply>([
    "EVAL",
    script,
    String(keys.length),
    ...keys,
    ...args.map(String),
  ]);
}

function withTimeout<Value>(promise: Promise<Value>, timeoutMs: number): Promise<Value> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("PLANME_REDIS_CONNECT_TIMEOUT")),
      timeoutMs,
    );

    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
