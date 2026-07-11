# 시간표 의미 보정 구현계획

## 결론

- 새 일정은 공통 초안 변환 지점에서 Standard의 CarryME 배송 사건을 제거하고 제한된 체크인 문구를 보정한다.
- 기존 저장 일정은 같은 의미 판별 함수를 재사용하는 웹 전용 순수 함수로 호환 표시한다.
- 웹 상세 시간표의 행 강조는 `TimelinePanel`에서 제거하되 CarryME 배송 아이콘의 빛나는 효과와 총 이동 시간 상자의 절약 칩은 유지한다.

완료 조건은 Standard의 호텔 체크인·호텔 복귀가 유지되고 CarryME 배송 사건만 사라지며, 기존·신규 일정과 두 테마에서 행 시각 규칙이 동일한 것이다.

## 주요 리스크

- 배송 사건의 문구 판별 범위가 넓으면 정상 호텔 도착을 제거할 수 있다.
- 생성 후처리와 웹 호환 보정이 다른 규칙을 사용하면 기존 일정과 새 일정의 결과가 달라진다.
- 행 내부 절약 칩을 제거하면서 CarryME 총 이동 시간 상자의 칩까지 함께 제거할 수 있다.
- 현재 작업 브랜치가 최신 `main`보다 뒤에 있어 그대로 구현하면 이미 병합된 변경과 충돌할 수 있다.

## 범위

### 포함

- AI 생성 지침의 Standard 체크인 의미 강화
- 공통 초안 변환에서 Standard 배송 사건 제거와 체크인 문구 보정
- 기존 저장 일정의 웹 표시 호환 변환
- 웹 시간표 행 배경·테두리·체크·행 내부 빨간 절약 칩 제거
- CarryME 배송 아이콘과 아이콘 빛나는 효과 유지
- 관련 MCP 통합 검사와 웹 화면 회귀 검사

### 제외

- API 엔드포인트, 요청·응답 DTO 변경
- DB·Redis 스키마나 저장 데이터 마이그레이션
- 경로 계산, 좌표, 이동 시간, 지도 polyline 변경
- Standard와 CarryME route stop 순서 변경
- ChatGPT 위젯과 공유 이미지 컴포넌트의 시각 변경
- 호텔별 실제 체크인 가능 시간 조회
- CarryME 총 이동 시간 상자와 오른쪽 빨간 절약 칩 변경

## 작업 순서

### 1. 최신 기준선 준비

1. 현재 문서 변경을 보존한다.
2. 원격 `main`과 로컬 `main` 상태를 확인한다.
3. 최신 `main` 기준 새 작업 브랜치를 준비한다.
4. 인터뷰·설계·구현계획 문서만 새 브랜치에 반영한다.
5. 작업 시작 전 dirty 상태에 사용자 변경이 섞이지 않았는지 다시 확인한다.

강제 reset, 기존 사용자 변경 삭제, 이미 병합된 브랜치 재사용은 하지 않는다.

### 2. 공통 Standard 시간표 의미 보정 함수 추가

`packages/planme-core/src/draft-itineraries.ts`에 입력 타입을 보존하는 순수 함수를 둔다.

책임:

- Standard의 CarryME 배송 사건 판별
- CarryME 전용 분류 사건 제거
- 잘못 분류된 명백한 짐 배송 완료 사건의 보조 제거
- `체크인 전 짐 보관` 유형의 제목·설명 보정
- CarryME 배송 사건 의미를 재사용할 수 있는 공통 판별 함수
- CarryME 배송 사건의 분류를 `carryme`로 정규화하는 순수 함수
- 정상 호텔 체크인·도착·복귀·숙박 보존
- 입력 배열과 원본 event 객체 불변성 유지

공통 함수를 export해 새 일정 변환과 기존 웹 표시가 같은 규칙을 사용하게 한다. 별도의 웹 문구 정규식을 중복 작성하지 않는다.

후보 시그니처 예시:

