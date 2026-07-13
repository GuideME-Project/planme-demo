# API 및 데이터 계약 계획

## 결론

- 공개 요청은 지역과 정확한 장소를 명시적으로 구분한다.
- 신규 내부 사전검사 API는 전체 대중교통 일정의 접근성을 검사하지만 저장하지 않는다.
- 최종 저장 API는 기존 원자 저장 책임을 유지하고 한 번만 호출한다.
- 신규 저장 필드는 선택적으로 읽어 V1·V2 JSON 호환성을 유지한다.
- 추정 구간이 있으면 공개 응답에서 `savedMinutes`를 생략하고 `savingStatus`로 이유를 표현한다.

## 공개 요청 DTO

### 핵심 타입

후보:

```ts
type PlanmeDestinationType = "region" | "place";

type RecommendItineraryRequest = GeneratedItineraryRequest & {
  destinationType?: PlanmeDestinationType;
  mustVisitPlaces?: string[];
  // 기존 필드
};
```

### 필드 규칙

| 필드 | required | optional | nullable | default | 검증 |
| --- | ---: | ---: | ---: | --- | --- |
| `destination` | 예 | 아니오 | 아니오 | 없음 | 공백 제거 후 1자 이상 |
| `destinationType` | 신규 클라이언트 예 | 서버 전환기 예 | 아니오 | 누락 시 `place` | `region` 또는 `place` |
| `mustVisitPlaces` | 아니오 | 예 | 아니오 | 빈 배열 | 각 항목 공백 제거 후 1자 이상, 중복 제거 |
| `transportMode` | 예 | 아니오 | 아니오 | 없음 | 기존 한국어·영문 입력을 `drive`·`transit`으로 정규화 |

서버는 레거시 요청을 깨뜨리지 않기 위해 `destinationType` 누락을 `place`로 처리한다. 새 GPTs OpenAPI와 GPT 앱 도구 설명은 `destinationType`을 항상 전달하도록 요구한다.

`mustVisitPlaces=null`은 허용하지 않는다. 필드가 없으면 빈 배열이며, 빈 문자열 항목은 제거한다. 필수 장소가 정규화 후 모두 사라지더라도 `destinationType="region"`이면 지역 일정 생성은 계속할 수 있다.

### 의미 규칙

| 입력 | 처리 |
| --- | --- |
| `destinationType="region"` | `destination`을 `region` 범위로만 사용 |
| `destinationType="place"` | `destination`을 고정 필수 장소 목록에 포함 |
| `mustVisitPlaces` | 모든 항목을 고정 장소로 해석 |
| `destinationType` 누락 | 기존 동작 보존을 위해 `place` |

## 계획 입력 DTO

`start_planme_planning`과 GPTs 계획 시작 API에도 같은 두 필드를 추가한다.

- `destinationType`: 선택 입력으로 받아 정규화 결과에 포함
- `mustVisitPlaces`: 빈 배열 기본값
- 사용자에게 별도 UI 질문을 만들지 않는다.
- ChatGPT가 처음 한두 프롬프트의 자연어를 기준으로 값을 채운다.
- `normalizedInput`은 `destinationType: "region" | "place" | null`과 `mustVisitPlaces: string[]`를 반환한다.

계획 단계에서 `destinationType`이 없다고 `missingSlots`에 추가하지 않는다. 추천 도구의 레거시 기본값이 있으므로 불필요한 사용자 질문을 만들지 않는다.

## 내부 장소·시간표 DTO

### 정류장

후보:

```ts
type PlanmeDraftRequiredPlaceKind =
  | "origin"
  | "destination"
  | "must_visit";

type RouteStop = {
  stopRef?: string;
  placeConstraint?: "fixed" | "replaceable";
  // 기존 필드
};
```

규칙:

- 신규 생성 일정은 모든 여행자 경로 정류장에 `stopRef`가 있어야 한다.
- 출발지·복귀지·사용자 목적지·필수 장소는 `fixed`다.
- AI 방문지는 `replaceable`이다.
- 레거시 일정의 `placeConstraint` 누락을 자동 교체 가능으로 추론하지 않는다.
- AI 교체·제거는 명시적 `replaceable`에만 허용한다.

### 시간표

후보:

```ts
type PlanmeDraftTimelineEvent = {
  stopIndex?: number | null;
  stayDurationMinutes?: number;
  // 기존 필드
};

type TimelineEvent = {
  stopRef?: string;
  stayDurationMinutes?: number;
  // 기존 필드
};
```

