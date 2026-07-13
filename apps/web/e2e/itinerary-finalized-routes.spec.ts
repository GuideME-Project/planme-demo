import { expect, test } from "@playwright/test";
import type { MapCoordinate, PlanmeItinerary, PlanmeTransportMode } from "@planme/core";
import { validateEditedItineraryPlaces } from "../lib/edited-itinerary-validator";
import { finalizeItineraryRoutes } from "../lib/itinerary-route-finalizer";
import {
  saveFinalizedPreviewItinerary,
  savePreviewItinerary,
} from "../lib/preview-itinerary-store";
import { createRouteFinalizationToken } from "../lib/route-finalization-token";
import type {
  RouteProviderResult,
  RouteProviderStop,
} from "../lib/route-providers/types";

test("shows one stored provider result without recalculating on load or day changes", async ({
  page,
  request,
}) => {
  const itinerary = createTwoDayDriveItinerary(`generated-finalized-e2e-${Date.now()}`);
  const timelineBefore = JSON.stringify(
    itinerary.days.map((day) => ({
      carrymeTimeline: day.carrymeTimeline,
      standardTimeline: day.standardTimeline,
      timeline: day.timeline,
    })),
  );
  const storeResponse = await request.post("/api/gpt/itineraries/preview-store", {
    data: { itinerary },
    headers: {
      Authorization: `Bearer ${process.env.PLANME_INTERNAL_API_TOKEN}`,
    },
  });

  expect(storeResponse.ok()).toBeTruthy();
  const stored = await storeResponse.json();

  expect(stored.status).toBe("ready");
  expect(stored.revision).toBe(1);
  expect(
    JSON.stringify(
      stored.itinerary.days.map((day: (typeof itinerary.days)[number]) => ({
        carrymeTimeline: day.carrymeTimeline,
        standardTimeline: day.standardTimeline,
        timeline: day.timeline,
      })),
    ),
  ).toBe(timelineBefore);
  expect(stored.itinerary.days[0].standard.geoPath).toBeUndefined();
  expect(stored.itinerary.days[0].standard.geoSegments.length).toBeGreaterThan(0);
  const oneNightTwoDayBytes = Buffer.byteLength(JSON.stringify(stored.itinerary));
  const twoNightThreeDayBytes = Buffer.byteLength(
    JSON.stringify({
      ...stored.itinerary,
      days: [
        ...stored.itinerary.days,
        { ...stored.itinerary.days[1], day: 3, label: "Day 3" },
      ],
    }),
  );

  console.log(
    `FINALIZED_PAYLOAD_BYTES oneNightTwoDay=${oneNightTwoDayBytes} twoNightThreeDay=${twoNightThreeDayBytes}`,
  );
  expect(oneNightTwoDayBytes).toBeLessThan(1_000_000);
  expect(twoNightThreeDayBytes).toBeLessThan(1_000_000);

  const browserProviderRequests: string[] = [];
  page.on("request", (browserRequest) => {
    const url = browserRequest.url();

    if (url.includes("/api/naver/directions/routes") || url.includes("api.odsay.com")) {
      browserProviderRequests.push(url);
    }
  });

  const pageUrl = new URL(stored.pageUrl);
  await page.goto(pageUrl.pathname);

  const ogImageUrl = await page
    .locator('meta[property="og:image"]')
    .getAttribute("content");
  expect(ogImageUrl).toContain(
    `/og/itinerary/${encodeURIComponent(itinerary.id)}.png`,
  );
  const ogResponse = await request.get(ogImageUrl!);
  expect(ogResponse.ok()).toBeTruthy();
  expect(ogResponse.headers()["content-type"]).toContain("image/png");

  const totalDurationCard = page.getByText("총 이동 시간", { exact: true }).locator("..");
  const initialDurationText = await totalDurationCard.innerText();
  expect(initialDurationText).toContain(stored.itinerary.totalDurationLabel);

  await page.waitForTimeout(3_500);
  expect(await totalDurationCard.innerText()).toBe(initialDurationText);

  await page.getByRole("button", { name: "2일차" }).click();
  await page.getByRole("button", { name: "1일차" }).click();
  await page.getByRole("button", { name: "2일차" }).click();

  expect(await totalDurationCard.innerText()).toBe(initialDurationText);
  expect(browserProviderRequests).toEqual([]);
  await expect(page.getByText("계산 중")).toHaveCount(0);
});

