import { Redis } from "@upstash/redis";
import type {
  ItineraryRevision,
  JsonValue,
} from "@planme/core";

export type ItineraryPhase =
  | "queued"
  | "resolving_anchors"
  | "collecting_candidates"
  | "arranging"
  | "scheduling"
  | "routing"
  | "activating"
  | "ready"
  | "failed";

export type ItineraryJobMeta = {
  schemaVersion: 3;
  itineraryId: string;
  kind: "generation" | "edit";
  phase: ItineraryPhase;
  activeRevision: number | null;
  pendingRevision: number | null;
  previousRevision: number | null;
  baseRevision?: number;
  routeCursor?: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  errorCode?: string;
};

export type PhaseCheckpoint = {
  schemaVersion: 3;
  phaseVersion: number;
  inputDigest: string;
  payload: JsonValue;
};

type IdempotencyRecord = {
  itineraryId: string;
  inputDigest: string;
};

export type CreateGenerationResult =
  | { status: "created" | "replayed"; itineraryId: string; meta: ItineraryJobMeta }
  | { status: "conflict" };

export type StartEditResult =
  | { status: "created"; meta: ItineraryJobMeta }
  | { status: "not_found" | "revision_conflict" | "edit_already_running" };

export type ItineraryJobSnapshot = {
  meta: ItineraryJobMeta;
  activeRevision: ItineraryRevision | null;
};

export type SavePhaseCommand = {
  itineraryId: string;
  revision: number;
  expectedPhase: ItineraryPhase;
  nextPhase: ItineraryPhase;
  checkpoint: PhaseCheckpoint;
  routeCursor?: number;
  lockOwner?: string;
};

export interface PlanmeV3JobStore {
  createGeneration(input: {
    idempotencyKey: string;
    inputDigest: string;
  }): Promise<CreateGenerationResult>;
  startEdit(input: {
    itineraryId: string;
    baseRevision: number;
  }): Promise<StartEditResult>;
  acquirePhaseLock(
    itineraryId: string,
    revision: number,
    owner: string,
  ): Promise<boolean>;
  releasePhaseLock(
    itineraryId: string,
    revision: number,
    owner: string,
  ): Promise<void>;
  savePhase(command: SavePhaseCommand): Promise<boolean>;
  getCheckpoint(
    itineraryId: string,
    revision: number,
    phase: ItineraryPhase,
  ): Promise<PhaseCheckpoint | null>;
  activate(input: {
    itineraryId: string;
    revision: ItineraryRevision;
    lockOwner?: string;
  }): Promise<boolean>;
  fail(input: { itineraryId: string; errorCode: string }): Promise<boolean>;
  getJob(itineraryId: string): Promise<ItineraryJobSnapshot | null>;
  getRevision(
    itineraryId: string,
    revision: number,
  ): Promise<ItineraryRevision | null>;
}

const JOB_TTL_SECONDS = 60 * 60 * 24 * 7;
const IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 24;
const PHASE_LOCK_TTL_SECONDS = 45;
const V3_PREFIX = "planme:v3";

export function createMemoryPlanmeV3JobStore(options: {
  now?: () => number;
  createId?: () => string;
} = {}): PlanmeV3JobStore {
  return new MemoryPlanmeV3JobStore(options.now, options.createId);
}

export function createUpstashPlanmeV3JobStore(input: {
  url: string;
  token: string;
  now?: () => number;
  createId?: () => string;
}): PlanmeV3JobStore {
  return new UpstashPlanmeV3JobStore(input.url, input.token, input.now, input.createId);
}

class MemoryPlanmeV3JobStore implements PlanmeV3JobStore {
  private readonly metas = new Map<string, ItineraryJobMeta>();
  private readonly revisions = new Map<string, ItineraryRevision>();
  private readonly checkpoints = new Map<string, PhaseCheckpoint>();
  private readonly idempotency = new Map<
    string,
    { record: IdempotencyRecord; expiresAtMs: number }
  >();
  private readonly locks = new Map<string, { owner: string; expiresAtMs: number }>();
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(now = Date.now, createId = createItineraryId) {
    this.now = now;
    this.createId = createId;
  }