OpenAI 구조화 출력에서는 `stopIndex`와 `stayDurationMinutes`를 required 목록에 넣는다.

- 정류장 연결 이벤트: `stopIndex`는 0 이상의 정수
- 자유시간 등 비경로 이벤트: `stopIndex=null`
- `stayDurationMinutes`: 0 이상의 정수
- TypeScript 선택 필드는 레거시 읽기용이며 신규 생성 결과의 누락을 허용한다는 뜻이 아니다.

정규화는 `stopIndex`를 서버 생성 `stopRef`로 바꾸고 인덱스 범위, 중복 대표 이벤트와 누락 정류장을 검증한다.

## 경로·절약 상태 DTO

후보:

```ts
type RouteDurationSource = "provider" | "estimated";

type RouteProviderSegment = {
  durationSource: RouteDurationSource;
  // 기존 필드
};

type RoutePlan = {
  durationSource?: RouteDurationSource;
  estimatedSegmentIndexes?: number[];
  // 기존 필드
};

type ItinerarySavingStatus = "verified" | "hidden_estimated";

type ItineraryDay = {
  savingStatus?: ItinerarySavingStatus;
  savingMinutes?: number;
  // 기존 필드
};

type PlanmeItinerary = {
  carrymeSaving?: string;
  savedDurationLabel?: string;
  // 기존 필드
};
```

기본 규칙:

- 자동차와 ODsay 실제 구간: `durationSource="provider"`
- 700m 이하 기존 대중교통 추정과 신규 마지막 도보 추정: `durationSource="estimated"`
- 경로에 추정 구간이 하나라도 있으면 경로 집계 상태는 `estimated`
- Standard 또는 CarryME가 `estimated`이면 일차 `savingStatus="hidden_estimated"`
- `hidden_estimated`이면 `savingMinutes`와 모든 절약 라벨을 생략
- `hidden_estimated`이면 일정 최상위 `carrymeSaving`과 `savedDurationLabel`도 생략
- 레거시 일차에 `savingStatus`가 없고 `savingMinutes`가 있으면 기존 표시를 위해 `verified`로 해석

## 내부 접근성 사전검사 API

### 엔드포인트

- 업무 의미: 저장 전 대중교통 접근성 검사
- 기술 식별자 후보: `POST /api/gpt/itineraries/transit-preflight`
- 호출자: MCP GPTs REST·GPT 앱 공통 오케스트레이터
- 인증: 기존 `PLANME_INTERNAL_API_TOKEN` bearer
- 추적: 기존 `X-PlanME-Trace-Id` UUID
- 상태 변경: 일정 저장 없음, 5분 경로 구간 캐시만 기록

### 요청 DTO

후보:

```ts
type TransitPreflightRequest = {
  itinerary: PlanmeItinerary;
  timeoutMs: number;
};
```

| 필드 | required | nullable | default | 검증 |
| --- | ---: | ---: | --- | --- |
| `itinerary` | 예 | 아니오 | 없음 | ID, 지역, 일차, `transportMode="transit"`, 정류장·참조 계약 |
| `timeoutMs` | 예 | 아니오 | 없음 | 양의 정수, 웹 40초 이하로 강제 |

MCP는 전역 deadline에서 남은 값을 계산해 `timeoutMs`로 보낸다. 웹은 요청값과 서버 상한 중 작은 값을 사용한다. 클라이언트 절대시각을 신뢰하지 않는다.

### 성공·도메인 응답 DTO

후보:

```ts
type TransitPreflightResponse =
  | {
      status: "accessible";
      estimatedSegmentCount: number;
    }
  | {
      status: "replacement_required" | "confirmation_required";
      context: {
        dayIndex: number;
        routeId: "standard" | "carryme";
        segmentIndex: number;
        stopRef: string;
        placeConstraint: "fixed" | "replaceable";
        reason:
          | "destination_station_missing"
          | "walk_limit_exceeded"
          | "walk_path_missing";
      };
    };
```

