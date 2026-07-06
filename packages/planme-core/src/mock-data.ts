export type RoutePlanId = "standard" | "carryme";

export type MapPoint = {
  x: number;
  y: number;
};

export type MapCoordinate = {
  lat: number;
  lng: number;
};

export type RouteStop = {
  label: string;
  caption: string;
  coordinate?: MapCoordinate;
  icon: "airport" | "hotel" | "station" | "event" | "attraction";
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
  dashedGeoPath?: MapCoordinate[];
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
  savingMinutes: 70,
  standard: {
    id: "standard",
    label: "Standard",
    badge: "Standard",
    routeText: "인천공항 → 부산 호텔 → 공연장",
    description: "수하물 보관을 위해 부산 호텔을 먼저 경유",
    durationLabel: "약 6시간 30분",
    durationMinutes: 390,
    stops: [
      {
        label: "인천공항",
        caption: "입국",
        coordinate: { lat: 37.4602, lng: 126.4407 },
        icon: "airport",
      },
      {
        label: "서면 호텔",
        caption: "수하물 보관",
        coordinate: { lat: 35.1577, lng: 129.0591 },
        icon: "hotel",
      },
      {
        label: "부산 공연장",
        caption: "BTS 공연 관람",
        coordinate: { lat: 35.191, lng: 129.0615 },
        icon: "event",
      },
    ],
    geoPath: [
      { lat: 37.4602, lng: 126.4407 },
      { lat: 37.5547, lng: 126.9706 },
      { lat: 37.4163, lng: 126.8844 },
      { lat: 36.7949, lng: 127.1046 },
      { lat: 36.6201, lng: 127.3276 },
      { lat: 36.3326, lng: 127.4348 },
      { lat: 36.1137, lng: 128.1808 },
      { lat: 35.8798, lng: 128.6286 },
      { lat: 35.5514, lng: 129.1383 },
      { lat: 35.1151, lng: 129.0403 },
      { lat: 35.1577, lng: 129.0591 },
      { lat: 35.191, lng: 129.0615 },
    ],
    mapPath: [
      { x: 14, y: 22 },
      { x: 25, y: 28 },
      { x: 31, y: 31 },
      { x: 39, y: 39 },
      { x: 44, y: 43 },
      { x: 49, y: 47 },
      { x: 57, y: 53 },
      { x: 66, y: 61 },
      { x: 75, y: 68 },
      { x: 76, y: 70 },
      { x: 78, y: 74 },
      { x: 84, y: 66 },
    ],
  },
  carryme: {
    id: "carryme",
    label: "CarryME",
    badge: "CarryME",
    routeText: "인천공항 → 부산 공연장 → 호텔",
    description: "수하물은 캐리미가 호텔로, 여행자는 공연장으로 바로 이동",
    durationLabel: "약 5시간 20분",
    durationMinutes: 320,
    stops: [
      {
        label: "인천공항",
        caption: "입국",
        coordinate: { lat: 37.4602, lng: 126.4407 },
        icon: "airport",
      },
      {
        label: "부산 공연장",
        caption: "바로 입장",
        coordinate: { lat: 35.191, lng: 129.0615 },
        icon: "event",
      },
      {
        label: "서면 호텔",
        caption: "짐은 이미 도착",
        coordinate: { lat: 35.1577, lng: 129.0591 },
        icon: "hotel",
      },
    ],
    geoPath: [
      { lat: 37.4602, lng: 126.4407 },
      { lat: 37.5547, lng: 126.9706 },
      { lat: 37.4163, lng: 126.8844 },
      { lat: 36.7949, lng: 127.1046 },
      { lat: 36.6201, lng: 127.3276 },
      { lat: 36.3326, lng: 127.4348 },
      { lat: 36.1137, lng: 128.1808 },
      { lat: 35.8798, lng: 128.6286 },
      { lat: 35.5514, lng: 129.1383 },
      { lat: 35.1151, lng: 129.0403 },
      { lat: 35.191, lng: 129.0615 },
      { lat: 35.1577, lng: 129.0591 },
    ],
    mapPath: [
      { x: 14, y: 22 },
      { x: 25, y: 28 },
      { x: 31, y: 31 },
      { x: 39, y: 39 },
      { x: 44, y: 43 },
      { x: 49, y: 47 },
      { x: 57, y: 53 },
      { x: 66, y: 61 },
      { x: 75, y: 68 },
      { x: 76, y: 70 },
      { x: 84, y: 66 },
      { x: 78, y: 74 },
    ],
    dashedPath: [
      { x: 14, y: 22 },
      { x: 46, y: 44 },
      { x: 78, y: 74 },
    ],
    dashedGeoPath: [
      { lat: 37.4602, lng: 126.4407 },
      { lat: 36.3504, lng: 127.3845 },
      { lat: 35.1577, lng: 129.0591 },
    ],
  },
  timeline: [
    {
      time: "09:30",
      title: "인천공항 도착",
      description: "해외 입국 후 부산 공연 일정 시작",
      category: "arrival",
    },
    {
      time: "10:00",
      title: "캐리미 짐 탁송 완료",
      description: "인천공항에서 호텔 배송 접수 완료",
      category: "carryme",
      highlight: true,
    },
    {
      time: "10:20",
      title: "부산행 이동 시작",
      description: "짐 없이 공항철도와 KTX로 부산 이동",
      category: "transit",
      savingLabel: "약 70분 절약",
    },
    {
      time: "15:00",
      title: "부산 공연장 입장",
      description: "호텔 경유 없이 바로 공연장 도착",
      category: "event",
    },
    {
      time: "21:30",
      title: "서면 호텔 체크인",
      description: "공연 후 안전하게 도착한 내 짐 확인",
      category: "hotel",
    },
  ],
};

