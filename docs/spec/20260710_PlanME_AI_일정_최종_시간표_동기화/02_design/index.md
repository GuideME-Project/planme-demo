# PlanME 이동 시간·경로 동기화 설계

## 목적

AI가 만든 장소 순서와 시간표 내용은 유지하면서, 길찾기 제공자가 계산한 순수 이동 시간과 지도 경로를 서버에서 확정해 ChatGPT 위젯과 상세 웹에 동일하게 제공하는 설계를 정리한다. Linear 이슈는 연결하지 않는다.

## 문서 목록

| 문서 | 목적 | 상태 |
| --- | --- | --- |
| [server-finalization-design.md](server-finalization-design.md) | MCP·웹 간 최종 경로 계산, API, Redis 저장과 정합성 설계 | 승인·구현 반영 |
| [widget-web-state-design.md](widget-web-state-design.md) | ChatGPT 위젯과 상세 웹의 로딩·완료·실패 상태 설계 | 승인·구현 반영 |
| [rollout-and-validation.md](rollout-and-validation.md) | 환경변수 반영, 기존 링크 호환, 배포·롤백·검증 설계 | 승인·검증 중 |

## 관련 문서

| 출처 | 링크 | 관련 이유 | 확인 상태 |
| --- | --- | --- | --- |
| 인터뷰 | [01_interview/index.md](../01_interview/index.md) | 확정 요구사항과 미결정사항 | 확인함 |
| 선행 설계 | [좌표 보장 및 이동 수단 통일](../../20260710_PlanME_AI_일정_좌표_보장_및_이동_수단_통일_GUI-201/02_design/index.md) | 좌표와 일정 전체 이동 수단 정책 | 확인함 |
| Linear | 없음 | 사용자가 기존 이슈 연결을 제외함 | 해당 없음 |

## 현재 상태

- 총 이동 시간은 관광·식사·체류 시간을 제외한 길찾기 구간 시간의 합계로 확정했다.
- AI 장소 순서와 시간표 내용은 다시 계산하지 않는다.
- 생성 단계에서 모든 일차의 Standard·CarryME 경로를 서버가 계산하고 성공 결과만 저장한다.
- 계산 완료 후 ChatGPT 위젯을 한 번만 표시한다.
- 체류 시간 필드와 전체 일정 소요 시간 필드는 추가하지 않는다.

## 다음 액션

- 전체 필수 검증을 완료한다.
- PR 병합과 Vercel 자동 배포 후 운영 결과를 구현 문서에 기록한다.