  async createGeneration(input: {
    idempotencyKey: string;
    inputDigest: string;
  }): Promise<CreateGenerationResult> {
    this.cleanup();
    const keyDigest = await digestKey(input.idempotencyKey);
    const existing = this.idempotency.get(keyDigest);

    if (existing) {
      if (existing.record.inputDigest !== input.inputDigest) {
        return { status: "conflict" };
      }

      const meta = this.metas.get(existing.record.itineraryId);
      if (meta) {
        return {
          status: "replayed",
          itineraryId: meta.itineraryId,
          meta: clone(meta),
        };
      }
    }

    const itineraryId = this.createId();
    const meta = createGenerationMeta(itineraryId, this.now());
    this.metas.set(itineraryId, meta);
    this.idempotency.set(keyDigest, {
      record: { itineraryId, inputDigest: input.inputDigest },
      expiresAtMs: this.now() + IDEMPOTENCY_TTL_SECONDS * 1_000,
    });

    return { status: "created", itineraryId, meta: clone(meta) };
  }

  async startEdit(input: {
    itineraryId: string;
    baseRevision: number;
  }): Promise<StartEditResult> {
    this.cleanup();
    const meta = this.metas.get(input.itineraryId);
    if (!meta || meta.activeRevision === null) {
      return { status: "not_found" };
    }
    if (meta.pendingRevision !== null) {
      return { status: "edit_already_running" };
    }
    if (meta.activeRevision !== input.baseRevision) {
      return { status: "revision_conflict" };
    }

    const updated: ItineraryJobMeta = {
      ...meta,
      kind: "edit",
      phase: "queued",
      baseRevision: input.baseRevision,
      pendingRevision: input.baseRevision + 1,
      updatedAt: new Date(this.now()).toISOString(),
    };
    delete updated.errorCode;
    delete updated.routeCursor;
    this.metas.set(input.itineraryId, updated);
    return { status: "created", meta: clone(updated) };
  }

  async acquirePhaseLock(
    itineraryId: string,
    revision: number,
    owner: string,
  ) {
    this.cleanup();
    const key = lockKey(itineraryId, revision);
    if (this.locks.has(key)) {
      return false;
    }
    this.locks.set(key, {
      owner,
      expiresAtMs: this.now() + PHASE_LOCK_TTL_SECONDS * 1_000,
    });
    return true;
  }

  async releasePhaseLock(
    itineraryId: string,
    revision: number,
    owner: string,
  ) {
    const key = lockKey(itineraryId, revision);
    if (this.locks.get(key)?.owner === owner) {
      this.locks.delete(key);
    }
  }

  async savePhase(command: SavePhaseCommand) {
    this.cleanup();
    const meta = this.metas.get(command.itineraryId);
    if (
      !meta ||
      meta.phase !== command.expectedPhase ||
      meta.pendingRevision !== command.revision ||
      (command.lockOwner !== undefined &&
        this.locks.get(lockKey(command.itineraryId, command.revision))?.owner !==
          command.lockOwner)
    ) {
      return false;
    }

    this.checkpoints.set(
      checkpointKey(
        command.itineraryId,
        command.revision,
        command.expectedPhase,
      ),
      clone(command.checkpoint),
    );
    this.metas.set(command.itineraryId, {
      ...meta,
      phase: command.nextPhase,
      routeCursor: command.routeCursor,
      updatedAt: new Date(this.now()).toISOString(),
    });
    return true;
  }

  async getCheckpoint(
    itineraryId: string,
    revision: number,
    phase: ItineraryPhase,
  ) {
    this.cleanup();
    const value = this.checkpoints.get(checkpointKey(itineraryId, revision, phase));
    return value ? clone(value) : null;
  }

