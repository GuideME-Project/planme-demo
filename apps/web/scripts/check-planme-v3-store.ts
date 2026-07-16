import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ItineraryRevision, TourPlaceSnapshot } from "@planme/core";
import {
  createMemoryPlanmeV3JobStore,
  type ItineraryPhase,
} from "../lib/planme-v3/job-store";
import {
  createMemoryPlanmeV3TourCache,
  loadTourCandidates,
  type TourCacheScope,
} from "../lib/planme-v3/tour-cache";

const PHASES: ItineraryPhase[] = [
  "queued",
  "resolving_anchors",
  "collecting_candidates",
  "arranging",
  "scheduling",
  "routing",
];

async function main() {
  assertUpstashLuaKeyContract();
  assertUpstashTourCachePipelineContract();
  let now = Date.parse("2026-07-14T00:00:00.000Z");
  let sequence = 0;
  const store = createMemoryPlanmeV3JobStore({
    now: () => now,
    createId: () => `itinerary-${++sequence}`,
  });

  const created = await store.createGeneration({
    idempotencyKey: "action-invocation-1",
    inputDigest: "input-a",
  });
  assert.equal(created.status, "created");
  assert.equal(created.itineraryId, "itinerary-1");
  const originalExpiry = created.meta.expiresAt;

  const replayed = await store.createGeneration({
    idempotencyKey: "action-invocation-1",
    inputDigest: "input-a",
  });
  assert.equal(replayed.status, "replayed");
  assert.equal(replayed.itineraryId, created.itineraryId);

  const conflict = await store.createGeneration({
    idempotencyKey: "action-invocation-1",
    inputDigest: "input-b",
  });
  assert.deepEqual(conflict, { status: "conflict" });

  const independent = await store.createGeneration({
    idempotencyKey: "action-invocation-2",
    inputDigest: "input-a",
  });
  assert.equal(independent.status, "created");
  assert.notEqual(independent.itineraryId, created.itineraryId);

  const concurrent = await Promise.all([
    store.createGeneration({
      idempotencyKey: "gpts:concurrent-start",
      inputDigest: "input-concurrent",
    }),
    store.createGeneration({
      idempotencyKey: "gpts:concurrent-start",
      inputDigest: "input-concurrent",
    }),
  ]);
  assert.deepEqual(
    new Set(concurrent.map((result) => result.status)),
    new Set(["created", "replayed"]),
  );
  if (
    concurrent[0].status === "conflict" ||
    concurrent[1].status === "conflict"
  ) {
    throw new Error("동시 멱등 생성이 충돌했습니다.");
  }
  assert.equal(concurrent[0].itineraryId, concurrent[1].itineraryId);
  assert.equal(
    await store.acquirePhaseLock(
      concurrent[0].itineraryId,
      1,
      "concurrent-owner-a",
    ),
    true,
  );
  assert.equal(
    await store.savePhase({
      itineraryId: concurrent[0].itineraryId,
      revision: 1,
      expectedPhase: "queued",
      nextPhase: "resolving_anchors",
      checkpoint: checkpoint("wrong-lock-owner"),
      lockOwner: "concurrent-owner-b",
    }),
    false,
  );
  await store.releasePhaseLock(
    concurrent[0].itineraryId,
    1,
    "concurrent-owner-a",
  );

  const incomplete = await store.createGeneration({
    idempotencyKey: "gpts:incomplete-activation",
    inputDigest: "input-incomplete",
  });
  assert.equal(incomplete.status, "created");
  assert.equal(
    await store.savePhase({
      itineraryId: incomplete.itineraryId,
      revision: 1,
      expectedPhase: "queued",
      nextPhase: "activating",
      checkpoint: checkpoint("incomplete"),
    }),
    true,
  );
  assert.equal(
    await store.activate({
      itineraryId: incomplete.itineraryId,
      revision: makeRevision(incomplete.itineraryId, 1, 10),
    }),
    false,
  );

  assert.equal(
    await store.acquirePhaseLock(created.itineraryId, 1, "worker-a"),
    true,
  );
  assert.equal(
    await store.acquirePhaseLock(created.itineraryId, 1, "worker-b"),
    false,
  );
  await store.releasePhaseLock(created.itineraryId, 1, "worker-b");
  assert.equal(
    await store.acquirePhaseLock(created.itineraryId, 1, "worker-b"),
    false,
  );
  await store.releasePhaseLock(created.itineraryId, 1, "worker-a");
  assert.equal(
    await store.acquirePhaseLock(created.itineraryId, 1, "worker-b"),
    true,
  );
  await store.releasePhaseLock(created.itineraryId, 1, "worker-b");

  await advanceToActivating(store, created.itineraryId, 1);
  assert.equal(
    await store.savePhase({
      itineraryId: created.itineraryId,
      revision: 1,
      expectedPhase: "queued",
      nextPhase: "resolving_anchors",
      checkpoint: checkpoint("stale"),
    }),
    false,
  );

  const revision1 = makeRevision(created.itineraryId, 1, 60);
  assert.equal(
    await store.activate({ itineraryId: created.itineraryId, revision: revision1 }),
    true,
  );
  let job = await store.getJob(created.itineraryId);
  assert.equal(job?.meta.phase, "ready");
  assert.equal(job?.meta.activeRevision, 1);
  assert.equal(job?.meta.previousRevision, null);

  if (!job?.activeRevision) {
    throw new Error("활성 리비전이 저장되지 않았습니다.");
  }
  job.activeRevision.standard.totalMinutes = 999;
  assert.equal(
    (await store.getRevision(created.itineraryId, 1))?.standard.totalMinutes,
    60,
  );

  now += 24 * 60 * 60 * 1_000;
  const edit1 = await store.startEdit({
    itineraryId: created.itineraryId,
    baseRevision: 1,
  });
  assert.equal(edit1.status, "created");
  if (edit1.status !== "created") {
    throw new Error("편집 시작에 실패했습니다.");
  }
  assert.equal(edit1.meta.expiresAt, originalExpiry);
  assert.equal(edit1.meta.pendingRevision, 2);

  const overlappingEdit = await store.startEdit({
    itineraryId: created.itineraryId,
    baseRevision: 1,
  });
  assert.deepEqual(overlappingEdit, { status: "edit_already_running" });

  assert.equal(
    await store.fail({
      itineraryId: created.itineraryId,
      errorCode: "ROUTE_UNAVAILABLE",
    }),
    true,
  );
  job = await store.getJob(created.itineraryId);
  assert.equal(job?.meta.phase, "failed");
  assert.equal(job?.meta.pendingRevision, null);
  assert.equal(job?.meta.activeRevision, 1);
  assert.equal(job?.activeRevision?.revision, 1);

  const staleEdit = await store.startEdit({
    itineraryId: created.itineraryId,
    baseRevision: 0,
  });
  assert.deepEqual(staleEdit, { status: "revision_conflict" });

  const edit2 = await store.startEdit({
    itineraryId: created.itineraryId,
    baseRevision: 1,
  });
  assert.equal(edit2.status, "created");
  await advanceToActivating(store, created.itineraryId, 2);
  const revision2 = makeRevision(created.itineraryId, 2, 45);
  assert.equal(
    await store.activate({ itineraryId: created.itineraryId, revision: revision2 }),
    true,
  );
  job = await store.getJob(created.itineraryId);
  assert.equal(job?.meta.activeRevision, 2);
  assert.equal(job?.meta.previousRevision, 1);
  assert.equal(job?.activeRevision?.standard.totalMinutes, 45);
  assert.equal((await store.getRevision(created.itineraryId, 1))?.revision, 1);

  now = Date.parse(originalExpiry) + 1;
  assert.equal(await store.getJob(created.itineraryId), null);
  assert.equal(await store.getRevision(created.itineraryId, 1), null);

  await checkTourCachePolicy();

  console.log(
    "PlanME V3 storage checks passed (V3-06, V3-07, V3-10).",
  );
}

