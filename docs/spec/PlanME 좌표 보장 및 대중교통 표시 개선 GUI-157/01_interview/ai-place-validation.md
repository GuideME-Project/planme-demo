# AI 장소 후보 검증 정책

## 목적

- 이 주제를 확인하는 이유: Google/Naver 검색으로 장소 존재와 좌표를 보장하더라도, 검색 결과 1순위가 사용자 의도에 맞는 장소라고 보장할 수 없다.
- 이 주제가 불명확하면 생기는 리스크: 좌표는 있지만 의도와 다른 장소가 일정에 저장되고, 사용자가 링크를 연 뒤에야 잘못된 장소를 발견한다.

## Questions

1. 장소 존재와 좌표 보장은 AI가 판단할지, 외부 장소 API 결과로 판단할지?
2. 검색 후보가 사용자 의도와 맞는지는 코드 규칙으로 판단할지, AI가 판단할지?
3. 후보가 애매하거나 부적합하면 링크 생성을 막고 사용자에게 물을 수 있는지?
4. 되묻기 질문의 종류와 개수는 누가 결정할지?
5. 코드 hard gate는 어디까지 둘지?
6. 사용자 답변 후 기존 후보를 재평가할지, 다시 검색할지?
7. 되묻기는 몇 라운드까지 허용할지?
8. 최대 라운드 후에도 애매하면 실패 처리할지, 내부 AI가 최후 확정할지?
9. 최후 확정 후보가 사용자 의도와 충돌할 때 사용자에게 어떻게 알릴지?
10. 외부 API를 쓰는 검증 테스트는 언제 실행할지?
11. OpenAI Function Calling은 일정 생성 중에 사용할지, 후보 검증 단계에서만 사용할지?
12. Function Calling으로 제공할 장소 검색 함수는 무엇으로 시작할지?
13. 검색 함수의 후보 반환 개수와 호출 예산은 어떻게 제한할지?
14. Function Calling 흐름이 실패하면 어떤 fallback을 사용할지?
15. 외부 API 하루 호출량은 어디에 집계할지?

## Answers

1. 장소 존재와 좌표 보장은 AI가 아니라 Google/Naver API 결과로 검증한다.
2. 검색 후보가 사용자 의도와 맞는지 판단하는 일은 AI가 맡는다.
3. 후보 적합성이 `ambiguous` 또는 `rejected`이면 일정 링크를 만들지 않고 ChatGPT 대화에서 사용자에게 되묻는다.
4. 질문 내용과 질문 형태는 AI가 상황에 맞게 판단한다. 사용자에게 보여줄 질문은 최대 2개까지만 허용한다.
5. 코드 hard gate는 일단 좌표 존재와 `placeId` 또는 검색 출처 존재만 본다. 거리 기준은 주관적이므로 지금은 넣지 않는다.
6. 사용자가 되묻기에 답하면, 기존 후보만 재평가하지 않고 답변을 포함해 Google/Naver 검색을 다시 실행한다.
7. 되묻기는 최대 2라운드까지만 허용한다.
8. 2라운드 후에도 후보가 애매하면 마지막으로 한 번 더 검색하고, 내부 AI가 그 결과까지 포함해 최종 후보를 확정한다.
9. 최후 확정 후보가 사용자 의도와 충돌할 수 있으면 AI가 피드백 필요 여부를 판단한다. 필요하면 ChatGPT 대화에만 짧게 피드백하고, PlanME 일정 페이지에는 자연스럽게 장소를 표시한다.
10. 외부 API 검증 테스트는 사용자가 명시 승인한 경우에만 실행한다. 실행 전 OpenAI, Google Places, Naver Geocoding, ODsay 예상 호출량을 안내한다.
11. OpenAI Function Calling은 일정 초안 생성 단계와 후보 검증 단계 모두에 사용한다. 초안 생성 단계에서도 모든 장소를 검색 확인한다.
12. 초기 Function Calling 도구는 `search_places_text`, `search_places_nearby` 두 개로 시작한다. `geocode_place`, `get_place_details`는 초기 범위에서 제외한다.
13. 검색 함수는 기본 5개, 최대 10개의 후보를 반환한다. 검색 호출 예산은 일정 일수와 장소 수에 따라 동적으로 산정하되, 인터뷰 문서에는 기준 숫자를 넣지 않는다.
14. Function Calling 흐름이 깨지거나 모델이 검색 함수를 제대로 호출하지 않으면 OpenAI 요청을 1회 재시도한다. 재시도 후에도 검색 후보를 확보하지 못하면 기존 1순위 자동 대체 fallback을 쓰지 않고 hard gate 실패로 처리한다. 내부 AI 최후 확정은 마지막 검색 후보가 있을 때만 가능하다.
15. 하루 호출량은 Redis/Upstash 일별 카운터로 저장한다.

## Score

