import {
  PLANME_V3_ALLOWED_CONTENT_TYPE_IDS,
  createItineraryDisplayDto,
  createTripPlan,
  normalizeTourCandidate,
  normalizeTourCandidates,
  normalizeTourTitle,
  recordPlanmeUsageSafely,
  resolveTripIntent,
  scheduleTripPlan,
  selectTourCandidates,
  validateAiPlanSelection,
  type AllowedTourContentTypeId,
  type Coordinate,
  type ExcludedRequestedPlace,
  type ItineraryDisplayDto,
  type ItineraryRevision,
  type JsonValue,
  type PlanmeUsageRecorder,
  type ResolvedTripIntent,
  type RouteSegment,
  type RouteVariant,
  type TourPlaceSnapshot,
  type TripIntentInput,
  type TripPlan,
} from "@planme/core";
import type {
  ItineraryJobMeta,
  ItineraryPhase,
  PlanmeV3JobStore,
} from "./job-store";
import type { PlanmeAnchorGeocodeResult } from "./geocoding";
import type { LunaPlanResult } from "./luna-planner";
import type {
  PlanmeRoutePoint,
  PlanmeRouteResult,
} from "./route-service";
import {
  loadTourCandidates,
  type PlanmeV3TourCache,
  type TourCandidateLoadResult,
  type TourCacheScope,
} from "./tour-cache";
import type {
  TourCandidateQuery,
  TourCandidateQueryResult,
  TourDestinationResolution,
  TourRegion,
} from "./tour-api-client";

export type StartItineraryRequest = TripIntentInput;

export type EditItineraryRequest = {
  baseRevision: number;
  transportMode?: "drive" | "transit";
  lodgingContentId?: string;
  days: Array<{
    day: number;
    orderedVisitContentIds: string[];
    restaurantContentIds?: string[];
  }>;
};

export type ItineraryJobResponse =
  | {
      status: "processing";
      itineraryId: string;
      phase: ItineraryPhase;
      retryAfterMs: number;
    }
  | {
      status: "ready";
      itineraryId: string;
      revision: number;
      pageUrl: string;
      widget: ItineraryDisplayDto;
      excludedRequestedPlaces: ExcludedRequestedPlace[];
    }
  | {
      status: "failed";
      itineraryId: string;
      errorCode: string;
      message: string;
    };

export type StartItineraryResult =
  | ItineraryJobResponse
  | {
      status: "invalid";
      missingSlots: Array<
        "origin" | "destination" | "transportMode" | "durationDays"
      >;
      invalidSlots: Array<
        "origin" | "destination" | "transportMode" | "durationDays"
      >;
    }
  | { status: "idempotency_conflict" };

export type StartItineraryEditResult =
  | ItineraryJobResponse
  | {
      status:
        | "invalid"
        | "not_found"
        | "revision_conflict"
        | "edit_already_running";
    };

export type PlanmeV3OrchestratorDependencies = {
  jobStore: PlanmeV3JobStore;
  tourCache: PlanmeV3TourCache;
  resolveDestination: (
    destination: string,
    signal?: AbortSignal,
  ) => Promise<TourDestinationResolution | null>;
  listCandidates: (
    query: TourCandidateQuery,
    signal?: AbortSignal,
  ) => Promise<TourCandidateQueryResult>;
  planCandidates: (input: {
    intent: ResolvedTripIntent;
    candidates: TourPlaceSnapshot[];
    signal?: AbortSignal;
  }) => Promise<LunaPlanResult>;
  geocodeAnchor: (
    query: string,
    signal?: AbortSignal,
  ) => Promise<PlanmeAnchorGeocodeResult>;
  routeSegment: (input: {
    from: PlanmeRoutePoint;
    to: PlanmeRoutePoint;
    transportMode: "drive" | "transit";
    requiredSegment: boolean;
    signal?: AbortSignal;
  }) => Promise<PlanmeRouteResult>;
  now?: () => number;
  pageOrigin: string;
  createLockOwner?: () => string;
  usageRecorder?: PlanmeUsageRecorder;
};

type QueuedPayload = {
  intent: ResolvedTripIntent;
  editCommand?: {
    lodgingContentId: string;
    days: Array<{
      day: number;
      orderedVisitContentIds: string[];
      restaurantContentIds: string[];
    }>;
  };
  baseCandidates?: TourPlaceSnapshot[];
};

type AnchorPayload = QueuedPayload & {
  originCoordinate: Coordinate;
  destinationCoordinate: Coordinate;
  region: TourRegion;
  candidateRegions?: TourRegion[];
  requiredDestinationPlace?: TourPlaceSnapshot;
};

type CandidatePayload = AnchorPayload & {
  candidates: TourPlaceSnapshot[];
  excludedRequestedPlaces: ExcludedRequestedPlace[];
};

type PlanPayload = CandidatePayload & {
  plan: TripPlan;
};

type RoutingPayload = PlanPayload & {
  revision: ItineraryRevision;
};

type RoutingProgressPayload = PlanPayload & {
  routeCache: Record<string, PlanmeRouteResult>;
};

const FIRST_DAY_DEPARTURE_MINUTE = 9 * 60 + 30;
const ROUTE_BATCH_PROVIDER_CALLS = 6;
// Only Naver driving edges fan out; ODsay transit stays serialized in route-service.
const DRIVE_ROUTE_CONCURRENCY = 3;
// TourAPI publishes a per-second limit error without a fixed public TPS value,
// so candidate types use a small bounded concurrency instead of an unbounded fan-out.
const CANDIDATE_CONTENT_TYPE_CONCURRENCY = 3;
const VISIT_CONTENT_TYPE_IDS = new Set<AllowedTourContentTypeId>([
  12,
  14,
  15,
  28,
  38,
]);

