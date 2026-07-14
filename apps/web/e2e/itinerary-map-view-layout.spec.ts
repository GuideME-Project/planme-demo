import { expect, test } from "@playwright/test";

test("expands the map-only detail view after hiding itinerary editing panels", async ({
  page,
}) => {
  await page.goto("/itinerary/busan-bts-1d1n");

  await expect(page.getByTestId("timeline-panel")).toBeVisible();
  await expect(page.getByText("행선지 편집")).toBeVisible();

  await page.getByRole("button", { name: "상세 지도" }).click();

  await expect(page.getByTestId("timeline-panel")).toHaveCount(0);
  await expect(page.getByText("행선지 편집")).toHaveCount(0);

  const mapBox = await page.getByTestId("route-map-viewport").boundingBox();
  const mapSurfaceBox = await page
    .getByTestId("route-map-surface")
    .boundingBox();

  expect(mapBox?.height).toBeGreaterThanOrEqual(560);
  expect(mapSurfaceBox?.height).toBe(mapBox?.height);
});
