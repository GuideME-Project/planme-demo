import {
  getDemoItinerary,
  getItineraryById,
  type ItineraryDay,
  type MapCoordinate,
  type PlanmeItinerary,
  type RouteStop,
  type TimelineEvent,
} from "./mock-data.js";
import { getPlanmeDraftPreviewItineraryById } from "./draft-itineraries.js";

export type GeneratedItineraryRequest = {
  destination?: string;
  durationDays?: number;
  arrivalAirport?: string;
  arrivalTime?: string;
  hotelName?: string;
  origin?: string;
  travelerCount?: number;
  luggageCount?: number;
  preferences?: string[];
};

type DestinationTemplate = {
  key: string;
  destinationLabel: string;
  defaultHotelName: string;
  mainEventName: string;
  dayTwoAttractionName: string;
  stationName: string;
  eventCoordinate?: MapCoordinate;
  hotelCoordinate?: MapCoordinate;
  stationCoordinate?: MapCoordinate;
  attractionCoordinate?: MapCoordinate;
  travelMinutes: number;
};

type AirportTemplate = {
  label: string;
  coordinate: MapCoordinate;
};

type OriginTemplate = {
  cityLabel: string;
  coordinate: MapCoordinate;
  key: string;
  label: string;
};

type NormalizedGeneratedItineraryRequest = {
  destination: string;
  durationDays: number;
  arrivalAirport: string | null;
  arrivalTime: string;
  hotelName: string;
  origin: string | null;
  mainEventNameOverride?: string;
  travelerCount: number;
  luggageCount: number;
  preferences: string[];
};

const generatedItineraryStore = new Map<string, PlanmeItinerary>();

// Route-like destination detection catches ChatGPT tool calls that omit concrete days but put POI lists in destination.
const ROUTE_DESTINATION_SEPARATOR_THRESHOLD = 2;

const airportTemplates: Record<string, AirportTemplate> = {
  CJU: { label: "제주공항", coordinate: { lat: 33.5071, lng: 126.4928 } },
  GMP: { label: "김포공항", coordinate: { lat: 37.5585, lng: 126.7945 } },
  ICN: { label: "인천공항", coordinate: { lat: 37.4602, lng: 126.4407 } },
  PUS: { label: "김해공항", coordinate: { lat: 35.1796, lng: 128.9382 } },
};

const originTemplates: OriginTemplate[] = [
  {
    cityLabel: "서울",
    coordinate: { lat: 37.5547, lng: 126.9706 },
    key: "서울",
    label: "서울역",
  },
  {
    cityLabel: "부산",
    coordinate: { lat: 35.1151, lng: 129.0403 },
    key: "부산",
    label: "부산역",
  },
];

const destinationTemplates: DestinationTemplate[] = [
  {
    key: "부산",
    destinationLabel: "부산",
    defaultHotelName: "서면 호텔",
    mainEventName: "부산 공연장",
    dayTwoAttractionName: "해운대",
    stationName: "부산역",
    eventCoordinate: { lat: 35.191, lng: 129.0615 },
    hotelCoordinate: { lat: 35.1577, lng: 129.0591 },
    stationCoordinate: { lat: 35.1151, lng: 129.0403 },
    attractionCoordinate: { lat: 35.1587, lng: 129.1604 },
    travelMinutes: 320,
  },
  {
    key: "여수",
    destinationLabel: "여수",
    defaultHotelName: "여수 베네치아 호텔",
    mainEventName: "여수 밤바다",
    dayTwoAttractionName: "오동도",
    stationName: "여수엑스포역",
    eventCoordinate: { lat: 34.7391, lng: 127.7449 },
    hotelCoordinate: { lat: 34.7468, lng: 127.7482 },
    stationCoordinate: { lat: 34.7527, lng: 127.7473 },
    attractionCoordinate: { lat: 34.7447, lng: 127.7657 },
    travelMinutes: 300,
  },
  {
    key: "서울",
    destinationLabel: "서울",
    defaultHotelName: "명동 호텔",
    mainEventName: "잠실 공연장",
    dayTwoAttractionName: "경복궁",
    stationName: "서울역",
    eventCoordinate: { lat: 37.5112, lng: 127.0982 },
    hotelCoordinate: { lat: 37.5636, lng: 126.9822 },
    stationCoordinate: { lat: 37.5547, lng: 126.9706 },
    attractionCoordinate: { lat: 37.5796, lng: 126.977 },
    travelMinutes: 90,
  },
  {
    key: "제주",
    destinationLabel: "제주",
    defaultHotelName: "제주시 호텔",
    mainEventName: "제주 공연장",
    dayTwoAttractionName: "함덕해변",
    stationName: "제주공항",
    eventCoordinate: { lat: 33.4996, lng: 126.5312 },
    hotelCoordinate: { lat: 33.499, lng: 126.5305 },
    stationCoordinate: { lat: 33.5071, lng: 126.4928 },
    attractionCoordinate: { lat: 33.5431, lng: 126.6693 },
    travelMinutes: 150,
  },
];

