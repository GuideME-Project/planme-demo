import type {
  PlanmeDraftDay,
  PlanmeDraftPreviewRequest,
  PlanmeDraftRouteStop,
  PlanmeDraftStop,
  PlanmeDraftTimelineEvent,
} from "./draft-itineraries.js";
import type { PlanmeStopRole, PlanmeTransportMode } from "./mock-data.js";

export type PlanmeDraftDomainContractRoute = "standard" | "carryme";

export type PlanmeDraftDomainContractIssueCode =
  | "invalid_requested_duration_days"
  | "duration_days_mismatch"
  | "missing_origin"
  | "missing_route_stops"
  | "missing_day_visit"
  | "missing_day_lodging"
  | "ambiguous_day_lodging"
  | "route_start_mismatch"
  | "route_end_mismatch"
  | "comparison_start_mismatch"
  | "comparison_end_mismatch"
  | "comparison_visit_sequence_mismatch"
  | "day_boundary_mismatch"
  | "final_return_mismatch"
  | "nonfinal_lodging_end_missing"
  | "carryme_lodging_detour"
  | "standard_lodging_detour_missing"
  | "transport_mode_mismatch"
  | "missing_route_timeline"
  | "invalid_timeline_stop_index"
  | "missing_timeline_stop_reference"
  | "duplicate_timeline_stop_reference"
  | "carryme_delivery_references_traveler_stop"
  | "missing_carryme_delivery"
  | "duplicate_carryme_delivery"
  | "unexpected_carryme_delivery"
  | "carryme_delivery_target_missing"
  | "carryme_delivery_target_mismatch"
  | "carryme_delivery_not_after_departure"
  | "carryme_delivery_after_traveler_arrival"
  | "standard_contains_carryme_delivery"
  | "invalid_timeline_time"
  | "timeline_order_invalid"
  | "timeline_stay_overlap"
  | "timeline_route_order_invalid"
  | "missing_timeline_anchor_time";

export type PlanmeDraftDomainContractIssue = {
  code: PlanmeDraftDomainContractIssueCode;
  message: string;
  severity: "error" | "warning";
  dayIndex?: number;
  route?: PlanmeDraftDomainContractRoute;
  stopIndex?: number;
  eventIndex?: number;
};

export type PlanmeDraftDomainContractInput = {
  draft: PlanmeDraftPreviewRequest;
  durationDays: number;
  transportMode: PlanmeTransportMode;
  origin: PlanmeDraftRouteStop;
};

export type PlanmeDraftDomainContractNormalizationResult =
  | {
      ok: true;
      draft: PlanmeDraftPreviewRequest;
      issues: PlanmeDraftDomainContractIssue[];
    }
  | {
      ok: false;
      draft: null;
      issues: PlanmeDraftDomainContractIssue[];
    };

type SourceRoutes = {
  standard: PlanmeDraftRouteStop[];
  carryme: PlanmeDraftRouteStop[];
};

type RouteEntrySemantic = "start" | "visit" | "lodging_detour" | "end";

type RouteEntry = {
  stop: PlanmeDraftRouteStop;
  minimumStayDurationMinutes?: number;
  originalIndex: number | null;
  semantic: RouteEntrySemantic;
};

type NormalizedRoute = {
  entries: RouteEntry[];
  originalIndexMap: ReadonlyMap<number, number | null>;
  stops: PlanmeDraftRouteStop[];
};

type TimelineNormalizationResult = {
  events: PlanmeDraftTimelineEvent[];
  issues: PlanmeDraftDomainContractIssue[];
};

type IndexedTimelineEvent = {
  event: PlanmeDraftTimelineEvent;
  sourceOrder: number;
};

const STOP_ROLES: readonly PlanmeStopRole[] = ["출발지", "방문지", "숙소", "복귀지"];
const LUGGAGE_DELIVERY_PATTERN =
  /(?:(?:짐|수하물).{0,30}?(?:배송|도착)|(?:배송|도착).{0,30}?(?:짐|수하물))/;
const SYNTHETIC_EVENT_INTERVAL_MINUTES = 15;

/**
 * Rebuilds AI-authored route boundaries from server-confirmed trip facts.
 *
 * The function fails closed. It never invents missing days or chooses between
 * multiple physical lodging candidates. Callers may persist only an `ok: true`
 * result.
 */
export function normalizePlanmeDraftDomainContract(
  input: PlanmeDraftDomainContractInput,
): PlanmeDraftDomainContractNormalizationResult {
  const preparationIssues = validateNormalizationPrerequisites(input);

  if (hasError(preparationIssues)) {
    return { ok: false, draft: null, issues: preparationIssues };
  }

  const sourceRoutes = input.draft.days.map(getSourceRoutes);
  const lodgingResult = resolveLodgings(
    sourceRoutes,
    input.durationDays,
    input.origin,
    input.transportMode,
  );

  if (hasError(lodgingResult.issues)) {
    return { ok: false, draft: null, issues: lodgingResult.issues };
  }

  const normalizationIssues: PlanmeDraftDomainContractIssue[] = [];
  const normalizedDays = input.draft.days.map((day, dayIndex) => {
    const isFinalDay = dayIndex === input.durationDays - 1;
    const startPlace = dayIndex === 0 ? input.origin : lodgingResult.lodgings[dayIndex - 1];
    const endPlace = isFinalDay ? input.origin : lodgingResult.lodgings[dayIndex];

    if (!startPlace || !endPlace) {
      return day;
    }

    const standardRoute = normalizeRoute({
      desiredEnd: endPlace,
      desiredStart: startPlace,
      isFinalDay,
      lodging: isFinalDay ? null : endPlace,
      route: "standard",
      sourceStops: sourceRoutes[dayIndex]?.standard ?? [],
      transportMode: input.transportMode,
    });
    const carrymeRoute = normalizeRoute({
      desiredEnd: endPlace,
      desiredStart: startPlace,
      isFinalDay,
      lodging: isFinalDay ? null : endPlace,
      route: "carryme",
      sourceStops: sourceRoutes[dayIndex]?.carryme ?? [],
      transportMode: input.transportMode,
    });
    const standardTimelineResult = normalizeRouteTimeline({
      dayIndex,
      entries: standardRoute.entries,
      originalIndexMap: standardRoute.originalIndexMap,
      route: "standard",
      sourceEvents: day.standardTimeline ?? day.timeline ?? [],
    });
    const carrymeTimelineResult = normalizeRouteTimeline({
      dayIndex,
      entries: carrymeRoute.entries,
      originalIndexMap: carrymeRoute.originalIndexMap,
      route: "carryme",
      sourceEvents: day.carrymeTimeline ?? day.timeline ?? [],
    });
    const carrymeDeliveryResult = normalizeCarrymeDeliveryContract({
      carrymeEntries: carrymeRoute.entries,
      carrymeEvents: carrymeTimelineResult.events,
      dayIndex,
      isFinalDay,
      standardEntries: standardRoute.entries,
      standardEvents: standardTimelineResult.events,
    });

    normalizationIssues.push(
      ...standardTimelineResult.issues,
      ...carrymeTimelineResult.issues,
      ...carrymeDeliveryResult.issues,
    );

    return {
      ...day,
      day: dayIndex + 1,
      // Keep the legacy pair coherent for older readers while route-specific
      // fields remain the authoritative comparison contract.
      stops: carrymeRoute.stops,
      standardStops: standardRoute.stops,
      carrymeStops: carrymeRoute.stops,
      standardTimeline: standardTimelineResult.events,
      carrymeTimeline: carrymeDeliveryResult.events,
      // Legacy consumers use the CarryME route as the unified comparison timeline.
      timeline: carrymeDeliveryResult.events,
      standardRouteText: createRouteText(standardRoute.stops),
      carrymeRouteText: createRouteText(carrymeRoute.stops),
    } satisfies PlanmeDraftDay;
  });

  if (hasError(normalizationIssues)) {
    return {
      ok: false,
      draft: null,
      issues: deduplicateIssues(normalizationIssues),
    };
  }

  const normalizedDraft: PlanmeDraftPreviewRequest = {
    ...input.draft,
    origin: input.origin.name.trim(),
    transportMode: input.transportMode,
    days: normalizedDays,
  };
  const validationIssues = validatePlanmeDraftDomainContract({
    ...input,
    draft: normalizedDraft,
  });
  const issues = deduplicateIssues([...normalizationIssues, ...validationIssues]);

  if (hasError(issues)) {
    return { ok: false, draft: null, issues };
  }

  return { ok: true, draft: normalizedDraft, issues };
}

