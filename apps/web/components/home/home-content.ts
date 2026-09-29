import { homeMediaUrl } from "./home-media";
// Affiliate links retained from the existing PlanME home.
// WinkME and GiftME URLs match GuideME-App origin/main 9fa8ed0.
export const partnerLinks = {
  flight: "https://aviasales.tpx.lt/Ryx717iT",
  stay: "https://kkday.tpx.lt/AkJifRE2",
  tour: "https://tiqets.tpx.lt/fGBupMu9",
  esim: "https://yesim.tpx.lt/mM4SQ1TQ",
  insurance: "https://ektatraveling.tpx.lt/lt7O4KpT",
  wink: "https://www.winkme.kr/",
  gift: "https://www.giftme.kr/",
} as const;

// Official store listings verified on 2026-09-09.
export const appLinks = {
  ios: "https://apps.apple.com/kr/app/가이드미/id6753272072",
  android: "https://play.google.com/store/apps/details?id=guideme.app.prod",
} as const;

export type ContentCategory = "all" | "magazine" | "deal" | "flight" | "stay" | "tour";

export type HomeArticle = {
  id: string;
  title: string;
  summary: string;
  href: string;
  image?: string | null;
  language?: string;
};

export const categories: { id: ContentCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "magazine", label: "Roller’s Dispatch" },
  { id: "deal", label: "DealME" },
  { id: "flight", label: "FlyME" },
  { id: "stay", label: "RestME" },
  { id: "tour", label: "PlayME" },
];

export const picks: {
  id: string;
  category: Exclude<ContentCategory, "all" | "magazine" | "deal">;
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
    image: homeMediaUrl("joinme-1.png"),
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
    image: homeMediaUrl("rest-me-popular-hotel-2.png"),
    imageAlt: "나무 천장과 흰 소파가 있는 숙소 거실",
    href: "#stay-promo",
    partner: "GuideME",
    keywords: "호텔 숙박 숙소 restme hotel stay",
  },
  {
    id: "jeju",
    category: "tour",
    title: "제주, 느리게 걷는 하루",
    description: "바람과 바다를 가까이 만나는 시간",
    image: homeMediaUrl("joinme-3.png"),
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
    image: homeMediaUrl("joinme-2.png"),
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
    image: homeMediaUrl("joinme-4.png"),
    imageAlt: "강릉 여행 풍경",
    href: "https://kkday.tpx.lt/BxD9eqEc",
    partner: "KKday",
    keywords: "강릉 gangneung 한국 korea 국내",
  },
];

export const questions = [
  {
    question: "How does PlanME work, and how long does it take to create an itinerary?",
    questionKo: "플랜미는 어떻게 작동하나요? 일정을 짜는 데 얼마나 걸리나요?",
    answer:
      "Enter a departure, destination, travel duration, and transport preference. PlanME then creates a domestic itinerary with places and routes. The time needed can vary by trip and service availability.",
    answerKo: "플랜미는 AI를 활용해 고객님의 취향에 맞는 맞춤형 여행 일정을 단 1분 만에 생성해 드립니다. 여행지, 날짜, 동행인 등 간단한 정보만 입력하면 최적화된 여행 동선을 즉시 확인할 수 있습니다.",
  },
  {
    question: "Can I view my itinerary offline in the GuideME app?",
    questionKo: "생성된 일정을 여행지에서 인터넷 없이 오프라인으로 볼 수 있나요?",
    answer:
      "You can view your itinerary on the web. Automatic sync to the GuideME app and offline access are being prepared.",
    answerKo: "현재 생성한 일정은 웹에서 확인할 수 있습니다. GuideME 앱 자동 동기화와 오프라인 열람은 준비 중입니다.",
  },
  {
    question: "Can I edit the places or order in a generated itinerary?",
    questionKo: "AI가 짜준 일정을 제 마음대로 수정할 수 있나요?",
    answer:
      "Editing places and their order is not available in the current itinerary view. Change the search details and create a new itinerary instead.",
    answerKo: "현재는 생성된 일정의 장소나 방문 순서를 직접 수정하는 기능을 제공하지 않습니다. 다른 일정이 필요하시면 출발지, 목적지, 여행 기간, 이동수단을 변경해 새로운 일정을 생성하실 수 있습니다.",
  },
  {
    question: "How can I save my plan and get the Welcome Coupon Pack?",
    questionKo: "일정을 저장하려면 회원가입을 해야 하나요? 가입 혜택이 있나요?",
    answer:
      "You can explore an itinerary without signing in. Account-based saving and the Welcome Coupon Pack are being prepared.",
    answerKo: "로그인 없이 일정을 살펴볼 수 있습니다. 계정에 일정 저장하기와 웰컴 쿠폰팩은 준비 중입니다.",
  },
];