- 현재 불명확성 점수: `0.12`
- 목표 임계값: `Deep 0.15`
- 점수 근거: AI와 코드의 책임, OpenAI Function Calling 적용 위치, 검색 함수 범위, 되묻기 라운드, 최후 확정, UI 표시, 외부 API 테스트 승인 조건까지 확정되었다.
- 다음에 낮춰야 할 불확실성: 구현 설계 단계에서 Function Calling 도구 스키마, 후보 평가 응답 DTO, 라운드 상태 보존 방식, Upstash 카운터 키 구조를 구체화해야 한다.

## Confirmed

- 이 정책은 낚시 일정에 한정하지 않는다. 숙소, 활동지, 식사/카페, 교통 거점, 넓은 지역명, 검색 실패 장소 등 모든 장소 의도에 적용한다.
- OpenAI Function Calling은 초안 생성 단계와 후보 검증 단계 모두에 적용한다.
- 초안 생성 단계에서 일정에 들어가는 모든 장소는 Function Calling 기반 장소 검색으로 확인한다.
- 초기 Function Calling 도구는 `search_places_text`, `search_places_nearby` 두 개이다.
- 검색 함수 후보 반환 개수는 기본 5개, 최대 10개이다.
- 검색 호출 예산은 일정 일수와 장소 수에 따라 동적으로 관리한다. 구체 숫자는 인터뷰 문서에 넣지 않는다.
- AI는 검색 후보의 사용자 의도 적합성을 판단한다.
- 코드는 기본 hard gate만 수행한다.
- `ambiguous` 또는 `rejected`이면 링크와 위젯을 만들지 않고 ChatGPT 대화에서만 질문한다.
- 되묻기 질문은 AI가 생성하며 최대 2개까지만 노출한다.
- 되묻기 후에는 사용자 답변을 포함해 다시 검색한다.
- 되묻기는 최대 2라운드이다.
- 2라운드 후에도 애매하면 마지막 검색 1회를 추가하고 내부 AI가 최후 확정한다.
- 최후 확정 후보도 좌표와 `placeId` 또는 검색 출처 hard gate를 통과해야 한다.
- PlanME 일정 페이지에는 최후 확정 후보를 일반 일정 장소처럼 자연스럽게 표시한다.
- 의도 충돌 피드백은 AI가 필요 여부를 판단하고 ChatGPT 대화에만 표시한다.
- 기존 Google Places 1순위 자동 대체 로직은 폐기한다.
- Function Calling 실패 시 OpenAI 요청을 1회 재시도한다.
- 재시도 후에도 검색 후보를 확보하지 못하면 hard gate 실패로 처리한다.
- 내부 AI 최후 확정은 마지막 검색 후보가 있을 때만 가능하다.
- 외부 API 하루 호출량은 Redis/Upstash 일별 카운터에 저장한다.

## Function Calling Flow

```text
1. OpenAI가 일정 초안 생성을 시작한다.
2. 일정에 넣을 모든 장소에 대해 모델이 search_places_text 또는 search_places_nearby를 호출한다.
3. PlanME 서버가 함수 호출을 받아 Google/Naver API로 실제 장소 후보를 검색한다.
4. PlanME 서버가 후보 목록을 모델에 반환한다.
5. 모델이 후보의 사용자 의도 적합성을 판단하고 초안에 반영한다.
6. 초안 생성 후 후보 검증 단계에서 다시 hard gate와 AI 적합성 판단을 수행한다.
7. accepted이면 일정 링크를 생성한다.
8. ambiguous 또는 rejected이면 링크와 위젯 없이 ChatGPT 대화에서 최대 2개 질문을 한다.
9. 사용자 답변을 포함해 다시 검색한다.
10. 최대 2라운드 후에도 애매하면 마지막 검색 1회 후 내부 AI가 최후 확정한다. 단, 마지막 검색 후보가 없으면 최후 확정하지 않고 hard gate 실패로 본다.
```

## Function Tools

### search_places_text

- 목적: 텍스트로 장소 후보를 검색한다.
- 예시: `거제 바다전망 숙소`, `양양 아이 실내 체험`
- 반환 후보: 기본 5개, 최대 10개
- 후보 정보: `placeId` 또는 검색 출처, 장소명, 주소, 좌표, 타입, 검색어

### search_places_nearby

- 목적: 기준 좌표 주변 장소 후보를 검색한다.
- 예시: 숙소 근처 카페, 목적지 주변 활동지
- 반환 후보: 기본 5개, 최대 10개
- 후보 정보: `placeId` 또는 검색 출처, 장소명, 주소, 좌표, 타입, 검색어, 기준 좌표와의 거리

## AI Decision Output

AI가 검색 후보를 보고 PlanME 서버에 돌려줘야 하는 최소 판단 정보는 다음과 같다. 실제 필드명과 DTO 이름은 설계 단계에서 정한다.

- 판단 결과: `accepted`, `ambiguous`, `rejected`
- 선택한 장소: `accepted`일 때 필요
- 이유: 왜 골랐는지, 왜 애매한지, 왜 거절했는지
- 사용자에게 물어볼 질문: `ambiguous` 또는 `rejected`일 때 최대 2개
- 사용자 피드백 필요 여부: 최후 확정 때 의도 충돌이 있으면 ChatGPT 대화에만 표시

## Failure And Retry