export function createPlanmeV3Orchestrator(
  dependencies: PlanmeV3OrchestratorDependencies,
) {
  const now = dependencies.now ?? Date.now;
  const createLockOwner =
    dependencies.createLockOwner ?? (() => crypto.randomUUID());

  async function startItinerary(
    input: StartItineraryRequest,
    idempotencyKey: string,
  ): Promise<StartItineraryResult> {
    const resolved = resolveTripIntent(input);
    if (!resolved.ok) {
      return {
        status: "invalid",
        missingSlots: resolved.missingSlots,
        invalidSlots: resolved.invalidSlots,
      };
    }
    if (!idempotencyKey.trim()) {
      return { status: "idempotency_conflict" };
    }

    const inputDigest = await digestValue(resolved.value);
    const created = await runStartStorageStage(
      "PLANME_V3_STORE_CREATE_STAGE_FAILED",
      () => dependencies.jobStore.createGeneration({
        idempotencyKey,
        inputDigest,
      }),
    );
    if (created.status === "conflict") {
      return { status: "idempotency_conflict" };
    }
    if (created.meta.phase === "queued") {
      const existing = await runStartStorageStage(
        "PLANME_V3_STORE_CHECKPOINT_READ_FAILED",
        () => dependencies.jobStore.getCheckpoint(
          created.itineraryId,
          1,
          "queued",
        ),
      );
      if (!existing) {
        await runStartStorageStage(
          "PLANME_V3_STORE_PHASE_SAVE_FAILED",
          () => dependencies.jobStore.savePhase({
            itineraryId: created.itineraryId,
            revision: 1,
            expectedPhase: "queued",
            nextPhase: "resolving_anchors",
            checkpoint: {
              schemaVersion: 3,
              phaseVersion: 1,
              inputDigest,
              payload: toJsonValue({ intent: resolved.value }),
            },
          }),
        );
      }
    }

    return (
      (await runStartStorageStage(
        "PLANME_V3_STORE_STATUS_READ_FAILED",
        () => getItineraryStatus(created.itineraryId),
      )) ?? {
        status: "failed",
        itineraryId: created.itineraryId,
        errorCode: "JOB_CONFLICT",
        message: safeFailureMessage("JOB_CONFLICT"),
      }
    );
  }

  async function runStartStorageStage<Value>(
    errorCode: string,
    operation: () => Promise<Value>,
  ): Promise<Value> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("PLANME_V3_REDIS_")
      ) {
        throw error;
      }
      throw new Error(errorCode);
    }
  }

  async function startItineraryEdit(
    itineraryId: string,
    input: EditItineraryRequest,
  ): Promise<StartItineraryEditResult> {
    const base = await dependencies.jobStore.getRevision(
      itineraryId,
      input.baseRevision,
    );
    if (!base) {
      return { status: "not_found" };
    }
    if (
      !Number.isInteger(input.baseRevision) ||
      input.days.length !== base.intent.durationDays ||
      input.days.some((day, index) => day.day !== index + 1) ||
      input.days.every((day) => day.orderedVisitContentIds.length === 0)
    ) {
      return { status: "invalid" };
    }
    const started = await dependencies.jobStore.startEdit({
      itineraryId,
      baseRevision: input.baseRevision,
    });
    if (started.status !== "created") {
      return { status: started.status };
    }

    const editCommand = {
      lodgingContentId: input.lodgingContentId ?? base.plan.lodging.contentId,
      days: input.days.map((day) => ({
        day: day.day,
        orderedVisitContentIds: [...day.orderedVisitContentIds],
        restaurantContentIds: day.restaurantContentIds
          ? [...day.restaurantContentIds]
          : base.plan.days[day.day - 1]?.meals.flatMap((meal) =>
              meal.contentId ? [meal.contentId] : [],
            ) ?? [],
      })),
    };
    const intent = {
      ...base.intent,
      transportMode: input.transportMode ?? base.intent.transportMode,
    };
    const inputDigest = await digestValue({
      itineraryId,
      baseRevision: input.baseRevision,
      intent,
      editCommand,
    });
    const saved = await dependencies.jobStore.savePhase({
      itineraryId,
      revision: input.baseRevision + 1,
      expectedPhase: "queued",
      nextPhase: "resolving_anchors",
      checkpoint: {
        schemaVersion: 3,
        phaseVersion: 1,
        inputDigest,
        payload: toJsonValue({
          intent,
          editCommand,
          baseCandidates: Object.values(base.selectedPlaceSnapshots),
        }),
      },
    });
    if (!saved) {
      await dependencies.jobStore.fail({ itineraryId, errorCode: "JOB_CONFLICT" });
      return { status: "revision_conflict" };
    }
    return (
      (await getItineraryStatus(itineraryId)) ?? { status: "not_found" }
    );
  }

  async function getItineraryStatus(
    itineraryId: string,
  ): Promise<ItineraryJobResponse | null> {
    const snapshot = await dependencies.jobStore.getJob(itineraryId);
    if (!snapshot) {
      return null;
    }
    if (snapshot.meta.phase === "failed") {
      const errorCode = snapshot.meta.errorCode ?? "INTERNAL_ERROR";
      return {
        status: "failed",
        itineraryId,
        errorCode,
        message: safeFailureMessage(errorCode),
      };
    }
    if (snapshot.meta.phase !== "ready" || !snapshot.activeRevision) {
      return {
        status: "processing",
        itineraryId,
        phase: snapshot.meta.phase,
        retryAfterMs: retryAfterMs(snapshot.meta, now()),
      };
    }

    const pageUrl = new URL(
      `/itinerary/${encodeURIComponent(itineraryId)}`,
      dependencies.pageOrigin,
    ).toString();
    const widget = createItineraryDisplayDto(snapshot.activeRevision, pageUrl);
    if (!widget) {
      return {
        status: "failed",
        itineraryId,
        errorCode: "DISPLAY_CONTRACT_INVALID",
        message: safeFailureMessage("DISPLAY_CONTRACT_INVALID"),
      };
    }
    return {
      status: "ready",
      itineraryId,
      revision: snapshot.activeRevision.revision,
      pageUrl,
      widget,
      excludedRequestedPlaces:
        snapshot.activeRevision.plan.excludedRequestedPlaces,
    };
  }

  async function advanceItinerary(
    itineraryId: string,
    signal?: AbortSignal,
  ): Promise<ItineraryJobResponse | null> {
    const snapshot = await dependencies.jobStore.getJob(itineraryId);
    if (!snapshot) {
      return null;
    }
    const meta = snapshot.meta;
    if (meta.phase === "ready" || meta.phase === "failed") {
      return getItineraryStatus(itineraryId);
    }
    if (meta.pendingRevision === null) {
      await dependencies.jobStore.fail({
        itineraryId,
        errorCode: "JOB_CONFLICT",
      });
      return getItineraryStatus(itineraryId);
    }

    const owner = createLockOwner();
    const acquired = await dependencies.jobStore.acquirePhaseLock(
      itineraryId,
      meta.pendingRevision,
      owner,
    );
    if (!acquired) {
      return getItineraryStatus(itineraryId);
    }

    const phaseStartedAt = Date.now();
    let phaseOutcome: "completed" | "failed" | "aborted" = "completed";
    try {
      const current = await dependencies.jobStore.getJob(itineraryId);
      if (
        !current ||
        current.meta.phase !== meta.phase ||
        current.meta.pendingRevision !== meta.pendingRevision ||
        current.meta.updatedAt !== meta.updatedAt ||
        current.meta.routeCursor !== meta.routeCursor
      ) {
        return getItineraryStatus(itineraryId);
      }
      await advancePhase(current.meta, owner, signal);
    } catch (error) {
      if (signal?.aborted) {
        phaseOutcome = "aborted";
        return getItineraryStatus(itineraryId);
      }
      phaseOutcome = "failed";
      const errorCode =
        error instanceof OrchestratorFailure ? error.errorCode : "INTERNAL_ERROR";
      await dependencies.jobStore.fail({ itineraryId, errorCode });
    } finally {
      await dependencies.jobStore.releasePhaseLock(
        itineraryId,
        meta.pendingRevision,
        owner,
      );
      console.info("PlanME V3 phase performance", {
        itineraryId,
        phase: meta.phase,
        durationMs: Date.now() - phaseStartedAt,
        outcome: phaseOutcome,
      });
    }
    return getItineraryStatus(itineraryId);
  }

  async function runUntilTerminal(
    itineraryId: string,
    deadlineEpochMs: number,
    externalSignal?: AbortSignal,
  ): Promise<ItineraryJobResponse | null> {
    for (let step = 0; step < 128; step += 1) {
      const snapshot = await dependencies.jobStore.getJob(itineraryId);
      if (!snapshot) {
        return null;
      }
      if (snapshot.meta.phase === "ready" || snapshot.meta.phase === "failed") {
        return getItineraryStatus(itineraryId);
      }
      if (deadlineEpochMs - now() < minimumPhaseBudgetMs(snapshot.meta.phase)) {
        await dependencies.jobStore.fail({
          itineraryId,
          errorCode: "TIME_BUDGET_EXCEEDED",
        });
        return getItineraryStatus(itineraryId);
      }
      const advancedWithinBudget = await runWithinDeadline(
        (signal) => advanceItinerary(itineraryId, signal),
        Math.max(1, deadlineEpochMs - now()),
        externalSignal,
      );
      if (!advancedWithinBudget) {
        await dependencies.jobStore.fail({
          itineraryId,
          errorCode: "TIME_BUDGET_EXCEEDED",
        });
        return getItineraryStatus(itineraryId);
      }
    }
    await dependencies.jobStore.fail({
      itineraryId,
      errorCode: "TIME_BUDGET_EXCEEDED",
    });
    return getItineraryStatus(itineraryId);
  }

  async function advancePhase(
    meta: ItineraryJobMeta,
    lockOwner: string,
    signal?: AbortSignal,
  ) {
    const revision = meta.pendingRevision;
    if (revision === null) {
      throw new OrchestratorFailure("JOB_CONFLICT");
    }
    if (meta.phase === "resolving_anchors") {
      await resolveAnchors(meta.itineraryId, revision, lockOwner, signal);
      return;
    }
    if (meta.phase === "collecting_candidates") {
      await collectCandidates(meta.itineraryId, revision, lockOwner, signal);
      return;
    }
    if (meta.phase === "arranging") {
      await arrangeCandidates(meta.itineraryId, revision, lockOwner, signal);
      return;
    }
    if (meta.phase === "scheduling") {
      await prepareScheduling(meta.itineraryId, revision, lockOwner);
      return;
    }
    if (meta.phase === "routing") {
      const completed = await routePlan(
        meta.itineraryId,
        revision,
        lockOwner,
        signal,
      );
      if (completed) {
        await activateRevision(meta.itineraryId, revision, lockOwner);
      }
      return;
    }
    if (meta.phase === "activating") {
      await activateRevision(meta.itineraryId, revision, lockOwner);
      return;
    }
    throw new OrchestratorFailure("JOB_CONFLICT");
  }

  async function resolveAnchors(
    itineraryId: string,
    revision: number,
    lockOwner: string,
    signal?: AbortSignal,
  ) {
    const checkpoint = await requiredCheckpoint(
      itineraryId,
      revision,
      "queued",
    );
    const queued = checkpoint.payload as QueuedPayload;
    const [origin, destination, resolvedDestination] = await Promise.all([
      dependencies.geocodeAnchor(queued.intent.origin, signal),
      dependencies.geocodeAnchor(queued.intent.destination, signal),
      dependencies.resolveDestination(queued.intent.destination, signal),
    ]);
    const originCoordinate = requireAnchor(origin, "ORIGIN_NOT_RESOLVED");
    if (!resolvedDestination) {
      throw new OrchestratorFailure("DESTINATION_NOT_RESOLVED");
    }
    const { region, candidateRegions, place } = resolvedDestination;
    const destinationPlace = place
      ? normalizeTourCandidate(place, {
          expectedRegionCode: region.regionCode,
          expectedDistrictCode: region.districtCode,
          fetchedAt: new Date(now()).toISOString(),
        })
      : null;
    if (place && !destinationPlace) {
      throw new OrchestratorFailure("DESTINATION_NOT_RESOLVED");
    }
    const destinationCoordinate = destinationPlace?.coordinate ?? requireAnchor(
      destination.status === "not_found"
        ? await dependencies.geocodeAnchor(regionAnchorQuery(region), signal)
        : destination,
      "DESTINATION_NOT_RESOLVED",
    );
    const intent = destinationPlace
      ? {
          ...queued.intent,
          destination: region.districtName ?? region.regionName,
          requestedPlaces: uniqueTexts([
            ...queued.intent.requestedPlaces,
            destinationPlace.title,
          ]),
        }
      : queued.intent;

    await saveNextPhase({
      itineraryId,
      revision,
      expectedPhase: "resolving_anchors",
      nextPhase: "collecting_candidates",
      lockOwner,
      inputDigest: checkpoint.inputDigest,
      payload: {
        ...queued,
        intent,
        originCoordinate,
        destinationCoordinate,
        region,
        ...(candidateRegions?.length ? { candidateRegions } : {}),
        ...(destinationPlace ? { requiredDestinationPlace: destinationPlace } : {}),
      },
    });
  }

  async function collectCandidates(
    itineraryId: string,
    revision: number,
    lockOwner: string,
    signal?: AbortSignal,
  ) {
    const checkpoint = await requiredCheckpoint(
      itineraryId,
      revision,
      "resolving_anchors",
    );
    const anchors = checkpoint.payload as AnchorPayload;
    const candidateById = new Map(
      (anchors.baseCandidates ?? []).map((candidate) => [candidate.contentId, candidate]),
    );
    const unavailableTypes = new Set<AllowedTourContentTypeId>();
    const travelEndDate = calculateTravelEndDate(
      anchors.intent.travelStartDate,
      anchors.intent.durationDays,
    );

    const candidateCollectionStartedAt = Date.now();
    const loadedByContentType = await mapWithConcurrency(
      PLANME_V3_ALLOWED_CONTENT_TYPE_IDS,
      CANDIDATE_CONTENT_TYPE_CONCURRENCY,
      async (contentTypeId) => ({
        contentTypeId,
        loaded: await loadCandidateType(contentTypeId),
      }),
    );
    const sourceCounts = {
      freshCache: 0,
      tourApi: 0,
      lastGood: 0,
      unavailable: 0,
    };

    // Apply results in the contract order so concurrency cannot reorder AI input.
    for (const { contentTypeId, loaded } of loadedByContentType) {
      const available = loaded.filter((result) => result.status === "available");
      for (const result of loaded) {
        if (result.status === "unavailable") {
          sourceCounts.unavailable += 1;
        } else if (result.source === "fresh-cache") {
          sourceCounts.freshCache += 1;
        } else if (result.source === "tourapi") {
          sourceCounts.tourApi += 1;
        } else {
          sourceCounts.lastGood += 1;
        }
      }
      if (available.length === 0) {
        unavailableTypes.add(contentTypeId);
        removeCandidatesByType(candidateById, contentTypeId);
        continue;
      }
      removeCandidatesByType(candidateById, contentTypeId);
      const merged = selectTourCandidates(
        available.flatMap((result) => result.places),
        {
          preferences: anchors.intent.preferences,
          requestedPlaces: anchors.intent.requestedPlaces,
        },
      );
      for (const candidate of merged) {
        if (!candidateById.has(candidate.contentId)) {
          candidateById.set(candidate.contentId, candidate);
        }
      }
    }
    if (anchors.requiredDestinationPlace) {
      candidateById.set(
        anchors.requiredDestinationPlace.contentId,
        anchors.requiredDestinationPlace,
      );
    }

    console.info("PlanME V3 candidate collection performance", {
      itineraryId,
      durationMs: Date.now() - candidateCollectionStartedAt,
      concurrency: CANDIDATE_CONTENT_TYPE_CONCURRENCY,
      contentTypeCount: loadedByContentType.length,
      candidateRegionCount: anchors.candidateRegions?.length ?? 1,
      candidateCount: candidateById.size,
      sourceCounts,
    });

    async function loadCandidateType(
      contentTypeId: AllowedTourContentTypeId,
    ): Promise<TourCandidateLoadResult[]> {
      const candidateRegions = anchors.candidateRegions?.length
        ? anchors.candidateRegions
        : [anchors.region];
      const loaded: TourCandidateLoadResult[] = [];
      for (const region of candidateRegions) {
        const scope: TourCacheScope = {
          regionCode: region.regionCode,
          districtCode: region.districtCode ?? null,
          contentTypeId,
        };
        loaded.push(await loadTourCandidates({
          cache: dependencies.tourCache,
          scope,
          fetchFromTourApi: async () => {
            const result = await dependencies.listCandidates({
              region,
              contentTypeId,
              travelStartDate: anchors.intent.travelStartDate,
              travelEndDate,
            }, signal);
            if (result.status === "failure") {
              return { status: "failure" };
            }
            const records = result.status === "empty" ? [] : result.records;
            return {
              status: "success",
              places: normalizeTourCandidates(records, {
                expectedContentTypeId: contentTypeId,
                expectedRegionCode: region.regionCode,
                expectedDistrictCode: region.districtCode,
                fetchedAt: new Date(now()).toISOString(),
                preferences: anchors.intent.preferences,
                requestedPlaces: anchors.intent.requestedPlaces,
                travelStartDate: anchors.intent.travelStartDate,
                travelEndDate,
              }),
            };
          },
        }));
      }
      return loaded;
    }

    const candidates = [...candidateById.values()];

    const hasLodging = candidates.some((candidate) => candidate.contentTypeId === 32);
    const hasVisit = candidates.some((candidate) =>
      VISIT_CONTENT_TYPE_IDS.has(candidate.contentTypeId),
    );
    const everyVisitTypeUnavailable = [...VISIT_CONTENT_TYPE_IDS].every((type) =>
      unavailableTypes.has(type),
    );
    if (unavailableTypes.has(32) || (!hasVisit && everyVisitTypeUnavailable)) {
      throw new OrchestratorFailure("TOURAPI_UNAVAILABLE");
    }
    if (!hasLodging || !hasVisit) {
      throw new OrchestratorFailure("TOURAPI_CANDIDATES_INSUFFICIENT");
    }

    const excludedRequestedPlaces = findMissingRequestedPlaces(
      anchors.intent.requestedPlaces,
      candidates,
    );
    await saveNextPhase({
      itineraryId,
      revision,
      expectedPhase: "collecting_candidates",
      nextPhase: "arranging",
      lockOwner,
      inputDigest: checkpoint.inputDigest,
      payload: { ...anchors, candidates, excludedRequestedPlaces },
    });
  }

  async function arrangeCandidates(
    itineraryId: string,
    revision: number,
    lockOwner: string,
    signal?: AbortSignal,
  ) {
    const checkpoint = await requiredCheckpoint(
      itineraryId,
      revision,
      "collecting_candidates",
    );
    const candidatePayload = checkpoint.payload as CandidatePayload;
    const selection = candidatePayload.editCommand
      ? validateEditedSelection(candidatePayload)
      : await createGeneratedSelection(
          candidatePayload,
          dependencies.planCandidates,
          signal,
        );
    const plan = createTripPlan({
      intent: candidatePayload.intent,
      selection,
      candidates: candidatePayload.candidates,
      excludedRequestedPlaces: candidatePayload.excludedRequestedPlaces,
    });
    if (!plan) {
      throw new OrchestratorFailure("TOURAPI_CANDIDATES_INSUFFICIENT");
    }
    await saveNextPhase({
      itineraryId,
      revision,
      expectedPhase: "arranging",
      nextPhase: "scheduling",
      lockOwner,
      inputDigest: checkpoint.inputDigest,
      payload: { ...candidatePayload, plan },
    });
  }

  async function prepareScheduling(
    itineraryId: string,
    revision: number,
    lockOwner: string,
  ) {
    const checkpoint = await requiredCheckpoint(
      itineraryId,
      revision,
      "arranging",
    );
    const payload = checkpoint.payload as PlanPayload;
    if (!payload.plan.days.some((day) => day.visits.length > 0)) {
      throw new OrchestratorFailure("TOURAPI_CANDIDATES_INSUFFICIENT");
    }
    await saveNextPhase({
      itineraryId,
      revision,
      expectedPhase: "scheduling",
      nextPhase: "routing",
      lockOwner,
      inputDigest: checkpoint.inputDigest,
      payload,
    });
  }

  async function routePlan(
    itineraryId: string,
    revision: number,
    lockOwner: string,
    signal?: AbortSignal,
  ) {
    const checkpoint = await requiredCheckpoint(
      itineraryId,
      revision,
      "scheduling",
    );
    const payload = checkpoint.payload as PlanPayload;
    const existingProgress = await dependencies.jobStore.getCheckpoint(
      itineraryId,
      revision,
      "routing",
    );
    const routeCache = existingProgress?.inputDigest === checkpoint.inputDigest
      ? (existingProgress.payload as RoutingProgressPayload).routeCache ?? {}
      : {};
    let providerCalls = 0;
    const inFlightRoutes = new Map<
      string,
      ReturnType<PlanmeV3OrchestratorDependencies["routeSegment"]>
    >();
    let routeBatchCheckpoint: Promise<void> | null = null;

    const saveRouteBatchCheckpoint = async () => {
      await Promise.allSettled([...inFlightRoutes.values()]);
      const saved = await dependencies.jobStore.savePhase({
        itineraryId,
        revision,
        expectedPhase: "routing",
        nextPhase: "routing",
        routeCursor: Object.keys(routeCache).length,
        lockOwner,
        checkpoint: {
          schemaVersion: 3,
          phaseVersion: 1,
          inputDigest: checkpoint.inputDigest,
          payload: toJsonValue({ ...payload, routeCache }),
        },
      });
      if (!saved) {
        throw new OrchestratorFailure("JOB_CONFLICT");
      }
    };

    const checkpointingRouteSegment: PlanmeV3OrchestratorDependencies["routeSegment"] =
      async (routeInput) => {
        const key = routeCacheKey(routeInput);
        const cached = routeCache[key];
        if (cached) {
          return cached;
        }
        const inFlight = inFlightRoutes.get(key);
        if (inFlight) {
          return inFlight;
        }
        if (providerCalls >= ROUTE_BATCH_PROVIDER_CALLS) {
          routeBatchCheckpoint ??= saveRouteBatchCheckpoint();
          await routeBatchCheckpoint;
          throw new RouteBatchYield();
        }
        providerCalls += 1;
        const pending = dependencies.routeSegment({
          ...routeInput,
          signal: routeInput.signal ?? signal,
        }).then((result) => {
          routeCache[key] = result;
          return result;
        }).finally(() => {
          inFlightRoutes.delete(key);
        });
        inFlightRoutes.set(key, pending);
        return pending;
      };
    let routedRevision: ItineraryRevision;
    try {
      routedRevision = await buildRoutedRevision({
        itineraryId,
        revision,
        plan: payload.plan,
        originCoordinate: payload.originCoordinate,
        routeSegment: checkpointingRouteSegment,
        createdAt: new Date(now()).toISOString(),
      });
    } catch (error) {
      if (error instanceof RouteBatchYield) {
        return false;
      }
      throw error;
    }
    await saveNextPhase({
      itineraryId,
      revision,
      expectedPhase: "routing",
      nextPhase: "activating",
      lockOwner,
      inputDigest: checkpoint.inputDigest,
      payload: { ...payload, plan: routedRevision.plan, revision: routedRevision },
      routeCursor: routedRevision.standard.segments.length + routedRevision.carryme.segments.length,
    });
    return true;
  }

  async function activateRevision(
    itineraryId: string,
    revision: number,
    lockOwner: string,
  ) {
    const checkpoint = await requiredCheckpoint(
      itineraryId,
      revision,
      "routing",
    );
    const payload = checkpoint.payload as RoutingPayload;
    const activated = await dependencies.jobStore.activate({
      itineraryId,
      revision: payload.revision,
      lockOwner,
    });
    if (!activated) {
      throw new OrchestratorFailure("JOB_CONFLICT");
    }
    await recordPlanmeUsageSafely(
      dependencies.usageRecorder,
      "itinerary_ready",
    );
  }

  async function requiredCheckpoint(
    itineraryId: string,
    revision: number,
    phase: ItineraryPhase,
  ) {
    const checkpoint = await dependencies.jobStore.getCheckpoint(
      itineraryId,
      revision,
      phase,
    );
    if (!checkpoint || checkpoint.schemaVersion !== 3 || checkpoint.phaseVersion !== 1) {
      throw new OrchestratorFailure("JOB_CONFLICT");
    }
    return checkpoint;
  }

  async function saveNextPhase(input: {
    itineraryId: string;
    revision: number;
    expectedPhase: ItineraryPhase;
    nextPhase: ItineraryPhase;
    inputDigest: string;
    payload: QueuedPayload | AnchorPayload | CandidatePayload | PlanPayload | RoutingPayload;
    routeCursor?: number;
    lockOwner?: string;
  }) {
    const saved = await dependencies.jobStore.savePhase({
      itineraryId: input.itineraryId,
      revision: input.revision,
      expectedPhase: input.expectedPhase,
      nextPhase: input.nextPhase,
      routeCursor: input.routeCursor,
      lockOwner: input.lockOwner,
      checkpoint: {
        schemaVersion: 3,
        phaseVersion: 1,
        inputDigest: input.inputDigest,
        payload: toJsonValue(input.payload),
      },
    });
    if (!saved) {
      throw new OrchestratorFailure("JOB_CONFLICT");
    }
  }

  return {
    advanceItinerary,
    getItineraryStatus,
    runUntilTerminal,
    startItinerary,
    startItineraryEdit,
  };
}

