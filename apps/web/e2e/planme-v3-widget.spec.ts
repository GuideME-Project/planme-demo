import { expect, test } from "@playwright/test";
import { createPlanmeWidgetHtml } from "../../mcp/src/planme-widget";

test("continues a V3 job without a click and stops after terminal ready", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const bridge = window as Window & {
      openai?: {
        callCount: number;
        callTool: (
          name: string,
          input: { itineraryId?: string },
        ) => Promise<object>;
        toolOutput: object;
      };
    };
    bridge.openai = {
      callCount: 0,
      toolOutput: {
        status: "processing",
        itineraryId: "planme-v3-widget-e2e",
        phase: "routing",
        retryAfterMs: 1,
      },
      callTool: async (name, input) => {
        bridge.openai!.callCount += 1;
        if (
          name !== "get_planme_itinerary" ||
          input.itineraryId !== "planme-v3-widget-e2e"
        ) {
          throw new Error("Unexpected V3 widget tool call");
        }
        return {
          status: "ready",
          itineraryId: "planme-v3-widget-e2e",
          revision: 1,
          excludedRequestedPlaces: [],
          widget: {
            itineraryId: "planme-v3-widget-e2e",
            revision: 1,
            title: "부산 여행 일정",
            region: "부산",
            durationDays: 1,
            transportMode: "transit",
            days: [{ day: 1, visits: [] }],
            standardTotalMinutes: 60,
            carrymeTotalMinutes: 40,
            savedMinutes: 20,
            pageUrl: "https://planme.example/itinerary/planme-v3-widget-e2e",
          },
        };
      },
    };
  });

  await page.goto("about:blank");
  await page.setContent(createPlanmeWidgetHtml());
  await expect(page.getByRole("heading", { name: "부산 여행 일정" })).toBeVisible();
  await expect(page.getByText("20분", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const bridge = window as Window & {
          openai?: { callCount?: number };
        };
        return bridge.openai?.callCount ?? 0;
      }),
    )
    .toBe(1);

  await page.waitForTimeout(1_000);
  expect(
    await page.evaluate(() => {
      const bridge = window as Window & { openai?: { callCount?: number } };
      return bridge.openai?.callCount ?? 0;
    }),
  ).toBe(1);
});
