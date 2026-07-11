# PlanME 웹 상세 시간표 짐 행 및 강조 표시 정리 합의 검토

## 상태

- Review status: `APPROVE`
- Review date: 2026-07-11
- Source documents: `01_interview/`, `02_design/`, `03_implement/`
- Related Linear issue: 없음. 전용 Linear MCP 미노출로 관련 키워드 검색은 미확인.
- Execution decision: 단일 Goal 실행

## Planner Summary

### Goal

Standard의 호텔 체크인·복귀는 유지하고 CarryME 배송 사건만 제거한다. 기존·신규 일정에 같은 의미 규칙을 적용하고 웹 상세 시간표의 반복 강조를 정리한다.

### Scope

- AI 생성 지침 보강
- 검증 전 공통 초안 정규화
- 기존 저장 일정 웹 호환 표시
- 웹 시간표 행 배경·체크·행 내부 절약 칩 제거
- CarryME 배송 아이콘·빛 효과와 총 이동 시간 상자 칩 유지
- 자동·수동 검증, PR 자동 배포와 운영 확인

### Non-goals

- API·DTO·DB·Redis migration
- 경로·좌표·지도·이동 시간 계산 변경
- ChatGPT 위젯과 공유 이미지 컴포넌트의 시각 변경
- 호텔별 실제 체크인 가능 시간 조회

### Implementation Outline

1. 최신 `main` 기준 새 작업 브랜치를 준비하고 문서를 보존한다.
2. core에 Standard/CarryME 배송 사건 공통 의미 판별과 정규화를 추가한다.
3. 정규화된 동일 입력을 검증과 일정 생성에 사용한다.
4. AI 지침에 Standard 체크인과 CarryME 배송 분류 계약을 추가한다.
5. 웹 표시 순수 함수와 `TimelinePanel` 시각 분기를 변경한다.
6. MCP 통합 검사와 웹 상세 회귀 검사를 보강한다.
7. 로컬·Edge 검증 후 PR 병합 자동 배포와 운영 확인을 진행한다.

### Verification Plan

- `npm run test:mcp`
- `npx playwright test apps/web/e2e/gpt-itinerary-generation.spec.ts --project=chromium`
- `npm run test:actions`
- `npm run test:route-normalization`
- `npm run test:finalization`
- `npm run build`
- 기존·신규 부산 일정 1·2일차, Light·Dark, 지도 호텔 경유를 Microsoft Edge에서 확인

### Stop Conditions

- 정상 호텔 체크인·복귀가 제거됨
- 정규화 전후 서로 다른 입력이 검증과 생성에 사용됨
- CarryME 배송 사건·아이콘이 사라짐
- API·DTO·지도·위젯 시각 변경이 필요해짐
- 사용자 변경과 write set 충돌 발생

## RALPLAN-DR Summary

### Principles

- Standard 여행자 사건과 CarryME 배송 사건 분리
- 기존 저장 일정과 공개 계약의 하위 호환성 유지
- 신규·기존 일정의 공통 의미 판별 재사용
- 웹 시각 변경 범위 최소화
- 검증 가능하고 되돌릴 수 있는 배포

### Decision Drivers

1. 정상 호텔 체크인·복귀를 보존하는 정확성
2. 기존 공유 링크와 신규 일정의 결과 일치
3. 자동 검사와 운영 화면으로 증명 가능한 완료 조건

### Viable Options

| Option | Pros | Cons | Notes |
| --- | --- | --- | --- |
| 프롬프트만 수정 | 변경이 작음 | AI 재위반을 막지 못함 | 기각 |
| 웹에서만 숨김 | 기존 링크 즉시 개선 | 신규 저장 데이터 오류 지속 | 기각 |
| 공통 후처리 + 웹 호환 + 프롬프트 | 정확성과 호환성 동시 보장 | 생성·표시 두 경계 관리 | 선택 |
| 스키마 분리 또는 AI 재호출 | 엄격한 생성 계약 | 계약 변경·지연·반복 실패 | 기각 |

### Rejected Alternatives

| Alternative | Rejection Rationale |
| --- | --- |
| 프롬프트만 수정 | 실제 AI 지침 위반 사례가 있어 결정적이지 않음 |
| 웹에서만 숨김 | 신규 원본 데이터의 의미 오류를 방치함 |
| 스키마 분리·재호출 | 현재 요구보다 영향과 실패 비용이 큼 |

### High-risk Pre-mortem