```ts
type StandardTimelineEventLike = {
  category?: TimelineEvent["category"];
  description: string;
  title: string;
};

/** Standard 여행자 사건만 남기고 제한된 체크인 문구를 정규화한다. */
export function normalizeStandardTimelineEvents<
  T extends StandardTimelineEventLike,
>(events: T[]): T[] {
  return events
    .filter((event) => !isCarrymeDeliveryEvent(event))
    .map((event) => normalizeLegacyStandardCheckinEvent(event));
}
```

같은 배송 사건 판별 함수를 사용해 CarryME 시간표의 명백한 배송 사건 분류를 정규화한다.

```ts
/** CarryME 배송 사건이 항상 배송 분류와 아이콘 계약을 사용하게 한다. */
export function normalizeCarrymeTimelineEvents<
  T extends StandardTimelineEventLike,
>(events: T[]): T[] {
  return events.map((event) =>
    isCarrymeDeliveryEvent(event)
      ? { ...event, category: "carryme" }
      : event,
  );
}
```

위 코드는 구현 전달용 예시다. 실제 구현은 기존 타입과 코드 스타일을 유지한다.

#### 배송 사건 판별

우선순위:

1. `category === "carryme"`이면 Standard에서 제거한다.
2. 제목과 설명을 합친 문자열이 `짐/수하물`과 `배송/도착`을 함께 명시하면 배송 완료 사건 후보로 본다.
3. `호텔 도착`, `호텔 체크인`, `호텔 복귀`, `숙박`만 있는 여행자 사건은 제거하지 않는다.
4. `짐 없이 바로 이동` 같은 절약 문구는 제거 조건으로 사용하지 않는다.

문구 보조 판별은 구조화 분류 오류를 보완하는 최소 범위로 유지한다. `보관`, `맡기기` 전체를 배송 완료로 취급하지 않는다.

#### 기존 체크인 문구 보정

체크인 단서와 짐 보관 표현이 함께 있는 제목만 대상으로 한다.

- 입력 예: `파라다이스 호텔 부산 체크인 전 짐 보관`
- 제목 출력: `파라다이스 호텔 부산 체크인`
- 설명 출력: `호텔에 체크인한 뒤 다음 일정으로 이동합니다.`

일반 짐 보관 문구를 모두 체크인으로 바꾸지 않는다.

### 3. 검증 전에 새 일정 입력 전체를 정규화

`createPlanmeDraftPreview`에서 검증과 일정 생성을 시작하기 전에 Standard 시간표를 포함한 입력 전체를 정규화한다. 정규화된 동일 입력을 `validateDraftPreviewInput`과 `buildDraftItinerary`에 모두 전달한다.

후보 흐름 예시:

```ts
const normalizedInput = normalizeDraftPreviewStandardTimelines(input);
const previewId = normalizedInput.previewId?.trim() || createDraftPreviewId(normalizedInput);
const validationIssues = [
  ...validateDraftPreviewInput(normalizedInput),
  ...(options.extraValidationIssues ?? []),
];
const itinerary = buildDraftItinerary(normalizedInput, previewId, validationIssues);
```

입력 전체 정규화 함수는 각 day의 `standardTimeline`에 Standard 의미 보정을 적용하고 `carrymeTimeline`의 명백한 배송 사건 분류를 `carryme`로 정규화한다. legacy `timeline` 원본은 변경하지 않는다.

`buildDraftDay`는 이미 정규화된 Standard 시간표를 기존 방식으로 변환한다.

후보 흐름 예시:

```ts
return {
  // ...route plans
  standardTimeline: buildDraftTimelineEvents(
    day.standardTimeline ?? day.timeline ?? [],
    standardStops,
    explicitOrigin,
  ),
  carrymeTimeline: buildDraftTimelineEvents(
    day.carrymeTimeline ?? day.timeline ?? [],
    carrymeStops,
    explicitOrigin,
  ),
};
```

CarryME 시간표는 사건 순서·제목·설명을 변경하지 않고 명백한 배송 사건의 분류만 안정화한다. legacy `timeline`의 CarryME 표시 흐름은 변경하지 않는다.

보정 후 Standard 시간표가 비면 정규화된 입력을 읽는 기존 필수 시간표 검증이 `missing_timeline` 오류를 만들고 상태를 `needs_revision`으로 정해야 한다. 보정 전 입력을 검증에 사용하거나 비정상 결과를 `preview_ready`로 저장하지 않는다.

