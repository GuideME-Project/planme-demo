# 검증 계획

## 결론

완료 판정은 단일 시나리오 성공이 아니라 OpenAI Function Calling 기반 장소 검색/판단, 좌표 hard gate, clarification, 대중교통 partial route, origin 분리, UI 정리까지 각각 증명할 때만 한다. mock 기반 계약 테스트와 실제 로컬 MCP 호출 검증을 분리해서 수행한다.

## 검증 매트릭스

| 완료 기준 | 검증 방법 | 후보 위치 |
| --- | --- | --- |
| 양양 -> 거제 1박2일 실제 MCP 생성 통과 | 로컬 MCP 실제 tool 호출 | `apps/mcp/scripts/check-planme-mcp.ts` 또는 별도 smoke script |
| 초안 생성 단계에서 모든 장소가 Function Calling 기반 검색으로 확인됨 | OpenAI fetch mock + tool call assertion | `packages/planme-core` 테스트 |
| 후보 검증 단계에서 AI가 `accepted`/`ambiguous`/`rejected`를 반환함 | OpenAI fetch mock + JSON schema assertion | `packages/planme-core` 테스트 |
| Google Places 1순위 자동 대체를 사용하지 않음 | 회귀 테스트 | 후보 검색/검증 모듈 테스트 |
| 좌표 없는 장소는 링크로 저장되지 않음 | unit/contract test | `packages/planme-core` 테스트 또는 MCP test |
| `placeId` 또는 검색 출처 없는 장소는 링크로 저장되지 않음 | unit/contract test | 후보 검증 모듈 테스트 |
| Text Search 후보를 AI 판단으로 검증함 | fetch mock 기반 test | 후보 검증 모듈 테스트 |
| Text Search 실패 시 Nearby Search 호출 가능 | fetch mock 기반 test | 후보 검색 모듈 테스트 |
| Nearby Search 최대 반경 20km 준수 | assertion test | 후보 검색 모듈 테스트 |
| `ambiguous` 또는 `rejected`이면 링크/위젯 없이 clarification 응답 | MCP contract test | `apps/mcp/scripts/check-planme-mcp.ts` |
| 되묻기 최대 2라운드 준수 | MCP contract test | `apps/mcp/scripts/check-planme-mcp.ts` |
| 마지막 검색 후보가 없으면 내부 AI 최후 확정 금지 | unit/contract test | 후보 검증 모듈 테스트 |
| Redis/Upstash 일별 호출량 카운터 기록 | mock Redis test | web 또는 core counter module |
| 대중교통 장거리 본선 polyline 없으면 선 없음 | Playwright route mock | `apps/web/e2e/destination-editor-recorded-flow.spec.ts` |
| 지도에 장거리 첫 탑승역/최종 하차역 마커 표시 | Playwright assertion/screenshot | web e2e |
| 타임라인에 장거리 탑승/하차 이벤트 표시 | Playwright text assertion | web e2e |
| partial route를 `경로 체크 완료`로 오인 표시하지 않음 | Playwright text assertion | web e2e |
| 기존 부산/데모 E2E 회귀 없음 | 기존 E2E 실행 | web e2e |
| `PLANME_WEB_ORIGIN` 저장/링크/widget metadata 반영 | MCP unit/contract test | `apps/mcp/scripts/check-planme-mcp.ts` |
| metadata/OG/H1에서 `PlanME` prefix 제거 | component/page metadata test 또는 Playwright | web e2e |
| 상단 `Standard / CarryME` 정렬 확인 | Playwright screenshot | web e2e |
| `npm run test:actions` 통과 | 명령 실행 | root |
| `npm run test:mcp` 통과 | 명령 실행 | root |
| 관련 Playwright 테스트 통과 | 명령 실행 | root |
| 로컬 웹/MCP 서버에서 실제 MCP tool 호출 후 생성 링크 화면 확인 | smoke verification | local server |

## 필수 명령

```bash
npm run test:actions
npm run test:mcp
npx playwright test apps/web/e2e/destination-editor-recorded-flow.spec.ts --project=chromium
```

Playwright 명령은 구현 중 test file 구성이 바뀌면 관련 spec만 좁혀 실행할 수 있다. 완료 보고에는 실제 실행한 명령과 결과를 기록한다.

## 실제 API 검증

실제 API 키가 로컬 env에 있어도 자동으로 실행하지 않는다. 실행 전 사용자에게 예상 호출량을 안내하고 승인받는다.

안내 문구 예:

```text
정확한 검증을 위해 실제 API 테스트를 실행할까요? API 사용량이 발생합니다.
- OpenAI: 약 N건
- Google Places: 약 N건
- Naver: 약 N건
- ODsay: 약 N건
```

승인 후 아래 smoke를 수행한다.

1. 웹 서버와 MCP 서버를 로컬로 실행한다.
2. `recommend_planme_itinerary`로 양양 -> 거제 1박2일 바다전망 숙소와 낚시 일정을 생성한다.
3. 생성 응답의 `pageUrl`이 `http://localhost:3000`인지 확인한다.
4. 상세 링크를 열어 모든 stop이 좌표와 `placeId` 또는 검색 출처를 갖는지 확인한다.
5. 경로 재계산 후 장거리 선이 없고 탑승역/하차역 marker와 timeline event가 있는지 확인한다.
6. partial 상태 문구가 `경로 체크 완료`가 아닌지 확인한다.

## 테스트 카테고리

각 카테고리에서 최소 2개 이상을 mock 기반으로 검증한다.

- 숙소: 바다전망 숙소, 가족 숙소, 특정 호텔명
- 활동지: 낚시, 아이 실내 체험, 산책/전망, 공연/축제
- 식사/카페: 지역 맛집, 바다뷰 카페
- 교통 거점: 역, 터미널, 공항
- 애매한 지역명: 거제 바다, 남해 관광지 같은 넓은 표현
- 검색 실패 장소: 존재하지 않는 장소, 좌표와 `placeId` 또는 검색 출처를 못 찾는 장소

## 완료 금지 조건

- 좌표 없는 stop이 상세 링크에 남아 있으면 완료 금지
- `placeId` 또는 검색 출처 없는 stop이 상세 링크에 남아 있으면 완료 금지
- Google Places 1순위 자동 대체 로직이 남아 있으면 완료 금지
- Function Calling 실패 후 외부 후보 없이 AI가 장소를 확정하면 완료 금지
- `ambiguous` 또는 `rejected` 상태에서 링크나 위젯이 생성되면 완료 금지
- 장거리 경계점 직선 polyline이 다시 나타나면 완료 금지
- partial route가 성공 문구로 표시되면 완료 금지
- `PLANME_WEB_ORIGIN`이 pageUrl에만 반영되고 widget metadata에 빠지면 완료 금지
- 실제 로컬 MCP 생성 링크를 열어보지 않았으면 완료 금지

## 기록 방식

구현 단계에서는 `03_implement` 아래에 테스트 로그를 남긴다. 설계 단계에서는 이 문서의 검증 매트릭스가 기준이며, 실행 결과는 implementation 단계에서 별도 기록한다.
