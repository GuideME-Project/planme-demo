import {
  PLANME_V3_ALLOWED_CONTENT_TYPE_IDS,
  PlanmePlaceSearchConfigurationError,
  PlanmePlaceSearchProviderError,
  isAllowedContentTypeId,
  normalizeTourCandidates,
  searchPlanmePlaceCandidates,
  type AllowedTourContentTypeId,
} from "@planme/core";
import { NextResponse } from "next/server";
import { getPlanmeV3Storage } from "@/lib/planme-v3/runtime";
import { createTourApiClient } from "@/lib/planme-v3/tour-api-client";
import { loadTourCandidates } from "@/lib/planme-v3/tour-cache";
import { verifyRouteFinalizationToken } from "@/lib/route-finalization-token";

type PlaceSearchRequest = {
  limit?: number;
  query?: string;
  itineraryId?: string;
  baseRevision?: number;
  contentTypeId?: number;
  token?: string;
};

const DEFAULT_PLACE_SEARCH_LIMIT = 5;
const MAX_PLACE_SEARCH_LIMIT = 5;

/**
 * Returns coordinate-bearing Naver place candidates for the destination editor.
 */
export async function POST(request: Request) {
  let body: PlaceSearchRequest;

  try {
    body = (await request.json()) as PlaceSearchRequest;
  } catch {
    return NextResponse.json(
      { candidates: [], message: "장소 검색 요청 형식을 확인해 주세요." },
      { status: 400 },
    );
  }

  const query = body.query?.trim() ?? "";
  const limit = body.limit ?? DEFAULT_PLACE_SEARCH_LIMIT;

  if (body.itineraryId?.startsWith("planme-v3-")) {
    return searchV3TourPlaces(body, query, limit);
  }

  if (query.length < 2) {
    return NextResponse.json(
      { candidates: [], message: "장소 검색어를 두 글자 이상 입력해 주세요." },
      { status: 400 },
    );
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PLACE_SEARCH_LIMIT) {
    return NextResponse.json(
      { candidates: [], message: "장소 검색 결과 개수를 확인해 주세요." },
      { status: 400 },
    );
  }

  try {
    const result = await searchPlanmePlaceCandidates({
      maxCandidates: limit,
      query,
      stop: {
        addressQuery: query,
        name: query,
        role: "방문지",
      },
    });

    return NextResponse.json({
      candidates: result.candidates.map((candidate) => ({
        address: candidate.address,
        candidateId: candidate.candidateId,
        category: candidate.category,
        coordinate: candidate.coordinate,
        name: candidate.name,
        placeSource: candidate.source,
        placeSourceRef: candidate.sourceRef,
      })),
    });
  } catch (error) {
    if (error instanceof PlanmePlaceSearchConfigurationError) {
      return NextResponse.json(
        { candidates: [], message: "장소 검색을 사용할 수 없습니다." },
        { status: 503 },
      );
    }

    if (error instanceof PlanmePlaceSearchProviderError) {
      const status = error.status === 429 ? 429 : 502;

      return NextResponse.json(
        { candidates: [], message: "장소 검색에 실패했습니다. 잠시 후 다시 시도해 주세요." },
        { status },
      );
    }

    return NextResponse.json(
      { candidates: [], message: "장소 검색 요청을 완료하지 못했습니다." },
      { status: 502 },
    );
  }
}

