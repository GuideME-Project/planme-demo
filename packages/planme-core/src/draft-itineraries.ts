import type {
  BenefitItem,
  ItineraryDay,
  MapCoordinate,
  MapPoint,
  PlanmeItinerary,
  PlanmeRowMode,
  PlanmeTransportMode,
  PlanmeStopRole,
  RoutePlan,
  RouteStop,
  TimelineEvent,
} from "./mock-data.js";
import type { PlanmePlaceCandidateSource } from "./place-candidates.js";

export type PlanmeDraftStop = {
  name: string;
  role?: string;
  caption?: string;
  coordinate?: MapCoordinate;
  addressQuery?: string;
  placeId?: string;
  placeSource?: PlanmePlaceCandidateSource;
  placeSourceRef?: string;
  mode?: PlanmeRowMode;
  requiredPlaceKind?: "origin" | "destination" | "must_visit";
};

export type PlanmeDraftRouteStop = {
  name: string;
  caption?: string;
  coordinate?: MapCoordinate;
  addressQuery?: string;
  mode?: PlanmeRowMode;
  placeId?: string;
  placeSource?: PlanmePlaceCandidateSource;
  placeSourceRef?: string;
  role?: PlanmeStopRole;
  requiredPlaceKind?: "origin" | "destination" | "must_visit";
};

export type PlanmeDraftTimelineEvent = {
  time: string;
  title: string;
  description: string;
  category?: TimelineEvent["category"];
  highlight?: boolean;
  savingLabel?: string;
  stopIndex?: number | null;
  stayDurationMinutes?: number;
};

export type PlanmeDraftDay = {
  day?: number;
  label?: string;
  stops?: PlanmeDraftStop[];
  standardStops?: PlanmeDraftRouteStop[];
  carrymeStops?: PlanmeDraftRouteStop[];
  timeline?: PlanmeDraftTimelineEvent[];
  standardTimeline?: PlanmeDraftTimelineEvent[];
  carrymeTimeline?: PlanmeDraftTimelineEvent[];
  standardDurationMinutes?: number;
  carrymeDurationMinutes?: number;
  standardRouteText?: string;
  carrymeRouteText?: string;
};

export type PlanmeDraftPreviewRequest = {
  previewId?: string;
  baseVersion?: number;
  title: string;
  region?: string;
  duration?: string;
  summary?: string;
  origin?: string;
  assumptions?: string[];
  savedMinutes?: number;
  transportMode: PlanmeTransportMode;
  days: PlanmeDraftDay[];
};

export type PlanmeDraftCommitRequest = {
  previewId: string;
  version: number;
  userConfirmed: boolean;
  idempotencyKey: string;
  visibility: "private" | "public";
};

export type PlanmeDraftValidationIssue = {
  code: string;
  message: string;
  severity: "error" | "warning";
};

export type PlanmeDraftPreviewResult = {
  itinerary: PlanmeItinerary;
  previewId: string;
  status: "preview_ready" | "needs_revision" | "committed";
  validationIssues: PlanmeDraftValidationIssue[];
  version: number;
  visibility?: "private" | "public";
};

type DraftPreviewRecord = PlanmeDraftPreviewResult & {
  committedAt?: string;
};

type CreatePlanmeDraftPreviewOptions = {
  extraValidationIssues?: PlanmeDraftValidationIssue[];
};

const draftPreviewStore = new Map<string, DraftPreviewRecord>();
const committedDraftKeys = new Map<string, string>();

// Route-like title detection keeps AI-generated multi-POI strings out of compact widget headings.
const ROUTE_TITLE_SEPARATOR_THRESHOLD = 2;
const DRAFT_TITLE_MAX_LENGTH = 44;
// PlanME previews cap AI-authored days to keep widget payloads bounded while supporting multi-night trips.
const MAX_DRAFT_DAYS = 14;
const DEFAULT_AIRPORT_ORIGIN_PATTERN = /^(ICN|인천\s*(국제)?공항)$/i;
const UNKNOWN_ORIGIN_LABEL = "출발지 확인 필요";
const PLANME_STOP_ROLES = ["출발지", "방문지", "숙소", "복귀지"] as const;
const PLANME_ROW_MODES = ["drive", "transit"] as const;
const DRAFT_PLACE_ALIAS_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /Namhae\s+German\s+Village/gi, replacement: "남해 독일마을" },
  { pattern: /House\s+N\s+Garden/gi, replacement: "원예예술촌" },
  { pattern: /Sangju\s+Silver\s+Sand\s+Beach/gi, replacement: "상주은모래비치" },
];
const BAGGAGE_DELIVERY_EVENT_PATTERN =
  /(?:(?:짐|수하물)\s*(?:은|는|이|가|도|만)?\s*.{0,24}?(?:배송|도착)|(?:배송|도착)(?:한|된|할)?\s*(?:짐|수하물))/;
const LEGACY_STANDARD_CHECKIN_PATTERN =
  /^(.*?)\s*체크인\s*전\s*(?:짐|수하물)\s*(?:보관|맡기(?:기)?|맡김)\s*$/;
const FINAL_DAY_LODGING_RETURN_PATTERN = /(?:^|\s)(?:복귀|숙박|도착)(?:\s|$)/;

type TimelineEventLike = {
  category?: TimelineEvent["category"];
  description: string;
  title: string;
};

export type TimelineRouteStopLike = {
  label?: string;
  name?: string;
  role?: string;
};

/**
 * Converts a ChatGPT-authored PlanME draft into a widget-ready itinerary preview.
 */
export function createPlanmeDraftPreview(
  input: PlanmeDraftPreviewRequest,
  options: CreatePlanmeDraftPreviewOptions = {},
): PlanmeDraftPreviewResult {
  const normalizedInput = normalizeDraftPreviewTimelines(input);
  const previewId = normalizedInput.previewId?.trim() || createDraftPreviewId(normalizedInput);
  const validationIssues = [
    ...validateDraftPreviewInput(normalizedInput),
    ...(options.extraValidationIssues ?? []),
  ];
  const existingRecord = draftPreviewStore.get(previewId);
  const version = existingRecord ? existingRecord.version + 1 : 1;
  const itinerary = buildDraftItinerary(normalizedInput, previewId, validationIssues);
  const status = validationIssues.some((issue) => issue.severity === "error")
    ? "needs_revision"
    : "preview_ready";
  const record: DraftPreviewRecord = {
    itinerary,
    previewId,
    status,
    validationIssues,
    version,
  };

  // Store the normalized preview so update and commit tools can share one version chain.
  draftPreviewStore.set(previewId, record);

  return record;
}

