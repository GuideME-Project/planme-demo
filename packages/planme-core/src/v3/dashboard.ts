import type {
  ItineraryDay,
  MapCoordinate,
  PlanmeItinerary,
  RoutePlan,
  RouteStop,
  TimelineEvent,
} from "../mock-data.js";
import type {
  ItineraryRevision,
  RouteSegment,
  RouteVariant,
  ScheduledDay,
  TourPlaceSnapshot,
} from "./contracts.js";

type RouteEdge = { fromRef: string; toRef: string };
const FIRST_DAY_DEPARTURE_MINUTE = 9 * 60 + 30;

/**
 * Adapts the server-finalized V3 revision to the established PlanME dashboard.
 * Place names and coordinates only come from the revision's TourAPI snapshots.
 */
export function createV3DashboardItinerary(
  revision: ItineraryRevision,
  pageUrl: string,
): PlanmeItinerary | null {
  const standardSegments = partitionSegmentsByDay(revision, revision.standard);
  const carrymeSegments = partitionSegmentsByDay(revision, revision.carryme);
  if (!standardSegments || !carrymeSegments) {
    return null;
  }
  const days = revision.plan.days.map((planDay, index) => {
    const standardDay = revision.standard.days.find((day) => day.day === planDay.day);
    const carrymeDay = revision.carryme.days.find((day) => day.day === planDay.day);
    const standard = createRoutePlan(
      revision,
      "standard",
      planDay.day,
      standardSegments[index] ?? [],
    );
    const carryme = createRoutePlan(
      revision,
      "carryme",
      planDay.day,
      carrymeSegments[index] ?? [],
    );
    const savingMinutes = Math.max(
      0,
      standard.durationMinutes - carryme.durationMinutes,
    );
    const standardTimeline = createTimeline(
      revision,
      standardDay,
      "standard",
    );
    const carrymeTimeline = createTimeline(
      revision,
      carrymeDay,
      "carryme",
    );

    return {
      day: planDay.day,
      label: `Day ${planDay.day}`,
      standard,
      carryme,
      savingMinutes,
      timeline: standardTimeline,
      standardTimeline,
      carrymeTimeline,
    } satisfies ItineraryDay;
  });
  const savedMinutes = Math.max(
    0,
    revision.standard.totalMinutes - revision.carryme.totalMinutes,
  );

  return {
    id: revision.itineraryId,
    title: `${revision.intent.destination} 여행 일정`,
    region: revision.intent.destination,
    duration: formatTripDuration(revision.intent.durationDays),
    summary: "TourAPI에서 확인된 장소와 서버에서 확정한 경로를 표시합니다.",
    detailUrl: pageUrl,
    carrymeSaving: formatSaving(savedMinutes),
    totalDurationLabel: formatDuration(revision.standard.totalMinutes),
    savedDurationLabel: formatSaving(savedMinutes),
    transportMode: revision.intent.transportMode,
    days,
    benefits: [],
  };
}

function createRoutePlan(
  revision: ItineraryRevision,
  kind: RouteVariant["kind"],
  day: number,
  segments: RouteSegment[],
): RoutePlan {
  const refs =
    segments.length > 0
      ? orderedRefs(segments)
      : [revision.plan.lodging.contentId];
  const stops = refs.map((ref, index) =>
    createStop(revision, ref, index, refs.length),
  );
  const geoSegments = segments.flatMap((segment) =>
    segment.paths.filter((path) => path.length >= 2),
  );
  const durationMinutes = segments.reduce(
    (sum, segment) => sum + Math.max(1, Math.ceil(segment.durationSeconds / 60)),
    0,
  );
  const luggagePath =
    kind === "carryme" && day === 1
      ? revision.carryme.luggageSegments.flatMap((segment) => segment.paths).find(
          (path) => path.length >= 2,
        )
      : undefined;
  const estimatedWalkCount = segments.filter(
    (segment) => segment.source === "estimated_walk",
  ).length;
  const baseDescription =
    kind === "standard"
      ? "여행자가 수하물을 직접 운반하는 일반 동선"
      : "수하물은 CarryME가 숙소로 운반하고 여행자는 일정으로 바로 이동";

  return {
    id: kind,
    label: kind === "standard" ? "Standard" : "CarryME",
    badge: kind === "standard" ? "Standard" : "CarryME",
    routeText: stops.map((stop) => stop.label).join(" → "),
    description:
      estimatedWalkCount > 0
        ? `${baseDescription} · 예상 도보 ${estimatedWalkCount}개 구간은 지도선 없음`
        : baseDescription,
    durationLabel: formatDuration(durationMinutes),
    durationMinutes,
    stops,
    ...(geoSegments.length > 0 ? { geoSegments } : {}),
    mapPath: [],
    ...(luggagePath ? { dashedGeoPath: luggagePath } : {}),
  };
}

