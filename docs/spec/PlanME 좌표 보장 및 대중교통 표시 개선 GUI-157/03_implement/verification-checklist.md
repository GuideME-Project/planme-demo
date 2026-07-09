# 검증 체크리스트

## 결론

이 문서는 구현 전 검증 계획이다. 과거 통과 결과를 현재 완료로 보지 않는다. 완료 판정은 Function Calling 기반 장소 검색/판단, 좌표 hard gate, MCP clarification, 대중교통 partial route, origin 분리, UI 정리를 모두 증명한 뒤에만 한다.

## 자동 테스트

| 항목 | 명령/위치 | 통과 기준 | 상태 |
| --- | --- | --- | --- |
| action static contract | `npm run test:actions` | 직선 fallback 금지, OpenAPI/route contract 통과 | 통과 |
| MCP contract | `npm run test:mcp` | ready/clarification/origin/context 테스트 통과 | 통과 |
| destination editor E2E | `npx playwright test apps/web/e2e/destination-editor-recorded-flow.spec.ts --project=chromium` | 기존 회귀 없음, partial route 표시 통과 | 통과 |
| Function Calling mock | `apps/mcp/scripts/check-planme-mcp.ts` 또는 core 테스트 | tool call/result/재시도/assertion 통과, tool call 누락 시 `tool_choice: required` 1회 재시도, `search_places_nearby` 직접 Nearby Search 라우팅 확인 | 통과 |
| 후보 hard gate | `apps/mcp/scripts/check-planme-mcp.ts` 또는 core 테스트 | 좌표와 `placeId` 또는 검색 출처 검증 통과 | 통과 |
| 사용량 카운터 | `apps/mcp/scripts/check-planme-mcp.ts`, Playwright E2E | MCP 메모리 fallback과 Upstash REST pipeline 명령 검증, web ODsay 카운터 route 회귀 없음 | 통과 |
| 기존 자동 대체 제거 | `apps/mcp/scripts/check-planme-mcp.ts` 또는 code guard | `replacementLogs`, `suggestedQueries`, 단일 후보 자동 채택 의존 제거 | 통과 |
| 실제 API smoke 실행 가드 | `npm run smoke:external` | 승인 플래그 없으면 예상 호출량만 출력하고 외부 API 호출 없이 실패 종료 | 통과 |

## 완료 기준별 체크

| 완료 기준 | 검증 방법 | 상태 |
| --- | --- | --- |
| 초안 생성 단계에서 Function Calling 장소 검색 루프가 동작함 | OpenAI fetch mock + tool call assertion | 통과 |
| OpenAI strict function schema가 공식 문서 조건을 만족함 | MCP contract test + 공식 문서 대조 | 통과 |
| 후보 검증 단계에서 AI가 `accepted`/`ambiguous`/`rejected`를 판단함 | OpenAI fetch mock + JSON assertion | 통과 |
| Google Places 1순위 자동 대체 로직을 사용하지 않음 | 회귀 테스트 + 코드 검색 | 통과 |
| Google/Naver 검색 출처가 공통 후보 모델로 정규화됨 | MCP contract test | 통과 |
| Nearby Search 기준 좌표가 명시되지 않아도 stop 좌표를 기준으로 사용함 | MCP contract test | 통과 |
| 좌표 없는 장소는 링크로 저장되지 않음 | core/MCP contract test | 통과 |
| `placeId` 또는 검색 출처 없는 장소는 링크로 저장되지 않음 | core/MCP contract test | 통과 |
| Naver 지오코딩 좌표만 있는 방문지는 후보 판단 없이 링크로 저장되지 않음 | MCP contract test | 통과 |
| `ambiguous` 또는 `rejected`이면 링크와 위젯 없이 ChatGPT 대화에서 최대 2개 질문 | MCP contract test | 통과 |
| fallback clarification 문구가 사용자에게 장소명/조건 구체화를 요구하지 않음 | MCP contract test + code search | 통과 |
| 되묻기 최대 2라운드 준수 | MCP contract test | 통과 |
| 단일 `clarificationAnswers` 문자열 normalize | MCP contract test | 통과 |
| 2라운드 후 마지막 검색 후보가 있으면 내부 AI 최후 확정 | MCP contract test | 통과 |
| 2라운드 후 마지막 검색 후보가 없으면 내부 AI 최후 확정 금지 | core test | 통과 |
| `final_ai_decision` 카운터는 2라운드 후 최후 확정에만 증가함 | MCP contract test | 통과 |
| Redis/Upstash 일별 호출량 카운터 기록 | mock Redis test | 통과 |
| 카운터 구현 위치 분리 | code review + import guard | 통과 |
| 대중교통 장거리 본선 polyline 없으면 선 없음 | Playwright partial route assertion | 통과 |
| 지도에 장거리 첫 탑승역/최종 하차역 마커 표시 | Playwright marker assertion | 통과 |
| 타임라인에 장거리 탑승/하차 이벤트 표시 | Playwright text assertion | 통과 |
| partial route를 `경로 체크 완료`로 오인 표시하지 않음 | Playwright text assertion | 통과 |
| 기존 부산/데모 E2E 회귀 없음 | 기존 E2E | 통과 |
| `PLANME_WEB_ORIGIN`이 저장/링크/widget metadata에 모두 반영 | MCP contract test | 통과 |
| metadata/OG/H1에서 `PlanME` prefix 제거 | code review + static guard | 통과 |
| 상단 `Standard / CarryME` 정렬 확인 | code review + Playwright 회귀 | 통과 |
| 로컬 웹/MCP 서버 실제 생성 링크 화면 확인 | 사용자 승인형 smoke + 실제 브라우저 경로 재계산 | 통과 |