async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  mapper: (input: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  const results = new Array<Output>(inputs.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(inputs[index]!, index);
    }
  }

  const workerResults = await Promise.allSettled(
    Array.from(
      { length: Math.min(concurrency, inputs.length) },
      () => worker(),
    ),
  );
  for (const workerResult of workerResults) {
    if (workerResult.status === "rejected") {
      throw workerResult.reason;
    }
  }
  return results;
}

async function createGeneratedSelection(
  payload: CandidatePayload,
  planner: PlanmeV3OrchestratorDependencies["planCandidates"],
  signal?: AbortSignal,
) {
  const planned = await planner({
    intent: payload.intent,
    candidates: payload.candidates,
    signal,
  });
  if (!planned.ok) {
    throw new OrchestratorFailure(
      planned.errorCode === "OPENAI_CONFIGURATION_MISSING"
        ? "INTERNAL_CONFIGURATION_ERROR"
      : "TOURAPI_CANDIDATES_INSUFFICIENT",
    );
  }
  const validated = validateAiPlanSelection(
    JSON.parse(JSON.stringify(planned.selection)) as JsonValue,
    payload.candidates,
    payload.intent.durationDays,
  );
  if (!validated.ok) {
    throw new OrchestratorFailure("TOURAPI_CANDIDATES_INSUFFICIENT");
  }
  return validated.value;
}

