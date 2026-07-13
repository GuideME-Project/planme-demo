# 구현 인덱스

## 목적

대중교통 접근 불가 장소 복구를 공유 계약, 접근성 사전검사, 장소 교체, 경로 최종화, 화면 표시와 실제 ChatGPT 검증 순서로 구현하기 위한 문서와 상태를 관리한다.

## 문서 목록

| 문서 | 목적 | 상태 |
| --- | --- | --- |
| [구현 순서](./implementation-sequence.md) | 계층별 작업 순서, 예상 변경 파일, 완료 조건과 중단 조건 | 계획 완료 |
| [API 및 데이터 계약](./api-and-data-contract-plan.md) | 공개 요청·응답, 내부 사전검사 API, 저장 JSON과 하위 호환성 | 계획 완료 |
| [대중교통 복구와 최종화](./transit-recovery-finalization-plan.md) | ODsay 복구, 공유 캐시, AI 장소 교체, 시간표와 화면 반영 | 계획 완료 |
| [검증과 적용](./validation-and-rollout-plan.md) | 자동 테스트, 실제 공급자 확인, GPTs·앱 수락 테스트, 배포와 롤백 | 계획 완료 |

## 관련 근거

| 출처 | 링크 | 관련 이유 | 확인 상태 |
| --- | --- | --- | --- |
| 인터뷰 | [인터뷰 색인](../01_interview/index.md) | 장소 우선순위, 30분·90분 기준, 교체 상한과 수락 조건 | 확인함 |
| 설계 | [설계 색인](../02_design/index.md) | 서비스 책임, 데이터 상태, 시간표와 표시 계약 | 확인함 |
| 장소 계약 | [장소 의도와 고정 계약](../02_design/place-intent-contract.md) | `destinationType`, `mustVisitPlaces`, `stopRef` | 확인함 |
| 복구 설계 | [정류장 및 도보 복구](../02_design/transit-station-walk-recovery.md) | ODsay 오류 코드 4, 정류장·도보·추정 규칙 | 확인함 |
| 오케스트레이션 | [장소 교체 오케스트레이션](../02_design/replacement-orchestration.md) | 사전검사 API, 공유 캐시, 단일 최종 저장 | 확인함 |
| 최종화 | [경로 최종화와 표시](../02_design/route-finalization-and-presentation.md) | 타임라인 재계산과 절약시간 숨김 | 확인함 |
| Linear | 없음 | 사용자가 관련 이슈가 없다고 확인 | 확인함 |

## 확인한 코드 경계

- `packages/planme-core`가 일정 요청, OpenAI 초안, 장소 후보와 공유 일정 자료형을 소유한다.
- `apps/mcp`의 GPTs REST와 GPT 앱 도구가 같은 핵심 생성을 호출하지만 저장 오류 처리는 각각 중복돼 있다.
- 웹 `preview-store` API가 내부 인증, 40초 경로 최종화, 잠금과 Redis 원자 저장을 담당한다.
- ODsay 서버 제공자는 대중교통 구간을 직렬 호출하고 700m 이하를 추정하지만 오류 코드 4 복구는 없다.
- MCP Vercel 함수 최대 실행시간은 60초, 웹 최종화는 40초, MCP의 현재 웹 호출 제한은 43초다.
- 저장소는 npm workspaces와 `package-lock.json`을 사용한다.

## 현재 상태

- 문서 계획만 작성했으며 코드, 테스트 결과, Git과 배포 상태는 변경하지 않았다.
- 데이터베이스 마이그레이션은 없다. Redis에 저장되는 `PlanmeItinerary` JSON의 읽기 호환성을 유지한다.
- 실제 ODsay 도보 API 운영 계약과 `pointSearch` 최대 반경은 미확인이다.
- 공유 캐시, 공급자 계약, 대표 사례 시간 예산과 추적 ID별 호출 상한을 확인하기 전 배포 모드를 `on`으로 활성화하지 않는다.

## 다음 액션

1. 구현 실행 전 계획 합의 게이트를 진행한다.
2. 실행이 승인되면 [구현 순서](./implementation-sequence.md)의 단계대로 자료형부터 변경한다.
3. 실제 ODsay 검증 조건을 충족한 뒤에만 복구 기능을 활성화한다.
4. 구현 후 필요할 때 실제 변경 결과와 테스트 로그 문서를 별도로 추가한다.