/** Validates the deterministic domain contract without mutating the draft. */
export function validatePlanmeDraftDomainContract(
  input: PlanmeDraftDomainContractInput,
): PlanmeDraftDomainContractIssue[] {
  const issues = validateNormalizationPrerequisites(input);

  if (hasError(issues)) {
    return deduplicateIssues(issues);
  }

  let previousLodging: PlanmeDraftRouteStop | null = null;

  input.draft.days.forEach((day, dayIndex) => {
    const isFinalDay = dayIndex === input.durationDays - 1;
    const standardStops = day.standardStops ?? [];
    const carrymeStops = day.carrymeStops ?? [];
    const expectedStart = dayIndex === 0 ? input.origin : previousLodging;
    const standardEnd = standardStops.at(-1);
    const carrymeEnd = carrymeStops.at(-1);

    if (
      !standardStops.some((stop) => stop.role === "방문지") ||
      !carrymeStops.some((stop) => stop.role === "방문지")
    ) {
      issues.push(createIssue(
        "missing_day_visit",
        `${dayIndex + 1}일차 두 비교 경로에 실제 방문지가 하나 이상 필요합니다.`,
        { dayIndex },
      ));
    }

    if (
      dayIndex > 0 &&
      expectedStart &&
      (!standardStops[0] ||
        !carrymeStops[0] ||
        !isSamePhysicalStop(standardStops[0], expectedStart) ||
        !isSamePhysicalStop(carrymeStops[0], expectedStart))
    ) {
      issues.push(createIssue(
        "day_boundary_mismatch",
        `${dayIndex + 1}일차 출발지는 전날 숙소와 같아야 합니다.`,
        { dayIndex },
      ));
    }

    validateRouteStops(
      standardStops,
      "standard",
      dayIndex,
      expectedStart,
      isFinalDay ? input.origin : null,
      input.transportMode,
      issues,
    );
    validateRouteStops(
      carrymeStops,
      "carryme",
      dayIndex,
      expectedStart,
      isFinalDay ? input.origin : null,
      input.transportMode,
      issues,
    );

    if (standardStops.length > 0 && carrymeStops.length > 0) {
      if (!isSamePhysicalStop(standardStops[0], carrymeStops[0])) {
        issues.push(createIssue(
          "comparison_start_mismatch",
          `${dayIndex + 1}일차 Standard와 CarryME 출발지가 다릅니다.`,
          { dayIndex },
        ));
      }

      if (standardEnd && carrymeEnd && !isSamePhysicalStop(standardEnd, carrymeEnd)) {
        issues.push(createIssue(
          "comparison_end_mismatch",
          `${dayIndex + 1}일차 Standard와 CarryME 종료지가 다릅니다.`,
          { dayIndex },
        ));
      }

      const standardVisitSequence = standardStops.filter(
        (stop) => stop.role === "방문지",
      );
      const carrymeVisitSequence = carrymeStops.filter(
        (stop) => stop.role === "방문지",
      );
      const hasMatchingVisitSequence =
        standardVisitSequence.length === carrymeVisitSequence.length &&
        standardVisitSequence.every((stop, visitIndex) => {
          const carrymeVisit = carrymeVisitSequence[visitIndex];

          return Boolean(carrymeVisit && isSamePhysicalStop(stop, carrymeVisit));
        });

      if (!hasMatchingVisitSequence) {
        issues.push(createIssue(
          "comparison_visit_sequence_mismatch",
          `${dayIndex + 1}일차 Standard와 CarryME의 관광 장소와 순서가 다릅니다.`,
          { dayIndex },
        ));
      }
    }

    if (isFinalDay) {
      if (
        !standardEnd ||
        !carrymeEnd ||
        !isSamePhysicalStop(standardEnd, input.origin) ||
        !isSamePhysicalStop(carrymeEnd, input.origin) ||
        standardEnd.role !== "복귀지" ||
        carrymeEnd.role !== "복귀지"
      ) {
        issues.push(createIssue(
          "final_return_mismatch",
          `${dayIndex + 1}일차 최종 종료지는 서버가 확정한 출발지 복귀여야 합니다.`,
          { dayIndex },
        ));
      }
    } else if (
      !standardEnd ||
      !carrymeEnd ||
      standardEnd.role !== "숙소" ||
      carrymeEnd.role !== "숙소" ||
      !isSamePhysicalStop(standardEnd, carrymeEnd)
    ) {
      issues.push(createIssue(
        "nonfinal_lodging_end_missing",
        `${dayIndex + 1}일차 두 경로는 같은 실제 숙소에서 끝나야 합니다.`,
        { dayIndex },
      ));
    }

    if (!isFinalDay && standardEnd && carrymeEnd && isSamePhysicalStop(standardEnd, carrymeEnd)) {
      previousLodging = standardEnd;
      const standardStartsAtLodging = Boolean(
        standardStops[0] && isSamePhysicalStop(standardStops[0], standardEnd),
      );
      const standardHasVisit = standardStops.some((stop) => stop.role === "방문지");
      const standardDetourIndex = standardStops.findIndex(
        (stop, stopIndex) =>
          stopIndex > 0 &&
          stopIndex < standardStops.length - 1 &&
          stop.role === "숙소" &&
          isSamePhysicalStop(stop, standardEnd),
      );
      const firstVisitIndex = standardStops.findIndex((stop) => stop.role === "방문지");

      if (
        !standardStartsAtLodging &&
        standardHasVisit &&
        (standardDetourIndex < 0 ||
          (firstVisitIndex >= 0 && standardDetourIndex > firstVisitIndex))
      ) {
        issues.push(createIssue(
          "standard_lodging_detour_missing",
          `${dayIndex + 1}일차 Standard는 첫 관광 전에 숙소를 경유해야 합니다.`,
          { dayIndex, route: "standard" },
        ));
      }
    }

    if (carrymeStops.slice(1, -1).some((stop) => stop.role === "숙소")) {
      issues.push(createIssue(
        "carryme_lodging_detour",
        `${dayIndex + 1}일차 CarryME 여행자 경로에는 관광 전 숙소 경유가 없어야 합니다.`,
        { dayIndex, route: "carryme" },
      ));
    }

    validateRouteTimeline(
      day.standardTimeline,
      standardStops.length,
      "standard",
      dayIndex,
      issues,
    );
    validateRouteTimeline(
      day.carrymeTimeline,
      carrymeStops.length,
      "carryme",
      dayIndex,
      issues,
    );
    validateCarrymeDeliveryContract({
      carrymeEvents: day.carrymeTimeline,
      carrymeStops,
      dayIndex,
      isFinalDay,
      issues,
      standardEvents: day.standardTimeline,
      standardStops,
    });
  });

  return deduplicateIssues(issues);
}