function validateEditedSelection(payload: CandidatePayload) {
  if (!payload.editCommand) {
    throw new OrchestratorFailure("JOB_CONFLICT");
  }
  const selection = {
    lodgingContentId: payload.editCommand.lodgingContentId,
    days: payload.editCommand.days,
  };
  const validation = validateAiPlanSelection(
    JSON.parse(JSON.stringify(selection)) as JsonValue,
    payload.candidates,
    payload.intent.durationDays,
  );
  if (!validation.ok) {
    throw new OrchestratorFailure("INVALID_EDIT_COMMAND");
  }
  return validation.value;
}

async function buildRoutedRevision(input: {
  itineraryId: string;
  revision: number;
  plan: TripPlan;
  originCoordinate: Coordinate;
  routeSegment: PlanmeV3OrchestratorDependencies["routeSegment"];
  createdAt: string;
}): Promise<ItineraryRevision> {
  let plan = structuredClone(input.plan);
  const maximumPasses =
    (plan.days.reduce((sum, day) => sum + day.visits.length, 0) + 1) *
      (plan.intent.durationDays + 1) +
    1;

  for (let pass = 0; pass < maximumPasses; pass += 1) {
    const standard = await routeVariant(plan, "standard", input);
    if (standard.status === "exclude") {
      plan = excludeVisit(plan, standard.contentId);
      continue;
    }
    const carryme = await routeVariant(plan, "carryme", input);
    if (carryme.status === "exclude") {
      plan = excludeVisit(plan, carryme.contentId);
      continue;
    }
    const standardSchedule = scheduleTripPlan({
      plan,
      firstDayArrivalMinute: standard.firstDayArrivalMinute,
      routeDurations: standard.routeDurations,
    });
    const carrymeSchedule = scheduleTripPlan({
      plan,
      firstDayArrivalMinute: carryme.firstDayArrivalMinute,
      routeDurations: carryme.routeDurations,
    });
    if (!standardSchedule.ok || !carrymeSchedule.ok) {
      const excluded = [
        ...standardSchedule.excludedContentIds,
        ...carrymeSchedule.excludedContentIds,
      ];
      if (excluded.length === 0) {
        throw new OrchestratorFailure("ROUTE_UNAVAILABLE");
      }
      plan = excludeVisits(plan, excluded);
      continue;
    }
    const deferredMoves = [
      ...standardSchedule.deferredMoves,
      ...carrymeSchedule.deferredMoves,
    ];
    if (deferredMoves.length > 0) {
      plan = moveVisits(plan, deferredMoves);
      continue;
    }
    const overflow = [
      ...standardSchedule.excludedContentIds,
      ...carrymeSchedule.excludedContentIds,
    ];
    if (overflow.length > 0) {
      plan = excludeVisits(plan, overflow);
      continue;
    }

    const selectedPlaceSnapshots = selectReferencedSnapshots(plan);
    return {
      schemaVersion: 3,
      itineraryId: input.itineraryId,
      revision: input.revision,
      createdAt: input.createdAt,
      intent: plan.intent,
      plan,
      standard: {
        kind: "standard",
        totalMinutes: totalRouteMinutes(standard.segments),
        days: standardSchedule.days,
        segments: standard.segments,
        luggageSegments: standard.luggageSegments,
        luggageEvents: standard.luggageEvents,
      },
      carryme: {
        kind: "carryme",
        totalMinutes: totalRouteMinutes(carryme.segments),
        days: carrymeSchedule.days,
        segments: carryme.segments,
        luggageSegments: carryme.luggageSegments,
        luggageEvents: carryme.luggageEvents,
      },
      selectedPlaceSnapshots,
    };
  }
  throw new OrchestratorFailure("ROUTE_UNAVAILABLE");
}

