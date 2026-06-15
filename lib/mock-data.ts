export type RoutePlanId = "standard" | "carryme";

export type MapPoint = {
  x: number;
  y: number;
};

export type RouteStop = {
  label: string;
  caption: string;
  icon: "airport" | "hotel" | "usj";
};

export type TimelineEvent = {
  time: string;
  title: string;
  description: string;
  category: "arrival" | "carryme" | "transit" | "meal" | "hotel";
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
  mapPath: MapPoint[];
  dashedPath?: MapPoint[];
};

export type ItineraryDay = {
  day: 1 | 2;
  label: string;
  standard: RoutePlan;
  carryme: RoutePlan;
  savingMinutes: number;
  timeline: TimelineEvent[];
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
  days: ItineraryDay[];
  benefits: BenefitItem[];
};

const dayOne: ItineraryDay = {
  day: 1,
  label: "Day 1",
  savingMinutes: 120,
  standard: {
    id: "standard",
    label: "Standard",
    badge: "Standard",
    routeText: "공항 → 호텔 → USJ",
    description: "수하물 보관을 위해 호텔을 먼저 경유",
    durationLabel: "약 8시간 10분",
    durationMinutes: 490,
    stops: [
      { label: "간사이 공항", caption: "도착", icon: "airport" },
      { label: "호텔 체크인", caption: "수하물 보관", icon: "hotel" },
      { label: "USJ", caption: "방문", icon: "usj" },
    ],
    mapPath: [
      { x: 8, y: 76 },
      { x: 22, y: 67 },
      { x: 31, y: 46 },
      { x: 41, y: 55 },
      { x: 54, y: 45 },
      { x: 72, y: 40 },
    ],
  },
  carryme: {
    id: "carryme",
    label: "CarryME",
    badge: "CarryME",
    routeText: "공항 → USJ → 호텔",
    description: "수하물은 캐리미가 호텔로, 여행은 가볍게 시작",
    durationLabel: "약 6시간 10분",
    durationMinutes: 370,
    stops: [
      { label: "간사이 공항", caption: "도착", icon: "airport" },
      { label: "USJ", caption: "직행", icon: "usj" },
      { label: "호텔 체크인", caption: "짐은 이미 도착", icon: "hotel" },
    ],
    mapPath: [
      { x: 34, y: 55 },
      { x: 46, y: 58 },
      { x: 58, y: 56 },
      { x: 68, y: 47 },
      { x: 74, y: 31 },
    ],
    dashedPath: [
      { x: 42, y: 58 },
      { x: 52, y: 65 },
      { x: 61, y: 61 },
    ],
  },
  timeline: [
    {
      time: "10:00",
      title: "간사이 공항 도착",
      description: "입국 수속 완료",
      category: "arrival",
    },
    {
      time: "10:20",
      title: "캐리미 짐 탁송 완료",
      description: "앱으로 짐 맡기기 수거 완료",
      category: "carryme",
      highlight: true,
    },
    {
      time: "11:00",
      title: "USJ 직행",
      description: "짐 없이 바로 이동 (시간 단축)",
      category: "transit",
      savingLabel: "약 2시간 절약",
    },
    {
      time: "13:00",
      title: "USJ 점심 식사",
      description: "테마파크 내에서 여유로운 식사",
      category: "meal",
    },
    {
      time: "18:00",
      title: "호텔 체크인",
      description: "안전하게 도착한 내 짐 확인",
      category: "hotel",
    },
  ],
};

const dayTwo: ItineraryDay = {
  ...dayOne,
  day: 2,
  label: "Day 2",
  timeline: [
    {
      time: "09:30",
      title: "호텔 출발",
      description: "체크아웃 전 짐 보관 없이 바로 이동",
      category: "hotel",
    },
    {
      time: "10:30",
      title: "오사카성 관광",
      description: "오전 관광 동선을 여유롭게 시작",
      category: "transit",
    },
    {
      time: "13:00",
      title: "도톤보리 점심 식사",
      description: "중심 상권에서 식사와 산책",
      category: "meal",
    },
    {
      time: "16:30",
      title: "간사이 공항 이동",
      description: "귀국 동선으로 전환",
      category: "arrival",
    },
  ],
};

const demoItinerary: PlanmeItinerary = {
  id: "osaka-2d1n",
  title: "PlanME 오사카 1박 2일 추천 일정",
  region: "오사카",
  duration: "1박 2일",
  summary: "Standard / CarryME 동선 비교와 상세 지도를 확인하세요.",
  detailUrl: "https://planme.guideme.app/itinerary/osaka-2d1n",
  carrymeSaving: "약 2시간 절약 예상",
  totalDurationLabel: "약 8시간 10분 → 6시간 10분",
  savedDurationLabel: "약 2시간 절약",
  days: [dayOne, dayTwo],
  benefits: [
    {
      title: "안전한 짐 배송",
      description: "전문 파트너가 호텔까지 안전하게 배송",
      icon: "shield",
    },
    {
      title: "시간 절약",
      description: "호텔 경유 없이 즐거운 여행 시작",
      icon: "time",
    },
    {
      title: "가벼운 여행",
      description: "짐 없이 테마파크를 마음껏 즐기세요",
      icon: "luggage",
    },
    {
      title: "실시간 알림",
      description: "수거부터 호텔 도착까지 알림 제공",
      icon: "phone",
    },
  ],
};

/**
 * Returns the fixed PlanME itinerary used by the first demo.
 */
export function getDemoItinerary(): PlanmeItinerary {
  return demoItinerary;
}

/**
 * Finds a demo itinerary by public id.
 */
export function getItineraryById(id: string): PlanmeItinerary | null {
  return demoItinerary.id === id ? demoItinerary : null;
}