  async activate(input: {
    itineraryId: string;
    revision: ItineraryRevision;
    lockOwner?: string;
  }) {
    this.cleanup();
    const meta = this.metas.get(input.itineraryId);
    if (
      !meta ||
      meta.phase !== "activating" ||
      meta.pendingRevision !== input.revision.revision ||
      (meta.kind === "edit" && meta.activeRevision !== meta.baseRevision) ||
      input.revision.itineraryId !== input.itineraryId ||
      (input.lockOwner !== undefined &&
        this.locks.get(
          lockKey(input.itineraryId, input.revision.revision),
        )?.owner !== input.lockOwner) ||
      !this.checkpoints.has(
        checkpointKey(input.itineraryId, input.revision.revision, "routing"),
      )
    ) {
      return false;
    }

    this.revisions.set(
      revisionKey(input.itineraryId, input.revision.revision),
      clone(input.revision),
    );
    const updated: ItineraryJobMeta = {
      ...meta,
      phase: "ready",
      previousRevision: meta.activeRevision,
      activeRevision: input.revision.revision,
      pendingRevision: null,
      updatedAt: new Date(this.now()).toISOString(),
    };
    delete updated.errorCode;
    delete updated.routeCursor;
    this.metas.set(input.itineraryId, updated);
    return true;
  }

  async fail(input: { itineraryId: string; errorCode: string }) {
    this.cleanup();
    const meta = this.metas.get(input.itineraryId);
    if (!meta || meta.phase === "ready" || meta.phase === "failed") {
      return false;
    }

    this.metas.set(input.itineraryId, {
      ...meta,
      phase: "failed",
      pendingRevision: null,
      updatedAt: new Date(this.now()).toISOString(),
      errorCode: input.errorCode,
    });
    return true;
  }

  async getJob(itineraryId: string): Promise<ItineraryJobSnapshot | null> {
    this.cleanup();
    const meta = this.metas.get(itineraryId);
    if (!meta) {
      return null;
    }
    const revision =
      meta.activeRevision === null
        ? null
        : this.revisions.get(revisionKey(itineraryId, meta.activeRevision)) ?? null;
    return {
      meta: clone(meta),
      activeRevision: revision ? clone(revision) : null,
    };
  }

  async getRevision(itineraryId: string, revision: number) {
    this.cleanup();
    if (!this.metas.has(itineraryId)) {
      return null;
    }
    const value = this.revisions.get(revisionKey(itineraryId, revision));
    return value ? clone(value) : null;
  }

  private cleanup() {
    const now = this.now();
    for (const [key, value] of this.idempotency) {
      if (value.expiresAtMs <= now) {
        this.idempotency.delete(key);
      }
    }
    for (const [key, value] of this.locks) {
      if (value.expiresAtMs <= now) {
        this.locks.delete(key);
      }
    }
    for (const [id, meta] of this.metas) {
      if (Date.parse(meta.expiresAt) <= now) {
        this.metas.delete(id);
        deleteMapEntriesWithPrefix(this.revisions, revisionKeyPrefix(id));
        deleteMapEntriesWithPrefix(this.checkpoints, checkpointKeyPrefix(id));
      }
    }
  }
}

class UpstashPlanmeV3JobStore implements PlanmeV3JobStore {
  private readonly redis: Redis;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(
    url: string,
    token: string,
    now = Date.now,
    createId = createItineraryId,
  ) {
    this.redis = new Redis({ url, token });
    this.now = now;
    this.createId = createId;
  }

