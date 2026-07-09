import { expect, test, type Page } from "@playwright/test";

type PlaceDetailsPayload = {
  message?: string;
  place?: {
    coordinate?: { lat: number; lng: number };
    text?: string;
  };
};

const odsayRequestUrls: string[] = [];
const naverDriveRequestUrls: string[] = [];
const tmapRouteRequestUrls: string[] = [];
let forceOdsayFailure = false;
let forceJeongeupTransitRateLimit = false;

const routePath = [
  { lat: 37.4602, lng: 126.4407 },
  { lat: 36.35, lng: 127.38 },
  { lat: 35.5682, lng: 126.856 },
  { lat: 35.1796, lng: 129.0756 },
  { lat: 35.16, lng: 129.06 },
];

const localDrivingPlaces = {
  arisuRoad: {
    coordinate: { lat: 37.5457, lng: 127.1781 },
    mainText: "아리수로50길",
    placeId: "place-arisu-road",
    secondaryText: "경기도 하남시 아리수로50길",
    text: "아리수로50길",
  },
  dongtanLakePark: {
    coordinate: { lat: 37.1729, lng: 127.1059 },
    mainText: "동탄호수공원",
    placeId: "place-dongtan-lake-park",
    secondaryText: "경기도 화성시 동탄순환대로",
    text: "동탄호수공원",
  },
  yeosuHotelHaven: {
    coordinate: { lat: 34.7369, lng: 127.7434 },
    mainText: "여수호텔헤이븐",
    placeId: "place-yeosu-hotel-haven",
    secondaryText: "전라남도 여수시 돌산읍 진두해안길",
    text: "여수호텔헤이븐",
  },
};

const busanToJeongeupTransitPath = {
  result: {
    path: [
      {
        info: {
          totalDistance: 427600,
          totalPayment: 57700,
          totalTime: 145,
          transitCount: 2,
        },
        subPath: [
          {
            distance: 294300,
            endName: "오송",
            endX: 127.327583,
            endY: 36.620099,
            sectionTime: 99,
            startName: "부산",
            startX: 129.042217,
            startY: 35.115209,
            trafficType: 4,
            trainType: 8,
          },
          {
            distance: 133300,
            endName: "정읍",
            endX: 126.842395,
            endY: 35.575529,
            sectionTime: 46,
            startName: "오송",
            startX: 127.327583,
            startY: 36.620099,
            trafficType: 4,
            trainType: 1,
          },
        ],
      },
    ],
  },
};

/**
 * Waits until the mocked ODsay request list stops changing.
 */
async function waitForOdsayRequestsToSettle(minimumCount = 1) {
  let previousCount = -1;
  let stableSampleCount = 0;

  await expect
    .poll(
      () => {
        const currentCount = odsayRequestUrls.length;

        // Route computations are queued; require several stable samples before reloading.
        if (currentCount === previousCount) {
          stableSampleCount += 1;
        } else {
          previousCount = currentCount;
          stableSampleCount = 0;
        }

        return currentCount >= minimumCount && stableSampleCount >= 4;
      },
      {
        intervals: [250, 250, 250, 500, 500, 500, 1_000, 1_000, 1_000],
        timeout: 12_000,
      },
    )
    .toBe(true);
}

/**
 * Checks whether a browser request is trying to use a TMAP route, SDK, or transit endpoint.
 */
function isTmapRequestUrl(requestUrl: string) {
  const url = new URL(requestUrl);

  return (
    url.pathname.startsWith("/api/tmap/") ||
    url.hostname.includes("tmap") ||
    url.hostname === "apis.openapi.sk.com" ||
    url.hostname === "transit.tmapmobility.com"
  );
}

/**
 * Ensures mocked route geometry is drawable by the map layer.
 */
function createDrawableMockPath(path: Array<{ lat: number; lng: number }>) {
  if (path.length !== 2) {
    return path;
  }

  return [
    path[0],
    {
      lat: (path[0].lat + path[1].lat) / 2,
      lng: (path[0].lng + path[1].lng) / 2,
    },
    path[1],
  ];
}

