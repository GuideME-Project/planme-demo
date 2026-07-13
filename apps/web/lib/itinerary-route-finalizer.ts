import type {
  ItineraryDay,
  PlanmeItinerary,
  RoutePlan,
  RouteStop,
  TimelineEvent,
} from "@planme/core";
import { resolveMissingItineraryCoordinates } from "./itinerary-coordinate-resolver";
import { computeNaverDirectionsRoute } from "./route-providers/naver-directions";
import {
  computeOdsayTransitRoute,
  type OdsayTransitRouteOptions,
} from "./route-providers/odsay";
import {
  createTransitRecoveryRuntime,
  RouteProviderRuntimeError,
  type TransitRecoveryRuntime,
} from "./route-segment-cache";
import { formatRouteDuration } from "./route-providers/shared";
import {
  RouteProviderError,
  TransitAccessDecisionError,
  type RouteProviderResult,
  type RouteProviderStop,
} from "./route-providers/types";

export const ROUTE_FINALIZATION_TIMEOUT_MS = 40_000;
const ROUTE_FINALIZATION_CONCURRENCY = 2;

export class RouteFinalizationTimeoutError extends Error {
  /** Creates the stable timeout error returned by the finalization API. */
  constructor() {
    super("전체 일정 경로 계산이 40초를 초과했습니다.");
    this.name = "RouteFinalizationTimeoutError";
  }
}

export class RouteFinalizationError extends Error {
  readonly dayIndex?: number;
  readonly destinationCoordinate?: RouteProviderStop["coordinate"];
  readonly destinationPlaceName?: string;
  readonly internalCode: string;
  readonly originCoordinate?: RouteProviderStop["coordinate"];
  readonly originPlaceName?: string;
  readonly placeConstraint?: RouteProviderStop["placeConstraint"];
  readonly provider?: "naver-directions" | "odsay";
  readonly retried: boolean;
  readonly routeId?: "standard" | "carryme";
  readonly stopRef?: string;
  readonly transitAccessReason?: TransitAccessDecisionError["reason"];
  readonly segmentIndex?: number;
  readonly stage:
    | "coordinate_resolution"
    | "route_provider"
    | "route_result"
    | "timeline_validation";

  /** Wraps a provider failure without exposing credentials or request URLs. */
  constructor(
    message: string,
    context: {
      dayIndex?: number;
      destinationCoordinate?: RouteProviderStop["coordinate"];
      destinationPlaceName?: string;
      internalCode?: string;
      originCoordinate?: RouteProviderStop["coordinate"];
      originPlaceName?: string;
      placeConstraint?: RouteProviderStop["placeConstraint"];
      provider?: "naver-directions" | "odsay";
      retried?: boolean;
      routeId?: "standard" | "carryme";
      stopRef?: string;
      transitAccessReason?: TransitAccessDecisionError["reason"];
      segmentIndex?: number;
      stage?: RouteFinalizationError["stage"];
    } = {},
  ) {
    super(message);
    this.name = "RouteFinalizationError";
    this.dayIndex = context.dayIndex;
    this.destinationCoordinate = context.destinationCoordinate;
    this.destinationPlaceName = context.destinationPlaceName;
    this.internalCode = context.internalCode ?? "ROUTE_FINALIZATION_FAILED";
    this.originCoordinate = context.originCoordinate;
    this.originPlaceName = context.originPlaceName;
    this.placeConstraint = context.placeConstraint;
    this.provider = context.provider;
    this.retried = context.retried ?? false;
    this.routeId = context.routeId;
    this.stopRef = context.stopRef;
    this.transitAccessReason = context.transitAccessReason;
    this.segmentIndex = context.segmentIndex;
    this.stage = context.stage ?? "route_result";
  }
}

type RouteTask = {
  dayIndex: number;
  routeId: "standard" | "carryme";
  route: RoutePlan;
};

