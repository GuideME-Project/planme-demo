import type {
  PlanmeDraftPreviewRequest,
  PlanmeDraftRouteStop,
  PlanmeDraftTimelineEvent,
} from "../src/draft-itineraries.js";
import { createPlanmeDraftPreview } from "../src/draft-itineraries.js";
import {
  normalizePlanmeDraftDomainContract,
  validatePlanmeDraftDomainContract,
} from "../src/itinerary-domain-contract.js";

const origin: PlanmeDraftRouteStop = {
  name: "동탄호수공원",
  caption: "출발",
  coordinate: { lat: 37.172, lng: 127.105 },
  mode: "drive",
  placeSource: "input",
  placeSourceRef: "input:origin:dongtan-lake-park",
  requiredPlaceKind: "origin",
  role: "출발지",
};

const lodging: PlanmeDraftRouteStop = {
  name: "베이몬드호텔 해운대",
  caption: "숙소",
  coordinate: { lat: 35.158, lng: 129.16 },
  mode: "drive",
  placeId: "places/baymond-hotel-haeundae",
  placeSource: "naver_local",
  placeSourceRef: "naver:baymond-hotel-haeundae",
  role: "숙소",
};

const gamcheon: PlanmeDraftRouteStop = {
  name: "감천문화마을",
  caption: "관광",
  coordinate: { lat: 35.097, lng: 129.01 },
  mode: "drive",
  placeSource: "naver_local",
  placeSourceRef: "naver:gamcheon-culture-village",
  role: "방문지",
};

const haeundae: PlanmeDraftRouteStop = {
  name: "해운대해수욕장",
  caption: "관광",
  coordinate: { lat: 35.1587, lng: 129.1604 },
  mode: "drive",
  placeSource: "naver_local",
  placeSourceRef: "naver:haeundae-beach",
  role: "방문지",
};

const secondLodging: PlanmeDraftRouteStop = {
  ...lodging,
  name: "부산역 시티호텔",
  coordinate: { lat: 35.115, lng: 129.041 },
  placeId: "places/busan-station-city-hotel",
  placeSourceRef: "naver:busan-station-city-hotel",
};

const jagalchi: PlanmeDraftRouteStop = {
  ...gamcheon,
  name: "자갈치시장",
  coordinate: { lat: 35.0975, lng: 129.0306 },
  placeSourceRef: "naver:jagalchi-market",
};

function event(
  time: string,
  title: string,
  stopIndex: number | null,
  category: PlanmeDraftTimelineEvent["category"] = "event",
): PlanmeDraftTimelineEvent {
  return {
    time,
    title,
    description: `${title} 일정입니다.`,
    category,
    stopIndex,
    stayDurationMinutes: 0,
  };
}