- 접근 가능·교체 필요·사용자 확인 필요는 정상적인 도메인 판정이므로 HTTP `200`이다.
- 응답에는 전체 일정, 장소명, 좌표와 공급자 원문을 반환하지 않는다.
- MCP는 자기 일정의 `stopRef`로 대상 장소를 찾는다.
- 웹은 `stopRef`와 `placeConstraint`를 `RouteProviderStop`까지 전달해 반환 문맥이 정규화된 일정 계약과 일치하는지 검증한다.
- `estimatedSegmentCount`는 절약시간 숨김 여부를 검증하기 위한 최소 상태이며 경로 상세는 캐시에 남는다.
- 여러 경로의 도메인 실패가 함께 발생하면 완료 시점이 아니라 `dayIndex`, Standard 우선, `segmentIndex`, `stopRef` 순으로 정렬한 첫 실패를 반환한다.

### 오류 응답

| HTTP | error | 의미 |
| ---: | --- | --- |
| 400 | `INVALID_TRANSIT_PREFLIGHT_REQUEST` | DTO 또는 신규 참조 계약 위반 |
| 401 | `UNAUTHORIZED_INTERNAL_REQUEST` | 내부 bearer 불일치 |
| 429 | `PROVIDER_CALL_BUDGET_EXCEEDED` | 추적 ID별 실제 공급자 호출 상한 도달 |
| 503 | `TRANSIT_RECOVERY_DISABLED` | MCP·웹 배포 모드 불일치 또는 비활성 |
| 503 | `ROUTE_PROVIDER_CONFIGURATION_ERROR` | 키·계약·공유 캐시 설정 문제 |
| 504 | `ROUTE_PREFLIGHT_TIMEOUT` | 전달된 시간 예산 초과 |

오류 응답은 안정적인 `error` 코드만 서비스 경계를 넘긴다. 메시지, 공급자 요청 URL과 응답 본문은 넘기지 않는다. 호출 상한 카운터는 `X-PlanME-Trace-Id` 범위에서 사전검사와 최종 저장이 공유하며, 클라이언트가 최대 호출 수를 지정하지 못한다.

## 최종 저장 API 변경

기존 `POST /api/gpt/itineraries/preview-store`를 유지한다.

- 입력: 기존 일정, 선택 `baseRevision`와 선택 `timeoutMs`
- 호출 횟수: 정상 흐름에서 한 번
- 캐시: 같은 추적 ID와 좌표 쌍의 사전검사 결과 재사용
- 저장: 기존 잠금과 revision 비교 후 V2 원자 저장
- 성공 응답: 기존 MCP의 즉시 응답·위젯 구성을 위해 최종 일정 유지

`timeoutMs`는 기존 호출 호환을 위해 optional이며, 누락 시 현재 40초 상한을 사용한다. MCP 공통 오케스트레이터는 전역 deadline의 남은 값을 보내고 웹은 1ms 이상 40초 이하로 제한한다. `persistItineraryForDetailPage`도 동일한 남은 예산을 fetch AbortSignal에 적용한다.

일반 mutation 최소 응답 원칙상 상세 일정은 조회 API가 우선이지만, 현재 MCP는 저장 직후 최종 공급자 시간으로 GPT 응답과 위젯 메타데이터를 만들어야 한다. 추가 조회 왕복을 피하기 위해 내부 인증된 저장 응답에 최종 일정을 유지한다.

### 최종 저장 안전장치 응답

사전검사가 놓친 경로 차이에만 기존 HTTP `422`를 구조화한다.

```ts
type PreviewStoreRepairResponse = {
  error: "ROUTE_REPAIR_REQUIRED";
  status: "repair_required";
  code:
    | "TRANSIT_PLACE_REPLACEMENT_REQUIRED"
    | "USER_PLACE_CONFIRMATION_REQUIRED";
  context: TransitPreflightRepairContext;
};
```

MCP는 남은 전역 시간이 충분할 때만 사전검사·교체를 한 번 더 수행한다. 시간이 부족하면 반복 호출하지 않고 시간 초과 또는 확인 응답으로 종료한다.

## 공개 성공 응답 DTO

후보:

```ts
type GptActionItineraryResponse = {
  savingStatus: "verified" | "hidden_estimated";
  savedMinutes?: number;
  // 기존 필드
};
```

| 필드 | 신규 성공 응답 | 레거시 |
| --- | --- | --- |
| `savingStatus` | required | 없을 수 있음 |
| `savedMinutes` | `verified`일 때만 존재 | 기존에는 required |
| `summary` | 숨김 상태에서는 일정 요약 사용 | 기존에는 절약 문구 중심 |