type RouteTaskResult = RouteTask & {
  result: RouteProviderResult;
};

type RouteFinalizationOptions = {
  computeDriveRoute?: typeof computeNaverDirectionsRoute;
  computeTransitRoute?: (
    stops: RouteProviderStop[],
    signal: AbortSignal,
    options?: OdsayTransitRouteOptions,
  ) => Promise<RouteProviderResult>;
  allowTransitRecoverySmoke?: boolean;
  traceId?: string;
  transitRecoveryRuntime?: TransitRecoveryRuntime | null;
  timeoutMs?: number;
};

export type TransitPreflightResult = {
  estimatedSegmentCount: number;
  status: "accessible";
};

/** Finalizes every day and comparison route while preserving all AI timeline arrays byte-for-byte. */
export async function finalizeItineraryRoutes(
  itinerary: PlanmeItinerary,
  options: RouteFinalizationOptions = {},
): Promise<PlanmeItinerary> {
  const timelineSnapshot = serializeLegacyTimelineArrays(itinerary.days);
  const controller = new AbortController();
  const timeoutError = new RouteFinalizationTimeoutError();
  const timeout = setTimeout(
    () => controller.abort(timeoutError),
    options.timeoutMs ?? ROUTE_FINALIZATION_TIMEOUT_MS,
  );

  try {
    let coordinateResolvedItinerary: PlanmeItinerary;

    try {
      coordinateResolvedItinerary = await resolveMissingItineraryCoordinates(
        itinerary,
        controller.signal,
      );
    } catch {
      // Place names and coordinates are intentionally removed from the propagated error context.
      throw new RouteFinalizationError("일정 장소 좌표를 확인하지 못했습니다.", {
        internalCode: "ITINERARY_COORDINATE_RESOLUTION_FAILED",
        stage: "coordinate_resolution",
      });
    }
    const tasks = coordinateResolvedItinerary.days.flatMap((day, dayIndex): RouteTask[] => [
      { dayIndex, route: day.standard, routeId: "standard" },
      { dayIndex, route: day.carryme, routeId: "carryme" },
    ]);
    const recoveryRuntime = createFinalizationRecoveryRuntime(
      coordinateResolvedItinerary,
      options,
    );
    validateRecoveryStopContracts(tasks, recoveryRuntime);
    const results = await runRouteTasks(
      tasks,
      coordinateResolvedItinerary.transportMode,
      controller.signal,
      options,
      recoveryRuntime,
    );
    const finalizedDays = applyRouteTaskResults(
      coordinateResolvedItinerary.days,
      results,
      coordinateResolvedItinerary.transportMode,
    );
    const finalizedItinerary = createFinalizedItinerary(
      coordinateResolvedItinerary,
      finalizedDays,
    );

    if (serializeLegacyTimelineArrays(finalizedItinerary.days) !== timelineSnapshot) {
      throw new RouteFinalizationError("경로 계산 중 AI 시간표가 변경되었습니다.", {
        internalCode: "ITINERARY_TIMELINE_CHANGED",
        stage: "timeline_validation",
      });
    }

    return finalizedItinerary;
  } catch (error) {
    if (controller.signal.aborted) {
      throw timeoutError;
    }

    throw error instanceof RouteFinalizationError
      ? error
      : new RouteFinalizationError(
          error instanceof Error ? error.message : "일부 일정 경로를 계산하지 못했습니다.",
        );
  } finally {
    clearTimeout(timeout);
  }
}

