# CarryME 일정 경로 버그 설계

## 목적

이 디렉토리는 CarryME 일정 경로가 여행자 경로와 짐 흐름을 섞어 보여주는 문제를 설계 단계에서 정리한다.
핵심 설계 기준은 Standard 일정을 기준으로 삼고, CarryME는 호텔/숙소 중간 방문을 제거한 여행자 경로로 다시 계산하는 것이다.
행선지 편집은 `출발지`, `방문지`, `숙소`, `복귀지`를 포함한 일자별 전체 이동 흐름이다.
코드는 호텔/숙소를 키워드나 레거시 역할값으로 보정하지 않으며, AI가 내려준 stop 역할을 화면 row까지 보존한다.
좌표 보강은 기존 장소 검색/상세 조회 흐름을 재사용하고, 재계산 실패 시 사용자에게 오류처럼 보이지 않게 Standard와 같은 경로/시간으로 표시한다.

## 문서 목록

| 문서 | 목적 | 상태 |
| --- | --- | --- |
| [user-flow-and-state.md](user-flow-and-state.md) | Standard 기준 흐름, CarryME 전용 재계산, 실패 fallback 상태 정리 | 초안 |
| [ai-data-boundary.md](ai-data-boundary.md) | AI 생성 책임과 코드 비목표, 호텔/숙소 판단 경계 정리 | 초안 |
| [destination-editor-design.md](destination-editor-design.md) | 행선지 편집 전체 이동 흐름, stop role/mode 계약, 좌표 보강 재사용 설계 | 초안 |
| [screen-and-copy-design.md](screen-and-copy-design.md) | 상세 화면, 지도 범례, 타임라인, GPT 응답/미리보기 문구 정리 | 초안 |
| [validation-plan.md](validation-plan.md) | 실제 Custom GPT/MCP 일정 기반 검증 계획과 완료 기준 정리 | 초안 |

## 관련 외부 링크

| 출처 | 링크 | 관련 이유 | 확인 상태 |
| --- | --- | --- | --- |
| Linear | [GUI-157 PlanME 좌표 보장 및 대중교통 표시 개선](https://linear.app/guideme/issue/GUI-157/planme-%EC%A2%8C%ED%91%9C-%EB%B3%B4%EC%9E%A5-%EB%B0%8F-%EB%8C%80%EC%A4%91%EA%B5%90%ED%86%B5-%ED%91%9C%EC%8B%9C-%EA%B0%9C%EC%84%A0) | 실제 MCP 생성, 좌표 보장, 장거리 대중교통 표시, 상세 화면 검증 범위가 겹친다. | 확인함 |
| Linear | [GUI-134 PlanME 지도 화면 롤러 캐릭터 메시지 방향성 분석](https://linear.app/guideme/issue/GUI-134/planme-%EC%A7%80%EB%8F%84-%ED%99%94%EB%A9%B4-%EB%A1%A4%EB%9F%AC-%EC%BA%90%EB%A6%AD%ED%84%B0-%EB%A9%94%EC%8B%9C%EC%A7%80-%EB%B0%A9%ED%96%A5%EC%84%B1-%EB%B6%84%EC%84%9D) | 절약 시간이 없을 때 정량 메시지 대신 편의성 메시지를 보여주는 기준과 연결된다. | 확인함 |
| Linear | [GUI-108 PlanME 한국 길안내 Google Routes API 미지원 대응](https://linear.app/guideme/issue/GUI-108/planme-%ED%95%9C%EA%B5%AD-%EA%B8%B8%EC%95%88%EB%82%B4-google-routes-api-%EB%AF%B8%EC%A7%80%EC%9B%90-%EB%8C%80%EC%9D%91) | 한국 경로 계산 실패 가능성과 사용자 노출 fallback 정책의 선행 근거다. | 확인함 |

## 현재 상태

- 인터뷰에서 요구사항의 중심 개념은 호텔/숙소로 확정됐다.
- CarryME 여행자 경로 이름은 `짐 없이 바로 이동하는 경로`로 확정됐다.
- 절약 시간이 있으면 `약 N분 절약`, 없으면 `시간 절약 없음 · 짐 없이 바로 이동`을 사용한다.
- CarryME 재계산 실패는 사용자 오류로 보이지 않게 처리하고, CarryME 경로/시간을 Standard와 동일하게 표시한다.
- 행선지 편집은 단순 방문지 목록이 아니라 일자별 전체 이동 흐름이다.
- AI stop 계약에는 `출발지`, `방문지`, `숙소`, `복귀지` 역할이 포함되어야 한다.
- `startPoint` 별도 필드는 두지 않고, 각 day의 첫 stop `role: 출발지`로 표현한다.
- 장소 좌표는 기존 장소 검색/상세 조회 흐름을 재사용해서 확정한다.
- 기존 Redis preview 저장값은 직접 수정하지 않는다.
- 점선 배송 차량 경로는 이번 설계 범위에서 제외한다.
- 현재 코드에는 index 기반 `출발지`/`도착지` 라벨 계산과 stop 역할 손실 흐름이 남아 있어 구현 단계에서 정리해야 한다.

## 다음 액션

- 설계 문서 리뷰 후 `03_implement` 단계에서 변경 파일과 테스트 범위를 확정한다.
- 구현 전 실제 Custom GPT/MCP 생성 일정 1개를 대표 입력으로 정하고, 1박/2박 이상 행선지 편집 흐름을 함께 확인한다.
