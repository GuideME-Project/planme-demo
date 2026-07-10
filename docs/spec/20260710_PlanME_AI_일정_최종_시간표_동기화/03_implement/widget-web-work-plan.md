# ChatGPT 위젯·상세 웹 구현계획

## 결론

- ChatGPT는 생성 도구 실행 상태를 보여준 뒤 전체 계산 성공 시 최종 위젯을 한 번만 표시한다.
- 상세 웹은 저장된 경로를 초기 상태로 사용하고 일차 최초 전환 때 재계산하지 않는다.
- AI 장소 순서와 시간표 내용은 수정하지 않는다.

## 작업 순서

### 1. MCP 위젯 조회를 저장 결과 기준으로 전환

1. 웹 일정 조회 API를 호출하는 MCP 서버 함수를 추가한다.
2. `get_planme_itinerary` 처리기를 비동기로 변경한다.
3. 저장된 최종 일정이 없거나 버전 1이면 위젯을 표시하지 않는다.
4. 최종 일정의 첫째 날 Standard·CarryME 이동 시간을 위젯에 전달한다.
5. 위젯 생성 도구 호출 횟수가 한 번인지 계약 테스트에 추가한다.

### 2. 위젯 문구와 값 연결 정리

1. `총 이동 시간(예상)`에서 `예상` 문구를 제거한다.
2. Standard와 CarryME의 `durationLabel`은 최종 제공자 값만 사용한다.
3. 절약 시간은 최종 `durationMinutes` 차이로 계산한다.
4. 실패한 일정은 위젯 템플릿에 전달하지 않는다.
5. 위젯 자체 폴링과 계산 중 상태는 추가하지 않는다.

### 3. 상세 페이지에 최종화 여부 전달

1. 저장소 조회 결과에 일정과 버전 2 최종화 여부를 함께 제공하는 내부 함수를 추가한다.
2. 상세 페이지 서버 컴포넌트가 `routeFinalized` 상태를 대시보드에 전달한다.
3. 결정적 데모 일정과 생성 일정의 기존 조회 경로를 깨지 않게 한다.
4. OG 이미지와 공유 API는 최종 저장값을 우선 사용한다.

### 4. 저장된 경로를 상세 화면 초기 상태로 사용

1. 각 일차의 저장된 `geoSegments`, `durationMinutes`, `durationLabel`, `transitMarkers`를 편집 상태에 보존한다.
2. 버전 2 일정에서는 초기 `useEffect` 경로 호출을 실행하지 않는다.
3. 일차 탭 변경 시 저장된 해당 일차 경로로 교체한다.
4. 저장된 경로를 지우는 `setComputedRoutes({})` 호출을 최종 일정 탭 전환에서는 제거한다.
5. 지도는 직선 대체 경로 없이 저장된 제공자 경로만 그린다.

### 5. 기존 일정·편집 재계산 상태 연결

1. 버전 1 일정은 장소 순서와 마커만 표시하고 이동 시간·지도 선을 계산 중으로 둔다.
2. 재계산 API 성공 후 전체 일정을 한 번에 교체한다.
3. 실패하면 기존 일정 또는 마지막 성공 일정으로 되돌린다.
4. 계산 중 일정 변경 버튼을 비활성화한다.
5. 완료 후에만 이동 시간과 절약 시간을 표시한다.

## 변경 파일 후보

| 파일 | 변경 목적 | 주의점 |
| --- | --- | --- |
| `apps/mcp/src/planme-mcp.ts` | 저장된 최종 일정 조회 후 위젯 표시 | 위젯 조회 한 번 원칙 유지 |
| `apps/mcp/src/planme-widget.ts` | 최종 이동 시간 문구와 값 표시 | 위젯 폴링 추가 금지 |
| `packages/planme-core/src/gpt-actions.ts` | 최종 일정 응답 변환 유지·보강 | 첫째 날 위젯 계약 유지 |
| `apps/web/app/itinerary/[id]/page.tsx` | 최종화 여부 전달 | 기존 정적 데모 호환 |
| `apps/web/components/itinerary/ItineraryDashboard.tsx` | 저장 경로 초기화, 계산 중·실패 상태 | AI 시간표 변경 금지 |
| `apps/web/components/itinerary/TimelinePanel.tsx` | `예상` 문구 제거 | 레이아웃 회귀 방지 |
| `apps/web/app/og/itinerary/[itineraryId]/route.tsx` | 최종 이동 시간 표기 | 기존 OG 크기 유지 |
| `apps/web/e2e/gpt-itinerary-generation.spec.ts` | 최종 저장 일정 로딩 | 서버 제공자 응답 모킹 필요 |
| `apps/web/e2e/itinerary-finalized-routes.spec.ts` | 신규 최종 경로 탭·새로고침 검증 | 최초·반복 전환 모두 확인 |

## 상태 계획

후보: 대시보드에 서버 상태를 명시적으로 전달한다.

```ts
type ItineraryDashboardProps = {
  itinerary: PlanmeItinerary;
  routeFinalized: boolean;
};
```

클라이언트 상태:

```ts
type RouteFinalizationUiState =
  | { status: "ready" }
  | { status: "calculating" }
  | { status: "failed"; message: string };
```

- `ready`: 저장된 이동 시간과 지도 경로 표시
- `calculating`: 장소·시간표·마커 유지, 이동 시간·절약 시간·지도 선 숨김
- `failed`: 기존 일정 유지, 실패 안내 표시
- `null` 상태는 사용하지 않는다.

## 표시 계약

| 화면 값 | 구현 기준 |
| --- | --- |
| AI 시간표 | 계산 전후 동일한 배열 사용 |
| Standard 총 이동 시간 | 저장된 길찾기 구간 합계 |
| CarryME 총 이동 시간 | 저장된 길찾기 구간 합계 |
| 절약 시간 | Standard 합계 - CarryME 합계, 최소 0분 |
| 지도 경로 | 저장된 제공자 구간 형상 |
| 지도 마커 | 확정 좌표를 항상 표시 |

## 핵심 구현 예시

후보: 최종 저장 일정은 초기 제공자 호출을 생략한다.

```ts
useEffect(() => {
  if (routeFinalized) {
    setComputedRoutes(createStoredComputedRoutes(selectedDayPlan));
    return;
  }

  void finalizeLegacyOrEditedItinerary();
}, [routeFinalized, selectedDayPlan]);
```

후보: 탭 변경은 저장 경로만 선택한다.

```ts
function handleDayChange(_: MouseEvent<HTMLElement>, day: number | null) {
  if (!day) {
    return;
  }

  setSelectedDay(day);
}
```

## UI 완료 조건

- ChatGPT 위젯은 최종 계산 후 정확히 한 번 표시된다.
- 위젯과 상세 웹의 첫째 날 이동 시간이 동일하다.
- 상세 웹 최초 로딩 3초 후에도 이동 시간과 시간표 내용이 바뀌지 않는다.
- 1일차·2일차 첫 전환과 반복 전환에서 제공자 API를 다시 호출하지 않는다.
- 경로 계산 전 직선이 표시되지 않는다.
- 지도 영역의 빈 높이 회귀가 없다.
