# 구현 인덱스

## 목적

이 디렉토리는 CarryME 일정 경로 버그를 구현 단계에서 실행 가능한 작업 단위로 정리한다.
구현 기준은 01_interview와 02_design에서 확정한 다음 결정이다.

- 행선지 편집은 `출발지`, `방문지`, `숙소`, `복귀지`를 포함한 일자별 전체 이동 흐름이다.
- AI가 stop 역할(`role`)과 구간 이동수단(`mode`)을 내려주고, 화면은 이를 보존한다.
- 좌표 보강은 기존 장소 검색/상세 조회 흐름을 재사용한다.
- 웹에서 사용자가 선택하는 대표 이동수단은 `자동차`와 `대중교통`만 둔다. `도보`는 웹 선택지에서 제거한다.
- CarryME 경로 재계산은 route/path/time만 갱신하고 CarryME timeline 의미를 덮어쓰지 않는다.

## 문서 목록

| 문서 | 목적 | 상태 |
| --- | --- | --- |
| [implementation-plan.md](implementation-plan.md) | 작업 순서, 변경 파일 후보, DTO/type 변경, 중단 조건 정리 | 초안 |
| [validation-and-test-plan.md](validation-and-test-plan.md) | 자동/수동 검증 범위와 테스트 갱신 방향 정리 | 초안 |

## 관련 근거

| 출처 | 링크 | 관련 이유 | 확인 상태 |
| --- | --- | --- | --- |
| 인터뷰 문서 | [../01_interview/index.md](../01_interview/index.md) | 사용자 확정사항의 원본 | 확인함 |
| 인터뷰 문서 | [../01_interview/destination-editor-flow.md](../01_interview/destination-editor-flow.md) | 행선지 편집 전체 이동 흐름과 role 결정 | 확인함 |
| 설계 문서 | [../02_design/destination-editor-design.md](../02_design/destination-editor-design.md) | stop role/mode 계약과 화면 row 보존 기준 | 확인함 |
| 설계 문서 | [../02_design/ai-data-boundary.md](../02_design/ai-data-boundary.md) | AI 책임과 코드 비목표 경계 | 확인함 |
| 설계 문서 | [../02_design/user-flow-and-state.md](../02_design/user-flow-and-state.md) | CarryME 재계산/fallback 상태 기준 | 확인함 |
| 설계 문서 | [../02_design/validation-plan.md](../02_design/validation-plan.md) | 대표 검증 시나리오와 완료 기준 | 확인함 |
| Codex 스레드 | `019f46d8-193c-7e23-a9c1-7893c9440d08` | 이동수단 선택 정책: 웹은 자동차/대중교통만, 모든 구간에 적용 | 확인함 |
| Linear | [GUI-157 PlanME 좌표 보장 및 대중교통 표시 개선](https://linear.app/guideme/issue/GUI-157/planme-%EC%A2%8C%ED%91%9C-%EB%B3%B4%EC%9E%A5-%EB%B0%8F-%EB%8C%80%EC%A4%91%EA%B5%90%ED%86%B5-%ED%91%9C%EC%8B%9C-%EA%B0%9C%EC%84%A0) | 실제 MCP 생성, 좌표 보장, 상세 화면 검증 범위 | 확인함 |
| Linear | [GUI-134 PlanME 지도 화면 롤러 캐릭터 메시지 방향성 분석](https://linear.app/guideme/issue/GUI-134/planme-%EC%A7%80%EB%8F%84-%ED%99%94%EB%A9%B4-%EB%A1%A4%EB%9F%AC-%EC%BA%90%EB%A6%AD%ED%84%B0-%EB%A9%94%EC%8B%9C%EC%A7%80-%EB%B0%A9%ED%96%A5%EC%84%B1-%EB%B6%84%EC%84%9D) | 절약 없음 메시지와 Roller 안내 기준 | 확인함 |
| Linear | [GUI-108 PlanME 한국 길안내 Google Routes API 미지원 대응](https://linear.app/guideme/issue/GUI-108/planme-%ED%95%9C%EA%B5%AD-%EA%B8%B8%EC%95%88%EB%82%B4-google-routes-api-%EB%AF%B8%EC%A7%80%EC%9B%90-%EB%8C%80%EC%9D%91) | 네이버+ODsay 경로 제공자와 실패 fallback 근거 | 확인함 |

## 현재 상태

- `03_implement` 구현계획을 stop role/mode 계약 중심으로 갱신했다.
- 실제 코드 변경과 테스트 실행은 아직 하지 않았다.
- 기존 문서 변경분은 `docs/spec/` 아래 untracked 상태다.
- 기존 Redis preview 저장값 직접 수정은 구현 범위에서 제외한다.

## 다음 액션

- 구현계획 검토 후 코드 변경 단계로 전환한다.
- 구현 시 기존 변경분을 되돌리지 않고, role/mode 계약과 웹 이동수단 선택 정책을 함께 반영한다.
- 코드 변경 후 [validation-and-test-plan.md](validation-and-test-plan.md) 기준으로 테스트 로그를 별도 갱신한다.
