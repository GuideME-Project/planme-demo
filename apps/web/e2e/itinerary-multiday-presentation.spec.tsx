import { expect, test } from "@playwright/test";
import type { PlanmeItinerary, RoutePlan } from "@planme/core";
import { createPlanmeWidgetHtml } from "../../mcp/src/planme-widget";
import {
  createItineraryOgViewModel,
} from "../lib/itinerary-og-presentation";

test("renders every 1–3 day App timeline with all-day totals", async ({ page }) => {
  const itinerary = createThreeDayPresentationItinerary();
  const widgetHtml = createPlanmeWidgetHtml();

  expect(Buffer.byteLength(widgetHtml)).toBeLessThan(40_000);
  await page.setContent(widgetHtml);
  await page.evaluate((value) => {
    const bridge = window as typeof window & {
      openai?: {
        toolOutput: {
          _meta: { itinerary: PlanmeItinerary };
        };
      };
    };

    bridge.openai = { toolOutput: { _meta: { itinerary: value } } };
    window.dispatchEvent(new Event("openai:set_globals"));
  }, itinerary);

  await expect(page.locator("[data-planme-day]")).toHaveCount(3);
  await expect(page.locator("[data-planme-standard]")).toHaveText("약 10시간");
  await expect(page.locator("[data-planme-carryme]")).toHaveText("약 8시간 30분");
  await expect(page.locator("[data-planme-carryme-duration]")).toHaveText(
    "약 8시간 30분",
  );
  await expect(page.locator("[data-planme-saving]")).toHaveText("약 1시간 30분 절약");

  for (const day of itinerary.days) {
    await expect(
      page.locator(`[data-planme-day="${day.day}"]`).getByText(`${day.day}일차`, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.locator(`[data-planme-day="${day.day}"]`).getByText(
        `${day.day}일차 대표 일정`,
        { exact: true },
      ),
    ).toBeVisible();
  }
});

test("builds a readable three-day OG model from all-day totals", () => {
  const itinerary = createThreeDayPresentationItinerary();
  const view = createItineraryOgViewModel(itinerary);

  expect(view.standardTotalLabel).toBe("약 10시간");
  expect(view.carrymeTotalLabel).toBe("약 8시간 30분");
  expect(view.savingLabel).toBe("약 1시간 30분 절약");
  expect(view.days).toHaveLength(3);

  for (const day of view.days) {
    expect(day.dayLabel).toMatch(/^[1-3]일차$/);
    expect(day.startLabel).toContain("출발지");
    expect(day.endLabel).toContain("도착지");
  }
});

function createThreeDayPresentationItinerary(): PlanmeItinerary {
  const standardMinutes = [180, 200, 220];
  const carrymeMinutes = [150, 170, 190];
  const createRoute = (
    id: RoutePlan["id"],
    day: number,
    durationMinutes: number,
  ): RoutePlan => ({
    badge: id === "standard" ? "Standard" : "CarryME",
    description: `${day}일차 비교 경로`,
    durationLabel: formatTestDuration(durationMinutes),
    durationMinutes,
    id,
    label: id === "standard" ? "Standard" : "CarryME",
    mapPath: [],
    routeText: `${day}일차 출발지 → ${day}일차 도착지`,
    stops: [
      {
        caption: "출발",
        icon: "station",
        label: `${day}일차 출발지`,
        role: day === 1 ? "출발지" : "숙소",
      },
      {
        caption: "도착",
        icon: day === 3 ? "station" : "hotel",
        label: `${day}일차 도착지`,
        role: day === 3 ? "복귀지" : "숙소",
      },
    ],
  });

  return {
    benefits: [],
    carrymeSaving: "약 1시간 30분 절약",
    days: [1, 2, 3].map((day) => {
      const timeline = [
        {
          category: "arrival" as const,
          description: `${day}일차를 시작합니다.`,
          time: "08:00",
          title: `${day}일차 출발`,
        },
        {
          category: "event" as const,
          description: `${day}일차 핵심 장소를 방문합니다.`,
          time: "12:00",
          title: `${day}일차 대표 일정`,
        },
        {
          category: "hotel" as const,
          description: `${day}일차를 마칩니다.`,
          time: "18:00",
          title: `${day}일차 도착`,
        },
      ];

      return {
        carryme: createRoute("carryme", day, carrymeMinutes[day - 1] ?? 0),
        carrymeTimeline: timeline,
        day,
        label: `Day ${day}`,
        savingMinutes: (standardMinutes[day - 1] ?? 0) - (carrymeMinutes[day - 1] ?? 0),
        savingStatus: "verified" as const,
        standard: createRoute("standard", day, standardMinutes[day - 1] ?? 0),
        standardTimeline: timeline,
        timeline,
      };
    }),
    detailUrl: "/itinerary/generated-three-day-presentation",
    duration: "2박 3일",
    id: "generated-three-day-presentation",
    region: "부산",
    savedDurationLabel: "약 1시간 30분 절약",
    summary: "다일 일정 표시 계약",
    title: "부산 2박 3일",
    totalDurationLabel: "약 10시간 → 약 8시간 30분",
    transportMode: "drive",
  };
}

function formatTestDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  return remainder === 0 ? `약 ${hours}시간` : `약 ${hours}시간 ${remainder}분`;
}
