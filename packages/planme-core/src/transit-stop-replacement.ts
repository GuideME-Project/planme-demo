import type { PlanmeItinerary, RoutePlan, RouteStop, TimelineEvent } from "./mock-data.js";
import {
  createOpenAiReplacementQuerySuggester,
} from "./openai-itinerary-generator.js";
import type {
  PlanmePlaceResolutionLog,
  PlanmeReplacementQuerySuggester,
  RecommendItineraryRequest,
} from "./gpt-actions.js";
import {
  hasPlanmePlaceCandidateHardGate,
  searchPlanmePlaceCandidates,
  type PlanmePlaceCandidate,
  type PlanmePlaceCandidateSearcher,
} from "./place-candidates.js";
import type { PlanmeUsageRecorder } from "./usage-events.js";

export type ReplaceTransitStopInput = {
  attempt: 1 | 2 | 3;
  excludedPlaceSourceRefs: string[];
  itinerary: PlanmeItinerary;
  request: RecommendItineraryRequest;
  stopRef: string;
};

export type ReplaceTransitStopResult =
  | {
      itinerary: PlanmeItinerary;
      resolutionLog: PlanmePlaceResolutionLog;
      status: "replaced";
    }
  | { status: "exhausted" };

export type ReplaceTransitStopOptions = {
  placeCandidateSearcher?: PlanmePlaceCandidateSearcher;
  replacementQuerySuggester?: PlanmeReplacementQuerySuggester;
  usageRecorder?: PlanmeUsageRecorder;
};

export type RemoveTransitStopResult =
  | { itinerary: PlanmeItinerary; status: "removed" }
  | { status: "no_visit_place_remained" };

/** Replaces one explicit AI-owned slot while preserving its stable reference and timeline stay. */
export async function replaceTransitItineraryStop(
  input: ReplaceTransitStopInput,
  options: ReplaceTransitStopOptions = {},
): Promise<ReplaceTransitStopResult> {
  const sourceStop = findStopByReference(input.itinerary, input.stopRef);

  if (!sourceStop || sourceStop.placeConstraint !== "replaceable") {
    return { status: "exhausted" };
  }

  const suggestQuery = options.replacementQuerySuggester ??
    createOpenAiReplacementQuerySuggester({ usageRecorder: options.usageRecorder });
  const query = await suggestQuery({
    attempt: input.attempt,
    itinerary: input.request,
    stop: {
      addressQuery: sourceStop.label,
      coordinate: sourceStop.coordinate,
      name: sourceStop.label,
      placeSourceRef: sourceStop.placeSourceRef,
      role: sourceStop.role,
    },
  });

  if (!query) {
    return { status: "exhausted" };
  }

  const searcher = options.placeCandidateSearcher ??
    ((searchInput) => searchPlanmePlaceCandidates(searchInput, {
      usageRecorder: options.usageRecorder,
    }));
  const result = await searcher({
    destination: input.request.destination,
    maxCandidates: 5,
    preferences: input.request.preferences,
    query,
    region: input.request.region ?? input.request.destination,
    stop: {
      addressQuery: query,
      name: sourceStop.label,
      role: sourceStop.role,
    },
  });
  const excluded = new Set(
    [sourceStop.placeSourceRef, ...input.excludedPlaceSourceRefs].filter(
      (value): value is string => Boolean(value),
    ),
  );
  const candidate = result.candidates.find(
    (value) => hasPlanmePlaceCandidateHardGate(value) && !excluded.has(value.sourceRef),
  );

  if (!candidate) {
    return { status: "exhausted" };
  }

  return {
    itinerary: applyReplacement(input.itinerary, input.stopRef, sourceStop, candidate),
    resolutionLog: {
      decisionStatus: "accepted",
      originalName: sourceStop.label,
      query,
      reason: `대중교통 접근성을 위한 ${input.attempt}번째 대체 장소를 적용했습니다.`,
      resolvedName: candidate.name,
      source: candidate.source,
    },
    status: "replaced",
  };
}