function validateNormalizationPrerequisites(
  input: PlanmeDraftDomainContractInput,
): PlanmeDraftDomainContractIssue[] {
  const issues: PlanmeDraftDomainContractIssue[] = [];

  if (!Number.isInteger(input.durationDays) || input.durationDays < 1) {
    issues.push(createIssue(
      "invalid_requested_duration_days",
      "요청 여행 일수는 1 이상의 정수여야 합니다.",
    ));
  } else if (input.draft.days.length !== input.durationDays) {
    issues.push(createIssue(
      "duration_days_mismatch",
      `요청한 ${input.durationDays}일과 AI가 생성한 ${input.draft.days.length}일이 다릅니다.`,
    ));
  }

  if (!input.origin.name.trim()) {
    issues.push(createIssue("missing_origin", "서버가 해석한 출발지가 필요합니다."));
  }

  input.draft.days.forEach((day, dayIndex) => {
    const routes = getSourceRoutes(day);

    if (routes.standard.length === 0) {
      issues.push(createIssue(
        "missing_route_stops",
        `${dayIndex + 1}일차 Standard 경로가 필요합니다.`,
        { dayIndex, route: "standard" },
      ));
    }

    if (routes.carryme.length === 0) {
      issues.push(createIssue(
        "missing_route_stops",
        `${dayIndex + 1}일차 CarryME 경로가 필요합니다.`,
        { dayIndex, route: "carryme" },
      ));
    }
  });

  return issues;
}

function resolveLodgings(
  sourceRoutes: readonly SourceRoutes[],
  durationDays: number,
  origin: PlanmeDraftRouteStop,
  transportMode: PlanmeTransportMode,
) {
  const lodgings: Array<PlanmeDraftRouteStop | null> = [];
  const issues: PlanmeDraftDomainContractIssue[] = [];
  let previousLodging: PlanmeDraftRouteStop | null = null;

  for (let dayIndex = 0; dayIndex < durationDays - 1; dayIndex += 1) {
    const routes = sourceRoutes[dayIndex];
    const expectedStart = dayIndex === 0 ? origin : previousLodging;

    if (!routes || !expectedStart) {
      lodgings.push(null);
      continue;
    }

    const candidates = [...routes.standard, ...routes.carryme].filter((stop, stopIndex) => {
      if (stop.role !== "숙소" || isLuggageDeliveryStop(stop)) {
        return false;
      }

      // Each route contributes one first item. Exclude a previous-night lodging only
      // when it is already the expected start; a later repeat remains an end candidate.
      const routeLength = stopIndex < routes.standard.length
        ? routes.standard.length
        : routes.carryme.length;
      const routeIndex = stopIndex < routes.standard.length
        ? stopIndex
        : stopIndex - routes.standard.length;

      return !(
        routeLength > 0 &&
        routeIndex === 0 &&
        isSamePhysicalStop(stop, expectedStart)
      );
    });
    const candidatesByIdentity = new Map<string, PlanmeDraftRouteStop>();

    candidates.forEach((candidate) => {
      candidatesByIdentity.set(createPhysicalStopIdentity(candidate), candidate);
    });

    if (candidatesByIdentity.size === 0 && previousLodging) {
      lodgings.push(normalizeLodgingStop(previousLodging, transportMode));
      continue;
    }

    if (candidatesByIdentity.size === 0) {
      issues.push(createIssue(
        "missing_day_lodging",
        `${dayIndex + 1}일차 실제 숙소를 확인할 수 없습니다.`,
        { dayIndex },
      ));
      lodgings.push(null);
      continue;
    }

    if (candidatesByIdentity.size > 1) {
      issues.push(createIssue(
        "ambiguous_day_lodging",
        `${dayIndex + 1}일차 숙소 후보가 여러 장소로 충돌합니다.`,
        { dayIndex },
      ));
      lodgings.push(null);
      continue;
    }

    const lodging = normalizeLodgingStop(
      [...candidatesByIdentity.values()][0] as PlanmeDraftRouteStop,
      transportMode,
    );

    lodgings.push(lodging);
    previousLodging = lodging;
  }

  return { lodgings, issues };
}

