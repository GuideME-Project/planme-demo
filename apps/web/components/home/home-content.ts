// GuideME-App origin/main 3eedd35: FlyME, RestME, PlayME and HomeTopPicksSection.
export const partnerLinks = {
  flight: "https://aviasales.tpx.lt/Ryx717iT",
  stay: "https://kkday.tpx.lt/AkJifRE2",
  tour: "https://tiqets.tpx.lt/fGBupMu9",
} as const;

// Official store listings verified on 2026-09-09.
export const appLinks = {
  ios: "https://apps.apple.com/kr/app/가이드미/id6753272072",
  android: "https://play.google.com/store/apps/details?id=guideme.app.prod",
} as const;

export type ContentCategory = "all" | "magazine" | "flight" | "stay" | "tour";

export type HomeArticle = {
  id: string;
  title: string;
  summary: string;
  href: string;
};

export const categories: { id: ContentCategory; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "magazine", label: "매거진" },
  { id: "flight", label: "항공 · FlyME" },
  { id: "stay", label: "숙소 · RestME" },
  { id: "tour", label: "투어 · PlayME" },
];

export const picks: {
  id: string;
  category: Exclude<ContentCategory, "all" | "magazine">;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  href: string;
  partner: string;
  keywords: string;
}[] = [
  {
    id: "seoul",
    category: "tour",
    title: "서울, 익숙함 너머의 발견",
    description: "도시의 새로운 표정을 만나는 여행",
    image: "/home/joinme-1.png",
    imageAlt: "남산과 서울의 야경",
    href: "https://kkday.tpx.lt/PRn71LCr",
    partner: "KKday",
    keywords: "서울 seoul 한국 korea 국내",
  },
  {
    id: "stay",
    category: "stay",
    title: "머무는 시간도 여행이 되도록",
    description: "RestME와 함께 나에게 맞는 숙소 찾기",
    image: "/home/rest-me-popular-hotel-2.png",
    imageAlt: "나무 천장과 흰 소파가 있는 숙소 거실",
    href: partnerLinks.stay,
    partner: "KKday",
    keywords: "호텔 숙박 숙소 restme hotel stay",
  },
  {
    id: "jeju",
    category: "tour",
    title: "제주, 느리게 걷는 하루",
    description: "바람과 바다를 가까이 만나는 시간",
    image: "/home/joinme-3.png",
    imageAlt: "제주의 돌담 너머 푸른 바다",
    href: "https://kkday.tpx.lt/px3EDdk7",
    partner: "KKday",
    keywords: "제주 jeju 한국 korea 국내 바다",
  },
  {
    id: "flight",
    category: "flight",
    title: "다음 여행은 어디로?",
    description: "FlyME에서 여행의 시작이 될 항공권 찾기",
    image: "/brand/planme-search-background.png",
    imageAlt: "여행 경로를 표현한 푸른 배경",
    href: partnerLinks.flight,
    partner: "Aviasales",
    keywords: "비행기 항공 항공권 flyme flight 해외",
  },
  {
    id: "busan",
    category: "tour",
    title: "부산, 바다가 부르는 순간",
    description: "나만의 속도로 즐기는 바다 도시",
    image: "/home/joinme-2.png",
    imageAlt: "부산 여행 풍경",
    href: "https://kkday.tpx.lt/p2tXjcff",
    partner: "KKday",
    keywords: "부산 busan 한국 korea 국내 바다",
  },
  {
    id: "gangneung",
    category: "tour",
    title: "강릉에서 만나는 여유",
    description: "여행에 작은 쉼표를 더해 보세요",
    image: "/home/joinme-4.png",
    imageAlt: "강릉 여행 풍경",
    href: "https://kkday.tpx.lt/BxD9eqEc",
    partner: "KKday",
    keywords: "강릉 gangneung 한국 korea 국내",
  },
];

export const questions = [
  {
    question: "PlanME로 어떻게 여행 일정을 만드나요?",
    answer:
      "출발지와 목적지, 여행 기간, 이동수단을 선택한 뒤 검색해 주세요. 국내 여행은 추천 장소와 이동 경로가 포함된 일정을 만들고, 생성된 일정 상세 화면으로 안내합니다.",
  },
  {
    question: "해외 여행도 검색할 수 있나요?",
    answer:
      "해외 출발지나 목적지를 선택하면 해당 여행의 준비 안내를 확인할 수 있습니다. 현재 국내 일정 생성과 해외 여행 준비 안내는 서로 다른 흐름으로 제공됩니다.",
  },
  {
    question: "항공권과 숙소는 어디에서 예약하나요?",
    answer:
      "항공·숙소·투어 버튼을 누르면 각 제휴사 사이트가 새 탭으로 열립니다. 상품 가격과 예약 가능 여부, 결제 및 취소 조건은 해당 제휴사에서 확인해 주세요.",
  },
  {
    question: "GuideME 앱에서는 무엇을 할 수 있나요?",
    answer:
      "여행지에서 함께할 현지 서포터인 롤러를 찾아보고, 번역을 지원하는 채팅으로 여행을 준비할 수 있습니다. 앱 다운로드 영역에서 공식 스토어로 이동할 수 있어요.",
  },
];
