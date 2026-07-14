import type {
  AiPlanSelection,
  ExcludedRequestedPlace,
  ResolvedTripIntent,
  ScheduledDay,
  ScheduledMeal,
  ScheduledVisit,
  TourPlaceSnapshot,
  TripPlan,
} from "./contracts.js";

// Policy times are minutes after midnight and are not supplied by the AI.
export const PLANME_V3_MIDDLE_DAY_START_MINUTE = 9 * 60 + 30;
export const PLANME_V3_RETURN_TRAVEL_START_MINUTE = 17 * 60;
export const PLANME_V3_NON_FINAL_DAY_END_MINUTE = 21 * 60;

export type DayRouteDurationInput = {
  day: number;
  toFirstVisitMinutes: number;
  betweenVisitMinutes: number[];
};

export type ScheduleTripPlanResult =
  | {
      ok: true;
      days: ScheduledDay[];
      excludedContentIds: string[];
      deferredMoves: Array<{ contentId: string; fromDay: number; toDay: number }>;
    }
  | {
      ok: false;
      errorCode: "FIRST_DAY_ARRIVAL_REQUIRED" | "ACTUAL_VISIT_REQUIRED";
      excludedContentIds: string[];
      deferredMoves: Array<{ contentId: string; fromDay: number; toDay: number }>;
    };

export function createTripPlan(input: {
  intent: ResolvedTripIntent;
  selection: AiPlanSelection;
  candidates: TourPlaceSnapshot[];
  excludedRequestedPlaces?: ExcludedRequestedPlace[];
}): TripPlan | null {
  const candidateById = new Map(
    input.candidates.map((candidate) => [candidate.contentId, candidate]),
  );
  const lodging = candidateById.get(input.selection.lodgingContentId);

  if (!lodging || lodging.contentTypeId !== 32) {
    return null;
  }

  const selectedPlaces: Record<string, TourPlaceSnapshot> = {
    [lodging.contentId]: lodging,
  };
  const days = input.selection.days.map((day) => {
    const visits = day.orderedVisitContentIds.flatMap((contentId) => {
      const candidate = candidateById.get(contentId);
      if (!candidate || ![12, 14, 15, 28, 38].includes(candidate.contentTypeId)) {
        return [];
      }

      selectedPlaces[contentId] = candidate;
      return [
        {
          contentId,
          stayMinutes: getDefaultStayMinutes(candidate.contentTypeId),
        },
      ];
    });
    const restaurants = day.restaurantContentIds.flatMap((contentId) => {
      const candidate = candidateById.get(contentId);
      if (!candidate || candidate.contentTypeId !== 39) {
        return [];
      }

      selectedPlaces[contentId] = candidate;
      return [contentId];
    });
    const routeActivities = [...visits];
    if (restaurants[0]) {
      routeActivities.splice(Math.min(1, routeActivities.length), 0, {
        contentId: restaurants[0],
        stayMinutes: getDefaultStayMinutes(39),
      });
    }
    if (restaurants[1]) {
      routeActivities.push({
        contentId: restaurants[1],
        stayMinutes: getDefaultStayMinutes(39),
      });
    }

    return {
      day: day.day,
      visits: routeActivities,
      meals: [
        { kind: "lunch" as const, contentId: restaurants[0] },
        { kind: "dinner" as const, contentId: restaurants[1] },
      ],
      freeTimePolicy: visits.length === 0 ? ("lodging_rest" as const) : ("free_time" as const),
    };
  });

  return {
    intent: input.intent,
    lodging,
    selectedPlaces,
    days,
    excludedRequestedPlaces: input.excludedRequestedPlaces ?? [],
  };
}