function normalizeRoute({
  desiredEnd,
  desiredStart,
  isFinalDay,
  lodging,
  route,
  sourceStops,
  transportMode,
}: {
  desiredEnd: PlanmeDraftRouteStop;
  desiredStart: PlanmeDraftRouteStop;
  isFinalDay: boolean;
  lodging: PlanmeDraftRouteStop | null;
  route: PlanmeDraftDomainContractRoute;
  sourceStops: readonly PlanmeDraftRouteStop[];
  transportMode: PlanmeTransportMode;
}): NormalizedRoute {
  const normalizedSource = sourceStops.map((stop) => ({ ...stop, mode: transportMode }));
  const originalIndexMap = new Map<number, number | null>(
    normalizedSource.map((_stop, stopIndex) => [stopIndex, null]),
  );
  const firstStop = normalizedSource[0];
  const lastStopIndex = normalizedSource.length - 1;
  const lastStop = normalizedSource[lastStopIndex];
  const startOriginalIndex = firstStop &&
    (isSamePhysicalStop(firstStop, desiredStart) || firstStop.role === "출발지")
      ? 0
      : null;
  const endOriginalIndex = lastStop &&
    lastStopIndex !== startOriginalIndex &&
    (isSamePhysicalStop(lastStop, desiredEnd) || lastStop.role === "복귀지")
      ? lastStopIndex
      : null;
  const lodgingIndexes = lodging
    ? normalizedSource
        .map((stop, stopIndex) => ({ stop, stopIndex }))
        .filter(
          ({ stop, stopIndex }) =>
            stopIndex !== startOriginalIndex &&
            stop.role === "숙소" &&
            isSamePhysicalStop(stop, lodging),
        )
        .map(({ stopIndex }) => stopIndex)
    : [];
  let detourOriginalIndex: number | null = null;
  let lodgingEndOriginalIndex: number | null = null;

  if (!isFinalDay && lodging) {
    if (route === "standard" && !isSamePhysicalStop(desiredStart, lodging)) {
      const firstLodgingIndex = lodgingIndexes[0];
      const lastLodgingIndex = lodgingIndexes.at(-1);

      if (firstLodgingIndex !== undefined && lastLodgingIndex !== undefined) {
        const hasVisitAfterFirstLodging = normalizedSource
          .slice(firstLodgingIndex + 1)
          .some((stop) => stop.role !== "숙소" && stop.role !== "복귀지");

        if (firstLodgingIndex !== lastLodgingIndex) {
          detourOriginalIndex = firstLodgingIndex;
          lodgingEndOriginalIndex = lastLodgingIndex;
        } else if (hasVisitAfterFirstLodging) {
          detourOriginalIndex = firstLodgingIndex;
        } else {
          lodgingEndOriginalIndex = firstLodgingIndex;
        }
      }
    } else {
      lodgingEndOriginalIndex = lodgingIndexes.at(-1) ?? null;
    }
  }

  const entries: RouteEntry[] = [
    {
      stop: normalizeStartStop(desiredStart, transportMode),
      minimumStayDurationMinutes: desiredStart.role === "숙소" ? 15 : 0,
      originalIndex: startOriginalIndex,
      semantic: "start",
    },
  ];

  if (!isFinalDay && lodging && route === "standard" && !isSamePhysicalStop(desiredStart, lodging)) {
    entries.push({
      stop: normalizeLodgingStop(lodging, transportMode, "숙소 경유"),
      minimumStayDurationMinutes: 20,
      originalIndex: detourOriginalIndex,
      semantic: "lodging_detour",
    });
  }

  normalizedSource.forEach((stop, originalIndex) => {
    if (
      originalIndex === startOriginalIndex ||
      originalIndex === endOriginalIndex ||
      originalIndex === detourOriginalIndex ||
      originalIndex === lodgingEndOriginalIndex ||
      stop.role === "숙소" ||
      stop.role === "복귀지" ||
      (route === "carryme" && isLuggageDeliveryStop(stop))
    ) {
      return;
    }

    entries.push({
      stop: normalizeVisitStop(stop, transportMode),
      originalIndex,
      semantic: "visit",
    });
  });

  entries.push({
    stop: isFinalDay
      ? normalizeReturnStop(desiredEnd, transportMode)
      : normalizeLodgingStop(desiredEnd, transportMode),
    originalIndex: isFinalDay ? endOriginalIndex : lodgingEndOriginalIndex,
    semantic: "end",
  });

  entries.forEach((entry, normalizedIndex) => {
    if (entry.originalIndex !== null) {
      originalIndexMap.set(entry.originalIndex, normalizedIndex);
    }
  });

  return {
    entries,
    originalIndexMap,
    stops: entries.map((entry) => entry.stop),
  };
}

function normalizeRouteTimeline({
  dayIndex,
  entries,
  originalIndexMap,
  route,
  sourceEvents,
}: {
  dayIndex: number;
  entries: readonly RouteEntry[];
  originalIndexMap: ReadonlyMap<number, number | null>;
  route: PlanmeDraftDomainContractRoute;
  sourceEvents: readonly PlanmeDraftTimelineEvent[];
}): TimelineNormalizationResult {
  const issues: PlanmeDraftDomainContractIssue[] = [];
  const eventsByStopIndex = new Map<number, PlanmeDraftTimelineEvent>();
  const sideEvents: IndexedTimelineEvent[] = [];
  const unreferencedTravelerEvents: IndexedTimelineEvent[] = [];

  if (sourceEvents.length === 0) {
    issues.push(createIssue(
      "missing_route_timeline",
      `${dayIndex + 1}일차 ${routeLabel(route)} 타임라인이 필요합니다.`,
      { dayIndex, route },
    ));
  }

  sourceEvents.forEach((sourceEvent, eventIndex) => {
    const event = cloneTimelineEvent(sourceEvent);

    if (isLuggageDeliveryEvent(event)) {
      if (route === "carryme") {
        sideEvents.push({
          event: {
            ...event,
            category: "carryme",
            stopIndex: null,
            stayDurationMinutes: normalizeStayDuration(event.stayDurationMinutes),
          },
          sourceOrder: eventIndex,
        });
      }

      return;
    }

    if (event.stopIndex === null) {
      sideEvents.push({
        event: {
          ...event,
          stopIndex: null,
          stayDurationMinutes: normalizeStayDuration(event.stayDurationMinutes),
        },
        sourceOrder: eventIndex,
      });
      return;
    }

    if (event.stopIndex === undefined) {
      unreferencedTravelerEvents.push({ event, sourceOrder: eventIndex });
      return;
    }

    const normalizedStopIndex = originalIndexMap.get(event.stopIndex);

    if (normalizedStopIndex === undefined) {
      issues.push(createIssue(
        "invalid_timeline_stop_index",
        `${dayIndex + 1}일차 ${routeLabel(route)} 타임라인의 장소 참조가 원본 경로 범위를 벗어납니다.`,
        { dayIndex, route, eventIndex },
      ));
      return;
    }

    if (normalizedStopIndex !== null && !eventsByStopIndex.has(normalizedStopIndex)) {
      eventsByStopIndex.set(normalizedStopIndex, {
        ...event,
        stopIndex: normalizedStopIndex,
        stayDurationMinutes: normalizeStayDuration(event.stayDurationMinutes),
      });
    }
  });

  const unfilledIndexes = entries
    .map((_entry, stopIndex) => stopIndex)
    .filter((stopIndex) => !eventsByStopIndex.has(stopIndex));

  unreferencedTravelerEvents.forEach(({ event }, fallbackIndex) => {
    const stopIndex = unfilledIndexes[fallbackIndex];

    if (stopIndex === undefined) {
      sideEvents.push({
        event: {
          ...event,
          stopIndex: null,
          stayDurationMinutes: normalizeStayDuration(event.stayDurationMinutes),
        },
        sourceOrder: sourceEvents.length + fallbackIndex,
      });
      return;
    }

    eventsByStopIndex.set(stopIndex, {
      ...event,
      stopIndex,
      stayDurationMinutes: normalizeStayDuration(event.stayDurationMinutes),
    });
  });

  const fixedTimes = new Map<number, number>();

  eventsByStopIndex.forEach((event, stopIndex) => {
    const minutes = parseTimeMinutes(event.time);

    if (minutes !== null) {
      fixedTimes.set(stopIndex, minutes);
    }
  });

  if (entries.length > 0 && fixedTimes.size === 0) {
    issues.push(createIssue(
      "missing_timeline_anchor_time",
      `${dayIndex + 1}일차 ${routeLabel(route)} 경계 시각을 계산할 인접 타임라인이 없습니다.`,
      { dayIndex, route },
    ));
  }

  const travelerEvents = normalizeTravelerStayTimeline(entries.map((entry, stopIndex) => {
    const existing = eventsByStopIndex.get(stopIndex);
    const event = existing ?? createSyntheticTimelineEvent(
      entry,
      stopIndex,
      deriveSyntheticTime(stopIndex, entries.length, fixedTimes),
    );

    return normalizeBoundaryTimelineEvent(event, entry, stopIndex);
  }));

  return {
    events: mergeSideEvents(travelerEvents, sideEvents),
    issues,
  };
}

/**
 * Produces one deterministic luggage side event anchored to the Standard target visit.
 * Missing or duplicate model-authored delivery rows are normalized because the physical
 * target and its arrival time are already fixed by the route contract.
 */
