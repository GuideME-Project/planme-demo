# 대중교통 표시 구현 계획

## 결론

ODsay 장거리 구간의 실제 polyline이 없으면 선을 그리지 않고, 첫 탑승역과 최종 하차역 marker와 timeline event만 만든다. 이 경우 route 상태는 `partial`이며, UI는 `경로 체크 완료` 대신 `일부 구간 확인 필요`를 표시한다.

## 변경 파일 후보

| 파일 | 작업 |
| --- | --- |
| `apps/web/components/itinerary/ItineraryDashboard.tsx` | ODsay segment 처리, transit marker 생성, partial route UI |
| `apps/web/e2e/destination-editor-recorded-flow.spec.ts` | 장거리 boundary-only mock과 marker/timeline 검증 |
| `scripts/check-planme-actions.mjs` | 직선 fallback 재도입 방지 |

## 구현 순서

1. route 응답 타입에 `geometryStatus`, `warnings`, `transitMarkers`를 추가한다.
2. ODsay long-distance subPath에서 첫 탑승 지점과 최종 하차 지점을 추출한다.
3. long-distance geometry가 없으면 `path: []`, `paths: []`를 유지한다.
4. segments 중 일부만 drawable이면 전체 `geometryStatus`를 `partial`로 계산한다.
5. `createComputedRouteResult`가 partial route도 marker/timeline 정보는 반영할 수 있게 한다.
6. 지도에 transit marker layer를 추가한다.
7. timeline 생성 시 탑승/하차 event를 출발/도착 사이에 삽입한다.
8. route check alert 문구를 `complete`, `partial`, `failed`로 분리한다.

## 타입 후보

후보:

```ts
type RouteGeometryStatus = "complete" | "partial" | "none";

type TransitBoardingMarker = {
  id: string;
  role: "boarding" | "alighting";
  label: string;
  coordinate: MapCoordinate;
  mode: "bus" | "subway" | "train" | "transit";
  segmentIndex: number;
};
```

## 탑승/하차 추출 규칙

- long-distance subPath 배열에서 좌표 있는 첫 `startX/startY`를 탑승 지점으로 사용한다.
- long-distance subPath 배열에서 좌표 있는 마지막 `endX/endY`를 하차 지점으로 사용한다.
- 이름은 provider name field를 우선 사용한다.
- 이름이 없으면 `대중교통 탑승`, `대중교통 하차`로 fallback한다.
- 환승역 전체는 이번 범위에서 제외한다.

## UI 표시 규칙

- `geometryStatus: "complete"`: `경로 체크 완료`
- `geometryStatus: "partial"`: `일부 구간 확인 필요`
- `geometryStatus: "none"` 또는 실패: 기존 실패 메시지

지도:

- provider가 준 `paths`만 polyline으로 그린다.
- long-distance boundary point끼리는 선으로 연결하지 않는다.
- 탑승역/하차역 marker는 stop marker와 구분한다.

타임라인:

- 출발 stop 이후 탑승 event
- 하차 event 이후 도착/방문 stop
- 시간 정보가 없으면 순서만 표시한다.

## 테스트 계획

- ODsay long-distance subPath에 좌표만 있고 `mapObj/vertices`가 없을 때 선이 생성되지 않음
- 탑승역/하차역 marker가 표시됨
- timeline에 탑승/하차 문구가 표시됨
- partial 상태에서 `경로 체크 완료`가 표시되지 않음
- 기존 Busan/KTX mock 경로가 깨지지 않음

## 중단 조건

- ODsay 응답에 탑승/하차 이름 또는 좌표가 전혀 없으면 marker 표시 품질을 재검토한다.
- partial route를 기존 `RoutePlan`에 반영하는 과정에서 static demo path와 충돌하면 설계 문서를 갱신한다.
