# 경로 최종화와 표시

## 목적

공급자가 계산한 실제 또는 추정 이동시간을 이후 일정 시각에 반영하고, 추정값을 실제값처럼 비교하거나 지도에 표시하지 않는다.

## 현재 문제

- 현재 `itinerary-route-finalizer`는 AI 시간표 배열을 바이트 단위로 보존하고 변경되면 실패한다.
- `TimelineEvent`는 어느 경로 정류장과 연결되는지 알 수 없다.
- `RoutePlan`과 `RouteProviderSegment`에는 이동시간이 공급자 값인지 추정값인지 나타내는 계약이 없다.
- `savingMinutes`와 절약 문구는 추정 구간이 있어도 계산·표시될 수 있다.

## 신규 데이터 계약

### AI 초안

모델 출력 스키마에 내부 전용 필드를 추가한다.

```ts
type PlanmeDraftTimelineEvent = {
  stopIndex?: number;
  stayDurationMinutes?: number;
  // 기존 필드 생략
};
```

- `stopIndex`는 해당 경로의 정류장 배열 인덱스다.
- `stayDurationMinutes`는 장소 도착 후 다음 출발까지의 체류시간이다.
- 공개 GPT 요청 필드가 아니라 MCP 내부 생성 계약이다.
- 신규 생성 결과는 여행자 경로 정류장마다 정확히 하나의 대표 타임라인 이벤트를 가져야 한다.

### 저장 시간표

```ts
type TimelineEvent = {
  stopRef?: string;
  stayDurationMinutes?: number;
  // 기존 필드 생략
};
```

초안의 `stopIndex`는 정규화 단계에서 서버가 만든 `stopRef`로 변환한다. 장소명으로 연결 관계를 추론하지 않는다.

### 경로와 절약시간

```ts
type RoutePlan = {
  durationSource?: "provider" | "estimated";
  estimatedSegmentIndexes?: number[];
  // 기존 필드 생략
};

type ItineraryDay = {
  savingStatus?: "verified" | "hidden_estimated";
  savingMinutes?: number;
  // 기존 필드 생략
};
```

- 모든 구간이 공급자 값이면 경로의 `durationSource="provider"`다.
- 하나라도 추정이면 `durationSource="estimated"`다.
- `estimatedSegmentIndexes`는 0부터 시작하는 구간 번호를 저장한다.
- Standard와 CarryME 모두 공급자 값일 때만 `savingStatus="verified"`다.
- 어느 한쪽이라도 추정이면 `savingStatus="hidden_estimated"`이고 `savingMinutes`를 저장·응답에서 생략한다.
- 레거시 데이터에 `savingStatus`가 없고 `savingMinutes`가 있으면 기존 표시를 보존하기 위해 `verified`로 읽는다.

## 시간표 재계산

각 경로는 첫 출발 시각을 기준으로 다음 순서로 계산한다.

1. 첫 정류장의 기존 시각을 해당 일차의 출발 기준으로 사용한다.
2. 정류장 `n`에서 `n+1`까지 확정된 구간 시간을 더해 다음 도착 시각을 구한다.
3. `n+1`에 연결된 이벤트 시각을 도착 시각으로 갱신한다.
4. 해당 이벤트의 `stayDurationMinutes`를 더해 다음 출발 시각을 구한다.
5. 마지막 정류장까지 순차 반복한다.

Standard와 CarryME는 각자의 경로 구간 시간으로 독립 계산한다. 다만 CarryME의 짐 숙소 도착 이벤트는 같은 숙소 `stopRef`를 가진 Standard의 숙소 도착 시각과 동기화한다.

### 불변 조건

- 정류장과 이벤트 순서는 바꾸지 않는다.
- 제목·설명·분류는 장소 교체 또는 제거가 없는 한 바꾸지 않는다.
- 시간표 시각은 앞선 구간의 실제·추정 시간에 맞춰 단조 증가해야 한다.
- 해당 일차의 날짜 경계를 넘으면 `TIMELINE_DATE_BOUNDARY_EXCEEDED`로 최종화를 중단한다.
- 장소 운영시간은 현재 데이터 계약에 없으므로 자동 검증하지 않는다.

### 장소 교체와 제거

- 장소가 교체되면 `stopRef`와 체류시간은 유지하고 제목·설명·좌표·공급자 참조만 새 장소에 맞춘다.
- AI 장소가 제거되면 경로 정류장과 연결 구간을 제거한다.
- 제거된 이벤트의 체류시간은 같은 위치에 `자유시간` 이벤트로 남기고 경로 정류장과 연결하지 않는다.
- 제거 후 남은 경로를 다시 최종화해 이후 시각을 계산한다.

