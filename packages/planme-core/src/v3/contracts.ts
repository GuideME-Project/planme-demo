export const PLANME_V3_SCHEMA_VERSION = 3 as const;

export const PLANME_V3_ALLOWED_CONTENT_TYPE_IDS = [
  12,
  14,
  15,
  28,
  32,
  38,
  39,
] as const;

export type AllowedTourContentTypeId =
  (typeof PLANME_V3_ALLOWED_CONTENT_TYPE_IDS)[number];

export type PlanmeV3TransportMode = "drive" | "transit";

export type Coordinate = {
  lat: number;
  lng: number;
};

export type TripIntentInput = {
  origin?: string;
  destination?: string;
  transportMode?: PlanmeV3TransportMode;
  durationDays?: number;
  travelStartDate?: string;
  preferences?: string[];
  requestedPlaces?: string[];
  travelerCount?: number;
  luggageCount?: number;
};

export type ResolvedTripIntent = {
  origin: string;
  destination: string;
  transportMode: PlanmeV3TransportMode;
  durationDays: number;
  travelStartDate?: string;
  preferences: string[];
  requestedPlaces: string[];
  travelerCount: number;
  luggageCount: number;
};

export type TourPlaceSnapshot = {
  contentId: string;
  contentTypeId: AllowedTourContentTypeId;
  title: string;
  coordinate: Coordinate;
  address?: string;
  regionCode?: string;
  districtCode?: string;
  fetchedAt: string;
  cacheStatus: "fresh" | "stale";
  source: "tourapi";
};

export type AiPlanSelectionDay = {
  day: number;
  orderedVisitContentIds: string[];
  restaurantContentIds: string[];
};

export type AiPlanSelection = {
  lodgingContentId: string;
  days: AiPlanSelectionDay[];
};

export type ExcludedRequestedPlace = {
  input: string;
  reason: "TOURAPI_NOT_FOUND" | "INVALID_COORDINATE" | "UNROUTABLE";
};

export type TripPlanDay = {
  day: number;
  visits: Array<{ contentId: string; stayMinutes: number }>;
  meals: Array<{ kind: "lunch" | "dinner"; contentId?: string }>;
  freeTimePolicy: "free_time" | "lodging_rest";
};

export type TripPlan = {
  intent: ResolvedTripIntent;
  lodging: TourPlaceSnapshot;
  selectedPlaces: Record<string, TourPlaceSnapshot>;
  days: TripPlanDay[];
  excludedRequestedPlaces: ExcludedRequestedPlace[];
};

export type RouteSegment = {
  fromRef: string;
  toRef: string;
  mode: "drive" | "transit" | "walk";
  source: "naver" | "odsay" | "estimated_walk";
  distanceMeters: number;
  durationSeconds: number;
  geometryStatus: "complete" | "partial" | "unavailable";
  paths: Coordinate[][];
  providerCode?: string;
};

export type ScheduledVisit = {
  contentId: string;
  startMinute: number;
  endMinute: number;
};

export type ScheduledMeal = {
  kind: "lunch" | "dinner";
  contentId?: string;
  startMinute: number;
  endMinute: number;
  locationStatus: "tourapi" | "unlocated";
};

export type ScheduledIdleBlock = {
  kind: "free_time" | "lodging_rest";
  startMinute: number;
  endMinute: number;
};

export type ScheduledDay = {
  day: number;
  startMinute: number;
  endMinute: number;
  returnTravelStartMinute?: number;
  visits: ScheduledVisit[];
  meals: ScheduledMeal[];
  idleBlocks: ScheduledIdleBlock[];
};

export type LuggageEvent = {
  kind: "handoff" | "delivered";
  day: number;
  minute: number;
  locationRef: string;
};

export type RouteVariant = {
  kind: "standard" | "carryme";
  totalMinutes: number;
  days: ScheduledDay[];
  segments: RouteSegment[];
  luggageSegments: RouteSegment[];
  luggageEvents: LuggageEvent[];
};

export type ItineraryRevision = {
  schemaVersion: 3;
  itineraryId: string;
  revision: number;
  createdAt: string;
  intent: ResolvedTripIntent;
  plan: TripPlan;
  standard: RouteVariant;
  carryme: RouteVariant;
  selectedPlaceSnapshots: Record<string, TourPlaceSnapshot>;
};

export type DisplayPlace = {
  contentId: string;
  contentTypeId: AllowedTourContentTypeId;
  title: string;
  coordinate: Coordinate;
  address?: string;
};

export type DisplayDay = {
  day: number;
  visits: DisplayPlace[];
};

export type ItineraryDisplayDto = {
  itineraryId: string;
  revision: number;
  title: string;
  region: string;
  durationDays: number;
  transportMode: PlanmeV3TransportMode;
  days: DisplayDay[];
  standardTotalMinutes: number;
  carrymeTotalMinutes: number;
  savedMinutes: number;
  pageUrl: string;
};

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue | undefined };
