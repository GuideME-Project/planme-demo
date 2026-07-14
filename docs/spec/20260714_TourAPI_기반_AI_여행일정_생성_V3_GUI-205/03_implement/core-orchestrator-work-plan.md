# 공통 계약과 웹 오케스트레이터 구현계획

## 결론

V3 핵심 규칙은 `packages/planme-core`의 순수 모듈로 만들고, 외부 API 호출과 상태 전이는 `apps/web`에 둔다. AI는 TourAPI 후보의 `contentId` 배열만 반환하며, 서버의 strict 검증을 통과한 선택만 시간표와 경로 계산에 사용한다.

## 근거

- 설계 문서: [아키텍처와 도메인 모델](../02_design/architecture-and-domain-model.md), [TourAPI와 AI 계약](../02_design/tourapi-ai-contract.md), [일정과 경로](../02_design/scheduling-and-routing.md)
- 현재 코드: `packages/planme-core/src/gpt-actions.ts`, `packages/planme-core/src/openai-itinerary-generator.ts`, `apps/web/lib/itinerary-route-finalizer.ts`
- 현재 리스크: core의 기존 AI 생성기는 환경변수를 직접 읽고 장소명·시간표를 포함한 전체 일정을 생성한다. V3에서 재사용하면 AI 권한 제한을 보장할 수 없다.
- 미확인 자료: GUI-205 Linear 본문·댓글, 실제 TourAPI 샘플과 Luna structured output 호출 결과

## 변경 파일 후보

| 파일 | 변경 목적 | 주의점 |
| --- | --- | --- |
| `packages/planme-core/src/v3/contracts.ts` | 입력·후보·선택·계획·revision·표시 타입 | 기존 `PlanmeItinerary`에 V3 필드를 혼합하지 않음 |
| `packages/planme-core/src/v3/tour-candidates.ts` | 콘텐츠 유형 allowlist, 좌표·제목 정규화, 안정 정렬 | `mapX=lng`, `mapY=lat`; 유형 25 차단 |
| `packages/planme-core/src/v3/ai-selection.ts` | AI 출력 strict 검증과 허용 목록 결합 | 추가 필드도 전체 거부 |
| `packages/planme-core/src/v3/deterministic-arranger.ts` | Luna 실패 시 결정적 배열 | 동일 입력은 동일 결과 |
| `packages/planme-core/src/v3/scheduler.ts` | 서버 시간표와 Standard·CarryME 파생 | AI 시간 사용 금지 |
| `packages/planme-core/src/v3/route-policy.ts` | ODsay 오류 결정표와 예상 도보 계산 | 700m 경계와 분 올림 고정 |
| `packages/planme-core/src/v3/display.ts` | revision에서 채널·웹 표시 DTO 생성 | 웹 제외 안내는 별도 옵션으로 차단 |
| `packages/planme-core/src/index.ts` | V3 public export 추가 | 기존 export 유지 |
| `apps/web/lib/planme-v3/tour-api-client.ts` | TourAPI HTTP 호출·오류 분류 | 키·원본 URL 로그 금지 |
| `apps/web/lib/planme-v3/luna-planner.ts` | Luna structured output 호출 | 모델·추론 강도 고정 |
| `apps/web/lib/planme-v3/route-service.ts` | 네이버·ODsay 서버 경로 조합 | 브라우저용 공개 키 사용 금지 |
| `apps/web/lib/planme-v3/orchestrator.ts` | 단계별 명령과 의존성 조합 | 저장소 상태 전이와 외부 호출 분리 |

파일은 구현 중 책임이 과도하게 커질 때만 더 나눈다. 기존 파일 이름을 억지로 유지해 V2와 V3 정책을 한 함수에 섞지 않는다.

## 공통 타입 계획

예시: 실제 구현 전 전달용 타입이다.

```ts
export type StartItineraryRequest = {
  origin: string;
  destination: string;
  transportMode: "drive" | "transit";
  durationDays: number;
  travelStartDate?: string;
  preferences?: string[];
  requestedPlaces?: string[];
  travelerCount?: number;
  luggageCount?: number;
};

export type AiPlanSelection = {
  lodgingContentId: string;
  days: Array<{
    day: number;
    orderedVisitContentIds: string[];
    restaurantContentIds: string[];
  }>;
};
```

