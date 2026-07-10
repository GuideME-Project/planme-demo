# PlanME AI 일정 좌표 보장 및 이동 수단 통일 설계

## 목적

이 디렉토리는 GUI-201과 `01_interview`에서 확정한 요구사항을 구현 가능한 계약으로 정리한다.
핵심은 사용자 지정 출발지·목적지를 AI 일정 생성 전에 네이버로 고정하고, AI 중간 행선지만 제한적으로 교체하며, 일정 전체 이동 수단 하나를 MCP부터 웹 길안내까지 보존하는 것이다.
기존 일정 링크와 저장 데이터 호환은 다루지 않는다.

## 문서 목록

| 문서 | 목적 | 상태 |
| --- | --- | --- |
| [place-resolution-design.md](place-resolution-design.md) | 네이버 단일 장소 검색, 출발지·목적지 선검증, 중간 행선지 교체·제외 설계 | 초안 |
| [mcp-transport-contract.md](mcp-transport-contract.md) | MCP·GPT Actions·AI 생성·저장 데이터의 일정 전체 이동 수단 계약 | 초안 |
| [web-editor-route-design.md](web-editor-route-design.md) | 웹 네이버 장소 선택, 전체 이동 수단 변경, Standard·CarryME 재계산과 오류 상태 설계 | 초안 |
| [external-integration-risk.md](external-integration-risk.md) | 네이버 인증, 외부 API 오류, 호출량, 캐시, 로그와 민감값 처리 | 초안 |
| [validation-plan.md](validation-plan.md) | 모의 계약 테스트와 실제 네이버 자동차 일정 검증 계획 | 초안 |

## 관련 외부 링크

| 출처 | 링크 | 관련 이유 | 확인 상태 |
| --- | --- | --- | --- |
| Linear | [GUI-201 AI로 일정 생성 시 행선지/목적지 좌표 누락 발생](https://linear.app/guideme/issue/GUI-201/ai%EB%A1%9C-%EC%9D%BC%EC%A0%95-%EC%83%9D%EC%84%B1-%EC%8B%9C-%ED%96%89%EC%84%A0%EC%A7%80%EB%AA%A9%EC%A0%81%EC%A7%80-%EC%A2%8C%ED%91%9C-%EB%88%84%EB%9D%BD-%EB%B0%9C%EC%83%9D) | 관련 이슈 ID와 제목 | 사용자 제공 링크만 확인, 본문·댓글 미확인 |
| NAVER Developers | [지역 검색 API](https://developers.naver.com/docs/serviceapi/search/local/local.md) | 국내 업체·장소 검색 | 공식 주소 확인, 현재 문서 렌더링 오류 |
| NAVER Developers | [지역 검색 API 좌표계 변경 공지](https://developers.naver.com/notice/article/12567) | `mapx`, `mapy` WGS84 정규화 | 확인함 |
| Naver Cloud | [Geocoding](https://api.ncloud-docs.com/docs/ai-naver-mapsgeocoding-geocode) | 주소·행정구역 좌표 보정 | 확인함 |
| OpenAI | [Responses API와 도구](https://openai.com/index/new-tools-for-building-agents/) | AI가 사용자 정의 장소 검색 함수를 호출하는 구조 | 확인함 |

## 확인한 코드 근거

- `packages/planme-core/src/gpt-actions.ts` - 현재 모든 stop을 같은 후보 검증과 clarification 흐름으로 처리한다.
- `packages/planme-core/src/openai-itinerary-generator.ts` - 현재 Google 텍스트·주변 검색 함수와 행선지별 `mode`를 AI에 요구한다.
- `packages/planme-core/src/place-candidates.ts` - 현재 일반 방문지 Google Places 후보 검색과 hard gate가 있다.
- `packages/planme-core/src/accommodation-candidates.ts` - 현재 숙소 후보도 별도 Google Places 검색을 사용한다.
- `packages/planme-core/src/planning-questions.ts` - 현재 일정 전체 이동 수단 질문과 입력값이 없다.
- `apps/mcp/src/planme-mcp.ts` - MCP 준비·생성 도구 입력과 출력 계약이 있다.
- `apps/mcp/src/gpts-actions-api.ts` - GPTs Actions REST/OpenAPI 계약이 MCP와 별도로 정의돼 있다.
- `apps/web/components/itinerary/ItineraryDashboard.tsx` - 현재 구간별 이동 수단 선택과 CarryME 중심 재계산·fallback이 있다.
- `apps/web/app/api/places/autocomplete/route.ts`와 `details/route.ts` - 현재 웹 Google 자동완성·상세 조회가 분리돼 있다.
- `apps/web/app/api/naver/directions/routes/route.ts` - 좌표 기반 네이버 자동차 경로선 계산이 있다.

## 현재 상태

- 인터뷰 요구사항은 `01_interview`에 문서화됐다.
- 신규 인터뷰·설계 문서는 현재 worktree에서 미추적 상태다.
- Linear GUI-201은 수정하지 않는다.
- 사용자 지정 출발지·목적지 선검증은 인터뷰 요구사항에서 도출한 추천 구현 순서이며 별도 제품 결정이 아니다.
- 장소 검색은 숙소를 포함해 네이버만 사용한다.
- 자연어 이동 수단 표현은 PlanME 서버가 직접 분류하지 않고, ChatGPT가 구조화된 자동차(`drive`)·대중교통(`transit`) 값으로 전달한다.
- 기존 링크·저장값 변환과 실제 ODsay 검증은 비목표다.

## 다음 액션

- 설계 문서 검토 후 `mion-implementation-plan-writer`로 `03_implement` 작업 순서와 변경 파일을 정한다.
- 구현 전 원본 체크아웃의 gitignored 런타임 파일을 민감값 출력 없이 현재 worktree로 복사한다.
- 구현 후 모의 계약 테스트를 먼저 통과시키고, 별도 승인 후 실제 네이버 API 검증을 수행한다.