/**
 * Detects a CarryME parcel-delivery event without treating generic saving copy as delivery.
 */
export function isCarrymeDeliveryEvent(event: TimelineEventLike) {
  if (event.category === "carryme") {
    return true;
  }

  const eventText = `${event.title} ${event.description}`.replace(/\s+/g, " ").trim();

  return BAGGAGE_DELIVERY_EVENT_PATTERN.test(eventText);
}

/**
 * Keeps only Standard traveler events and normalizes the approved legacy check-in wording.
 */
export function normalizeStandardTimelineEvents<T extends TimelineEventLike>(
  events: readonly T[],
): T[] {
  return events
    .filter((event) => !isCarrymeDeliveryEvent(event))
    .map((event) => {
      const checkinMatch = LEGACY_STANDARD_CHECKIN_PATTERN.exec(event.title.trim());

      if (!checkinMatch?.[1]?.trim()) {
        return event;
      }

      // Only the explicitly approved legacy check-in phrase is rewritten.
      return {
        ...event,
        description: "호텔에 체크인한 뒤 다음 일정으로 이동합니다.",
        title: `${checkinMatch[1].trim()} 체크인`,
      };
    });
}

/**
 * Gives explicit CarryME parcel events the stable category used by the delivery icon.
 */
export function normalizeCarrymeTimelineEvents<T extends TimelineEventLike>(
  events: readonly T[],
): T[] {
  return events.map((event) => {
    if (!isCarrymeDeliveryEvent(event) || event.category === "carryme") {
      return event;
    }

    // Preserve the authored copy while stabilizing only the semantic category.
    return { ...event, category: "carryme" };
  });
}

/**
 * Removes a trailing-trip lodging return that conflicts with the final return destination.
 */
export function normalizeFinalDayTimelineEvents<T extends TimelineEventLike>(
  events: readonly T[],
  stops: readonly TimelineRouteStopLike[],
): T[] {
  const finalStop = stops.at(-1);

  if (finalStop?.role !== "복귀지") {
    return [...events];
  }

  const finalStopLabel = getTimelineStopLabel(finalStop);
  const lodgingLabels = stops
    .filter((stop) => stop.role === "숙소")
    .map(getTimelineStopLabel)
    .filter(Boolean);

  return events.filter((event) => {
    if (isCarrymeDeliveryEvent(event)) {
      return true;
    }

    const title = event.title.replace(/\s+/g, " ").trim();
    const referencesLodging = lodgingLabels.some((label) => title.includes(label));
    const isLodgingReturn =
      FINAL_DAY_LODGING_RETURN_PATTERN.test(title) &&
      (event.category === "hotel" || referencesLodging);

    // Preserve an explicitly selected hotel destination even when it uses return wording.
    return !isLodgingReturn || Boolean(finalStopLabel && title.includes(finalStopLabel));
  });
}

/** Returns the display name shared by draft stops and stored route stops. */
function getTimelineStopLabel(stop: TimelineRouteStopLike) {
  return stop.name?.trim() || stop.label?.trim() || "";
}

/**
 * Normalizes all route-specific timelines before the same draft is validated and rendered.
 */
function normalizeDraftPreviewTimelines(
  input: PlanmeDraftPreviewRequest,
): PlanmeDraftPreviewRequest {
  return {
    ...input,
    days: input.days.map((day, dayIndex) => {
      const standardTimeline = day.standardTimeline ?? day.timeline;
      const carrymeTimeline = day.carrymeTimeline ?? day.timeline;
      const isFinalDay = dayIndex === input.days.length - 1;
      const standardStops = day.standardStops ?? day.stops ?? [];
      const carrymeStops = day.carrymeStops ?? day.standardStops ?? day.stops ?? [];
      const normalizedStandardTimeline = standardTimeline
        ? normalizeStandardTimelineEvents(standardTimeline)
        : undefined;
      const normalizedCarrymeTimeline = carrymeTimeline
        ? normalizeCarrymeTimelineEvents(carrymeTimeline)
        : undefined;

      return {
        ...day,
        ...(normalizedStandardTimeline
          ? {
              standardTimeline: isFinalDay
                ? normalizeFinalDayTimelineEvents(normalizedStandardTimeline, standardStops)
                : normalizedStandardTimeline,
            }
          : {}),
        ...(normalizedCarrymeTimeline
          ? {
              carrymeTimeline: isFinalDay
                ? normalizeFinalDayTimelineEvents(normalizedCarrymeTimeline, carrymeStops)
                : normalizedCarrymeTimeline,
            }
          : {}),
      };
    }),
  };
}

/**
 * Updates an existing preview using the same normalization and validation path.
 */
export function updatePlanmeDraftPreview(
  input: PlanmeDraftPreviewRequest,
  options: CreatePlanmeDraftPreviewOptions = {},
): PlanmeDraftPreviewResult {
  return createPlanmeDraftPreview(input, options);
}

/**
 * Marks a validated preview as committed and returns the same itinerary for rendering.
 */
export function commitPlanmeDraftPreview(
  input: PlanmeDraftCommitRequest,
): PlanmeDraftPreviewResult | null {
  const committedPreviewId = committedDraftKeys.get(input.idempotencyKey);
  const record = draftPreviewStore.get(committedPreviewId ?? input.previewId);

  if (!record || !input.userConfirmed || input.version !== record.version) {
    return null;
  }

  const committedRecord: DraftPreviewRecord = {
    ...record,
    committedAt: new Date().toISOString(),
    status: "committed",
    visibility: input.visibility,
  };

  // Idempotency prevents repeated ChatGPT tool retries from creating divergent commits.
  committedDraftKeys.set(input.idempotencyKey, committedRecord.previewId);
  draftPreviewStore.set(committedRecord.previewId, committedRecord);

  return committedRecord;
}

/**
 * Reads a draft preview itinerary by id when the current process still has it in memory.
 */
export function getPlanmeDraftPreviewItineraryById(id: string): PlanmeItinerary | null {
  return draftPreviewStore.get(id)?.itinerary ?? null;
}