export function scheduleTripPlan(input: {
  plan: TripPlan;
  firstDayArrivalMinute: number | null;
  routeDurations: DayRouteDurationInput[];
}): ScheduleTripPlanResult {
  if (
    input.firstDayArrivalMinute === null ||
    !isValidMinute(input.firstDayArrivalMinute)
  ) {
    return {
      ok: false,
      errorCode: "FIRST_DAY_ARRIVAL_REQUIRED",
      excludedContentIds: [],
      deferredMoves: [],
    };
  }

  const routeDurationByDay = new Map(
    input.routeDurations.map((duration) => [duration.day, duration]),
  );
  const excludedContentIds: string[] = [];
  const deferredMoves: Array<{ contentId: string; fromDay: number; toDay: number }> = [];
  const scheduledDays: ScheduledDay[] = [];

  for (const day of input.plan.days) {
    const isFirstDay = day.day === 1;
    const isLastDay = day.day === input.plan.intent.durationDays;
    const startMinute = isFirstDay
      ? input.firstDayArrivalMinute
      : PLANME_V3_MIDDLE_DAY_START_MINUTE;
    const endMinute = isLastDay
      ? PLANME_V3_RETURN_TRAVEL_START_MINUTE
      : PLANME_V3_NON_FINAL_DAY_END_MINUTE;
    const durations = routeDurationByDay.get(day.day);
    let cursor = startMinute + normalizeDuration(durations?.toFirstVisitMinutes);
    const visits: ScheduledVisit[] = [];
    const meals: ScheduledMeal[] = [];
    let overflowing = false;

    day.visits.forEach((visit, visitIndex) => {
      const place = input.plan.selectedPlaces[visit.contentId];
      const restaurantMeal = place?.contentTypeId === 39
        ? day.meals.find((meal) => meal.contentId === visit.contentId)
        : undefined;
      if (overflowing) {
        if (restaurantMeal || isLastDay) {
          excludedContentIds.push(visit.contentId);
        } else {
          deferredMoves.push({
            contentId: visit.contentId,
            fromDay: day.day,
            toDay: day.day + 1,
          });
        }
        return;
      }
      if (restaurantMeal) {
        const window = mealWindow(restaurantMeal.kind);
        const mealStart = Math.max(cursor, window.start);
        const mealEnd = mealStart + visit.stayMinutes;
        if (mealEnd > window.end || mealEnd > endMinute) {
          excludedContentIds.push(visit.contentId);
          return;
        }
        meals.push({
          kind: restaurantMeal.kind,
          contentId: visit.contentId,
          startMinute: mealStart,
          endMinute: mealEnd,
          locationStatus: "tourapi",
        });
        cursor =
          mealEnd + normalizeDuration(durations?.betweenVisitMinutes[visitIndex]);
        return;
      }
      cursor = scheduleMealsBeforeVisit({
        cursor,
        dayEndMinute: endMinute,
        meals,
        mealPolicies: day.meals,
        visitStayMinutes: visit.stayMinutes,
      });
      const visitEnd = cursor + visit.stayMinutes;
      if (visitEnd > endMinute) {
        overflowing = true;
        if (isLastDay) {
          excludedContentIds.push(visit.contentId);
        } else {
          deferredMoves.push({
            contentId: visit.contentId,
            fromDay: day.day,
            toDay: day.day + 1,
          });
        }
        return;
      }

      visits.push({
        contentId: visit.contentId,
        startMinute: cursor,
        endMinute: visitEnd,
      });
      cursor =
        visitEnd + normalizeDuration(durations?.betweenVisitMinutes[visitIndex]);
    });

    cursor = scheduleRemainingMeals({
      cursor,
      dayEndMinute: endMinute,
      meals,
      mealPolicies: day.meals,
    });
    const idleBlocks = visits.length === 0
      ? createIdleBlocksAroundMeals(startMinute, endMinute, meals)
      : cursor < endMinute
        ? [
            {
              kind: day.freeTimePolicy,
              startMinute: cursor,
              endMinute,
            },
          ]
        : [];

    scheduledDays.push({
      day: day.day,
      startMinute,
      endMinute,
      returnTravelStartMinute: isLastDay
        ? PLANME_V3_RETURN_TRAVEL_START_MINUTE
        : undefined,
      visits,
      meals,
      idleBlocks,
    });
  }

  const hasActualVisit = scheduledDays.some((day) => day.visits.length > 0);
  if (!hasActualVisit) {
    return {
      ok: false,
      errorCode: "ACTUAL_VISIT_REQUIRED",
      excludedContentIds,
      deferredMoves,
    };
  }

  return { ok: true, days: scheduledDays, excludedContentIds, deferredMoves };
}