  async createGeneration(input: {
    idempotencyKey: string;
    inputDigest: string;
  }): Promise<CreateGenerationResult> {
    const keyDigest = await digestKey(input.idempotencyKey);
    const itineraryId = this.createId();
    const meta = createGenerationMeta(itineraryId, this.now());
    const idempotency = JSON.stringify({
      itineraryId,
      inputDigest: input.inputDigest,
    } satisfies IdempotencyRecord);
    const idempotencyExpiresAt = Math.floor(this.now() / 1_000) + IDEMPOTENCY_TTL_SECONDS;
    let result: string | null = null;

    try {
      result = (await this.redis.eval(
        `
          local current = redis.call("GET", KEYS[1])
          if current then
            local decoded = cjson.decode(current)
            if decoded.inputDigest ~= ARGV[1] then return "conflict" end
            return "replayed:" .. decoded.itineraryId
          end
          redis.call("SET", KEYS[1], ARGV[2], "EXAT", ARGV[3])
          redis.call("SET", KEYS[2], ARGV[4], "EXAT", ARGV[5])
          return "created:" .. ARGV[6]
        `,
        [idempotencyKey(keyDigest), metaKey(itineraryId)],
        [
          input.inputDigest,
          idempotency,
          idempotencyExpiresAt,
          JSON.stringify(meta),
          toExpiryEpochSeconds(meta.expiresAt),
          itineraryId,
        ],
      )) as string;
    } catch {
      await throwClassifiedUpstashFailure(this.redis);
    }

    if (result === null) {
      throw new Error("PLANME_V3_REDIS_CREATE_GENERATION_FAILED");
    }

    if (result === "conflict") {
      return { status: "conflict" };
    }

    const [status, resolvedId] = result.split(":") as ["created" | "replayed", string];
    const resolvedMeta =
      status === "created" ? meta : await this.readMeta(resolvedId);
    if (!resolvedMeta) {
      return { status: "conflict" };
    }
    return { status, itineraryId: resolvedId, meta: resolvedMeta };
  }

  async startEdit(input: {
    itineraryId: string;
    baseRevision: number;
  }): Promise<StartEditResult> {
    const current = await this.readMeta(input.itineraryId);
    if (!current) {
      return { status: "not_found" };
    }
    const updatedAt = new Date(this.now()).toISOString();
    const result = (await this.redis.eval(
      `
        local current = redis.call("GET", KEYS[1])
        if not current then return "not_found" end
        local meta = cjson.decode(current)
        if meta.activeRevision == cjson.null then return "not_found" end
        if meta.pendingRevision ~= cjson.null then return "edit_already_running" end
        if tonumber(meta.activeRevision) ~= tonumber(ARGV[1]) then return "revision_conflict" end
        meta.kind = "edit"
        meta.phase = "queued"
        meta.baseRevision = tonumber(ARGV[1])
        meta.pendingRevision = tonumber(ARGV[1]) + 1
        meta.updatedAt = ARGV[2]
        meta.errorCode = nil
        meta.routeCursor = nil
        redis.call("SET", KEYS[1], cjson.encode(meta), "EXAT", ARGV[3])
        return cjson.encode(meta)
      `,
      [metaKey(input.itineraryId)],
      [input.baseRevision, updatedAt, toExpiryEpochSeconds(current.expiresAt)],
    )) as string;

    if (
      result === "not_found" ||
      result === "revision_conflict" ||
      result === "edit_already_running"
    ) {
      return { status: result };
    }
    return { status: "created", meta: JSON.parse(result) as ItineraryJobMeta };
  }

  async acquirePhaseLock(
    itineraryId: string,
    revision: number,
    owner: string,
  ) {
    const result = await this.redis.set(lockKey(itineraryId, revision), owner, {
      ex: PHASE_LOCK_TTL_SECONDS,
      nx: true,
    });
    return result === "OK";
  }

  async releasePhaseLock(
    itineraryId: string,
    revision: number,
    owner: string,
  ) {
    await this.redis.eval(
      `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0`,
      [lockKey(itineraryId, revision)],
      [owner],
    );
  }