/** Computes and caches every transit leg without writing a preview revision. */
export async function preflightTransitItineraryRoutes(
  itinerary: PlanmeItinerary,
  options: RouteFinalizationOptions = {},
): Promise<TransitPreflightResult> {
  if (itinerary.transportMode !== "transit") {
    throw new RouteFinalizationError("대중교통 일정만 사전검사할 수 있습니다.", {
      internalCode: "INVALID_TRANSIT_PREFLIGHT_REQUEST",
      stage: "route_result",
    });
  }

  const controller = new AbortController();
  const timeoutError = new RouteFinalizationTimeoutError();
  const timeout = setTimeout(
    () => controller.abort(timeoutError),
    options.timeoutMs ?? ROUTE_FINALIZATION_TIMEOUT_MS,
  );

  try {
    const coordinateResolvedItinerary = await resolveMissingItineraryCoordinates(
      itinerary,
      controller.signal,
    );
    const tasks = coordinateResolvedItinerary.days.flatMap((day, dayIndex): RouteTask[] => [
      { dayIndex, route: day.standard, routeId: "standard" },
      { dayIndex, route: day.carryme, routeId: "carryme" },
    ]);
    const recoveryRuntime = createFinalizationRecoveryRuntime(
      coordinateResolvedItinerary,
      options,
    );

    if (!recoveryRuntime) {
      throw new RouteFinalizationError("대중교통 접근 복구가 비활성 상태입니다.", {
        internalCode: "TRANSIT_RECOVERY_DISABLED",
        stage: "route_result",
      });
    }

    validateRecoveryStopContracts(tasks, recoveryRuntime);
    const results = await runRouteTasks(
      tasks,
      "transit",
      controller.signal,
      options,
      recoveryRuntime,
    );

    return {
      estimatedSegmentCount: results.reduce(
        (count, result) =>
          count + result.result.segments.filter(
            (segment) => segment.durationSource === "estimated",
          ).length,
        0,
      ),
      status: "accessible",
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw timeoutError;
    }

    throw error instanceof RouteFinalizationError
      ? error
      : new RouteFinalizationError("대중교통 접근성 사전검사에 실패했습니다.", {
          internalCode:
            error instanceof RouteProviderRuntimeError
              ? error.code
              : "TRANSIT_PREFLIGHT_FAILED",
          stage: "route_provider",
        });
  } finally {
    clearTimeout(timeout);
  }
}

/** Activates recovery only for transit requests carrying a shared trace identifier. */
function createFinalizationRecoveryRuntime(
  itinerary: PlanmeItinerary,
  options: RouteFinalizationOptions,
) {
  if (itinerary.transportMode !== "transit") {
    return null;
  }

  if (options.transitRecoveryRuntime !== undefined) {
    return options.transitRecoveryRuntime;
  }

  if (!options.traceId) {
    return null;
  }

  try {
    return createTransitRecoveryRuntime(options.traceId, {
      allowSmoke: options.allowTransitRecoverySmoke,
    });
  } catch (error) {
    throw new RouteFinalizationError("대중교통 복구 실행 설정을 확인하지 못했습니다.", {
      internalCode:
        error instanceof RouteProviderRuntimeError
          ? error.code
          : "ROUTE_PROVIDER_CONFIGURATION_ERROR",
      provider: "odsay",
      stage: "route_provider",
    });
  }
}

/** Rejects a new recovery flow before any provider call when stable stop semantics are missing. */
function validateRecoveryStopContracts(
  tasks: RouteTask[],
  runtime: TransitRecoveryRuntime | null,
) {
  if (!runtime) {
    return;
  }

  for (const task of tasks) {
    for (const stop of task.route.stops) {
      if (!stop.stopRef || !stop.placeConstraint) {
        throw new RouteFinalizationError("신규 대중교통 장소 참조 계약이 누락되었습니다.", {
          dayIndex: task.dayIndex,
          internalCode: "INVALID_TRANSIT_STOP_CONTRACT",
          routeId: task.routeId,
          stage: "route_result",
        });
      }
    }
  }
}