function moveVisits(
  plan: TripPlan,
  moves: Array<{ contentId: string; fromDay: number; toDay: number }>,
) {
  const updated = structuredClone(plan);
  const byContentId = new Map(
    moves.map((move) => [move.contentId, move]),
  );
  for (const move of byContentId.values()) {
    let movedVisit: TripPlan["days"][number]["visits"][number] | null = null;
    updated.days = updated.days.map((day) => ({
      ...day,
      visits: day.visits.filter((visit) => {
        if (visit.contentId === move.contentId) {
          movedVisit = visit;
          return false;
        }
        return true;
      }),
    }));
    const targetDay = updated.days[move.toDay - 1];
    if (movedVisit && targetDay) {
      targetDay.visits.push(movedVisit);
    }
  }
  refreshFreeTimePolicies(updated);
  return updated;
}

type RoutedVariantResult =
  | { status: "exclude"; contentId: string }
  | {
      status: "ready";
      firstDayArrivalMinute: number;
      routeDurations: Array<{
        day: number;
        toFirstVisitMinutes: number;
        betweenVisitMinutes: number[];
      }>;
      segments: RouteSegment[];
      luggageSegments: RouteSegment[];
      luggageEvents: Array<{
        kind: "handoff" | "delivered";
        day: number;
        minute: number;
        locationRef: string;
      }>;
    };

