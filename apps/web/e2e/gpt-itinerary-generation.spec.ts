import { expect, test } from "@playwright/test";

test("does not expose a web GPT itinerary POST generator", async ({
  request,
}) => {
  const response = await request.post("/api/gpt/itineraries/recommend", {
    data: {
      destination: "여수",
      durationDays: 2,
      preferences: ["가족 여행"],
    },
  });

  expect(response.status()).toBe(405);
  await expect(response).not.toBeOK();
});

test("keeps legacy plan route read-only without a POST generator", async ({
  request,
}) => {
  const response = await request.post("/api/plan", {
    data: {
      destination: "남해",
      days: 2,
      preferences: ["아이 동반"],
    },
  });

  expect(response.status()).toBe(405);
  await expect(response).not.toBeOK();
});

test("does not expose web generation operations in OpenAPI schemas", async ({
  request,
}) => {
  const gptOpenApiResponse = await request.get("/api/gpt/openapi");
  const legacyOpenApiResponse = await request.get("/api/openapi");
  const gptOpenApi = await gptOpenApiResponse.json();
  const legacyOpenApi = await legacyOpenApiResponse.json();

  expect(gptOpenApi.paths).not.toHaveProperty("/api/gpt/itineraries/recommend");
  expect(gptOpenApi.paths).toHaveProperty("/api/gpt/itineraries/{itineraryId}");
  expect(legacyOpenApi.paths).not.toHaveProperty("/api/plan");
});

test("rejects preview finalization without the internal bearer token", async ({
  request,
}) => {
  const response = await request.post("/api/gpt/itineraries/preview-store", {
    data: { itinerary: {} },
  });

  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: "UNAUTHORIZED_INTERNAL_REQUEST" });
});

test("rejects browser route finalization with an invalid revision token", async ({
  request,
}) => {
  const response = await request.post(
    "/api/gpt/itineraries/generated-invalid-token/routes/finalize",
    {
      data: { baseRevision: 0, token: "invalid-token" },
    },
  );

  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: "INVALID_FINALIZATION_TOKEN" });
});

test("keeps an existing finalized link immutable when the same generated id is handed off again", async ({
  request,
}) => {
  const id = `generated-e2e-idempotent-${Date.now()}`;
  const initial = createStoredGeneratedItinerary(id);
  const firstResponse = await request.post("/api/gpt/itineraries/preview-store", {
    data: { itinerary: initial },
    headers: {
      Authorization: `Bearer ${process.env.PLANME_INTERNAL_API_TOKEN}`,
    },
  });

  expect(firstResponse.ok()).toBeTruthy();
  const first = await firstResponse.json();
  expect(first.revision).toBe(1);

  const replayedDraft = {
    ...initial,
    title: "나중 생성이 기존 링크를 덮어쓰면 안 되는 일정",
    summary: "기존 일정과 의도적으로 다른 재전송 payload",
  };
  const secondResponse = await request.post("/api/gpt/itineraries/preview-store", {
    data: { itinerary: replayedDraft },
    headers: {
      Authorization: `Bearer ${process.env.PLANME_INTERNAL_API_TOKEN}`,
    },
  });

  expect(secondResponse.ok()).toBeTruthy();
  const second = await secondResponse.json();
  expect(second.revision).toBe(first.revision);
  expect(second.expiresAt).toBe(first.expiresAt);
  expect(second.itinerary).toEqual(first.itinerary);
  expect(second.itinerary.title).toBe(initial.title);

  const storedResponse = await request.get(
    `/api/gpt/itineraries/${encodeURIComponent(id)}`,
  );
  expect(storedResponse.ok()).toBeTruthy();
  const stored = await storedResponse.json();
  expect(stored.revision).toBe(first.revision);
  expect(stored.itinerary.title).toBe(first.itinerary.title);
  expect(stored.itinerary.summary).toBe(first.itinerary.summary);
  expect(stored.itinerary.days).toEqual(first.itinerary.days);
});

