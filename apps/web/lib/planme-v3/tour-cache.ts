import { Redis } from "@upstash/redis";
import type {
  AllowedTourContentTypeId,
  TourPlaceSnapshot,
} from "@planme/core";

export type TourCacheScope = {
  regionCode: string;
  districtCode: string | null;
  contentTypeId: AllowedTourContentTypeId;
};

export type TourCacheReadResult =
  | { status: "hit"; places: TourPlaceSnapshot[] }
  | { status: "miss" };

export type TourCacheWriteResult = {
  freshStored: boolean;
  lastGoodStored: boolean;
};

export interface PlanmeV3TourCache {
  readFresh(scope: TourCacheScope): Promise<TourCacheReadResult>;
  readLastGood(scope: TourCacheScope): Promise<TourCacheReadResult>;
  saveSuccessfulResponse(
    scope: TourCacheScope,
    places: TourPlaceSnapshot[],
  ): Promise<TourCacheWriteResult>;
}

export type TourCandidateLoadResult =
  | {
      status: "available";
      source: "fresh-cache" | "tourapi" | "last-good";
      places: TourPlaceSnapshot[];
      cacheWrite?: TourCacheWriteResult;
    }
  | { status: "unavailable" };

const FRESH_TTL_MS = 24 * 60 * 60 * 1_000;
const LAST_GOOD_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const V3_TOUR_PREFIX = "planme:v3:tour";

export function createMemoryPlanmeV3TourCache(options: {
  now?: () => number;
} = {}): PlanmeV3TourCache {
  return new MemoryPlanmeV3TourCache(options.now);
}

export function createUpstashPlanmeV3TourCache(input: {
  url: string;
  token: string;
}): PlanmeV3TourCache {
  return new UpstashPlanmeV3TourCache(input.url, input.token);
}

export async function loadTourCandidates(input: {
  cache: PlanmeV3TourCache;
  scope: TourCacheScope;
  fetchFromTourApi: () => Promise<
    | { status: "success"; places: TourPlaceSnapshot[] }
    | { status: "failure" }
  >;
}): Promise<TourCandidateLoadResult> {
  const fresh = await input.cache.readFresh(input.scope);
  if (fresh.status === "hit") {
    return { status: "available", source: "fresh-cache", places: fresh.places };
  }

  const response = await input.fetchFromTourApi();
  if (response.status === "success") {
    const places = withCacheStatus(response.places, "fresh");
    const cacheWrite = await input.cache.saveSuccessfulResponse(
      input.scope,
      places,
    );
    return { status: "available", source: "tourapi", places, cacheWrite };
  }

  const lastGood = await input.cache.readLastGood(input.scope);
  if (lastGood.status === "hit") {
    return {
      status: "available",
      source: "last-good",
      places: lastGood.places,
    };
  }
  return { status: "unavailable" };
}

class MemoryPlanmeV3TourCache implements PlanmeV3TourCache {
  private readonly values = new Map<
    string,
    { places: TourPlaceSnapshot[]; expiresAtMs: number }
  >();
  private readonly now: () => number;

  constructor(now = Date.now) {
    this.now = now;
  }

  async readFresh(scope: TourCacheScope): Promise<TourCacheReadResult> {
    return this.read(cacheKey(scope, "fresh"), "fresh");
  }

  async readLastGood(scope: TourCacheScope): Promise<TourCacheReadResult> {
    return this.read(cacheKey(scope, "last-good"), "stale");
  }

  async saveSuccessfulResponse(
    scope: TourCacheScope,
    places: TourPlaceSnapshot[],
  ): Promise<TourCacheWriteResult> {
    assertScopeMatchesPlaces(scope, places);
    const freshPlaces = withCacheStatus(places, "fresh");
    const now = this.now();
    this.values.set(cacheKey(scope, "fresh"), {
      places: clone(freshPlaces),
      expiresAtMs: now + FRESH_TTL_MS,
    });
    this.values.set(cacheKey(scope, "last-good"), {
      places: clone(freshPlaces),
      expiresAtMs: now + LAST_GOOD_TTL_MS,
    });
    return { freshStored: true, lastGoodStored: true };
  }

  private read(
    key: string,
    cacheStatus: "fresh" | "stale",
  ): TourCacheReadResult {
    const value = this.values.get(key);
    if (!value || value.expiresAtMs <= this.now()) {
      this.values.delete(key);
      return { status: "miss" };
    }
    return {
      status: "hit",
      places: withCacheStatus(clone(value.places), cacheStatus),
    };
  }
}

class UpstashPlanmeV3TourCache implements PlanmeV3TourCache {
  private readonly redis: Redis;

  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token });
  }

  async readFresh(scope: TourCacheScope): Promise<TourCacheReadResult> {
    return this.read(cacheKey(scope, "fresh"), "fresh");
  }

  async readLastGood(scope: TourCacheScope): Promise<TourCacheReadResult> {
    return this.read(cacheKey(scope, "last-good"), "stale");
  }

  async saveSuccessfulResponse(
    scope: TourCacheScope,
    places: TourPlaceSnapshot[],
  ): Promise<TourCacheWriteResult> {
    assertScopeMatchesPlaces(scope, places);
    const serialized = JSON.stringify(withCacheStatus(places, "fresh"));
    let freshStored = false;
    let lastGoodStored = false;

    try {
      await this.redis.set(cacheKey(scope, "fresh"), serialized, {
        ex: FRESH_TTL_MS / 1_000,
      });
      freshStored = true;
    } catch {
      freshStored = false;
    }

    try {
      await this.redis.set(cacheKey(scope, "last-good"), serialized, {
        ex: LAST_GOOD_TTL_MS / 1_000,
      });
      lastGoodStored = true;
    } catch {
      lastGoodStored = false;
    }

    return { freshStored, lastGoodStored };
  }

  private async read(
    key: string,
    cacheStatus: "fresh" | "stale",
  ): Promise<TourCacheReadResult> {
    const value = await this.redis.get<TourPlaceSnapshot[] | string>(key);
    if (value === null) {
      return { status: "miss" };
    }
    const places = typeof value === "string"
      ? (JSON.parse(value) as TourPlaceSnapshot[])
      : value;
    return { status: "hit", places: withCacheStatus(places, cacheStatus) };
  }
}

function assertScopeMatchesPlaces(
  scope: TourCacheScope,
  places: TourPlaceSnapshot[],
) {
  assertCacheSegment(scope.regionCode, "regionCode");
  if (scope.districtCode !== null) {
    assertCacheSegment(scope.districtCode, "districtCode");
  }
  if (places.some((place) => place.contentTypeId !== scope.contentTypeId)) {
    throw new Error("TourAPI 캐시 유형과 장소 유형이 일치하지 않습니다.");
  }
}

function assertCacheSegment(value: string, field: string) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`TourAPI 캐시 ${field}는 숫자 코드여야 합니다.`);
  }
}

function cacheKey(
  scope: TourCacheScope,
  tier: "fresh" | "last-good",
) {
  assertCacheSegment(scope.regionCode, "regionCode");
  if (scope.districtCode !== null) {
    assertCacheSegment(scope.districtCode, "districtCode");
  }
  const districtCode = scope.districtCode ?? "all";
  return `${V3_TOUR_PREFIX}:${scope.regionCode}:${districtCode}:${scope.contentTypeId}:${tier}`;
}

function withCacheStatus(
  places: TourPlaceSnapshot[],
  cacheStatus: "fresh" | "stale",
) {
  return places.map((place) => ({ ...place, cacheStatus }));
}

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}
