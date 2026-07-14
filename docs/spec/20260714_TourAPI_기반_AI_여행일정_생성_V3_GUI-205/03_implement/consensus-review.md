# 계획 합의 리뷰

## 상태

- Review status: `APPROVED_FOR_GOAL_EXECUTION`
- Review date: 2026-07-14
- Source documents: `01_interview`, `02_design`, `03_implement`
- Related Linear issue: GUI-205, 본문·댓글은 현재 세션에서 Linear MCP를 사용할 수 없어 미확인
- Execution decision: 2026-07-14 Goal 단일 실행 승인
- Execution status: WP0 조사 후 채널 전달 보완안 승인, WP1부터 실행 재개

## Planner Summary

### Goal

TourAPI가 확인한 장소만 사용하고 Luna가 `contentId`의 선택·순서만 제안하는 V3 여행일정을 구현한다. 서버가 시간표·경로·revision을 소유하며 GPTs, GPT App, 웹이 같은 active revision을 사용한다. 최우선 완료 기준은 기존 경계의 회귀를 막는 것이다.

### Scope

- 공통 V3 입력·후보·선택·계획·revision·표시 계약
- 웹 서버 TourAPI·Luna·일정·경로 오케스트레이터
- Redis 작업 상태, 단계 checkpoint, idempotency, active/pending/previous
- GPTs Actions와 GPT App MCP의 웹 내부 API 어댑터 전환
- 웹 active 조회, TourAPI contentId 편집, 브라우저 공급자 호출 제거
- V3-01~V3-10과 타입·빌드·린트·통합·E2E 검증

### Non-goals

- 여러 숙소와 일차 수 편집
- V1/V2 데이터 이관·적극 삭제
- 외부 작업 큐·새 DB·신규 비용 인프라
- 배포 rollback·feature flag 구현
- Vercel 환경변수 변경, PR 병합, 실제 배포
- 승인 없는 실제 외부 API smoke

### Implementation Outline

1. 변경 전 기준선과 공급자 fixture를 기록하고 채널 멱등성·완료 전달 제약을 조사한다.
2. 공급자 독립 core V3 계약·strict AI 검증·결정적 배열·일정·경로 정책을 구현한다.
3. 웹 서버 공급자 어댑터와 Redis 작업·revision 저장소를 독립 계약으로 구현한다.
4. 단계별 웹 오케스트레이터와 내부 API를 연결한다.
5. GPTs·MCP를 얇은 웹 API 어댑터로 전환한다.
6. 웹 상세·편집을 active revision과 TourAPI contentId로 전환하고 브라우저 경로 계산을 제거한다.
7. 전체 회귀 게이트와 금지 경계를 실행한다.

### Verification Plan

- V3-01~V3-10을 `test:v3`에서 집계한다.
- core, 공급자 mock, 메모리·Upstash 저장소 계약, 웹 내부 API, GPTs, MCP, Playwright 순으로 검증한다.
- 1일·2일·14일, TourAPI 정상 empty·장애·stale, Luna invalid·retry·fallback, ODsay 700m와 오류 행렬, revision 경합을 포함한다.
- 브라우저의 ODsay·네이버 Directions·finalize 요청은 0건이어야 한다.
- 실제 외부 smoke 결과와 결정적 모의 테스트 결과를 분리한다.

### Stop Conditions

- GPTs 필수 `invocationId` 또는 MCP JSON-RPC 요청 ID를 같은 전송 재시도에서 안정적으로 재사용할 수 없음
- GPTs 42초 동기 실행이 45초 제한 전에 terminal 응답을 만들지 못함
- GPT App 처리 중 위젯이 사용자 행동 없이 MCP 상태 도구를 자동 호출할 수 없음
- TourAPI·Luna·ODsay 공식 계약이 핵심 설계와 다름
- Upstash에서 필요한 원자 create·compare-and-set을 구현할 수 없음
- 서버리스 제한 안에 단계·route batch를 나눌 수 없음
- 신규 `unknown`, DB, 외부 큐, 비용 인프라 또는 네 허용 슬롯 밖 사용자 질문이 필요함

## RALPLAN-DR Summary

### Principles

- 일정 장소의 단일 원천은 TourAPI다.
- AI 출력은 신뢰 경계가 아니며 strict schema와 서버 allowlist로 통제한다.
- 시간표·경로·표시 revision은 서버가 소유한다.
- active는 완성된 불변 revision만 가리킨다.
- 사용자에게 먼저 물을 수 있는 값은 출발지, 목적지, 이동 수단, 기간뿐이다.
- 브라우저와 채널 어댑터는 별도 생성·경로 계산을 소유하지 않는다.
- 회귀 방지는 fallback으로 이전 불안정 경로를 되살리는 방식이 아니라 자동 게이트와 단계적 전환으로 달성한다.

