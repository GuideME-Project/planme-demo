# 대중교통 경로 표시 설계

## 결론

ODsay 장거리 대중교통 구간이 실제 polyline을 제공하지 않으면 지도에 선을 그리지 않는다. 대신 장거리 구간의 첫 탑승역과 최종 하차역만 지도 마커와 타임라인 이벤트로 표시한다. 이 상태는 전체 성공이 아니라 partial route로 취급해 `경로 체크 완료`처럼 오인되는 문구를 피한다.

## 이유

- ODsay 장거리 subPath가 `startX`, `startY`, `endX`, `endY`만 제공하는 경우, 두 경계점을 직선으로 연결하면 실제 경로가 아닌 선이 지도에 표시된다.
- 사용자가 필요한 정보는 실제 장거리 선보다 어디서 타고 어디서 내리는지다.
- partial route 상태를 명확히 해야 지도에 선이 없는데 시간/거리가 검증 완료처럼 보이는 문제를 막을 수 있다.

## 범위

### 포함

- 장거리 첫 탑승역/최종 하차역 추출
- 지도 탑승역/하차역 마커 표시
- 타임라인 탑승/하차 이벤트 표시
- 실제 polyline 없는 장거리 구간의 선 표시 금지
- partial route 상태와 warning 표시

### 제외

- 환승역 전체 노출
- 모든 정류장 상세 노출
- 장거리 polyline 직접 추정 또는 외부 경로 보간

## 추천 응답 모델

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

type RouteCheckApiResponse = {
  ok: boolean;
  geometryStatus?: RouteGeometryStatus;
  warnings?: string[];
  transitMarkers?: TransitBoardingMarker[];
  path?: MapCoordinate[];
  segments?: Array<{
    distanceMeters: number;
    durationSeconds: number;
    mode: DestinationMode;
    path: MapCoordinate[];
    paths?: MapCoordinate[][];
    geometryStatus?: RouteGeometryStatus;
  }>;
};
```

기존 응답과 호환하려면 필드는 optional로 추가한다. UI는 `geometryStatus`가 없으면 기존 방식으로 처리한다.

## ODsay 처리 흐름

1. ODsay `searchPubTransPathT` 응답에서 첫 path를 선택한다.
2. local bus/subway subPath가 `mapObj` 또는 lane geometry를 주면 기존처럼 `paths`에 넣는다.
3. long-distance subPath가 실제 vertices 또는 lane geometry를 주지 않으면 `path: []`, `paths: []`로 유지한다.
4. long-distance subPath의 첫 유효 `startName/startX/startY`를 boarding marker로 만든다.
5. long-distance subPath의 마지막 유효 `endName/endX/endY`를 alighting marker로 만든다.
6. route 전체에 drawable path가 일부만 있으면 `geometryStatus: "partial"`을 반환한다.
7. drawable path가 전혀 없고 marker만 있으면 `geometryStatus: "partial"`로 두되, UI 문구는 `경로 일부 확인 필요`로 표시한다.

## 지도 표시

- blue/green route polyline은 `paths`가 있는 구간만 그린다.
- 장거리 경계점끼리는 선을 연결하지 않는다.
- boarding marker label 예: `탑승: 양양터미널`
- alighting marker label 예: `하차: 거제터미널`
- stop 번호 마커와 transit marker는 역할이 다르므로 시각적으로 구분한다.

## 타임라인 표시

기존 출발/도착 timeline 사이에 장거리 탑승/하차 이벤트를 추가한다.

예:

```text
09:30 강원도 양양 출발
10:20 양양터미널 탑승
15:00 거제터미널 하차
15:30 대산오션뷰스파펜션 도착
```

시간이 없으면 제공 가능한 순서만 보장하고, 문구는 `대중교통 탑승`, `대중교통 하차`로 fallback한다.

## Partial Route 문구

- complete: `경로 체크 완료`
- partial: `일부 구간 확인 필요`
- failed: provider error 또는 좌표 누락 메시지

partial 상태에서는 총 이동 시간/거리 표시를 하더라도 본선 geometry가 누락됐다는 warning을 함께 표시한다.

## 리스크

- ODsay 응답에 역/터미널 이름 없이 좌표만 있는 경우 marker label 품질이 낮아질 수 있다.
- partial 상태를 너무 강하게 실패처럼 보이면 사용자가 실제로 가능한 일정도 실패로 오해할 수 있다.
- 시간 계산은 가능하지만 geometry가 없을 수 있으므로 UI가 시간과 지도 선을 분리해서 표현해야 한다.

## 검증 연결

- 대중교통 장거리 본선 polyline 없으면 선 없음
- 지도에 장거리 첫 탑승역/최종 하차역 마커 표시
- 타임라인에 장거리 탑승/하차 이벤트 표시
- partial route를 `경로 체크 완료`로 오인 표시하지 않음