  async savePhase(command: SavePhaseCommand) {
    const meta = await this.readMeta(command.itineraryId);
    if (!meta) {
      return false;
    }
    const updatedAt = new Date(this.now()).toISOString();
    const result = (await this.redis.eval(
      `
        local current = redis.call("GET", KEYS[1])
        if not current then return 0 end
        local meta = cjson.decode(current)
        if meta.phase ~= ARGV[1] then return 0 end
        if tonumber(meta.pendingRevision) ~= tonumber(ARGV[2]) then return 0 end
        if ARGV[8] ~= "" and redis.call("GET", KEYS[3]) ~= ARGV[8] then return 0 end
        redis.call("SET", KEYS[2], ARGV[3], "EXAT", ARGV[4])
        meta.phase = ARGV[5]
        meta.updatedAt = ARGV[6]
        if ARGV[7] ~= "" then meta.routeCursor = tonumber(ARGV[7]) end
        redis.call("SET", KEYS[1], cjson.encode(meta), "EXAT", ARGV[4])
        return 1
      `,
      [
        metaKey(command.itineraryId),
        checkpointKey(command.itineraryId, command.revision, command.expectedPhase),
        lockKey(command.itineraryId, command.revision),
      ],
      [
        command.expectedPhase,
        command.revision,
        JSON.stringify(command.checkpoint),
        toExpiryEpochSeconds(meta.expiresAt),
        command.nextPhase,
        updatedAt,
        command.routeCursor === undefined ? "" : command.routeCursor,
        command.lockOwner ?? "",
      ],
    )) as number;
    return result === 1;
  }

  async getCheckpoint(
    itineraryId: string,
    revision: number,
    phase: ItineraryPhase,
  ) {
    const value = await this.redis.get<PhaseCheckpoint | string>(
      checkpointKey(itineraryId, revision, phase),
    );
    return parseStored<PhaseCheckpoint>(value);
  }

  async activate(input: {
    itineraryId: string;
    revision: ItineraryRevision;
    lockOwner?: string;
  }) {
    if (input.revision.itineraryId !== input.itineraryId) {
      return false;
    }
    const meta = await this.readMeta(input.itineraryId);
    if (!meta) {
      return false;
    }
    const result = (await this.redis.eval(
      `
        local current = redis.call("GET", KEYS[1])
        if not current then return 0 end
        if redis.call("EXISTS", KEYS[3]) ~= 1 then return 0 end
        local meta = cjson.decode(current)
        if meta.phase ~= "activating" then return 0 end
        if tonumber(meta.pendingRevision) ~= tonumber(ARGV[1]) then return 0 end
        if meta.kind == "edit" and tonumber(meta.activeRevision) ~= tonumber(meta.baseRevision) then return 0 end
        if ARGV[5] ~= "" and redis.call("GET", KEYS[4]) ~= ARGV[5] then return 0 end
        redis.call("SET", KEYS[2], ARGV[2], "EXAT", ARGV[3])
        meta.previousRevision = meta.activeRevision
        meta.activeRevision = tonumber(ARGV[1])
        meta.pendingRevision = cjson.null
        meta.phase = "ready"
        meta.updatedAt = ARGV[4]
        meta.errorCode = nil
        meta.routeCursor = nil
        redis.call("SET", KEYS[1], cjson.encode(meta), "EXAT", ARGV[3])
        return 1
      `,
      [
        metaKey(input.itineraryId),
        revisionKey(input.itineraryId, input.revision.revision),
        checkpointKey(input.itineraryId, input.revision.revision, "routing"),
        lockKey(input.itineraryId, input.revision.revision),
      ],
      [
        input.revision.revision,
        JSON.stringify(input.revision),
        toExpiryEpochSeconds(meta.expiresAt),
        new Date(this.now()).toISOString(),
        input.lockOwner ?? "",
      ],
    )) as number;
    return result === 1;
  }

  async fail(input: { itineraryId: string; errorCode: string }) {
    const meta = await this.readMeta(input.itineraryId);
    if (!meta) {
      return false;
    }
    const result = (await this.redis.eval(
      `
        local current = redis.call("GET", KEYS[1])
        if not current then return 0 end
        local meta = cjson.decode(current)
        if meta.phase == "ready" or meta.phase == "failed" then return 0 end
        meta.phase = "failed"
        meta.pendingRevision = cjson.null
        meta.errorCode = ARGV[1]
        meta.updatedAt = ARGV[2]
        redis.call("SET", KEYS[1], cjson.encode(meta), "EXAT", ARGV[3])
        return 1
      `,
      [metaKey(input.itineraryId)],
      [
        input.errorCode,
        new Date(this.now()).toISOString(),
        toExpiryEpochSeconds(meta.expiresAt),
      ],
    )) as number;
    return result === 1;
  }

