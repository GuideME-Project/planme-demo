import type {
  AiPlanSelection,
  AiPlanSelectionDay,
  Coordinate,
  TourPlaceSnapshot,
} from "./contracts.js";
import { calculateStraightDistanceMeters } from "./route-policy.js";

const VISIT_CONTENT_TYPES = [12, 14, 15, 28, 38] as const;

export type DeterministicArrangementOptions = {
  maxVisitsPerDay?: number;
  maxRestaurantsPerDay?: number;
};

export type DeterministicArrangementResult =
  | { ok: true; value: AiPlanSelection }
  | { ok: false; errorCode: "LODGING_REQUIRED" | "VISIT_REQUIRED" };

export function arrangeTourCandidatesDeterministically(
  candidates: TourPlaceSnapshot[],
  durationDays: number,
  options: DeterministicArrangementOptions = {},
): DeterministicArrangementResult {
  const lodging = candidates.find((candidate) => candidate.contentTypeId === 32);
  if (!lodging) {
    return { ok: false, errorCode: "LODGING_REQUIRED" };
  }

  const maxVisitsPerDay = normalizePositiveInteger(options.maxVisitsPerDay, 3);
  const maxRestaurantsPerDay = normalizeNonNegativeInteger(
    options.maxRestaurantsPerDay,
    2,
  );
  const visits = selectVisitsRoundRobin(
    candidates,
    lodging.coordinate,
    durationDays * maxVisitsPerDay,
  );

  if (visits.length === 0) {
    return { ok: false, errorCode: "VISIT_REQUIRED" };
  }

  const days = createEmptyDays(durationDays);
  visits.forEach((visit, index) => {
    days[index % durationDays].orderedVisitContentIds.push(visit.contentId);
  });

  assignNearestRestaurants(
    days,
    visits,
    candidates.filter((candidate) => candidate.contentTypeId === 39),
    lodging.coordinate,
    maxRestaurantsPerDay,
  );

  return {
    ok: true,
    value: {
      lodgingContentId: lodging.contentId,
      days,
    },
  };
}

function selectVisitsRoundRobin(
  candidates: TourPlaceSnapshot[],
  initialCoordinate: Coordinate,
  limit: number,
) {
  const groups = new Map<number, TourPlaceSnapshot[]>();
  for (const contentTypeId of VISIT_CONTENT_TYPES) {
    groups.set(
      contentTypeId,
      candidates
        .filter((candidate) => candidate.contentTypeId === contentTypeId)
        .sort((left, right) => left.contentId.localeCompare(right.contentId)),
    );
  }

  const selected: TourPlaceSnapshot[] = [];
  let currentCoordinate = initialCoordinate;

  while (selected.length < limit) {
    let selectedInRound = false;

    for (const contentTypeId of VISIT_CONTENT_TYPES) {
      const group = groups.get(contentTypeId) ?? [];
      if (group.length === 0 || selected.length >= limit) {
        continue;
      }

      const nextIndex = findNearestCandidateIndex(group, currentCoordinate);
      const [next] = group.splice(nextIndex, 1);
      selected.push(next);
      currentCoordinate = next.coordinate;
      selectedInRound = true;
    }

    if (!selectedInRound) {
      break;
    }
  }

  return selected;
}

function assignNearestRestaurants(
  days: AiPlanSelectionDay[],
  visits: TourPlaceSnapshot[],
  restaurants: TourPlaceSnapshot[],
  lodgingCoordinate: Coordinate,
  maxRestaurantsPerDay: number,
) {
  const visitById = new Map(visits.map((visit) => [visit.contentId, visit]));
  const remainingRestaurants = [...restaurants].sort((left, right) =>
    left.contentId.localeCompare(right.contentId),
  );

  for (const day of days) {
    const anchor =
      visitById.get(day.orderedVisitContentIds[0] ?? "")?.coordinate ??
      lodgingCoordinate;

    for (let index = 0; index < maxRestaurantsPerDay; index += 1) {
      if (remainingRestaurants.length === 0) {
        return;
      }

      const nearestIndex = findNearestCandidateIndex(
        remainingRestaurants,
        anchor,
      );
      const [restaurant] = remainingRestaurants.splice(nearestIndex, 1);
      day.restaurantContentIds.push(restaurant.contentId);
    }
  }
}

function findNearestCandidateIndex(
  candidates: TourPlaceSnapshot[],
  coordinate: Coordinate,
) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  candidates.forEach((candidate, index) => {
    const distance = calculateStraightDistanceMeters(
      coordinate,
      candidate.coordinate,
    );

    if (
      distance < bestDistance ||
      (distance === bestDistance &&
        candidate.contentId.localeCompare(candidates[bestIndex].contentId) < 0)
    ) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function createEmptyDays(durationDays: number): AiPlanSelectionDay[] {
  return Array.from({ length: durationDays }, (_, index) => ({
    day: index + 1,
    orderedVisitContentIds: [],
    restaurantContentIds: [],
  }));
}

function normalizePositiveInteger(value: number | undefined, fallback: number) {
  return Number.isInteger(value) && value !== undefined && value > 0
    ? value
    : fallback;
}

function normalizeNonNegativeInteger(
  value: number | undefined,
  fallback: number,
) {
  return Number.isInteger(value) && value !== undefined && value >= 0
    ? value
    : fallback;
}
