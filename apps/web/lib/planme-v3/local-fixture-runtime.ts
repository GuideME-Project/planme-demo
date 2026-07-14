import type {
  AllowedTourContentTypeId,
  PlanmeUsageRecorder,
  RouteSegment,
} from "@planme/core";
import type { PlanmeV3JobStore } from "./job-store";
import {
  createPlanmeV3Orchestrator,
  type PlanmeV3OrchestratorDependencies,
} from "./orchestrator";
import type { PlanmeV3TourCache } from "./tour-cache";

const LOCAL_FIXTURE_ENV = "PLANME_V3_LOCAL_FIXTURE";

export function isPlanmeV3LocalFixtureEnabled() {
  return process.env.NODE_ENV !== "production" &&
    process.env[LOCAL_FIXTURE_ENV]?.trim() === "1";
}

export function createPlanmeV3LocalFixtureRuntime(input: {
  jobStore: PlanmeV3JobStore;
  tourCache: PlanmeV3TourCache;
  pageOrigin: string;
  usageRecorder?: PlanmeUsageRecorder;
}) {
  return createPlanmeV3Orchestrator({
    jobStore: input.jobStore,
    tourCache: input.tourCache,
    pageOrigin: input.pageOrigin,
    usageRecorder: input.usageRecorder,
    resolveRegion: async () => ({
      regionCode: "26",
      regionName: "부산광역시",
      districtCode: "260",
      districtName: "중구",
    }),
    geocodeAnchor: async (query) => ({
      status: "ready",
      coordinate: query === "서울역"
        ? { lat: 37.5547, lng: 126.9707 }
        : { lat: 35.1796, lng: 129.0756 },
    }),
    listCandidates: async ({ contentTypeId }) =>
      createLocalTourCandidateResponse(contentTypeId),
    planCandidates: async ({ candidates, intent }) => ({
      ok: true,
      attempts: 0,
      source: "deterministic",
      selection: {
        lodgingContentId: candidates.find(
          (candidate) => candidate.contentTypeId === 32,
        )?.contentId ?? "",
        days: Array.from({ length: intent.durationDays }, (_, index) => ({
          day: index + 1,
          orderedVisitContentIds: index === 0
            ? candidates
                .filter((candidate) => candidate.contentTypeId === 12)
                .map((candidate) => candidate.contentId)
            : [],
          restaurantContentIds: [],
        })),
      },
    }),
    routeSegment: createLocalRouteSegment,
  });
}

function createLocalTourCandidateResponse(
  contentTypeId: AllowedTourContentTypeId,
) {
  if (contentTypeId === 12) {
    return {
      status: "success" as const,
      totalCount: 1,
      records: [
        {
          contentid: "local-visit-1",
          contenttypeid: 12,
          title: "해운대",
          mapx: 129.1587,
          mapy: 35.1587,
          addr1: "부산광역시 해운대구",
          lDongRegnCd: "26",
          lDongSignguCd: "260",
        },
      ],
    };
  }
  if (contentTypeId === 32) {
    return {
      status: "success" as const,
      totalCount: 1,
      records: [
        {
          contentid: "local-lodging-1",
          contenttypeid: 32,
          title: "부산 호텔",
          mapx: 129.0756,
          mapy: 35.1796,
          addr1: "부산광역시 중구",
          lDongRegnCd: "26",
          lDongSignguCd: "260",
        },
      ],
    };
  }
  return {
    status: "empty" as const,
    records: [] as [],
    totalCount: 0 as const,
  };
}

const createLocalRouteSegment: PlanmeV3OrchestratorDependencies["routeSegment"] =
  async ({ from, to, transportMode }) => {
    const durationSeconds =
      from.ref === "origin" && to.ref === "local-lodging-1"
        ? 1_800
        : from.ref === "origin" || to.ref === "origin"
          ? 1_200
          : 600;
    const segment: RouteSegment = {
      fromRef: from.ref,
      toRef: to.ref,
      mode: transportMode,
      source: transportMode === "drive" ? "naver" : "odsay",
      distanceMeters: durationSeconds * 10,
      durationSeconds,
      geometryStatus: "complete",
      paths: [[from.coordinate, to.coordinate]],
    };
    return { status: "ready", segment };
  };