계약 규칙:

- `origin`, `destination`, `transportMode`, `durationDays`는 required, non-null이다.
- 선택 필드는 null 대신 생략한다.
- `travelerCount=1`, `luggageCount=1`, 배열 필드 `[]`는 서버 정규화 기본값이다.
- 기간은 정수 1~14, 인원은 1~20, 짐은 0~20이다.
- 입력 파싱을 위해 신규 `unknown`을 도입하지 않는다. 기존 request JSON 파싱 경계의 타입과 명시적 schema 결과를 사용한다.

## TourAPI 구현 계획

### 호출 순서

1. `ldongCode2`로 목적지 법정동 시도·시군구 코드를 결정한다.
2. 콘텐츠 유형별 `areaBasedList2`, 숙소 `searchStay2`를 조회한다.
3. 날짜가 있을 때만 `searchFestival2`를 조회한다.
4. 선택 장소의 표시 필드가 부족할 때만 `detailCommon2`를 호출한다.
5. 정규화·좌표·지역·유형 검사를 통과한 후보만 캐시에 저장한다.

### 클라이언트 경계

```ts
type TourApiClient = {
  resolveArea(destination: string): Promise<TourArea>;
  listCandidates(input: TourCandidateQuery): Promise<TourApiPage>;
};
```

- 서비스 키는 `TOUR_API_SERVICE_KEY`에서 서버에서만 읽는다.
- 실제 base URL, 쿼리 인코딩, 성공·오류 본문은 공식 샘플 호출 전에 확정하지 않는다.
- HTTP 429·5xx·네트워크 오류와 정상 빈 결과를 다른 union으로 반환한다.
- 후보는 유형별 최대 30개로 안정 정렬한다.
- 30개는 AI 전달 상한이다. TourAPI 조회는 공식 페이지 정보를 기준으로 서버가 결정적 호출량 상한을 적용하고, 요청 장소 정확 일치는 절단 전에 검사한다.
- 숙소 1개와 실제 방문 장소 1개가 없으면 생성 실패다. 음식점은 없어도 된다.

## Luna 구현 계획

### 요청

- Responses API 모델은 `gpt-5.6-luna`다.
- 추론 강도는 `low`다.
- 입력은 서버가 정규화한 후보 스냅샷과 선택 규칙만 포함한다.
- 출력 JSON schema는 `additionalProperties: false`와 day별 필수 배열을 사용한다.
- 프롬프트에는 후보 밖 ID·장소, 이름, 좌표, 시간, 경로, 설명 생성 금지를 명시한다.

### 검증과 fallback

1. JSON schema 검증
2. 일차 수와 번호 검증
3. 숙소·방문·음식점 유형 검증
4. 후보 allowlist 검증
5. 숙소 외 중복 검증
6. TourAPI 스냅샷 재결합

첫 실패 후 같은 모델·같은 스냅샷으로 한 번만 재시도한다. 다시 실패하면 결정적 배열기를 사용한다. 다른 모델, V2 생성기, MCP 생성기로 전환하지 않는다.

## 일정 계산 계획

- 첫날은 출발지에서 목적지까지 실제 이동 이후 시작한다.
- 중간 날은 09:30 고정 숙소 출발이다.
- 마지막 날은 09:30 숙소에서 출발하고 17:00에 복귀 이동을 시작하도록 목적지 방문을 배치한다.
- 1일 일정은 첫날·마지막 날 규칙을 합쳐 실제 도착 뒤 시작하고 같은 날 17:00 복귀 이동을 시작한다. 유효 방문 하나를 넣을 수 없으면 생성 실패다.
- 점심은 12:00~14:00, 저녁은 18:00~20:00에 둔다.
- 음식점 후보가 없으면 좌표 없는 일반 식사 시간을 넣는다.
- 방문 장소가 부족하면 중복하지 않고 자유시간 또는 숙소 휴식을 넣는다.
- 이동시간 증가로 시간창을 넘으면 다음 일차로 미루고, 불가능하면 제외한다.
- 숙소는 전체 여행에서 하나만 사용한다.
- Standard와 CarryME는 같은 `TripPlan`에서 파생한다.

