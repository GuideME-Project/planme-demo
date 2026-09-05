import { Redis } from "@upstash/redis";
import {
  getPlanmeItineraryById,
  type PlanmeItinerary,
  type PlanmeTransportMode,
} from "@planme/core";

type StoredPreviewItineraryV1 = {
  version: 1;
  itinerary: PlanmeItinerary;
  savedAt: string;
  expiresAt: string;
};

type StoredPreviewItineraryV2 = {
  version: 2;
  revision: number;
  itinerary: PlanmeItinerary;
  routeCalculation: {
    status: "completed";
    calculatedAt: string;
    transportMode: PlanmeTransportMode;
  };
  savedAt: string;
  expiresAt: string;
};

type StoredPreviewItinerary = StoredPreviewItineraryV1 | StoredPreviewItineraryV2;

export type PreviewItineraryRecord = {
  expiresAt: string;
  itinerary: PlanmeItinerary;
  revision: number;
  routeFinalized: boolean;
  savedAt: string;
  version: 1 | 2;
};

export type SavePreviewItineraryResult = {
  expiresAt: string;
  itineraryId: string;
  revision: number;
};

interface PreviewItineraryStore {
  acquireLock(id: string, owner: string, ttlSeconds: number): Promise<boolean>;
  consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean>;
  getRecord(id: string): Promise<PreviewItineraryRecord | null>;
  releaseLock(id: string, owner: string): Promise<void>;
  saveDraft(itinerary: PlanmeItinerary, ttlSeconds: number): Promise<SavePreviewItineraryResult>;
  saveFinalized(
    itinerary: PlanmeItinerary,
    ttlSeconds: number,
    expectedRevision: number,
  ): Promise<SavePreviewItineraryResult | null>;
}

const PREVIEW_STORE_KEY_PREFIX = "planme:preview";
const PREVIEW_LOCK_KEY_PREFIX = "planme:preview-lock";
const PREVIEW_RATE_KEY_PREFIX = "planme:preview-rate";
const DEFAULT_PREVIEW_TTL_SECONDS = 60 * 60 * 24 * 7;
const memoryPreviewStore = new Map<string, StoredPreviewItinerary>();
const memoryPreviewLocks = new Map<string, { expiresAt: number; owner: string }>();
const memoryRateLimits = new Map<string, { count: number; expiresAt: number }>();
let cachedPreviewItineraryStore: PreviewItineraryStore | null = null;
let warnedMissingUpstashEnv = false;

/** Finds a PlanME itinerary, preferring persisted GPT data before deterministic fallbacks. */
export async function findPlanmeItineraryForDetailPage(id: string): Promise<PlanmeItinerary | null> {
  const itineraryId = normalizeItineraryId(id);
  const storedItinerary = await getPreviewItineraryById(itineraryId);

  if (storedItinerary) {
    return storedItinerary;
  }

  if (isGeneratedItineraryId(itineraryId)) {
    return null;
  }

  return getPlanmeItineraryById(itineraryId);
}

/** Saves a version 1 draft for backward-compatible tests and legacy handoff data. */
export async function savePreviewItinerary(
  itinerary: PlanmeItinerary,
): Promise<SavePreviewItineraryResult> {
  const ttlSeconds = getPreviewTtlSeconds();

  try {
    return await getPreviewItineraryStore().saveDraft(itinerary, ttlSeconds);
  } catch (error) {
    const safeError = error instanceof Error ? error : new Error("unknown error");

    return handleLocalSaveFallback(safeError, (store) =>
      store.saveDraft(itinerary, ttlSeconds),
    );
  }
}

/** Atomically writes a fully finalized version 2 itinerary when the base revision still matches. */
export async function saveFinalizedPreviewItinerary(
  itinerary: PlanmeItinerary,
  expectedRevision: number,
): Promise<SavePreviewItineraryResult | null> {
  const ttlSeconds = await getRemainingPreviewTtlSeconds(itinerary.id);

  try {
    return await getPreviewItineraryStore().saveFinalized(
      itinerary,
      ttlSeconds,
      expectedRevision,
    );
  } catch (error) {
    const safeError = error instanceof Error ? error : new Error("unknown error");

    return handleLocalSaveFallback(safeError, (store) =>
      store.saveFinalized(itinerary, ttlSeconds, expectedRevision),
    );
  }
}

