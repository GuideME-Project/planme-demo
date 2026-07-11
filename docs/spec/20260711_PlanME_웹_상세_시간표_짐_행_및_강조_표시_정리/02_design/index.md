# PlanME 웹 상세 시간표 짐 행 및 강조 표시 정리 설계

## 목적

Standard 호텔 체크인과 CarryME 짐 배송 사건의 경계를 생성 데이터와 웹 상세 화면에서 일관되게 보장한다. 기존 저장 일정은 이관하지 않고 호환 표시하며, 웹 시간표의 반복 강조를 정리한다.

## 문서 목록

| 문서 | 목적 | 상태 |
| --- | --- | --- |
| [timeline-domain-and-generation.md](timeline-domain-and-generation.md) | Standard 체크인과 CarryME 배송 사건의 생성·후처리 계약 | 초안 |
| [web-timeline-component.md](web-timeline-component.md) | 기존 일정 호환 표시와 시간표 행 시각 구조 | 초안 |
| [compatibility-and-validation.md](compatibility-and-validation.md) | 기존·신규 일정 호환, 리스크와 검증 계획 | 초안 |

## 관련 외부 링크

| 출처 | 링크 | 관련 이유 | 확인 상태 |
| --- | --- | --- | --- |
| Linear | 없음 | 인터뷰에서 Linear 이슈를 연결하지 않기로 결정 | 이슈 없음 |

## 현재 상태

- 인터뷰 결정 반영 완료.
- 로컬 코드와 기존 테스트 근거 확인 완료.
- 전용 Linear MCP가 현재 세션에 노출되지 않아 관련 키워드 검색은 미확인.
- 코드 구현과 테스트 실행은 아직 시작하지 않음.

## 다음 액션

- 구현 계획에서 생성 지침, 생성 후처리, 웹 호환 표시와 회귀 테스트를 작업 단위로 나눈다.
- 기존 부산 일정과 신규 생성 일정의 1일차·2일차를 수동 검증 항목으로 포함한다.