/**
 * Validates the minimal contract required for PlanME to render a ChatGPT draft safely.
 */
function validateDraftPreviewInput(input: PlanmeDraftPreviewRequest) {
  const validationIssues: PlanmeDraftValidationIssue[] = [];
  const explicitOrigin = inferExplicitDraftOrigin(input.origin, input.assumptions ?? []);

  if (!input.title.trim()) {
    validationIssues.push({
      code: "missing_title",
      message: "일정 제목이 필요합니다.",
      severity: "error",
    });
  }

  if (input.days.length === 0) {
    validationIssues.push({
      code: "missing_days",
      message: "하루 이상의 일정이 필요합니다.",
      severity: "error",
    });
  }

  input.days.forEach((day, dayIndex) => {
    const standardStops = day.standardStops ?? day.stops ?? [];
    const carrymeStops = day.carrymeStops ?? day.stops ?? [];
    const standardTimeline = day.standardTimeline ?? day.timeline ?? [];
    const carrymeTimeline = day.carrymeTimeline ?? day.timeline ?? [];

    if (standardStops.length === 0 || carrymeStops.length === 0) {
      validationIssues.push({
        code: "missing_stops",
        message: `${day.label ?? `Day ${dayIndex + 1}`}에 Standard와 CarryME 방문지가 필요합니다.`,
        severity: "error",
      });
    }

    if (standardTimeline.length === 0 || carrymeTimeline.length === 0) {
      validationIssues.push({
        code: "missing_timeline",
        message: `${day.label ?? `Day ${dayIndex + 1}`}에 Standard와 CarryME 타임라인이 필요합니다.`,
        severity: "error",
      });
    }

    validateGeneratedRouteStopContract(day.standardStops, "Standard", day, dayIndex, validationIssues);
    validateGeneratedRouteStopContract(day.carrymeStops, "CarryME", day, dayIndex, validationIssues);
    validateGeneratedTimelineContract(
      day.standardTimeline,
      standardStops.length,
      "Standard",
      day,
      dayIndex,
      validationIssues,
    );
    validateGeneratedTimelineContract(
      day.carrymeTimeline,
      carrymeStops.length,
      "CarryME",
      day,
      dayIndex,
      validationIssues,
    );
  });

  if (!explicitOrigin && draftContainsDefaultAirportOrigin(input)) {
    validationIssues.push({
      code: "missing_explicit_origin",
      message: "출발지가 누락된 상태에서 기본 공항값이 감지됐습니다. 실제 출발지를 다시 확인해야 합니다.",
      severity: "error",
    });
  }

  return validationIssues;
}

function validateGeneratedTimelineContract(
  events: PlanmeDraftTimelineEvent[] | undefined,
  stopCount: number,
  routeLabel: "CarryME" | "Standard",
  day: PlanmeDraftDay,
  dayIndex: number,
  validationIssues: PlanmeDraftValidationIssue[],
) {
  if (
    !events ||
    !events.some(
      (event) => event.stopIndex !== undefined || event.stayDurationMinutes !== undefined,
    )
  ) {
    return;
  }

  const referencedStopIndexes = new Set<number>();
  const referenceCounts = new Map<number, number>();
  const dayLabel = day.label ?? `Day ${dayIndex + 1}`;

  events.forEach((event, eventIndex) => {
    const stopIndex = event.stopIndex;

    if (
      stopIndex !== null &&
      (!Number.isInteger(stopIndex) || stopIndex === undefined || stopIndex < 0 || stopIndex >= stopCount)
    ) {
      validationIssues.push({
        code: "invalid_timeline_stop_index",
        message: `${dayLabel} ${routeLabel} ${eventIndex + 1}번째 타임라인의 장소 참조가 올바르지 않습니다.`,
        severity: "error",
      });
    } else if (typeof stopIndex === "number") {
      referencedStopIndexes.add(stopIndex);
      referenceCounts.set(stopIndex, (referenceCounts.get(stopIndex) ?? 0) + 1);
    }

    if (
      !Number.isInteger(event.stayDurationMinutes) ||
      (event.stayDurationMinutes ?? -1) < 0
    ) {
      validationIssues.push({
        code: "invalid_timeline_stay_duration",
        message: `${dayLabel} ${routeLabel} ${eventIndex + 1}번째 타임라인의 체류시간이 올바르지 않습니다.`,
        severity: "error",
      });
    }
  });

  for (let stopIndex = 0; stopIndex < stopCount; stopIndex += 1) {
    if (!referencedStopIndexes.has(stopIndex)) {
      validationIssues.push({
        code: "missing_timeline_stop_reference",
        message: `${dayLabel} ${routeLabel} ${stopIndex + 1}번째 장소의 대표 타임라인이 없습니다.`,
        severity: "error",
      });
    }

    if ((referenceCounts.get(stopIndex) ?? 0) > 1) {
      validationIssues.push({
        code: "duplicate_timeline_stop_reference",
        message: `${dayLabel} ${routeLabel} ${stopIndex + 1}번째 장소의 대표 타임라인이 중복되었습니다.`,
        severity: "error",
      });
    }
  }
}

/**
 * Validates only the new route-stop contract; legacy `stops` payloads remain renderable.
 */
function validateGeneratedRouteStopContract(
  stops: PlanmeDraftRouteStop[] | undefined,
  routeLabel: "CarryME" | "Standard",
  day: PlanmeDraftDay,
  dayIndex: number,
  validationIssues: PlanmeDraftValidationIssue[],
) {
  if (!stops) {
    return;
  }

  stops.forEach((stop, stopIndex) => {
    const dayLabel = day.label ?? `Day ${dayIndex + 1}`;
    const stopLabel = stop.name.trim() || `${stopIndex + 1}번째 행선지`;

    if (!isPlanmeStopRole(stop.role)) {
      validationIssues.push({
        code: "missing_stop_role",
        message: `${dayLabel} ${routeLabel} ${stopLabel}의 역할을 확인해야 합니다.`,
        severity: "error",
      });
    }

    if (!isPlanmeRowMode(stop.mode)) {
      validationIssues.push({
        code: "missing_stop_mode",
        message: `${dayLabel} ${routeLabel} ${stopLabel}의 대표 이동수단을 확인해야 합니다.`,
        severity: "error",
      });
    }
  });
}

/**
 * Builds the PlanME itinerary object consumed by both the ChatGPT widget and web page.
 */