function createStop(
  revision: ItineraryRevision,
  ref: string,
  index: number,
  count: number,
): RouteStop {
  const isLast = index === count - 1;
  const coordinate = coordinateForRef(revision, ref);

  if (ref === "origin") {
    return {
      label: revision.intent.origin,
      caption: isLast ? "복귀" : "출발",
      ...(coordinate ? { coordinate } : {}),
      icon: "station",
      mode: revision.intent.transportMode,
      role: isLast ? "복귀지" : "출발지",
    };
  }

  const snapshot = revision.selectedPlaceSnapshots[ref];
  if (!snapshot) {
    return {
      label: "확인되지 않은 장소",
      caption: "경로 지점",
      icon: "station",
      mode: revision.intent.transportMode,
      role: "방문지",
    };
  }

  const isLodging = ref === revision.plan.lodging.contentId;
  return {
    label: snapshot.title,
    caption: isLodging
      ? index === 0
        ? "숙소 출발"
        : isLast
          ? "숙소 복귀"
          : "수하물 보관"
      : contentTypeLabel(snapshot.contentTypeId),
    coordinate: snapshot.coordinate,
    icon: isLodging ? "hotel" : snapshot.contentTypeId === 15 ? "event" : "attraction",
    mode: revision.intent.transportMode,
    role: isLodging && index === 0 ? "출발지" : isLodging ? "숙소" : "방문지",
  };
}

function createTimeline(
  revision: ItineraryRevision,
  scheduledDay: ScheduledDay | undefined,
  kind: RouteVariant["kind"],
): TimelineEvent[] {
  if (!scheduledDay) {
    return [];
  }

  const entries: Array<{ event: TimelineEvent; minute: number }> = [
    {
      minute:
        scheduledDay.day === 1
          ? FIRST_DAY_DEPARTURE_MINUTE
          : scheduledDay.startMinute,
      event: {
        time: formatClock(
          scheduledDay.day === 1
            ? FIRST_DAY_DEPARTURE_MINUTE
            : scheduledDay.startMinute,
        ),
        title:
          scheduledDay.day === 1
            ? `${revision.intent.origin} 출발`
            : `${revision.plan.lodging.title} 출발`,
        description: "서버에서 확정한 이동 일정을 시작합니다.",
        category: "arrival",
      },
    },
  ];

  if (
    kind === "standard" &&
    scheduledDay.day === 1 &&
    revision.intent.luggageCount > 0
  ) {
    entries.push({
      minute: scheduledDay.startMinute,
      event: {
        time: formatClock(scheduledDay.startMinute),
        title: `${revision.plan.lodging.title} 수하물 보관`,
        description: "여행자가 숙소에 수하물을 맡긴 뒤 일정을 계속합니다.",
        category: "hotel",
      },
    });
  }

  for (const visit of scheduledDay.visits) {
    const place = revision.selectedPlaceSnapshots[visit.contentId];
    if (!place || place.contentTypeId === 39) {
      continue;
    }
    entries.push({
      minute: visit.startMinute,
      event: {
        time: formatClock(visit.startMinute),
        title: place.title,
        description: `${formatClock(visit.startMinute)}~${formatClock(visit.endMinute)} · TourAPI 확인 장소`,
        category: place.contentTypeId === 32 ? "hotel" : "event",
      },
    });
  }

  for (const meal of scheduledDay.meals) {
    const place = meal.contentId
      ? revision.selectedPlaceSnapshots[meal.contentId]
      : undefined;
    entries.push({
      minute: meal.startMinute,
      event: {
        time: formatClock(meal.startMinute),
        title: place?.title ?? (meal.kind === "lunch" ? "점심 식사" : "저녁 식사"),
        description: place
          ? `${formatClock(meal.startMinute)}~${formatClock(meal.endMinute)} · TourAPI 확인 음식점`
          : `${formatClock(meal.startMinute)}~${formatClock(meal.endMinute)} · 음식점 미지정`,
        category: "meal",
      },
    });
  }

  for (const block of scheduledDay.idleBlocks) {
    entries.push({
      minute: block.startMinute,
      event: {
        time: formatClock(block.startMinute),
        title: block.kind === "lodging_rest" ? "숙소 휴식" : "자유시간",
        description: `${formatClock(block.startMinute)}~${formatClock(block.endMinute)}`,
        category: block.kind === "lodging_rest" ? "hotel" : "event",
      },
    });
  }

  if (kind === "carryme") {
    for (const luggageEvent of revision.carryme.luggageEvents.filter(
      (event) => event.day === scheduledDay.day,
    )) {
      entries.push({
        minute: luggageEvent.minute,
        event: {
          time: formatClock(luggageEvent.minute),
          title:
            luggageEvent.kind === "handoff"
              ? "CarryME 수하물 인계"
              : `짐 ${revision.plan.lodging.title} 도착`,
          description:
            luggageEvent.kind === "handoff"
              ? "여행자는 수하물을 맡기고 일정으로 바로 이동합니다."
              : "CarryME가 수하물을 숙소에 전달했습니다.",
          category: "carryme",
          highlight: true,
        },
      });
    }
  }

  if (scheduledDay.returnTravelStartMinute !== undefined) {
    entries.push({
      minute: scheduledDay.returnTravelStartMinute,
      event: {
        time: formatClock(scheduledDay.returnTravelStartMinute),
        title: `${revision.intent.origin} 복귀 이동 시작`,
        description: "서버에서 확정한 복귀 경로로 이동합니다.",
        category: "transit",
      },
    });
  } else {
    entries.push({
      minute: scheduledDay.endMinute,
      event: {
        time: formatClock(scheduledDay.endMinute),
        title: `${revision.plan.lodging.title} 복귀`,
        description: "숙소에서 일정을 마칩니다.",
        category: "hotel",
      },
    });
  }

  return entries
    .sort((left, right) => left.minute - right.minute)
    .map(({ event }) => event);
}