/** Runs at most two complete comparison routes concurrently. */
async function runRouteTasks(
  tasks: RouteTask[],
  transportMode: PlanmeItinerary["transportMode"],
  signal: AbortSignal,
  options: RouteFinalizationOptions,
  recoveryRuntime: TransitRecoveryRuntime | null,
) {
  const results: RouteTaskResult[] = [];
  let nextIndex = 0;

  while (nextIndex < tasks.length) {
      const batch = tasks.slice(
        nextIndex,
        nextIndex + ROUTE_FINALIZATION_CONCURRENCY,
      );
      nextIndex += batch.length;

      // A batch boundary prevents the next day from starting after either comparison fails.
      const batchResults = await Promise.allSettled(
        batch.map(async (task) => {
            const stops = createProviderStops({
              ...task.route,
              stops: normalizeRouteStops(task.route.stops, transportMode),
            });
            const result =
              stops.length < 2
                ? createNoMovementProviderResult()
                : transportMode === "drive"
                ? await (options.computeDriveRoute ?? computeNaverDirectionsRoute)(
                    stops,
                    signal,
                  )
                : await (options.computeTransitRoute ?? computeOdsayTransitRoute)(
                    stops,
                    signal,
                    { recoveryRuntime },
                  );

            return { ...task, result };
        }),
      );

      const failures = batchResults
        .map((result, index) =>
          result.status === "rejected"
            ? createRouteTaskError(
                result.reason instanceof Error ? result.reason : null,
                batch[index],
                transportMode,
              )
            : null,
        )
        .filter((error): error is RouteFinalizationError => error !== null);

      if (failures.length > 0) {
        throw failures.sort(compareRouteFinalizationErrors)[0];
      }

      results.push(
        ...batchResults
          .filter(
            (result): result is PromiseFulfilledResult<RouteTaskResult> =>
              result.status === "fulfilled",
          )
          .map((result) => result.value),
      );
  }

  return results;
}

/** Preserves provider diagnostics while removing request payload and provider response details. */
function createRouteTaskError(
  error: Error | null,
  task: RouteTask,
  transportMode: PlanmeItinerary["transportMode"],
) {
  if (error instanceof RouteFinalizationError) {
    return error;
  }

  if (error instanceof TransitAccessDecisionError) {
    return new RouteFinalizationError(error.message, {
      dayIndex: task.dayIndex,
      internalCode:
        error.status === "replacement_required"
          ? "TRANSIT_PLACE_REPLACEMENT_REQUIRED"
          : "USER_PLACE_CONFIRMATION_REQUIRED",
      placeConstraint: error.destinationStop.placeConstraint,
      provider: "odsay",
      routeId: task.routeId,
      segmentIndex: error.segmentIndex,
      stage: "route_provider",
      stopRef: error.destinationStop.stopRef,
      transitAccessReason: error.reason,
    });
  }

  if (error instanceof RouteProviderRuntimeError) {
    return new RouteFinalizationError("대중교통 복구 실행 설정을 확인하지 못했습니다.", {
      dayIndex: task.dayIndex,
      internalCode: error.code,
      provider: "odsay",
      routeId: task.routeId,
      stage: "route_provider",
    });
  }

  if (error instanceof RouteProviderError) {
    return new RouteFinalizationError("일부 일정 경로를 계산하지 못했습니다.", {
      dayIndex: task.dayIndex,
      ...createFailureLocationContext(error),
      internalCode: error.code,
      provider: transportMode === "drive" ? "naver-directions" : "odsay",
      retried: error.retried,
      routeId: task.routeId,
      stage: "route_provider",
    });
  }

  return new RouteFinalizationError("일부 일정 경로를 계산하지 못했습니다.", {
    dayIndex: task.dayIndex,
    internalCode: "ROUTE_PROVIDER_UNCLASSIFIED_FAILURE",
    provider: transportMode === "drive" ? "naver-directions" : "odsay",
    routeId: task.routeId,
    stage: "route_provider",
  });
}