function createDraft(): PlanmeDraftPreviewRequest {
  return {
    title: "동탄 출발 부산 1박 2일",
    region: "부산",
    duration: "1박 2일",
    transportMode: "drive",
    days: [
      {
        day: 1,
        label: "1일차",
        standardStops: [origin, lodging, gamcheon, lodging],
        carrymeStops: [
          origin,
          { ...lodging, caption: "짐 배송 도착" },
          gamcheon,
          lodging,
        ],
        standardTimeline: [
          event("08:00", "동탄호수공원 출발", 0, "arrival"),
          event("12:00", "베이몬드호텔 체크인", 1, "hotel"),
          event("14:00", "감천문화마을 관광", 2),
          event("18:00", "베이몬드호텔 복귀", 3, "hotel"),
        ],
        carrymeTimeline: [
          event("08:00", "동탄호수공원 출발", 0, "arrival"),
          event("12:00", "짐 베이몬드호텔 도착", 1, "carryme"),
          event("14:00", "감천문화마을 관광", 2),
          event("18:00", "베이몬드호텔 도착", 3, "hotel"),
        ],
      },
      {
        day: 2,
        label: "2일차",
        standardStops: [lodging, haeundae, lodging],
        carrymeStops: [lodging, haeundae, lodging],
        standardTimeline: [
          event("09:00", "베이몬드호텔 출발", 0, "hotel"),
          event("12:00", "해운대해수욕장 관광", 1),
          event("17:00", "베이몬드호텔 복귀", 2, "hotel"),
        ],
        carrymeTimeline: [
          event("09:00", "베이몬드호텔 출발", 0, "hotel"),
          event("12:00", "해운대해수욕장 관광", 1),
          event("17:00", "베이몬드호텔 복귀", 2, "hotel"),
        ],
      },
    ],
  };
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected=${String(expected)} actual=${String(actual)}`);
  }
}

function assertTimelineReferencesEveryStopOnce(
  events: readonly PlanmeDraftTimelineEvent[],
  stopCount: number,
) {
  for (let stopIndex = 0; stopIndex < stopCount; stopIndex += 1) {
    assertEqual(
      events.filter((item) => item.stopIndex === stopIndex).length,
      1,
      `${stopIndex}번 장소의 대표 이벤트 수`,
    );
  }
}

function assertNormalizationContract() {
  const draft = createDraft();
  const originalSnapshot = JSON.stringify(draft);
  const result = normalizePlanmeDraftDomainContract({
    draft,
    durationDays: 2,
    transportMode: "drive",
    origin,
  });

  assert(result.ok, `정상 초안이 거부됐습니다: ${result.issues.map((issue) => issue.code).join(",")}`);
  assertEqual(JSON.stringify(draft), originalSnapshot, "입력 초안을 변경하면 안 됩니다");

  const firstDay = result.draft.days[0];
  const finalDay = result.draft.days[1];

  assert(firstDay?.standardStops !== undefined, "첫날 Standard 경로가 필요합니다.");
  assert(firstDay.carrymeStops !== undefined, "첫날 CarryME 경로가 필요합니다.");
  assert(firstDay.standardTimeline !== undefined, "첫날 Standard 타임라인이 필요합니다.");
  assert(firstDay.carrymeTimeline !== undefined, "첫날 CarryME 타임라인이 필요합니다.");
  assert(finalDay?.standardStops !== undefined, "마지막 날 Standard 경로가 필요합니다.");
  assert(finalDay.carrymeStops !== undefined, "마지막 날 CarryME 경로가 필요합니다.");
  assert(finalDay.standardTimeline !== undefined, "마지막 날 Standard 타임라인이 필요합니다.");
  assert(finalDay.carrymeTimeline !== undefined, "마지막 날 CarryME 타임라인이 필요합니다.");

  assertEqual(firstDay.standardStops[0]?.placeSourceRef, origin.placeSourceRef, "첫날 출발지");
  assertEqual(firstDay.standardStops[1]?.placeSourceRef, lodging.placeSourceRef, "Standard 숙소 선경유");
  assertEqual(firstDay.standardStops.at(-1)?.placeSourceRef, lodging.placeSourceRef, "Standard 숙소 종료");
  assertEqual(firstDay.carrymeStops[0]?.placeSourceRef, origin.placeSourceRef, "CarryME 첫날 출발지");
  assertEqual(firstDay.carrymeStops[1]?.placeSourceRef, gamcheon.placeSourceRef, "CarryME 관광 직행");
  assertEqual(firstDay.carrymeStops.at(-1)?.placeSourceRef, lodging.placeSourceRef, "CarryME 숙소 종료");
  assertEqual(firstDay.carrymeStops.filter((stop) => stop.role === "숙소").length, 1, "CarryME 숙소 방문 수");

  const deliveryEvent = firstDay.carrymeTimeline.find((item) => item.category === "carryme");
  assert(deliveryEvent !== undefined, "CarryME 배송 이벤트가 유지돼야 합니다.");
  assertEqual(deliveryEvent.stopIndex, null, "CarryME 배송 이벤트는 여행자 stop이 아닙니다");
  assertEqual(deliveryEvent.time, "12:00", "짐은 Standard 숙소 경유 도착 시각에 맞춰야 합니다");
  assertEqual(deliveryEvent.title, "짐 베이몬드호텔 해운대 도착", "첫날 짐 배송 대상");
  assert(
    (firstDay.standardTimeline[1]?.stayDurationMinutes ?? 0) >= 20,
    "Standard 숙소 선경유에는 짐을 내려놓는 시간이 필요합니다.",
  );

  assertEqual(finalDay.standardStops[0]?.placeSourceRef, lodging.placeSourceRef, "다음날 Standard 숙소 출발");
  assertEqual(finalDay.carrymeStops[0]?.placeSourceRef, lodging.placeSourceRef, "다음날 CarryME 숙소 출발");
  assertEqual(finalDay.standardStops.at(-1)?.placeSourceRef, origin.placeSourceRef, "마지막 날 Standard 원출발지 복귀");
  assertEqual(finalDay.carrymeStops.at(-1)?.placeSourceRef, origin.placeSourceRef, "마지막 날 CarryME 원출발지 복귀");
  assertEqual(finalDay.standardStops.at(-1)?.role, "복귀지", "마지막 날 Standard 종료 역할");
  assertEqual(finalDay.carrymeStops.at(-1)?.role, "복귀지", "마지막 날 CarryME 종료 역할");
  assertEqual(finalDay.standardStops.slice(1, -1).some((stop) => stop.role === "숙소"), false, "마지막 날 호텔 복귀 제거");

  assertTimelineReferencesEveryStopOnce(firstDay.standardTimeline, firstDay.standardStops.length);
  assertTimelineReferencesEveryStopOnce(firstDay.carrymeTimeline, firstDay.carrymeStops.length);
  assertTimelineReferencesEveryStopOnce(finalDay.standardTimeline, finalDay.standardStops.length);
  assertTimelineReferencesEveryStopOnce(finalDay.carrymeTimeline, finalDay.carrymeStops.length);
  assertEqual(finalDay.standardTimeline.at(-1)?.title, "동탄호수공원 도착", "누락한 최종 복귀 이벤트 합성");
  const finalDeliveryEvent = finalDay.carrymeTimeline.find((item) => item.category === "carryme");
  assert(finalDeliveryEvent !== undefined, "마지막 날 원출발지 배송 이벤트를 합성해야 합니다.");
  assertEqual(finalDeliveryEvent.stopIndex, null, "마지막 날 배송은 여행자 stop이 아닙니다");
  assertEqual(finalDeliveryEvent.title, "짐 동탄호수공원 도착", "마지막 날 짐 배송 대상");
  assert(
    (finalDay.carrymeTimeline[0]?.stayDurationMinutes ?? 0) >= 15,
    "마지막 날 숙소 출발에는 짐 인계 시간이 필요합니다.",
  );

  const validationIssues = validatePlanmeDraftDomainContract({
    draft: result.draft,
    durationDays: 2,
    transportMode: "drive",
    origin,
  });
  assertEqual(validationIssues.length, 0, "정규화 결과의 계약 검증 오류 수");
}

function assertVisitSequenceMismatchFailsClosed() {
  const draft = createDraft();
  const firstDay = draft.days[0];

  assert(firstDay?.carrymeStops !== undefined, "불일치 검증용 CarryME 경로가 필요합니다.");
  firstDay.carrymeStops = firstDay.carrymeStops.map((stop, stopIndex) =>
    stopIndex === 2 ? haeundae : stop,
  );

  const result = normalizePlanmeDraftDomainContract({
    draft,
    durationDays: 2,
    transportMode: "drive",
    origin,
  });

  assertEqual(result.ok, false, "비교 경로의 관광 장소가 다르면 실패해야 합니다.");
  assert(
    result.issues.some(
      (issue) => issue.code === "comparison_visit_sequence_mismatch" && issue.dayIndex === 0,
    ),
    "관광 장소·순서 불일치 issue code가 필요합니다.",
  );
}

function assertDayTripSkipsPointlessDelivery() {
  const returnStop: PlanmeDraftRouteStop = {
    ...origin,
    caption: "여행 종료",
    role: "복귀지",
  };
  const result = normalizePlanmeDraftDomainContract({
    draft: {
      title: "동탄 출발 부산 당일치기",
      region: "부산",
      duration: "당일치기",
      transportMode: "drive",
      days: [
        {
          day: 1,
          label: "1일차",
          standardStops: [origin, gamcheon, returnStop],
          carrymeStops: [origin, gamcheon, returnStop],
          standardTimeline: [
            event("08:00", "동탄호수공원 출발", 0, "arrival"),
            event("12:00", "감천문화마을 관광", 1),
            event("18:00", "동탄호수공원 도착", 2, "arrival"),
          ],
          carrymeTimeline: [
            event("08:00", "동탄호수공원 출발", 0, "arrival"),
            event("12:00", "감천문화마을 관광", 1),
            event("18:00", "동탄호수공원 도착", 2, "arrival"),
          ],
        },
      ],
    },
    durationDays: 1,
    transportMode: "drive",
    origin,
  });

  assert(result.ok, `당일치기 초안이 거부됐습니다: ${result.issues.map((issue) => issue.code).join(",")}`);
  assertEqual(
    result.draft.days[0]?.carrymeTimeline?.filter((item) => item.category === "carryme").length,
    0,
    "당일치기 동일 출발·복귀지 짐 배송 이벤트 수",
  );
}

function assertDurationMismatchFailsClosed() {
  const result = normalizePlanmeDraftDomainContract({
    draft: createDraft(),
    durationDays: 3,
    transportMode: "drive",
    origin,
  });

  assertEqual(result.ok, false, "일수 불일치는 실패해야 합니다");
  assert(
    result.issues.some((issue) => issue.code === "duration_days_mismatch"),
    "일수 불일치 issue code가 필요합니다.",
  );
}

function assertAmbiguousLodgingFailsClosed() {
  const draft = createDraft();
  const otherLodging: PlanmeDraftRouteStop = {
    ...lodging,
    name: "다른 부산 호텔",
    placeId: "places/other-busan-hotel",
    placeSourceRef: "naver:other-busan-hotel",
  };
  const firstDay = draft.days[0];

  assert(firstDay?.carrymeStops !== undefined, "첫날 CarryME 경로가 필요합니다.");
  const ambiguousDraft: PlanmeDraftPreviewRequest = {
    ...draft,
    days: [
      {
        ...firstDay,
        carrymeStops: [firstDay.carrymeStops[0] as PlanmeDraftRouteStop, gamcheon, otherLodging],
      },
      draft.days[1] as PlanmeDraftPreviewRequest["days"][number],
    ],
  };
  const result = normalizePlanmeDraftDomainContract({
    draft: ambiguousDraft,
    durationDays: 2,
    transportMode: "drive",
    origin,
  });

  assertEqual(result.ok, false, "서로 다른 숙소 후보는 실패해야 합니다");
  assert(
    result.issues.some((issue) => issue.code === "ambiguous_day_lodging"),
    "숙소 충돌 issue code가 필요합니다.",
  );
}

function createThreeDayDraft(): PlanmeDraftPreviewRequest {
  const firstDay = createDraft().days[0] as PlanmeDraftPreviewRequest["days"][number];

  return {
    title: "동탄 출발 부산 2박 3일",
    region: "부산",
    duration: "2박 3일",
    transportMode: "drive",
    days: [
      {
        ...firstDay,
        carrymeTimeline: [
          ...(firstDay.carrymeTimeline ?? []),
          event("12:05", "수하물 베이몬드호텔 배송", null, "carryme"),
        ],
      },
      {
        day: 2,
        label: "2일차",
        standardStops: [lodging, secondLodging, haeundae, secondLodging],
        carrymeStops: [
          lodging,
          { ...secondLodging, caption: "짐 배송 도착" },
          haeundae,
          secondLodging,
        ],
        standardTimeline: [
          event("09:00", "베이몬드호텔 출발", 0, "hotel"),
          event("10:30", "부산역 시티호텔 체크인", 1, "hotel"),
          event("12:00", "해운대해수욕장 관광", 2),
          event("18:00", "부산역 시티호텔 복귀", 3, "hotel"),
        ],
        carrymeTimeline: [
          event("09:00", "베이몬드호텔 출발", 0, "hotel"),
          event("10:30", "짐 부산역 시티호텔 도착", 1, "carryme"),
          event("12:00", "해운대해수욕장 관광", 2),
          event("18:00", "부산역 시티호텔 도착", 3, "hotel"),
        ],
      },
      {
        day: 3,
        label: "3일차",
        // The model-authored hotel return is intentionally wrong. The contract must
        // replace it with the original origin while keeping one real visit.
        standardStops: [secondLodging, jagalchi, secondLodging],
        carrymeStops: [secondLodging, jagalchi, secondLodging],
        standardTimeline: [
          event("09:00", "부산역 시티호텔 출발", 0, "hotel"),
          event("12:00", "자갈치시장 관광", 1),
          event("17:00", "부산역 시티호텔 복귀", 2, "hotel"),
        ],
        carrymeTimeline: [
          event("09:00", "부산역 시티호텔 출발", 0, "hotel"),
          event("12:00", "자갈치시장 관광", 1),
          event("17:00", "짐 부산역 시티호텔 도착", 2, "carryme"),
        ],
      },
    ],
  };
}

function assertThreeDayBoundaryAndDeliveryContract() {
  const result = normalizePlanmeDraftDomainContract({
    draft: createThreeDayDraft(),
    durationDays: 3,
    transportMode: "drive",
    origin,
  });

  assert(result.ok, `3일 초안이 거부됐습니다: ${result.issues.map((issue) => issue.code).join(",")}`);
  assertEqual(result.draft.days.length, 3, "3일 일정 일수");

  result.draft.days.forEach((day, dayIndex) => {
    const standardStops = day.standardStops ?? [];
    const carrymeStops = day.carrymeStops ?? [];
    const standardStart = standardStops[0];
    const carrymeStart = carrymeStops[0];
    const standardEnd = standardStops.at(-1);
    const carrymeEnd = carrymeStops.at(-1);

    assert(standardStart !== undefined && carrymeStart !== undefined, "두 경로 출발지가 필요합니다.");
    assert(standardEnd !== undefined && carrymeEnd !== undefined, "두 경로 종료지가 필요합니다.");
    assertEqual(standardStart.placeSourceRef, carrymeStart.placeSourceRef, `${dayIndex + 1}일차 출발지 일치`);
    assertEqual(standardEnd.placeSourceRef, carrymeEnd.placeSourceRef, `${dayIndex + 1}일차 종료지 일치`);
    assert(standardStops.some((stop) => stop.role === "방문지"), `${dayIndex + 1}일차 Standard 방문지`);
    assert(carrymeStops.some((stop) => stop.role === "방문지"), `${dayIndex + 1}일차 CarryME 방문지`);

    if (dayIndex < 2) {
      assertEqual(standardEnd.role, "숙소", `${dayIndex + 1}일차 Standard 숙소 종료`);
      assertEqual(carrymeEnd.role, "숙소", `${dayIndex + 1}일차 CarryME 숙소 종료`);
      const nextDay = result.draft.days[dayIndex + 1];

      assertEqual(nextDay?.standardStops?.[0]?.placeSourceRef, standardEnd.placeSourceRef, "다음날 Standard 숙소 출발");
      assertEqual(nextDay?.carrymeStops?.[0]?.placeSourceRef, standardEnd.placeSourceRef, "다음날 CarryME 숙소 출발");
    } else {
      assertEqual(standardEnd.placeSourceRef, origin.placeSourceRef, "마지막 날 Standard 원출발지 복귀");
      assertEqual(carrymeEnd.placeSourceRef, origin.placeSourceRef, "마지막 날 CarryME 원출발지 복귀");
      assertEqual(standardEnd.role, "복귀지", "마지막 날 Standard 복귀 역할");
      assertEqual(carrymeEnd.role, "복귀지", "마지막 날 CarryME 복귀 역할");
    }

    const deliveries = day.carrymeTimeline?.filter((item) => item.category === "carryme") ?? [];
    assertEqual(deliveries.length, 1, `${dayIndex + 1}일차 배송 이벤트 수`);
    assertEqual(deliveries[0]?.stopIndex, null, `${dayIndex + 1}일차 배송 비경유 계약`);
  });

  const preview = createPlanmeDraftPreview(result.draft);

  assertEqual(preview.status, "preview_ready", "3일 미리보기 상태");
  preview.itinerary.days.forEach((day, dayIndex) => {
    const isFinalDay = dayIndex === preview.itinerary.days.length - 1;
    const targetStop = isFinalDay
      ? day.standard.stops.at(-1)
      : day.standard.stops.find((stop) => stop.role === "숙소");
    const sourceStop = day.standard.stops[0];
    const deliveryEvents = day.carrymeTimeline?.filter(
      (item) => item.eventKind === "luggage_delivery",
    ) ?? [];
    const deliveryEvent = deliveryEvents[0];

    assert(sourceStop !== undefined && targetStop !== undefined, "배송 출발·도착 장소가 필요합니다.");
    assert(deliveryEvent !== undefined, `${dayIndex + 1}일차 표시 모델 배송 이벤트`);
    assertEqual(deliveryEvents.length, 1, `${dayIndex + 1}일차 표시 모델 배송 이벤트 수`);
    assertEqual(deliveryEvent.stopRef, undefined, `${dayIndex + 1}일차 배송은 여행자 경유가 아님`);
    assertEqual(deliveryEvent.deliverySourcePlaceRef, sourceStop.placeRef, `${dayIndex + 1}일차 배송 출발지`);
    assertEqual(deliveryEvent.deliveryTargetPlaceRef, targetStop.placeRef, `${dayIndex + 1}일차 배송 대상`);
    assertEqual(deliveryEvent.deliveryTargetStopRef, targetStop.stopRef, `${dayIndex + 1}일차 배송 대상 방문 참조`);
    assertEqual(deliveryEvent.title, `짐 ${targetStop.label} 도착`, `${dayIndex + 1}일차 배송 문구 대상`);

    const departureEvent = day.carrymeTimeline?.find(
      (item) => item.stopRef === day.carryme.stops[0]?.stopRef,
    );
    const travelerTargetEvent = day.carrymeTimeline?.find(
      (item) => item.stopRef === deliveryEvent.deliveryTargetStopRef,
    );
    const standardTargetEvent = day.standardTimeline?.find(
      (item) => item.stopRef === deliveryEvent.deliveryTargetStopRef,
    );

    assert(departureEvent !== undefined, "CarryME 출발 이벤트가 필요합니다.");
    assert(travelerTargetEvent !== undefined, "CarryME 배송 대상 여행자 도착 이벤트가 필요합니다.");
    assert(standardTargetEvent !== undefined, "Standard 배송 대상 도착 이벤트가 필요합니다.");
    assert(parseMinutes(deliveryEvent.time) > parseMinutes(departureEvent.time), "짐은 출발 이후 도착해야 합니다.");
    assert(parseMinutes(deliveryEvent.time) <= parseMinutes(travelerTargetEvent.time), "짐은 여행자보다 늦을 수 없습니다.");
    assertEqual(deliveryEvent.time, standardTargetEvent.time, "짐은 Standard 대상 도착 시각과 같아야 합니다.");
    assert(
      (day.carrymeTimeline?.indexOf(deliveryEvent) ?? -1) <
        (day.carrymeTimeline?.indexOf(travelerTargetEvent) ?? -1),
      "같은 시각이면 짐 도착을 여행자 도착보다 먼저 표시해야 합니다.",
    );
  });
}

/** Verifies that an unchanged lodging does not create a same-place shipment on the middle day. */
function assertSameLodgingSkipsDuplicateDelivery() {
  const draft = createThreeDayDraft();
  const firstDay = draft.days[0];

  assert(firstDay !== undefined, "첫날 일정이 필요합니다.");
  draft.days = [
    firstDay,
    {
      day: 2,
      label: "2일차",
      standardStops: [lodging, haeundae, lodging],
      carrymeStops: [lodging, haeundae, lodging],
      standardTimeline: [
        event("09:00", "베이몬드호텔 출발", 0, "hotel"),
        event("12:00", "해운대해수욕장 관광", 1),
        event("18:00", "베이몬드호텔 복귀", 2, "hotel"),
      ],
      carrymeTimeline: [
        event("09:00", "베이몬드호텔 출발", 0, "hotel"),
        event("12:00", "해운대해수욕장 관광", 1),
        event("18:00", "베이몬드호텔 복귀", 2, "hotel"),
      ],
    },
    {
      day: 3,
      label: "3일차",
      standardStops: [lodging, jagalchi, lodging],
      carrymeStops: [lodging, jagalchi, lodging],
      standardTimeline: [
        event("09:00", "베이몬드호텔 출발", 0, "hotel"),
        event("12:00", "자갈치시장 관광", 1),
        event("17:00", "베이몬드호텔 복귀", 2, "hotel"),
      ],
      carrymeTimeline: [
        event("09:00", "베이몬드호텔 출발", 0, "hotel"),
        event("12:00", "자갈치시장 관광", 1),
        event("17:00", "베이몬드호텔 복귀", 2, "hotel"),
      ],
    },
  ];

  const result = normalizePlanmeDraftDomainContract({
    draft,
    durationDays: 3,
    transportMode: "drive",
    origin,
  });

  assert(
    result.ok,
    `같은 숙소 연박 초안이 거부됐습니다: ${result.issues.map((issue) => issue.code).join(",")}`,
  );
  const middleDay = result.draft.days[1];

  assert(middleDay?.standardStops !== undefined, "2일차 Standard 경로가 필요합니다.");
  assert(middleDay.carrymeStops !== undefined, "2일차 CarryME 경로가 필요합니다.");
  assertEqual(
    middleDay.standardStops[0]?.placeSourceRef,
    middleDay.standardStops.at(-1)?.placeSourceRef,
    "2일차 Standard 동일 숙소 연박",
  );
  assertEqual(
    middleDay.carrymeStops[0]?.placeSourceRef,
    middleDay.carrymeStops.at(-1)?.placeSourceRef,
    "2일차 CarryME 동일 숙소 연박",
  );
  assertEqual(
    middleDay.carrymeTimeline?.filter((item) => item.category === "carryme").length,
    0,
    "같은 숙소 연박일 배송 이벤트 수",
  );

  const preview = createPlanmeDraftPreview(result.draft);
  const previewMiddleDay = preview.itinerary.days[1];

  assertEqual(preview.status, "preview_ready", "같은 숙소 연박 미리보기 상태");
  assertEqual(
    previewMiddleDay?.carrymeTimeline?.filter(
      (item) => item.eventKind === "luggage_delivery",
    ).length,
    0,
    "같은 숙소 연박 표시 모델 배송 이벤트 수",
  );
}

function assertMissingVisitFailsClosed() {
  const draft = createDraft();
  const firstDay = draft.days[0];

  assert(firstDay !== undefined, "첫날이 필요합니다.");
  firstDay.standardStops = [origin, lodging];
  firstDay.carrymeStops = [origin, lodging];
  firstDay.standardTimeline = [
    event("08:00", "동탄호수공원 출발", 0, "arrival"),
    event("12:00", "베이몬드호텔 도착", 1, "hotel"),
  ];
  firstDay.carrymeTimeline = [
    event("08:00", "동탄호수공원 출발", 0, "arrival"),
    event("12:00", "베이몬드호텔 도착", 1, "hotel"),
  ];

  const result = normalizePlanmeDraftDomainContract({
    draft,
    durationDays: 2,
    transportMode: "drive",
    origin,
  });

  assertEqual(result.ok, false, "방문지 없는 날은 실패해야 합니다.");
  assert(result.issues.some((issue) => issue.code === "missing_day_visit"), "방문지 누락 issue code가 필요합니다.");
}

function assertImpossibleDeliveryTimeFailsClosed() {
  const tooEarly = createDraft();
  const firstStandardTimeline = tooEarly.days[0]?.standardTimeline;

  assert(firstStandardTimeline !== undefined, "첫날 Standard 타임라인이 필요합니다.");
  firstStandardTimeline[1] = event("08:00", "베이몬드호텔 체크인", 1, "hotel");
  const tooEarlyResult = normalizePlanmeDraftDomainContract({
    draft: tooEarly,
    durationDays: 2,
    transportMode: "drive",
    origin,
  });

  assertEqual(tooEarlyResult.ok, false, "출발 이전·동시 짐 도착은 실패해야 합니다.");
  assert(
    tooEarlyResult.issues.some((issue) => issue.code === "carryme_delivery_not_after_departure"),
    "출발 이후 배송 issue code가 필요합니다.",
  );

  const tooLate = createDraft();
  const lateStandardTimeline = tooLate.days[0]?.standardTimeline;

  assert(lateStandardTimeline !== undefined, "첫날 Standard 타임라인이 필요합니다.");
  lateStandardTimeline[1] = event("19:00", "베이몬드호텔 체크인", 1, "hotel");
  const tooLateResult = normalizePlanmeDraftDomainContract({
    draft: tooLate,
    durationDays: 2,
    transportMode: "drive",
    origin,
  });

  assertEqual(tooLateResult.ok, false, "여행자보다 늦은 짐 도착은 실패해야 합니다.");
  assert(
    tooLateResult.issues.some((issue) => issue.code === "carryme_delivery_after_traveler_arrival"),
    "여행자 이전 배송 issue code가 필요합니다.",
  );
}

function createNormalizedDraftForValidation() {
  const result = normalizePlanmeDraftDomainContract({
    draft: createDraft(),
    durationDays: 2,
    transportMode: "drive",
    origin,
  });

  assert(result.ok, `검증용 정상 초안이 거부됐습니다: ${result.issues.map((issue) => issue.code).join(",")}`);
  return result.draft;
}

function assertTimelineStayOverlapFailsClosed() {
  const draft = createNormalizedDraftForValidation();
  const eventWithOverlongStay = draft.days[0]?.standardTimeline?.[2];

  assert(eventWithOverlongStay !== undefined, "겹침 검증용 Standard 이벤트가 필요합니다.");
  eventWithOverlongStay.stayDurationMinutes = 300;

  const issues = validatePlanmeDraftDomainContract({
    draft,
    durationDays: 2,
    transportMode: "drive",
    origin,
  });

  assert(
    issues.some(
      (issue) =>
        issue.code === "timeline_stay_overlap" &&
        issue.route === "standard" &&
        issue.dayIndex === 0 &&
        issue.eventIndex === 2,
    ),
    "다음 여행자 도착 시각을 넘는 체류는 거부해야 합니다.",
  );
}

function assertCarrymeDeliveryIsExcludedFromStayOverlap() {
  const draft = createNormalizedDraftForValidation();
  const carrymeTimeline = draft.days[0]?.carrymeTimeline;

  assert(carrymeTimeline !== undefined, "CarryME 타임라인이 필요합니다.");
  const departureEvent = carrymeTimeline.find((item) => item.stopIndex === 0);
  const deliveryEvent = carrymeTimeline.find((item) => item.category === "carryme");

  assert(departureEvent !== undefined, "CarryME 출발 이벤트가 필요합니다.");
  assert(deliveryEvent !== undefined, "CarryME 배송 이벤트가 필요합니다.");
  departureEvent.stayDurationMinutes = 360;
  deliveryEvent.stayDurationMinutes = 600;

  const issues = validatePlanmeDraftDomainContract({
    draft,
    durationDays: 2,
    transportMode: "drive",
    origin,
  });

  assertEqual(
    issues.filter((issue) => issue.code === "timeline_stay_overlap").length,
    0,
    "배송 이벤트는 여행자 체류 겹침 판정에서 제외해야 합니다",
  );
}

function assertCarrymeDeliveryStillRequiresChronologicalOrder() {
  const draft = createNormalizedDraftForValidation();
  const deliveryEvent = draft.days[0]?.carrymeTimeline?.find(
    (item) => item.category === "carryme",
  );

  assert(deliveryEvent !== undefined, "CarryME 배송 이벤트가 필요합니다.");
  deliveryEvent.time = "07:59";

  const issues = validatePlanmeDraftDomainContract({
    draft,
    durationDays: 2,
    transportMode: "drive",
    origin,
  });

  assert(
    issues.some(
      (issue) => issue.code === "timeline_order_invalid" && issue.route === "carryme",
    ),
    "배송 이벤트도 전체 타임라인 시간순 검증에는 포함해야 합니다.",
  );
}

function parseMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);

  return (hours ?? 0) * 60 + (minutes ?? 0);
}

assertNormalizationContract();
assertVisitSequenceMismatchFailsClosed();
assertDayTripSkipsPointlessDelivery();
assertDurationMismatchFailsClosed();
assertAmbiguousLodgingFailsClosed();
assertThreeDayBoundaryAndDeliveryContract();
assertSameLodgingSkipsDuplicateDelivery();
assertMissingVisitFailsClosed();
assertImpossibleDeliveryTimeFailsClosed();
assertTimelineStayOverlapFailsClosed();
assertCarrymeDeliveryIsExcludedFromStayOverlap();
assertCarrymeDeliveryStillRequiresChronologicalOrder();

console.log("PlanME itinerary domain contract checks passed.");