## 레거시 일정

- `stopRef` 또는 `stayDurationMinutes`가 없는 기존 저장 일정은 제목으로 연결 관계를 추론하지 않는다.
- 기존 일정 조회와 표시를 허용하고 저장된 시간표를 그대로 사용한다.
- 신규 생성 요청에서 필수 매핑이 누락되면 조용히 레거시 처리하지 않고 생성 계약 오류로 반환한다.
- 편집 화면에서 CarryME 순서를 바꾼 뒤 재최종화하는 경로는 신규 참조가 있는 일정에만 시간표 재계산을 적용한다.

## 화면 표시

새 화면이나 경고 문구를 추가하지 않는다.

### 추정 구간이 없는 경우

- 기존처럼 총 이동시간을 표시한다.
- Standard·CarryME 절약시간 칩과 지도 안내를 표시한다.
- GPTs·GPT 앱 응답에 `savedMinutes`와 절약 문구를 포함할 수 있다.

### 추정 구간이 있는 경우

- 총 이동시간과 보정된 일정 시각은 표시한다.
- Standard·CarryME 절약시간 칩, 지도 절약 안내와 타임라인의 절약 문구를 렌더링하지 않는다.
- GPTs·GPT 앱 응답에서 `savedMinutes`와 절약 문구를 생략하며 `0`으로 위장하지 않는다.
- `경로 계산 불가` 같은 신규 실패 문구를 표시하지 않는다.
- 추정 마지막 도보의 가짜 경로선을 만들지 않는다.

화면은 개별 숫자의 존재 여부가 아니라 `savingStatus`를 최우선 판정 기준으로 사용한다.

## 최종화 상태

`routeFinalized=true`는 모든 방문 장소가 다음 중 하나를 만족한다는 뜻이다.

- 공급자 경로가 성공함
- 승인된 추정 규칙과 장소 유형별 시간 상한을 만족함

따라서 `routeFinalized`는 모든 구간이 실제 공급자 값이라는 뜻이 아니다. 실제·추정 여부는 `durationSource`와 `estimatedSegmentIndexes`가 담당한다.

## 검증 기준

1. 구간 시간이 늘거나 줄면 이후 이벤트 시각이 같은 차이만큼 보정된다.
2. Standard와 CarryME 시간표는 각각의 경로 시간을 사용한다.
3. 짐 숙소 도착 이벤트는 Standard 숙소 도착과 같은 시각을 사용한다.
4. 날짜 경계를 넘는 일정은 부분 저장되지 않는다.
5. 추정 구간이 있으면 모든 절약시간 표현이 사라지지만 총 이동시간은 유지된다.
6. 레거시 일정은 신규 참조 필드 부재 때문에 깨지거나 임의 보정되지 않는다.

## 테스트 영향

현재 시간표 불변을 검증하는 다음 테스트는 승인된 요구와 충돌하므로 재작성 대상이다.

- `apps/web/scripts/check-itinerary-finalization.ts`의 시간표 직렬화 불변 검증
- `apps/web/e2e/itinerary-finalized-routes.spec.ts`의 시간표 불변 검증

대체 테스트는 제목·설명·순서 불변과 계산된 시각 변화의 정확성을 각각 검증한다.

## 리스크

- `savingMinutes`를 선택 필드로 바꾸면 기존 소비자가 숫자를 가정할 수 있다. 공유 자료형, MCP 응답 직렬화와 상세 화면을 한 번에 전환해야 한다.
- 신규 일정에서 `stopRef`가 잘못 매핑되면 시각이 다른 장소에 적용될 수 있으므로 저장 전 양방향 참조 검증이 필요하다.
- 자정 경계 실패가 잦으면 생성 프롬프트의 일차별 일정 밀도를 별도로 조정해야 한다.

## References

- [장소 교체와 최종화 인터뷰](../01_interview/replacement-and-finalization.md)
- [공유 일정 자료형](../../../../packages/planme-core/src/mock-data.ts)
- [일정 초안 정규화](../../../../packages/planme-core/src/draft-itineraries.ts)
- [AI 일정 생성기](../../../../packages/planme-core/src/openai-itinerary-generator.ts)
- [서버 일정 경로 최종화](../../../../apps/web/lib/itinerary-route-finalizer.ts)
- [미리보기 저장소](../../../../apps/web/lib/preview-itinerary-store.ts)
- [상세 일정 화면](../../../../apps/web/components/itinerary/ItineraryDashboard.tsx)
- [타임라인 패널](../../../../apps/web/components/itinerary/TimelinePanel.tsx)