function normalizeCarrymeDeliveryContract({
  carrymeEntries,
  carrymeEvents,
  dayIndex,
  isFinalDay,
  standardEntries,
  standardEvents,
}: {
  carrymeEntries: readonly RouteEntry[];
  carrymeEvents: readonly PlanmeDraftTimelineEvent[];
  dayIndex: number;
  isFinalDay: boolean;
  standardEntries: readonly RouteEntry[];
  standardEvents: readonly PlanmeDraftTimelineEvent[];
}): TimelineNormalizationResult {
  const issues: PlanmeDraftDomainContractIssue[] = [];
  const standardTargetIndex = findStandardDeliveryTargetIndex(standardEntries, isFinalDay);
  const standardTargetEntry = standardTargetIndex === null
    ? null
    : standardEntries[standardTargetIndex] ?? null;
  const carrymeTargetIndex = standardTargetEntry
    ? findLastPhysicalEntryIndex(carrymeEntries, standardTargetEntry.stop)
    : null;
  const standardTargetEvent = standardTargetIndex === null
    ? undefined
    : standardEvents.find((event) => event.stopIndex === standardTargetIndex);
  const carrymeDepartureEvent = carrymeEvents.find((event) => event.stopIndex === 0);
  const carrymeTargetEvent = carrymeTargetIndex === null
    ? undefined
    : carrymeEvents.find((event) => event.stopIndex === carrymeTargetIndex);
  const carrymeSourceEntry = carrymeEntries[0];
  const requiresDelivery = Boolean(
    carrymeSourceEntry &&
      standardTargetEntry &&
      !isSamePhysicalStop(carrymeSourceEntry.stop, standardTargetEntry.stop),
  );

  if (!requiresDelivery) {
    return {
      events: carrymeEvents.filter((event) => !isLuggageDeliveryEvent(event)),
      issues,
    };
  }

  if (
    !standardTargetEntry ||
    standardTargetIndex === null ||
    carrymeTargetIndex === null ||
    !standardTargetEvent ||
    !carrymeDepartureEvent ||
    !carrymeTargetEvent
  ) {
    issues.push(createIssue(
      "carryme_delivery_target_missing",
      `${dayIndex + 1}일차 CarryME 배송 대상을 시간표에서 확인할 수 없습니다.`,
      { dayIndex, route: "carryme" },
    ));

    return { events: [...carrymeEvents], issues };
  }

  const departureMinutes = parseTimeMinutes(carrymeDepartureEvent.time);
  const deliveryMinutes = parseTimeMinutes(standardTargetEvent.time);
  const travelerArrivalMinutes = parseTimeMinutes(carrymeTargetEvent.time);

  if (
    departureMinutes === null ||
    deliveryMinutes === null ||
    travelerArrivalMinutes === null
  ) {
    return { events: [...carrymeEvents], issues };
  }

  if (deliveryMinutes <= departureMinutes) {
    issues.push(createIssue(
      "carryme_delivery_not_after_departure",
      `${dayIndex + 1}일차 짐 도착은 여행자 출발 이후여야 합니다.`,
      { dayIndex, route: "carryme" },
    ));
  }

  if (deliveryMinutes > travelerArrivalMinutes) {
    issues.push(createIssue(
      "carryme_delivery_after_traveler_arrival",
      `${dayIndex + 1}일차 짐은 여행자보다 늦게 도착할 수 없습니다.`,
      { dayIndex, route: "carryme" },
    ));
  }

  if (hasError(issues)) {
    return { events: [...carrymeEvents], issues };
  }

  const authoredDelivery = carrymeEvents.find(isLuggageDeliveryEvent);
  const deliveryEvent: PlanmeDraftTimelineEvent = {
    ...(authoredDelivery ?? {
      description: "짐이 여행자보다 먼저 목적지에 도착합니다.",
      time: standardTargetEvent.time,
      title: "짐 도착",
    }),
    category: "carryme",
    description: `짐은 여행자보다 먼저 ${standardTargetEntry.stop.name}에 도착합니다.`,
    stayDurationMinutes: 0,
    stopIndex: null,
    time: standardTargetEvent.time,
    title: `짐 ${standardTargetEntry.stop.name} 도착`,
  };
  const travelerAndSideEvents = carrymeEvents.filter((event) => !isLuggageDeliveryEvent(event));

  return {
    events: mergeSideEvents(travelerAndSideEvents, [{ event: deliveryEvent, sourceOrder: 0 }]),
    issues,
  };
}

function findStandardDeliveryTargetIndex(
  entries: readonly RouteEntry[],
  isFinalDay: boolean,
) {
  if (entries.length === 0) {
    return null;
  }

  if (isFinalDay) {
    return entries.length - 1;
  }

  // When a later day starts and ends at the same lodging, index 0 is the source,
  // not a new parcel destination. Prefer a lodging reached after departure.
  const lodgingIndex = entries.findIndex(
    (entry, entryIndex) => entryIndex > 0 && entry.stop.role === "숙소",
  );

  return lodgingIndex >= 0 ? lodgingIndex : null;
}

function findLastPhysicalEntryIndex(
  entries: readonly RouteEntry[],
  target: PlanmeDraftRouteStop,
) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];

    if (entry && isSamePhysicalStop(entry.stop, target)) {
      return index;
    }
  }

  return null;
}

