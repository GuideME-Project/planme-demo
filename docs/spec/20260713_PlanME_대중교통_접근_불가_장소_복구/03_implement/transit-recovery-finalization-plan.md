# 대중교통 복구와 최종화 계획

## 결론

ODsay 단일 대중교통 구간 계산을 복구 가능한 함수로 분리하고, 오류 코드 4일 때만 주변 정류장과 마지막 도보를 결합한다. MCP는 최종 저장 전에 전체 일정을 사전검사하고 AI 장소를 교체하며, 웹은 성공 구간을 5분간 캐시한다. 경로가 확정되면 실제·추정 시간을 시간표에 적용하고 추정 구간이 있는 비교의 절약시간을 숨긴다.

## 현재 코드와 변경 방향

| 현재 | 변경 |
| --- | --- |
| `computeOdsayTransitRoute`가 모든 구간을 직접 순회 | 재사용 가능한 단일 구간 함수와 전체 경로 조합 함수로 분리 |
| 700m 이하는 4km/h 추정이지만 출처 없음 | `durationSource="estimated"`로 명시 |
| 오류 코드 4는 `RouteProviderError`로 전체 실패 | 정류장·도보 복구 후 장소 정책 판정 |
| 브라우저만 `searchWalkPathV2` 호출 | 서버 ODsay 경계에서 사전검사·최종화 모두 사용 |
| 웹 최종화가 시간표 불변을 강제 | `stopRef`·체류시간 기반 재계산 |
| MCP 진입점마다 생성·저장 처리 중복 | 공통 추천·사전검사·교체·저장 오케스트레이터 |

## ODsay 제공자 구현

### 함수 분리

후보:

```ts
type TransitSegmentOptions = {
  signal: AbortSignal;
  traceId: string;
};

type RouteProviderStop = Pick<
  RouteStop,
  | "coordinate"
  | "label"
  | "placeId"
  | "placeSourceRef"
  | "role"
  | "stopRef"
  | "placeConstraint"
> & { id: string };

async function computeOdsayTransitSegment(
  origin: RouteProviderStop,
  destination: RouteProviderStop,
  segmentIndex: number,
  options: TransitSegmentOptions,
): Promise<RouteProviderSegment>;

export async function computeOdsayTransitRoute(
  stops: RouteProviderStop[],
  signal: AbortSignal,
  context?: { traceId?: string },
): Promise<RouteProviderResult>;
```

- 전체 경로 함수는 정류장 중복 제거와 구간 합산만 담당한다.
- 단일 구간 함수가 짧은 거리, 일반 대중교통, 오류 코드 4 복구와 캐시를 담당한다.
- `toProviderStops`는 신규 일정에서 `stopRef`와 `placeConstraint`를 누락 없이 전달한다. 신규 참조가 없으면 공급자 호출 전에 계약 오류로 중단하고, 레거시 조회 흐름은 이 변환을 실행하지 않는다.
- 자동차 제공자의 함수 시그니처와 결과 의미는 바꾸지 않는다.

### 오류 분류

| 분류 | 예 | 처리 |
| --- | --- | --- |
| 목적지 접근 실패 | ODsay code `4` | 정류장·도보 복구 |
| 도보 도로망 실패 | `411`, `412`, `413`, `414` | 보수적 추정 |
| 일시 오류 | HTTP 408·429·5xx, provider 429·500 | 기존 한 번 재시도 |
| 설정·계약 오류 | 키 없음, 인증 실패, 계약 거부 | 복구·장소 교체 없이 운영 오류 |
| 응답 계약 오류 | 필수 시간·좌표 누락 | 안정적인 공급자 오류 |

공급자 메시지 문자열만으로 장소 접근 실패를 분류하지 않는다. 가능한 경우 숫자·안정적인 오류 코드를 우선한다.

## 정류장 복구

### 검색

1. `pointSearch`로 목적지 주변 대중교통 시설을 검색한다.
2. 검색 반경 목록은 작은 값부터 증가하는 설정으로 주입한다.
3. 실제 운영 계정의 최대 반경을 확인하기 전 배포 모드를 `on`으로 바꾸지 않는다.
4. 버스정류장·지하철역·기차역·터미널만 남긴다.
5. 공급자 시설 ID를 우선하고, 없으면 좌표 근접 기준으로 중복을 제거한다.
6. 목적지 직선거리 기준 상위 후보 중 최대 세 곳만 평가한다.

후보 설정:

```ts
type OdsayStationRecoveryPolicy = {
  searchRadiiMeters: number[];
  maxStationCandidates: 3;
  aiWalkLimitMinutes: 30;
  fixedWalkLimitMinutes: 90;
};
```

`searchRadiiMeters`의 운영값은 실제 API 검증 결과를 반영한다. 공식 문서에서 확인되지 않은 값을 기본값으로 단정하지 않는다.

기술 설정:

- 배포 모드: `PLANME_TRANSIT_ACCESS_RECOVERY_MODE`, `off | smoke | on`, 기본 `off`
- 반경 목록: `PLANME_ODSAY_STATION_SEARCH_RADII_METERS`, 쉼표로 구분한 증가 정수
- 호출 상한: `PLANME_ODSAY_MAX_REQUESTS_PER_TRACE`, 대표 스모크 측정 뒤 확정하는 양의 정수
- 반경 목록이나 호출 상한이 없거나 검증 범위를 벗어나면 `on` 활성화 실패

### 후보 평가

각 정류장 후보에 대해 다음을 계산한다.

1. 이전 장소 → 후보 정류장 대중교통
2. 후보 정류장 → 원래 목적지 도보
3. 두 시간의 합계

대중교통 경로가 없으면 후보를 제외한다. 도보가 실제 성공하면 경로선을 유지한다. 도보가 정상적인 도로망 실패이면 추정한다. 설정·계약 오류이면 후보를 바꾸지 않고 전체 요청을 중단한다.

동률 정렬:

1. 공급자 도보 우선
2. 마지막 도보시간 짧은 후보
3. 목적지 직선거리 가까운 후보
4. 공급자 반환 순서

### 도보 추정

확정:

```ts
const WALK_DETOUR_FACTOR = 1.5;
const WALK_SPEED_KM_PER_HOUR = 3.5;
const WALK_FIXED_BUFFER_MINUTES = 5;
```

예시:

```ts
function estimateWalkMinutes(directDistanceMeters: number) {
  const adjustedMeters = directDistanceMeters * WALK_DETOUR_FACTOR;
  const movingMinutes = adjustedMeters / (WALK_SPEED_KM_PER_HOUR * 1_000 / 60);

  return Math.ceil(movingMinutes) + WALK_FIXED_BUFFER_MINUTES;
}
```

- 계산 상수에는 단위와 승인 근거를 주석으로 남긴다.
- 추정 결과의 `paths`는 빈 배열이다.
- `geometryStatus`는 현재 타입과 맞춰 `partial`로 둔다.
- `durationSource="estimated"`를 반드시 설정한다.
- 직선거리만으로 상한 초과가 확실하면 불필요한 도보 공급자 호출을 생략한다.

## 장소 정책 판정

후보:

```ts
type TransitAccessDecision =
  | { status: "accessible"; segment: RouteProviderSegment }
  | {
      status: "replacement_required" | "confirmation_required";
      reason: TransitAccessFailureReason;
    };
```

규칙:

- `replaceable`: 마지막 도보 30분 이하만 `accessible`
- `fixed`: 마지막 도보 90분 이하까지 `accessible`
- `replaceable` 30분 초과·정류장 없음: `replacement_required`
- `fixed` 90분 초과·정류장 없음: `confirmation_required`
- `placeConstraint`가 없는 레거시 장소: 자동 교체하지 않음

## 5분 공유 구간 캐시

### 저장 경계

신규 후보 파일: `apps/web/lib/route-segment-cache.ts`

인터페이스 후보:

```ts
interface RouteSegmentCache {
  get(key: string): Promise<RouteProviderSegment | null>;
  set(key: string, value: RouteProviderSegment, ttlSeconds: number): Promise<void>;
}
```

- 운영: 기존 Upstash REST URL·토큰을 사용하는 Redis 구현
- 로컬·단위 테스트: 메모리 구현
- production에서 Redis 설정 누락·장애: 기능 활성화 실패
- TTL: 300초
- 성공 구간만 저장

### 키

후보:

```text
planme:route-segment:{traceId}:{sha256(provider|mode|origin|destination|policyVersion)}
```

- 좌표는 고정 소수점으로 정규화한 뒤 해시 입력에만 사용한다.
- 좌표·장소명·키를 Redis 키나 로그 원문에 쓰지 않는다.
- `policyVersion`을 포함해 추정 공식이나 정류장 정책 변경 시 이전 캐시와 섞이지 않게 한다.
- 같은 추적 ID의 Standard·CarryME 동일 구간은 캐시를 공유한다.