/** Reads a saved itinerary record including its storage version and revision. */
export async function getPreviewItineraryRecordById(
  id: string,
): Promise<PreviewItineraryRecord | null> {
  try {
    return await getPreviewItineraryStore().getRecord(normalizeItineraryId(id));
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : "unknown error";

    console.error("PlanME preview store lookup failed", safeMessage);
    return null;
  }
}

/** Reads only the itinerary payload for existing callers. */
export async function getPreviewItineraryById(id: string): Promise<PlanmeItinerary | null> {
  const record = await getPreviewItineraryRecordById(id);

  return record?.itinerary ?? null;
}

/** Acquires an itinerary-scoped calculation lock with an automatic expiry. */
export async function acquirePreviewItineraryLock(
  id: string,
  owner: string,
  ttlSeconds = 45,
) {
  return getPreviewItineraryStore().acquireLock(normalizeItineraryId(id), owner, ttlSeconds);
}

/** Releases a calculation lock only when it is still owned by the same request. */
export async function releasePreviewItineraryLock(id: string, owner: string) {
  try {
    await getPreviewItineraryStore().releaseLock(normalizeItineraryId(id), owner);
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : "unknown error";

    // A failed release must not replace an already-saved success response; the lock has an expiry.
    console.error("PlanME preview lock release failed", safeMessage);
  }
}

/** Applies a fixed-window limit to public legacy and editing finalization requests. */
export async function consumePreviewFinalizationRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
) {
  return getPreviewItineraryStore().consumeRateLimit(
    `preview-finalization:${key}`,
    limit,
    windowSeconds,
  );
}

/** Provides the active store while keeping Redis-specific behavior behind one boundary. */
function getPreviewItineraryStore(): PreviewItineraryStore {
  if (cachedPreviewItineraryStore) {
    return cachedPreviewItineraryStore;
  }

  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (upstashUrl && upstashToken) {
    cachedPreviewItineraryStore = new UpstashPreviewItineraryStore(upstashUrl, upstashToken);
    return cachedPreviewItineraryStore;
  }

  if (isProductionRuntime()) {
    if (!warnedMissingUpstashEnv) {
      console.error("PlanME preview store requires Upstash env vars in production.");
      warnedMissingUpstashEnv = true;
    }

    throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required.");
  }

  if (!warnedMissingUpstashEnv) {
    console.warn("PlanME preview store is using local memory because Upstash env vars are missing.");
    warnedMissingUpstashEnv = true;
  }

  cachedPreviewItineraryStore = new MemoryPreviewItineraryStore();
  return cachedPreviewItineraryStore;
}

class UpstashPreviewItineraryStore implements PreviewItineraryStore {
  private readonly redis: Redis;

  /** Creates a REST Redis-backed preview itinerary store. */
  constructor(url: string, token: string) {
    this.redis = new Redis({ token, url });
  }

  /** Reads and validates either storage version. */
  async getRecord(id: string) {
    const rawPayload = await this.redis.get<StoredPreviewItinerary | string>(
      createPreviewStoreKey(id),
    );

    return parseStoredPreviewItinerary(rawPayload);
  }

  /** Saves a legacy draft using the existing seven-day expiry contract. */
  async saveDraft(itinerary: PlanmeItinerary, ttlSeconds: number) {
    const payload = createStoredPreviewItineraryV1(itinerary, ttlSeconds);

    await this.redis.set(createPreviewStoreKey(itinerary.id), JSON.stringify(payload), {
      ex: ttlSeconds,
    });

    return {
      expiresAt: payload.expiresAt,
      itineraryId: itinerary.id,
      revision: 0,
    };
  }

  /** Compares the stored revision and writes version 2 in one Redis Lua operation. */
  async saveFinalized(
    itinerary: PlanmeItinerary,
    ttlSeconds: number,
    expectedRevision: number,
  ) {
    const payload = createStoredPreviewItineraryV2(
      itinerary,
      ttlSeconds,
      expectedRevision + 1,
    );
    const result = (await this.redis.eval(
      `
        local current = redis.call("GET", KEYS[1])
        local actualRevision = 0
        if current then
          local decoded = cjson.decode(current)
          actualRevision = tonumber(decoded.revision) or 0
        end
        if actualRevision ~= tonumber(ARGV[1]) then
          return 0
        end
        redis.call("SET", KEYS[1], ARGV[2], "EX", ARGV[3])
        return 1
      `,
      [createPreviewStoreKey(itinerary.id)],
      [expectedRevision, JSON.stringify(payload), ttlSeconds],
    )) as number;

    return result === 1
      ? {
          expiresAt: payload.expiresAt,
          itineraryId: itinerary.id,
          revision: payload.revision,
        }
      : null;
  }

