export type RoutePlanId = "standard" | "carryme";

export type MapPoint = {
  x: number;
  y: number;
};

export type MapCoordinate = {
  lat: number;
  lng: number;
};

export type PlanmeStopRole = "출발지" | "방문지" | "숙소" | "복귀지";

export type PlanmeTransportMode = "drive" | "transit";

export type PlanmeRowMode = PlanmeTransportMode;

export type ProviderSegmentMode = PlanmeRowMode;

export type RouteStop = {
  label: string;
  caption: string;
  coordinate?: MapCoordinate;
  icon: "airport" | "hotel" | "station" | "event" | "attraction";
  mode?: PlanmeRowMode;
  placeId?: string;
  placeSource?: "naver_local" | "naver_geocode" | "input";
  placeSourceRef?: string;
  role?: PlanmeStopRole;
};

export type RouteTransitMarker = {
  coordinate: MapCoordinate;
  id: string;
  label: string;
  mode: "bus" | "subway" | "train" | "transit";
  role: "boarding" | "alighting";
  segmentIndex?: number;
};

export type TimelineEvent = {
  time: string;
  title: string;
  description: string;
  category: "arrival" | "carryme" | "transit" | "meal" | "hotel" | "event";
  highlight?: boolean;
  savingLabel?: string;
};

export type RoutePlan = {
  id: RoutePlanId;
  label: string;
  badge: string;
  routeText: string;
  description: string;
  durationLabel: string;
  durationMinutes: number;
  stops: RouteStop[];
  geoPath?: MapCoordinate[];
  geoSegments?: MapCoordinate[][];
  mapPath: MapPoint[];
  transitMarkers?: RouteTransitMarker[];
  dashedGeoPath?: MapCoordinate[];
  dashedPath?: MapPoint[];
};

export type ItineraryDay = {
  day: number;
  label: string;
  standard: RoutePlan;
  carryme: RoutePlan;
  savingMinutes: number;
  timeline: TimelineEvent[];
  standardTimeline?: TimelineEvent[];
  carrymeTimeline?: TimelineEvent[];
};

export type BenefitItem = {
  title: string;
  description: string;
  icon: "shield" | "time" | "luggage" | "phone";
};

export type PlanmeItinerary = {
  id: string;
  title: string;
  region: string;
  duration: string;
  summary: string;
  detailUrl: string;
  carrymeSaving: string;
  totalDurationLabel: string;
  savedDurationLabel: string;
  transportMode: PlanmeTransportMode;
  days: ItineraryDay[];
  benefits: BenefitItem[];
};
