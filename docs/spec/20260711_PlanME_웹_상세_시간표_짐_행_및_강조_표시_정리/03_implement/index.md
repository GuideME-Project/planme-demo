# PlanME 웹 상세 시간표 짐 행 및 강조 표시 정리 구현 인덱스

## 목적

Standard 호텔 체크인과 CarryME 배송 사건의 경계를 새 일정과 기존 웹 상세 화면에서 일관되게 구현하기 위한 작업 문서를 관리한다.

## 문서 목록

| 문서 | 목적 | 상태 |
| --- | --- | --- |
| [timeline-correction-implementation.md](timeline-correction-implementation.md) | 생성 지침·공통 의미 보정·웹 표시·컴포넌트의 파일별 구현 순서 | 승인됨 |
| [validation-and-rollout.md](validation-and-rollout.md) | 자동·수동 검증, 브랜치·PR·배포와 롤백 절차 | 승인됨 |
| [consensus-review.md](consensus-review.md) | Planner·RALPLAN-DR·Architect·Critic 실행 합의 | 승인됨 |
| [implementation-result.md](implementation-result.md) | 실제 코드 변경과 설계 대비 결과 | 구현 완료 |
| [verification-log.md](verification-log.md) | 자동 검사와 Microsoft Edge 수동 확인 기록 | 로컬 검증 완료·운영 검증 대기 |

## 관련 근거

| 출처 | 링크 | 관련 이유 | 확인 상태 |
| --- | --- | --- | --- |
| 인터뷰 | [../01_interview/index.md](../01_interview/index.md) | 사용자 확정 요구사항 | 확인함 |
| 생성 설계 | [../02_design/timeline-domain-and-generation.md](../02_design/timeline-domain-and-generation.md) | Standard 체크인과 CarryME 배송 계약 | 확인함 |
| 웹 설계 | [../02_design/web-timeline-component.md](../02_design/web-timeline-component.md) | 기존 일정 호환과 행 시각 구조 | 확인함 |
| 검증 설계 | [../02_design/compatibility-and-validation.md](../02_design/compatibility-and-validation.md) | 수용 기준과 실패 조건 | 확인함 |
| Linear | 없음 | 인터뷰에서 이슈를 연결하지 않기로 결정 | 이슈 없음 |

## 현재 상태

- 구현계획과 합의 검토 완료.
- Architect와 Critic 모두 `APPROVE`.
- 사용자가 단일 Goal 실행을 승인함.
- 최신 `main` 기준 `codex/planme-timeline-clarity` 브랜치에서 구현과 로컬 검증을 완료함.
- 코드 단위 검사, Chromium 화면 회귀 검사, 관련 계약 검사와 빌드가 모두 통과함.
- Microsoft Edge에서 기존 2일 일정의 1·2일차와 Light·Dark 시간표를 확인함.
- 운영 PR 병합과 Vercel 자동 배포 후 검증은 진행 전임.
- 전용 Linear MCP가 현재 세션에 노출되지 않아 관련 이슈·댓글 검색은 미확인.

## 다음 액션

- 변경 사항을 커밋하고 `main` 대상 PR을 생성한다.
- PR 검사를 확인한 뒤 병합해 Vercel 자동 배포를 시작한다.
- 운영 기존 일정과 ChatGPT 신규 일정 생성 흐름을 확인한다.
- 운영 결과와 PR·병합 정보를 [verification-log.md](verification-log.md)에 갱신한다.
