# 프론트엔드 상태 설계

## 결론

프론트엔드는 route 계산 결과를 단순 성공/실패가 아니라 `complete`, `partial`, `failed` 상태로 표시한다. 지도는 provider가 준 geometry만 선으로 그리고, 대중교통 장거리 탑승역/하차역 marker는 별도 layer로 표시한다. 화면 제목, OG metadata, route copy, 범례 정렬은 같은 정규화 규칙을 사용한다.

## 이유

- 장거리 본선 geometry가 없는데 접근/하차 도보선만 있어도 성공으로 보이면 사용자가 전체 경로가 검증됐다고 오해한다.
- H1만 정규화하면 browser title과 OpenGraph에는 legacy `PlanME` prefix가 남는다.
- 상단 `Standard / CarryME` 범례가 왼쪽으로 치우치면 탭과 범례의 그룹 관계가 깨져 보인다.

## Route State

```ts
type RouteUiStatus = "idle" | "checking" | "complete" | "partial" | "failed";

type RouteUiState = {
  status: RouteUiStatus;
  message?: string;
  warnings: string[];
  route?: RoutePlan;
  transitMarkers: TransitBoardingMarker[];
};
```

상태 표시:

- `complete`: `경로 체크 완료`
- `partial`: `일부 구간 확인 필요`
- `failed`: provider error, 좌표 누락, clarification 필요 메시지

## Map Layer

지도 layer는 역할별로 나눈다.

1. itinerary stop marker
2. provider polyline
3. transit boarding/alighting marker
4. warning/legend overlay

polyline은 `segments[].paths`에 포함된 provider geometry만 사용한다. `path`가 비어 있는 장거리 구간은 marker만 표시한다.

## Timeline

timeline은 `RoutePlan.stops`만으로 만들지 않고, 계산 결과의 transit event를 합성할 수 있어야 한다.

추천 흐름:

1. 출발 stop
2. 장거리 탑승 event
3. 장거리 하차 event
4. 방문지 또는 숙소 도착 stop

탑승/하차 event는 실제 역/터미널 이름이 있으면 우선 사용하고, 없으면 `대중교통 탑승`, `대중교통 하차`로 fallback한다.

## 제목과 문구 정규화

공통 helper를 둔다.

```ts
function normalizeItineraryDisplayTitle(title: string): string {
  return title.replace(/^PlanME\s+/i, "").trim();
}

function normalizeRouteDescription(description: string): string {
  const value = description.replace(/^ChatGPT\s*초안을\s*기준으로\s*한\s*/i, "").trim();
  return value === "일반 이동 흐름" ? "짐을 직접 들고 이동하는 일반 동선" : value;
}
```

적용 대상:

- detail page H1
- metadata title
- OpenGraph title
- OG image query title
- route comparison card description

CarryME description은 `짐은 CarryME가 이동하고 여행자는 일정으로 바로 이동`으로 유지한다.

## 범례 정렬

상단 `Standard / CarryME` 범례는 탭/일차 선택과 한 그룹처럼 중앙 또는 오른쪽 기준으로 정렬한다. 모바일에서는 줄바꿈 시에도 왼쪽으로 고립되지 않게 `justifyContent`, `flexWrap`, `minWidth`를 명시한다.

## 리스크

- route state가 늘어나면 기존 E2E selector가 깨질 수 있다.
- timeline 합성이 route plan과 computed route 사이에서 중복 표시를 만들 수 있다.
- 지도 marker layer가 많아지면 모바일에서 label overlap이 생길 수 있다.

## 검증 연결

- partial route를 `경로 체크 완료`로 오인 표시하지 않음
- 지도에 장거리 첫 탑승역/최종 하차역 마커 표시
- 타임라인에 장거리 탑승/하차 이벤트 표시
- metadata/OG/H1에서 `PlanME` prefix 제거
- `ChatGPT 초안` 문구 미노출
- CarryME 설명 문구 고정
- 상단 `Standard / CarryME` 정렬 확인
