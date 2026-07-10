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
  await expect(page.getByText("여수 MCP 저장 테스트 코스").first()).toBeVisible();
  await expect(page.getByText("방문지").first()).toBeVisible();
  await expect(page.getByText("숙소").first()).toBeVisible();
  await expect(page.getByText("도보")).not.toBeVisible();
  await expect(page.getByText("짐 숙소 도착").first()).toBeVisible();
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