### 실패 처리

- 캐시 읽기 실패는 공급자 재호출로 정확성을 유지할 수 있다.
- 다만 MCP 시간 예산 보장이 깨지므로 운영 관측에 캐시 오류를 남긴다.
- 캐시 쓰기 실패 후 남은 시간이 최종 저장 재계산에 부족하면 요청을 중단한다.
- 공급자 오류와 사용자 확인 판정은 캐시하지 않는다.

## 접근성 사전검사 구현

### 처리 흐름

1. 내부 인증과 추적 ID를 검증한다.
2. 배포 모드와 Redis 설정을 확인한다. `smoke`는 서명된 스모크 요청만 허용하고 공개 MCP 흐름은 기존 동작을 유지한다.
3. 요청 일정이 `transit`이고 신규 참조 계약을 충족하는지 확인한다.
4. Standard·CarryME 경로 작업을 일차 단위 묶음으로 수행한다.
5. 각 구간은 공유 캐시를 먼저 조회하고 없으면 ODsay를 호출한다.
6. 같은 일차 묶음의 작업을 모두 기다린 뒤 도메인 실패를 `dayIndex`, Standard 우선, `segmentIndex`, `stopRef` 순으로 정렬한다. 첫 실패를 반환하고 이후 일차는 시작하지 않는다.
7. 전체 성공이면 `accessible`과 추정 구간 수를 반환한다.
8. 일정 저장·revision·잠금을 변경하지 않는다.

현재 두 비교 경로 동시 실행 상한 2를 유지한다. ODsay 실제 호출 시작은 기존 260ms 간격 직렬화 규칙을 유지한다. 인증·계약·캐시 설정 오류는 정렬 대상 도메인 실패가 아니며 요청 전체를 즉시 실패시킨다.

### 전역 시간 예산

후보 상수:

```ts
const MCP_RECOMMENDATION_BUDGET_MS = 55_000;
const WEB_ROUTE_BUDGET_MAX_MS = 40_000;
const MINIMUM_FINAL_STORE_BUDGET_MS = 8_000;
```

- MCP Vercel 60초 제한 중 5초를 응답 직렬화와 네트워크 여유로 남긴다.
- AI 일정 생성도 같은 55초 전역 예산에 포함한다.
- 각 사전검사 호출은 남은 전역 예산을 `timeoutMs`로 전달한다.
- 남은 시간이 최종 저장 최소 예산보다 작아지면 다음 AI 후보를 생성하지 않는다.
- 최종 저장은 캐시 적중을 전제로 하며 남은 예산과 40초 중 작은 값을 사용한다.
- `persistItineraryForDetailPage`는 고정 43초 대신 전달받은 남은 예산으로 fetch를 중단한다.
- 실제 대표 테스트에서 이 상수가 충분하지 않으면 기능 활성화를 중단하고 측정값으로 재검토한다.

### 공급자 호출 예산

시간 예산과 별도로 실제 ODsay 네트워크 요청을 강제로 제한한다.

```ts
type RouteProviderCallBudget = {
  traceId: string;
  maxRequests: number;
  consume(operation: "point_search" | "transit" | "walk" | "retry"): Promise<void>;
};
```

- `consume`은 실제 요청 직전에 Redis 원자 증가 연산을 수행한다. 증가 결과가 상한을 넘으면 네트워크 요청을 보내지 않고 `PROVIDER_CALL_BUDGET_EXCEEDED`를 던진다.
- 재시도도 별도 실제 호출이므로 카운트한다. 캐시 적중과 입력 검증 실패는 카운트하지 않는다.
- 키는 `planme:route-provider-budget:{traceId}`, TTL은 구간 캐시와 같은 300초다.
- 사전검사와 최종 저장은 같은 추적 ID를 사용해 하나의 카운터를 공유한다.
- 카운터 저장소를 읽거나 원자 증가시키지 못하면 실제 요청을 보내지 않고 `ROUTE_PROVIDER_CONFIGURATION_ERROR`로 종료한다. 공유 캐시 읽기 실패가 공급자 재호출로 이어지더라도 호출 카운터 성공이 선행돼야 한다.
- 상한값은 스모크 테스트에서 대표 일정·정류장 후보 세 곳·한 번 재시도의 관측 최대치를 기록한 뒤 여유분과 함께 확정한다. 측정 전에는 `on` 모드를 허용하지 않는다.

