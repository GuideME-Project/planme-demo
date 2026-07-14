# 구현 인덱스

## 목적

TourAPI 기반 AI 여행일정 생성 V3를 회귀 없이 구현하기 위한 작업 순서, 파일별 변경 계획, API·저장 계약과 검증 기준을 관리한다.

실행의 단일 기준은 `01_interview`, `02_design`, 이 디렉터리의 구현계획, 합의 리뷰 순서다. 구현 중 새로운 제품 결정이 필요하면 임의로 확장하지 않고 설계 단계로 되돌린다.

## 문서 목록

| 문서 | 목적 | 상태 |
| --- | --- | --- |
| [implementation-sequence.md](implementation-sequence.md) | 의존성을 반영한 전체 작업 순서와 중단 조건 | 구현 완료 |
| [core-orchestrator-work-plan.md](core-orchestrator-work-plan.md) | 공통 V3 계약, TourAPI, Luna, 일정·경로 오케스트레이터 계획 | 구현 완료 |
| [storage-api-work-plan.md](storage-api-work-plan.md) | Redis 작업·revision·멱등성·웹 내부 API 계획 | 구현 완료 |
| [channel-web-work-plan.md](channel-web-work-plan.md) | GPTs·GPT App 어댑터와 웹 조회·편집 전환 계획 | 구현 완료 |
| [verification-work-plan.md](verification-work-plan.md) | V3-01~V3-10과 정적·통합·E2E 검증 계획 | 검증 완료 |
| [consensus-review.md](consensus-review.md) | Planner·Architect·Critic 합의와 실행 결정 | 승인 완료 |
| [wp0-findings.md](wp0-findings.md) | Goal 실행 전제와 채널 멱등성·자동 진행 조사 결과 | 완료·보완 승인 |
| [verification-log.md](verification-log.md) | 변경 전 기준선과 WP1~WP7 구현·검증 결과 | 완료 |
| [completion-criteria-traceability.md](completion-criteria-traceability.md) | GUI-157 완료 기준의 V3 적용·대체·회귀·외부 승인 추적 | 완료 |

구현 결과와 검증 로그는 실제 Goal 실행 시 확인된 내용만 별도 문서로 추가한다. 빈 결과 문서는 미리 만들지 않는다.

## 관련 근거

| 출처 | 링크 | 관련 이유 | 확인 상태 |
| --- | --- | --- | --- |
| 인터뷰 | [01_interview/index.md](../01_interview/index.md) | 제품 범위와 확정 정책 | 확인함 |
| 설계 | [02_design/index.md](../02_design/index.md) | 아키텍처·계약·검증 기준 | 확인함 |
| 런타임 설계 | [architecture-and-domain-model.md](../02_design/architecture-and-domain-model.md) | 웹 단일 오케스트레이터와 V3 도메인 | 확인함 |
| 외부 공급자 설계 | [tourapi-ai-contract.md](../02_design/tourapi-ai-contract.md) | TourAPI와 Luna 권한 경계 | 확인함 |
| 저장 설계 | [storage-and-consistency.md](../02_design/storage-and-consistency.md) | revision·캐시·멱등성 | 확인함 |
| 채널 설계 | [channel-and-web-integration.md](../02_design/channel-and-web-integration.md) | GPTs·MCP·웹 계약 | 확인함 |
| 검증 설계 | [validation-plan.md](../02_design/validation-plan.md) | 필수 회귀 게이트 | 확인함 |
| Linear | GUI-205 | 이슈 본문·댓글 | 현재 세션에서 Linear MCP를 사용할 수 없어 미확인 |

## 현재 코드 근거

- `packages/planme-core/src/gpt-actions.ts`가 현재 AI 생성, 장소 확인, clarification을 묶는다.
- `apps/mcp/src/planme-mcp.ts`와 `apps/mcp/src/gpts-actions-api.ts`가 OpenAI 생성 후 웹의 preview 저장 API로 전체 일정을 넘긴다.
- `apps/web/lib/preview-itinerary-store.ts`는 V2 preview를 Redis에 저장한다.
- `apps/web/components/itinerary/ItineraryDashboard.tsx`가 브라우저에서 경로 확정과 장소 검색을 시작한다.
- `apps/web/lib/route-providers/odsay.ts`가 서버에서도 공개 ODsay 환경변수 이름을 읽는다.

## 현재 상태

- 제품·설계 결정은 문서화됐다.
- 구현계획은 합의 리뷰 승인을 받았다.
- Goal은 WP0에서 GPT Actions 멱등성 토큰과 자동 연속 호출 보장이 확인되지 않아 한 차례 중단했다.
- 2026-07-14 GPTs 필수 `invocationId`·42초 동기 실행과 GPT App 처리 중 위젯 자동 호출 보완안이 승인되어 WP1부터 재개했다.
- WP1~WP7 구현과 독립 회귀 감사를 완료했다.
- Vercel 환경변수 변경, 외부 API smoke, PR·병합·배포는 이번 계획 작성 단계의 실행 범위가 아니다.

## 완료 조건

- 합의 리뷰에서 Architect와 Critic이 모두 `APPROVE`한다.
- 최종 실행 승인을 받은 Goal에서 계획 순서를 지킨다.
- 필수 게이트 V3-01~V3-10, 타입 검사, 빌드, 린트가 모두 통과한다.
- 키가 없는 환경에서는 외부 smoke를 통과로 기록하지 않고 미실행 사유를 분리한다.
- GPTs와 GPT App이 같은 웹 오케스트레이터 결과를 사용하며 브라우저 공급자 호출이 0건이다.

## 다음 액션

1. 별도 승인 뒤 개발 환경에서 외부 API와 실제 Upstash smoke를 실행한다.
2. 저장소 규칙에 따라 웹 내부 계약 PR과 채널·UI 전환 PR을 분리해 검토한다.
3. 실제 ChatGPT host bridge와 운영 환경변수 readiness를 배포 전에 확인한다.
