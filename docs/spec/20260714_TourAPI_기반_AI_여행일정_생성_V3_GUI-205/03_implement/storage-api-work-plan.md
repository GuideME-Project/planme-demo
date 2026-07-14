# 저장과 웹 API 구현계획

## 결론

V3는 기존 preview 저장을 확장하지 않고 V3 namespace에 작업 meta와 불변 revision을 저장한다. 생성·편집은 pending에서 계산한 뒤 compare-and-set 방식으로 active를 바꾸며, 실패하거나 충돌하면 기존 active를 보존한다.

## 근거

- 설계: [저장과 정합성](../02_design/storage-and-consistency.md), [채널과 웹 연동](../02_design/channel-and-web-integration.md)
- 현재 코드: `apps/web/lib/preview-itinerary-store.ts`, `apps/web/app/api/gpt/itineraries/preview-store/route.ts`, `apps/web/app/api/gpt/itineraries/[itineraryId]/route.ts`
- 현재 저장은 V2 전체 일정 하나를 TTL과 함께 저장하며 pending/active·멱등성·단계 잠금이 없다.
- 미확인: 운영 Upstash의 명령·스크립트 제한과 실제 동시성 부하

## Redis 키 계획

예시 키는 의미 전달용이며 구현 시 기존 prefix helper와 Upstash 명령 지원을 확인한다.

```text
planme:v3:itinerary:{itineraryId}:meta
planme:v3:itinerary:{itineraryId}:phase:{revision}
planme:v3:itinerary:{itineraryId}:revision:{revision}
planme:v3:lock:{itineraryId}:{revision}
planme:v3:idempotency:{idempotencyKeyHash}
planme:v3:tour:{regionCode}:{districtCode}:{contentTypeId}:fresh
planme:v3:tour:{regionCode}:{districtCode}:{contentTypeId}:last-good
```

- 최종 일정과 meta의 TTL은 7일이다.
- 멱등성 레코드 TTL은 24시간이다.
- fresh 후보 TTL은 24시간, last-good은 7일이다.
- revision과 포인터는 같은 절대 만료시각을 사용한다.
- 멱등성 키와 원문 사용자 입력은 Redis key에 직접 넣지 않고 안정된 digest를 사용한다.
- V1/V2 namespace를 읽거나 삭제하지 않는다.

## 저장 DTO

```ts
type ItineraryJobMeta = {
  schemaVersion: 3;
  itineraryId: string;
  kind: "generation" | "edit";
  phase: ItineraryPhase;
  activeRevision: number | null;
  pendingRevision: number | null;
  previousRevision: number | null;
  baseRevision?: number;
  routeCursor?: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  errorCode?: string;
};
```

- `errorCode`만 저장하고 제공자 원본 오류·전체 AI 출력은 저장하지 않는다.
- meta의 `activeRevision`, `pendingRevision`, `previousRevision`이 포인터의 단일 원천이며 별도 포인터 키를 만들지 않는다.
- 각 revision은 선택한 TourAPI 장소 스냅샷과 경로 결과를 내장한다.
- 정상 빈 TourAPI 결과는 fresh에 빈 배열로 저장하며 last-good을 읽는 장애로 분류하지 않는다.
- phase checkpoint는 schema version과 입력 digest를 가져 구현 변경 또는 다른 입력의 중간 결과를 재사용하지 않는다.

## 저장소 인터페이스

후보: 메모리와 Upstash 구현이 같은 계약을 공유한다.

```ts
type ItineraryJobStore = {
  createGeneration(input: CreateGenerationCommand): Promise<CreateJobResult>;
  acquirePhase(input: AcquirePhaseCommand): Promise<AcquirePhaseResult>;
  savePhaseResult(input: SavePhaseResultCommand): Promise<void>;
  activate(input: ActivateRevisionCommand): Promise<ActivateResult>;
  fail(input: FailJobCommand): Promise<void>;
  getStatus(itineraryId: string): Promise<ItineraryJobSnapshot | null>;
};
```

실제 원자성은 Upstash가 지원하는 transaction 또는 Lua/EVAL 범위를 확인해 가장 작은 compare-and-set으로 구현한다. read 후 별도 write만으로 active를 바꾸지 않는다.

## 멱등성과 ID

