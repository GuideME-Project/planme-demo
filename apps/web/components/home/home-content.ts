// GuideME-App origin/main 3eedd35: FlyME, RestME, PlayME and HomeTopPicksSection.
export const partnerLinks = {
  flight: "https://aviasales.tpx.lt/Ryx717iT",
  stay: "https://kkday.tpx.lt/AkJifRE2",
  tour: "https://tiqets.tpx.lt/fGBupMu9",
  esim: "https://yesim.tpx.lt/mM4SQ1TQ",
  insurance: "https://ektatraveling.tpx.lt/lt7O4KpT",
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
  image?: string | null;
  language?: string;
};

export const categories: { id: ContentCategory; label: string }[] = [
  { id: "all", label: "All" },
  { id: "magazine", label: "Roller’s Dispatch" },
  { id: "flight", label: "FlyME" },
  { id: "stay", label: "RestME" },
  { id: "tour", label: "PlayME" },
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
    question: "What type of travel services does GuideME offer?",
    answer:
      "PlanME helps you create domestic travel itineraries and review recommended places and routes. You can explore flights, stays, and activities through our partners, and meet local Rollers through the GuideME app.",
  },
  {
    question: "How do I book a trip with GuideME?",
    answer:
      "Enter your departure, destination, dates, and transport preference to plan a domestic trip. Flight, stay, and activity links open our partner sites, where you can check availability and complete your booking. International itinerary searches currently show a preparation guide.",
  },
  {
    question: "What is the payment process for GuideME?",
    answer:
      "For flights, stays, and activities linked from this page, payment is handled by the partner site. Check that site's prices, payment options, and booking conditions before purchasing.",
  },
  {
    question: "How do I cancel my booking with GuideME?",
    answer:
      "For a booking made through one of the partner links on this page, contact the provider you booked with and follow its cancellation policy. Cancellation and refund conditions depend on that booking.",
  },
];