async function routeVariant(
  plan: TripPlan,
  kind: RouteVariant["kind"],
  input: {
    originCoordinate: Coordinate;
    routeSegment: PlanmeV3OrchestratorDependencies["routeSegment"];
  },
): Promise<RoutedVariantResult> {
  const origin: PlanmeRoutePoint = {
    ref: "origin",
    coordinate: input.originCoordinate,
  };
  const lodging = pointForPlace(plan.lodging);
  const segments: RouteSegment[] = [];
  const luggageSegments: RouteSegment[] = [];
  const luggageEvents: Extract<
    RoutedVariantResult,
    { status: "ready" }
  >["luggageEvents"] = [];
  const routing = {
    routeSegment: input.routeSegment,
    transportMode: plan.intent.transportMode,
  };
  const routeDurations: Array<{
    day: number;
    toFirstVisitMinutes: number;
    betweenVisitMinutes: number[];
  }> = [];
  let firstDayArrivalMinute = FIRST_DAY_DEPARTURE_MINUTE;

  if (plan.intent.transportMode === "drive") {
    await prefetchDriveVariantRoutes(plan, kind, input);
  }

  if (kind === "carryme" && plan.intent.luggageCount > 0) {
    const delivery = await requestRoute(
      {
        routeSegment: input.routeSegment,
        transportMode: "drive",
      },
      origin,
      lodging,
      true,
    );
    if (delivery.status === "exclude") {
      throw new OrchestratorFailure("ROUTE_UNAVAILABLE");
    }
    luggageSegments.push(delivery.segment);
    luggageEvents.push(
      {
        kind: "handoff",
        day: 1,
        minute: FIRST_DAY_DEPARTURE_MINUTE,
        locationRef: origin.ref,
      },
      {
        kind: "delivered",
        day: 1,
        minute:
          FIRST_DAY_DEPARTURE_MINUTE + segmentMinutes(delivery.segment),
        locationRef: lodging.ref,
      },
    );
  }

  for (const day of plan.days) {
    const isFirstDay = day.day === 1;
    const isLastDay = day.day === plan.intent.durationDays;
    const visits = day.visits.map((visit) => {
      const place = plan.selectedPlaces[visit.contentId];
      if (!place) {
        throw new OrchestratorFailure("JOB_CONFLICT");
      }
      return pointForPlace(place);
    });
    const betweenVisitMinutes: number[] = [];
    let toFirstVisitMinutes = 0;
    let current = lodging;
    let startVisitIndex = 0;

    if (
      isFirstDay &&
      kind === "standard" &&
      plan.intent.luggageCount > 0
    ) {
      const arrival = await requestRoute(routing, origin, lodging, true);
      if (arrival.status === "exclude") {
        throw new OrchestratorFailure("ROUTE_UNAVAILABLE");
      }
      segments.push(arrival.segment);
      firstDayArrivalMinute += segmentMinutes(arrival.segment);
    } else if (isFirstDay && visits[0]) {
      const arrival = await requestRoute(routing, origin, visits[0], false);
      if (arrival.status === "exclude") {
        return { status: "exclude", contentId: visits[0].ref };
      }
      segments.push(arrival.segment);
      firstDayArrivalMinute += segmentMinutes(arrival.segment);
      current = visits[0];
      startVisitIndex = 1;
    } else if (isFirstDay) {
      const arrival = await requestRoute(routing, origin, lodging, true);
      if (arrival.status === "exclude") {
        throw new OrchestratorFailure("ROUTE_UNAVAILABLE");
      }
      segments.push(arrival.segment);
      firstDayArrivalMinute += segmentMinutes(arrival.segment);
    }

    for (let index = startVisitIndex; index < visits.length; index += 1) {
      const visit = visits[index];
      const routed = await requestRoute(routing, current, visit, false);
      if (routed.status === "exclude") {
        return { status: "exclude", contentId: visit.ref };
      }
      segments.push(routed.segment);
      const duration = segmentMinutes(routed.segment);
      if (index === 0) {
        toFirstVisitMinutes = duration;
      } else {
        betweenVisitMinutes[index - 1] = duration;
      }
      current = visit;
    }

    const end = isLastDay ? origin : lodging;
    const optionalContentId = current.ref === lodging.ref ? null : current.ref;
    if (current.ref !== end.ref) {
      const returnRoute = await requestRoute(
        routing,
        current,
        end,
        optionalContentId === null,
      );
      if (returnRoute.status === "exclude") {
        if (!optionalContentId) {
          throw new OrchestratorFailure("ROUTE_UNAVAILABLE");
        }
        return { status: "exclude", contentId: optionalContentId };
      }
      segments.push(returnRoute.segment);
    }
    routeDurations.push({ day: day.day, toFirstVisitMinutes, betweenVisitMinutes });
  }

  return {
    status: "ready",
    firstDayArrivalMinute,
    routeDurations,
    segments,
    luggageSegments,
    luggageEvents,
  };
}

