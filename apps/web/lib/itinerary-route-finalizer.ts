import type {
  ItineraryDay,
  PlanmeItinerary,
  RoutePlan,
  RouteStop,
} from "@planme/core";
import { resolveMissingItineraryCoordinates } from "./itinerary-coordinate-resolver";
import { computeNaverDirectionsRoute } from "./route-providers/naver-directions";
import { computeOdsayTransitRoute } from "./route-providers/odsay";
import { formatRouteDuration } from "./route-providers/shared";
import {
  RouteProviderError,
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
  readonly provider?: "naver-directions" | "odsay";
  readonly retried: boolean;
  readonly routeId?: "standard" | "carryme";
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
      provider?: "naver-directions" | "odsay";
      retried?: boolean;
      routeId?: "standard" | "carryme";
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
    this.provider = context.provider;
    this.retried = context.retried ?? false;
    this.routeId = context.routeId;
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
  computeTransitRoute?: typeof computeOdsayTransitRoute;
  timeoutMs?: number;
};

/** Finalizes every day and comparison route while preserving all AI timeline arrays byte-for-byte. */
export async function finalizeItineraryRoutes(
  itinerary: PlanmeItinerary,
  options: RouteFinalizationOptions = {},
): Promise<PlanmeItinerary> {
  const timelineSnapshot = serializeTimelineArrays(itinerary.days);
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
    const results = await runRouteTasks(
      tasks,
      coordinateResolvedItinerary.transportMode,
      controller.signal,
      options,
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

    if (serializeTimelineArrays(finalizedItinerary.days) !== timelineSnapshot) {
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

/** Runs at most two complete comparison routes concurrently. */
async function runRouteTasks(
  tasks: RouteTask[],
  transportMode: PlanmeItinerary["transportMode"],
  signal: AbortSignal,
  options: RouteFinalizationOptions,
) {
  const results: RouteTaskResult[] = [];
  const taskController = new AbortController();
  const abortTasks = () => taskController.abort(signal.reason);
  let firstError: Error | null = null;
  let nextIndex = 0;

  if (signal.aborted) {
    taskController.abort(signal.reason);
  } else {
    signal.addEventListener("abort", abortTasks, { once: true });
  }

  try {
    while (!firstError && nextIndex < tasks.length) {
      const batch = tasks.slice(
        nextIndex,
        nextIndex + ROUTE_FINALIZATION_CONCURRENCY,
      );
      nextIndex += batch.length;

      // A batch boundary prevents the next day from starting after either comparison fails.
      await Promise.all(
        batch.map(async (task) => {
          try {
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
                    taskController.signal,
                  )
                : await (options.computeTransitRoute ?? computeOdsayTransitRoute)(
                    stops,
                    taskController.signal,
                  );

            results.push({ ...task, result });
          } catch (error) {
            if (!firstError) {
              firstError = createRouteTaskError(
                error instanceof Error ? error : null,
                task,
                transportMode,
              );
              // The first failed comparison route cancels every in-flight and unscheduled sibling.
              taskController.abort(firstError);
            }
          }
        }),
      );
    }
  } finally {
    signal.removeEventListener("abort", abortTasks);
  }

  if (firstError) {
    throw firstError;
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
  return days.map((day, dayIndex) => {
    const standard = getTaskResult(taskResults, dayIndex, "standard");
    const carryme = getTaskResult(taskResults, dayIndex, "carryme");
    const standardRoute = applyProviderResult(day.standard, standard.result, transportMode);
    const carrymeRoute = applyProviderResult(day.carryme, carryme.result, transportMode);

    return {
      ...day,
      carryme: carrymeRoute,
      savingMinutes: Math.max(0, standardRoute.durationMinutes - carrymeRoute.durationMinutes),
      standard: standardRoute,
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

  return {
    ...route,
    durationLabel: formatRouteDuration(result.totalDurationSeconds),
    durationMinutes,
    geoPath: undefined,
    geoSegments: geoSegments.length > 0 ? geoSegments : undefined,
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
    placeId: stop.placeId,
    placeSourceRef: stop.placeSourceRef,
    role: stop.role,
  }));
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

  const savedDurationLabel =
    firstDay.savingMinutes > 0
      ? `${formatRouteDuration(firstDay.savingMinutes * 60)} 절약`
      : "시간 절약 없음 · 짐 없이 바로 이동";

  return {
    ...itinerary,
    carrymeSaving: savedDurationLabel,
    days,
    savedDurationLabel,
    totalDurationLabel: `${firstDay.standard.durationLabel} → ${firstDay.carryme.durationLabel}`,
  };
}

/** Serializes only user-visible AI timeline arrays for byte-level invariance checks. */
function serializeTimelineArrays(days: ItineraryDay[]) {
  return JSON.stringify(
    days.map((day) => ({
      carrymeTimeline: day.carrymeTimeline,
      standardTimeline: day.standardTimeline,
      timeline: day.timeline,
    })),
  );
}
