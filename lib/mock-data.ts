export type ItineraryStop = {
  time: string;
  title: string;
  description: string;
  category: "arrival" | "carryme" | "transit" | "attraction" | "meal";
};

export type RouteComparison = {
  label: string;
  duration: string;
  luggage: string;
  highlight: string;
};

export type PlanmeItinerary = {
  id: string;
  title: string;
  region: string;
  duration: string;
  summary: string;
  detailUrl: string;
  carrymeSaving: string;
  stops: ItineraryStop[];
  comparisons: RouteComparison[];
};

const demoItinerary: PlanmeItinerary = {
  id: "osaka-2d1n",
  title: "PlanME 오사카 1박 2일 추천 일정",
  region: "오사카",
  duration: "1박 2일",
  summary: "Standard / CarryME 동선 비교와 상세 지도를 확인하세요.",
  detailUrl: "https://planme.guideme.app/itinerary/osaka-2d1n",
  carrymeSaving: "약 2시간 절약 예상",
  stops: [
    {
      time: "09:30",
      title: "간사이 공항 도착",
      description: "입국 후 바로 시내 이동 동선을 시작합니다.",
      category: "arrival",
    },
    {
      time: "10:00",
      title: "CarryME 수하물 위탁",
      description: "숙소로 짐을 먼저 보내고 손가볍게 이동합니다.",
      category: "carryme",
    },
    {
      time: "10:30",
      title: "USJ로 이동",
      description: "호텔 경유 없이 첫 관광지로 바로 이동합니다.",
      category: "transit",
    },
    {
      time: "11:00",
      title: "유니버설 스튜디오 재팬",
      description: "첫날 핵심 일정을 빠르게 시작합니다.",
      category: "attraction",
    },
    {
      time: "18:00",
      title: "도톤보리 저녁 식사",
      description: "난바 이동 후 식사와 야간 산책을 묶습니다.",
      category: "meal",
    },
  ],
  comparisons: [
    {
      label: "Standard",
      duration: "공항 → 호텔 → USJ",
      luggage: "캐리어 직접 이동",
      highlight: "체크인/짐 보관으로 오전 시간이 줄어듭니다.",
    },
    {
      label: "CarryME",
      duration: "공항 → USJ",
      luggage: "숙소로 수하물 배송",
      highlight: "호텔 경유를 줄이고 바로 관광을 시작합니다.",
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