test("keeps a legacy draft visible while server finalization replaces only route fields", async ({
  page,
  request,
}) => {
  const itinerary = createTwoDayDriveItinerary(`generated-legacy-e2e-${Date.now()}`);
  const timelineBefore = JSON.stringify(
    itinerary.days.map((day) => ({
      carrymeTimeline: day.carrymeTimeline,
      standardTimeline: day.standardTimeline,
      timeline: day.timeline,
    })),
  );

  await savePreviewItinerary(itinerary);
  await page.route("**/routes/finalize", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });

  const browserProviderRequests: string[] = [];
  page.on("request", (browserRequest) => {
    const url = browserRequest.url();

    if (url.includes("/api/naver/directions/routes") || url.includes("api.odsay.com")) {
      browserProviderRequests.push(url);
    }
  });

  await page.goto(`/itinerary/${itinerary.id}`);

  await expect(page.getByText("계산 중").first()).toBeVisible();
  await expect(page.getByText("1일차 동탄역 출발").first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: "출발지 행선지" })).toHaveValue(
    "동탄역",
  );
  await expect(page.getByText("계산 중")).toHaveCount(0, { timeout: 15_000 });

  const storedResponse = await request.get(
    `/api/gpt/itineraries/${encodeURIComponent(itinerary.id)}`,
  );
  expect(storedResponse.ok()).toBeTruthy();
  const stored = await storedResponse.json();

  expect(stored.status).toBe("ready");
  expect(stored.revision).toBe(1);
  expect(
    JSON.stringify(
      stored.itinerary.days.map((day: (typeof itinerary.days)[number]) => ({
        carrymeTimeline: day.carrymeTimeline,
        standardTimeline: day.standardTimeline,
        timeline: day.timeline,
      })),
    ),
  ).toBe(timelineBefore);
  expect(browserProviderRequests).toEqual([]);
});