GPTs OpenAPI `ItineraryActionResponse.required`에서 `savedMinutes`를 제거하고 `savingStatus`를 추가한다. GPT 앱 Zod 출력 스키마도 같은 의미를 사용한다. `savedMinutes=null`이나 `0`을 숨김 표현으로 사용하지 않는다.

## 저장 호환성과 마이그레이션

- 저장소: Upstash Redis 또는 로컬 메모리의 `StoredPreviewItineraryV1 | V2`
- DB 컬럼·인덱스: 없음
- 데이터 마이그레이션: 없음
- 저장 버전 3: 추가하지 않음
- 이유: `PlanmeItinerary` 안의 신규 필드는 선택 필드이고 V2의 최종화 의미는 유지됨

읽기 규칙:

1. V1은 `routeFinalized=false`로 기존 동작을 유지한다.
2. V2는 `routeCalculation.status="completed"`이면 `routeFinalized=true`다.
3. 신규 참조가 없는 기존 일정은 시간표를 재추론하지 않는다.
4. 기존 절약 필드가 있으면 기존 UI를 보존한다.
5. 신규 일정은 저장 전 `stopRef`·`placeConstraint`·시간표 매핑을 엄격 검증한다.

## 캐시 계약

후보:

```ts
type CachedRouteSegment = {
  version: 1;
  provider: "odsay";
  expiresAt: string;
  segment: RouteProviderSegment;
};
```

- Redis 키: `planme:route-segment:{traceId}:{sha256(normalized input)}`
- TTL: 300초
- 해시 입력: 공급자, 이동수단, 좌표 쌍, 복구 정책 버전
- 키에 장소명·좌표 원문·API 키를 넣지 않는다.
- 값은 공급자 원문이 아니라 정규화된 구간 결과만 저장한다.
- 오류, 인증 실패와 사용자 확인 상태는 성공 캐시로 저장하지 않는다.

## 로그 계약

허용:

- 추적 ID, 내부 코드, 단계, 상태
- 일차, 경로, 구간 번호, `stopRef`, `placeConstraint`
- AI 생성 장소인 경우 목적지 장소명·좌표
- 후보·정류장 수, 실제·추정 상태, 캐시 적중 여부와 처리시간

금지:

- 사용자 출발지 이름·좌표
- 사용자 고정 장소의 이름·좌표 기본 로그
- 공급자 키, bearer, 전체 URL, 원문 응답
- 전체 일정 요청·응답

## 변경 파일

| 파일 | 계약 변경 |
| --- | --- |
| `packages/planme-core/src/gpt-actions.ts` | 공개 요청·응답 타입과 장소 의미 |
| `packages/planme-core/src/planning-questions.ts` | 계획 입력 정규화 |
| `packages/planme-core/src/draft-itineraries.ts` | 초안·저장 매핑 |
| `packages/planme-core/src/mock-data.ts` | 공유 저장 자료형 |
| `packages/planme-core/src/openai-itinerary-generator.ts` | 구조화 출력 스키마 |
| `apps/mcp/src/planme-mcp.ts` | GPT 앱 Zod와 웹 클라이언트 |
| `apps/mcp/src/gpts-actions-api.ts` | GPTs Zod·OpenAPI·REST 응답 |
| `apps/web/app/api/gpt/itineraries/transit-preflight/route.ts` 후보 | 내부 사전검사 계약 |
| `apps/web/app/api/gpt/itineraries/preview-store/route.ts` | 구조화 안전장치 응답 |
| `apps/web/lib/preview-itinerary-store.ts` | V1·V2 읽기 호환 확인 |

## 검증

- GPTs OpenAPI required·optional 필드 검사
- GPT 앱 listTools 입력·출력 스키마 검사
- `destinationType` 누락 레거시 기본값 검사
- null 거부와 빈 배열 기본값 검사
- 사전검사 200 도메인 상태와 4xx·5xx 오류 분리 검사
- V1·V2 저장 JSON 역직렬화 검사
- `hidden_estimated` 응답에 `savedMinutes`가 없는지 검사

## 리스크와 중단 조건

- GPTs가 이전 OpenAPI를 캐시하면 선택 필드 응답을 거부할 수 있다. 기능 활성화 전에 Action 스키마를 다시 가져온다.
- 신규 일정 참조가 누락되면 잘못된 자동 교체 위험이 있다. 저장 전 실패로 처리한다.
- 공유 Redis가 없으면 사전검사와 저장 사이 호출 재사용을 보장할 수 없다. 운영 기능을 활성화하지 않는다.
