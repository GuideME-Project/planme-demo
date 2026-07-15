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
    resolveRegion: async (destination) => resolveLocalTourRegion(destination),
    geocodeAnchor: async (query) => ({
      status: "ready",
      coordinate: resolveLocalCoordinate(query),
    }),
    listCandidates: async ({ contentTypeId, region }) =>
      createLocalTourCandidateResponse(contentTypeId, region.regionCode),
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
  regionCode: string,
) {
  const isYangyang = regionCode === "51";
  if (contentTypeId === 12) {
    return {
      status: "success" as const,
      totalCount: 1,
      records: [
        {
          contentid: isYangyang ? "local-yangyang-visit-1" : "local-busan-visit-1",
          contenttypeid: 12,
          title: isYangyang ? "낙산사" : "해운대",
          mapx: isYangyang ? 128.6279 : 129.1587,
          mapy: isYangyang ? 38.125 : 35.1587,
          addr1: isYangyang ? "강원특별자치도 양양군 강현면" : "부산광역시 해운대구",
          lDongRegnCd: regionCode,
          lDongSignguCd: isYangyang ? "830" : "260",
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
          contentid: isYangyang ? "local-yangyang-lodging-1" : "local-busan-lodging-1",
          contenttypeid: 32,
          title: isYangyang ? "양양 호텔" : "부산 호텔",
          mapx: isYangyang ? 128.619 : 129.0756,
          mapy: isYangyang ? 38.0754 : 35.1796,
          addr1: isYangyang ? "강원특별자치도 양양군 양양읍" : "부산광역시 중구",
          lDongRegnCd: regionCode,
          lDongSignguCd: isYangyang ? "830" : "260",
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

function resolveLocalTourRegion(destination: string) {
  if (destination.includes("부산")) {
    return {
      regionCode: "26",
      regionName: "부산광역시",
      districtCode: "260",
      districtName: "중구",
    };
  }
  if (destination.includes("양양")) {
    return {
      regionCode: "51",
      regionName: "강원특별자치도",
      districtCode: "830",
      districtName: "양양군",
    };
  }
  return null;
}

function resolveLocalCoordinate(query: string) {
  if (query === "서울역") return { lat: 37.5547, lng: 126.9707 };
  if (query.includes("동탄")) return { lat: 37.2017, lng: 127.071 };
  if (query.includes("마포구청")) return { lat: 37.5663, lng: 126.9014 };
  if (query.includes("양양")) return { lat: 38.0754, lng: 128.619 };
  return { lat: 35.1151, lng: 129.0414 };
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