## MCP 장소 교체 구현

### 공통 오케스트레이터

신규 후보 파일: `apps/mcp/src/itinerary-recommendation-flow.ts`

후보:

```ts
type RecommendAndPersistResult =
  | { status: "ready"; response: GptActionItineraryResponse }
  | PlanmeClarificationResponse;

async function recommendAndPersistItinerary(
  input: RecommendItineraryRequest,
  options: AiRecommendedItineraryOptions,
  traceId: string,
): Promise<RecommendAndPersistResult>;
```

처리:

1. 기존 AI 생성과 네이버 장소 해석 수행
2. 자동차이면 기존 최종 저장 바로 호출
3. 대중교통이고 배포 모드가 `off` 또는 공개 요청의 `smoke`이면 기존 흐름 유지
4. 대중교통이고 배포 모드가 `on`이면 전체 일정 사전검사
5. AI 장소 실패면 핵심 패키지 교체 함수 호출
6. 고정 장소 실패면 `needs_clarification` 생성
7. 모두 성공하면 최종 저장 한 번 호출
8. GPTs와 GPT 앱 형식에 맞는 응답으로 각각 직렬화

### 교체 함수

핵심 패키지 후보:

```ts
type ReplaceTransitStopInput = {
  itinerary: PlanmeItinerary;
  request: RecommendItineraryRequest;
  stopRef: string;
  excludedPlaceSourceRefs: string[];
};

type ReplaceTransitStopResult =
  | { status: "replaced"; itinerary: PlanmeItinerary; resolutionLog: PlanmePlaceResolutionLog }
  | { status: "exhausted" };
```

- 기존 장소 후보 검색·OpenAI 후보 선택 코드를 재사용 가능한 함수로 추출한다.
- 원래 실패 장소와 별도로 대체 후보 시도 `1 | 2 | 3`을 허용한다.
- 같은 공급자 참조, 같은 좌표와 정규화 이름을 실패 목록에서 제외한다.
- 교체 장소는 같은 지역 범위의 네이버 hard gate를 통과해야 한다.
- 모든 Standard·CarryME 정류장과 연결 타임라인을 `stopRef`로 함께 갱신한다.
- 장소명 기반 전역 문자열 치환은 신규 경로에서 사용하지 않는다.

### 후보 소진과 제거

1. `replaceable` 장소만 제거한다.
2. 같은 `stopRef`를 가진 모든 경로 정류장을 제거한다.
3. 연결 경로 구간과 공급자 데이터를 초기화한다.
4. 기존 체류시간으로 `자유시간` 이벤트를 만들고 `stopRef`는 비운다.
5. 일차에 방문 장소가 하나 이상 남으면 사전검사를 다시 수행한다.
6. 방문 장소가 없으면 `NO_VISIT_PLACE_REMAINED`를 `needs_clarification`으로 변환한다.

## 최종 저장 안전장치

사전검사 이후 장소·경로가 달라지거나 캐시가 만료될 수 있으므로 `preview-store`의 구조화된 422를 유지한다.

- `RouteFinalizationError`에 `stopRef`, `placeConstraint`와 복구 사유를 추가한다.
- AI 장소이면 `TRANSIT_PLACE_REPLACEMENT_REQUIRED`
- 고정 장소이면 `USER_PLACE_CONFIRMATION_REQUIRED`
- MCP는 deadline과 후보 횟수가 남을 때만 한 번 더 사전검사·교체한다.
- 안전장치 재시도도 최종 저장 성공은 한 번만 발생한다.
- 시간이 부족하면 반복하지 않고 안정적인 시간 초과로 종료한다.

## 시간표 최종화

### 신규 모듈

신규 후보 파일: `apps/web/lib/itinerary-timeline-finalizer.ts`

후보:

```ts
type FinalizeTimelineInput = {
  day: ItineraryDay;
  routeId: "standard" | "carryme";
  segmentDurationsMinutes: number[];
};

function finalizeRouteTimeline(input: FinalizeTimelineInput): TimelineEvent[];
```

### 알고리즘

1. 신규 참조가 모두 있는지 확인한다.
2. 첫 정류장의 대표 이벤트 시각을 분 단위로 변환한다.
3. 다음 구간 이동시간을 더해 다음 정류장 도착 시각을 계산한다.
4. 해당 정류장의 `stayDurationMinutes`를 더해 다음 출발 시각을 계산한다.
5. 모든 정류장까지 순차 반복한다.
6. CarryME 짐 숙소 이벤트는 같은 숙소 `stopRef`의 Standard 도착 시각을 복사한다.
7. 24:00 이상으로 넘어가면 `TIMELINE_DATE_BOUNDARY_EXCEEDED`를 반환한다.

