import { Redis } from "@upstash/redis";
import {
  getPlanmeItineraryById,
  type PlanmeItinerary,
} from "@planme/core";

type StoredPreviewItinerary = {
  version: 1;
  itinerary: PlanmeItinerary;
  savedAt: string;
  expiresAt: string;
};

type SavePreviewItineraryResult = {
  expiresAt: string;
  itineraryId: string;
};

interface PreviewItineraryStore {
  get(id: string): Promise<PlanmeItinerary | null>;
  save(itinerary: PlanmeItinerary, ttlSeconds: number): Promise<SavePreviewItineraryResult>;
}

const PREVIEW_STORE_KEY_PREFIX = "planme:preview";
const DEFAULT_PREVIEW_TTL_SECONDS = 60 * 60 * 24 * 7;
const memoryPreviewStore = new Map<string, StoredPreviewItinerary>();
let cachedPreviewItineraryStore: PreviewItineraryStore | null = null;
let warnedMissingUpstashEnv = false;

/**
 * Finds a PlanME itinerary, preferring persisted GPT draft data before deterministic fallbacks.
 */
export async function findPlanmeItineraryForDetailPage(id: string): Promise<PlanmeItinerary | null> {
  const itineraryId = normalizeItineraryId(id);
  const storedItinerary = await getPreviewItineraryById(itineraryId);

  if (storedItinerary) {
    return storedItinerary;
  }

  return getPlanmeItineraryById(itineraryId);
}

/**
 * Saves a GPT-authored itinerary payload for short generated detail URLs.
 */
export async function savePreviewItinerary(
  itinerary: PlanmeItinerary,
): Promise<SavePreviewItineraryResult> {
  const ttlSeconds = getPreviewTtlSeconds();

  try {
    return await getPreviewItineraryStore().save(itinerary, ttlSeconds);
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : "unknown error";

    // Saving should not block GPT responses; detail pages can still fall back deterministically.
    console.error("PlanME preview store save failed", safeMessage);

    return new MemoryPreviewItineraryStore().save(itinerary, ttlSeconds);
  }
}

/**
 * Reads a saved GPT-authored itinerary payload by generated detail id.
 */
export async function getPreviewItineraryById(id: string): Promise<PlanmeItinerary | null> {
  try {
    return await getPreviewItineraryStore().get(normalizeItineraryId(id));
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : "unknown error";

    // Lookup failures should degrade to existing generated-id fallback behavior.
    console.error("PlanME preview store lookup failed", safeMessage);
    return null;
  }
}

/**
 * Provides the active preview store while keeping SDK-specific code behind one boundary.
 */
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

  if (process.env.NODE_ENV === "production" && !warnedMissingUpstashEnv) {
    // Production should normally use Upstash; the fallback keeps demo links from hard failing.
    console.warn("PlanME preview store is using memory because Upstash env vars are missing.");
    warnedMissingUpstashEnv = true;
  }

  cachedPreviewItineraryStore = new MemoryPreviewItineraryStore();
  return cachedPreviewItineraryStore;
}

class UpstashPreviewItineraryStore implements PreviewItineraryStore {
  private readonly redis: Redis;

  /**
   * Creates a REST Redis-backed preview itinerary store.
   */
  constructor(url: string, token: string) {
    this.redis = new Redis({ token, url });
  }

  /**
   * Reads and validates a persisted preview itinerary payload.
   */
  async get(id: string): Promise<PlanmeItinerary | null> {
    const rawPayload = await this.redis.get<StoredPreviewItinerary | string>(
      createPreviewStoreKey(id),
    );

    return parseStoredPreviewItinerary(rawPayload);
  }

  /**
   * Saves a preview itinerary with an explicit TTL so demo payloads expire automatically.
   */
  async save(
    itinerary: PlanmeItinerary,
    ttlSeconds: number,
  ): Promise<SavePreviewItineraryResult> {
    const payload = createStoredPreviewItinerary(itinerary, ttlSeconds);

    // Upstash REST Redis receives a string payload so JSON parsing stays under our control.
    await this.redis.set(createPreviewStoreKey(itinerary.id), JSON.stringify(payload), {
      ex: ttlSeconds,
    });

    return {
      expiresAt: payload.expiresAt,
      itineraryId: itinerary.id,
    };
  }
}

class MemoryPreviewItineraryStore implements PreviewItineraryStore {
  /**
   * Reads a non-expired preview itinerary from the local process fallback store.
   */
  async get(id: string): Promise<PlanmeItinerary | null> {
    const payload = memoryPreviewStore.get(id);

    if (!payload || isExpired(payload.expiresAt)) {
      memoryPreviewStore.delete(id);
      return null;
    }

    return payload.itinerary;
  }

  /**
   * Saves a preview itinerary in memory for local development and contract tests.
   */
  async save(
    itinerary: PlanmeItinerary,
    ttlSeconds: number,
  ): Promise<SavePreviewItineraryResult> {
    const payload = createStoredPreviewItinerary(itinerary, ttlSeconds);

    // The fallback is process-local only; Upstash is required for cross-request Vercel handoff.
    memoryPreviewStore.set(itinerary.id, payload);

    return {
      expiresAt: payload.expiresAt,
      itineraryId: itinerary.id,
    };
  }
}

/**
 * Creates a namespaced Redis key to avoid mixing PlanME previews with other app data.
 */
function createPreviewStoreKey(id: string) {
  return `${PREVIEW_STORE_KEY_PREFIX}:${id}`;
}

/**
 * Builds the stored payload with an app-level expiry timestamp for non-Redis stores.
 */
function createStoredPreviewItinerary(
  itinerary: PlanmeItinerary,
  ttlSeconds: number,
): StoredPreviewItinerary {
  const savedAt = new Date();
  const expiresAt = new Date(savedAt.getTime() + ttlSeconds * 1000);

  return {
    version: 1,
    itinerary,
    savedAt: savedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Parses a stored payload without leaking malformed data into the detail page.
 */
function parseStoredPreviewItinerary(rawPayload: unknown): PlanmeItinerary | null {
  if (!rawPayload) {
    return null;
  }

  try {
    // Upstash may return JSON-looking strings as parsed objects; local fallbacks keep objects too.
    const payload =
      typeof rawPayload === "string"
        ? (JSON.parse(rawPayload) as Partial<StoredPreviewItinerary>)
        : (rawPayload as Partial<StoredPreviewItinerary>);

    if (!payload.itinerary?.id || !payload.expiresAt || isExpired(payload.expiresAt)) {
      return null;
    }

    return payload.itinerary;
  } catch {
    // Malformed store data should fall back to deterministic itinerary generation.
    return null;
  }
}

/**
 * Reads the preview TTL policy in seconds, defaulting to seven days for demo links.
 */
function getPreviewTtlSeconds() {
  const configuredTtl = Number(process.env.PLANME_PREVIEW_TTL_SECONDS);

  if (Number.isInteger(configuredTtl) && configuredTtl > 0) {
    return configuredTtl;
  }

  return DEFAULT_PREVIEW_TTL_SECONDS;
}

/**
 * Decodes URL params while keeping malformed ids on the normal fallback path.
 */
function normalizeItineraryId(id: string) {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

/**
 * Checks app-level expiry so Redis and future stores share the same semantics.
 */
function isExpired(expiresAt: string) {
  return Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now();
}