/** Selects the same domain failure regardless of provider completion timing. */
function compareRouteFinalizationErrors(
  left: RouteFinalizationError,
  right: RouteFinalizationError,
) {
  return (
    Number(isTransitDomainDecision(left)) - Number(isTransitDomainDecision(right)) ||
    (left.dayIndex ?? Number.MAX_SAFE_INTEGER) -
      (right.dayIndex ?? Number.MAX_SAFE_INTEGER) ||
    routeIdPriority(left.routeId) - routeIdPriority(right.routeId) ||
    (left.segmentIndex ?? Number.MAX_SAFE_INTEGER) -
      (right.segmentIndex ?? Number.MAX_SAFE_INTEGER) ||
    (left.stopRef ?? "").localeCompare(right.stopRef ?? "")
  );
}

function isTransitDomainDecision(error: RouteFinalizationError) {
  return error.internalCode === "TRANSIT_PLACE_REPLACEMENT_REQUIRED" ||
    error.internalCode === "USER_PLACE_CONFIRMATION_REQUIRED";
}

function routeIdPriority(routeId: RouteFinalizationError["routeId"]) {
  return routeId === "standard" ? 0 : routeId === "carryme" ? 1 : 2;
}

/** Keeps AI-authored places while excluding user origin and return locations from logs. */
function createFailureLocationContext(error: RouteProviderError) {
  const origin = createLoggableFailureStop(error.originStop);
  const destination = createLoggableFailureStop(error.destinationStop);

  return {
    destinationCoordinate: destination?.coordinate,
    destinationPlaceName: destination?.label,
    originCoordinate: origin?.coordinate,
    originPlaceName: origin?.label,
    segmentIndex: error.segmentIndex,
  };
}

/** Excludes stops that represent the user-provided trip origin. */
function createLoggableFailureStop(stop: RouteProviderStop | undefined) {
  if (!stop || stop.role === "출발지" || stop.role === "복귀지") {
    return undefined;
  }

  return {
    coordinate: stop.coordinate,
    label: stop.label,
  };
}

/** Applies successful provider results without changing the existing AI timeline fields. */
function applyRouteTaskResults(
  days: ItineraryDay[],
  taskResults: RouteTaskResult[],
  transportMode: PlanmeItinerary["transportMode"],
) {
  return days.map((day, dayIndex): ItineraryDay => {
    const standard = getTaskResult(taskResults, dayIndex, "standard");
    const carryme = getTaskResult(taskResults, dayIndex, "carryme");
    const standardRoute = applyProviderResult(day.standard, standard.result, transportMode);
    const carrymeRoute = applyProviderResult(day.carryme, carryme.result, transportMode);
    const stableContract = hasStableDayTimelineContract(day);
    const standardTimeline = stableContract
      ? adjustTimelineEvents(day.standardTimeline ?? [], standardRoute, standard.result, {
          dayIndex,
          routeId: "standard",
          sourceRoute: day.standard,
        })
      : day.standardTimeline;
    const adjustedCarrymeTimeline = stableContract
      ? adjustTimelineEvents(day.carrymeTimeline ?? [], carrymeRoute, carryme.result, {
          dayIndex,
          routeId: "carryme",
          sourceRoute: day.carryme,
        })
      : day.carrymeTimeline;
    const adjustedTimeline = stableContract
      ? adjustTimelineEvents(day.timeline, carrymeRoute, carryme.result, {
          dayIndex,
          routeId: "carryme",
          sourceRoute: day.carryme,
        })
      : day.timeline;
    const carrymeTimeline = stableContract
      ? alignCarrymeDeliveryTimes(adjustedCarrymeTimeline ?? [], standardTimeline ?? [])
      : adjustedCarrymeTimeline;
    const timeline = stableContract
      ? alignCarrymeDeliveryTimes(adjustedTimeline, standardTimeline ?? [])
      : adjustedTimeline;
    const hasEstimatedDuration = stableContract &&
      (standardRoute.durationSource === "estimated" ||
        carrymeRoute.durationSource === "estimated");

    return {
      ...day,
      carryme: carrymeRoute,
      carrymeTimeline: hasEstimatedDuration
        ? hideTimelineSavings(carrymeTimeline)
        : carrymeTimeline,
      savingMinutes: hasEstimatedDuration
        ? undefined
        : Math.max(0, standardRoute.durationMinutes - carrymeRoute.durationMinutes),
      savingStatus: hasEstimatedDuration ? "hidden_estimated" : "verified",
      standard: standardRoute,
      standardTimeline: hasEstimatedDuration
        ? hideTimelineSavings(standardTimeline)
        : standardTimeline,
      timeline: hasEstimatedDuration ? hideTimelineSavings(timeline) : timeline,
    };
  });
}