/**
 * Mocks Google Places for the local route-editing scenario without using external quota.
 */
async function mockLocalDrivingPlaces(page: Page) {
  await page.route("**/api/places/autocomplete", async (route) => {
    const body = route.request().postDataJSON() as { input?: string };
    const input = body.input ?? "";
    const place = input.includes("아리수로")
      ? localDrivingPlaces.arisuRoad
      : input.includes("여수")
        ? localDrivingPlaces.yeosuHotelHaven
        : localDrivingPlaces.dongtanLakePark;

    await route.fulfill({
      contentType: "application/json",
      json: {
        candidates: [
          {
            mainText: place.mainText,
            placeId: place.placeId,
            secondaryText: place.secondaryText,
            text: place.text,
          },
        ],
      },
    });
  });

  await page.route("**/api/places/details", async (route) => {
    const body = route.request().postDataJSON() as { placeId?: string };
    const place =
      body.placeId === localDrivingPlaces.arisuRoad.placeId
        ? localDrivingPlaces.arisuRoad
        : body.placeId === localDrivingPlaces.yeosuHotelHaven.placeId
          ? localDrivingPlaces.yeosuHotelHaven
          : localDrivingPlaces.dongtanLakePark;

    await route.fulfill({
      contentType: "application/json",
      json: {
        place: {
          coordinate: place.coordinate,
          placeId: place.placeId,
          secondaryText: place.secondaryText,
          text: place.text,
        },
      },
    });
  });
}