## 실제 API 검증 승인 문구

실제 API 키가 있어도 자동 실행하지 않는다. 실행 전 아래처럼 예상 호출량을 안내하고 승인받는다.

```text
정확한 검증을 위해 실제 API 테스트를 실행할까요? API 사용량이 발생합니다.
- OpenAI: 약 N건
- Google Places: 약 N건
- Naver: 약 N건
- ODsay: 약 N건
```

## 실제 로컬 smoke 절차

자동 가드:

```bash
npm run smoke:external
npm run smoke:external -- --confirm-external-api
```

승인 플래그가 없으면 예상 호출량만 출력하고 외부 API를 호출하지 않는다. 승인 플래그가 있어도 `PLANME_WEB_ORIGIN`이 응답하지 않으면 OpenAI/Google/Naver 호출 전에 중단한다.

1. web 서버를 `http://localhost:3000`으로 실행한다.
2. MCP 서버를 로컬 MCP URL로 실행한다.
3. `PLANME_WEB_ORIGIN=http://localhost:3000`이 적용됐는지 확인한다.
4. `recommend_planme_itinerary`로 양양 -> 거제 여행 일정을 생성한다.
5. 응답이 `ready`면 `pageUrl`이 localhost인지 확인한다.
6. 상세 페이지에서 모든 stop이 좌표와 `placeId` 또는 검색 출처를 갖는지 확인한다.
7. 경로 재계산을 실행한다.
8. 장거리 본선 직선 polyline이 없는지 확인한다.
9. 탑승/하차 marker와 timeline event가 있는지 확인한다.
10. partial route 문구가 `일부 구간 확인 필요` 계열인지 확인한다.

## 테스트 카테고리

각 카테고리에서 최소 2개 이상을 mock 기반으로 검증한다.

- 숙소: 바다전망 숙소, 가족 숙소, 특정 호텔명
- 활동지: 낚시, 아이 실내 체험, 산책/전망, 공연/축제
- 식사/카페: 지역 맛집, 바다뷰 카페
- 교통 거점: 역, 터미널, 공항
- 애매한 지역명: 거제 바다, 남해 관광지 같은 넓은 표현
- 검색 실패 장소: 존재하지 않는 장소, 좌표와 `placeId` 또는 검색 출처를 못 찾는 장소

## 완료 금지 조건

- 좌표 없는 stop이 생성 링크에 남아 있음
- `placeId` 또는 검색 출처 없는 stop이 생성 링크에 남아 있음
- Google Places 1순위 자동 대체 로직이 남아 있음
- `replacementLogs`, `suggestedQueries`, 단일 `candidate` 성공 전제가 새 계약에 남아 있음
- Function Calling 실패 후 외부 후보 없이 AI가 장소를 확정함
- `ambiguous` 또는 `rejected` 상태에서 pageUrl 또는 widget이 생성됨
- Nearby Search가 20km를 넘는 radius로 호출됨
- 장거리 경계점 직선 polyline이 다시 나타남
- partial route가 `경로 체크 완료`로 표시됨
- `PLANME_WEB_ORIGIN`이 widget metadata에 빠짐
- 실제 로컬 MCP 생성 링크 화면을 확인하지 않음

## 결과 기록

구현 완료 후 다음 정보를 갱신한다.

- 실행 명령
- 실행 시간
- 통과/실패
- 실패 시 관측된 원인
- 재시도 여부
- 미실행 사유

## 2026-07-09 Mock 기반 검증 결과