### Decision Drivers

1. 장소 발명과 공급자 데이터 혼합을 기계적으로 차단할 수 있는가
2. 생성·편집 실패와 동시성에서 기존 active를 보존하는가
3. GPTs·GPT App·웹이 같은 결과를 사용하는가
4. 서버리스 시간 제한과 외부 API 장애를 checkpoint로 복구할 수 있는가
5. 기존 Redis와 두 Vercel 런타임 안에서 구현 가능한가
6. 제품 질문 금지와 1~14일 계약을 유지하는가

### Viable Options

| Option | Pros | Cons | Notes |
|---|---|---|---|
| 웹 단일 오케스트레이터 + MCP/GPTs 어댑터 | Redis·경로·편집과 같은 런타임에서 원자성 확보, 채널 공통 결과 | 웹 환경변수 이동, 변경 범위 큼 | 선택 |
| MCP 오케스트레이터 + 웹 저장 | 현재 OpenAI 키 배치 유지, MCP 변경 작음 | 경로·Redis가 웹에 있어 이중 소유와 전체 payload handoff 지속 | 구조적 회귀 위험 |
| AI가 TourAPI 함수 직접 호출 | 모델이 필요한 후보를 동적으로 찾음 | 검색 범위·재호출·누락을 AI가 소유해 allowlist와 캐시 통제가 약해짐 | 원칙 위반 |
| 외부 작업 큐 기반 웹 오케스트레이터 | 클라이언트 polling과 무관한 완료 보장 | 신규 인프라·비용·운영 승인 필요 | 현재 범위 밖 |
| Redis checkpoint + 채널 연속 advance | 신규 인프라 없이 실행 분할 | 안정 invocation ID와 자동 연속 호출 가능성 검증 필요 | 선행 게이트를 조건으로 선택 |

### Rejected Alternatives

| Alternative | Rejection Rationale |
|---|---|
| 기존 `PlanmeItinerary`에 contentId만 추가 | AI 시간표와 Standard·CarryME 중복 저장을 제거하지 못함 |
| AI 생성 실패 시 다른 모델 또는 V2 fallback | 장소·시간표 권한 경계를 다시 열어 가장 중요한 회귀 금지 목표를 위반함 |
| 정상 TourAPI 빈 결과에서 last-good 복원 | 삭제·부재한 장소를 되살려 현재 데이터 원칙을 위반함 |
| 브라우저 route finalization 유지 | 같은 일정이 브라우저 환경과 실행 순서에 따라 바뀜 |
| 입력 해시·시간창 기반 멱등성 | 독립적인 동일 요청과 전송 재시도를 구분하지 못함 |
| 한 PR에서 두 Vercel 런타임 동시 전환 가정 | 배포 완료 시점 차이의 계약 불일치를 통제하지 못함 |

### High-risk Pre-mortem

1. GPTs 42초 동기 실행이 시간 예산을 넘거나 GPT App 처리 중 위젯의 자동 호출이 중단돼 사용자가 결과를 받지 못한다.
2. 동일 도구 재시도 토큰이 없어 새 일정 ID가 중복 생성된다.
3. MCP와 웹 배포 순서가 엇갈려 새 어댑터가 없는 V3 API를 호출한다.
4. TourAPI 상위 30개만 조회해 사용자가 요청한 실제 장소를 없다고 잘못 판정한다.
5. Redis meta와 별도 포인터가 불일치해 pending 또는 이전 revision이 노출된다.
6. 1일 일정에 첫날·마지막 날 규칙이 충돌해 17:00 복귀 또는 실제 방문을 잃는다.
7. ODsay `-98`·411~414를 일반 성공으로 보정해 700m 밖 예상 경로가 만들어진다.

### Expanded Test Plan

- Unit: 후보 정규화, strict AI schema, 결정적 배열, 1·2·14일 계산, ODsay 오류 행렬
- Integration: provider mock, phase checkpoint, 원자 start, 동시 advance·edit, active activation
- Channel: GPTs·MCP 같은 revision, invocationId 재전송, 42초 예산, 처리 중 위젯 자동 호출 상한
- E2E: active만 표시, 편집 실패 보존, estimated walk path 없음, 브라우저 provider 0건
- Deployment readiness: 웹 V3 API 선행 배포 후 채널·UI 전환이 가능한 versioned 계약 확인
- Observability: 키·전체 URL·prompt·원본 응답 없는 안정 로그와 phase·revision 추적

