# 전체 구현 계획

## 결론

- 구현 방향: OpenAI Function Calling을 일정 생성의 중심으로 두고, PlanME 서버가 Google/Naver 장소 검색을 실행해 후보 목록을 모델에 돌려준다. 모델은 후보 적합성을 판단하고, 코드는 좌표와 `placeId` 또는 검색 출처 hard gate만 강제한다.
- 완료 조건: Function Calling 기반 초안 생성, 후보 검증, clarification, hard gate, 대중교통 partial route, origin 분리, UI 문구 정리 검증이 모두 통과해야 한다.
- 주요 리스크: 현재 워크트리 코드에 `suggestedQueries`, `replacementLogs`, 단일 후보 반환, 자동 대체 메시지가 남아 있다. 따라서 첫 작업은 신규 구현이 아니라 기존 자동 대체 흐름 제거와 mock-first 회귀 테스트 고정이다.

## 근거

설계 문서:

- [AI 장소 후보 검증 설계](../02_design/ai-place-validation-design.md)
- [좌표 보장 설계](../02_design/coordinate-resolution-design.md)
- [MCP 계약 설계](../02_design/mcp-contract-design.md)
- [대중교통 경로 표시 설계](../02_design/transit-route-display-design.md)
- [프론트엔드 상태 설계](../02_design/frontend-state-design.md)
- [검증 계획](../02_design/validation-plan.md)

관련 코드:

- `packages/planme-core/src/openai-itinerary-generator.ts`: 현재 OpenAI Responses API 호출과 structured output 생성 위치
- `packages/planme-core/src/place-candidates.ts`: 현재 Google Places Text/Nearby 검색 구현 위치. 현재는 단일 후보 반환 중심이다.
- `packages/planme-core/src/gpt-actions.ts`: MCP 추천 일정 생성, 좌표 보정, clarification 분기 위치
- `apps/mcp/src/planme-mcp.ts`: MCP tool schema, output schema, widget metadata 위치
- `apps/mcp/scripts/check-planme-mcp.ts`: MCP 계약 테스트 위치
- `apps/web/components/itinerary/ItineraryDashboard.tsx`: 대중교통 partial route와 지도/타임라인 UI 위치

현재 코드에서 제거 또는 교체할 기존 흐름:

- `packages/planme-core/src/place-candidates.ts`: `PlanmePlaceCandidateSearchResult.candidate` 단일 후보 반환
- `packages/planme-core/src/place-candidates.ts`: “첫 좌표 후보 반환” 중심 normalization
- `packages/planme-core/src/gpt-actions.ts`: `replacementLogs`, `suggestedQueries`, “자동 대체했습니다” validation issue
- `apps/mcp/src/planme-mcp.ts`: clarification 응답의 `suggestedQueries`
- `apps/mcp/scripts/check-planme-mcp.ts`: 단일 후보/자동 대체 통과 전제 테스트

미확인 자료:

- 실제 OpenAI tool call 응답 payload를 로컬 mock 없이 외부 API로 검증한 결과
- Google/Naver 실제 검색 후보 품질
- ODsay 실제 장거리 응답의 역/터미널 이름 필드 품질

## 범위

포함:

- OpenAI Responses API Function Calling loop
- `search_places_text`, `search_places_nearby` tool schema와 tool result 처리
- 장소 후보 목록 반환과 AI 후보 판단 DTO
- 좌표와 `placeId` 또는 검색 출처 hard gate
- `ambiguous`/`rejected` clarification과 `clarificationContext`
- 최대 2라운드 후 마지막 검색 1회와 내부 AI 최후 확정 조건
- Redis/Upstash 일별 호출량 카운터
- MCP 링크/위젯 미생성 계약
- 대중교통 장거리 polyline 제거, 탑승/하차 marker와 partial 상태
- H1, metadata, OG title, route copy 정규화
- mock 기반 테스트와 사용자 승인형 실제 API smoke

제외:

- Google Places 검색 1순위 자동 대체
- 외부 후보 없이 AI가 장소 존재나 좌표를 추정하는 방식
- 사용자가 웹 화면에서 후보를 고르는 위젯
- 거리 기준 hard gate
- `geocode_place`, `get_place_details` Function Calling tool 초기 도입
- RestME/CarryME 실제 API 연동
- 환승역 전체 표시

## 작업 순서