const dayTwo: ItineraryDay = {
  day: 2,
  label: "Day 2",
  savingMinutes: 45,
  standard: {
    id: "standard",
    label: "Standard",
    badge: "Standard",
    routeText: "서면 호텔 → 해운대 → 서면 호텔 → 부산역",
    description: "체크아웃 후 관광을 마치고 호텔로 돌아가 짐을 챙긴 뒤 이동",
    durationLabel: "약 3시간 20분",
    durationMinutes: 200,
    stops: [
      {
        label: "서면 호텔",
        caption: "체크아웃",
        coordinate: { lat: 35.1577, lng: 129.0591 },
        icon: "hotel",
      },
      {
        label: "해운대",
        caption: "관광",
        coordinate: { lat: 35.1587, lng: 129.1604 },
        icon: "attraction",
      },
      {
        label: "서면 호텔",
        caption: "짐 수령",
        coordinate: { lat: 35.1577, lng: 129.0591 },
        icon: "hotel",
      },
      {
        label: "부산역",
        caption: "귀가",
        coordinate: { lat: 35.1151, lng: 129.0403 },
        icon: "station",
      },
    ],
    geoPath: [
      { lat: 35.1577, lng: 129.0591 },
      { lat: 35.1587, lng: 129.1604 },
      { lat: 35.1532, lng: 129.1187 },
      { lat: 35.1577, lng: 129.0591 },
      { lat: 35.1151, lng: 129.0403 },
    ],
    mapPath: [
      { x: 34, y: 56 },
      { x: 76, y: 44 },
      { x: 60, y: 52 },
      { x: 34, y: 56 },
      { x: 26, y: 72 },
    ],
  },
  carryme: {
    id: "carryme",
    label: "CarryME",
    badge: "CarryME",
    routeText: "호텔 → 해운대 → 부산역",
    description: "짐은 CarryME가 이동하고 마지막 관광 후 역으로 바로 이동",
    durationLabel: "약 2시간 35분",
    durationMinutes: 155,
    stops: [
      {
        label: "서면 호텔",
        caption: "짐 수거",
        coordinate: { lat: 35.1577, lng: 129.0591 },
        icon: "hotel",
      },
      {
        label: "해운대",
        caption: "관광",
        coordinate: { lat: 35.1587, lng: 129.1604 },
        icon: "attraction",
      },
      {
        label: "부산역",
        caption: "귀가",
        coordinate: { lat: 35.1151, lng: 129.0403 },
        icon: "station",
      },
    ],
    geoPath: [
      { lat: 35.1577, lng: 129.0591 },
      { lat: 35.1532, lng: 129.1187 },
      { lat: 35.1587, lng: 129.1604 },
      { lat: 35.1355, lng: 129.0931 },
      { lat: 35.1151, lng: 129.0403 },
    ],
    mapPath: [
      { x: 34, y: 56 },
      { x: 60, y: 52 },
      { x: 76, y: 44 },
      { x: 44, y: 61 },
      { x: 26, y: 72 },
    ],
  },
  timeline: [
    {
      time: "09:30",
      title: "호텔 출발",
      description: "체크아웃과 동시에 CarryME 짐 배송 접수",
      category: "hotel",
    },
    {
      time: "10:00",
      title: "캐리미 짐 수거 완료",
      description: "짐은 숙소 또는 명시된 수령 지점으로 이동",
      category: "carryme",
      highlight: true,
    },
    {
      time: "10:30",
      title: "해운대 이동",
      description: "짐 보관소 경유 없이 바로 바다 쪽으로 이동",
      category: "transit",
      savingLabel: "약 45분 절약",
    },
    {
      time: "13:00",
      title: "해운대 점심 식사",
      description: "공연 다음 날 여유로운 식사와 산책",
      category: "meal",
    },
    {
      time: "16:30",
      title: "부산역 이동",
      description: "귀국 또는 다음 도시 이동 준비",
      category: "transit",
    },
  ],
};

const demoItinerary: PlanmeItinerary = {
  id: "busan-bts-1d1n",
  title: "PlanME 부산 BTS 공연 1박 2일 추천 일정",
  region: "부산",
  duration: "1박 2일",
  summary: "인천공항 입국 후 부산 공연장으로 바로 향하는 CarryME 동선을 확인하세요.",
  detailUrl: "https://planme-demo.vercel.app/itinerary/busan-bts-1d1n",
  carrymeSaving: "약 70분 절약 예상",
  totalDurationLabel: "약 6시간 30분 → 5시간 20분",
  savedDurationLabel: "약 70분 절약",
  days: [dayOne, dayTwo],
  benefits: [
    {
      title: "안전한 짐 배송",
      description: "인천공항에서 부산 호텔까지 안전하게 배송",
      icon: "shield",
    },
    {
      title: "시간 절약",
      description: "호텔 경유 없이 공연장으로 바로 이동",
      icon: "time",
    },
    {
      title: "가벼운 여행",
      description: "짐 없이 공연과 부산 여행을 즐기세요",
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