/**
 * Creates a generated PlanME itinerary from GPT Action input.
 */
export function createGeneratedItinerary(input: GeneratedItineraryRequest): PlanmeItinerary {
  const normalizedInput = normalizeGeneratedItineraryRequest(input);
  const destinationTemplate = findDestinationTemplate(normalizedInput.destination);
  const airportTemplate = normalizedInput.arrivalAirport
    ? findAirportTemplate(normalizedInput.arrivalAirport)
    : null;
  const originTemplate =
    !airportTemplate && normalizedInput.origin
      ? findOriginTemplate(normalizedInput.origin)
      : null;
  const primaryPreference = normalizedInput.mainEventNameOverride
    ? toDestinationPreference(normalizedInput.mainEventNameOverride, destinationTemplate)
    : getPrimaryPreference(normalizedInput.preferences, destinationTemplate);
  const itineraryId = createGeneratedItineraryId(normalizedInput, primaryPreference);
  const durationLabel = formatDurationLabel(normalizedInput.durationDays);
  const mainEventName = createMainEventName(primaryPreference, destinationTemplate);
  const hotelName = normalizedInput.hotelName;
  const standardMinutes = destinationTemplate.travelMinutes + 70;
  const carrymeMinutes = destinationTemplate.travelMinutes;
  const savingMinutes = standardMinutes - carrymeMinutes;
  const dayOne = createGeneratedDayOne({
    airportTemplate,
    arrivalTime: normalizedInput.arrivalTime,
    carrymeMinutes,
    destinationTemplate,
    hotelName,
    mainEventName,
    originTemplate,
    savingMinutes,
    standardMinutes,
  });
  const dayTwo = createGeneratedDayTwo({
    destinationTemplate,
    hotelName,
    savingMinutes: Math.max(35, Math.round(savingMinutes * 0.65)),
  });
  const itinerary: PlanmeItinerary = {
    ...getDemoItinerary(),
    id: itineraryId,
    title: createGeneratedItineraryTitle({
      destinationTemplate,
      durationLabel,
      originTemplate,
      primaryPreference,
    }),
    region: destinationTemplate.destinationLabel,
    duration: durationLabel,
    summary: airportTemplate
      ? `${airportTemplate.label} 입국 후 ${mainEventName}(으)로 바로 향하는 CarryME 동선을 확인하세요.`
      : originTemplate
        ? `${originTemplate.label} 출발 후 ${mainEventName}(으)로 바로 향하는 CarryME 동선을 확인하세요.`
      : `${hotelName} 출발 후 ${mainEventName}(으)로 바로 향하는 CarryME 동선을 확인하세요.`,
    detailUrl: `/itinerary/${itineraryId}`,
    carrymeSaving: `약 ${savingMinutes}분 절약 예상`,
    totalDurationLabel: `${formatMinutes(standardMinutes)} → ${formatMinutes(carrymeMinutes)}`,
    savedDurationLabel: `약 ${savingMinutes}분 절약`,
    days: normalizedInput.durationDays > 1 ? [dayOne, dayTwo] : [dayOne],
    benefits: createGeneratedBenefits({
      destinationLabel: destinationTemplate.destinationLabel,
      hotelName,
      originLabel: airportTemplate?.label ?? originTemplate?.label ?? hotelName,
    }),
  };

  generatedItineraryStore.set(itinerary.id, itinerary);

  return itinerary;
}

/**
 * Creates destination-specific benefit copy so generated pages do not leak demo city text.
 */
function createGeneratedBenefits({
  destinationLabel,
  hotelName,
  originLabel,
}: {
  destinationLabel: string;
  hotelName: string;
  originLabel: string;
}) {
  return [
    {
      title: "안전한 짐 배송",
      description: `${originLabel}에서 ${hotelName}까지 안전하게 배송`,
      icon: "shield" as const,
    },
    {
      title: "시간 절약",
      description: "수하물 보관소 경유 없이 목적지로 바로 이동",
      icon: "time" as const,
    },
    {
      title: "가벼운 여행",
      description: `짐 없이 ${destinationLabel} 여행을 즐기세요`,
      icon: "luggage" as const,
    },
    {
      title: "실시간 알림",
      description: "수거부터 도착까지 알림 제공",
      icon: "phone" as const,
    },
  ];
}

/**
 * Finds either a generated itinerary or the fixed demo itinerary.
 */