레거시 일정:

- `stopRef`나 체류시간이 하나라도 부족하면 기존 시간표를 그대로 유지한다.
- 신규 생성 표시가 있는데 매핑이 부족하면 레거시로 조용히 처리하지 않고 계약 오류다.
- 제목·설명·분류와 배열 순서는 장소 교체·제거가 없으면 유지한다.

## 경로 상태 집계

`applyProviderResult`에서 다음을 계산한다.

- `estimatedSegmentIndexes`
- `durationSource`
- `durationMinutes`
- `geoSegments`
- `transitMarkers`

`applyRouteTaskResults`에서 Standard·CarryME가 모두 `provider`일 때만 절약시간을 계산한다.

예시:

```ts
const savingStatus =
  standardRoute.durationSource === "provider" &&
  carrymeRoute.durationSource === "provider"
    ? "verified"
    : "hidden_estimated";
```

`hidden_estimated`이면 일차 `savingMinutes`와 일정 수준 절약 라벨을 생략한다. 총 이동시간과 시간표는 유지한다.

## 화면 구현

### `ItineraryDashboard`

- 저장 `savingStatus`를 표시 판단의 단일 기준으로 사용한다.
- 레거시 일정은 기존 절약 필드가 있으면 기존 표시를 유지한다.
- 브라우저 ODsay 재계산은 서버 최종화된 일정에서 실행하지 않는다.

### `TimelinePanel`

- `savingLabel` prop을 선택값으로 변경한다.
- 값이 없으면 절약 Chip을 렌더링하지 않는다.
- 대체 문구를 추가하지 않는다.

### `RouteMap`

- `savingLabel`이 있을 때만 롤러 절약 안내를 만든다.
- 추정 도보에 직선 또는 점선을 새로 만들지 않는다.
- 공급자 대중교통 형상까지만 표시한다.

### MCP 위젯

- `savedDurationLabel`이 없으면 절약 요소를 숨긴다.
- 빈 문자열, `0분` 또는 `계산 불가`를 대신 표시하지 않는다.
- 기존 `ui://planme/itinerary-widget-v2.html` URI를 유지한다.

## 로그

사전검사·후보 교체·최종 저장에서 같은 `traceId`를 사용한다.

필드:

- `event`, `traceId`, `internalCode`, `stage`
- `dayIndex`, `routeId`, `segmentIndex`, `stopRef`
- `placeConstraint`, 후보 번호, 정류장 후보 수
- `durationSource`, 캐시 적중, 처리시간
- AI 장소인 경우에만 목적지 장소명·좌표

사용자 출발지, 사용자 고정 장소 원문, 전체 일정, 공급자 원문과 인증값은 제외한다.

## 테스트 영향

- `check-itinerary-finalization.ts`: 시간표 불변 assertion 제거, 계산 시각과 레거시 불변을 분리
- `itinerary-finalized-routes.spec.ts`: 추정 상태·절약 숨김·저장 후 무재계산 추가
- `check-planme-mcp.ts`: 공통 오케스트레이터, 스키마, 후보 세 번과 단일 저장 호출 추가
- `check-planme-actions.mjs`: 신규 내부 API·공개 계약의 정적 검사 추가
- 외부 smoke: 실제 정류장·도보 서버 호출과 캐시 재사용 검사 추가

## 중단 조건

- 공급자 인증·계약 오류를 도보 추정으로 처리하는 코드 경로가 생김
- 운영 캐시 없이 기능이 활성화됨
- `stopRef` 또는 `placeConstraint`가 공급자 입력·복구 오류 문맥에서 누락됨
- 동시 실패 응답 순서에 따라 다른 복구 장소가 선택됨
- 공급자 호출 상한을 초과한 뒤에도 실제 ODsay 요청이 실행됨
- 한 요청에서 최종 저장 API를 정상적으로 두 번 이상 호출함
- 교체 후 `stopRef`가 달라지거나 고정 장소가 제거됨
- 시간표가 역행하거나 날짜 경계를 넘은 상태로 저장됨
- 추정 구간에서 절약시간 또는 가짜 경로선이 표시됨