/** Rejects drafts whose luggage side event cannot represent the fixed delivery target. */
function validateCarrymeDeliveryContract({
  carrymeEvents,
  carrymeStops,
  dayIndex,
  isFinalDay,
  issues,
  standardEvents,
  standardStops,
}: {
  carrymeEvents: readonly PlanmeDraftTimelineEvent[] | undefined;
  carrymeStops: readonly PlanmeDraftRouteStop[];
  dayIndex: number;
  isFinalDay: boolean;
  issues: PlanmeDraftDomainContractIssue[];
  standardEvents: readonly PlanmeDraftTimelineEvent[] | undefined;
  standardStops: readonly PlanmeDraftRouteStop[];
}) {
  const deliveryEvents = carrymeEvents?.filter(isLuggageDeliveryEvent) ?? [];
  const expectedTargetStop = isFinalDay
    ? standardStops.at(-1)
    : standardStops.find((stop, stopIndex) => stopIndex > 0 && stop.role === "숙소");
  const sourceStop = standardStops[0];
  const requiresDelivery = Boolean(
    sourceStop &&
      expectedTargetStop &&
      !isSamePhysicalStop(sourceStop, expectedTargetStop),
  );

  if (!requiresDelivery) {
    if (deliveryEvents.length > 0) {
      issues.push(createIssue(
        "unexpected_carryme_delivery",
        `${dayIndex + 1}일차 출발지와 배송지가 같으면 CarryME 짐 배송을 만들지 않습니다.`,
        { dayIndex, route: "carryme" },
      ));
    }
    return;
  }

  if (deliveryEvents.length === 0) {
    issues.push(createIssue(
      "missing_carryme_delivery",
      `${dayIndex + 1}일차 CarryME 짐 배송 이벤트가 필요합니다.`,
      { dayIndex, route: "carryme" },
    ));
    return;
  }

  if (deliveryEvents.length > 1) {
    issues.push(createIssue(
      "duplicate_carryme_delivery",
      `${dayIndex + 1}일차 CarryME 짐 배송 이벤트는 하나여야 합니다.`,
      { dayIndex, route: "carryme" },
    ));
  }

  const standardTargetIndex = isFinalDay
    ? standardStops.length - 1
    : standardStops.findIndex(
        (stop, stopIndex) => stopIndex > 0 && stop.role === "숙소",
      );
  const standardTarget = standardStops[standardTargetIndex];
  let carrymeTargetIndex = -1;

  if (standardTarget) {
    for (let index = carrymeStops.length - 1; index >= 0; index -= 1) {
      const stop = carrymeStops[index];

      if (stop && isSamePhysicalStop(stop, standardTarget)) {
        carrymeTargetIndex = index;
        break;
      }
    }
  }

  const standardTargetEvent = standardEvents?.find(
    (event) => event.stopIndex === standardTargetIndex,
  );
  const carrymeDepartureEvent = carrymeEvents?.find((event) => event.stopIndex === 0);
  const carrymeTargetEvent = carrymeEvents?.find(
    (event) => event.stopIndex === carrymeTargetIndex,
  );

  if (
    !standardTarget ||
    standardTargetIndex < 0 ||
    carrymeTargetIndex < 0 ||
    !standardTargetEvent ||
    !carrymeDepartureEvent ||
    !carrymeTargetEvent
  ) {
    issues.push(createIssue(
      "carryme_delivery_target_missing",
      `${dayIndex + 1}일차 CarryME 배송 대상을 시간표에서 확인할 수 없습니다.`,
      { dayIndex, route: "carryme" },
    ));
    return;
  }

  const deliveryEvent = deliveryEvents[0] as PlanmeDraftTimelineEvent;
  const expectedTitle = `짐 ${standardTarget.name} 도착`;

  if (
    deliveryEvent.title !== expectedTitle ||
    deliveryEvent.time !== standardTargetEvent.time
  ) {
    issues.push(createIssue(
      "carryme_delivery_target_mismatch",
      `${dayIndex + 1}일차 CarryME 배송 대상 또는 시각이 Standard 대상 도착과 다릅니다.`,
      { dayIndex, route: "carryme" },
    ));
  }

  const departureMinutes = parseTimeMinutes(carrymeDepartureEvent.time);
  const deliveryMinutes = parseTimeMinutes(deliveryEvent.time);
  const travelerArrivalMinutes = parseTimeMinutes(carrymeTargetEvent.time);

  if (
    departureMinutes !== null &&
    deliveryMinutes !== null &&
    deliveryMinutes <= departureMinutes
  ) {
    issues.push(createIssue(
      "carryme_delivery_not_after_departure",
      `${dayIndex + 1}일차 짐 도착은 여행자 출발 이후여야 합니다.`,
      { dayIndex, route: "carryme" },
    ));
  }

  if (
    travelerArrivalMinutes !== null &&
    deliveryMinutes !== null &&
    deliveryMinutes > travelerArrivalMinutes
  ) {
    issues.push(createIssue(
      "carryme_delivery_after_traveler_arrival",
      `${dayIndex + 1}일차 짐은 여행자보다 늦게 도착할 수 없습니다.`,
      { dayIndex, route: "carryme" },
    ));
  }
}

function validateRouteStops(
  stops: readonly PlanmeDraftRouteStop[],
  route: PlanmeDraftDomainContractRoute,
  dayIndex: number,
  expectedStart: PlanmeDraftRouteStop | null,
  expectedFinalEnd: PlanmeDraftRouteStop | null,
  transportMode: PlanmeTransportMode,
  issues: PlanmeDraftDomainContractIssue[],
) {
  if (stops.length === 0) {
    issues.push(createIssue(
      "missing_route_stops",
      `${dayIndex + 1}일차 ${routeLabel(route)} 경로가 필요합니다.`,
      { dayIndex, route },
    ));
    return;
  }

  const firstStop = stops[0] as PlanmeDraftRouteStop;
  const lastStop = stops.at(-1) as PlanmeDraftRouteStop;

  if (!expectedStart || !isSamePhysicalStop(firstStop, expectedStart) || firstStop.role !== "출발지") {
    issues.push(createIssue(
      "route_start_mismatch",
      `${dayIndex + 1}일차 ${routeLabel(route)} 출발지가 일자 경계와 다릅니다.`,
      { dayIndex, route, stopIndex: 0 },
    ));
  }

  if (expectedFinalEnd && !isSamePhysicalStop(lastStop, expectedFinalEnd)) {
    issues.push(createIssue(
      "route_end_mismatch",
      `${dayIndex + 1}일차 ${routeLabel(route)} 종료지가 최초 출발지와 다릅니다.`,
      { dayIndex, route, stopIndex: stops.length - 1 },
    ));
  }

  stops.forEach((stop, stopIndex) => {
    if (stop.mode !== transportMode) {
      issues.push(createIssue(
        "transport_mode_mismatch",
        `${dayIndex + 1}일차 ${routeLabel(route)} ${stopIndex + 1}번째 장소의 이동수단이 다릅니다.`,
        { dayIndex, route, stopIndex },
      ));
    }
  });
}