function assertUpstashTourCachePipelineContract() {
  const source = readFileSync(
    join(import.meta.dirname, "../lib/planme-v3/tour-cache.ts"),
    "utf8",
  );
  const upstashSource = source.slice(
    source.indexOf("class UpstashPlanmeV3TourCache"),
  );
  const saveSource = upstashSource.slice(
    upstashSource.indexOf("async saveSuccessfulResponse"),
    upstashSource.indexOf("private async read"),
  );
  assert.match(saveSource, /const pipeline = this\.redis\.pipeline\(\)/);
  assert.equal(saveSource.match(/pipeline\.set\(/g)?.length, 2);
  assert.equal(saveSource.match(/pipeline\.exec\(\)/g)?.length, 1);
  assert.doesNotMatch(saveSource, /await this\.redis\.set\(/);
}

function assertUpstashLuaKeyContract() {
  const source = readFileSync(
    join(import.meta.dirname, "../lib/planme-v3/job-store.ts"),
    "utf8",
  );
  const upstashSource = source.slice(source.indexOf("class UpstashPlanmeV3JobStore"));
  const savePhaseSource = upstashSource.slice(
    upstashSource.indexOf("async savePhase"),
    upstashSource.indexOf("async getCheckpoint"),
  );
  const activateSource = upstashSource.slice(
    upstashSource.indexOf("async activate"),
    upstashSource.indexOf("async fail"),
  );
  assert.match(savePhaseSource, /GET", KEYS\[3\]/);
  assert.match(savePhaseSource, /lockKey\(command\.itineraryId, command\.revision\)/);
  assert.match(activateSource, /EXISTS", KEYS\[3\]/);
  assert.match(activateSource, /GET", KEYS\[4\]/);
  assert.match(activateSource, /checkpointKey\([\s\S]*?"routing"\)/);
  assert.match(activateSource, /lockKey\(input\.itineraryId, input\.revision\.revision\)/);
}

async function checkTourCachePolicy() {
  let now = Date.parse("2026-07-14T00:00:00.000Z");
  const cache = createMemoryPlanmeV3TourCache({ now: () => now });
  const attractionScope: TourCacheScope = {
    regionCode: "26",
    districtCode: "260",
    contentTypeId: 12,
  };
  const lodgingScope: TourCacheScope = {
    ...attractionScope,
    contentTypeId: 32,
  };
  const oldAttraction = place("old-attraction", 12, "기존 명소");

  await cache.saveSuccessfulResponse(attractionScope, [oldAttraction]);
  now += 24 * 60 * 60 * 1_000 + 1;
  assert.deepEqual(await cache.readFresh(attractionScope), { status: "miss" });
  const stale = await cache.readLastGood(attractionScope);
  assert.equal(stale.status, "hit");
  if (stale.status === "hit") {
    assert.equal(stale.places[0]?.cacheStatus, "stale");
  }

  let fetchCount = 0;
  const normalEmpty = await loadTourCandidates({
    cache,
    scope: attractionScope,
    fetchFromTourApi: async () => {
      fetchCount += 1;
      return { status: "success", places: [] };
    },
  });
  assert.equal(normalEmpty.status, "available");
  if (normalEmpty.status === "available") {
    assert.equal(normalEmpty.source, "tourapi");
    assert.deepEqual(normalEmpty.places, []);
  }

  const emptyFreshHit = await loadTourCandidates({
    cache,
    scope: attractionScope,
    fetchFromTourApi: async () => {
      fetchCount += 1;
      return { status: "failure" };
    },
  });
  assert.equal(fetchCount, 1);
  assert.deepEqual(emptyFreshHit, {
    status: "available",
    source: "fresh-cache",
    places: [],
  });

  now += 24 * 60 * 60 * 1_000 + 1;
  const outageAfterEmpty = await loadTourCandidates({
    cache,
    scope: attractionScope,
    fetchFromTourApi: async () => ({ status: "failure" }),
  });
  assert.equal(outageAfterEmpty.status, "available");
  if (outageAfterEmpty.status === "available") {
    assert.equal(outageAfterEmpty.source, "last-good");
    assert.deepEqual(outageAfterEmpty.places, []);
  }

  const otherTypeOutage = await loadTourCandidates({
    cache,
    scope: lodgingScope,
    fetchFromTourApi: async () => ({ status: "failure" }),
  });
  assert.deepEqual(otherTypeOutage, { status: "unavailable" });
}

async function advanceToActivating(
  store: ReturnType<typeof createMemoryPlanmeV3JobStore>,
  itineraryId: string,
  revision: number,
) {
  for (let index = 0; index < PHASES.length; index += 1) {
    const expectedPhase = PHASES[index];
    const nextPhase = PHASES[index + 1] ?? "activating";
    assert.equal(
      await store.savePhase({
        itineraryId,
        revision,
        expectedPhase,
        nextPhase,
        checkpoint: checkpoint(`${revision}:${expectedPhase}`),
        routeCursor: expectedPhase === "routing" ? 1 : undefined,
      }),
      true,
    );
  }
}

function checkpoint(inputDigest: string) {
  return {
    schemaVersion: 3 as const,
    phaseVersion: 1,
    inputDigest,
    payload: {},
  };
}

function makeRevision(
  itineraryId: string,
  revision: number,
  totalMinutes: number,
): ItineraryRevision {
  const lodging = place("lodging", 32, "테스트 숙소");
  const attraction = place("attraction", 12, "테스트 명소");
  const intent = {
    origin: "서울역",
    destination: "부산",
    transportMode: "transit" as const,
    durationDays: 1,
    preferences: [],
    requestedPlaces: [],
    travelerCount: 1,
    luggageCount: 0,
  };
  const days = [
    {
      day: 1,
      startMinute: 570,
      endMinute: 1020,
      visits: [{ contentId: attraction.contentId, startMinute: 600, endMinute: 660 }],
      meals: [],
      idleBlocks: [],
    },
  ];
  return {
    schemaVersion: 3,
    itineraryId,
    revision,
    createdAt: "2026-07-14T00:00:00.000Z",
    intent,
    plan: {
      intent,
      lodging,
      selectedPlaces: {
        [lodging.contentId]: lodging,
        [attraction.contentId]: attraction,
      },
      days: [
        {
          day: 1,
          visits: [{ contentId: attraction.contentId, stayMinutes: 60 }],
          meals: [{ kind: "lunch" }, { kind: "dinner" }],
          freeTimePolicy: "lodging_rest",
        },
      ],
      excludedRequestedPlaces: [],
    },
    standard: {
      kind: "standard",
      totalMinutes,
      days,
      segments: [],
      luggageSegments: [],
      luggageEvents: [],
    },
    carryme: {
      kind: "carryme",
      totalMinutes,
      days,
      segments: [],
      luggageSegments: [],
      luggageEvents: [],
    },
    selectedPlaceSnapshots: {
      [lodging.contentId]: lodging,
      [attraction.contentId]: attraction,
    },
  };
}

function place(
  contentId: string,
  contentTypeId: 12 | 32,
  title: string,
): TourPlaceSnapshot {
  return {
    contentId,
    contentTypeId,
    title,
    coordinate: { lat: 35.1796, lng: 129.0756 },
    fetchedAt: "2026-07-14T00:00:00.000Z",
    cacheStatus: "fresh",
    source: "tourapi",
  };
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
