import { expect, test } from "@playwright/test";

type GptItineraryResponse = {
  itineraryId: string;
  title: string;
  pageUrl: string;
  itinerary: {
    days: Array<{
      carryme: {
        routeText: string;
      };
      timeline: Array<{
        time: string;
        title: string;
      }>;
    }>;
  };
};

test("keeps a local Yeosu fishing itinerary out of the Busan airport fallback", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/gpt/itineraries/recommend", {
    data: {
      destination: "여수",
      durationDays: 2,
      hotelName: "여수 베네치아 호텔",
      luggageCount: 1,
      preferences: ["낚시여행"],
      travelerCount: 1,
    },
  });

  expect(response.ok()).toBeTruthy();

  const data = (await response.json()) as GptItineraryResponse;

  expect(data.title).toBe("PlanME 여수 낚시여행 1박 2일 추천 일정");
  expect(data.itinerary.days[0].carryme.routeText).toBe(
    "여수 베네치아 호텔 → 여수 낚시여행",
  );
  expect(data.itinerary.days[0].timeline[0]).toMatchObject({
    time: "09:30",
    title: "여수 베네치아 호텔 출발",
  });

  const pageUrl = new URL(data.pageUrl);

  await page.goto(pageUrl.pathname);

  await expect(page.getByRole("heading", { name: data.title })).toBeVisible();
  await expect(page.getByText("인천공항").first()).not.toBeVisible();
  await expect(page.getByText(/부산/).first()).not.toBeVisible();
  await expect(page.getByText("여수 베네치아 호텔 → 여수 낚시여행").first()).toBeVisible();
});

test("creates a destination-specific itinerary from GPT Action input and opens the generated page", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/gpt/itineraries/recommend", {
    data: {
      arrivalAirport: "ICN",
      arrivalTime: "11:15",
      destination: "여수",
      durationDays: 3,
      hotelName: "여수 베네치아 호텔",
      luggageCount: 2,
      preferences: ["밤바다", "해산물"],
      travelerCount: 2,
    },
  });

  expect(response.ok()).toBeTruthy();

  const data = (await response.json()) as GptItineraryResponse;

  expect(data.itineraryId).not.toBe("busan-bts-1d1n");
  expect(data.title).toBe("PlanME 여수 밤바다 2박 3일 추천 일정");
  expect(data.itinerary.days[0].carryme.routeText).toContain("여수");
  expect(data.itinerary.days[0].timeline[0]).toMatchObject({
    time: "11:15",
    title: "인천공항 도착",
  });

  const pageUrl = new URL(data.pageUrl);

  await page.goto(pageUrl.pathname);

  await expect(page.getByRole("heading", { name: data.title })).toBeVisible();
  await expect(page.getByText("여수 베네치아 호텔").first()).toBeVisible();
});