/** Removes only an AI-owned slot and converts its linked stay into free time. */
export function removeReplaceableTransitStop(
  itinerary: PlanmeItinerary,
  stopRef: string,
): RemoveTransitStopResult {
  const sourceStop = findStopByReference(itinerary, stopRef);

  if (!sourceStop || sourceStop.placeConstraint !== "replaceable") {
    return { status: "no_visit_place_remained" };
  }

  const days = itinerary.days.map((day) => ({
    ...day,
    carryme: removeStopFromRoute(day.carryme, stopRef),
    carrymeTimeline: replaceTimelineStopWithFreeTime(day.carrymeTimeline, stopRef),
    standard: removeStopFromRoute(day.standard, stopRef),
    standardTimeline: replaceTimelineStopWithFreeTime(day.standardTimeline, stopRef),
    timeline: replaceTimelineStopWithFreeTime(day.timeline, stopRef) ?? day.timeline,
  }));
  const hasVisitPlace = days.some((day) =>
    [...day.standard.stops, ...day.carryme.stops].some(
      (stop) => stop.role === "방문지",
    ),
  );

  return hasVisitPlace
    ? { itinerary: { ...itinerary, days }, status: "removed" }
    : { status: "no_visit_place_remained" };
}

function applyReplacement(
  itinerary: PlanmeItinerary,
  stopRef: string,
  sourceStop: RouteStop,
  candidate: PlanmePlaceCandidate,
) {
  const replaceRoute = (route: RoutePlan): RoutePlan => {
    const stops = route.stops.map((stop) =>
      stop.stopRef === stopRef
        ? {
            ...stop,
            coordinate: candidate.coordinate,
            label: candidate.name,
            placeId: candidate.placeId,
            placeSource: candidate.source,
            placeSourceRef: candidate.sourceRef,
          }
        : stop,
    );

    return resetRouteProviderResult(route, stops);
  };
  const replaceTimeline = (events: TimelineEvent[] | undefined) =>
    events?.map((event) =>
      event.stopRef === stopRef
        ? {
            ...event,
            title: event.title.includes(sourceStop.label)
              ? event.title.replace(sourceStop.label, candidate.name)
              : event.title,
          }
        : event,
    );

  return {
    ...itinerary,
    days: itinerary.days.map((day) => ({
      ...day,
      carryme: replaceRoute(day.carryme),
      carrymeTimeline: replaceTimeline(day.carrymeTimeline),
      standard: replaceRoute(day.standard),
      standardTimeline: replaceTimeline(day.standardTimeline),
      timeline: replaceTimeline(day.timeline) ?? day.timeline,
    })),
  };
}

function removeStopFromRoute(route: RoutePlan, stopRef: string) {
  return resetRouteProviderResult(
    route,
    route.stops.filter((stop) => stop.stopRef !== stopRef),
  );
}

function resetRouteProviderResult(route: RoutePlan, stops: RouteStop[]): RoutePlan {
  return {
    ...route,
    durationSource: undefined,
    estimatedSegmentIndexes: undefined,
    geoPath: undefined,
    geoSegments: undefined,
    routeText: stops.map((stop) => stop.label).join(" → "),
    stops,
    transitMarkers: undefined,
  };
}

function replaceTimelineStopWithFreeTime(
  events: TimelineEvent[] | undefined,
  stopRef: string,
) {
  return events?.map((event) =>
    event.stopRef === stopRef
      ? {
          ...event,
          category: "event" as const,
          description: "이 시간은 현지 상황에 맞춰 자유롭게 사용할 수 있습니다.",
          savingLabel: undefined,
          stopRef: undefined,
          title: "자유시간",
        }
      : event,
  );
}

function findStopByReference(itinerary: PlanmeItinerary, stopRef: string) {
  for (const day of itinerary.days) {
    const stop = [...day.standard.stops, ...day.carryme.stops].find(
      (candidate) => candidate.stopRef === stopRef,
    );

    if (stop) {
      return stop;
    }
  }

  return null;
}