async function searchV3TourPlaces(
  body: PlaceSearchRequest,
  query: string,
  limit: number,
) {
  if (
    query.length < 2 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 10 ||
    !Number.isInteger(body.baseRevision) ||
    typeof body.token !== "string" ||
    !verifyRouteFinalizationToken(
      body.token,
      body.itineraryId ?? "",
      Number(body.baseRevision),
    )
  ) {
    return NextResponse.json(
      { candidates: [], message: "장소 검색 요청을 확인해 주세요." },
      { status: 400 },
    );
  }
  if (
    body.contentTypeId !== undefined &&
    !isAllowedContentTypeId(body.contentTypeId)
  ) {
    return NextResponse.json(
      { candidates: [], message: "TourAPI 장소 유형을 확인해 주세요." },
      { status: 400 },
    );
  }

  try {
    const itineraryId = body.itineraryId ?? "";
    const revision = await getPlanmeV3Storage().jobStore.getRevision(
      itineraryId,
      Number(body.baseRevision),
    );
    if (!revision) {
      return NextResponse.json(
        { candidates: [], message: "최신 일정을 다시 불러와 주세요." },
        { status: 409 },
      );
    }
    const regionCode = revision.plan.lodging.regionCode;
    if (!regionCode) {
      return NextResponse.json(
        { candidates: [], message: "일정의 TourAPI 지역을 확인할 수 없습니다." },
        { status: 409 },
      );
    }
    const districtCode = revision.plan.lodging.districtCode ?? null;
    const contentTypes: AllowedTourContentTypeId[] = body.contentTypeId === undefined
      ? [...PLANME_V3_ALLOWED_CONTENT_TYPE_IDS]
      : [body.contentTypeId as AllowedTourContentTypeId];
    const client = createTourApiClient();
    const candidates = [];
    let unavailableCount = 0;
    const travelEndDate = calculateTravelEndDate(
      revision.intent.travelStartDate,
      revision.intent.durationDays,
    );

    for (const contentTypeId of contentTypes) {
      const loaded = await loadTourCandidates({
        cache: getPlanmeV3Storage().tourCache,
        scope: { regionCode, districtCode, contentTypeId },
        fetchFromTourApi: async () => {
          const result = await client.listCandidates({
            region: {
              regionCode,
              regionName: revision.intent.destination,
              ...(districtCode ? { districtCode } : {}),
            },
            contentTypeId,
            travelStartDate: revision.intent.travelStartDate,
            travelEndDate,
          });
          if (result.status === "failure") return { status: "failure" };
          return {
            status: "success",
            places: normalizeTourCandidates(
              result.status === "empty" ? [] : result.records,
              {
                expectedRegionCode: regionCode,
                expectedDistrictCode: districtCode ?? undefined,
                fetchedAt: new Date().toISOString(),
                travelStartDate: revision.intent.travelStartDate,
                travelEndDate,
              },
            ),
          };
        },
      });
      if (loaded.status === "unavailable") {
        unavailableCount += 1;
      } else {
        candidates.push(...loaded.places);
      }
    }
    if (unavailableCount === contentTypes.length) {
      return NextResponse.json(
        { candidates: [], message: "TourAPI 장소 검색을 완료하지 못했습니다." },
        { status: 502 },
      );
    }
    const comparableQuery = query.toLocaleLowerCase("ko");
    const matched = candidates
      .filter((candidate) =>
        `${candidate.title} ${candidate.address ?? ""}`
          .toLocaleLowerCase("ko")
          .includes(comparableQuery),
      )
      .sort((left, right) =>
        left.title.localeCompare(right.title, "ko") ||
        left.contentId.localeCompare(right.contentId),
      )
      .slice(0, limit);
    return NextResponse.json({
      candidates: matched.map((candidate) => ({
        contentId: candidate.contentId,
        contentTypeId: candidate.contentTypeId,
        title: candidate.title,
        address: candidate.address,
        coordinate: candidate.coordinate,
      })),
    });
  } catch {
    return NextResponse.json(
      { candidates: [], message: "TourAPI 장소 검색을 완료하지 못했습니다." },
      { status: 502 },
    );
  }
}

function calculateTravelEndDate(startDate: string | undefined, durationDays: number) {
  if (!startDate) return undefined;
  const value = new Date(`${startDate}T00:00:00.000Z`);
  if (!Number.isFinite(value.getTime())) return undefined;
  value.setUTCDate(value.getUTCDate() + durationDays - 1);
  return value.toISOString().slice(0, 10);
}