legacy `standardTimeline`이 없고 `timeline`만 있는 신규 입력은 fallback 배열을 정규화한 값을 Standard 검증과 생성에 사용하되, 원본 `timeline`은 CarryME 표시를 위해 유지한다. 이 경우 정규화된 Standard fallback이 비면 `needs_revision`으로 처리한다.

### 4. AI 생성 지침 보강

`packages/planme-core/src/openai-itinerary-generator.ts`의 일정 생성 지침을 수정한다.

포함할 의미:

- `Standard 경로는 짐을 놓기 위해 호텔/숙소를 중간 방문하여 체크인하는 경로입니다.`
- 첫 호텔 중간 방문은 `{호텔명} 체크인`으로 작성한다.
- 관광 후 같은 호텔로 돌아오면 `{호텔명} 복귀` 또는 숙박 의미로 작성한다.
- Standard 시간표에는 `짐 숙소 도착`이나 CarryME 배송 사건을 작성하지 않는다.
- CarryME 시간표에만 `짐 숙소 도착`을 작성하고 반드시 `category=carryme`를 사용한다.
- Standard 시간표에서는 `category=carryme`를 사용하지 않는다.
- 실제 체크인 시간을 확인할 수 없으면 통상적인 오후 시간대로 배치한다.

공통 시간표 JSON Schema는 이번 범위에서 분리하지 않는다. 프롬프트와 결정적 후처리를 함께 사용한다.

### 5. 기존 일정 웹 표시 순수 함수 추가

새 파일 후보:

`apps/web/lib/itinerary-timeline-display.ts`

책임:

- `@planme/core`의 공통 Standard 의미 보정 함수를 호출한다.
- 웹 상세 화면에서 사용할 새 배열을 반환한다.
- 공통 배송 사건 판별 함수를 사용해 기존 CarryME 사건의 표시 아이콘과 강조 여부를 결정할 수 있게 한다.
- 원본 저장 일정 객체는 변경하지 않는다.

후보 예시:

```ts
import {
  isCarrymeDeliveryEvent,
  normalizeStandardTimelineEvents,
  type TimelineEvent,
} from "@planme/core";

/** 기존·신규 일정에 같은 Standard 웹 표시 규칙을 적용한다. */
export function createStandardTimelineForWeb(events: TimelineEvent[]) {
  return normalizeStandardTimelineEvents(events);
}

export { isCarrymeDeliveryEvent };
```

웹 helper는 의미 판별 정규식을 다시 갖지 않는다.

### 6. `TimelinePanel` 표시 변경

`apps/web/components/itinerary/TimelinePanel.tsx`에서 다음을 적용한다.

- Standard events를 웹 표시용 순수 함수로 변환한 뒤 렌더링한다.
- 일정 행 content 영역의 `event.highlight` 기반 배경·테두리·패딩 분기를 제거한다.
- 행 오른쪽 체크 아이콘 렌더링과 불필요한 import를 제거한다.
- 행 제목 옆 `event.savingLabel` 칩을 제거한다.
- CarryME 총 이동 시간 상자의 `savingLabel` 칩은 유지한다.
- 아이콘의 빛나는 효과 조건을 `isCarryme && isCarrymeDeliveryEvent(event)`로 제한한다.
- CarryME 배송 사건의 표시 아이콘은 저장된 분류가 잘못됐더라도 배송 차량 아이콘을 사용한다.
- Light·Dark 모두 기본 행 배경을 사용한다.
- 일정 행 content와 분류 아이콘에 안정적인 테스트 식별자를 추가한다.
- 아이콘에는 일정 종류와 사건 분류를 확인할 수 있는 의미 속성을 둔다.

`ItineraryDashboard.tsx`의 시간표 선택 우선순위와 props 계약은 변경하지 않는 것을 우선한다. 실제 구현에서 새 props가 필요해지면 계획 범위 확장으로 보고하고 중단한다.

후보 식별자:

- 행 내용: `data-testid="timeline-event-content"`
- 분류 아이콘: `data-testid="timeline-event-icon"`
- 아이콘 의미: `data-route-kind="standard|carryme"`, `data-event-category="..."`