test.beforeEach(async ({ page }) => {
  odsayRequestUrls.length = 0;
  naverDriveRequestUrls.length = 0;
  tmapRouteRequestUrls.length = 0;
  forceOdsayFailure = false;
  forceJeongeupTransitRateLimit = false;

  await page.addInitScript(() => {
    const resetMarkerKey = "planme:e2e:odsay-cache-cleared";

    if (sessionStorage.getItem(resetMarkerKey)) {
      return;
    }

    // Each test starts with an empty persistent cache, but page reloads keep it.
    Object.keys(localStorage)
      .filter(
        (key) =>
          key.startsWith("planme:odsay-cache:") ||
          key.startsWith("planme:naver-route-cache:"),
      )
      .forEach((key) => localStorage.removeItem(key));
    sessionStorage.setItem(resetMarkerKey, "true");
  });

  page.on("request", (request) => {
    const requestUrl = request.url();

    // E2E must use Naver for car routing and ODsay for transit, never TMAP.
    if (isTmapRequestUrl(requestUrl)) {
      tmapRouteRequestUrls.push(requestUrl);
    }
  });

  await page.route("**/api/naver/directions/routes", async (route) => {
    naverDriveRequestUrls.push(route.request().url());

    const body = route.request().postDataJSON() as {
      stops?: Array<{ coordinate?: { lat: number; lng: number }; mode?: string }>;
    };
    const stops = body.stops ?? [];

    if (stops.slice(0, -1).some((stop) => stop.mode !== "drive")) {
      await route.fulfill({
        contentType: "application/json",
        json: {
          message:
            "Naver Directions 자동차 경로 API는 자동차 구간만 처리합니다. 대중교통은 ODsay 경로를 사용합니다.",
          ok: false,
        },
        status: 400,
      });
      return;
    }

    const path = stops
      .map((stop) => stop.coordinate)
      .filter((coordinate): coordinate is { lat: number; lng: number } => Boolean(coordinate));
    const drawablePath = createDrawableMockPath(path.length > 1 ? path : routePath);

    await route.fulfill({
      contentType: "application/json",
      json: {
        ok: true,
        path: drawablePath,
        segments: [
          {
            distanceMeters: 12000,
            durationSeconds: 1800,
            mode: stops[0]?.mode ?? "drive",
            path: drawablePath,
            paths: [drawablePath],
          },
        ],
        totalDistanceMeters: 12000,
        totalDurationLabel: "약 30분",
        totalDurationSeconds: 1800,
      },
    });
  });

  await page.route("https://api.odsay.com/v1/api/**", async (route) => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.split("/").pop();

    odsayRequestUrls.push(route.request().url());

    if (forceOdsayFailure) {
      await route.fulfill({
        contentType: "application/json",
        json: { error: { code: "500", message: "Forced ODsay failure" } },
      });
      return;
    }

    if (endpoint === "trainTerminals") {
      const terminalName = url.searchParams.get("terminalName") ?? "정읍";
      const stations: Record<string, { stationID: number; stationName: string; x: number; y: number }> = {
        부산: { stationID: 2, stationName: "부산", x: 129.0423, y: 35.1152 },
        서울: { stationID: 1, stationName: "서울", x: 126.9707, y: 37.5547 },
        정읍: { stationID: 3, stationName: "정읍", x: 126.856, y: 35.5682 },
      };

      await route.fulfill({
        contentType: "application/json",
        json: { result: stations[terminalName] ?? stations.정읍 },
      });
      return;
    }

    if (endpoint === "searchTrainPath") {
      await route.fulfill({
        contentType: "application/json",
        json: {
          result: {
            path: [
              {
                info: { trainTravelDistance: 320000, trainTravelTime: 160 },
                subPath: [
                  {
                    distance: 320000,
                    sectionTime: 160,
                    vertices: [
                      { x: 126.9707, y: 37.5547 },
                      { x: 127.3845, y: 36.3504 },
                      { x: 126.856, y: 35.5682 },
                      { x: 129.0423, y: 35.1152 },
                    ],
                  },
                ],
              },
            ],
          },
        },
      });
      return;
    }

    if (endpoint === "searchPubTransPathT") {
      const endLng = Number(url.searchParams.get("EX"));
      const endLat = Number(url.searchParams.get("EY"));
      const isJeongeupDestination =
        Number.isFinite(endLng) &&
        Number.isFinite(endLat) &&
        Math.abs(endLng - 126.84265) < 0.02 &&
        Math.abs(endLat - 35.57546) < 0.02;

      if (isJeongeupDestination) {
        if (forceJeongeupTransitRateLimit) {
          await route.fulfill({
            contentType: "application/json",
            json: { error: { code: "429", message: "Too Many Requests" } },
          });
          return;
        }

        await route.fulfill({
          contentType: "application/json",
          json: busanToJeongeupTransitPath,
        });
        return;
      }

      await route.fulfill({
        contentType: "application/json",
        json: {
          result: {
            path: [
              {
                info: { mapObj: "mock-lane", totalDistance: 450000, totalTime: 280 },
                subPath: [
                  {
                    distance: 450000,
                    endX: 129.0756,
                    endY: 35.1796,
                    sectionTime: 280,
                    startX: 126.4407,
                    startY: 37.4602,
                    trafficType: 1,
                  },
                ],
              },
            ],
          },
        },
      });
      return;
    }

    if (endpoint === "loadLane") {
      await route.fulfill({
        contentType: "application/json",
        json: {
          result: {
            lane: [
              {
                section: [
                  {
                    graphPos: [
                      { x: 126.4407, y: 37.4602 },
                      { x: 127.3845, y: 36.3504 },
                      { x: 126.8438, y: 35.5752 },
                      { x: 129.0756, y: 35.1796 },
                    ],
                  },
                ],
              },
            ],
          },
        },
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      json: {
        result: {
          path: [
            {
              recommend: {
                routes: [
                  {
                    coordinate: [
                      { x: 129.06, y: 35.16 },
                      { x: 129.07, y: 35.17 },
                      { x: 129.0756, y: 35.1796 },
                    ],
                    distance: 900,
                    duration: 720,
                  },
                ],
                summary: { distance: 900, duration: 720 },
              },
            },
          ],
        },
      },
    });
  });
});

test.afterEach(() => {
  expect(tmapRouteRequestUrls).toEqual([]);
});

