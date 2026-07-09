# GUI-157 설계 문서

## 목적

이 디렉토리는 PlanME 일정 생성과 상세 화면에서 OpenAI Function Calling 기반 장소 검증, 좌표 보장, 대중교통 표시, MCP 응답 계약, 로컬/운영 origin 분리를 고정하기 위한 설계 문서 세트이다. `01_interview`에서 확정한 요구사항을 구현 가능한 계약과 검증 항목으로 나눈다.

## 문서 목록

| 문서 | 목적 | 상태 |
| --- | --- | --- |
| [ai-place-validation-design.md](ai-place-validation-design.md) | OpenAI Function Calling 기반 장소 검색, AI 후보 판단, hard gate, clarification 라운드 설계 | 초안 |
| [coordinate-resolution-design.md](coordinate-resolution-design.md) | Function Calling 후보 결과를 좌표와 검색 출처 hard gate로 보장하는 설계 | 초안 |
| [transit-route-display-design.md](transit-route-display-design.md) | ODsay 장거리 구간의 탑승역/하차역 표시와 partial route 상태 설계 | 초안 |
| [mcp-contract-design.md](mcp-contract-design.md) | MCP clarification, validation issue, `PLANME_WEB_ORIGIN` widget metadata 계약 설계 | 초안 |
| [frontend-state-design.md](frontend-state-design.md) | 지도, 타임라인, 범례, 제목/문구 UI 상태 설계 | 초안 |
| [validation-plan.md](validation-plan.md) | 완료 기준을 테스트와 로컬 실제 검증으로 매핑 | 초안 |

## 관련 외부 링크

| 출처 | 링크 | 관련 이유 | 확인 상태 |
| --- | --- | --- | --- |
| Linear | [GUI-157](https://linear.app/guideme/issue/GUI-157/planme-%EC%A2%8C%ED%91%9C-%EB%B3%B4%EC%9E%A5-%EB%B0%8F-%EB%8C%80%EC%A4%91%EA%B5%90%ED%86%B5-%ED%91%9C%EC%8B%9C-%EA%B0%9C%EC%84%A0) | 확정 요구사항과 완료 기준 | 확인함 |
| OpenAI | [Function Calling](https://developers.openai.com/api/docs/guides/function-calling) | 모델이 도구 호출을 요청하고 앱 코드가 실행하는 구조 | 확인함 |
| Google Places | [Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search) | 텍스트 기반 장소 후보 검색 | 확인함 |
| Google Places | [Nearby Search](https://developers.google.com/maps/documentation/places/web-service/nearby-search) | 좌표와 반경 기반 fallback 검색 | 확인함 |

## 현재 상태

- `01_interview` 기준 요구사항은 문서화 완료됐다.
- 장소 검색/판단의 중심은 OpenAI Function Calling이다.
- Google/Naver는 Function Calling 요청을 받은 PlanME 서버가 실행하는 외부 검색 도구이다.
- 기존 Google Places 1순위 자동 대체 설계는 폐기됐다.
- Linear 이슈는 `GUI-157(PlanME 좌표 보장 및 대중교통 표시 개선)`로 생성됐다.
- 본 설계는 구현 전 초안이며, 구현 중 코드 제약이 확인되면 이 문서를 갱신한다.

## 다음 액션

- OpenAI Function Calling loop와 장소 검색 tool schema를 먼저 구현한다.
- 좌표 hard gate와 MCP clarification 계약을 구현한다.
- 대중교통 partial route 상태와 탑승역/하차역 marker DTO를 구현한다.
- 완료 기준을 `test:actions`, `test:mcp`, Playwright, 로컬 실제 MCP 호출 검증으로 나눠 실행한다.