export function getPlanmeItineraryById(id: string): PlanmeItinerary | null {
  const itineraryId = decodeItineraryId(id);
  const draftPreviewItinerary = getPlanmeDraftPreviewItineraryById(itineraryId);

  if (draftPreviewItinerary) {
    return draftPreviewItinerary;
  }

  const generatedItinerary = generatedItineraryStore.get(itineraryId);

  if (generatedItinerary) {
    return generatedItinerary;
  }

  return getItineraryById(itineraryId) ?? createFallbackGeneratedItineraryFromId(itineraryId);
}

/**
 * Normalizes GPT Action input into deterministic itinerary fields.
 */
function normalizeGeneratedItineraryRequest(
  input: GeneratedItineraryRequest,
): NormalizedGeneratedItineraryRequest {
  const rawDestination = normalizeText(input.destination, "부산");
  const routeDestination = normalizeRouteLikeDestination(rawDestination);
  const destination = routeDestination?.destination ?? rawDestination;
  const destinationTemplate = findDestinationTemplate(destination);
  const durationDays = clampInteger(input.durationDays ?? 2, 1, 14);
  const preferenceHints = normalizePreferences(input.preferences, destinationTemplate);
  const origin = normalizeOrigin(input.origin) ?? preferenceHints.origin;

  return {
    arrivalAirport: normalizeArrivalAirport(input.arrivalAirport),
    arrivalTime: normalizeTime(input.arrivalTime ?? "09:30"),
    destination,
    durationDays,
    hotelName: normalizeText(input.hotelName, destinationTemplate.defaultHotelName),
    luggageCount: clampInteger(input.luggageCount ?? 1, 0, 20),
    mainEventNameOverride: routeDestination?.mainEventName,
    origin,
    preferences: preferenceHints.preferences,
    travelerCount: clampInteger(input.travelerCount ?? 1, 1, 20),
  };
}

/**
 * Builds Day 1 route and timeline data for a generated itinerary.
 */
function createGeneratedDayOne({
  airportTemplate,
  arrivalTime,
  carrymeMinutes,
  destinationTemplate,
  hotelName,
  mainEventName,
  originTemplate,
  savingMinutes,
  standardMinutes,
}: {
  airportTemplate: AirportTemplate | null;
  arrivalTime: string;
  carrymeMinutes: number;
  destinationTemplate: DestinationTemplate;
  hotelName: string;
  mainEventName: string;
  originTemplate: OriginTemplate | null;
  savingMinutes: number;
  standardMinutes: number;
}): ItineraryDay {
  const eventStop = createRouteStop(mainEventName, "방문지", destinationTemplate.eventCoordinate, "event");
  const hotelStop = createRouteStop(hotelName, "짐 도착", destinationTemplate.hotelCoordinate, "hotel");

  if (originTemplate) {
    return createOriginGeneratedDayOne({
      carrymeMinutes,
      eventStop,
      hotelStop,
      originTemplate,
      savingMinutes,
      standardMinutes,
    });
  }

  if (!airportTemplate) {
    return createLocalGeneratedDayOne({
      carrymeMinutes,
      eventStop,
      hotelStop,
      savingMinutes,
      standardMinutes,
      stationName: destinationTemplate.stationName,
      stationCoordinate: destinationTemplate.stationCoordinate,
    });
  }

  const airportStop = createRouteStop(airportTemplate.label, "입국", airportTemplate.coordinate, "airport");

  return {
    day: 1,
    label: "Day 1",
    savingMinutes,
    standard: {
      id: "standard",
      label: "Standard",
      badge: "Standard",
      routeText: `${airportStop.label} → ${hotelStop.label} → ${eventStop.label}`,
      description: `수하물 보관을 위해 ${hotelStop.label}을 먼저 경유`,
      durationLabel: formatMinutes(standardMinutes),
      durationMinutes: standardMinutes,
      stops: [airportStop, hotelStop, eventStop],
      geoPath: createGeoPath([airportStop, hotelStop, eventStop]),
      mapPath: [
        { x: 14, y: 22 },
        { x: 78, y: 74 },
        { x: 84, y: 66 },
      ],
    },
    carryme: {
      id: "carryme",
      label: "CarryME",
      badge: "CarryME",
      routeText: `${airportStop.label} → ${eventStop.label} → ${hotelStop.label}`,
      description: "수하물은 캐리미가 호텔로, 여행자는 목적지로 바로 이동",
      durationLabel: formatMinutes(carrymeMinutes),
      durationMinutes: carrymeMinutes,
      stops: [airportStop, eventStop, hotelStop],
      geoPath: createGeoPath([airportStop, eventStop, hotelStop]),
      mapPath: [
        { x: 14, y: 22 },
        { x: 84, y: 66 },
        { x: 78, y: 74 },
      ],
    },
    timeline: createGeneratedDayOneTimeline({
      airportLabel: airportStop.label,
      arrivalTime,
      hotelName,
      mainEventName,
      savingMinutes,
    }),
  };
}

