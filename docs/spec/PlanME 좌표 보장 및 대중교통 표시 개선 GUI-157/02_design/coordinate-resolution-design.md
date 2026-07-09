# 좌표 보장 설계

## 결론

좌표 보장은 OpenAI Function Calling 기반 장소 검증 흐름의 hard gate로 다룬다. Google/Naver는 AI를 대체하는 자동 선택기가 아니라, PlanME 서버가 함수 호출을 받아 실행하는 외부 장소 검색 도구이다.

OpenAI가 만든 장소명은 Google/Naver 후보와 연결되어야 하며, 최종 저장되는 stop은 좌표와 `placeId` 또는 검색 출처를 가져야 한다. 검색 1순위 후보를 코드가 자동 채택하는 방식은 사용하지 않는다.

## 이유

- 좌표 없는 방문지가 저장되면 지도 마커, 경로 재계산, 대중교통 탑승/하차 표시가 연쇄적으로 불안정해진다.
- `거제도 바다 낚시터` 같은 일반 표현은 실제 장소라기보다 사용자 의도일 수 있다.
- Google Places 1순위가 사용자 의도와 맞는 장소라는 보장은 없다.
- 좌표 보장을 링크 생성의 전제 조건으로 두면 사용자가 빈 지도나 잘못된 상세 페이지를 보지 않는다.

## 범위

포함:

- 숙소, 활동지, 식사/카페, 교통 거점 등 일정 stop 전체의 좌표 보장
- Function Calling으로 실행되는 `search_places_text`, `search_places_nearby`
- Google Places Text Search와 Nearby Search 결과 정규화
- Naver 결과의 검색 출처 식별자 보존
- 좌표와 `placeId` 또는 검색 출처 hard gate
- 후보가 없거나 hard gate 실패 시 링크/위젯 미생성

제외:

- Google Places 1순위 자동 대체
- 웹 화면에서 사용자가 후보를 직접 고르는 위젯
- 거리 기준 hard gate
- 환승역 전체 후보 검색
- 실제 RestME/CarryME API 연동

## 데이터 모델

```ts
type PlaceSearchSource =
  | "google_text_search"
  | "google_nearby_search"
  | "naver_geocode"
  | "input";

type PlanmePlaceCandidate = {
  candidateId: string;
  name: string;
  address?: string;
  coordinate: MapCoordinate;
  placeId?: string;
  source: PlaceSearchSource;
  sourceRef: string;
  query?: string;
  radiusMeters?: number;
  types?: string[];
};

type PlaceResolutionIssue = {
  stopName: string;
  reason:
    | "missing_coordinate"
    | "missing_source"
    | "no_candidate"
    | "ambiguous"
    | "rejected"
    | "provider_error";
  questions?: string[];
  searchedQueries?: string[];
};

type PlaceResolutionLog = {
  originalName: string;
  selectedName?: string;
  decision: "accepted" | "ambiguous" | "rejected" | "hard_gate_failed";
  source?: PlaceSearchSource;
  query?: string;
  radiusMeters?: number;
  reason: string;
};
```

`AccommodationCandidate`의 일부 구조는 재사용할 수 있지만, 숙소 전용 필터는 일반 방문지 검색에 강제하지 않는다.

## 처리 흐름

1. OpenAI 일정 초안 생성 요청에 장소 검색 함수를 제공한다.
2. 모델이 일정에 넣을 장소마다 `search_places_text` 또는 `search_places_nearby` 호출을 요청한다.
3. PlanME 서버가 Google/Naver API를 실행하고 후보를 정규화해 모델에 돌려준다.
4. 모델은 후보를 보고 초안에 반영할 장소를 판단한다.
5. 초안 생성 후 후보 검증 단계에서 다시 AI 판단과 hard gate를 수행한다.
6. `accepted`이고 hard gate를 통과하면 stop에 후보의 이름, 주소, 좌표, 출처를 반영한다.
7. `ambiguous` 또는 `rejected`이면 상세 링크를 만들지 않고 MCP `needs_clarification` 응답으로 전환한다.
8. 후보가 없거나 hard gate를 통과하지 못하면 상세 링크와 위젯을 만들지 않는다.

## 검색 도구 역할

### Text Search

- 사용 목적: 사용자 표현과 지역 맥락으로 후보를 넓게 찾는다.
- 예: `거제 바다전망 숙소`, `거제 낚시공원`, `양양 아이 실내 체험`
- 반환 후보: 기본 5개, 최대 10개
- 선택 방식: 검색 순위만으로 채택하지 않고 AI가 의도 적합성을 판단한다.

### Nearby Search

- 사용 목적: 목적지, 숙소, 이미 확정된 장소 주변 후보를 찾는다.
- 최대 반경: 20km
- 반환 후보: 기본 5개, 최대 10개
- 선택 방식: 주변 후보 역시 AI 판단과 hard gate를 모두 통과해야 한다.

## 좌표 반영 규칙

- 원본 stop은 선택된 후보의 `name`, `address`, `coordinate`, `placeId`, `source`, `sourceRef`를 받아 갱신한다.
- 원본 사용자의 표현은 resolution log에 남긴다.
- 지도와 경로 계산은 hard gate를 통과한 좌표만 사용한다.
- 좌표 없는 stop을 `geoPath`에서 조용히 제외하지 않는다.
- hard gate 실패 stop이 하나라도 남으면 생성 링크를 만들지 않는다.

## 리스크

- Function Calling 호출량이 일정 길이에 따라 증가한다. 호출 예산은 구현 계획에서 동적으로 제한한다.
- Naver 후보는 Google `placeId`가 없을 수 있으므로 `sourceRef`가 약하면 추적성이 떨어진다.
- 거리 기준을 hard gate로 두지 않기 때문에, 의도와 거리의 충돌은 AI 피드백과 검증 테스트로 확인한다.

## 구현 메모

- `packages/planme-core/src/openai-itinerary-generator.ts`에 Function Calling loop와 tool result 전달 구조가 필요하다.
- `packages/planme-core/src/place-candidates.ts`는 단일 후보 반환이 아니라 후보 목록 반환 구조로 바꾼다.
- `packages/planme-core/src/gpt-actions.ts`의 `createAiRecommendedItineraryResponse`는 `accepted`, `ambiguous`, `rejected`, hard gate 결과에 따라 ready 또는 clarification으로 분기한다.
- `packages/planme-core/src/draft-itineraries.ts`의 `geoPath` 생성은 hard gate 통과 후에만 허용한다.

## 검증 연결

- 좌표 없는 stop은 링크로 저장되지 않는다.
- `placeId` 또는 검색 출처 없는 stop은 링크로 저장되지 않는다.
- Google Places 1순위 자동 대체는 사용하지 않는다.
- Text Search와 Nearby Search 후보 모두 AI 판단을 통과해야 한다.
- Nearby Search 최대 반경 20km를 넘지 않는다.