test("reuses persisted ODsay cache after page reload without calling the provider again", async ({
  page,
}) => {
  await page.goto("http://localhost:3000/");
  await expect(page.getByText(/총 이동 시간\(예상\)/).first()).toBeVisible();

  await waitForOdsayRequestsToSettle();
  const initialLoadRequestCount = odsayRequestUrls.length;

  expect(initialLoadRequestCount).toBeGreaterThan(0);

  odsayRequestUrls.length = 0;
  await page.reload();
  await expect(page.getByText(/총 이동 시간\(예상\)/).first()).toBeVisible();
  await page.waitForTimeout(3_000);

  const firstReloadRequestCount = odsayRequestUrls.length;

  expect(odsayRequestUrls).toEqual([]);

  await page.reload();
  await expect(page.getByText(/총 이동 시간\(예상\)/).first()).toBeVisible();
  await page.waitForTimeout(3_000);

  const secondReloadRequestCount = odsayRequestUrls.length;

  console.info(
    `[odsay-cache-counts] initial=${initialLoadRequestCount}, firstReload=${firstReloadRequestCount}, secondReload=${secondReloadRequestCount}`,
  );
  expect(odsayRequestUrls).toEqual([]);
});

test("updates the header and benefit copy after recalculating an edited local car route", async ({
  page,
}) => {
  await mockLocalDrivingPlaces(page);
  await page.goto("http://localhost:3000/");

  await test.step("replace the demo route with a local two-point car route", async () => {
    await page.getByRole("button", { name: "삭제" }).nth(2).click();

    const departureInput = page.getByRole("textbox", { name: "출발지 행선지" });
    await departureInput.fill("동탄호수공원");
    await page.getByRole("button", { name: /동탄호수공원/ }).first().click();

    const arrivalInput = page.getByRole("textbox", { name: "도착지 행선지" });
    await arrivalInput.fill("아리수로50길");
    await page.getByRole("button", { name: /아리수로50길/ }).first().click();

    const modeSelects = page.getByRole("combobox");
    await modeSelects.first().click();
    await page.getByRole("option", { name: "자동차" }).click();
  });

  await test.step("recalculate and sync every visible summary surface", async () => {
    await page.getByRole("button", { name: "경로 다시 계산" }).click();

    await expect(page.getByText(/경로 체크 완료/)).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "동탄호수공원 → 아리수로50길 추천 일정",
      }),
    ).toBeVisible();
    await expect(page.getByText("부산 BTS 공연 1박 2일 추천 일정")).toHaveCount(0);
    await expect(
      page.getByText("동탄호수공원에서 아리수로50길(으)로 이동하는 CarryME 동선을 확인하세요."),
    ).toBeVisible();
    await expect(
      page.getByText("수하물은 안전하게 보관하고 목적지까지 배송됩니다."),
    ).toBeVisible();
    await expect(page.getByText("동탄호수공원에서 아리수로50길까지 안전하게 배송")).toHaveCount(
      0,
    );
    await expect(page.getByText("인천공항에서 부산 호텔까지 안전하게 배송")).toHaveCount(0);
  });
});

test("recalculates an airport to local waypoint to hotel car route without leaking hidden walk modes", async ({
  page,
}) => {
  forceOdsayFailure = true;
  await mockLocalDrivingPlaces(page);
  await page.goto("http://localhost:3000/");

  await test.step("set the reproduced three-point car-only route", async () => {
    const visitInput = page.getByRole("textbox", { name: "방문지 행선지" }).first();
    await visitInput.fill("동탄호수공원");
    await page.getByRole("button", { name: /동탄호수공원/ }).first().click();

    const arrivalInput = page.getByRole("textbox", { name: "도착지 행선지" });
    await arrivalInput.fill("여수호텔헤이븐");
    await page.getByRole("button", { name: /여수호텔헤이븐/ }).first().click();

    const modeSelects = page.getByRole("combobox");
    await modeSelects.first().click();
    await page.getByRole("option", { name: "자동차" }).click();
    await modeSelects.nth(1).click();
    await page.getByRole("option", { name: "자동차" }).click();

    await expect(page.getByText("인천공항 → 동탄호수공원")).toBeVisible();
    await expect(page.getByText("동탄호수공원 → 여수호텔헤이븐")).toBeVisible();
    await expect(modeSelects.first()).toContainText("자동차");
    await expect(modeSelects.nth(1)).toContainText("자동차");
  });

  await test.step("recalculate without sending non-drive rows to the car API", async () => {
    await page.getByRole("button", { name: "경로 다시 계산" }).click();

    await expect(page.getByText(/경로 체크 완료/)).toBeVisible();
    await expect(page.getByText(/자동차 경로 API는 자동차 구간만 처리합니다/)).toHaveCount(
      0,
    );
  });
});