- Function Calling 흐름이 깨지거나 모델이 검색 함수를 제대로 호출하지 않으면 OpenAI 요청을 1회 재시도한다.
- 재시도 후에도 실패하면 기존 Google Places 1순위 자동 대체 fallback을 사용하지 않는다.
- 재시도 후에도 검색 후보를 확보하지 못하면 hard gate 실패로 처리한다.
- 내부 AI 최후 확정은 마지막 검색 후보가 있을 때만 가능하다.
- 최후 확정 후보도 좌표와 `placeId` 또는 검색 출처 hard gate를 통과해야 한다.

## Daily Usage Counters

Redis/Upstash 일별 카운터에 다음 항목을 저장한다.

- OpenAI 요청 횟수
- Function Calling 장소 검색 호출 횟수
- Google Places 호출 횟수
- Naver 호출 횟수
- ODsay 호출 횟수
- 일정 생성 성공 건수
- `needs_clarification` 발생 건수
- 최후 확정 발생 건수
- hard gate 실패 건수

## Success Criteria

1. AI가 만든 장소는 Google/Naver 검색 결과로 존재와 좌표를 가진다.
2. 좌표 없는 장소는 일정 링크로 저장되지 않는다.
3. `placeId` 또는 검색 출처 없는 장소도 일정 링크로 저장되지 않는다.
4. OpenAI Function Calling은 초안 생성 단계와 후보 검증 단계 모두에 사용된다.
5. 초안 생성 단계에서 모든 장소가 Function Calling 기반 장소 검색으로 확인된다.
6. 기존 Google Places 1순위 자동 대체 로직은 사용하지 않는다.
7. 후보 적합성이 `ambiguous` 또는 `rejected`이면 링크 생성 없이 ChatGPT 대화에서 최대 2개 질문을 한다.
8. 질문은 AI가 상황에 맞게 생성한다.
9. 사용자가 답변하면 답변을 포함해 장소 검색을 다시 한다.
10. 되묻기는 최대 2라운드까지만 허용한다.
11. 2라운드 후에도 `ambiguous` 또는 `rejected`이면 마지막으로 한 번 더 검색하고, 내부 AI가 최종 후보를 확정한다.
12. 최후 확정 후보도 좌표와 `placeId` 또는 검색 출처 hard gate를 통과해야 한다.
13. 최후 확정 후보가 사용자 의도와 충돌하는 경우, ChatGPT 대화에 피드백할지 여부를 AI가 판단한다.
14. 생성된 PlanME 일정 페이지에는 최후 확정 후보도 자연스럽게 표시한다.
15. 하루 호출량은 Redis/Upstash 일별 카운터에 저장된다.
16. 카테고리별 최소 2개 테스트셋으로 문서화한다.
17. 외부 API 테스트는 명시 승인 후만 실행하고, 실행 전 예상 호출량을 안내한다.

## Test Categories

- 숙소: 바다전망 숙소, 가족 숙소, 특정 호텔명
- 활동지: 낚시, 아이 실내 체험, 산책/전망, 공연/축제
- 식사/카페: 지역 맛집, 바다뷰 카페
- 교통 거점: 역, 터미널, 공항
- 애매한 지역명: 거제 바다, 남해 관광지 같은 넓은 표현
- 검색 실패 장소: 존재하지 않는 장소, 좌표와 `placeId` 또는 검색 출처를 못 찾는 장소

## Open Questions

- Function Calling 도구의 실제 JSON schema와 OpenAI Responses API 호출 루프를 설계 단계에서 결정해야 한다.
- 되묻기 라운드 상태를 MCP 요청 인자로 받을지, 서버 저장소에 보존할지 설계 단계에서 결정해야 한다.
- `placeId`가 없는 Naver 결과를 어떤 검색 출처 식별자로 저장할지 설계 단계에서 결정해야 한다.
- Redis/Upstash 일별 카운터 키 구조와 보존 기간을 설계 단계에서 결정해야 한다.

## References

- [Linear GUI-157](https://linear.app/guideme/issue/GUI-157/planme-%EC%A2%8C%ED%91%9C-%EB%B3%B4%EC%9E%A5-%EB%B0%8F-%EB%8C%80%EC%A4%91%EA%B5%90%ED%86%B5-%ED%91%9C%EC%8B%9C-%EA%B0%9C%EC%84%A0) - 이 정책을 포함하는 이슈 ID
- [OpenAI Function Calling](https://developers.openai.com/api/docs/guides/function-calling) - 모델이 검색 함수 호출을 요청하고 앱 코드가 실행하는 구조
- [Google Places Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search) - 텍스트 기반 장소 검색
- [Google Places Nearby Search](https://developers.google.com/maps/documentation/places/web-service/nearby-search) - 좌표 기반 주변 장소 검색
- `packages/planme-core/src/place-candidates.ts` - 현재 Google Places 후보 검색 구현
- `packages/planme-core/src/gpt-actions.ts` - 좌표 보장과 clarification 분기 구현 위치
- `apps/mcp/src/planme-mcp.ts` - MCP `recommend_planme_itinerary` 응답 계약