식별자는 스타일 클래스명이나 MUI 생성 해시를 테스트에 사용하지 않기 위한 것이다.

### 7. 테스트 fixture와 assertion 보강

- MCP 통합 검사에 공통 초안 보정 사례를 추가한다.
- 웹 상세 회귀 fixture에 Standard와 CarryME 전용 시간표를 명시한다.
- Standard에 정상 호텔 체크인, 호텔 복귀, 같은 시각·장소의 잘못된 짐 도착을 함께 넣는다.
- CarryME에는 짐 도착을 유지한다.
- CarryME 배송 사건의 분류가 `carryme`로 정규화되는지 확인한다.
- 생성 프롬프트가 CarryME 배송 사건과 Standard 금지 분류 계약을 포함하는지 확인한다.
- 1일차·2일차에 동일한 규칙을 검증할 수 있게 fixture를 구성한다.
- 정규화 후 Standard 시간표가 비는 입력이 `needs_revision`이 되는 사례를 추가한다.

## 변경 파일 후보

| 파일 | 변경 목적 | 주의점 |
| --- | --- | --- |
| `packages/planme-core/src/openai-itinerary-generator.ts` | Standard 체크인과 CarryME 전용 배송 지침 강화 | 장소·좌표·이동수단 지침 유지 |
| `packages/planme-core/src/draft-itineraries.ts` | 공통 의미 판별·보정 함수와 새 일정 적용 | 정상 호텔 사건 제거 금지, 원본 불변 |
| `apps/web/lib/itinerary-timeline-display.ts` | 기존 저장 일정 웹 호환 표시 | 정규식 중복 금지 |
| `apps/web/components/itinerary/TimelinePanel.tsx` | 행 강조 제거, CarryME 배송 아이콘 강조 제한 | 하단 절약 칩 유지 |
| `apps/mcp/scripts/check-planme-mcp.ts` | 새 일정 의미 보정 통합 검사 | 기존 대형 fixture와 이름 충돌 주의 |
| `apps/web/e2e/gpt-itinerary-generation.spec.ts` | 기존 일정 호환과 시각 회귀 | 저장 토큰과 기존 테스트 흐름 재사용 |

## API·DTO·DB 영향

- API 엔드포인트 변경 없음.
- 요청·응답 DTO 필드 추가·삭제 없음.
- `TimelineEvent` 필드의 required·optional·nullable·default 계약 변경 없음.
- DB와 Redis 스키마 변경 없음.
- 기존 저장 데이터 migration·backfill 없음.
- 공개 OpenAPI 변경 없음.

## 코드 규칙

- 새 함수와 변경하는 함수 선언부에 JSDoc을 작성한다.
- 배송 사건 판별과 체크인 문구 보정의 핵심 분기에는 한 줄 주석을 둔다.
- `unknown` 타입을 새로 도입하지 않는다.
- 민감한 환경변수 값을 로그나 문서에 출력하지 않는다.
- `dist`, `node_modules`를 읽거나 검색하지 않는다.

## 중단 조건

- 공통 보정 후 정상 호텔 체크인이나 복귀가 제거된다.
- Standard와 CarryME 시간표의 현재 데이터만으로 배송 사건과 여행자 사건을 안전하게 구분할 수 없다.
- `ItineraryDashboard`의 시간표 선택 계약이나 저장 DTO 변경이 필요하다.
- ChatGPT 위젯 시각 변경 없이는 요구사항을 만족할 수 없다.
- 현재 문서 외 사용자 변경과 동일 파일 충돌이 발견된다.
- 기존 저장 일정의 체크인 문구가 승인된 제한 조건보다 넓게 변환된다.
- 정규화 전 입력과 정규화 후 입력 중 서로 다른 객체가 검증과 일정 생성에 사용된다.

## References

- [시간표 생성 설계](../02_design/timeline-domain-and-generation.md)
- [웹 시간표 컴포넌트 설계](../02_design/web-timeline-component.md)
- [Standard 체크인 인터뷰](../01_interview/standard-timeline-policy.md)