function createIdleBlocksAroundMeals(
  startMinute: number,
  endMinute: number,
  meals: ScheduledMeal[],
) {
  const blocks: Array<{
    kind: "lodging_rest";
    startMinute: number;
    endMinute: number;
  }> = [];
  let cursor = startMinute;
  for (const meal of [...meals].sort(
    (left, right) => left.startMinute - right.startMinute,
  )) {
    if (cursor < meal.startMinute) {
      blocks.push({
        kind: "lodging_rest",
        startMinute: cursor,
        endMinute: meal.startMinute,
      });
    }
    cursor = Math.max(cursor, meal.endMinute);
  }
  if (cursor < endMinute) {
    blocks.push({ kind: "lodging_rest", startMinute: cursor, endMinute });
  }
  return blocks;
}

function scheduleMealsBeforeVisit(input: {
  cursor: number;
  dayEndMinute: number;
  meals: ScheduledMeal[];
  mealPolicies: TripPlan["days"][number]["meals"];
  visitStayMinutes: number;
}) {
  let cursor = input.cursor;
  for (const kind of ["lunch", "dinner"] as const) {
    const window = mealWindow(kind);
    if (
      !input.meals.some((meal) => meal.kind === kind) &&
      input.mealPolicies.some((meal) => meal.kind === kind && !meal.contentId) &&
      cursor + input.visitStayMinutes > window.start
    ) {
      cursor = scheduleMeal({ ...input, cursor, kind });
    }
  }
  return cursor;
}

function scheduleRemainingMeals(input: {
  cursor: number;
  dayEndMinute: number;
  meals: ScheduledMeal[];
  mealPolicies: TripPlan["days"][number]["meals"];
}) {
  let cursor = input.cursor;
  for (const kind of ["lunch", "dinner"] as const) {
    if (
      !input.meals.some((meal) => meal.kind === kind) &&
      input.mealPolicies.some((meal) => meal.kind === kind && !meal.contentId)
    ) {
      cursor = scheduleMeal({ ...input, cursor, kind });
    }
  }
  return cursor;
}

function scheduleMeal(input: {
  cursor: number;
  dayEndMinute: number;
  meals: ScheduledMeal[];
  mealPolicies: TripPlan["days"][number]["meals"];
  kind: "lunch" | "dinner";
}) {
  const window = mealWindow(input.kind);
  const startMinute = Math.max(input.cursor, window.start);
  const endMinute = startMinute + 60;
  if (endMinute > window.end || endMinute > input.dayEndMinute) {
    return input.cursor;
  }
  input.meals.push({
    kind: input.kind,
    startMinute,
    endMinute,
    locationStatus: "unlocated",
  });
  return endMinute;
}

function mealWindow(kind: "lunch" | "dinner") {
  return kind === "lunch"
    ? { start: 12 * 60, end: 14 * 60 }
    : { start: 18 * 60, end: 20 * 60 };
}

export function getDefaultStayMinutes(contentTypeId: number) {
  if (contentTypeId === 12 || contentTypeId === 38) {
    return 90;
  }

  if ([14, 15, 28].includes(contentTypeId)) {
    return 120;
  }

  if (contentTypeId === 39) {
    return 60;
  }

  return 0;
}

function normalizeDuration(value: number | undefined) {
  return Number.isFinite(value) && value !== undefined && value >= 0
    ? Math.ceil(value)
    : 0;
}

function isValidMinute(value: number) {
  return Number.isInteger(value) && value >= 0 && value < 24 * 60;
}
