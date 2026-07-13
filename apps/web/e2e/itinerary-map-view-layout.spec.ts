import { expect, test } from "@playwright/test";

test("expands the map-only detail view after hiding itinerary editing panels", async ({
  page,
}) => {
  await page.addInitScript(() => {
    class FakeLatLng {
      private readonly latitude: number;
      private readonly longitude: number;

      constructor(latitude: number, longitude: number) {
        this.latitude = latitude;
        this.longitude = longitude;
      }

      lat() {
        return this.latitude;
      }

      lng() {
        return this.longitude;
      }
    }

    class FakeLatLngBounds {
      extend() {}
    }

    class FakeMap {
      private readonly element: HTMLElement;

      constructor(element: HTMLElement) {
        this.element = element;
        this.element.dataset.autoResizeCount = "0";
      }

      autoResize() {
        const count = Number(this.element.dataset.autoResizeCount ?? "0");
        this.element.dataset.autoResizeCount = String(count + 1);
      }

      fitBounds() {}
    }

    class FakeOverlay {}

    class FakePoint {}

    class FakeSize {}

    Object.defineProperty(window, "naver", {
      configurable: true,
      value: {
        maps: {
          LatLng: FakeLatLng,
          LatLngBounds: FakeLatLngBounds,
          Map: FakeMap,
          Marker: FakeOverlay,
          Point: FakePoint,
          Polyline: FakeOverlay,
          Position: { BOTTOM_RIGHT: "bottom-right" },
          Size: FakeSize,
        },
      },
    });
  });
  await page.goto("/itinerary/busan-bts-1d1n");

  await expect(page.getByTestId("timeline-panel")).toBeVisible();
  await expect(page.getByText("행선지 편집")).toBeVisible();

  const naverMap = page.getByTestId("naver-map-container");
  await expect(naverMap).toHaveAttribute("data-auto-resize-count", "0");
  const initialResizeCount = Number(
    (await naverMap.getAttribute("data-auto-resize-count")) ?? "0",
  );

  await page.getByRole("button", { name: "상세 지도" }).click();

  await expect
    .poll(async () => Number((await naverMap.getAttribute("data-auto-resize-count")) ?? "0"))
    .toBeGreaterThan(initialResizeCount);

  await expect(page.getByTestId("timeline-panel")).toHaveCount(0);
  await expect(page.getByText("행선지 편집")).toHaveCount(0);

  const mapBox = await page.getByTestId("route-map-viewport").boundingBox();
  const mapSurfaceBox = await page
    .getByTestId("route-map-surface")
    .boundingBox();

  expect(mapBox?.height).toBeGreaterThanOrEqual(560);
  expect(mapSurfaceBox?.height).toBe(mapBox?.height);
});
