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
  origin?: string;
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

// Route-like title detection keeps AI-generated multi-POI strings out of compact widget headings.
const ROUTE_TITLE_SEPARATOR_THRESHOLD = 2;
const DRAFT_TITLE_MAX_LENGTH = 44;
const DEFAULT_AIRPORT_ORIGIN_PATTERN = /^(ICN|인천\s*(국제)?공항)$/i;
const UNKNOWN_ORIGIN_LABEL = "출발지 확인 필요";
const DRAFT_PLACE_ALIAS_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /Namhae\s+German\s+Village/gi, replacement: "남해 독일마을" },
  { pattern: /House\s+N\s+Garden/gi, replacement: "원예예술촌" },
  { pattern: /Sangju\s+Silver\s+Sand\s+Beach/gi, replacement: "상주은모래비치" },
];

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

  if (!explicitOrigin && draftContainsDefaultAirportOrigin(input)) {
    validationIssues.push({
      code: "missing_explicit_origin",
      message: "출발지가 누락된 상태에서 기본 공항값이 감지됐습니다. 실제 출발지를 다시 확인해야 합니다.",
      severity: "error",
    });
  }

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
  const title = normalizeDraftDisplayTitle(input.title, region, duration);
  const explicitOrigin = inferExplicitDraftOrigin(input.origin, input.assumptions ?? []);
  const originReplacement =
    explicitOrigin ?? (draftContainsDefaultAirportOrigin(input) ? UNKNOWN_ORIGIN_LABEL : null);
  const days = input.days.length > 0
    ? input.days
        .slice(0, 2)
        .map((day, index) =>
          buildDraftDay(
            day,
            index,
            input.savedMinutes ?? 0,
            index === 0 ? originReplacement : null,
          ),
        )
    : [buildEmptyDraftDay(input.savedMinutes ?? 0)];
  const firstDay = days[0];
  const savedMinutes = Math.max(0, input.savedMinutes ?? firstDay.savingMinutes);
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
  explicitOrigin: string | null = null,
): ItineraryDay {
  const stops = sanitizeDraftOriginStops(day.stops.map(toRouteStop), explicitOrigin);
  let routeLikeTimelineIndex = 0;
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
    timeline: day.timeline.map((rawEvent) => {
      const event = sanitizeDraftOriginTimelineEvent(rawEvent, explicitOrigin);
      const isRouteLike = isRouteLikeText(event.title);
      const fallbackStop = isRouteLike
        ? selectTimelineStop(stops, event, routeLikeTimelineIndex)
        : undefined;

      if (isRouteLike) {
        routeLikeTimelineIndex += 1;
      }

      return toTimelineEvent(event, fallbackStop);
    }),
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
    label: normalizeDraftPlaceAliases(stop.name.trim()),
    caption: stop.caption?.trim() || getCaptionForRole(role),
    coordinate: stop.coordinate,
    icon: getIconForRole(role),
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
 * Detects model-authored drafts that leaked the legacy demo airport without a real origin.
 */
function draftContainsDefaultAirportOrigin(input: PlanmeDraftPreviewRequest) {
  return input.days.some((day) =>
    day.stops.some((stop) => containsDefaultAirportOrigin(stop.name)) ||
    day.timeline.some(
      (event) =>
        containsDefaultAirportOrigin(event.title) ||
        containsDefaultAirportOrigin(event.description),
    ),
  );
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
  const normalizedTitle = normalizeDraftPlaceAliases(title.trim());

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
