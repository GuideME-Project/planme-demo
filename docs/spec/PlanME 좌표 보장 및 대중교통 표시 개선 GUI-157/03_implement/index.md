# 구현 인덱스

## 목적

GUI-157 구현 단계의 작업 순서, 변경 파일, 검증 기준을 관리한다. 구현 본문은 주제별 문서에 나누고, 이 파일은 문서 목록과 현재 상태만 안내한다.

## 문서 목록

| 문서 | 목적 | 상태 |
| --- | --- | --- |
| [implementation-plan.md](implementation-plan.md) | 전체 작업 순서, 변경 범위, 중단 조건 | 초안 |
| [ai-place-validation-implementation.md](ai-place-validation-implementation.md) | OpenAI Function Calling loop, 장소 검색 tool schema, AI 후보 판단 구현 계획 | 초안 |
| [coordinate-resolution-implementation.md](coordinate-resolution-implementation.md) | Function Calling 후보 결과의 좌표와 검색 출처 hard gate 구현 계획 | 초안 |
| [transit-display-implementation.md](transit-display-implementation.md) | 대중교통 탑승역/하차역 marker와 partial route 구현 계획 | 초안 |
| [mcp-contract-implementation.md](mcp-contract-implementation.md) | `clarificationContext`, 링크/위젯 미생성, `PLANME_WEB_ORIGIN` 구현 계획 | 초안 |
| [verification-checklist.md](verification-checklist.md) | mock 기반 테스트와 사용자 승인형 실제 API 검증 체크리스트 | 초안 |

## 관련 근거

| 출처 | 링크 | 관련 이유 | 확인 상태 |
| --- | --- | --- | --- |
| Linear | [GUI-157](https://linear.app/guideme/issue/GUI-157/planme-%EC%A2%8C%ED%91%9C-%EB%B3%B4%EC%9E%A5-%EB%B0%8F-%EB%8C%80%EC%A4%91%EA%B5%90%ED%86%B5-%ED%91%9C%EC%8B%9C-%EA%B0%9C%EC%84%A0) | 구현 대상 요구사항 | 확인함 |
| 인터뷰 문서 | [../01_interview/index.md](../01_interview/index.md) | 요구사항 결정 근거 | 확인함 |
| 설계 문서 | [../02_design/index.md](../02_design/index.md) | 구현 설계 기준 | 확인함 |
| OpenAI 공식 문서 | [Function Calling](https://developers.openai.com/api/docs/guides/function-calling) | 모델이 도구 호출을 요청하고 앱 코드가 실행하는 구조 | 확인함 |
| Google 공식 문서 | [Text Search (New)](https://developers.google.com/maps/documentation/places/web-service/text-search) | 텍스트 장소 검색 구현 제약 | 확인함 |
| Google 공식 문서 | [Nearby Search (New)](https://developers.google.com/maps/documentation/places/web-service/nearby-search) | 주변 장소 검색 구현 제약 | 확인함 |

## 현재 상태

- 인터뷰와 설계 문서는 Function Calling 중심으로 갱신됐다.
- 기존 03 구현 문서는 과거 Google Places 1순위 자동 대체 기준이어서 본 문서 세트에서 재정렬한다.
- 실제 코드 구현과 테스트 실행 결과는 아직 이 문서 세트에 기록하지 않는다.

## 다음 액션

- `implementation-plan.md` 순서대로 코드 변경한다.
- 외부 API 실제 검증은 사용자 승인과 예상 호출량 안내 후에만 실행한다.
- 구현 후 실행 명령, 결과, 실패 사유를 `verification-checklist.md`에 갱신한다.