  /** Acquires a Redis calculation lock with SET NX EX. */
  async acquireLock(id: string, owner: string, ttlSeconds: number) {
    const result = await this.redis.set(createPreviewLockKey(id), owner, {
      ex: ttlSeconds,
      nx: true,
    });

    return result === "OK";
  }

  /** Deletes a Redis lock only if the request still owns it. */
  async releaseLock(id: string, owner: string) {
    await this.redis.eval(
      `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        end
        return 0
      `,
      [createPreviewLockKey(id)],
      [owner],
    );
  }

  /** Counts requests in a Redis-backed fixed window shared by Vercel instances. */
  async consumeRateLimit(key: string, limit: number, windowSeconds: number) {
    const redisKey = createPreviewRateKey(key);
    const count = (await this.redis.eval(
      `
        local current = redis.call("INCR", KEYS[1])
        if current == 1 then
          redis.call("EXPIRE", KEYS[1], ARGV[1])
        end
        return current
      `,
      [redisKey],
      [windowSeconds],
    )) as number;

    return count <= limit;
  }
}

class MemoryPreviewItineraryStore implements PreviewItineraryStore {
  /** Reads a non-expired local preview record. */
  async getRecord(id: string) {
    const payload = memoryPreviewStore.get(id);

    if (!payload || isExpired(payload.expiresAt)) {
      memoryPreviewStore.delete(id);
      return null;
    }

    return toPreviewItineraryRecord(payload);
  }

  /** Saves a local version 1 draft for tests. */
  async saveDraft(itinerary: PlanmeItinerary, ttlSeconds: number) {
    const payload = createStoredPreviewItineraryV1(itinerary, ttlSeconds);

    memoryPreviewStore.set(itinerary.id, payload);
    return {
      expiresAt: payload.expiresAt,
      itineraryId: itinerary.id,
      revision: 0,
    };
  }

  /** Performs the same revision compare-and-save contract in local memory. */
  async saveFinalized(
    itinerary: PlanmeItinerary,
    ttlSeconds: number,
    expectedRevision: number,
  ) {
    const current = memoryPreviewStore.get(itinerary.id);
    const actualRevision = current?.version === 2 ? current.revision : 0;

    if (actualRevision !== expectedRevision) {
      return null;
    }

    const payload = createStoredPreviewItineraryV2(
      itinerary,
      ttlSeconds,
      expectedRevision + 1,
    );

    memoryPreviewStore.set(itinerary.id, payload);
    return {
      expiresAt: payload.expiresAt,
      itineraryId: itinerary.id,
      revision: payload.revision,
    };
  }

  /** Acquires a process-local lock for local tests. */
  async acquireLock(id: string, owner: string, ttlSeconds: number) {
    const current = memoryPreviewLocks.get(id);

    if (current && current.expiresAt > Date.now()) {
      return false;
    }

    memoryPreviewLocks.set(id, {
      expiresAt: Date.now() + ttlSeconds * 1000,
      owner,
    });
    return true;
  }

  /** Releases a process-local lock only for its owner. */
  async releaseLock(id: string, owner: string) {
    if (memoryPreviewLocks.get(id)?.owner === owner) {
      memoryPreviewLocks.delete(id);
    }
  }

  /** Applies the same fixed-window request limit in local development. */
  async consumeRateLimit(key: string, limit: number, windowSeconds: number) {
    const current = memoryRateLimits.get(key);

    if (!current || current.expiresAt <= Date.now()) {
      memoryRateLimits.set(key, {
        count: 1,
        expiresAt: Date.now() + windowSeconds * 1000,
      });
      return true;
    }

    current.count += 1;
    return current.count <= limit;
  }
}

/** Uses memory only outside production when Redis storage fails. */
async function handleLocalSaveFallback<T>(
  error: Error | object | string,
  operation: (store: MemoryPreviewItineraryStore) => Promise<T>,
) {
  const safeMessage = error instanceof Error ? error.message : "unknown error";

  if (isProductionRuntime()) {
    throw new Error(`PlanME preview store save failed: ${safeMessage}`);
  }

  console.error("PlanME preview store save failed", safeMessage);
  return operation(new MemoryPreviewItineraryStore());
}