/**
 * Builds Day 1 for domestic requests that include a clear origin city.
 */
function createOriginGeneratedDayOne({
  carrymeMinutes,
  eventStop,
  hotelStop,
  originTemplate,
  savingMinutes,
  standardMinutes,
}: {
  carrymeMinutes: number;
  eventStop: RouteStop;
  hotelStop: RouteStop;
  originTemplate: OriginTemplate;
  savingMinutes: number;
  standardMinutes: number;
}): ItineraryDay {
  const originStop = createRouteStop(
    originTemplate.label,
    "출발지",
    originTemplate.coordinate,
    "station",
  );

  return {
    day: 1,
    label: "Day 1",
    savingMinutes,
    standard: {
      id: "standard",
      label: "Standard",
      badge: "Standard",
      routeText: `${originStop.label} → ${hotelStop.label} → ${eventStop.label}`,
      description: `수하물 보관을 위해 ${hotelStop.label}을 먼저 경유`,
      durationLabel: formatMinutes(standardMinutes),
      durationMinutes: standardMinutes,
      stops: [originStop, hotelStop, eventStop],
      geoPath: createGeoPath([originStop, hotelStop, eventStop]),
      mapPath: [
        { x: 14, y: 22 },
        { x: 78, y: 74 },
        { x: 84, y: 66 },
      ],
    },
    carryme: {
      id: "carryme",
      label: "CarryME",
      badge: "CarryME",
      routeText: `${originStop.label} → ${eventStop.label} → ${hotelStop.label}`,
      description: "수하물은 캐리미가 호텔로, 여행자는 목적지로 바로 이동",
      durationLabel: formatMinutes(carrymeMinutes),
      durationMinutes: carrymeMinutes,
      stops: [originStop, eventStop, hotelStop],
      geoPath: createGeoPath([originStop, eventStop, hotelStop]),
      mapPath: [
        { x: 14, y: 22 },
        { x: 84, y: 66 },
        { x: 78, y: 74 },
      ],
    },
    timeline: createOriginGeneratedDayOneTimeline({
      hotelName: hotelStop.label,
      mainEventName: eventStop.label,
      originLabel: originStop.label,
      savingMinutes,
    }),
  };
}

/**
 * Builds Day 1 for domestic/local requests that already start inside the destination city.
 */
function createLocalGeneratedDayOne({
  carrymeMinutes,
  eventStop,
  hotelStop,
  savingMinutes,
  standardMinutes,
  stationCoordinate,
  stationName,
}: {
  carrymeMinutes: number;
  eventStop: RouteStop;
  hotelStop: RouteStop;
  savingMinutes: number;
  standardMinutes: number;
  stationCoordinate?: MapCoordinate;
  stationName: string;
}): ItineraryDay {
  const stationStop = createRouteStop(stationName, "수하물 보관", stationCoordinate, "station");

  return {
    day: 1,
    label: "Day 1",
    savingMinutes,
    standard: {
      id: "standard",
      label: "Standard",
      badge: "Standard",
      routeText: `${hotelStop.label} → ${stationStop.label} → ${eventStop.label}`,
      description: `수하물 보관을 위해 ${stationStop.label}을 먼저 경유`,
      durationLabel: formatMinutes(standardMinutes),
      durationMinutes: standardMinutes,
      stops: [hotelStop, stationStop, eventStop],
      geoPath: createGeoPath([hotelStop, stationStop, eventStop]),
      mapPath: [
        { x: 34, y: 56 },
        { x: 26, y: 72 },
        { x: 76, y: 44 },
      ],
    },
    carryme: {
      id: "carryme",
      label: "CarryME",
      badge: "CarryME",
      routeText: `${hotelStop.label} → ${eventStop.label}`,
      description: "수하물은 캐리미가 보관 지점으로, 여행자는 목적지로 바로 이동",
      durationLabel: formatMinutes(carrymeMinutes),
      durationMinutes: carrymeMinutes,
      stops: [hotelStop, eventStop],
      geoPath: createGeoPath([hotelStop, eventStop]),
      mapPath: [
        { x: 34, y: 56 },
        { x: 76, y: 44 },
      ],
    },
    timeline: createLocalGeneratedDayOneTimeline({
      eventName: eventStop.label,
      hotelName: hotelStop.label,
      savingMinutes,
      stationName,
    }),
  };
}

/**
 * Creates the Day 1 timeline for domestic/local requests without inventing an airport arrival.
 */