async function prefetchDriveVariantRoutes(
  plan: TripPlan,
  kind: RouteVariant["kind"],
  input: {
    originCoordinate: Coordinate;
    routeSegment: PlanmeV3OrchestratorDependencies["routeSegment"];
  },
) {
  const origin: PlanmeRoutePoint = {
    ref: "origin",
    coordinate: input.originCoordinate,
  };
  const lodging = pointForPlace(plan.lodging);
  const requests: Array<{
    from: PlanmeRoutePoint;
    to: PlanmeRoutePoint;
    requiredSegment: boolean;
  }> = [];

  if (kind === "carryme" && plan.intent.luggageCount > 0) {
    requests.push({ from: origin, to: lodging, requiredSegment: true });
  }

  for (const day of plan.days) {
    const isFirstDay = day.day === 1;
    const isLastDay = day.day === plan.intent.durationDays;
    const visits = day.visits.map((visit) => {
      const place = plan.selectedPlaces[visit.contentId];
      if (!place) {
        throw new OrchestratorFailure("JOB_CONFLICT");
      }
      return pointForPlace(place);
    });
    let current = lodging;
    let startVisitIndex = 0;

    if (isFirstDay && kind === "standard" && plan.intent.luggageCount > 0) {
      requests.push({ from: origin, to: lodging, requiredSegment: true });
    } else if (isFirstDay && visits[0]) {
      requests.push({ from: origin, to: visits[0], requiredSegment: false });
      current = visits[0];
      startVisitIndex = 1;
    } else if (isFirstDay) {
      requests.push({ from: origin, to: lodging, requiredSegment: true });
    }

    for (let index = startVisitIndex; index < visits.length; index += 1) {
      const visit = visits[index]!;
      requests.push({ from: current, to: visit, requiredSegment: false });
      current = visit;
    }

    const end = isLastDay ? origin : lodging;
    if (current.ref !== end.ref) {
      requests.push({
        from: current,
        to: end,
        requiredSegment: current.ref === lodging.ref,
      });
    }
  }

  await mapWithConcurrency(
    requests,
    DRIVE_ROUTE_CONCURRENCY,
    (request) => input.routeSegment({
      ...request,
      transportMode: "drive",
    }),
  );
}

async function requestRoute(
  input: {
    routeSegment: PlanmeV3OrchestratorDependencies["routeSegment"];
    transportMode: "drive" | "transit";
  },
  from: PlanmeRoutePoint,
  to: PlanmeRoutePoint,
  requiredSegment: boolean,
) {
  const result = await input.routeSegment({
    from,
    to,
    transportMode: input.transportMode,
    requiredSegment,
  });
  if (result.status === "failed") {
    throw new OrchestratorFailure(
      result.errorCode.includes("CONFIGURATION")
        ? "INTERNAL_CONFIGURATION_ERROR"
        : "ROUTE_UNAVAILABLE",
    );
  }
  return result.status === "exclude_optional"
    ? ({ status: "exclude" } as const)
    : ({ status: "ready", segment: result.segment } as const);
}

function excludeVisit(plan: TripPlan, contentId: string) {
  return excludeVisits(plan, [contentId]);
}

function excludeVisits(plan: TripPlan, contentIds: string[]) {
  const excluded = new Set(contentIds);
  const updated = structuredClone(plan);
  updated.days = updated.days.map((day) => ({
    ...day,
    visits: day.visits.filter((visit) => !excluded.has(visit.contentId)),
    meals: day.meals.map((meal) =>
      meal.contentId && excluded.has(meal.contentId)
        ? { kind: meal.kind }
        : meal,
    ),
  }));
  for (const contentId of excluded) {
    const snapshot = updated.selectedPlaces[contentId];
    if (snapshot) {
      const requested = updated.intent.requestedPlaces.find(
        (value) => comparableTitle(value) === comparableTitle(snapshot.title),
      );
      if (
        requested &&
        !updated.excludedRequestedPlaces.some((item) => item.input === requested)
      ) {
        updated.excludedRequestedPlaces.push({
          input: requested,
          reason: "UNROUTABLE",
        });
      }
      delete updated.selectedPlaces[contentId];
    }
  }
  if (countVisits(updated) === 0) {
    throw new OrchestratorFailure("ROUTE_UNAVAILABLE");
  }
  refreshFreeTimePolicies(updated);
  return updated;
}

