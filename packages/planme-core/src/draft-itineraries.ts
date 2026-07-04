import type {
  BenefitItem,
  ItineraryDay,
  MapCoordinate,
  MapPoint,
  PlanmeItinerary,
  RoutePlan,
  RouteStop,
  TimelineEvent,
} from "./mock-data.js";

export type PlanmeDraftStopRole =
  | "origin"
  | "visit"
  | "luggageDestination"
  | "finalDestination";

export type PlanmeDraftStop = {
  name: string;
  role?: PlanmeDraftStopRole;
  caption?: string;
  coordinate?: MapCoordinate;
};

export type PlanmeDraftTimelineEvent = {
  time: string;
  title: string;
  description: string;
  category?: TimelineEvent["category"];
  highlight?: boolean;
  savingLabel?: string;
};

export type PlanmeDraftDay = {
  day?: number;
  label?: string;
  stops: PlanmeDraftStop[];
  timeline: PlanmeDraftTimelineEvent[];
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
  assumptions?: string[];
  savedMinutes?: number;
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

const draftPreviewStore = new Map<string, DraftPreviewRecord>();
const committedDraftKeys = new Map<string, string>();

/**
 * Converts a ChatGPT-authored PlanME draft into a widget-ready itinerary preview.
 */
export function createPlanmeDraftPreview(
  input: PlanmeDraftPreviewRequest,
): PlanmeDraftPreviewResult {
  const previewId = input.previewId?.trim() || createDraftPreviewId(input);
  const validationIssues = validateDraftPreviewInput(input);
  const existingRecord = draftPreviewStore.get(previewId);
  const version = existingRecord ? existingRecord.version + 1 : 1;
  const itinerary = buildDraftItinerary(input, previewId, validationIssues);
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
 * Updates an existing preview using the same normalization and validation path.
 */
export function updatePlanmeDraftPreview(
  input: PlanmeDraftPreviewRequest,
): PlanmeDraftPreviewResult {
  return createPlanmeDraftPreview(input);
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
    if (day.stops.length === 0) {
      validationIssues.push({
        code: "missing_stops",
        message: `${day.label ?? `Day ${dayIndex + 1}`}에 방문지가 필요합니다.`,
        severity: "error",
      });
    }

    if (day.timeline.length === 0) {
      validationIssues.push({
        code: "missing_timeline",
        message: `${day.label ?? `Day ${dayIndex + 1}`}에 타임라인이 필요합니다.`,
        severity: "error",
      });
    }
  });

  return validationIssues;
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
  const days = input.days.length > 0
    ? input.days.slice(0, 2).map((day, index) => buildDraftDay(day, index, input.savedMinutes ?? 0))
    : [buildEmptyDraftDay(input.savedMinutes ?? 0)];
  const firstDay = days[0];
  const savedMinutes = Math.max(0, input.savedMinutes ?? firstDay.savingMinutes);
  const summaryPrefix = input.summary?.trim() || `${input.title}을 PlanME 위젯으로 미리 봅니다.`;
  const issueSummary =
    validationIssues.length > 0
      ? ` 검증 필요: ${validationIssues.map((issue) => issue.message).join(" ")}`
      : "";

  return {
    id: previewId,
    title: input.title,
    region,
    duration,
    summary: `${summaryPrefix}${issueSummary}`,
    detailUrl: `/itinerary/${previewId}`,
    carrymeSaving: savedMinutes > 0 ? `약 ${savedMinutes}분 절약 예상` : "CarryME 동선 확인",
    totalDurationLabel: `${firstDay.standard.durationLabel} → ${firstDay.carryme.durationLabel}`,
    savedDurationLabel: savedMinutes > 0 ? `약 ${savedMinutes}분 절약` : "절약 시간 확인 중",
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
): ItineraryDay {
  const stops = day.stops.map(toRouteStop);
  const routeText = stops.map((stop) => stop.label).join(" → ") || "일정 초안 확인 중";
  const carrymeStops = buildCarrymeStops(stops);
  const carrymeRouteText =
    day.carrymeRouteText?.trim() || carrymeStops.map((stop) => stop.label).join(" → ") || routeText;
  const carrymeMinutes = Math.max(0, day.carrymeDurationMinutes ?? 300);
  const standardMinutes = Math.max(
    carrymeMinutes,
    day.standardDurationMinutes ?? carrymeMinutes + savedMinutes,
  );

  return {
    day: index === 0 ? 1 : 2,
    label: day.label?.trim() || `Day ${index + 1}`,
    savingMinutes: Math.max(0, standardMinutes - carrymeMinutes),
    standard: buildRoutePlan({
      id: "standard",
      label: "Standard",
      routeText: day.standardRouteText?.trim() || routeText,
      durationMinutes: standardMinutes,
      stops,
      description: "ChatGPT 초안을 기준으로 한 일반 이동 흐름",
    }),
    carryme: buildRoutePlan({
      id: "carryme",
      label: "CarryME",
      routeText: carrymeRouteText,
      durationMinutes: carrymeMinutes,
      stops: carrymeStops,
      description: "짐은 CarryME가 이동하고 여행자는 일정으로 바로 이동",
    }),
    timeline: day.timeline.map(toTimelineEvent),
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
      stops: [{ name: "일정 초안", role: "visit", caption: "확인 필요" }],
      timeline: [
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
  const geoPath = stops.flatMap((stop) => (stop.coordinate ? [stop.coordinate] : []));

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
 * Converts ChatGPT stop roles into stable PlanME captions and icons.
 */
function toRouteStop(stop: PlanmeDraftStop): RouteStop {
  const role = stop.role ?? "visit";

  return {
    label: stop.name.trim(),
    caption: stop.caption?.trim() || getCaptionForRole(role),
    coordinate: stop.coordinate,
    icon: getIconForRole(role),
  };
}

/**
 * Normalizes timeline categories while preserving ChatGPT-authored labels.
 */
function toTimelineEvent(event: PlanmeDraftTimelineEvent): TimelineEvent {
  return {
    time: event.time,
    title: event.title,
    description: event.description,
    category: event.category ?? "event",
    highlight: event.highlight,
    savingLabel: event.savingLabel,
  };
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
 * Maps draft stop roles to short PlanME captions.
 */
function getCaptionForRole(role: PlanmeDraftStopRole) {
  if (role === "origin") {
    return "출발";
  }

  if (role === "luggageDestination") {
    return "짐 도착";
  }

  if (role === "finalDestination") {
    return "도착";
  }

  return "방문";
}

/**
 * Maps draft stop roles to the existing PlanME icon vocabulary.
 */
function getIconForRole(role: PlanmeDraftStopRole): RouteStop["icon"] {
  if (role === "origin") {
    return "station";
  }

  if (role === "luggageDestination" || role === "finalDestination") {
    return "hotel";
  }

  return "event";
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
  return `preview-${hashString(
    JSON.stringify({
      days: input.days,
      duration: input.duration,
      region: input.region,
      title: input.title,
    }),
  )}`;
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