/** Finds a completed route result and treats any missing task as an atomic failure. */
function getTaskResult(
  results: RouteTaskResult[],
  dayIndex: number,
  routeId: RouteTask["routeId"],
) {
  const result = results.find(
    (candidate) => candidate.dayIndex === dayIndex && candidate.routeId === routeId,
  );

  if (!result) {
    throw new RouteFinalizationError("일부 일정 경로 계산 결과가 누락되었습니다.", {
      dayIndex,
      internalCode: "ROUTE_TASK_RESULT_MISSING",
      routeId,
      stage: "route_result",
    });
  }

  return result;
}

/** Replaces only route-provider fields and keeps the AI-authored timeline elsewhere untouched. */
function applyProviderResult(
  route: RoutePlan,
  result: RouteProviderResult,
  transportMode: PlanmeItinerary["transportMode"],
): RoutePlan {
  const stops = normalizeRouteStops(route.stops, transportMode);
  const geoSegments = result.segments
    .flatMap((segment) => segment.paths)
    .filter((path) => path.length > 2);
  const durationMinutes = Math.max(0, Math.round(result.totalDurationSeconds / 60));
  const estimatedSegmentIndexes = result.segments
    .map((segment, index) => segment.durationSource === "estimated" ? index : -1)
    .filter((index) => index >= 0);

  return {
    ...route,
    durationSource: estimatedSegmentIndexes.length > 0 ? "estimated" : "provider",
    durationLabel: formatRouteDuration(result.totalDurationSeconds),
    durationMinutes,
    geoPath: undefined,
    geoSegments: geoSegments.length > 0 ? geoSegments : undefined,
    estimatedSegmentIndexes:
      estimatedSegmentIndexes.length > 0 ? estimatedSegmentIndexes : undefined,
    routeText: stops.map((stop) => stop.label).join(" → "),
    stops,
    transitMarkers: result.transitMarkers.length > 0 ? result.transitMarkers : undefined,
  };
}

/** Represents a route whose adjacent duplicate normalization leaves no movement leg. */
function createNoMovementProviderResult(): RouteProviderResult {
  return {
    geometryStatus: "complete",
    segments: [],
    totalDistanceMeters: 0,
    totalDurationSeconds: 0,
    transitMarkers: [],
  };
}

/** Removes zero-distance adjacent stops and applies the itinerary-wide transport mode. */
function normalizeRouteStops(stops: RouteStop[], transportMode: PlanmeItinerary["transportMode"]) {
  return stops.reduce<RouteStop[]>((normalized, stop) => {
    const normalizedStop = { ...stop, mode: transportMode };
    const previous = normalized[normalized.length - 1];

    if (previous && isSameRouteStop(previous, normalizedStop)) {
      // Keep the later AI event metadata while dropping only its zero-distance provider leg.
      normalized[normalized.length - 1] = normalizedStop;
      return normalized;
    }

    normalized.push(normalizedStop);
    return normalized;
  }, []);
}