test("recorded destination editing flow keeps selected waypoint coordinates during recalculation", async ({
  page,
}) => {
  await page.goto("http://localhost:3000/");
  let selectedPlace: PlaceDetailsPayload["place"];

  await test.step("add Jeongeup Station through the recorded autocomplete flow", async () => {
    await page.getByRole("button", { name: "경유지 추가" }).click();

    const visitInputs = page.getByRole("textbox", { name: "방문지 행선지" });
    await visitInputs.nth(1).fill("정읍역");
    await expect(page.getByRole("button", { name: /정읍역/ }).first()).toBeVisible();

    const detailsResponsePromise = page.waitForResponse("**/api/places/details");
    await page.getByRole("button", { name: /정읍역/ }).first().click();
    const detailsResponse = await detailsResponsePromise;
    const detailsPayload = (await detailsResponse.json()) as PlaceDetailsPayload;
    selectedPlace = detailsPayload.place;

    expect(detailsResponse.ok(), detailsPayload.message).toBe(true);
    expect(selectedPlace?.coordinate).toEqual(
      expect.objectContaining({
        lat: expect.any(Number),
        lng: expect.any(Number),
      }),
    );
    await expect(visitInputs.nth(1)).toHaveValue(/정읍역/);
  });

  await test.step("recalculate the edited route without losing the selected coordinate", async () => {
    expect(selectedPlace?.coordinate).toBeTruthy();
    await page.getByRole("button", { name: "경로 다시 계산" }).click();

    await expect(page.getByText(/좌표가 없는 행선지가 있습니다/)).toHaveCount(0);
    await expect(page.getByText(/경로 체크 완료/)).toBeVisible();
    await expect(page.getByText(/총 이동 시간\(예상\)/).first()).toBeVisible();
    await expect(page.getByText(/약 \d+시간 \d+분 → 약 \d+시간 \d+분/)).toBeVisible();
  });
});

test("recalculates Busan concert to Jeongeup transit and Jeongeup to Seomyeon drive without the long-distance coordinate error", async ({
  page,
}) => {
  await page.goto("http://localhost:3000/");

  await test.step("set the reproduced destination order and transport modes", async () => {
    await page.getByRole("button", { name: "경유지 추가" }).click();

    const visitInputs = page.getByRole("textbox", { name: "방문지 행선지" });
    await visitInputs.nth(1).fill("정읍역");
    await expect(
      page.getByRole("button", {
        name: "정읍역 대한민국 전북특별자치도 정읍시 특별자치도 서부산업도로",
      }),
    ).toBeVisible();

    const detailsResponsePromise = page.waitForResponse("**/api/places/details");
    await page
      .getByRole("button", {
        name: "정읍역 대한민국 전북특별자치도 정읍시 특별자치도 서부산업도로",
      })
      .click();
    const detailsPayload = (await (await detailsResponsePromise).json()) as PlaceDetailsPayload;

    expect(detailsPayload.place?.coordinate).toEqual(
      expect.objectContaining({
        lat: expect.any(Number),
        lng: expect.any(Number),
      }),
    );

    const modeSelects = page.getByRole("combobox");
    await modeSelects.nth(1).click();
    await page.getByRole("option", { name: "대중교통" }).click();
    await modeSelects.nth(2).click();
    await page.getByRole("option", { name: "자동차" }).click();

    await expect(page.getByText("부산 공연장 → 정읍역")).toBeVisible();
    await expect(page.getByText("정읍역 → 서면 호텔")).toBeVisible();
    await expect(modeSelects.nth(1)).toContainText("대중교통");
    await expect(modeSelects.nth(2)).toContainText("자동차");
  });

  await test.step("recalculate without showing the reproduced long-distance transit error", async () => {
    await page.getByRole("button", { name: "경로 다시 계산" }).click();

    await expect(
      page.getByText(/지도에 표시할 장거리 대중교통 경로 좌표를 확인하지 못했습니다/),
    ).toHaveCount(0);
    await expect(page.getByText(/일부 구간 확인 필요/)).toBeVisible();
    await expect(page.getByTestId("transit-marker-boarding").first()).toContainText("탑승: 부산");
    await expect(page.getByTestId("transit-marker-alighting").first()).toContainText("하차: 정읍");
    const firstNaverDriveRequestCount = naverDriveRequestUrls.length;

    expect(firstNaverDriveRequestCount).toBe(1);
    expect(tmapRouteRequestUrls.length).toBe(0);

    naverDriveRequestUrls.length = 0;
    await page.getByRole("button", { name: "경로 다시 계산" }).click();
    await page.waitForTimeout(300);

    console.info(
      `[naver-cache-counts] first=${firstNaverDriveRequestCount}, second=${naverDriveRequestUrls.length}`,
    );
    expect(naverDriveRequestUrls).toEqual([]);
  });
});