function buildDraftItinerary(
  input: PlanmeDraftPreviewRequest,
  previewId: string,
  validationIssues: PlanmeDraftValidationIssue[],
): PlanmeItinerary {
  const region = input.region?.trim() || inferRegionFromTitle(input.title);
  const duration = input.duration?.trim() || "초안";
  const title = normalizeDraftDisplayTitle(input.title, region, duration);
  const explicitOrigin = inferExplicitDraftOrigin(input.origin, input.assumptions ?? []);
  const originReplacement =
    explicitOrigin ?? (draftContainsDefaultAirportOrigin(input) ? UNKNOWN_ORIGIN_LABEL : null);
  const luggageFallbackLabel = createRegionLuggageFallbackLabel(region);
  const days = input.days.length > 0
    ? input.days
        .slice(0, MAX_DRAFT_DAYS)
        .map((day, index) =>
          buildDraftDay(
            day,
            index,
            input.savedMinutes ?? 0,
            index === 0 ? originReplacement : null,
            luggageFallbackLabel,
          ),
        )
    : [buildEmptyDraftDay(input.savedMinutes ?? 0)];
  const firstDay = days[0];
  const savedMinutes = Math.max(0, input.savedMinutes ?? firstDay.savingMinutes ?? 0);
  const summaryPrefix = input.summary?.trim() || `${title}을 PlanME 위젯으로 미리 봅니다.`;
  const issueSummary =
    validationIssues.length > 0
      ? ` 검증 필요: ${validationIssues.map((issue) => issue.message).join(" ")}`
      : "";

  return {
    id: previewId,
    title,
    region,
    duration,
    summary: `${summaryPrefix}${issueSummary}`,
    detailUrl: `/itinerary/${previewId}`,
    carrymeSaving: formatCarrymeSavingLabel(savedMinutes),
    totalDurationLabel: `${firstDay.standard.durationLabel} → ${firstDay.carryme.durationLabel}`,
    savedDurationLabel: formatCarrymeSavingLabel(savedMinutes),
    transportMode: input.transportMode,
    days,
    benefits: createDraftBenefits(region, input.assumptions ?? []),
  };
}

/**
 * Builds one normalized day from ChatGPT stops and timeline data.
 */
function buildDraftDay(
  day: PlanmeDraftDay,
  index: number,
  savedMinutes: number,
  explicitOrigin: string | null = null,
  luggageFallbackLabel = "숙소",
): ItineraryDay {
  const hasStableTimelineContract = [
    ...(day.standardTimeline ?? []),
    ...(day.carrymeTimeline ?? []),
  ].some(
    (event) => event.stopIndex !== undefined || event.stayDurationMinutes !== undefined,
  );
  const resolveStopReference = hasStableTimelineContract
    ? createDraftStopReferenceResolver(index)
    : undefined;
  const standardStops = createDraftRouteStops(
    day.standardStops ?? day.stops ?? [],
    explicitOrigin,
    luggageFallbackLabel,
    resolveStopReference,
  );
  const carrymeStops = normalizeCarrymeTravelerStops(
    day.carrymeStops
      ? createDraftRouteStops(
          day.carrymeStops,
          explicitOrigin,
          luggageFallbackLabel,
          resolveStopReference,
        )
      : buildCarrymeStops(standardStops),
  );
  let routeLikeTimelineIndex = 0;
  const routeText = standardStops.map((stop) => stop.label).join(" → ") || "일정 초안 확인 중";
  const carrymeRouteText =
    carrymeStops.map((stop) => stop.label).join(" → ") || day.carrymeRouteText?.trim() || routeText;
  const carrymeMinutes = Math.max(0, day.carrymeDurationMinutes ?? 300);
  const standardMinutes = Math.max(
    carrymeMinutes,
    day.standardDurationMinutes ?? carrymeMinutes + savedMinutes,
  );

  return {
    day: index + 1,
    label: day.label?.trim() || `Day ${index + 1}`,
    savingMinutes: Math.max(0, standardMinutes - carrymeMinutes),
    standard: buildRoutePlan({
      id: "standard",
      label: "Standard",
      routeText: day.standardRouteText?.trim() || routeText,
      durationMinutes: standardMinutes,
      description: "짐을 직접 들고 이동하는 일반 동선",
      stops: standardStops,
    }),
    carryme: buildRoutePlan({
      id: "carryme",
      label: "CarryME",
      routeText: carrymeRouteText,
      durationMinutes: carrymeMinutes,
      stops: carrymeStops,
      description: "짐은 CarryME가 이동하고 여행자는 일정으로 바로 이동",
    }),
    standardTimeline: buildDraftTimelineEvents(
      day.standardTimeline ?? day.timeline ?? [],
      standardStops,
      explicitOrigin,
    ),
    carrymeTimeline: buildDraftTimelineEvents(
      day.carrymeTimeline ?? day.timeline ?? [],
      carrymeStops,
      explicitOrigin,
    ),
    timeline: buildDraftTimelineEvents(
      day.carrymeTimeline ?? day.timeline ?? [],
      carrymeStops,
      explicitOrigin,
      routeLikeTimelineIndex,
    ),
  };
}

/**
 * Provides a renderable placeholder when validation already found a missing day.
 */
function buildEmptyDraftDay(savedMinutes: number): ItineraryDay {
  return buildDraftDay(
    {
      day: 1,
      label: "Day 1",
      standardStops: [{ name: "일정 초안", caption: "확인 필요", mode: "transit", role: "방문지" }],
      carrymeStops: [{ name: "일정 초안", caption: "확인 필요", mode: "transit", role: "방문지" }],
      standardTimeline: [
        {
          time: "--:--",
          title: "일정 초안 확인 필요",
          description: "ChatGPT가 만든 일정 초안을 다시 확인해야 합니다.",
          category: "event",
        },
      ],
      carrymeTimeline: [
        {
          time: "--:--",
          title: "일정 초안 확인 필요",
          description: "ChatGPT가 만든 일정 초안을 다시 확인해야 합니다.",
          category: "event",
        },
      ],
    },
    0,
    savedMinutes,
  );
}

/**
 * Creates one route plan with deterministic map points for widget previews.
 */
