import { expect, test, type Page } from "@playwright/test";

type RouteRequestBody = {
  stops?: Array<{
    coordinate?: { lat: number; lng: number };
    mode?: string;
    name?: string;
  }>;
};

const naverRouteRequests: RouteRequestBody[] = [];
const odsayRequestUrls: string[] = [];
let failStandardNaverRoute = false;

/**
 * Returns a drawable provider path without using an external route quota.
 */
function createMockPath(body: RouteRequestBody) {
  const coordinates = (body.stops ?? [])
    .map((stop) => stop.coordinate)
    .filter((coordinate): coordinate is { lat: number; lng: number } => Boolean(coordinate));

  if (coordinates.length > 2) {
    return coordinates;
  }

  if (coordinates.length === 2) {
    return [
      coordinates[0],
      {
        lat: (coordinates[0].lat + coordinates[1].lat) / 2,
        lng: (coordinates[0].lng + coordinates[1].lng) / 2,
      },
      coordinates[1],
    ];
  }

  return [
    { lat: 37.2, lng: 127.09 },
    { lat: 36.2, lng: 127.8 },
    { lat: 35.84, lng: 129.28 },
  ];
}

/**
 * Installs provider-neutral Naver place and route mocks for editor regression tests.
 */
async function installProviderMocks(page: Page) {
  await page.route("**/api/places/search", async (route) => {
    const body = route.request().postDataJSON() as { query?: string };
    const query = body.query?.trim() || "동탄호수공원";

    await route.fulfill({
      contentType: "application/json",
      json: {
        candidates: [
          {
            address: "경기도 화성시 동탄순환대로 69",
            candidateId: "naver_local:dongtan-lake-park:37.172900:127.105900",
            coordinate: { lat: 37.1729, lng: 127.1059 },
            id: "dongtan-lake-park",
            name: query.includes("호수") ? "동탄호수공원" : query,
            placeSource: "naver_local",
            placeSourceRef: "naver_local:dongtan-lake-park:37.172900:127.105900",
          },
        ],
      },
    });
  });

  await page.route("**/api/naver/directions/routes", async (route) => {
    const body = route.request().postDataJSON() as RouteRequestBody;
    naverRouteRequests.push(body);

    if (failStandardNaverRoute && body.stops?.[1]?.name === "서면 호텔") {
      await route.fulfill({
        contentType: "application/json",
        json: { message: "강제 실패", ok: false },
        status: 502,
      });
      return;
    }

    const path = createMockPath(body);
    await route.fulfill({
      contentType: "application/json",
      json: {
        ok: true,
        path,
        segments: [
          {
            distanceMeters: 12_000,
            durationSeconds: 1_800,
            mode: "drive",
            path,
            paths: [path],
          },
        ],
        totalDistanceMeters: 12_000,
        totalDurationLabel: "약 30분",
        totalDurationSeconds: 1_800,
      },
    });
  });

  await page.route("https://api.odsay.com/v1/api/**", async (route) => {
    odsayRequestUrls.push(route.request().url());
    await route.fulfill({
      contentType: "application/json",
      json: { error: { code: "500", message: "이 테스트에서는 대중교통을 계산하지 않습니다." } },
    });
  });
}

/**
 * Re-selects every editable row so each one owns provider coordinates and a source reference.
 */
async function selectAllEditablePlaces(page: Page, secondPlace?: string) {
  const inputs = page.locator('input[aria-label$="행선지"]');
  const count = await inputs.count();

  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    const currentName = index === 1 && secondPlace ? secondPlace : await input.inputValue();

    await input.fill("");
    await input.fill(currentName);
    const suggestion = page.getByTestId("destination-suggestion-option").first();
    await expect(suggestion).toContainText(currentName);
    await suggestion.click();
    await expect(input).toHaveValue(currentName);
  }
}

test.beforeEach(async ({ page }) => {
  naverRouteRequests.length = 0;
  odsayRequestUrls.length = 0;
  failStandardNaverRoute = false;
  await installProviderMocks(page);
});

test("uses one itinerary-wide mode and a coordinate-bearing Naver place selection", async ({
  page,
}) => {
  await page.goto("/itinerary/busan-bts-1d1n");
  await expect(page.getByTestId("destination-editor")).toBeVisible();

  await expect(page.getByTestId("itinerary-transport-mode")).toHaveCount(1);
  await expect(page.getByText("도보", { exact: true })).toHaveCount(0);

  await page.waitForTimeout(500);
  naverRouteRequests.length = 0;
  odsayRequestUrls.length = 0;

  const modeSelect = page.getByTestId("itinerary-transport-mode").getByRole("combobox");
  await modeSelect.click();
  await page.getByRole("option", { name: "대중교통" }).click();
  await page.waitForTimeout(400);

  expect(naverRouteRequests).toHaveLength(0);
  expect(odsayRequestUrls).toHaveLength(0);

  await modeSelect.click();
  await page.getByRole("option", { name: "자동차" }).click();

  await selectAllEditablePlaces(page, "동탄호수공원");

  naverRouteRequests.length = 0;
  await page.getByRole("button", { name: "경로 다시 계산" }).click();
  await expect(page.getByText("Standard와 CarryME 경로를 계산했습니다.")).toBeVisible();
  await expect.poll(() => naverRouteRequests.length).toBeGreaterThanOrEqual(1);

  for (const request of naverRouteRequests) {
    expect(request.stops?.every((stop) => stop.mode === "drive")).toBe(true);
  }
  expect(odsayRequestUrls).toHaveLength(0);
});

test("keeps Standard and CarryME results independent when one provider request fails", async ({
  page,
}) => {
  await page.goto("/itinerary/busan-bts-1d1n");
  await expect(page.getByTestId("destination-editor")).toBeVisible();
  await page.waitForTimeout(500);

  const modeSelect = page.getByTestId("itinerary-transport-mode").getByRole("combobox");
  await modeSelect.click();
  await page.getByRole("option", { name: "자동차" }).click();
  await selectAllEditablePlaces(page);

  naverRouteRequests.length = 0;
  failStandardNaverRoute = true;
  await page.getByRole("button", { name: "경로 다시 계산" }).click();

  await expect(page.getByText(/경로를 확인하지 못했습니다/)).toBeVisible();
  await expect.poll(() => naverRouteRequests.length).toBeGreaterThanOrEqual(2);
  await expect(page.getByText(/Standard|CarryME/).first()).toBeVisible();
});

test("rejects free text that was not selected from place search", async ({ page }) => {
  await page.goto("/itinerary/busan-bts-1d1n");
  await expect(page.getByTestId("destination-editor")).toBeVisible();

  const intermediateInput = page.locator('input[aria-label$="행선지"]').nth(1);
  await intermediateInput.fill("선택하지 않은 장소");
  await page.getByRole("button", { name: "경로 다시 계산" }).click();

  await expect(page.getByText("장소를 선택해 주세요")).toBeVisible();
});