test("shows ODsay rate-limit errors instead of hiding them behind long-distance geometry errors", async ({
  page,
}) => {
  forceJeongeupTransitRateLimit = true;
  const warningMessages: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "warning") {
      warningMessages.push(message.text());
    }
  });

  await page.goto("http://localhost:3000/");
  await page.getByRole("button", { name: "경유지 추가" }).click();

  const visitInputs = page.getByRole("textbox", { name: "방문지 행선지" });
  await visitInputs.nth(1).fill("정읍역");
  await page
    .getByRole("button", {
      name: "정읍역 대한민국 전북특별자치도 정읍시 특별자치도 서부산업도로",
    })
    .click();

  const modeSelects = page.getByRole("combobox");
  await modeSelects.nth(1).click();
  await page.getByRole("option", { name: "대중교통" }).click();

  await page.getByRole("button", { name: "경로 다시 계산" }).click();

  await expect(page.getByText(/ODsay 호출 제한/)).toBeVisible();
  await expect(
    page.getByText(/지도에 표시할 장거리 대중교통 경로 좌표를 확인하지 못했습니다/),
  ).toHaveCount(0);
  expect(warningMessages.some((message) => message.includes("ODsay API error"))).toBe(true);
});

test("deduplicates identical Standard and CarryME recalculation requests to reduce ODsay calls", async ({
  page,
}) => {
  await page.goto("http://localhost:3000/");
  await page.getByRole("button", { name: "경유지 추가" }).click();

  const visitInputs = page.getByRole("textbox", { name: "방문지 행선지" });
  await visitInputs.nth(1).fill("정읍역");
  await page
    .getByRole("button", {
      name: "정읍역 대한민국 전북특별자치도 정읍시 특별자치도 서부산업도로",
    })
    .click();

  const modeSelects = page.getByRole("combobox");
  await modeSelects.nth(1).click();
  await page.getByRole("option", { name: "대중교통" }).click();

  odsayRequestUrls.length = 0;
  await page.getByRole("button", { name: "경로 다시 계산" }).click();
  await expect(page.getByText(/일부 구간 확인 필요/)).toBeVisible();

  const jeongeupTransitRequestCount = odsayRequestUrls.filter((requestUrl) => {
    const url = new URL(requestUrl);

    return (
      url.pathname.endsWith("/searchPubTransPathT") &&
      Math.abs(Number(url.searchParams.get("EX")) - 126.84265) < 0.02 &&
      Math.abs(Number(url.searchParams.get("EY")) - 35.57546) < 0.02
    );
  }).length;

  expect(jeongeupTransitRequestCount).toBe(1);

  const firstRecalculationOdsayCount = odsayRequestUrls.length;

  await page.getByRole("button", { name: "경로 다시 계산" }).click();
  await expect(page.getByText(/일부 구간 확인 필요/)).toBeVisible();
  await page.waitForTimeout(300);

  expect(odsayRequestUrls.length).toBe(firstRecalculationOdsayCount);
});