test("opens a stored generated itinerary without needing a web OpenAI key", async ({
  page,
  request,
}) => {
  const itinerary = createStoredGeneratedItinerary("generated-e2e-mcp-only-stored");
  const storeResponse = await request.post("/api/gpt/itineraries/preview-store", {
    data: { itinerary },
    headers: {
      Authorization: `Bearer ${process.env.PLANME_INTERNAL_API_TOKEN}`,
    },
  });

  expect(storeResponse.ok()).toBeTruthy();

  const stored = await storeResponse.json();
  const pageUrl = new URL(stored.pageUrl);

  await page.goto(`${pageUrl.pathname}${pageUrl.search}`);

  await expect(
    page.getByRole("heading", { name: "여수 MCP 저장 테스트 일정" }),
  ).toBeVisible();
  await expect(
    page.getByText("MCP 서버가 저장한 generated 상세 일정 렌더링을 검증합니다.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByText("여수 MCP 저장 테스트 코스").first()).toBeVisible();
  await expect(page.getByText("방문지").first()).toBeVisible();
  await expect(page.getByText("숙소").first()).toBeVisible();
  await expect(page.getByText("도보")).not.toBeVisible();
  await expect(page.getByText("짐 숙소 도착").first()).toBeVisible();
});

test("uses only the current itinerary stops in the static map fallback", async ({
  page,
  request,
}) => {
  await page.route("https://oapi.map.naver.com/**", (route) => route.abort());

  const itinerary = createStoredGeneratedItinerary(
    `generated-e2e-map-fallback-${Date.now()}`,
  );
  const firstDay = itinerary.days[0];
  const standardHotel = firstDay.standard.stops[1];

  firstDay.standard.stops = [
    ...firstDay.standard.stops,
    { ...standardHotel, caption: "일정 종료 후 복귀" },
  ];
  const storeResponse = await request.post("/api/gpt/itineraries/preview-store", {
    data: { itinerary },
    headers: {
      Authorization: `Bearer ${process.env.PLANME_INTERNAL_API_TOKEN}`,
    },
  });

  expect(storeResponse.ok()).toBeTruthy();
  const stored = await storeResponse.json();
  const pageUrl = new URL(stored.pageUrl);

  await page.goto(`${pageUrl.pathname}${pageUrl.search}`);

  const fallbackMarkers = page.getByTestId("route-map-fallback-marker");

  await expect(fallbackMarkers).toHaveCount(4);
  await expect(fallbackMarkers.getByText("서울역", { exact: true })).toBeVisible();
  await expect(fallbackMarkers.getByText("여수 숙소", { exact: true })).toHaveCount(2);
  await expect(
    fallbackMarkers.getByText("여수 MCP 저장 테스트 코스", { exact: true }),
  ).toBeVisible();
  expect(
    await fallbackMarkers.evaluateAll((markers) =>
      markers.map((marker) => marker.querySelector("p")?.textContent),
    ),
  ).toEqual(["서울역", "여수 숙소", "여수 MCP 저장 테스트 코스", "여수 숙소"]);
  await expect(fallbackMarkers.nth(3)).toHaveAttribute(
    "aria-label",
    "4번 경유지 여수 숙소 일정 종료 후 복귀",
  );
  await expect(fallbackMarkers.getByText("인천공항", { exact: true })).toHaveCount(0);
  await expect(fallbackMarkers.getByText("BTS 공연 관람", { exact: true })).toHaveCount(0);
});

test("separates the zero-saving metric from the CarryME benefit copy", async ({
  page,
  request,
}) => {
  const itinerary = createStoredGeneratedItinerary(
    `generated-e2e-zero-saving-copy-${Date.now()}`,
  );
  const firstDay = itinerary.days[0];

  firstDay.standard = {
    ...firstDay.standard,
    durationMinutes: firstDay.carryme.durationMinutes,
    durationLabel: firstDay.carryme.durationLabel,
    geoPath: firstDay.carryme.geoPath,
    mapPath: firstDay.carryme.mapPath,
    routeText: firstDay.carryme.routeText,
    stops: firstDay.carryme.stops,
  };

  const storeResponse = await request.post("/api/gpt/itineraries/preview-store", {
    data: { itinerary },
    headers: {
      Authorization: `Bearer ${process.env.PLANME_INTERNAL_API_TOKEN}`,
    },
  });

  expect(storeResponse.ok()).toBeTruthy();
  const stored = await storeResponse.json();
  const pageUrl = new URL(stored.pageUrl);

  await page.goto(`${pageUrl.pathname}${pageUrl.search}`);

  await expect(page.getByText("시간 절약 없음", { exact: true })).toBeVisible();
  await expect(page.getByTestId("carryme-duration-saving-chip")).toHaveText(
    "짐 없이 바로 이동 가능!",
  );
  await expect(
    page.getByText("시간 절약 없음 · 짐 없이 바로 이동", { exact: true }),
  ).toHaveCount(0);
});

test("separates Standard check-in from CarryME delivery and removes row emphasis", async ({
  page,
  request,
}) => {
  const itinerary = createTimelineDisplayItinerary(
    `generated-e2e-timeline-display-${Date.now()}`,
  );
  const storeResponse = await request.post("/api/gpt/itineraries/preview-store", {
    data: { itinerary },
    headers: {
      Authorization: `Bearer ${process.env.PLANME_INTERNAL_API_TOKEN}`,
    },
  });

  expect(storeResponse.ok()).toBeTruthy();
  const stored = await storeResponse.json();
  const pageUrl = new URL(stored.pageUrl);

  await page.goto(`${pageUrl.pathname}${pageUrl.search}`);

  for (const dayLabel of ["1일차", "2일차"]) {
    await page.getByRole("button", { name: dayLabel }).click();

    const standardColumn = page.getByTestId("timeline-column-standard");
    const carrymeColumn = page.getByTestId("timeline-column-carryme");
    const rowContents = page.getByTestId("timeline-event-content");
    const deliveryIcon = carrymeColumn.locator('[data-delivery-event="true"]');

    await expect(standardColumn.getByText("짐 여수 숙소 도착", { exact: true })).toHaveCount(0);
    await expect(standardColumn.getByText("여수 숙소 체크인", { exact: true })).toBeVisible();
    await expect(
      standardColumn.getByText("호텔에 체크인한 뒤 다음 일정으로 이동합니다.", {
        exact: true,
      }),
    ).toBeVisible();
    if (dayLabel === "1일차") {
      await expect(standardColumn.getByText("여수 숙소 복귀", { exact: true })).toBeVisible();
      await expect(carrymeColumn.getByText("여수 숙소 도착", { exact: true })).toBeVisible();
    } else {
      await expect(standardColumn.getByText("여수 숙소 복귀", { exact: true })).toHaveCount(0);
      await expect(carrymeColumn.getByText("여수 숙소 도착", { exact: true })).toHaveCount(0);
    }
    await expect(carrymeColumn.getByText("짐 여수 숙소 도착", { exact: true })).toBeVisible();
    await expect(deliveryIcon).toHaveCount(1);
    await expect(deliveryIcon.getByTestId("LocalShippingRoundedIcon")).toBeVisible();
    expect(await deliveryIcon.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe(
      "none",
    );
    await expect(rowContents.filter({ hasText: "약 40분 절약" })).toHaveCount(0);
    await expect(standardColumn.getByTestId("CheckRoundedIcon")).toHaveCount(0);
    await expect(carrymeColumn.getByTestId("CheckRoundedIcon")).toHaveCount(0);
    await expect(carrymeColumn.getByTestId("carryme-duration-saving-chip")).toBeVisible();
    await expect(
      page.getByTestId("destination-editor").getByText("자동차", { exact: true }),
    ).toHaveCount(1);

    const rowCount = await rowContents.count();
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      await expect(rowContents.nth(rowIndex)).toHaveCSS(
        "background-color",
        "rgba(0, 0, 0, 0)",
      );
      await expect(rowContents.nth(rowIndex)).toHaveCSS("border-top-width", "0px");
    }
  }

  await page.getByRole("button", { name: "테마 버전 Light" }).click();
  await expect(page.getByRole("button", { name: "테마 버전 Dark" })).toBeVisible();

  const darkRowContents = page.getByTestId("timeline-event-content");
  const darkRowCount = await darkRowContents.count();
  for (let rowIndex = 0; rowIndex < darkRowCount; rowIndex += 1) {
    await expect(darkRowContents.nth(rowIndex)).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(darkRowContents.nth(rowIndex)).toHaveCSS("border-top-width", "0px");
  }
});

test("does not fall back to demo data for missing generated itinerary ids", async ({
  page,
}) => {
  const response = await page.goto("/itinerary/generated-e2e-missing-mcp-only");

  expect(response?.status()).toBe(404);
  await expect(page.getByText("인천공항").first()).not.toBeVisible();
});

function createStoredGeneratedItinerary(id: string) {
  return {
    id,
    title: "PlanME 여수 MCP 저장 테스트 일정",
    region: "여수",
    duration: "1박 2일",
    summary: "MCP 서버가 저장한 generated 상세 일정 렌더링을 검증합니다.",
    detailUrl: `/itinerary/${id}`,
    carrymeSaving: "약 40분 절약",
    totalDurationLabel: "약 5시간 30분",
    savedDurationLabel: "약 40분 절약",
    transportMode: "drive",
    days: [
      {
        day: 1,
        label: "Day 1",
        savingMinutes: 40,
        standard: {
          id: "standard",
          label: "Standard",
          badge: "Standard",
          routeText: "서울역 → 여수 숙소 → 여수 MCP 저장 테스트 코스",
          description: "수하물 보관을 위해 숙소를 먼저 경유",
          durationLabel: "약 5시간 30분",
          durationMinutes: 330,
          stops: [
            {
              label: "서울역",
              caption: "출발",
              coordinate: { lat: 37.5547, lng: 126.9706 },
              icon: "station",
              mode: "drive",
              role: "출발지",
            },
            {
              label: "여수 숙소",
              caption: "짐 보관",
              coordinate: { lat: 34.7392, lng: 127.7444 },
              icon: "hotel",
              mode: "drive",
              role: "숙소",
            },
            {
              label: "여수 MCP 저장 테스트 코스",
              caption: "방문",
              coordinate: { lat: 34.744, lng: 127.752 },
              icon: "event",
              mode: "drive",
              role: "방문지",
            },
          ],
          geoPath: [
            { lat: 37.5547, lng: 126.9706 },
            { lat: 34.7392, lng: 127.7444 },
            { lat: 34.744, lng: 127.752 },
          ],
          mapPath: [
            { x: 10, y: 20 },
            { x: 54, y: 60 },
            { x: 70, y: 66 },
          ],
        },
        carryme: {
          id: "carryme",
          label: "CarryME",
          badge: "CarryME",
          routeText: "서울역 → 여수 MCP 저장 테스트 코스 → 여수 숙소",
          description: "짐은 CarryME가 이동하고 여행자는 바로 관광",
          durationLabel: "약 4시간 50분",
          durationMinutes: 290,
          stops: [
            {
              label: "서울역",
              caption: "출발",
              coordinate: { lat: 37.5547, lng: 126.9706 },
              icon: "station",
              mode: "drive",
              role: "출발지",
            },
            {
              label: "여수 MCP 저장 테스트 코스",
              caption: "방문",
              coordinate: { lat: 34.744, lng: 127.752 },
              icon: "event",
              mode: "drive",
              role: "방문지",
            },
            {
              label: "여수 숙소",
              caption: "짐 도착",
              coordinate: { lat: 34.7392, lng: 127.7444 },
              icon: "hotel",
              mode: "drive",
              role: "숙소",
            },
          ],
          geoPath: [
            { lat: 37.5547, lng: 126.9706 },
            { lat: 34.744, lng: 127.752 },
            { lat: 34.7392, lng: 127.7444 },
          ],
          mapPath: [
            { x: 10, y: 20 },
            { x: 70, y: 66 },
            { x: 54, y: 60 },
          ],
        },
        timeline: [
          {
            time: "09:00",
            title: "서울역 출발",
            description: "MCP 저장 일정 테스트를 시작합니다.",
            category: "arrival",
          },
          {
            time: "13:30",
            title: "여수 MCP 저장 테스트 코스 방문",
            description: "저장된 generated 일정이 상세 화면에 그대로 노출됩니다.",
            category: "event",
            highlight: true,
            savingLabel: "약 40분 절약",
          },
          {
            time: "17:00",
            title: "짐 숙소 도착",
            description: "짐은 숙소에 도착하고 여행자는 바로 관광합니다.",
            category: "hotel",
          },
        ],
      },
    ],
    benefits: [
      {
        title: "안전한 짐 배송",
        description: "수하물은 안전하게 목적지까지 배송됩니다.",
        icon: "shield",
      },
      {
        title: "시간 절약",
        description: "수하물 보관소 경유 없이 이동 시간을 줄일 수 있습니다.",
        icon: "time",
      },
      {
        title: "가벼운 여행",
        description: "짐 없이 주변 여행을 편하게 즐길 수 있습니다.",
        icon: "luggage",
      },
      {
        title: "실시간 알림",
        description: "진행 상태를 알림으로 확인할 수 있습니다.",
        icon: "phone",
      },
    ],
  };
}

/**
 * Creates a two-day stored itinerary containing the legacy Standard/CarryME overlap.
 */
function createTimelineDisplayItinerary(id: string) {
  const base = createStoredGeneratedItinerary(id);
  const baseDay = base.days[0];
  const returnStop = {
    label: "서울역",
    caption: "복귀",
    coordinate: { lat: 37.5547, lng: 126.9706 },
    icon: "station" as const,
    mode: "drive" as const,
    role: "복귀지" as const,
  };

  return {
    ...base,
    days: [1, 2].map((day) => ({
      ...baseDay,
      day,
      label: `Day ${day}`,
      standard:
        day === 2
          ? {
              ...baseDay.standard,
              routeText: `${baseDay.standard.routeText} → 서울역`,
              stops: [...baseDay.standard.stops, returnStop],
            }
          : baseDay.standard,
      carryme:
        day === 2
          ? {
              ...baseDay.carryme,
              routeText: `${baseDay.carryme.routeText} → 서울역`,
              stops: [...baseDay.carryme.stops, returnStop],
            }
          : baseDay.carryme,
      standardTimeline: [
        {
          time: "09:00",
          title: "서울역 출발",
          description: "부산으로 출발합니다.",
          category: "arrival" as const,
          highlight: true,
          savingLabel: "약 40분 절약",
        },
        {
          time: "13:30",
          title: "여수 숙소 체크인 전 짐 보관",
          description: "숙소에 들러 짐을 맡기고 관광을 시작합니다.",
          category: "hotel" as const,
          highlight: true,
          savingLabel: "약 40분 절약",
        },
        {
          time: "17:00",
          title: "여수 MCP 저장 테스트 코스 방문",
          description: "관광 일정을 진행합니다.",
          category: "event" as const,
          highlight: true,
          savingLabel: "약 40분 절약",
        },
        {
          time: "18:00",
          title: "여수 숙소 복귀",
          description: "관광 후 숙소로 돌아옵니다.",
          category: "hotel" as const,
          highlight: true,
          savingLabel: "약 40분 절약",
        },
        {
          time: "18:00",
          title: "짐 여수 숙소 도착",
          description: "짐이 숙소에 먼저 도착한 것으로 처리합니다.",
          category: "hotel" as const,
          highlight: true,
          savingLabel: "약 40분 절약",
        },
      ],
      carrymeTimeline: [
        {
          time: "09:00",
          title: "서울역 출발",
          description: "부산으로 출발합니다.",
          category: "arrival" as const,
          highlight: true,
          savingLabel: "약 40분 절약",
        },
        {
          time: "13:30",
          title: "짐 여수 숙소 도착",
          description: "짐이 숙소에 먼저 도착한 것으로 처리합니다.",
          category: "hotel" as const,
          highlight: true,
          savingLabel: "약 40분 절약",
        },
        {
          time: "17:00",
          title: "여수 MCP 저장 테스트 코스 방문",
          description: "짐 없이 관광 일정을 진행합니다.",
          category: "event" as const,
          highlight: true,
          savingLabel: "약 40분 절약",
        },
        {
          time: "18:00",
          title: "여수 숙소 도착",
          description: "관광 후 숙소로 이동합니다.",
          category: "hotel" as const,
          highlight: true,
          savingLabel: "약 40분 절약",
        },
      ],
    })),
    detailUrl: `/itinerary/${id}`,
    id,
  };
}