| 명령 | 결과 | 비고 |
| --- | --- | --- |
| `npm run test:mcp` | 통과 | 최초 1회는 `place-candidates.ts`의 Text Search 실패 분기 `null` 반환 때문에 TypeScript 빌드 실패. 배열 반환으로 수정 후 통과. 이후 OpenAI 후보 판단, tool call 누락 재시도, 좌표 출처 hard gate, Naver 지오코딩 방문지 후보 판단 강제, Naver 출처의 공통 후보 모델 정규화, stop 좌표 기반 Nearby Search fallback, fallback clarification 문구 제한, MCP 사용량 카운터, `search_places_nearby` 직접 라우팅, 단일 clarification 답변 normalize, 2라운드 후 최후 확정 검증 추가 후 재통과 |
| `npm run test:actions` | 통과 | GPT Actions static contract 통과 |
| `npx playwright test apps/web/e2e/destination-editor-recorded-flow.spec.ts --project=chromium` | 통과 | 7개 테스트 통과. 테스트 내 강제 ODsay 실패/429 로그는 기대 경로. ODsay web usage counter route 추가 후 재통과 |
| `npm run build` | 통과 | 최초 실행에서 대중교통 segment 타입의 `transitMarkers`/`geometryStatus` 계약 누락으로 Next TypeScript 검증 실패. provider segment 반환 타입과 API segment marker 타입을 보강 후 통과 |
| `npm --workspace @planme/mcp run typecheck` | 통과 | 최초 실행에서 후보 판단 테스트 입력의 `finalAttempt` 누락을 잡음. DTO 계약에 맞게 명시 후 통과 |
| `npm run smoke:external` | 통과 | 승인 플래그 없이는 실제 API 호출 전 예상 사용량을 출력하고 종료. 사용자 승인 후 `PLANME_CONFIRM_EXTERNAL_API_SMOKE=1`로 실행했고, clarification 2라운드 후 ready 응답과 localhost `pageUrl` 생성 확인 |
| `rg -n "replacementLogs\|suggestedQueries\|\\.candidate\\b\|자동 대체" packages apps scripts --glob '!**/node_modules/**' --glob '!**/dist/**'` | 통과 | 매칭 없음. `rg` exit code 1은 검색 결과 없음 의미 |

## 2026-07-09 추가 감사 결과

- OpenAI Function Calling 공식 문서 기준으로 `strict: true` function schema는 모든 `properties` 필드를 `required`에 포함해야 한다. `search_places_text`, `search_places_nearby` schema를 이 조건에 맞게 수정했고 MCP mock test에 검증을 추가했다.
- OpenAI 초안 생성 프롬프트에서 과거 전제인 “PlanME 서버는 장소를 보정하지 않음” 문구를 제거하고, 검색 후보와 좌표 출처 기반 검증 문구로 교체했다.
- Naver 지오코딩으로 좌표와 출처가 붙은 `visit` stop도 Google Places 후보와 AI 판단을 통과하지 못하면 `needs_clarification`으로 막도록 보강했다. 출발지 같은 이동 기준점은 Naver 지오코딩 출처만으로도 hard gate를 통과할 수 있다.
- Naver 지오코딩 출처가 붙은 stop은 Google Places 후보와 같은 `PlanmePlaceCandidate` 목록에 포함된다. 이 후보는 자동 채택하지 않고 AI 후보 판단과 hard gate를 통과해야 저장된다.
- Nearby Search 호출에 별도 중심 좌표가 빠져도 stop 좌표가 있으면 해당 좌표를 기준으로 사용한다. 반경은 기존 20km 상한을 유지한다.
- AI가 질문을 반환하지 못했을 때의 fallback clarification 문구에서 “원하는 장소의 성격을 알려주세요” 계열 안내를 제거했다.
- `final_ai_decision` 일별 카운터는 일반 후보 확정이 아니라 2라운드 후 내부 AI 최후 확정에서만 증가하도록 보정했다.
- 사용자 승인 후 실제 OpenAI/Google Places/Naver API를 사용하는 `npm run smoke:external`을 실행했다. 최초 호출은 `망치몽돌해수욕장`, 후속 호출은 `지세포방파제` clarification이 발생했고, 스크립트가 최대 2라운드 안에서 답변을 이어 보내 ready 응답을 확인했다.
- 생성 링크는 `http://localhost:3000/itinerary/generated-%EA%B2%BD%EC%83%81%EB%82%A8%EB%8F%84-%EA%B1%B0%EC%A0%9C%EC%8B%9C-%EC%96%91%EC%96%91-%EC%B6%9C%EB%B0%9C-%EA%B1%B0%EC%A0%9C-3%EC%9D%BC-%EB%B0%94%EB%8B%A4%EC%A0%84%EB%A7%9D%EB%82%9A%EC%8B%9C-%EC%97%AC%ED%96%89-3d-1ogfsim`이다.
- 실제 브라우저에서 생성 링크를 열고 `경로 다시 계산`을 실행했다. ODsay 실제 요청 4건, usage 기록 요청 4건이 발생했고, 화면은 `일부 구간 확인 필요 · 약 11시간 36분 · 약 586.0km · 탑승/하차 지점을 확인하세요`로 표시됐다.
- 실제 브라우저 화면에서 탑승 marker 1개와 하차 marker 1개를 확인했고, 장거리 직선/좌표 오류 문구는 표시되지 않았다.