function buildRoutePlan({
  description,
  durationMinutes,
  id,
  label,
  routeText,
  stops,
}: {
  description: string;
  durationMinutes: number;
  id: RoutePlan["id"];
  label: string;
  routeText: string;
  stops: RouteStop[];
}): RoutePlan {
  const hasCompleteGeoPath = stops.length > 0 && stops.every((stop) => stop.coordinate);
  const geoPath = hasCompleteGeoPath
    ? stops.map((stop) => stop.coordinate as MapCoordinate)
    : [];

  return {
    id,
    label,
    badge: label,
    routeText,
    description,
    durationLabel: formatMinutes(durationMinutes),
    durationMinutes,
    stops,
    geoPath: geoPath.length > 0 ? geoPath : undefined,
    mapPath: createMapPath(stops.length),
  };
}

/**
 * Keeps luggage-destination stops visible while avoiding duplicate empty CarryME paths.
 */
function buildCarrymeStops(stops: RouteStop[]) {
  const nonLuggageStops = stops.filter((stop) => stop.caption !== "짐 도착");
  const luggageStops = stops.filter((stop) => stop.caption === "짐 도착");

  return [...nonLuggageStops, ...luggageStops].length > 0 ? [...nonLuggageStops, ...luggageStops] : stops;
}

/**
 * Keeps luggage-delivery events in the timeline without creating zero-distance traveler legs.
 */
function normalizeCarrymeTravelerStops(stops: RouteStop[]) {
  const travelerStops = stops.filter((stop, index) => {
    if (!isLuggageArrivalStop(stop)) {
      return true;
    }

    // A separate traveler stop at the same place owns the physical route destination.
    return !stops.some(
      (candidate, candidateIndex) =>
        candidateIndex !== index &&
        !isLuggageArrivalStop(candidate) &&
        isSamePhysicalStop(stop, candidate),
    );
  });

  return travelerStops.reduce<RouteStop[]>((normalized, stop) => {
    const previous = normalized[normalized.length - 1];

    if (previous && isSamePhysicalStop(previous, stop)) {
      // Prefer the later traveler event while collapsing only adjacent identical places.
      normalized[normalized.length - 1] = stop;
      return normalized;
    }

    normalized.push(stop);
    return normalized;
  }, []);
}

/**
 * Identifies a CarryME parcel-arrival event that must not become a traveler route leg.
 */
function isLuggageArrivalStop(stop: RouteStop) {
  const caption = stop.caption.replace(/\s+/g, " ").trim();

  return stop.role === "숙소" && /짐.*도착|도착.*짐/.test(caption);
}

/**
 * Compares provider identity first and exact resolved coordinates as a safe fallback.
 */