function validateRouteTimeline(
  events: readonly PlanmeDraftTimelineEvent[] | undefined,
  stopCount: number,
  route: PlanmeDraftDomainContractRoute,
  dayIndex: number,
  issues: PlanmeDraftDomainContractIssue[],
) {
  if (!events || events.length === 0) {
    issues.push(createIssue(
      "missing_route_timeline",
      `${dayIndex + 1}일차 ${routeLabel(route)} 타임라인이 필요합니다.`,
      { dayIndex, route },
    ));
    return;
  }

  const referenceCounts = new Map<number, number>();
  let previousMinutes: number | null = null;
  let previousTravelerStopIndex = -1;

  events.forEach((event, eventIndex) => {
    const isDelivery = isLuggageDeliveryEvent(event);
    const minutes = parseTimeMinutes(event.time);

    if (minutes === null) {
      issues.push(createIssue(
        "invalid_timeline_time",
        `${dayIndex + 1}일차 ${routeLabel(route)} ${eventIndex + 1}번째 시각이 올바르지 않습니다.`,
        { dayIndex, route, eventIndex },
      ));
    } else if (previousMinutes !== null && minutes < previousMinutes) {
      issues.push(createIssue(
        "timeline_order_invalid",
        `${dayIndex + 1}일차 ${routeLabel(route)} 타임라인 시각이 역순입니다.`,
        { dayIndex, route, eventIndex },
      ));
    }

    if (minutes !== null) {
      previousMinutes = minutes;
    }

    if (isDelivery) {
      if (route === "standard") {
        issues.push(createIssue(
          "standard_contains_carryme_delivery",
          `${dayIndex + 1}일차 Standard 타임라인에 CarryME 배송 이벤트가 포함됐습니다.`,
          { dayIndex, route, eventIndex },
        ));
      } else if (event.stopIndex !== null) {
        issues.push(createIssue(
          "carryme_delivery_references_traveler_stop",
          `${dayIndex + 1}일차 CarryME 배송 이벤트는 여행자 장소를 참조할 수 없습니다.`,
          { dayIndex, route, eventIndex },
        ));
      }

      return;
    }

    if (!Number.isInteger(event.stopIndex) || event.stopIndex === null || event.stopIndex === undefined) {
      if (event.stopIndex !== null) {
        issues.push(createIssue(
          "invalid_timeline_stop_index",
          `${dayIndex + 1}일차 ${routeLabel(route)} ${eventIndex + 1}번째 장소 참조가 올바르지 않습니다.`,
          { dayIndex, route, eventIndex },
        ));
      }
      return;
    }

    if (event.stopIndex < 0 || event.stopIndex >= stopCount) {
      issues.push(createIssue(
        "invalid_timeline_stop_index",
        `${dayIndex + 1}일차 ${routeLabel(route)} ${eventIndex + 1}번째 장소 참조가 경로 범위를 벗어납니다.`,
        { dayIndex, route, eventIndex },
      ));
      return;
    }

    referenceCounts.set(event.stopIndex, (referenceCounts.get(event.stopIndex) ?? 0) + 1);

    if (event.stopIndex < previousTravelerStopIndex) {
      issues.push(createIssue(
        "timeline_route_order_invalid",
        `${dayIndex + 1}일차 ${routeLabel(route)} 장소 참조 순서가 경로와 다릅니다.`,
        { dayIndex, route, eventIndex },
      ));
    }
    previousTravelerStopIndex = event.stopIndex;
  });

  const travelerEvents = events
    .map((event, eventIndex) => ({ event, eventIndex }))
    .filter(({ event }) => !isLuggageDeliveryEvent(event));

  travelerEvents.slice(0, -1).forEach(({ event, eventIndex }, travelerIndex) => {
    const nextTravelerEvent = travelerEvents[travelerIndex + 1]?.event;
    const arrivalMinutes = parseTimeMinutes(event.time);
    const nextArrivalMinutes = nextTravelerEvent
      ? parseTimeMinutes(nextTravelerEvent.time)
      : null;

    if (
      arrivalMinutes !== null &&
      nextArrivalMinutes !== null &&
      arrivalMinutes + normalizeStayDuration(event.stayDurationMinutes) > nextArrivalMinutes
    ) {
      issues.push(createIssue(
        "timeline_stay_overlap",
        `${dayIndex + 1}일차 ${routeLabel(route)} ${eventIndex + 1}번째 체류가 다음 여행자 일정과 겹칩니다.`,
        { dayIndex, route, eventIndex },
      ));
    }
  });

  for (let stopIndex = 0; stopIndex < stopCount; stopIndex += 1) {
    const count = referenceCounts.get(stopIndex) ?? 0;

    if (count === 0) {
      issues.push(createIssue(
        "missing_timeline_stop_reference",
        `${dayIndex + 1}일차 ${routeLabel(route)} ${stopIndex + 1}번째 장소의 타임라인이 없습니다.`,
        { dayIndex, route, stopIndex },
      ));
    } else if (count > 1) {
      issues.push(createIssue(
        "duplicate_timeline_stop_reference",
        `${dayIndex + 1}일차 ${routeLabel(route)} ${stopIndex + 1}번째 장소의 타임라인이 중복됐습니다.`,
        { dayIndex, route, stopIndex },
      ));
    }
  }
}

function getSourceRoutes(day: PlanmeDraftDay): SourceRoutes {
  const standardSource = day.standardStops ?? day.stops ?? day.carrymeStops ?? [];
  const carrymeSource = day.carrymeStops ?? day.stops ?? day.standardStops ?? [];

  return {
    standard: standardSource.map(toDraftRouteStop),
    carryme: carrymeSource.map(toDraftRouteStop),
  };
}

function toDraftRouteStop(stop: PlanmeDraftRouteStop | PlanmeDraftStop): PlanmeDraftRouteStop {
  return {
    name: stop.name,
    caption: stop.caption,
    coordinate: stop.coordinate,
    addressQuery: stop.addressQuery,
    mode: stop.mode,
    placeId: stop.placeId,
    placeSource: stop.placeSource,
    placeSourceRef: stop.placeSourceRef,
    role: isPlanmeStopRole(stop.role) ? stop.role : undefined,
    requiredPlaceKind: stop.requiredPlaceKind,
  };
}

function normalizeStartStop(
  stop: PlanmeDraftRouteStop,
  transportMode: PlanmeTransportMode,
): PlanmeDraftRouteStop {
  return {
    ...stop,
    name: stop.name.trim(),
    caption: "출발",
    mode: transportMode,
    role: "출발지",
  };
}

function normalizeReturnStop(
  stop: PlanmeDraftRouteStop,
  transportMode: PlanmeTransportMode,
): PlanmeDraftRouteStop {
  return {
    ...stop,
    name: stop.name.trim(),
    caption: "여행 종료",
    mode: transportMode,
    role: "복귀지",
    requiredPlaceKind: "origin",
  };
}

function normalizeLodgingStop(
  stop: PlanmeDraftRouteStop,
  transportMode: PlanmeTransportMode,
  caption = "숙소 도착",
): PlanmeDraftRouteStop {
  return {
    ...stop,
    name: stop.name.trim(),
    caption,
    mode: transportMode,
    role: "숙소",
  };
}

function normalizeVisitStop(
  stop: PlanmeDraftRouteStop,
  transportMode: PlanmeTransportMode,
): PlanmeDraftRouteStop {
  return {
    ...stop,
    name: stop.name.trim(),
    mode: transportMode,
    role: stop.role === "출발지" || stop.role === "복귀지" ? "방문지" : stop.role,
    requiredPlaceKind: stop.requiredPlaceKind === "origin" ? undefined : stop.requiredPlaceKind,
  };
}

function normalizeBoundaryTimelineEvent(
  event: PlanmeDraftTimelineEvent,
  entry: RouteEntry,
  stopIndex: number,
): PlanmeDraftTimelineEvent {
  if (entry.semantic === "start") {
    return {
      ...event,
      title: `${entry.stop.name} 출발`,
      description: `${entry.stop.name}에서 일정을 시작합니다.`,
      category: "arrival",
      stopIndex,
      stayDurationMinutes: normalizeStayDurationForEntry(
        entry,
        event.stayDurationMinutes,
      ),
    };
  }

  if (entry.semantic === "end") {
    return {
      ...event,
      title: `${entry.stop.name} 도착`,
      description: entry.stop.role === "복귀지"
        ? `${entry.stop.name}에 돌아와 일정을 마칩니다.`
        : `${entry.stop.name}에 도착해 일정을 마칩니다.`,
      category: entry.stop.role === "숙소" ? "hotel" : "arrival",
      stopIndex,
      stayDurationMinutes: normalizeStayDuration(event.stayDurationMinutes),
    };
  }

  return {
    ...event,
    title: entry.semantic === "lodging_detour" && !event.title.trim()
      ? `${entry.stop.name} 도착`
      : event.title,
    category: entry.semantic === "lodging_detour" ? "hotel" : event.category,
    stopIndex,
    stayDurationMinutes: normalizeStayDurationForEntry(
      entry,
      event.stayDurationMinutes,
    ),
  };
}