/** Creates a namespaced Redis key for one preview itinerary. */
function createPreviewStoreKey(id: string) {
  return `${PREVIEW_STORE_KEY_PREFIX}:${id}`;
}

/** Creates a namespaced Redis key for one calculation lock. */
function createPreviewLockKey(id: string) {
  return `${PREVIEW_LOCK_KEY_PREFIX}:${id}`;
}

/** Creates a namespaced Redis key for one public request window. */
function createPreviewRateKey(key: string) {
  return `${PREVIEW_RATE_KEY_PREFIX}:${key}`;
}

/** Builds a version 1 payload for backward-compatible draft tests. */
function createStoredPreviewItineraryV1(
  itinerary: PlanmeItinerary,
  ttlSeconds: number,
): StoredPreviewItineraryV1 {
  const savedAt = new Date();

  return {
    version: 1,
    itinerary,
    savedAt: savedAt.toISOString(),
    expiresAt: new Date(savedAt.getTime() + ttlSeconds * 1000).toISOString(),
  };
}

/** Builds the completed version 2 payload stored only after every route succeeds. */
function createStoredPreviewItineraryV2(
  itinerary: PlanmeItinerary,
  ttlSeconds: number,
  revision: number,
): StoredPreviewItineraryV2 {
  const savedAt = new Date();

  return {
    version: 2,
    revision,
    itinerary,
    routeCalculation: {
      status: "completed",
      calculatedAt: savedAt.toISOString(),
      transportMode: itinerary.transportMode,
    },
    savedAt: savedAt.toISOString(),
    expiresAt: new Date(savedAt.getTime() + ttlSeconds * 1000).toISOString(),
  };
}

/** Parses a stored payload while retaining version 1 read compatibility. */
function parseStoredPreviewItinerary(rawPayload: unknown): PreviewItineraryRecord | null {
  if (!rawPayload) {
    return null;
  }

  try {
    const payload =
      typeof rawPayload === "string"
        ? (JSON.parse(rawPayload) as Partial<StoredPreviewItinerary>)
        : (rawPayload as Partial<StoredPreviewItinerary>);

    if (!payload.itinerary?.id || !payload.expiresAt || isExpired(payload.expiresAt)) {
      return null;
    }

    return toPreviewItineraryRecord(payload as StoredPreviewItinerary);
  } catch {
    return null;
  }
}

/** Converts either storage version to the app-facing record contract. */
function toPreviewItineraryRecord(payload: StoredPreviewItinerary): PreviewItineraryRecord {
  return {
    expiresAt: payload.expiresAt,
    itinerary: payload.itinerary,
    revision: payload.version === 2 ? payload.revision : 0,
    routeFinalized: payload.version === 2 && payload.routeCalculation.status === "completed",
    savedAt: payload.savedAt,
    version: payload.version,
  };
}

/** Preserves an existing record's expiry while keeping the seven-day maximum. */
async function getRemainingPreviewTtlSeconds(id: string) {
  const record = await getPreviewItineraryRecordById(id);
  const configuredTtl = getPreviewTtlSeconds();

  if (!record) {
    return configuredTtl;
  }

  const remainingSeconds = Math.max(1, Math.floor((Date.parse(record.expiresAt) - Date.now()) / 1000));

  return Math.min(configuredTtl, remainingSeconds);
}

/** Reads the preview TTL policy in seconds. */
function getPreviewTtlSeconds() {
  const configuredTtl = Number(process.env.PLANME_PREVIEW_TTL_SECONDS);

  return Number.isInteger(configuredTtl) && configuredTtl > 0
    ? configuredTtl
    : DEFAULT_PREVIEW_TTL_SECONDS;
}

/** Decodes URL parameters while preserving malformed ids for normal lookup failure. */
function normalizeItineraryId(id: string) {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

/** Identifies generated ids that must be present in the preview store. */
function isGeneratedItineraryId(id: string) {
  return id.startsWith("generated-");
}

/** Restricts unsafe memory fallback to local development and tests. */
function isProductionRuntime() {
  return process.env.NODE_ENV === "production";
}

/** Checks the app-level expiry shared by Redis and local memory. */
function isExpired(expiresAt: string) {
  return Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now();
}