function isSamePhysicalStop(left: RouteStop, right: RouteStop) {
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

/**
 * Converts AI-authored route stops without inferring lodging meaning from text.
 */
function createDraftRouteStops(
  stops: Array<PlanmeDraftRouteStop | PlanmeDraftStop>,
  explicitOrigin: string | null,
  luggageFallbackLabel: string,
  resolveStopReference?: DraftStopReferenceResolver,
) {
  return sanitizeStationLuggageStops(
    sanitizeDraftOriginStops(
      stops.map((stop) => toRouteStop(stop, resolveStopReference)),
      explicitOrigin,
    ),
    luggageFallbackLabel,
  );
}

type DraftStopReferenceResolver = (
  stop: PlanmeDraftRouteStop | PlanmeDraftStop,
) => Pick<RouteStop, "placeConstraint" | "stopRef">;

function createDraftStopReferenceResolver(dayIndex: number): DraftStopReferenceResolver {
  const stopRefsByIdentity = new Map<string, string>();

  return (stop) => {
    const identity = createDraftStopIdentity(stop);
    let stopRef = stopRefsByIdentity.get(identity);

    if (!stopRef) {
      stopRef = `day-${dayIndex + 1}-stop-${stopRefsByIdentity.size + 1}`;
      stopRefsByIdentity.set(identity, stopRef);
    }

    return {
      placeConstraint: stop.requiredPlaceKind ? "fixed" : "replaceable",
      stopRef,
    };
  };
}

function createDraftStopIdentity(stop: PlanmeDraftRouteStop | PlanmeDraftStop) {
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

/**
 * Converts AI-authored timeline rows for one route without borrowing another route's semantics.
 */
function buildDraftTimelineEvents(
  events: PlanmeDraftTimelineEvent[],
  stops: RouteStop[],
  explicitOrigin: string | null,
  routeLikeTimelineStartIndex = 0,
): TimelineEvent[] {
  let routeLikeTimelineIndex = routeLikeTimelineStartIndex;

  return events.map((rawEvent) => {
    const event = sanitizeStationLuggageTimelineEvent(
      sanitizeDraftOriginTimelineEvent(rawEvent, explicitOrigin),
    );
    const isRouteLike = isRouteLikeText(event.title);
    const fallbackStop =
      typeof event.stopIndex === "number"
        ? stops[event.stopIndex]
        : event.stopIndex === undefined && isRouteLike
          ? selectTimelineStop(stops, event, routeLikeTimelineIndex)
          : undefined;

    if (isRouteLike) {
      routeLikeTimelineIndex += 1;
    }

    return toTimelineEvent(event, fallbackStop);
  });
}

/**
 * Checks whether an AI-authored role is part of the approved Korean stop contract.
 */
function isPlanmeStopRole(role: string | undefined): role is PlanmeStopRole {
  return PLANME_STOP_ROLES.some((candidate) => candidate === role);
}

/**
 * Checks whether a stop mode is a user-selectable representative mode.
 */
function isPlanmeRowMode(mode: string | undefined): mode is PlanmeRowMode {
  return PLANME_ROW_MODES.some((candidate) => candidate === mode);
}

/**
 * Maps the approved stop role to the existing icon vocabulary without using name keywords.
 */
function getIconForStopRole(role: PlanmeStopRole | undefined, caption: string): RouteStop["icon"] {
  if (role === "숙소") {
    return "hotel";
  }

  if (role === "출발지" || role === "복귀지" || caption === "출발") {
    return "station";
  }

  return "event";
}

/**
 * Converts ChatGPT stop roles into stable PlanME captions and icons.
 */
function toRouteStop(
  stop: PlanmeDraftRouteStop | PlanmeDraftStop,
  resolveStopReference?: DraftStopReferenceResolver,
): RouteStop {
  const caption = stop.caption?.trim() || "방문";
  const role = isPlanmeStopRole(stop.role) ? stop.role : undefined;
  const mode = "mode" in stop && isPlanmeRowMode(stop.mode) ? stop.mode : undefined;
  const placeId = "placeId" in stop ? stop.placeId?.trim() : undefined;

  return {
    label: normalizeDraftPlaceAliases(stop.name.trim()),
    caption,
    coordinate: stop.coordinate,
    icon: getIconForStopRole(role, caption),
    mode,
    placeId,
    placeSource: stop.placeSource,
    placeSourceRef: stop.placeSourceRef,
    role,
    ...resolveStopReference?.(stop),
  };
}

/**
 * Normalizes timeline categories while keeping one event title from becoming a full route list.
 */
function toTimelineEvent(
  event: PlanmeDraftTimelineEvent,
  fallbackStop?: RouteStop,
): TimelineEvent {
  return {
    time: event.time,
    title: normalizeTimelineTitle(event, fallbackStop),
    description: event.description,
    category: event.category ?? "event",
    highlight: event.highlight,
    savingLabel: event.savingLabel,
    stopRef: fallbackStop?.stopRef,
    stayDurationMinutes: event.stayDurationMinutes,
  };
}

/**
 * Infers a user-confirmed origin from explicit fields before trusting draft stops.
 */
function inferExplicitDraftOrigin(origin: string | undefined, assumptions: string[]) {
  const normalizedOrigin = normalizeDraftOriginText(origin);

  if (normalizedOrigin && !isDefaultAirportOrigin(normalizedOrigin)) {
    return normalizedOrigin;
  }

  for (const assumption of assumptions) {
    const assumptionOrigin = extractDraftOriginAssumption(assumption);

    if (assumptionOrigin && !isDefaultAirportOrigin(assumptionOrigin)) {
      return assumptionOrigin;
    }
  }

  return null;
}

/**
 * Creates the safest visible luggage destination when a draft tries to use a transit hub.
 */
function createRegionLuggageFallbackLabel(region: string) {
  const normalizedRegion = region.trim();

  // A generic lodging label avoids inventing a specific hotel while keeping CarryME delivery plausible.
  return normalizedRegion ? `${normalizedRegion} 숙소` : "숙소";
}

/**
 * Detects model-authored drafts that leaked the legacy demo airport without a real origin.
 */
function draftContainsDefaultAirportOrigin(input: PlanmeDraftPreviewRequest) {
  return input.days.some((day) =>
    getDraftDayStops(day).some((stop) => containsDefaultAirportOrigin(stop.name)) ||
    getDraftDayTimelineEvents(day).some(
      (event) =>
        containsDefaultAirportOrigin(event.title) ||
        containsDefaultAirportOrigin(event.description),
    ),
  );
}

/**
 * Lists every route stop shape a draft day may provide during the contract transition.
 */
function getDraftDayStops(day: PlanmeDraftDay): Array<PlanmeDraftRouteStop | PlanmeDraftStop> {
  return [
    ...(day.standardStops ?? []),
    ...(day.carrymeStops ?? []),
    ...(day.stops ?? []),
  ];
}

/**
 * Lists every timeline shape a draft day may provide during the contract transition.
 */
function getDraftDayTimelineEvents(day: PlanmeDraftDay): PlanmeDraftTimelineEvent[] {
  return [
    ...(day.standardTimeline ?? []),
    ...(day.carrymeTimeline ?? []),
    ...(day.timeline ?? []),
  ];
}

/**
 * Keeps a default airport hallucination from overriding a stated domestic origin.
 */
function sanitizeDraftOriginStops(stops: RouteStop[], explicitOrigin: string | null) {
  if (!explicitOrigin) {
    return stops;
  }

  return stops.map((stop) => {
    if (!isDefaultAirportOrigin(stop.label)) {
      return stop;
    }

    // The model sometimes injects ICN as a generic origin; preserve the user's stated origin instead.
    return {
      ...stop,
      label: explicitOrigin,
      caption: "출발",
      icon: "station" as const,
    };
  });
}

/**
 * Replaces plain station or terminal luggage handoffs with a generic lodging destination.
 */
function sanitizeStationLuggageStops(stops: RouteStop[], luggageFallbackLabel: string) {
  return stops.map((stop) => {
    if (!isInvalidTransitLuggageStop(stop)) {
      return stop;
    }

    // CarryME should deliver luggage to lodging or an explicitly named service point, not a transit hub.
    return {
      ...stop,
      label: luggageFallbackLabel,
      caption: "짐 도착",
      icon: "hotel" as const,
    };
  });
}

/**
 * Removes baggage handoff copy when a model attaches it to a station, terminal, or airport.
 */
function sanitizeStationLuggageTimelineEvent(
  event: PlanmeDraftTimelineEvent,
): PlanmeDraftTimelineEvent {
  const stationLabel =
    extractTransitHubLabel(event.title) ?? extractTransitHubLabel(event.description);
  if (
    stationLabel === null ||
    (!containsBaggageAction(event.title) && !containsBaggageAction(event.description))
  ) {
    return event;
  }

  const safeStationLabel = stationLabel;

  // Keep the travel milestone visible while removing the unsupported station luggage claim.
  return {
    ...event,
    title: sanitizeStationLuggageTitle(event.title, safeStationLabel),
    description: `${safeStationLabel}으로 이동해 다음 일정 또는 귀가를 준비합니다.`,
    category: event.category === "hotel" ? "transit" : event.category,
  };
}

/**
 * Checks whether a rendered stop would imply luggage storage or pickup at a transit hub.
 */
function isInvalidTransitLuggageStop(stop: RouteStop) {
  return isPlainTransitHubLabel(stop.label) && containsBaggageAction(stop.caption);
}

/**
 * Detects labels that are only transportation hubs, excluding lodging near a station.
 */
function isPlainTransitHubLabel(value: string) {
  const normalized = value.trim();

  if (/(숙소|호텔|수령\s*지점|보관\s*지점|카운터|센터)/.test(normalized)) {
    return false;
  }

  return /(역|터미널|공항)$/.test(normalized);
}

/**
 * Finds the first transit hub mention inside model-authored free text.
 */
function extractTransitHubLabel(value: string) {
  const match = /([가-힣A-Za-z0-9]+(?:역|터미널|공항))/.exec(value);

  return match?.[1] ?? null;
}

/**
 * Detects baggage handoff claims in titles, descriptions, and stop captions.
 */
function containsBaggageAction(value: string) {
  return /(?:(?:짐|수하물)\s*[을를은는이가도만]?\s*(?:보관|수령|회수|챙|도착|배송|맡|찾)|(?:보관|수령|회수|챙|도착|배송|맡|찾)\s*(?:한|된|할|할)?\s*(?:짐|수하물))/.test(
    value,
  );
}

/**
 * Keeps the transit milestone readable after stripping unsupported baggage actions.
 */
function sanitizeStationLuggageTitle(value: string, stationLabel: string) {
  const sanitized = value
    .replace(
      /\s*(?:및|후|에서)?\s*(?:짐|수하물)\s*[을를은는이가도만]?\s*(?:보관|수령|회수|챙(?:김|기)?|배송|맡(?:김|기)?|찾(?:기)?).*/g,
      "",
    )
    .replace(
      /\s*(?:짐|수하물)\s*[을를은는이가도만]?\s*(?:보관|수령|회수|챙(?:김|기)?|배송|맡(?:김|기)?|찾(?:기)?)\s*(?:및|후)?\s*/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();

  if (sanitized && !containsBaggageAction(sanitized)) {
    return sanitized;
  }

  return `${stationLabel} 이동`;
}

/**
 * Rewrites draft timeline copy when a model mixes a stated origin with an invented airport.
 */
function sanitizeDraftOriginTimelineEvent(
  event: PlanmeDraftTimelineEvent,
  explicitOrigin: string | null,
): PlanmeDraftTimelineEvent {
  const hasDefaultAirportCopy =
    containsDefaultAirportOrigin(event.title) || containsDefaultAirportOrigin(event.description);

  if (!explicitOrigin || !hasDefaultAirportCopy) {
    return event;
  }

  const isAirportArrivalEvent =
    containsDefaultAirportOrigin(event.title) && /도착|입국/.test(event.title);

  return {
    ...event,
    title: isAirportArrivalEvent
      ? explicitOrigin === UNKNOWN_ORIGIN_LABEL
        ? UNKNOWN_ORIGIN_LABEL
        : `${explicitOrigin} 출발`
      : replaceDefaultAirportOrigin(event.title, explicitOrigin),
    description:
      explicitOrigin === UNKNOWN_ORIGIN_LABEL
        ? "실제 출발지를 다시 확인해야 합니다."
        : isAirportArrivalEvent && event.description.includes("입국")
          ? "출발지에서 여행 일정 시작"
          : replaceDefaultAirportOrigin(event.description, explicitOrigin),
  };
}

/**
 * Normalizes free-text origin values without accepting empty strings.
 */
function normalizeDraftOriginText(value: string | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ");

  return normalized || null;
}

/**
 * Extracts assumptions like "동탄 출발" or "서울에서 출발" into an origin label.
 */
function extractDraftOriginAssumption(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  const match = /^(?:출발지[:：]\s*)?(.+?)(?:에서)?\s*출발(?:\s*기준)?$/.exec(normalized);

  return normalizeDraftOriginText(match?.[1]);
}

/**
 * Detects the legacy demo airport default that must not leak into domestic drafts.
 */
function isDefaultAirportOrigin(value: string) {
  return DEFAULT_AIRPORT_ORIGIN_PATTERN.test(value.trim().replace(/\s+/g, " "));
}

/**
 * Checks whether copy contains a default airport token.
 */
function containsDefaultAirportOrigin(value: string) {
  return /ICN|인천\s*(국제)?공항/i.test(value);
}

/**
 * Replaces default airport mentions while preserving the rest of the model-authored copy.
 */
function replaceDefaultAirportOrigin(value: string, explicitOrigin: string) {
  return value.replace(/ICN|인천\s*(국제)?공항/gi, explicitOrigin);
}

/**
 * Normalizes common English POI aliases that ChatGPT may send despite Korean itinerary copy.
 */
function normalizeDraftPlaceAliases(value: string) {
  let normalized = value;

  for (const replacement of DRAFT_PLACE_ALIAS_REPLACEMENTS) {
    normalized = normalized.replace(replacement.pattern, replacement.replacement);
  }

  // ChatGPT often describes a lodging stop in English even when the target POI is Korean.
  normalized = normalized.replace(/Lodging\s+near\s+(.+)/gi, "$1 인근 숙소");

  return normalized.replace(/\s*,\s*/g, ", ").trim();
}

/**
 * Keeps the widget title compact when a model sends a whole route as the title.
 */
function normalizeDraftDisplayTitle(title: string, region: string, duration: string) {
  const normalizedTitle = stripPlanmeTitlePrefix(normalizeDraftPlaceAliases(title.trim()));

  if (!isRouteLikeText(normalizedTitle)) {
    return normalizedTitle;
  }

  return buildCompactDraftTitle(region, duration);
}

/**
 * Builds a compact fallback title from stable trip metadata instead of long POI lists.
 */
function buildCompactDraftTitle(region: string, duration: string) {
  const durationLabel = duration === "초안" ? "" : `${duration} `;

  return `${region} ${durationLabel}일정 초안`.replace(/\s+/g, " ").trim();
}

/**
 * Removes the product prefix from page titles while keeping the brand in navigation.
 */
function stripPlanmeTitlePrefix(value: string) {
  return value.replace(/^PlanME\s+/i, "").trim();
}

/**
 * Detects model-generated route strings that are too dense for title-sized UI.
 */
function isRouteLikeText(value: string) {
  const separatorCount = (value.match(/[·→,]/g) ?? []).length;

  return (
    separatorCount >= ROUTE_TITLE_SEPARATOR_THRESHOLD &&
    value.trim().length > Math.min(DRAFT_TITLE_MAX_LENGTH, 20)
  );
}

/**
 * Selects the most relevant single stop when an event title contains the whole route.
 */
function selectTimelineStop(
  stops: RouteStop[],
  event: PlanmeDraftTimelineEvent,
  routeLikeTimelineIndex: number,
) {
  if (stops.length === 0) {
    return undefined;
  }

  if (event.title.includes("수령")) {
    return (
      stops.find((stop) => stop.caption === "짐 도착" || stop.caption === "도착") ??
      stops[stops.length - 1]
    );
  }

  const visibleStops = event.title.includes("출발")
    ? stops
    : stops.filter((stop) => stop.label !== UNKNOWN_ORIGIN_LABEL);

  return visibleStops[Math.min(routeLikeTimelineIndex, visibleStops.length - 1)] ?? stops[0];
}

/**
 * Replaces whole-route timeline titles with a single stop plus action label.
 */
function normalizeTimelineTitle(event: PlanmeDraftTimelineEvent, fallbackStop?: RouteStop) {
  if (!fallbackStop || !isRouteLikeText(event.title)) {
    return normalizeDraftPlaceAliases(event.title);
  }

  return `${getPrimaryRouteLabel(fallbackStop.label)} ${inferTimelineActionLabel(event)}`.trim();
}

/**
 * Picks the first visible stop from a route-like label for compact timeline rows.
 */
function getPrimaryRouteLabel(label: string) {
  return label.split(/[·→,]/)[0]?.trim() || label;
}

/**
 * Infers the short action suffix users expect to scan in the timeline.
 */
function inferTimelineActionLabel(event: PlanmeDraftTimelineEvent) {
  if (event.title.includes("수령")) {
    return "짐 수령";
  }

  if (event.title.includes("이동 시작")) {
    return "이동 시작";
  }

  if (event.title.includes("출발")) {
    return "출발";
  }

  if (event.title.includes("방문")) {
    return "방문";
  }

  if (event.category === "hotel") {
    return "도착";
  }

  if (event.category === "transit") {
    return "이동";
  }

  return "방문";
}

/**
 * Creates generic benefits that do not claim unverified POI facts.
 */
function createDraftBenefits(region: string, assumptions: string[]): BenefitItem[] {
  const assumptionText = assumptions.length > 0 ? assumptions.join(", ") : "ChatGPT 일정 초안 기준";

  return [
    {
      title: "초안 검증",
      description: `${region} 일정 초안을 PlanME 형식으로 정리합니다.`,
      icon: "shield",
    },
    {
      title: "시간 비교",
      description: "수하물 경유 여부에 따른 이동 시간을 비교합니다.",
      icon: "time",
    },
    {
      title: "가벼운 여행",
      description: assumptionText,
      icon: "luggage",
    },
    {
      title: "실시간 갱신",
      description: "대화 중 바뀐 초안을 위젯에 다시 반영합니다.",
      icon: "phone",
    },
  ];
}

/**
 * Builds a small deterministic path so the existing map renderer can draw draft routes.
 */
function createMapPath(stopCount: number): MapPoint[] {
  const safeCount = Math.max(1, stopCount);

  return Array.from({ length: safeCount }, (_, index) => ({
    x: safeCount === 1 ? 50 : 18 + Math.round((64 * index) / (safeCount - 1)),
    y: index % 2 === 0 ? 34 + index * 6 : 58 - index * 4,
  }));
}

/**
 * Uses the first Korean place-looking token as a compact region fallback.
 */
function inferRegionFromTitle(title: string) {
  return title.trim().split(/\s+/)[0] || "PlanME";
}

/**
 * Creates a deterministic preview id from the user-visible draft fields.
 */
function createDraftPreviewId(input: PlanmeDraftPreviewRequest) {
  const slug = slugifyDraftPreviewIdPart(createDraftPreviewSlugSource(input));
  const durationDays = inferDraftDurationDays(input);
  const hash = hashString(
    JSON.stringify({
      days: input.days,
      duration: input.duration,
      region: input.region,
      title: input.title,
    }),
  );

  // Keep ChatGPT handoff links short while making them recognizable as itinerary detail URLs.
  return `generated-${slug}-${durationDays}d-${hash}`;
}

/**
 * Chooses a compact human-readable slug source without duplicating the primary region.
 */
function createDraftPreviewSlugSource(input: PlanmeDraftPreviewRequest) {
  const region = input.region?.trim() || inferRegionFromTitle(input.title);
  const normalizedTitle = normalizeDraftPlaceAliases(input.title).trim();
  const compactTitle = removeLeadingRegionTokenFromDraftTitle(normalizedTitle, region);

  if (!compactTitle || compactTitle === region) {
    return region;
  }

  if (compactTitle.startsWith(region)) {
    return compactTitle;
  }

  return `${region} ${compactTitle}`;
}

/**
 * Removes only the first title token when it repeats the final region token.
 */
function removeLeadingRegionTokenFromDraftTitle(title: string, region: string) {
  const regionTokens = region.trim().split(/\s+/).filter(Boolean);
  const titleTokens = title.trim().split(/\s+/).filter(Boolean);
  const lastRegionToken = regionTokens.at(-1);
  const firstTitleToken = titleTokens[0];

  // Region can be "경상남도 남해" while the AI title starts with "남해".
  if (lastRegionToken && firstTitleToken === lastRegionToken) {
    return titleTokens.slice(1).join(" ");
  }

  return title;
}

/**
 * Creates a URL-safe slug while keeping Korean labels readable for shared links.
 */
function slugifyDraftPreviewIdPart(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^가-힣a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug.length > 0 ? slug : "planme";
}

/**
 * Infers trip length from the explicit duration text before falling back to visible days.
 */
function inferDraftDurationDays(input: PlanmeDraftPreviewRequest) {
  const nightDayMatch = /(\d+)\s*박\s*(\d+)\s*일/.exec(input.duration ?? "");
  const dayMatch = /(\d+)\s*일/.exec(input.duration ?? "");

  if (nightDayMatch) {
    return Number(nightDayMatch[2]);
  }

  if (dayMatch) {
    return Number(dayMatch[1]);
  }

  return Math.max(1, input.days.length || 1);
}

/**
 * Creates a compact deterministic hash for preview ids.
 */
function hashString(value: string) {
  let hash = 2166136261;

  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

/**
 * Formats a minute duration for draft route labels.
 */
function formatMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `약 ${minutes}분`;
  }

  return minutes === 0 ? `약 ${hours}시간` : `약 ${hours}시간 ${minutes}분`;
}

/**
 * Formats the shared CarryME saving label shown in GPT, previews, and detail surfaces.
 */
function formatCarrymeSavingLabel(savedMinutes: number) {
  return savedMinutes > 0
    ? `약 ${savedMinutes}분 절약`
    : "시간 절약 없음 · 짐 없이 바로 이동";
}