function refreshFreeTimePolicies(plan: TripPlan) {
  plan.days = plan.days.map((day) => ({
    ...day,
    freeTimePolicy: day.visits.some(
      (visit) => plan.selectedPlaces[visit.contentId]?.contentTypeId !== 39,
    )
      ? "free_time"
      : "lodging_rest",
  }));
}

function selectReferencedSnapshots(plan: TripPlan) {
  const referenced = new Set<string>([plan.lodging.contentId]);
  for (const day of plan.days) {
    day.visits.forEach((visit) => referenced.add(visit.contentId));
    day.meals.forEach((meal) => {
      if (meal.contentId) {
        referenced.add(meal.contentId);
      }
    });
  }
  return Object.fromEntries(
    [...referenced].flatMap((contentId) => {
      const place = plan.selectedPlaces[contentId];
      return place ? [[contentId, place]] : [];
    }),
  );
}

function findMissingRequestedPlaces(
  requestedPlaces: string[],
  candidates: TourPlaceSnapshot[],
): ExcludedRequestedPlace[] {
  const titles = new Set(candidates.map((candidate) => comparableTitle(candidate.title)));
  return requestedPlaces.flatMap((input) =>
    titles.has(comparableTitle(input))
      ? []
      : [{ input, reason: "TOURAPI_NOT_FOUND" as const }],
  );
}

function pointForPlace(place: TourPlaceSnapshot): PlanmeRoutePoint {
  return { ref: place.contentId, coordinate: place.coordinate };
}

function countVisits(plan: TripPlan) {
  return plan.days.reduce(
    (sum, day) =>
      sum +
      day.visits.filter(
        (visit) => plan.selectedPlaces[visit.contentId]?.contentTypeId !== 39,
      ).length,
    0,
  );
}

function segmentMinutes(segment: RouteSegment) {
  return Math.max(1, Math.ceil(segment.durationSeconds / 60));
}

function totalRouteMinutes(segments: RouteSegment[]) {
  return segments.reduce((sum, segment) => sum + segmentMinutes(segment), 0);
}

function requireAnchor(
  result: PlanmeAnchorGeocodeResult,
  notFoundCode: "ORIGIN_NOT_RESOLVED" | "DESTINATION_NOT_RESOLVED",
) {
  if (result.status === "ready") {
    return result.coordinate;
  }
  if (result.status === "not_found") {
    throw new OrchestratorFailure(notFoundCode);
  }
  throw new OrchestratorFailure(
    result.errorCode.includes("CONFIGURATION")
      ? "INTERNAL_CONFIGURATION_ERROR"
      : notFoundCode,
  );
}

function regionAnchorQuery(region: TourRegion) {
  return [region.regionName, region.districtName].filter(Boolean).join(" ");
}

function uniqueTexts(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function calculateTravelEndDate(startDate: string | undefined, durationDays: number) {
  if (!startDate) {
    return undefined;
  }
  const value = new Date(`${startDate}T00:00:00.000Z`);
  if (!Number.isFinite(value.getTime())) {
    return undefined;
  }
  value.setUTCDate(value.getUTCDate() + durationDays - 1);
  return value.toISOString().slice(0, 10);
}

function comparableTitle(value: string) {
  return normalizeTourTitle(value).toLocaleLowerCase("ko");
}

function retryAfterMs(meta: ItineraryJobMeta, nowMs: number) {
  const ageMs = Math.max(0, nowMs - Date.parse(meta.updatedAt));
  return Math.min(2_000, 500 + Math.floor(ageMs / 2_000) * 250);
}

function minimumPhaseBudgetMs(phase: ItineraryPhase) {
  if (phase === "collecting_candidates" || phase === "routing") {
    return 5_000;
  }
  if (phase === "arranging" || phase === "resolving_anchors") {
    return 3_000;
  }
  return 500;
}

function safeFailureMessage(errorCode: string) {
  if (errorCode === "ORIGIN_NOT_RESOLVED") {
    return "출발지를 확인할 수 없습니다.";
  }
  if (errorCode === "DESTINATION_NOT_RESOLVED") {
    return "목적지를 확인할 수 없습니다.";
  }
  if (errorCode === "TOURAPI_CANDIDATES_INSUFFICIENT") {
    return "일정을 만들 수 있는 장소를 충분히 확인하지 못했습니다.";
  }
  if (errorCode === "TIME_BUDGET_EXCEEDED") {
    return "제한 시간 안에 안전한 일정을 완성하지 못했습니다.";
  }
  return "안전한 여행 일정을 완성하지 못했습니다.";
}

async function digestValue(value: object) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function toJsonValue(
  value:
    | QueuedPayload
    | AnchorPayload
    | CandidatePayload
    | PlanPayload
    | RoutingPayload
    | RoutingProgressPayload,
) {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function routeCacheKey(input: {
  from: PlanmeRoutePoint;
  to: PlanmeRoutePoint;
  transportMode: "drive" | "transit";
}) {
  return [input.transportMode, input.from.ref, input.to.ref].join(":");
}

async function runWithinDeadline(
  task: (signal: AbortSignal) => Promise<ItineraryJobResponse | null>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
) {
  if (externalSignal?.aborted) {
    return false;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  externalSignal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, timeoutMs);
  const result = await Promise.race([
    task(controller.signal).then(
      () => !controller.signal.aborted,
      (error) => {
        if (controller.signal.aborted) {
          return false;
        }
        throw error;
      },
    ),
    new Promise<false>((resolve) => {
      controller.signal.addEventListener("abort", () => resolve(false), {
        once: true,
      });
    }),
  ]);
  clearTimeout(timeout);
  externalSignal?.removeEventListener("abort", abort);
  return result;
}

function removeCandidatesByType(
  candidates: Map<string, TourPlaceSnapshot>,
  contentTypeId: AllowedTourContentTypeId,
) {
  for (const [contentId, candidate] of candidates) {
    if (candidate.contentTypeId === contentTypeId) {
      candidates.delete(contentId);
    }
  }
}

class RouteBatchYield extends Error {
  constructor() {
    super("ROUTE_BATCH_YIELD");
    this.name = "RouteBatchYield";
  }
}

class OrchestratorFailure extends Error {
  readonly errorCode: string;

  constructor(errorCode: string) {
    super(errorCode);
    this.name = "OrchestratorFailure";
    this.errorCode = errorCode;
  }
}