## Architect Review

### Verdict

`APPROVE`

### Review Mode

`in-session`

### Findings

- 웹이 V3 오케스트레이터, 공급자, Redis를 소유하고 MCP·GPTs가 어댑터가 되는 경계는 현재 코드의 Redis·경로 소유 위치와 일치한다.
- core를 공급자 독립 순수 정책으로 두어 웹·채널 DTO가 같은 규칙을 공유할 수 있다.
- V3 namespace와 immutable revision은 V1/V2 이관 없이도 active 원자성을 제공한다.
- 1차 계획에는 1일 시간 규칙, 30개 AI 상한 전 요청 장소 탐색, revision 포인터의 단일 원천이 불명확했다.
- 보완 후 1일 규칙, 조회 상한과 AI 상한 분리, meta 단일 포인터, versioned checkpoint가 명시됐다.
- 안정 멱등성 토큰과 자동 연속 호출은 현재 코드만으로 입증되지 않아 WP0에서 중단했고, 이후 승인된 채널별 전달 보완안으로 실행 전제를 교체했다.

### Strongest Steelman Antithesis

MCP에 AI 오케스트레이션을 유지하면 현재 OpenAI 환경변수와 GPT 도구 실행 흐름을 재사용할 수 있고 웹 변경을 줄일 수 있다. 그러나 TourAPI 캐시·Redis revision·네이버·ODsay 경로·웹 편집이 웹에 있어 MCP가 전체 생성을 소유하면 상태 전이와 경로 활성화가 런타임 사이에 다시 분리된다. 핵심 목표가 최소 코드 변경이 아니라 회귀 없는 단일 결과이므로 웹 단일 소유가 더 강하다.

### Tradeoffs

- 큰 초기 변경 범위를 감수하는 대신 장기적으로 생성 경로를 하나로 줄인다.
- 외부 큐를 도입하지 않는 대신 GPTs 42초 예산과 GPT App 위젯 자동 호출 상한을 검증해야 한다.
- V1/V2 호환을 포기해 전환 코드는 줄지만 기존 링크는 V3 완료 기준에서 제외된다.
- strict AI 거부와 결정적 fallback은 생성 다양성보다 장소 무결성을 우선한다.

### Synthesis Path

웹 V3 API를 additive하게 완성하고 core·저장·provider 계약을 먼저 통과시킨다. 채널과 웹 호출부는 마지막에 전환한다. 실제 배포는 웹 API 선행, 채널·UI 후행의 두 단계 PR로 분리한다. WP0에서 채널 실행 가정이 틀리면 구현을 확대하지 않고 설계로 반환한다.

### Principle Violations

없음. 1차 검토에서 발견된 불명확성은 계획 문서에 반영됐다.

### Required Changes

완료:

- 1일 일정의 첫날·마지막 날 결합 규칙 추가
- TourAPI 조회 범위와 AI 30개 전달 상한 분리
- Redis meta를 revision 포인터 단일 원천으로 고정
- phase checkpoint에 version·입력 digest 추가
- 멱등성 토큰과 ChatGPT 자동 연속 호출을 WP0 중단 게이트로 상향
- WP0 조사 후 GPTs 필수 기술 `invocationId`·42초 동기 실행과 GPT App 처리 중 위젯 자동 호출로 보완

## Critic Review

### Verdict

`APPROVE`

### Review Mode

`in-session`

### Principle-option Consistency

선택안은 TourAPI 단일 원천, AI 권한 제한, 서버 시간표·경로, active 원자성, 질문 allowlist와 일치한다. 다른 모델·V2·브라우저 공급자 fallback을 남기지 않는다.

### Alternative Fairness

MCP 중심안은 현재 배치 재사용 장점이 있으나 상태 소유 분리라는 직접 비용이 있다. 외부 큐안은 완료 보장이 강하지만 이번 범위의 인프라·비용 권한을 넘는다. Redis checkpoint안의 약점은 숨기지 않고 선행 실증 게이트로 전환했다.

### Failure Scenarios

- 정상 TourAPI empty와 장애를 구분하고 유형별 last-good만 허용한다.
- Luna 두 번 실패 또는 허용 목록 위반은 결정적 배열로만 전환한다.
- 경로 불가 장소는 단조롭게 제외하고 필수 기준점·숙소 실패는 terminal failed다.
- 편집 중 다른 pending을 거부하고 실패·충돌에서 active를 보존한다.
- 같은 멱등 키의 동시 start는 원자 create로 한 ID만 만든다.
- phase timeout은 versioned checkpoint와 route cursor로 재개한다.
- 두 Vercel 런타임은 실제 배포 시 두 단계 PR 전환을 전제한다.