function createLocalGeneratedDayOneTimeline({
  eventName,
  hotelName,
  savingMinutes,
  stationName,
}: {
  eventName: string;
  hotelName: string;
  savingMinutes: number;
  stationName: string;
}): TimelineEvent[] {
  return [
    {
      time: "09:30",
      title: `${hotelName} 출발`,
      description: "숙소에서 바로 여행 일정 시작",
      category: "hotel",
    },
    {
      time: "10:00",
      title: "캐리미 짐 탁송 완료",
      description: `${hotelName}에서 ${stationName} 보관 지점으로 배송 접수 완료`,
      category: "carryme",
      highlight: true,
    },
    {
      time: "10:20",
      title: `${eventName} 이동 시작`,
      description: "짐 없이 바로 목적지로 이동",
      category: "transit",
      savingLabel: `약 ${savingMinutes}분 절약`,
    },
    {
      time: "15:00",
      title: `${eventName} 방문`,
      description: "수하물 보관소 경유 없이 바로 목적지 도착",
      category: "event",
    },
    {
      time: "21:30",
      title: `${stationName} 짐 수령`,
      description: "일정 후 안전하게 도착한 내 짐 확인",
      category: "transit",
    },
  ];
}

/**
 * Builds Day 2 route and timeline data for a generated itinerary.
 */
function createGeneratedDayTwo({
  destinationTemplate,
  hotelName,
  savingMinutes,
}: {
  destinationTemplate: DestinationTemplate;
  hotelName: string;
  savingMinutes: number;
}): ItineraryDay {
  const hotelStop = createRouteStop(hotelName, "체크아웃", destinationTemplate.hotelCoordinate, "hotel");
  const stationStop = createRouteStop(
    destinationTemplate.stationName,
    "짐 수령",
    destinationTemplate.stationCoordinate,
    "station",
  );
  const attractionStop = createRouteStop(
    destinationTemplate.dayTwoAttractionName,
    "관광",
    destinationTemplate.attractionCoordinate,
    "attraction",
  );
  const standardMinutes = 200;
  const carrymeMinutes = standardMinutes - savingMinutes;

  return {
    day: 2,
    label: "Day 2",
    savingMinutes,
    standard: {
      id: "standard",
      label: "Standard",
      badge: "Standard",
      routeText: `${hotelStop.label} → ${stationStop.label} → ${attractionStop.label}`,
      description: "체크아웃 후 짐 보관을 위해 역을 먼저 경유",
      durationLabel: formatMinutes(standardMinutes),
      durationMinutes: standardMinutes,
      stops: [hotelStop, stationStop, attractionStop],
      geoPath: createGeoPath([hotelStop, stationStop, attractionStop]),
      mapPath: [
        { x: 34, y: 56 },
        { x: 26, y: 72 },
        { x: 76, y: 44 },
      ],
    },
    carryme: {
      id: "carryme",
      label: "CarryME",
      badge: "CarryME",
      routeText: `${hotelStop.label} → ${attractionStop.label} → ${stationStop.label}`,
      description: "짐은 수령 지점으로 보내고 마지막 관광까지 가볍게 이동",
      durationLabel: formatMinutes(carrymeMinutes),
      durationMinutes: carrymeMinutes,
      stops: [hotelStop, attractionStop, stationStop],
      geoPath: createGeoPath([hotelStop, attractionStop, stationStop]),
      mapPath: [
        { x: 34, y: 56 },
        { x: 76, y: 44 },
        { x: 26, y: 72 },
      ],
    },
    timeline: [
      {
        time: "09:30",
        title: "호텔 출발",
        description: "체크아웃과 동시에 짐 배송 접수",
        category: "hotel",
      },
      {
        time: "10:00",
        title: "캐리미 짐 수거 완료",
        description: "짐은 수령 지점으로 이동",
        category: "carryme",
        highlight: true,
      },
      {
        time: "10:30",
        title: `${destinationTemplate.dayTwoAttractionName} 이동`,
        description: "짐 보관소 경유 없이 바로 관광지로 이동",
        category: "transit",
        savingLabel: `약 ${savingMinutes}분 절약`,
      },
      {
        time: "13:00",
        title: `${destinationTemplate.destinationLabel} 점심 식사`,
        description: "여유로운 식사와 산책",
        category: "meal",
      },
      {
        time: "16:30",
        title: `${destinationTemplate.stationName} 짐 수령`,
        description: "귀국 또는 다음 도시 이동 전 짐 확인",
        category: "transit",
      },
    ],
  };
}

/**
 * Creates the Day 1 timeline using the requested arrival time.
 */