1. 기존 자동 대체 흐름을 보호하는 테스트를 먼저 실패 상태로 작성한다. 단일 후보 자동 채택, `suggestedQueries`, `replacementLogs` 의존을 제거 대상으로 고정한다.
2. 장소 검색 tool 입력/출력 DTO를 `planme-core`에 정의한다.
3. `place-candidates`를 단일 후보 반환에서 후보 목록 반환으로 바꾼다.
4. Google Places 후보와 Naver 후보를 공통 `PlanmePlaceCandidate`로 정규화한다.
5. OpenAI Function Calling tool loop를 `openai-itinerary-generator` 계층에 추가한다.
6. OpenAI tool call/result 흐름은 실제 API 호출 전에 fetch mock으로 먼저 검증한다.
7. OpenAI 초안 생성 단계에서 모든 stop 후보를 Function Calling으로 확인하게 한다.
8. 후보 검증 단계에서 AI가 `accepted`, `ambiguous`, `rejected`를 반환하게 한다.
9. hard gate 실패, 후보 없음, `ambiguous`, `rejected`를 `needs_clarification`으로 분기한다.
10. `clarificationContext`와 사용자 답변 재호출 흐름을 MCP 요청/응답에 추가한다.
11. Redis/Upstash 일별 호출량 카운터를 `apps/mcp` 또는 `packages/planme-core` 계층에 추가한다.
12. `PLANME_WEB_ORIGIN` helper와 widget metadata 생성을 정리한다.
13. ODsay 장거리 탑승역/하차역 marker와 partial route 상태를 반영한다.
14. 프론트엔드 지도, 타임라인, 상태 문구, 범례 정렬을 반영한다.
15. metadata/OG title 정규화 helper를 공통화한다.
16. mock 기반 테스트를 추가하고 기존 테스트를 갱신한다.
17. 사용자 승인 후 로컬 웹/MCP 서버로 실제 MCP tool 호출 smoke를 수행한다.

## 변경 파일 후보

| 파일 | 변경 목적 | 주의점 |
| --- | --- | --- |
| `packages/planme-core/src/openai-itinerary-generator.ts` | Function Calling loop, tool result 전달, AI 판단 structured output 처리 | 기존 structured output 생성 흐름과 호환 필요 |
| `packages/planme-core/src/place-candidates.ts` | Google/Naver 후보 목록 검색과 normalization | 검색 1순위 자동 채택 금지 |
| `packages/planme-core/src/gpt-actions.ts` | 추천 일정 생성, 후보 검증, clarification 분기, hard gate | pageUrl 생성 전 실패 분기 필수 |
| `packages/planme-core/src/draft-itineraries.ts` | hard gate 통과 전 `geoPath` 생성 금지 | 좌표 없는 stop 조용한 누락 금지 |
| `packages/planme-core/src/index.ts` | 신규 타입/함수 export | web/mcp import 경로 유지 |
| `apps/mcp/src/planme-mcp.ts` | MCP input/output schema, `clarificationContext`, widget metadata | ready 응답 기존 필드 유지 |
| `apps/mcp/scripts/check-planme-mcp.ts` | Function Calling, hard gate, clarification, origin 테스트 | 실제 secret 출력 금지 |
| `apps/mcp/src/usage-counters.ts` 또는 `packages/planme-core/src/usage-counters.ts` | Redis/Upstash 일별 호출량 카운터 | `apps/web/lib`를 MCP에서 직접 import하지 않는다. preview 저장 키와 카운터 키 분리 |
| `apps/web/components/itinerary/ItineraryDashboard.tsx` | partial route, transit marker, timeline event, 범례 정렬 | 장거리 직선 재도입 금지 |
| `apps/web/e2e/destination-editor-recorded-flow.spec.ts` | partial route와 marker E2E | mock이 provider 의미를 훼손하지 않게 작성 |
| `scripts/check-planme-actions.mjs` | static guard 강화 | 문자열 sentinel만으로 완료 판정하지 않음 |

## API/DTO 계획

업무 의미(MCP 일정 추천 도구): `recommend_planme_itinerary`

요청 DTO:

- 기존 여행 조건 필드는 유지한다.
- `clarificationContext`는 optional이다.
- 사용자 답변은 `clarificationAnswers?: string[]`로 받는다. 단일 답변만 온 경우에도 배열 1개로 normalize한다.

응답 DTO:

- 성공 응답: `status: "ready"`, `pageUrl`, itinerary summary, validation issues
- 확인 필요 응답: `status: "needs_clarification"`, unresolved stops, questions, `clarificationContext`, validation issues

required:

- `status`
- ready: `pageUrl`, `itineraryId`, `title`, `summary`
- needs_clarification: `message`, `unresolvedStops`, `questions`, `clarificationContext`, `validationIssues`

optional:

- `validationIssues`
- `feedbackMessage`
- `replacementLogs`는 새 설계에서는 `resolutionLogs`로 이름 변경을 검토한다.
- `clarificationAnswers`

nullable:

- 사용하지 않는다. 값이 없으면 빈 배열 또는 필드 생략을 우선한다.

오류 응답:

- provider 장애가 특정 장소 후보 실패로 귀결되면 tool error가 아니라 `needs_clarification` 정상 응답으로 반환한다.
- 서버 설정 누락, OpenAI 인증 실패처럼 일정 생성을 시작할 수 없는 오류는 기존 에러 처리 방식을 유지한다.

## 데이터/카운터 계획

- DB 마이그레이션은 없다.
- Redis/Upstash 일별 카운터를 사용한다.
- 카운터 구현 위치는 `apps/mcp` 또는 `packages/planme-core`로 둔다. `apps/web/lib/preview-itinerary-store.ts`는 패턴 참고만 하고 직접 import하지 않는다.
- 카운터 항목: OpenAI 요청, Function Calling 장소 검색 호출, Google Places 호출, Naver 호출, ODsay 호출, 일정 생성 성공, `needs_clarification`, 최후 확정, hard gate 실패
- 키 구조와 TTL은 구현 중 기존 preview store 키 네이밍과 충돌하지 않게 정한다.

## 프론트엔드 계획

- 화면/라우트: itinerary detail page
- 컴포넌트: `ItineraryDashboard`, route comparison card, destination editor, map marker layer
- 상태:
  - `complete`: provider geometry 충분
  - `partial`: 시간/거리 또는 marker는 있으나 장거리 geometry 누락
  - `failed`: 좌표 누락 또는 provider 실패
- API 연동: browser-side ODsay/Naver route 계산 결과에 `geometryStatus`, `transitMarkers`, `warnings`를 유지한다.
- 오류/로딩/빈 상태: partial 상태는 warning으로 표시하고 완료 문구를 쓰지 않는다.

## 코드 예시

후보:

```ts
type PlaceDecisionStatus = "accepted" | "ambiguous" | "rejected";

type PlaceCandidateDecision = {
  status: PlaceDecisionStatus;
  originalPlaceName: string;
  selectedCandidateId?: string;
  reason: string;
  questions?: string[];
  feedbackNeeded?: boolean;
  feedbackMessage?: string;
};
```

후보:

```ts
type PlanmeMcpStatus = "ready" | "needs_clarification";

type PlanmeClarificationSummary = {
  status: "needs_clarification";
  message: string;
  unresolvedStops: string[];
  questions: string[];
  clarificationContext: PlanmeClarificationContext;
  validationIssues: string[];
};
```

## 검증 계획

- 단위 테스트: tool schema, 후보 목록 normalization, hard gate, 20km 제한, 라운드 제한
- 통합/API 테스트: MCP output schema, `PLANME_WEB_ORIGIN`, `clarificationContext`
- 프론트엔드 확인: partial route 문구, marker, timeline event, H1/metadata 문구
- 수동 검증: 사용자 승인 후 로컬 웹/MCP 서버에서 실제 생성 링크 확인
- 실행 명령:
  - `npm run test:actions`
  - `npm run test:mcp`
  - `npx playwright test apps/web/e2e/destination-editor-recorded-flow.spec.ts --project=chromium`

## 배포와 롤백

- 배포 순서: mock 테스트 통과 -> 사용자 승인형 실제 API smoke -> PR review -> Vercel preview 확인 -> main 반영
- 운영 확인: GPT tool 응답 링크, widget metadata, generated itinerary detail page
- 롤백 조건:
  - 좌표 없는 pageUrl 생성
  - `placeId` 또는 검색 출처 없는 stop 저장
  - 외부 후보 없이 AI가 장소 확정
  - 장거리 직선 polyline 재발
  - MCP widget local origin 차단
  - 기존 GPT Action 응답 호환성 파손

## 중단 조건

- OpenAI Function Calling payload가 fetch mock으로 재현되지 않으면 실제 API 호출로 넘어가지 않고 구현을 멈춘다.
- OpenAI Function Calling payload가 현재 SDK/Responses API 구조와 맞지 않으면 구현을 멈추고 설계 문서를 갱신한다.
- output schema 변경이 기존 MCP 클라이언트와 충돌하면 사용자 확인을 받는다.
- API key가 없어 실제 smoke가 불가능하면 완료 처리하지 않고 미검증으로 남긴다.
- provider 응답이 공식 문서와 다르게 동작하면 구현을 멈추고 재설계 항목을 기록한다.