for (const [initialMode, nextMode] of [
  ["drive", "transit"],
  ["transit", "drive"],
] as const) {
  test(`atomically persists stable contracts and ${initialMode} to ${nextMode} timeline copy`, async ({
    page,
    request,
  }) => {
    const itinerary = createStableRecalculationItinerary(
      `generated-recalculation-${initialMode}-${nextMode}-${Date.now()}`,
      initialMode,
    );
    const initialSave = await saveFinalizedPreviewItinerary(itinerary, 0);

    expect(initialSave?.revision).toBe(1);
    let submittedCandidate: PlanmeItinerary | undefined;

    await page.route("**/routes/finalize", async (route) => {
      const body = route.request().postDataJSON() as {
        baseRevision: number;
        itinerary: PlanmeItinerary;
      };

      submittedCandidate = body.itinerary;
      expect(body.itinerary.transportMode).toBe(nextMode);
      expect(
        body.itinerary.days[0].carryme.stops.map(toStableStopContract),
      ).toEqual(itinerary.days[0].carryme.stops.map(toStableStopContract));

      const validated = await validateEditedItineraryPlaces(
        body.itinerary,
        itinerary,
        new AbortController().signal,
      );
      const finalized = await finalizeItineraryRoutes(
        validated,
        nextMode === "drive"
          ? {
              computeDriveRoute: async (stops) =>
                createDeterministicProviderResult(stops, "drive"),
            }
          : {
              computeTransitRoute: async (stops) =>
                createDeterministicProviderResult(stops, "transit"),
            },
      );
      const saved = await saveFinalizedPreviewItinerary(
        finalized,
        body.baseRevision,
      );

      expect(saved).not.toBeNull();
      await route.fulfill({
        body: JSON.stringify({
          itinerary: finalized,
          revision: saved!.revision,
          status: "ready",
          token: createRouteFinalizationToken(finalized.id, saved!.revision),
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto(`/itinerary/${itinerary.id}`);
    const transportSelect = page
      .getByTestId("itinerary-transport-mode")
      .getByRole("combobox");
    const nextModeLabel = nextMode === "drive" ? "자동차" : "대중교통";
    const oldModePattern = initialMode === "drive" ? /차량 경로/ : /대중교통 경로/;

    await transportSelect.click();
    await page.getByRole("option", { name: nextModeLabel }).click();
    await page.getByRole("button", { name: "경로 다시 계산" }).click();
    await expect(page.getByText("변경한 일정과 경로를 저장했습니다.")).toBeVisible();

    expect(submittedCandidate).toBeDefined();
    await expect(
      page.getByText(`${nextModeLabel} 경로로 이동을 시작합니다.`).first(),
    ).toBeVisible();
    await expect(
      page.locator(`[data-event-category="${nextMode}"]`).first(),
    ).toBeVisible();
    await expect(page.getByText(oldModePattern)).toHaveCount(0);

    await page.reload();
    await expect(
      page.getByTestId("itinerary-transport-mode").locator("input"),
    ).toHaveValue(nextMode);
    await expect(
      page.getByText(`${nextModeLabel} 경로로 이동을 시작합니다.`).first(),
    ).toBeVisible();
    await expect(
      page.locator(`[data-event-category="${nextMode}"]`).first(),
    ).toBeVisible();

    const persistedResponse = await request.get(
      `/api/gpt/itineraries/${encodeURIComponent(itinerary.id)}`,
    );
    expect(persistedResponse.ok()).toBeTruthy();
    const persisted = await persistedResponse.json();
    const persistedItinerary = persisted.itinerary as PlanmeItinerary;
    const persistedDelivery = persistedItinerary.days[0].timeline.find(
      (event) => event.eventKind === "luggage_delivery",
    );

    expect(persistedItinerary.transportMode).toBe(nextMode);
    expect(
      persistedItinerary.days[0].carryme.stops.map(toStableStopContract),
    ).toEqual(itinerary.days[0].carryme.stops.map(toStableStopContract));
    expect(persistedItinerary.days[0].timeline).toEqual(
      [...persistedItinerary.days[0].timeline].sort(
        (left, right) => left.time.localeCompare(right.time),
      ),
    );
    expect(persistedDelivery).toMatchObject({
      deliverySourcePlaceRef: "day-1-hotel",
      deliveryTargetPlaceRef: "day-1-origin",
      deliveryTargetStopRef: "day-1-stop-3",
    });
    expect(
      persistedItinerary.days[0].timeline
        .filter((event) => event.stopRef && event.category === nextMode)
        .every((event) => event.movementMode === nextMode),
    ).toBeTruthy();
  });
}

function createTwoDayDriveItinerary(id: string): PlanmeItinerary {
  const createRoute = (
    routeId: "standard" | "carryme",
    day: number,
    destinationOffset: number,
  ) => ({
    id: routeId,
    label: routeId === "standard" ? "Standard" : "CarryME",
    badge: routeId === "standard" ? "Standard" : "CarryME",
    routeText: `동탄역 → 테스트 방문지 ${day}-${destinationOffset}`,
    description:
      routeId === "standard"
        ? "짐을 직접 들고 이동하는 일반 동선"
        : "짐은 CarryME가 이동하고 여행자는 바로 이동",
    durationLabel: "AI 예상값",
    durationMinutes: 999,
    stops: [
      {
        label: "동탄역",
        caption: "출발",
        coordinate: { lat: 37.2002, lng: 127.095 },
        icon: "station" as const,
        mode: "drive" as const,
        placeSource: "naver_local" as const,
        placeSourceRef: "naver:동탄역",
        role: "출발지" as const,
      },
      {
        label: `테스트 방문지 ${day}-${destinationOffset}`,
        caption: "방문",
        coordinate: {
          lat: 37.205 + day * 0.003 + destinationOffset * 0.002,
          lng: 127.1 + day * 0.003 + destinationOffset * 0.002,
        },
        icon: "attraction" as const,
        mode: "drive" as const,
        placeSource: "naver_local" as const,
        placeSourceRef: `naver:test-${day}-${destinationOffset}`,
        role: "방문지" as const,
      },
    ],
    mapPath: [],
  });

  const days = [1, 2].map((day) => ({
    day,
    label: `Day ${day}`,
    savingMinutes: 0,
    standard: createRoute("standard", day, 0),
    carryme: createRoute("carryme", day, 1),
    timeline: [
      {
        time: "10:00",
        title: `${day}일차 동탄역 출발`,
        description: "AI가 정한 시간표를 유지합니다.",
        category: "arrival" as const,
      },
      {
        time: "11:00",
        title: `${day}일차 방문지 도착`,
        description: "길찾기는 방문 시각을 변경하지 않습니다.",
        category: "event" as const,
      },
    ],
  }));

  return {
    id,
    title: "PlanME 최종 경로 E2E 일정",
    region: "동탄",
    duration: "1박 2일",
    summary: "저장된 최종 경로를 한 번만 표시합니다.",
    detailUrl: `/itinerary/${id}`,
    carrymeSaving: "AI 예상값",
    totalDurationLabel: "AI 예상값",
    savedDurationLabel: "AI 예상값",
    transportMode: "drive" as const,
    days,
    benefits: [
      { title: "안전한 짐 배송", description: "테스트", icon: "shield" as const },
      { title: "시간 절약", description: "테스트", icon: "time" as const },
      { title: "가벼운 여행", description: "테스트", icon: "luggage" as const },
      { title: "실시간 알림", description: "테스트", icon: "phone" as const },
    ],
  };
}

/** Creates a finalized one-day record with stable visit and luggage-delivery references. */
function createStableRecalculationItinerary(
  id: string,
  transportMode: PlanmeTransportMode,
): PlanmeItinerary {
  const modeLabel = transportMode === "drive" ? "차량" : "대중교통";
  const createStops = () => [
    {
      label: "베이몬드호텔 해운대",
      caption: "출발",
      coordinate: { lat: 35.16, lng: 129.16 },
      icon: "hotel" as const,
      mode: transportMode,
      placeConstraint: "fixed" as const,
      placeRef: "day-1-hotel",
      placeSource: "naver_local" as const,
      placeSourceRef: "naver:baymond-hotel-haeundae",
      role: "숙소" as const,
      stopRef: "day-1-stop-1",
    },
    {
      label: "감천문화마을",
      caption: "관광",
      coordinate: { lat: 35.097, lng: 129.011 },
      icon: "attraction" as const,
      mode: transportMode,
      placeConstraint: "replaceable" as const,
      placeRef: "day-1-visit",
      placeSource: "naver_local" as const,
      placeSourceRef: "naver:gamcheon-culture-village",
      role: "방문지" as const,
      stopRef: "day-1-stop-2",
    },
    {
      label: "동탄호수공원",
      caption: "여행 종료",
      coordinate: { lat: 37.172, lng: 127.106 },
      icon: "station" as const,
      mode: transportMode,
      placeConstraint: "fixed" as const,
      placeRef: "day-1-origin",
      placeSource: "input" as const,
      placeSourceRef: "input:origin:dongtan-lake-park",
      role: "복귀지" as const,
      stopRef: "day-1-stop-3",
    },
  ];
  const createRoute = (routeId: "standard" | "carryme") => ({
    id: routeId,
    label: routeId === "standard" ? "Standard" : "CarryME",
    badge: routeId === "standard" ? "Standard" : "CarryME",
    routeText: "베이몬드호텔 해운대 → 감천문화마을 → 동탄호수공원",
    description:
      routeId === "standard"
        ? "짐을 직접 들고 이동하는 일반 동선"
        : "짐은 CarryME가 이동하고 여행자는 바로 이동",
    durationLabel: "약 40분",
    durationMinutes: 40,
    durationSource: "provider" as const,
    stops: createStops(),
    geoSegments: [
      [
        { lat: 35.16, lng: 129.16 },
        { lat: 35.13, lng: 129.08 },
        { lat: 35.097, lng: 129.011 },
      ],
    ],
    mapPath: [],
  });
  const standardTimeline = [
    {
      time: "08:00",
      title: "베이몬드호텔 해운대 출발",
      description: `${modeLabel} 경로로 이동을 시작합니다.`,
      category: transportMode,
      eventKind: "traveler_stop" as const,
      movementMode: transportMode,
      stayDurationMinutes: 0,
      stopRef: "day-1-stop-1",
    },
    {
      time: "10:00",
      title: "감천문화마을 관광",
      description: "문화마을을 둘러봅니다.",
      category: "event" as const,
      eventKind: "traveler_stop" as const,
      movementMode: transportMode,
      stayDurationMinutes: 60,
      stopRef: "day-1-stop-2",
    },
    {
      time: "18:00",
      title: "동탄호수공원 도착",
      description: `${modeLabel} 경로로 동탄호수공원에 도착합니다.`,
      category: transportMode,
      eventKind: "traveler_stop" as const,
      movementMode: transportMode,
      stayDurationMinutes: 0,
      stopRef: "day-1-stop-3",
    },
  ];
  const deliveryEvent = {
    time: "17:50",
    title: "짐 동탄호수공원 도착",
    description: "짐은 여행자보다 먼저 원출발지에 도착합니다.",
    category: "carryme" as const,
    deliverySourcePlaceRef: "day-1-hotel",
    deliveryTargetPlaceRef: "day-1-origin",
    deliveryTargetStopRef: "day-1-stop-3",
    eventKind: "luggage_delivery" as const,
    stayDurationMinutes: 0,
  };
  const carrymeTimeline = [
    structuredClone(standardTimeline[0]),
    structuredClone(standardTimeline[1]),
    deliveryEvent,
    structuredClone(standardTimeline[2]),
  ];

  return {
    id,
    title: "PlanME 반대 이동수단 재계산 일정",
    region: "부산",
    duration: "당일",
    summary: "안정 참조와 이동수단 문구를 원자적으로 저장합니다.",
    detailUrl: `/itinerary/${id}`,
    carrymeSaving: "시간 절약 없음",
    totalDurationLabel: "약 40분 → 약 40분",
    savedDurationLabel: "시간 절약 없음",
    transportMode,
    days: [
      {
        day: 1,
        label: "Day 1",
        savingMinutes: 0,
        savingStatus: "verified",
        standard: createRoute("standard"),
        carryme: createRoute("carryme"),
        standardTimeline,
        carrymeTimeline,
        timeline: structuredClone(carrymeTimeline),
      },
    ],
    benefits: [],
  };
}

function toStableStopContract(stop: PlanmeItinerary["days"][number]["carryme"]["stops"][number]) {
  return {
    placeConstraint: stop.placeConstraint,
    placeRef: stop.placeRef,
    stopRef: stop.stopRef,
  };
}

/** Produces one provider segment per adjacent stop without external network calls. */
function createDeterministicProviderResult(
  stops: RouteProviderStop[],
  mode: PlanmeTransportMode,
): RouteProviderResult {
  const segments = stops.slice(1).map((destination, index) => {
    const origin = stops[index];
    const originCoordinate = origin.coordinate as MapCoordinate;
    const destinationCoordinate = destination.coordinate as MapCoordinate;
    const midpoint = {
      lat: (originCoordinate.lat + destinationCoordinate.lat) / 2,
      lng: (originCoordinate.lng + destinationCoordinate.lng) / 2,
    };

    return {
      distanceMeters: 1_000,
      durationSeconds: 600,
      durationSource: "provider" as const,
      geometryStatus: "complete" as const,
      mode,
      paths: [[originCoordinate, midpoint, destinationCoordinate]],
    };
  });

  return {
    geometryStatus: "complete",
    segments,
    totalDistanceMeters: segments.length * 1_000,
    totalDurationSeconds: segments.length * 600,
    transitMarkers: [],
  };
}