/** Compares adjacent route stops by provider identity, coordinate, then label. */
function isSameRouteStop(left: RouteStop, right: RouteStop) {
  if (left.placeSourceRef && right.placeSourceRef) {
    return left.placeSourceRef === right.placeSourceRef;
  }

  if (left.placeId && right.placeId) {
    return left.placeId === right.placeId;
  }

  if (left.coordinate && right.coordinate) {
    return (
      left.coordinate.lat === right.coordinate.lat &&
      left.coordinate.lng === right.coordinate.lng
    );
  }

  return left.label.trim() === right.label.trim();
}

/** Converts one route plan into the minimal provider input contract. */
function createProviderStops(route: RoutePlan): RouteProviderStop[] {
  return route.stops.map((stop, index) => ({
    coordinate: stop.coordinate,
    id: `${route.id}-${index}-${stop.label}`,
    label: stop.label,
    placeConstraint: stop.placeConstraint,
    placeId: stop.placeId,
    placeSourceRef: stop.placeSourceRef,
    role: stop.role,
    stopRef: stop.stopRef,
  }));
}

/** Detects only the new server-generated stop and stay-duration contract. */
function hasStableDayTimelineContract(day: ItineraryDay) {
  const routeStops = [...day.standard.stops, ...day.carryme.stops];
  const events = [
    ...(day.standardTimeline ?? []),
    ...(day.carrymeTimeline ?? []),
    ...day.timeline,
  ];

  return routeStops.length > 0 &&
    routeStops.every((stop) => Boolean(stop.stopRef && stop.placeConstraint)) &&
    events.some((event) => event.stopRef !== undefined || event.stayDurationMinutes !== undefined);
}

/** Recomputes displayed event times from provider legs while preserving order and copy. */
function adjustTimelineEvents(
  events: TimelineEvent[],
  route: RoutePlan,
  result: RouteProviderResult,
  context: {
    dayIndex: number;
    routeId: "standard" | "carryme";
    sourceRoute: RoutePlan;
  },
) {
  if (events.length === 0) {
    return events;
  }

  let cursorMinutes = parseTimelineMinutes(events[0].time);
  let lastStopIndex: number | null = null;

  return events.map((event, eventIndex) => {
    if (!Number.isInteger(event.stayDurationMinutes) || (event.stayDurationMinutes ?? -1) < 0) {
      throw new RouteFinalizationError("시간표 체류시간 계약이 올바르지 않습니다.", {
        dayIndex: context.dayIndex,
        internalCode: "INVALID_TIMELINE_STAY_DURATION",
        routeId: context.routeId,
        stage: "timeline_validation",
        stopRef: event.stopRef,
      });
    }

    if (eventIndex > 0) {
      cursorMinutes += events[eventIndex - 1].stayDurationMinutes ?? 0;
    }

    if (event.stopRef) {
      const stopIndex = findTimelineStopIndex(
        event.stopRef,
        route,
        context.sourceRoute,
      );

      if (stopIndex < 0) {
        throw new RouteFinalizationError("시간표 장소 참조 계약이 올바르지 않습니다.", {
          dayIndex: context.dayIndex,
          internalCode: "INVALID_TIMELINE_STOP_REFERENCE",
          routeId: context.routeId,
          stage: "timeline_validation",
          stopRef: event.stopRef,
        });
      }

      if (lastStopIndex !== null && stopIndex < lastStopIndex) {
        throw new RouteFinalizationError("시간표 장소 순서 계약이 올바르지 않습니다.", {
          dayIndex: context.dayIndex,
          internalCode: "INVALID_TIMELINE_STOP_ORDER",
          routeId: context.routeId,
          stage: "timeline_validation",
          stopRef: event.stopRef,
        });
      }

      if (lastStopIndex !== null) {
        const travelSeconds = result.segments
          .slice(lastStopIndex, stopIndex)
          .reduce((sum, segment) => sum + segment.durationSeconds, 0);
        cursorMinutes += Math.round(travelSeconds / 60);
      }

      lastStopIndex = stopIndex;
    }

    if (cursorMinutes >= 24 * 60) {
      throw new RouteFinalizationError("경로 보정 결과가 같은 일차의 날짜 경계를 넘었습니다.", {
        dayIndex: context.dayIndex,
        internalCode: "TIMELINE_DATE_BOUNDARY_EXCEEDED",
        routeId: context.routeId,
        stage: "timeline_validation",
        stopRef: event.stopRef,
      });
    }

    return {
      ...event,
      time: formatTimelineMinutes(cursorMinutes),
    };
  });
}

