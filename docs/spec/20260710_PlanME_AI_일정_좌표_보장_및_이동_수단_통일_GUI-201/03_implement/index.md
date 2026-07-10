# PlanME AI 일정 좌표 보장 및 이동 수단 통일 구현 인덱스

## 목적

이 디렉토리는 `01_interview`와 `02_design`에서 확정한 요구사항을 실제 코드 변경 순서와 검증 가능한 계약으로 연결한다.
구현 범위는 신규 국내 일정의 네이버 장소 좌표 보장, 일정 전체 이동 수단 통일, 웹 장소 검색 교체, 선택한 날짜의 Standard·CarryME 독립 경로 재계산이다.

## 문서 목록

| 문서 | 목적 | 상태 |
| --- | --- | --- |
| [implementation-sequence.md](implementation-sequence.md) | 단계별 구현 순서, 의존관계, 변경 파일과 중단 조건 | 구현 완료 |
| [core-place-transport-implementation.md](core-place-transport-implementation.md) | 네이버 장소 후보, 필수 장소 선검증, AI 함수, 이동 수단, MCP·REST·DTO 구현 | 구현 완료 |
| [web-place-route-implementation.md](web-place-route-implementation.md) | 웹 장소 검색 API, 편집 상태, 일정 전체 이동 수단과 선택 날짜의 두 경로 계산 | 구현 완료 |
| [verification-and-rollout.md](verification-and-rollout.md) | 자동 테스트, 실제 네이버 자동차 시나리오, 운영 확인과 rollback | 자동 검증 완료 |
| [implementation-result.md](implementation-result.md) | 실제 변경, 설계 대비 차이, 남은 외부 검증 | 작성 완료 |
| [test-log.md](test-log.md) | 명령별 결과, 실패·재시도, 외부 호출 기록 | 작성 완료 |

## 관련 근거

| 출처 | 링크 | 관련 이유 | 확인 상태 |
| --- | --- | --- | --- |
| 인터뷰 | [../01_interview/index.md](../01_interview/index.md) | 제품 요구사항과 비목표 | 확인함 |
| 장소 설계 | [../02_design/place-resolution-design.md](../02_design/place-resolution-design.md) | 필수 장소와 중간 장소의 실패 정책 | 확인함 |
| 이동 수단 설계 | [../02_design/mcp-transport-contract.md](../02_design/mcp-transport-contract.md) | 일정 전체 이동 수단 계약 | 확인함 |
| 웹 설계 | [../02_design/web-editor-route-design.md](../02_design/web-editor-route-design.md) | 장소 선택과 경로 재계산 상태 | 확인함 |
| 외부 연동 설계 | [../02_design/external-integration-risk.md](../02_design/external-integration-risk.md) | 인증·오류·캐시·로그 경계 | 확인함 |
| 검증 설계 | [../02_design/validation-plan.md](../02_design/validation-plan.md) | 자동·실제 검증 완료 조건 | 확인함 |
| Linear | [GUI-201 AI로 일정 생성 시 행선지/목적지 좌표 누락 발생](https://linear.app/guideme/issue/GUI-201/ai%EB%A1%9C-%EC%9D%BC%EC%A0%95-%EC%83%9D%EC%84%B1-%EC%8B%9C-%ED%96%89%EC%84%A0%EC%A7%80%EB%AA%A9%EC%A0%81%EC%A7%80-%EC%A2%8C%ED%91%9C-%EB%88%84%EB%9D%BD-%EB%B0%9C%EC%83%9D) | 관련 이슈 ID와 제목 | 사용자 제공 링크만 확인, 본문·댓글 미확인 |
| 네이버 | [지역 검색 API](https://developers.naver.com/docs/serviceapi/search/local/local.md) | 장소 후보와 좌표 | 공식 문서 확인 |
| OpenAI | [함수 호출 가이드](https://platform.openai.com/docs/guides/function-calling) | 엄격한 함수 입력과 도구 결과 반환 | 공식 문서 확인 |

## 현재 상태

- Core·MCP·REST·웹 구현과 모의 자동 검증을 완료했다.
- 이동 수단은 일정 전체 하나이며, 버튼은 선택 날짜의 Standard·CarryME를 독립 계산한다.
- 웹 장소 검색은 `POST /api/places/search` 하나만 사용한다.
- DB, 기존 저장 일정 보정, Linear, Git 게시 작업은 수행하지 않았다.
- 실제 네이버 장소 검색·OpenAI `동탄 → 경주월드` 검증은 별도 승인 전이라 미실행이다.
