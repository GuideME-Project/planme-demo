# 좌표 보장 구현 계획

## 결론

좌표 보장은 OpenAI Function Calling 후보 검증 결과에 적용하는 hard gate이다. Google/Naver 검색 후보를 코드가 자동 채택하지 않는다. 최종 stop은 AI가 선택한 후보를 기반으로 하며, 좌표와 `placeId` 또는 검색 출처를 반드시 가져야 한다.

## 공식 문서 확인사항

- Google Places Text Search (New)는 `textQuery` 기반 후보 검색이다.
- Google Places Nearby Search (New)는 `locationRestriction.circle.center`와 `radius`를 사용한다.
- Places API (New)는 응답 필드를 `X-Goog-FieldMask`로 지정해야 하며, 필요한 최소 필드만 요청해야 한다.
- Nearby Search의 product 제한은 최대 20km로 둔다.

## 변경 파일 후보

| 파일 | 작업 |
| --- | --- |
| `packages/planme-core/src/place-candidates.ts` | 단일 후보 반환을 후보 목록 반환으로 변경 |
| `packages/planme-core/src/gpt-actions.ts` | hard gate와 `needs_clarification` 분기 |
| `packages/planme-core/src/draft-itineraries.ts` | 좌표 없는 stop의 `geoPath` 조용한 누락 방지 |
| `apps/mcp/scripts/check-planme-mcp.ts` | hard gate, 20km 제한, 자동 대체 금지 테스트 |

## 구현 순서

1. `PlanmePlaceCandidateSearchResult`를 `candidate` 단수에서 `candidates` 배열 중심으로 바꾼다.
2. Google Text Search 응답에서 최대 10개 후보를 정규화한다.
3. Google Nearby Search 응답에서 최대 10개 후보를 정규화한다.
4. Naver 결과가 있으면 같은 후보 모델로 정규화한다.
5. `sourceRef`를 추가해 `placeId`가 없는 후보의 검색 출처를 보존한다.
6. AI가 선택한 `selectedCandidateId`를 후보 목록에서 찾는다.
7. 선택 후보에 좌표가 없으면 hard gate 실패로 처리한다.
8. 선택 후보에 `placeId`와 검색 출처가 모두 없으면 hard gate 실패로 처리한다.
9. hard gate를 통과한 후보만 stop에 반영한다.
10. hard gate 실패 stop이 하나라도 있으면 pageUrl 생성 전에 `needs_clarification`으로 전환한다.

## 후보 타입

후보:

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
```

## Hard Gate

필수 조건:

- `coordinate.lat`와 `coordinate.lng`가 number이다.
- `placeId`가 있거나 `sourceRef`가 있다.

실패 처리:

- stop을 저장하지 않는다.
- `geoPath`를 생성하지 않는다.
- preview store 저장을 호출하지 않는다.
- MCP 응답은 `needs_clarification` 또는 hard gate 실패 사유를 포함한다.

## Text Search 구현 규칙

- `languageCode: "ko"`
- `regionCode: "KR"`
- `pageSize` 또는 반환 후보 수는 최대 10개
- `textQuery`는 사용자 표현, 지역, 선호를 포함한다.
- 중심 좌표가 있으면 `locationBias.circle`을 사용할 수 있다.
- `locationBias`와 `locationRestriction`은 동시에 보내지 않는다.
- 응답 후보를 검색 순위만으로 자동 채택하지 않는다.

## Nearby Search 구현 규칙

- `maxResultCount: 10`
- `rankPreference: "DISTANCE"`
- `locationRestriction.circle.radius`는 최대 20000
- `includedTypes`는 과하게 제한하지 않는다.
- 응답 후보를 검색 순위만으로 자동 채택하지 않는다.

## 테스트 계획

- Text Search가 후보 여러 개를 반환해도 코드가 첫 후보를 자동 선택하지 않음
- AI가 선택한 후보만 hard gate 대상이 됨
- 선택 후보 좌표가 없으면 pageUrl 없이 `needs_clarification`
- 선택 후보에 `placeId`와 `sourceRef`가 모두 없으면 pageUrl 없이 `needs_clarification`
- Nearby Search가 20km 초과 radius를 호출하지 않음
- 좌표 없는 stop이 `geoPath`에서 조용히 빠지지 않음

## 미해결 구현 확인

- Naver 결과의 안정적인 `sourceRef` 구성 방식
- 기존 테스트가 단일 후보 반환을 전제로 하는 부분의 갱신 범위