function createGeneratedDayOneTimeline({
  airportLabel,
  arrivalTime,
  hotelName,
  mainEventName,
  savingMinutes,
}: {
  airportLabel: string;
  arrivalTime: string;
  hotelName: string;
  mainEventName: string;
  savingMinutes: number;
}): TimelineEvent[] {
  return [
    {
      time: arrivalTime,
      title: `${airportLabel} 도착`,
      description: "입국 후 여행 일정 시작",
      category: "arrival",
    },
    {
      time: addMinutesToTime(arrivalTime, 30),
      title: "캐리미 짐 탁송 완료",
      description: `${airportLabel}에서 ${hotelName} 배송 접수 완료`,
      category: "carryme",
      highlight: true,
    },
    {
      time: addMinutesToTime(arrivalTime, 50),
      title: `${mainEventName} 이동 시작`,
      description: "짐 없이 바로 목적지로 이동",
      category: "transit",
      savingLabel: `약 ${savingMinutes}분 절약`,
    },
    {
      time: addMinutesToTime(arrivalTime, 330),
      title: `${mainEventName} 방문`,
      description: "호텔 경유 없이 바로 목적지 도착",
      category: "event",
    },
    {
      time: addMinutesToTime(arrivalTime, 720),
      title: `${hotelName} 도착`,
      description: "일정 후 안전하게 도착한 내 짐 확인",
      category: "hotel",
    },
  ];
}

/**
 * Creates the Day 1 timeline for domestic origin-to-destination requests.
 */
function createOriginGeneratedDayOneTimeline({
  hotelName,
  mainEventName,
  originLabel,
  savingMinutes,
}: {
  hotelName: string;
  mainEventName: string;
  originLabel: string;
  savingMinutes: number;
}): TimelineEvent[] {
  return [
    {
      time: "09:30",
      title: `${originLabel} 출발`,
      description: "출발지에서 여행 일정 시작",
      category: "arrival",
    },
    {
      time: "10:00",
      title: "캐리미 짐 탁송 완료",
      description: `${originLabel}에서 ${hotelName} 배송 접수 완료`,
      category: "carryme",
      highlight: true,
    },
    {
      time: "10:20",
      title: `${mainEventName} 이동 시작`,
      description: "짐 없이 바로 목적지로 이동",
      category: "transit",
      savingLabel: `약 ${savingMinutes}분 절약`,
    },
    {
      time: "15:00",
      title: `${mainEventName} 방문`,
      description: "호텔 경유 없이 바로 목적지 도착",
      category: "event",
    },
    {
      time: "21:30",
      title: `${hotelName} 도착`,
      description: "일정 후 안전하게 도착한 내 짐 확인",
      category: "hotel",
    },
  ];
}

/**
 * Creates a route stop with a stable label, caption, coordinate, and icon.
 */
function createRouteStop(
  label: string,
  caption: string,
  coordinate: MapCoordinate | undefined,
  icon: RouteStop["icon"],
): RouteStop {
  return {
    caption,
    coordinate,
    icon,
    label,
  };
}

/**
 * Extracts map coordinates from route stops without inventing intermediate geometry.
 */
function createGeoPath(stops: RouteStop[]): MapCoordinate[] {
  return stops.flatMap((stop) => (stop.coordinate ? [stop.coordinate] : []));
}

/**
 * Finds a known destination template or builds a safe fallback template.
 */
function findDestinationTemplate(destination: string): DestinationTemplate {
  const matchedTemplate = destinationTemplates.find(
    (template) =>
      destination.includes(template.key) || template.destinationLabel.includes(destination),
  );

  if (matchedTemplate) {
    return matchedTemplate;
  }

  const fallbackTemplate = destinationTemplates[0];

  // Unknown destinations must not inherit 부산역 or 부산 coordinates from the demo template.
  return {
    ...fallbackTemplate,
    attractionCoordinate: undefined,
    dayTwoAttractionName: `${destination} 둘째 날 일정`,
    defaultHotelName: `${destination} 호텔`,
    destinationLabel: destination,
    eventCoordinate: undefined,
    hotelCoordinate: undefined,
    mainEventName: `${destination} 대표 일정`,
    stationCoordinate: undefined,
    stationName: `${destination} 수령 지점`,
  };
}

/**
 * Finds the arrival airport template by airport code.
 */
function findAirportTemplate(airportCode: string): AirportTemplate {
  return airportTemplates[airportCode] ?? airportTemplates.ICN;
}

/**
 * Finds a supported domestic origin template by city or station text.
 */
function findOriginTemplate(origin: string): OriginTemplate {
  return (
    originTemplates.find(
      (template) => origin.includes(template.key) || origin.includes(template.label),
    ) ?? originTemplates[0]
  );
}

/**
 * Builds a generated itinerary title without duplicating origin or destination labels.
 */