/** Maps a timeline reference through adjacent same-place route normalization. */
function findTimelineStopIndex(
  stopRef: string,
  route: RoutePlan,
  sourceRoute: RoutePlan,
) {
  const directIndex = route.stops.findIndex((stop) => stop.stopRef === stopRef);

  if (directIndex >= 0) {
    return directIndex;
  }

  const sourceStop = sourceRoute.stops.find((stop) => stop.stopRef === stopRef);

  if (!sourceStop) {
    return -1;
  }

  return route.stops.findIndex((stop) => isSameRouteStop(stop, sourceStop));
}

function hideTimelineSavings(events: TimelineEvent[]): TimelineEvent[];
function hideTimelineSavings(events: TimelineEvent[] | undefined): TimelineEvent[] | undefined;
function hideTimelineSavings(
  events: TimelineEvent[] | undefined,
): TimelineEvent[] | undefined {
  return events?.map((event) => ({ ...event, savingLabel: undefined }));
}

/** Keeps luggage arrival at the same lodging time shown in the Standard schedule. */
function alignCarrymeDeliveryTimes(
  carrymeEvents: TimelineEvent[],
  standardEvents: TimelineEvent[],
) {
  const standardTimes = new Map(
    standardEvents
      .filter((event) => event.stopRef)
      .map((event) => [event.stopRef!, event.time]),
  );

  return carrymeEvents.map((event) =>
    event.category === "carryme" && event.stopRef && standardTimes.has(event.stopRef)
      ? { ...event, time: standardTimes.get(event.stopRef)! }
      : event,
  );
}

function parseTimelineMinutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);

  if (!match || !Number.isInteger(hours) || hours < 0 || hours > 23 ||
      !Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
    throw new RouteFinalizationError("시간표 시작 시각 형식이 올바르지 않습니다.", {
      internalCode: "INVALID_TIMELINE_TIME",
      stage: "timeline_validation",
    });
  }

  return hours * 60 + minutes;
}

function formatTimelineMinutes(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Updates itinerary-level comparison labels from the first finalized day. */
function createFinalizedItinerary(itinerary: PlanmeItinerary, days: ItineraryDay[]) {
  const firstDay = days[0];

  if (!firstDay) {
    throw new RouteFinalizationError("최종화할 일정 일차가 없습니다.", {
      internalCode: "ITINERARY_DAY_MISSING",
      stage: "route_result",
    });
  }

  const hideSavings = firstDay.savingStatus === "hidden_estimated";
  const savingMinutes = firstDay.savingMinutes ?? 0;
  const savedDurationLabel = hideSavings
    ? undefined
    : savingMinutes > 0
      ? `${formatRouteDuration(savingMinutes * 60)} 절약`
      : "시간 절약 없음 · 짐 없이 바로 이동";

  return {
    ...itinerary,
    carrymeSaving: hideSavings ? undefined : savedDurationLabel,
    days,
    savedDurationLabel,
    totalDurationLabel: `${firstDay.standard.durationLabel} → ${firstDay.carryme.durationLabel}`,
  };
}

/** Serializes only legacy timeline arrays that cannot be safely mapped to route stops. */
function serializeLegacyTimelineArrays(days: ItineraryDay[]) {
  return JSON.stringify(
    days.map((day) =>
      hasStableDayTimelineContract(day)
        ? null
        : {
            carrymeTimeline: day.carrymeTimeline,
            standardTimeline: day.standardTimeline,
            timeline: day.timeline,
          },
    ),
  );
}