### Missing Evidence

- GUI-205 Linear 본문·댓글
- GPTs 42초 예산 안의 14일 mock terminal 완료 성능
- GPT App 처리 중 위젯 자동 호출의 실제 ChatGPT 호스트 동작
- TourAPI 실제 페이지·오류 payload
- Luna 실제 structured output 요청·응답
- Upstash 실제 원자 명령 지원 범위
- 개발 키 기반 외부 smoke

위 항목 중 구현 가능성을 바꾸는 내용은 채널 전환 중단 게이트다. 외부 smoke와 Linear 미확인은 통과했다고 기록하지 않는다.

### Verification Gaps

1차 계획에는 두 Vercel 런타임의 배포 시점 차이와 14일 최악 advance 호출 수 측정이 빠져 있었다. 웹 V3 API 선행 배포 조건과 호출 수·채널 한도 비교를 추가했다.

### Risk Mitigation

- 실행 가정은 코드 구현 전에 실증한다.
- 외부 제공자는 fixture 계약을 우선하고 실제 smoke를 별도로 기록한다.
- 모든 저장 전환은 expected revision·phase compare-and-set을 사용한다.
- V3 API는 versioned 경로로 추가해 웹 선행 배포가 기존 동작을 바꾸지 않게 한다.
- 필수 게이트 하나라도 실패하면 구현·PR 완료로 보지 않는다.

### Required Changes

완료:

- 실제 배포를 웹 V3 API 선행, 채널·UI 후행 두 단계로 분리
- 14일 최악 advance 호출 수와 ChatGPT 자동 호출 한도 비교 추가
- 같은 멱등 키 동시 start와 pending 편집 중 두 번째 edit 검증 추가

## Iteration Log

| Iteration | Planner Change | Architect Verdict | Critic Verdict | Remaining Issue |
|---|---|---|---|---|
| 1 | 초기 03_implement 문서 세트 작성 | `ITERATE` | 미진행 | 1일 규칙, 후보 조회 상한, 포인터 단일 원천 |
| 2 | 세 항목과 checkpoint·채널 선행 게이트 보완 | `APPROVE` | `ITERATE` | 배포 순서, 최악 advance 호출 수 |
| 3 | 두 단계 배포 전제와 호출 수 측정 추가 | `APPROVE` | `APPROVE` | 사용자 최종 실행 승인 |
| 4 | WP0 실증 실패 후 GPTs 42초 동기·invocationId, GPT App 처리 중 위젯 자동 호출로 보완 | `APPROVE` | `APPROVE` | 구현 중 성능·호스트 계약 검증 |

## User Decision

- Decision: Goal 단일 실행 승인
- Reason: 합의된 구현계획으로 Goal을 생성해 작업 진행
- Amendment: 2026-07-14 GPTs는 단일 45초 제한 내 동기 처리와 필수 기술 `invocationId`, GPT App은 사용자 동작 없는 처리 중 위젯 자동 호출 사용 승인
- Requested changes: 승인된 amendment 외 없음

## Execution Handoff

### Recommended Lane

`single execution`

사용자가 서브에이전트 또는 팀 개발을 요청하지 않았으므로 단일 Goal 실행으로 진행한다. 문서·코드·테스트는 작업 묶음 순서대로 직렬 수행한다.

### Team Development Notes

- Candidate lanes: 해당 없음
- Disjoint write sets: 해당 없음
- Shared interfaces: core V3 계약, 웹 내부 API, revision DTO
- Review checkpoints: WP0 실증, WP4 오케스트레이터, WP5 채널 전환, WP7 전체 게이트

### Single Execution Notes

- First task: 변경 전 기준선과 WP0 제약 조사 완료 후 승인된 채널 전달 amendment를 반영하고 WP1 core V3 계약 구현
- Required tests: V3-01~V3-10, core build, MCP typecheck, actions, MCP, finalization, route normalization, web build, lint, 관련 E2E
- Manual verification: 실제 외부 smoke는 개발 키와 별도 승인 시에만 수행
- Stop rule: GPTs 42초 동기 실행 또는 GPT App 처리 중 위젯 자동 호출 계약을 구현·검증할 수 없으면 채널 전환을 확대하지 않고 설계 단계로 반환