- 새 사용자 생성 요청은 정규화 입력이 같아도 매번 새 itinerary ID를 만든다.
- 같은 도구 호출의 재시도만 같은 멱등성 키를 사용한다.
- 같은 키와 같은 정규화 입력 digest면 기존 ID·상태를 반환한다.
- 같은 키와 다른 digest면 `409 IDEMPOTENCY_KEY_REUSED`다.
- 키가 없는 호출은 새 ID를 만든다.
- ID는 요청 내용에서 결정적으로 만들지 않는다.
- 멱등성 레코드 확인·새 ID 생성·meta 생성은 하나의 원자 작업이다. 동시 같은 키 요청이 두 ID를 만들 수 없어야 한다.
- GPTs는 요청 body의 필수 기술 필드 `invocationId`, GPT App MCP는 SDK가 전달한 JSON-RPC 요청 ID를 멱등성 키의 원천으로 사용한다.
- `invocationId`는 사용자에게 질문하지 않고 장소 선택 AI 입력에도 포함하지 않는다. 같은 사용자 생성 요청의 전송 재시도에는 같은 값을, 새 생성 요청에는 새 값을 사용한다.
- 키를 얻지 못하면 입력 해시나 시간창으로 임의 dedupe하지 않고 요청을 거부한다.

## revision 활성화

### 새 생성

1. revision 1을 pending으로 만든다.
2. 모든 단계 결과를 revision 1에 조립한다.
3. 검증 완료 후 `active=1`, `pending` 제거를 원자 처리한다.
4. 실패하면 active 없이 failed meta만 남긴다.

### 편집

1. 요청의 `baseRevision`이 현재 active인지 확인한다.
2. 다른 pending이 없을 때만 다음 revision을 pending으로 만든다. 이미 편집 중이면 409를 반환한다.
3. 전체 Standard·CarryME·시간표·경로를 다시 계산한다.
4. 활성화 시 active가 여전히 base revision인지 다시 확인한다.
5. 성공 시 `previous=base`, `active=pending`; 실패·충돌 시 active·previous 불변이다.

## 내부 API 계획

웹 서버가 상태 변경을 소유하고 MCP는 `Authorization: Bearer {PLANME_INTERNAL_API_TOKEN}`으로 호출한다.

| 메서드·경로 후보 | 업무 의미 | 요청 | 성공 응답 |
| --- | --- | --- | --- |
| `POST /api/internal/planme/v3/itineraries` | 새 생성 시작 | `StartItineraryRequest`, 멱등성 헤더 | 202 processing |
| `POST /api/internal/planme/v3/itineraries/{id}/advance` | 한 단계 진행 | 현재 상태 식별자 | 200 processing/ready/failed |
| `POST /api/internal/planme/v3/itineraries/{id}/run` | GPTs 시간 제한 실행 | deadline epoch ms | 200 ready/failed |
| `GET /api/internal/planme/v3/itineraries/{id}` | 내부 상태 조회 | 없음 | 200 상태 DTO |
| `POST /api/internal/planme/v3/itineraries/{id}/edits` | 편집 시작 | base revision, edit command | 202 processing 또는 409 |

외부 읽기 경로는 기존 상세 링크 형태를 유지한다.

| 메서드·경로 | 업무 의미 | 인증 | 응답 |
| --- | --- | --- | --- |
| `GET /api/gpt/itineraries/{id}` | active 상태·표시 DTO 조회 | 공개 read | 200 processing/ready/failed, 404 |

상태 조회 GET은 phase를 진행하지 않는다. 단계 진행은 내부 POST에서만 한다.

## 요청·응답 규칙

### start

- `Idempotency-Key`는 GPTs `invocationId` 또는 MCP JSON-RPC 요청 ID에서 만들며 AI 장소 선택 입력이 아니다.
- body의 required/optional/null 규칙은 공통 V3 계약을 사용한다.
- malformed JSON과 DTO 위반은 400이다.
- 내부 토큰 누락·불일치는 401로 응답하되 토큰 존재 여부를 구체화하지 않는다.

### status

