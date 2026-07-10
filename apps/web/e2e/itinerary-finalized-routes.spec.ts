import { expect, test } from "@playwright/test";
import type { PlanmeItinerary } from "@planme/core";
import { savePreviewItinerary } from "../lib/preview-itinerary-store";

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

  const totalDurationCard = page.getByText("총 이동 시간", { exact: true }).locator("..");
  const initialDurationText = await totalDurationCard.innerText();

  await page.waitForTimeout(3_500);
  expect(await totalDurationCard.innerText()).toBe(initialDurationText);

  await page.getByRole("button", { name: "2일차" }).click();
  await page.getByRole("button", { name: "1일차" }).click();
  await page.getByRole("button", { name: "2일차" }).click();

  expect(browserProviderRequests).toEqual([]);
  await expect(page.getByText("계산 중")).toHaveCount(0);

  const editResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/routes/finalize") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "경로 다시 계산" }).click();
  const editResponse = await editResponsePromise;
  expect(editResponse.ok(), await editResponse.text()).toBeTruthy();
  await expect(page.getByText("변경한 일정과 경로를 저장했습니다.")).toBeVisible();
  expect(browserProviderRequests).toEqual([]);
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
  await expect(page.getByText("동탄역", { exact: true }).first()).toBeVisible();
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