1. 정상 호텔 도착을 배송 사건으로 오판해 삭제한다.
2. 후처리 후 Standard가 비었지만 후처리 전 검증으로 정상 저장된다.
3. 행 내부 칩 제거가 CarryME 총 이동 시간 상자까지 영향을 준다.

### Expanded Test Plan

- Unit: 공통 순수 함수의 배송 판별, 체크인 보정, 불변성 사례
- Integration: MCP 생성 프롬프트·초안 정규화·검증 상태
- E2E: 기존 저장 일정, 1·2일차, Light·Dark, 행·아이콘·하단 칩
- Observability: Vercel 배포 상태, 웹 HTTP 200, MCP `/health`, 운영 Edge 화면

## Architect Review

### Verdict

`APPROVE`

### Review Mode

`in-session`

### Findings

- core 의미 판별, 웹 호환, 렌더링 책임 경계가 맞다.
- 정규화된 동일 입력을 검증과 일정 생성에 사용한다.
- API·DTO·DB·지도 계약을 건드리지 않는다.

### Strongest Steelman Antithesis

화면 문제이므로 웹에서만 해결하는 편이 단순하다는 반대 논리가 있다. 그러나 신규 저장 데이터에 의미 오류가 계속 누적되므로 전체 요구사항을 충족하지 못한다.

### Tradeoffs

공통 후처리는 영향 범위를 늘리지만 기존·신규 결과를 일치시킨다. 문구 보조 판별은 과잉 제거 위험이 있어 구조화 분류를 우선하고 제한된 배송 완료 표현만 보조로 사용한다.

### Synthesis Path

공통 판별을 core가 소유하고 웹이 재사용한다. 생성 전후 의미와 기존 표시를 맞추되 시각 변경은 웹 시간표에 제한한다.

### Principle Violations

없음.

### Required Changes

1차 검토의 검증 순서, 안정적 테스트 식별자, 롤백 한계를 계획에 반영했다.

## Critic Review

### Verdict

`APPROVE`

### Review Mode

`in-session`

### Principle-option Consistency

선택안은 정확성·하위 호환성·공통 규칙·최소 시각 범위를 모두 만족한다.

### Alternative Fairness

프롬프트 전용, 웹 전용, 스키마 분리 대안의 장단점과 기각 근거가 실제 실패 조건에 근거한다.

### Failure Scenarios

- CarryME 배송 분류가 잘못돼 배송 아이콘이 사라지는 실패를 프롬프트와 후처리로 방어한다.
- 정규화 후 빈 Standard를 `needs_revision`으로 처리한다.
- 하단 칩은 별도 DOM 범위에서 존재를 검증한다.

### Missing Evidence

- 전용 Linear MCP 미노출로 관련 이슈·댓글 검색은 미확인. 연결 이슈가 없어 차단하지 않는다.

### Verification Gaps

없음. 자동 검사와 운영 Edge 검증이 완료 조건을 직접 확인한다.

### Risk Mitigation

- 구조화 분류 우선, 제한된 문구 보조 판별
- 원본 불변성과 정규화 입력 일치 검증
- 기존·신규, 1·2일차, 두 테마 검증
- PR revert와 정규화 데이터의 비가역 범위 명시

### Required Changes

CarryME 배송 사건은 `category=carryme`, Standard는 CarryME 분류 금지 계약을 계획에 반영했다.

## Iteration Log

| Iteration | Planner Change | Architect Verdict | Critic Verdict | Remaining Issue |
| --- | --- | --- | --- | --- |
| 1 | 초기 계획 검토 | ITERATE | 미진행 | 검증 순서·시각 assertion·롤백 한계 |
| 2 | 세 항목 보강 | APPROVE | ITERATE | CarryME 배송 분류 계약 |
| 3 | 프롬프트·후처리·검증에 분류 계약 추가 | APPROVE | APPROVE | 없음 |

## User Decision

- Decision: Goal 단일 실행 승인
- Reason: 합의 문서 기준 구현과 검증 진행
- Requested changes: 없음

## Execution Handoff

### Recommended Lane

`single execution`

### Team Development Notes

- Candidate lanes: 해당 없음
- Disjoint write sets: core와 web 테스트가 같은 의미 계약을 공유해 병렬 분리 비추천
- Shared interfaces: Standard/CarryME 시간표 사건 판별
- Review checkpoints: 공통 정규화, 웹 시각, 운영 검증

### Single Execution Notes

- First task: 문서를 보존하고 최신 `main` 기준 새 브랜치 준비
- Required tests: Planner Summary의 자동 검증 전체
- Manual verification: 기존·신규 부산 일정 1·2일차, Light·Dark, 지도 호텔 경유와 위젯 단일 표시