function createSyntheticTimelineEvent(
  entry: RouteEntry,
  stopIndex: number,
  time: string,
): PlanmeDraftTimelineEvent {
  const isLodging = entry.stop.role === "숙소";

  return {
    time,
    title: entry.semantic === "start"
      ? `${entry.stop.name} 출발`
      : `${entry.stop.name} 도착`,
    description: entry.semantic === "start"
      ? `${entry.stop.name}에서 일정을 시작합니다.`
      : `${entry.stop.name}에 도착해 일정을 이어갑니다.`,
    category: isLodging ? "hotel" : "arrival",
    stopIndex,
    stayDurationMinutes: normalizeStayDurationForEntry(entry, undefined),
  };
}

function mergeSideEvents(
  travelerEvents: readonly PlanmeDraftTimelineEvent[],
  sideEvents: readonly IndexedTimelineEvent[],
) {
  const merged = travelerEvents.map(cloneTimelineEvent);
  const sortedSideEvents = [...sideEvents].sort((left, right) => {
    const leftMinutes = parseTimeMinutes(left.event.time);
    const rightMinutes = parseTimeMinutes(right.event.time);

    if (leftMinutes === null && rightMinutes === null) {
      return left.sourceOrder - right.sourceOrder;
    }
    if (leftMinutes === null) {
      return 1;
    }
    if (rightMinutes === null) {
      return -1;
    }
    return leftMinutes - rightMinutes || left.sourceOrder - right.sourceOrder;
  });

  sortedSideEvents.forEach(({ event }) => {
    const eventMinutes = parseTimeMinutes(event.time);
    const insertIndex = eventMinutes === null
      ? merged.length
      : merged.findIndex((candidate) => {
          const candidateMinutes = parseTimeMinutes(candidate.time);
          return candidateMinutes !== null && (
            candidateMinutes > eventMinutes ||
            (candidateMinutes === eventMinutes && isLuggageDeliveryEvent(event))
          );
        });

    if (insertIndex < 0) {
      merged.push(cloneTimelineEvent(event));
    } else {
      merged.splice(insertIndex, 0, cloneTimelineEvent(event));
    }
  });

  return merged;
}

/** Keeps provisional traveler anchors physically possible before provider finalization. */
function normalizeTravelerStayTimeline(
  events: readonly PlanmeDraftTimelineEvent[],
): PlanmeDraftTimelineEvent[] {
  return events.reduce<PlanmeDraftTimelineEvent[]>((normalized, event) => {
    const previousEvent = normalized.at(-1);
    const previousMinutes = previousEvent ? parseTimeMinutes(previousEvent.time) : null;
    const eventMinutes = parseTimeMinutes(event.time);

    if (previousEvent && previousMinutes !== null && eventMinutes !== null) {
      const earliestArrival = previousMinutes + normalizeStayDuration(
        previousEvent.stayDurationMinutes,
      );

      normalized.push({
        ...event,
        time: formatTimeMinutes(Math.max(eventMinutes, earliestArrival)),
      });
    } else {
      normalized.push(cloneTimelineEvent(event));
    }

    return normalized;
  }, []);
}

function deriveSyntheticTime(
  stopIndex: number,
  stopCount: number,
  fixedTimes: ReadonlyMap<number, number>,
) {
  let previousIndex = stopIndex - 1;
  let nextIndex = stopIndex + 1;

  while (previousIndex >= 0 && !fixedTimes.has(previousIndex)) {
    previousIndex -= 1;
  }
  while (nextIndex < stopCount && !fixedTimes.has(nextIndex)) {
    nextIndex += 1;
  }

  const previousMinutes = fixedTimes.get(previousIndex);
  const nextMinutes = fixedTimes.get(nextIndex);

  if (previousMinutes !== undefined && nextMinutes !== undefined) {
    const step = Math.max(1, Math.floor((nextMinutes - previousMinutes) / (nextIndex - previousIndex)));
    return formatTimeMinutes(previousMinutes + step * (stopIndex - previousIndex));
  }

  if (previousMinutes !== undefined) {
    return formatTimeMinutes(
      previousMinutes + SYNTHETIC_EVENT_INTERVAL_MINUTES * (stopIndex - previousIndex),
    );
  }

  if (nextMinutes !== undefined) {
    return formatTimeMinutes(
      nextMinutes - SYNTHETIC_EVENT_INTERVAL_MINUTES * (nextIndex - stopIndex),
    );
  }

  return "--:--";
}

function parseTimeMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

function formatTimeMinutes(value: number) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, value));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeStayDuration(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

/** Reserves real handling time for hotel detours and hotel-origin checkout or luggage handoff. */
function normalizeStayDurationForEntry(
  entry: RouteEntry,
  value: number | undefined,
) {
  const minimumMinutes = entry.minimumStayDurationMinutes ?? 0;

  return Math.max(minimumMinutes, normalizeStayDuration(value));
}

function cloneTimelineEvent(event: PlanmeDraftTimelineEvent): PlanmeDraftTimelineEvent {
  return { ...event };
}

function isLuggageDeliveryEvent(event: PlanmeDraftTimelineEvent) {
  return event.category === "carryme" ||
    LUGGAGE_DELIVERY_PATTERN.test(`${event.title} ${event.description}`.replace(/\s+/g, " "));
}

function isLuggageDeliveryStop(stop: PlanmeDraftRouteStop) {
  return LUGGAGE_DELIVERY_PATTERN.test(`${stop.name} ${stop.caption ?? ""}`.replace(/\s+/g, " "));
}

function isSamePhysicalStop(left: PlanmeDraftRouteStop, right: PlanmeDraftRouteStop) {
  return createPhysicalStopIdentity(left) === createPhysicalStopIdentity(right);
}

function createPhysicalStopIdentity(stop: PlanmeDraftRouteStop) {
  if (stop.placeSourceRef?.trim()) {
    return `source:${stop.placeSourceRef.trim()}`;
  }
  if (stop.placeId?.trim()) {
    return `place:${stop.placeId.trim()}`;
  }
  if (stop.coordinate) {
    return `coordinate:${stop.coordinate.lat.toFixed(6)},${stop.coordinate.lng.toFixed(6)}`;
  }
  return `label:${stop.name.replace(/\s+/g, "").toLowerCase()}`;
}

function createRouteText(stops: readonly PlanmeDraftRouteStop[]) {
  return stops.map((stop) => stop.name).join(" → ");
}

function isPlanmeStopRole(role: string | undefined): role is PlanmeStopRole {
  return STOP_ROLES.some((candidate) => candidate === role);
}

function routeLabel(route: PlanmeDraftDomainContractRoute) {
  return route === "standard" ? "Standard" : "CarryME";
}

function createIssue(
  code: PlanmeDraftDomainContractIssueCode,
  message: string,
  context: Omit<PlanmeDraftDomainContractIssue, "code" | "message" | "severity"> = {},
): PlanmeDraftDomainContractIssue {
  return { code, message, severity: "error", ...context };
}

function hasError(issues: readonly PlanmeDraftDomainContractIssue[]) {
  return issues.some((issue) => issue.severity === "error");
}

function deduplicateIssues(issues: readonly PlanmeDraftDomainContractIssue[]) {
  const seen = new Set<string>();

  return issues.filter((issue) => {
    const key = [
      issue.code,
      issue.dayIndex ?? "",
      issue.route ?? "",
      issue.stopIndex ?? "",
      issue.eventIndex ?? "",
    ].join(":");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
