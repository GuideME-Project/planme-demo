# PlanME MCP 일정 구체화 질문 설계

## 결론

PlanME MCP는 기존 일정 생성 도구(recommend_planme_itinerary)를 유지하고, 생성 전에 입력 완성도를 판단하는 질문 유도 도구(start_planme_planning)를 추가한다.

## 이유

- MCP 서버는 사용자에게 직접 질문하지 않고, ChatGPT가 도구 결과를 보고 다음 질문을 하도록 돕는다.
- 기존 생성 도구는 입력이 부족해도 기본값으로 일정을 만들어서, “서울에서 여수” 같은 요청의 출발지와 기간을 놓치기 쉽다.
- 생성 도구를 바로 엄격하게 바꾸면 현재 GPT Actions와 데모 링크 생성 흐름이 깨질 수 있다.

## 범위

- 추가: MCP 질문 유도 도구(start_planme_planning).
- 추가: PlanME core의 입력 슬롯 평가 함수.
- 변경: 기존 생성 도구(recommend_planme_itinerary)의 설명에 “불명확하면 질문 유도 도구를 먼저 사용” 지침 추가.
- 제외: 웹 화면 UI 변경, 지도/경로 계산 변경, 기존 일정 생성 기본값 제거.

## 필수 슬롯

- 목적지(destination): 어디로 여행하는지.
- 출발 기준(origin 또는 arrivalAirport): 국내 출발지는 origin, 입국/공항 시작은 arrivalAirport로 받는다.
- 여행 기간(durationDays): 당일은 1, 1박 2일은 2처럼 일수로 받는다.

## 선택 슬롯

- 숙소/짐 도착지(hotelName): 없으면 목적지 기본 숙소를 사용하되, 질문 후보로 남긴다.
- 도착/출발 시간(arrivalTime): 없으면 기존 기본 시간 09:30을 유지한다.
- 관심사(preferences): 없으면 목적지 기본 대표 일정을 사용하되, 더 나은 추천을 위해 질문 후보로 남긴다.
- 여행자 수(travelerCount), 짐 개수(luggageCount): 없으면 기존 기본값을 유지한다.

## 도구 응답

질문 유도 도구(start_planme_planning)는 아래 구조를 모델-visible structuredContent로 반환한다.

- 상태(status): needs_input 또는 ready.
- 부족한 필수 슬롯(missingSlots): destination, origin, durationDays 중 필요한 값.
- 질문 목록(questions): ChatGPT가 사용자에게 물어볼 한국어 질문.
- 정규화 입력(normalizedInput): 현재까지 파악한 입력.
- 다음 행동(nextAction): ask_user 또는 call_recommend_planme_itinerary.

## 동작 예시

입력: “여수 추천”

- 상태(status): needs_input.
- 질문: “어디에서 출발하시나요?”, “일정은 당일인가요, 1박 2일인가요?”

입력: “서울에서 여수 1박 2일”

- 상태(status): ready.
- 다음 행동(nextAction): call_recommend_planme_itinerary.

## 리스크

- ChatGPT가 도구 설명을 따르지 않으면 바로 생성 도구를 호출할 수 있다. 생성 도구 설명에 질문 유도 도구 우선 사용 조건을 명시해 완화한다.
- 질문을 너무 많이 반환하면 대화가 무거워진다. 필수 질문을 우선하고, 선택 질문은 최대 1개만 보조로 제공한다.
- MCP 도구 추가는 기존 클라이언트에 하위 호환되어야 한다. 기존 도구 이름과 출력은 유지한다.

## 테스트 기준

- MCP 도구 목록에 질문 유도 도구(start_planme_planning)가 포함된다.
- 목적지만 있는 입력은 상태(status)=needs_input과 출발지/기간 질문을 반환한다.
- 목적지, 출발지, 여행 기간이 모두 있으면 상태(status)=ready와 다음 행동(nextAction)=call_recommend_planme_itinerary를 반환한다.
- 기존 추천 도구(recommend_planme_itinerary)의 부산/여수 회귀 테스트는 그대로 통과한다.