```ts
type ItineraryJobResponse =
  | {
      status: "processing";
      itineraryId: string;
      phase: ItineraryPhase;
      retryAfterMs: number;
    }
  | {
      status: "ready";
      itineraryId: string;
      revision: number;
      pageUrl: string;
      widget: ItineraryDisplayDto;
      excludedRequestedPlaces: ExcludedRequestedPlace[];
    }
  | {
      status: "failed";
      itineraryId: string;
      errorCode: string;
      message: string;
    };
```

- `processing`에는 부분 itinerary와 성공 링크가 없다.
- `ready`만 active revision을 포함한다.
- `failed` message는 추가 제품 질문을 포함하지 않는다.
- `retryAfterMs`는 500ms부터 최대 2초다.

### run

- GPTs 어댑터만 호출하며 외부 요청 수신 시각 기준 42초보다 이른 deadline을 전달한다.
- 서버는 `advance`를 반복하되 각 단계 시작 전 남은 예산이 해당 단계의 최소 안전 예산보다 작은지 확인한다.
- deadline 안에 ready가 되지 않으면 `TIME_BUDGET_EXCEEDED` terminal failed로 저장하고 부분 revision이나 성공 링크를 반환하지 않는다.
- GPT App은 이 명령을 사용하지 않고 처리 중 위젯의 자동 MCP 호출로 한 단계씩 진행한다.

## 상태 코드

| 상태 | HTTP | 조건 |
| --- | ---: | --- |
| processing 생성 | 202 | 시작·편집 accepted |
| processing 진행 | 200 | advance 후 아직 처리 중 |
| ready | 200 | active revision 존재 |
| invalid input | 400 | DTO·허용 슬롯 위반 |
| unauthorized | 401 | 내부 토큰 실패 |
| not found | 404 | 작업·일정 없음 |
| idempotency/revision conflict | 409 | 키 digest 또는 base revision 충돌 |
| edit already running | 409 | 같은 일정에 pending revision이 이미 존재 |
| rate limited | 429 | 앱 자체 제한 |
| provider/configuration failure | 200 terminal failed | 작업 생성 뒤 meta에 실패 저장 |
| store unavailable before job creation | 503 | 조회 가능한 작업을 만들지 못함 |

start는 입력·인증 검증 뒤 job을 먼저 만든다. 작업이 만들어진 뒤의 공급자·설정 실패는 조회 가능한 terminal `failed`로 저장한다. job 생성 자체가 실패한 경우만 안전한 503을 반환한다.

## 동시성과 재시도

- 단계 잠금은 짧은 lease와 예상 phase를 함께 사용한다.
- 잠긴 작업의 중복 advance는 409로 실패시키지 않고 현재 processing을 반환한다.
- phase 결과 저장과 다음 phase 전이는 하나의 상태 비교 단위다.
- 네트워크 타임아웃 뒤 결과가 저장됐는지 먼저 확인한 후 외부 호출을 반복한다.
- 경로 batch는 완료 segment ID를 저장해 부분 재시작한다.
- 잠금 만료는 작업 TTL을 연장하지 않는다.

## 보안과 로그

- `PLANME_INTERNAL_API_TOKEN`은 기존 토큰 검증 helper를 공통화하되 값은 출력하지 않는다.
- 사용자 출발지·목적지·선호 원문을 key나 metric label에 넣지 않는다.
- 로그 필드는 itinerary ID, revision, phase, 후보 수, provider category, stable error code로 제한한다.
- AI 전체 prompt·output, TourAPI 전체 응답, 인증 query는 로그에 남기지 않는다.

## 검증 계획

- 메모리·Upstash 계약: 같은 테스트 표를 실행한다.
- 경합: 같은 phase 동시 advance, 같은 base revision 동시 편집을 테스트한다.
- TTL: 모든 revision 포인터와 meta가 같은 절대 만료시각인지 검사한다.
- 캐시: fresh hit, 정상 empty, 유형별 outage, last-good 없음·있음을 검사한다.
- 보안: 인증 실패, 로그 캡처의 키·원문 부재를 검사한다.

## 운영 경계

- 스키마 마이그레이션은 없다. V3는 새 Redis namespace를 사용한다.
- V1/V2 데이터 보정·삭제는 없다.
- 실제 Upstash 계약 smoke는 개발 환경과 별도 승인이 있을 때 수행한다.
- 배포 rollback 구현은 범위 밖이며 active revision 원자성과 테스트 게이트가 회귀 방지 수단이다.