## 경로 결정표

| 상황 | 처리 | 저장 표시 |
| --- | --- | --- |
| ODsay 성공 | 제공자 duration·path 사용 | `provider_route` |
| ODsay `-98`, 직선거리 700m 이하 | ODsay 도보 API 호출 | 도보 결과 |
| 도보 411~414, 700m 이하 | 직선거리÷4km/h, 분 올림, 최소 1분 | `estimated_walk`, path 없음 |
| `-98`, 700m 초과 | 예상 도보 금지, 실패 폐쇄 | 장소 제외 또는 필수 구간 실패 |
| 408·429·500·`-1` | 같은 구간 한 번 재시도 | 재시도 결과 |
| 3·4·5·6·`-99` | 선택 장소 제외, 기준점이면 실패 | 안정 오류 코드 |
| `-8`·`-9`, 인증·미분류 | 재시도 없이 실패 | 안정 오류 코드 |

경계 거리는 직선거리로 판단한다. 예상 도보에는 지도 경로선을 만들지 않는다.

## 오케스트레이터 단계

```ts
type ItineraryPhase =
  | "queued"
  | "resolving_anchors"
  | "collecting_candidates"
  | "arranging"
  | "scheduling"
  | "routing"
  | "activating"
  | "ready"
  | "failed";
```

각 `advance`는 현재 예상 phase와 잠금을 확인하고 다음 중 하나만 수행한다.

- 기준점 하나의 해결
- 콘텐츠 유형 하나 또는 제한된 묶음의 후보 수집
- AI 배열과 fallback 결정
- 순수 일정 계산
- 제한된 경로 segment batch
- revision 활성화

외부 호출 결과는 phase별 versioned checkpoint로 다음 phase 전환 전에 저장한다. checkpoint는 입력 digest, phase version, 완료된 공급자 호출 단위와 안전한 정규화 결과를 가진다. 같은 phase 재시도는 digest와 version이 일치하는 완료 결과를 재사용하고 active를 직접 수정하지 않는다.

## 오류 계획

| 코드 | 의미 | 사용자 처리 |
| --- | --- | --- |
| `INVALID_PLANNING_INPUT` | 네 필수 입력 또는 범위 오류 | 해당 허용 슬롯만 다시 입력 |
| `DESTINATION_NOT_RESOLVED` | 목적지 기준점 실패 | destination만 다시 입력 |
| `ORIGIN_NOT_RESOLVED` | 출발지 기준점 실패 | origin만 다시 입력 |
| `TOURAPI_UNAVAILABLE` | 후보 수집 장애와 last-good 없음 | 추가 질문 없이 실패 |
| `TOURAPI_CANDIDATES_INSUFFICIENT` | 숙소 또는 방문 장소 없음 | 추가 질문 없이 실패 |
| `ROUTE_UNAVAILABLE` | 필수 기준점 경로 실패 | 추가 질문 없이 실패 |
| `JOB_CONFLICT` | 상태·revision 충돌 | 409, active 유지 |
| `INTERNAL_CONFIGURATION_ERROR` | 서버 키·설정 누락 | 안전 문구, 상세 로그 비공개 |

제공자 원본 코드와 메시지는 내부 원인 분류에만 사용하고 공개 message에 넣지 않는다.

## 검증 계획

- core 단위: 후보 정규화, strict AI schema, 결정적 배열, 일정 시간창, 경로 결정표
- 웹 계약: 공급자 성공·빈 응답·429·5xx·invalid payload fixture
- 통합: start부터 ready까지 단계별 상태 전이와 재개
- 금지 경계: MCP OpenAI/TourAPI 클라이언트 부재, 브라우저 공급자 호출 부재

## 미해결 조건

- TourAPI 서비스 키의 실제 URL 인코딩 방식과 오류 payload는 공식 샘플로 확인해야 한다.
- Luna의 현재 structured output 요청 필드는 구현 시 공식 OpenAI 문서와 실제 모의 경계로 재확인해야 한다.
- 실제 외부 smoke는 개발 키와 호출 승인을 받은 뒤에만 수행한다.