  async getJob(itineraryId: string): Promise<ItineraryJobSnapshot | null> {
    const meta = await this.readMeta(itineraryId);
    if (!meta) {
      return null;
    }
    const activeRevision =
      meta.activeRevision === null
        ? null
        : await this.getRevision(itineraryId, meta.activeRevision);
    return { meta, activeRevision };
  }

  async getRevision(itineraryId: string, revision: number) {
    const value = await this.redis.get<ItineraryRevision | string>(
      revisionKey(itineraryId, revision),
    );
    return parseStored<ItineraryRevision>(value);
  }

  private async readMeta(itineraryId: string) {
    const value = await this.redis.get<ItineraryJobMeta | string>(
      metaKey(itineraryId),
    );
    return parseStored<ItineraryJobMeta>(value);
  }
}

async function throwClassifiedUpstashFailure(redis: Redis): Promise<never> {
  try {
    await redis.ping();
  } catch {
    throw new Error("PLANME_V3_REDIS_CONNECTION_FAILED");
  }

  try {
    await redis.eval("return 1", [], []);
  } catch {
    throw new Error("PLANME_V3_REDIS_SCRIPTING_FAILED");
  }

  throw new Error("PLANME_V3_REDIS_CREATE_GENERATION_FAILED");
}

function createGenerationMeta(
  itineraryId: string,
  nowMs: number,
): ItineraryJobMeta {
  const createdAt = new Date(nowMs).toISOString();
  return {
    schemaVersion: 3,
    itineraryId,
    kind: "generation",
    phase: "queued",
    activeRevision: null,
    pendingRevision: 1,
    previousRevision: null,
    createdAt,
    updatedAt: createdAt,
    expiresAt: new Date(nowMs + JOB_TTL_SECONDS * 1_000).toISOString(),
  };
}

function parseStored<Value>(value: Value | string | null): Value | null {
  if (!value) {
    return null;
  }
  return typeof value === "string" ? (JSON.parse(value) as Value) : value;
}

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}

function createItineraryId() {
  return `planme-v3-${crypto.randomUUID()}`;
}

async function digestKey(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function toExpiryEpochSeconds(value: string) {
  return Math.floor(Date.parse(value) / 1_000);
}

function metaKey(itineraryId: string) {
  return `${V3_PREFIX}:itinerary:${itineraryId}:meta`;
}

function revisionKey(itineraryId: string, revision: number) {
  return `${V3_PREFIX}:itinerary:${itineraryId}:revision:${revision}`;
}

function revisionKeyPrefix(itineraryId: string) {
  return `${V3_PREFIX}:itinerary:${itineraryId}:revision:`;
}

function checkpointKey(
  itineraryId: string,
  revision: number,
  phase: ItineraryPhase,
) {
  return `${V3_PREFIX}:itinerary:${itineraryId}:checkpoint:${revision}:${phase}`;
}

function checkpointKeyPrefix(itineraryId: string) {
  return `${V3_PREFIX}:itinerary:${itineraryId}:checkpoint:`;
}

function lockKey(itineraryId: string, revision: number) {
  return `${V3_PREFIX}:lock:${itineraryId}:${revision}`;
}

function idempotencyKey(digest: string) {
  return `${V3_PREFIX}:idempotency:${digest}`;
}

function deleteMapEntriesWithPrefix<Value>(
  values: Map<string, Value>,
  prefix: string,
) {
  for (const key of values.keys()) {
    if (key.startsWith(prefix)) {
      values.delete(key);
    }
  }
}