function createGeneratedItineraryTitle({
  destinationTemplate,
  durationLabel,
  originTemplate,
  primaryPreference,
}: {
  destinationTemplate: DestinationTemplate;
  durationLabel: string;
  originTemplate: OriginTemplate | null;
  primaryPreference: string;
}) {
  if (originTemplate) {
    return `PlanME ${originTemplate.cityLabel} → ${destinationTemplate.destinationLabel} ${primaryPreference} ${durationLabel} 추천 일정`;
  }

  return `PlanME ${destinationTemplate.destinationLabel} ${primaryPreference} ${durationLabel} 추천 일정`;
}

/**
 * Creates a human-facing main event label from the first preference.
 */
function createMainEventName(primaryPreference: string, destinationTemplate: DestinationTemplate) {
  if (primaryPreference.includes(destinationTemplate.destinationLabel)) {
    return primaryPreference;
  }

  return `${destinationTemplate.destinationLabel} ${primaryPreference}`;
}

/**
 * Selects the strongest preference to use in the generated title.
 */
function getPrimaryPreference(preferences: string[], destinationTemplate: DestinationTemplate) {
  return preferences[0] ?? toDestinationPreference(destinationTemplate.mainEventName, destinationTemplate);
}

/**
 * Extracts a stable destination and main POI when ChatGPT sends a full POI route as destination.
 */
function normalizeRouteLikeDestination(destination: string) {
  const segments = destination
    .split(/\s*(?:→|->|·)\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length < ROUTE_DESTINATION_SEPARATOR_THRESHOLD + 1) {
    return null;
  }

  const mainEventName = segments[0] ?? destination;

  // Unknown-region generated pages should stay regional instead of turning the whole POI chain into the region.
  return {
    destination: inferDestinationLabelFromRouteSegments(segments),
    mainEventName,
  };
}

/**
 * Infers a destination label from route segments without relying on a hard-coded POI catalog.
 */
function inferDestinationLabelFromRouteSegments(segments: string[]) {
  const matchedTemplate = destinationTemplates.find((template) =>
    segments.some(
      (segment) =>
        segment.includes(template.key) || segment.includes(template.destinationLabel),
    ),
  );

  if (matchedTemplate) {
    return matchedTemplate.destinationLabel;
  }

  return segments[0]?.split(/\s+/)[0] ?? "PlanME";
}

/**
 * Converts a full POI label into the preference part used by generated titles.
 */
function toDestinationPreference(value: string, destinationTemplate: DestinationTemplate) {
  return (
    value
      .replace(new RegExp(`^${destinationTemplate.destinationLabel}\\s*`), "")
      .trim() || value
  );
}

/**
 * Normalizes an optional text field.
 */
function normalizeText(value: string | undefined, fallback: string) {
  const normalizedValue = value?.trim();

  return normalizedValue && normalizedValue.length > 0 ? normalizedValue : fallback;
}

/**
 * Normalizes a direct origin field when GPT Actions can provide one.
 */
function normalizeOrigin(value: string | undefined) {
  const normalizedValue = value?.trim();

  return normalizedValue && normalizedValue.length > 0 ? normalizedValue : null;
}

/**
 * Keeps airport routing opt-in so domestic requests do not silently become Incheon arrivals.
 */
function normalizeArrivalAirport(value: string | undefined) {
  const normalizedValue = value?.trim().toUpperCase();

  return normalizedValue && normalizedValue.length > 0 ? normalizedValue : null;
}

/**
 * Normalizes optional preference text values and extracts origin hints that GPT may put there.
 */
function normalizePreferences(
  preferences: string[] | undefined,
  destinationTemplate: DestinationTemplate,
) {
  let origin: string | null = null;
  const normalizedPreferences: string[] = [];

  (preferences ?? []).forEach((preference) => {
    const normalizedPreference = preference.trim();

    if (normalizedPreference.length === 0) {
      return;
    }

    const originHint = extractOriginHint(normalizedPreference, destinationTemplate);

    if (originHint) {
      origin = origin ?? originHint;
      return;
    }

    const destinationSpecificPreference = normalizeDestinationPreference(
      normalizedPreference,
      destinationTemplate,
    );

    if (destinationSpecificPreference) {
      normalizedPreferences.push(destinationSpecificPreference);
    }
  });

  return {
    origin,
    preferences: normalizedPreferences,
  };
}

/**
 * Extracts phrases like "서울 출발" so they do not become attraction names.
 */
