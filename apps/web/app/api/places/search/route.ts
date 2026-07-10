import {
  PlanmePlaceSearchConfigurationError,
  PlanmePlaceSearchProviderError,
  searchPlanmePlaceCandidates,
} from "@planme/core";
import { NextResponse } from "next/server";

type PlaceSearchRequest = {
  limit?: number;
  query?: string;
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