function partitionSegmentsByDay(
  revision: ItineraryRevision,
  variant: RouteVariant,
): RouteSegment[][] | null {
  let cursor = 0;
  const partitioned: RouteSegment[][] = [];

  for (const day of revision.plan.days) {
    const edges = expectedEdgesForDay(revision, variant.kind, day.day);
    const segments: RouteSegment[] = [];

    for (const edge of edges) {
      const segment = variant.segments[cursor];
      if (
        !segment ||
        segment.fromRef !== edge.fromRef ||
        segment.toRef !== edge.toRef
      ) {
        return null;
      }
      segments.push(segment);
      cursor += 1;
    }

    partitioned.push(segments);
  }

  return cursor === variant.segments.length ? partitioned : null;
}

function expectedEdgesForDay(
  revision: ItineraryRevision,
  kind: RouteVariant["kind"],
  dayNumber: number,
): RouteEdge[] {
  const day = revision.plan.days.find((candidate) => candidate.day === dayNumber);
  if (!day) {
    return [];
  }

  const lodgingRef = revision.plan.lodging.contentId;
  const visitRefs = day.visits.map((visit) => visit.contentId);
  const isFirstDay = dayNumber === 1;
  const isLastDay = dayNumber === revision.intent.durationDays;
  const edges: RouteEdge[] = [];
  let currentRef = lodgingRef;
  let startVisitIndex = 0;

  if (isFirstDay && kind === "standard" && revision.intent.luggageCount > 0) {
    edges.push({ fromRef: "origin", toRef: lodgingRef });
  } else if (isFirstDay && visitRefs[0]) {
    edges.push({ fromRef: "origin", toRef: visitRefs[0] });
    currentRef = visitRefs[0];
    startVisitIndex = 1;
  } else if (isFirstDay) {
    edges.push({ fromRef: "origin", toRef: lodgingRef });
  }

  for (let index = startVisitIndex; index < visitRefs.length; index += 1) {
    edges.push({ fromRef: currentRef, toRef: visitRefs[index] });
    currentRef = visitRefs[index];
  }

  const endRef = isLastDay ? "origin" : lodgingRef;
  if (currentRef !== endRef) {
    edges.push({ fromRef: currentRef, toRef: endRef });
  }

  return edges;
}

function orderedRefs(segments: RouteSegment[]) {
  if (segments.length === 0) {
    return [];
  }
  return [segments[0].fromRef, ...segments.map((segment) => segment.toRef)];
}

function coordinateForRef(
  revision: ItineraryRevision,
  ref: string,
): MapCoordinate | undefined {
  if (ref !== "origin") {
    return revision.selectedPlaceSnapshots[ref]?.coordinate;
  }

  for (const segment of [
    ...revision.standard.segments,
    ...revision.carryme.segments,
  ]) {
    if (segment.fromRef === "origin") {
      const coordinate = segment.paths.find((path) => path.length > 0)?.[0];
      if (coordinate) {
        return coordinate;
      }
    }
    if (segment.toRef === "origin") {
      const path = [...segment.paths].reverse().find((candidate) => candidate.length > 0);
      const coordinate = path?.at(-1);
      if (coordinate) {
        return coordinate;
      }
    }
  }
  return undefined;
}

function contentTypeLabel(contentTypeId: TourPlaceSnapshot["contentTypeId"]) {
  return (
    {
      12: "관광지",
      14: "문화시설",
      15: "행사",
      28: "레포츠",
      32: "숙소",
      38: "쇼핑",
      39: "음식점",
    } as const
  )[contentTypeId];
}

function formatTripDuration(days: number) {
  return days === 1 ? "당일치기" : `${days - 1}박 ${days}일`;
}

function formatDuration(minutes: number) {
  const normalized = Math.max(0, Math.round(minutes));
  const hours = Math.floor(normalized / 60);
  const remainder = normalized % 60;
  if (hours === 0) {
    return `약 ${remainder}분`;
  }
  return remainder === 0 ? `약 ${hours}시간` : `약 ${hours}시간 ${remainder}분`;
}

function formatSaving(minutes: number) {
  return minutes > 0 ? `${formatDuration(minutes)} 절약` : "시간 절약 없음";
}

function formatClock(minutes: number) {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}