function extractOriginHint(preference: string, destinationTemplate: DestinationTemplate) {
  const departureMatch = /^(.+?)\s*출발$/.exec(preference);
  const fromToMatch = /^(.+?)에서\s*(.+)$/.exec(preference);
  const originCandidate = departureMatch?.[1]?.trim();

  if (originCandidate) {
    return isKnownOrigin(originCandidate) ? originCandidate : null;
  }

  if (fromToMatch) {
    const maybeOrigin = fromToMatch[1]?.trim();
    const maybeDestination = fromToMatch[2]?.trim() ?? "";

    if (
      maybeOrigin &&
      isKnownOrigin(maybeOrigin) &&
      maybeDestination.includes(destinationTemplate.destinationLabel)
    ) {
      return maybeOrigin;
    }
  }

  return null;
}

/**
 * Drops generic destination request words so titles use a real attraction fallback.
 */
function normalizeDestinationPreference(
  preference: string,
  destinationTemplate: DestinationTemplate,
) {
  const withoutDestinationPrefix = preference
    .replace(new RegExp(`^${destinationTemplate.destinationLabel}\\s*`), "")
    .trim();
  const normalizedPreference = withoutDestinationPrefix || preference;

  return /^(추천|여행|일정|출발)$/.test(normalizedPreference)
    ? null
    : normalizedPreference;
}

/**
 * Checks whether a text fragment maps to a supported origin template.
 */
function isKnownOrigin(value: string) {
  return originTemplates.some(
    (template) => value.includes(template.key) || value.includes(template.label),
  );
}

/**
 * Clamps an integer input into an allowed range.
 */
function clampInteger(value: number, min: number, max: number) {
  const integerValue = Number.isFinite(value) ? Math.round(value) : min;

  return Math.min(max, Math.max(min, integerValue));
}

/**
 * Normalizes time text into HH:mm.
 */
function normalizeTime(value: string) {
  return /^\d{2}:\d{2}$/.test(value) ? value : "09:30";
}

/**
 * Adds minutes to HH:mm time and wraps at midnight.
 */
function addMinutesToTime(time: string, minutesToAdd: number) {
  const [hoursText, minutesText] = time.split(":");
  const totalMinutes =
    (Number(hoursText) * 60 + Number(minutesText) + minutesToAdd) % (24 * 60);
  const hours = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (totalMinutes % 60).toString().padStart(2, "0");

  return `${hours}:${minutes}`;
}

/**
 * Formats a day count as a Korean itinerary duration label.
 */
function formatDurationLabel(durationDays: number) {
  return durationDays <= 1 ? "당일" : `${durationDays - 1}박 ${durationDays}일`;
}

/**
 * Formats a minute duration for UI labels.
 */
function formatMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `약 ${minutes}분`;
  }

  return minutes === 0 ? `약 ${hours}시간` : `약 ${hours}시간 ${minutes}분`;
}

/**
 * Creates a stable generated itinerary id from normalized input.
 */
function createGeneratedItineraryId(
  input: NormalizedGeneratedItineraryRequest,
  primaryPreference: string,
) {
  const slug = slugifyItineraryPart(
    [input.destination, input.origin, primaryPreference].filter(Boolean).join("-"),
  );
  const hash = hashString(
    [
      input.arrivalAirport,
      input.arrivalTime,
      input.destination,
      input.durationDays,
      input.hotelName,
      input.luggageCount,
      input.origin,
      input.preferences.join("|"),
      input.travelerCount,
    ].join(":"),
  );

  return `generated-${slug}-${input.durationDays}d-${hash}`;
}

/**
 * Creates a URL-safe slug while keeping Korean labels readable.
 */
function slugifyItineraryPart(value: string) {
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
 * Creates a compact deterministic hash for generated itinerary ids.
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
 * Decodes a dynamic route id without failing malformed manual URLs.
 */
function decodeItineraryId(id: string) {
  try {
    return decodeURIComponent(id);
  } catch {
    // Malformed encoded ids should fall through to the normal not-found behavior.
    return id;
  }
}

/**
 * Recreates a minimal generated itinerary from a generated id after process memory is lost.
 */
function createFallbackGeneratedItineraryFromId(id: string) {
  const match = /^generated-(.+)-(\d+)d-[a-z0-9]+$/.exec(id);

  if (!match) {
    return null;
  }

  const slugParts = match[1].split("-");
  const durationDays = Number(match[2]);
  const destination = slugParts[0] ?? "부산";
  const remainingSlugParts = slugParts.slice(1);
  const originIndex = remainingSlugParts.findIndex(isKnownOrigin);
  const origin = originIndex >= 0 ? remainingSlugParts[originIndex] : undefined;
  const preference =
    remainingSlugParts.filter((_, index) => index !== originIndex).join(" ") || undefined;

  return createGeneratedItinerary({
    destination,
    durationDays,
    origin,
    preferences: preference ? [preference] : undefined,
  });
}
