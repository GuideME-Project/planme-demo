# 화면과 문구 설계

## 결론

화면은 CarryME 경로를 `짐 없이 바로 이동하는 경로`로 설명한다.
절약 시간이 있으면 `약 N분 절약`, 절약 시간이 없거나 CarryME 재계산 fallback이면 `시간 절약 없음 · 짐 없이 바로 이동`을 사용한다.
CarryME 타임라인에는 여행자 도착이 아니라 짐 흐름을 알리는 `짐 숙소 도착` 이벤트를 표시한다.

## 적용 범위

- 상세 화면
- GPT Action API 응답
- GPT/ChatGPT 일정 미리보기 이미지

## 상세 화면

지도 범례와 안내 문구에서 CarryME 경로의 의미를 여행자 경로로 고정한다.
기존 `CarryME 경로` 같은 표현은 화면 맥락상 모호할 수 있으므로 `짐 없이 바로 이동하는 경로`로 바꾼다.
Standard는 비교 기준이므로 별도 의미 변경 없이 유지한다.

행선지 편집은 일자별 전체 이동 흐름을 보여준다.
첫 row와 마지막 row의 라벨은 index로 계산하지 않고 AI가 내려준 role을 표시한다.
예를 들어 첫 방문지가 오륙도 스카이워크여도 role이 `방문지`라면 `출발지`로 표시하지 않는다.
숙소는 마지막 row여도 `숙소`로 표시한다.
마지막 날 처음 출발지로 돌아가는 row는 `복귀지`로 표시한다.

## 절약 문구

| 조건 | 문구 |
| --- | --- |
| 절약 시간이 1분 이상 | `약 N분 절약` |
| 절약 시간이 0분 이하 | `시간 절약 없음 · 짐 없이 바로 이동` |
| CarryME 재계산 실패 fallback | `시간 절약 없음 · 짐 없이 바로 이동` |

Roller 메시지는 GUI-134의 기준을 따른다.
정량 절약 시간이 있을 때만 시간 절약을 말하고, 없을 때는 짐 없이 이동하는 편의성 메시지로 내려간다.

## 타임라인

CarryME 일정에서 호텔/숙소 관련 이벤트는 여행자 도착이 아니라 짐 흐름 이벤트다.
이벤트 제목은 `짐 숙소 도착`으로 한다.
이벤트 시간은 Standard 일정에서 사람이 호텔/숙소에 도착하던 시간을 재사용한다.
별도 배송 예상 도착 시간, 고정 시간, 외부 배송 연동은 이번 설계 범위에 넣지 않는다.

행선지 편집의 `숙소` role은 사람이 이동 흐름에서 들르는 장소를 뜻한다.
타임라인의 `짐 숙소 도착` 이벤트와 같은 개념으로 합치지 않는다.

## GPT Action API 응답

GPT Action 응답의 `summary`, `savedMinutes`, `standardTotalMinutes`, `carrymeTotalMinutes`, `itinerary` 내부 라벨이 상세 화면과 같은 의미를 가져야 한다.
ChatGPT 대화에서는 상세 화면처럼 프리뷰 UI를 직접 보지 못할 수 있으므로, 응답 요약과 미리보기 이미지 문구가 같은 결론을 말해야 한다.

## GPT/ChatGPT 미리보기 이미지

미리보기 이미지는 저장된 일정 데이터를 사용하므로 새로 생성되는 preview payload의 라벨과 시간을 반영한다.
기존 Redis preview 저장값은 직접 수정하지 않는다.
이미 저장된 과거 링크는 그대로 두고, 새 생성 또는 새 표시 흐름에서만 설계 문구가 반영된다.

## 코드 근거

- [RouteMap.tsx](../../../../apps/web/components/itinerary/RouteMap.tsx) - 지도 범례와 Roller 안내 문구.
- [ItineraryDashboard.tsx](../../../../apps/web/components/itinerary/ItineraryDashboard.tsx) - 절약 라벨, route plan 표시, timeline 생성.
- [gpt-actions.ts](../../../../packages/planme-core/src/gpt-actions.ts) - GPT Action 응답과 미리보기 이미지 URL 구성.
- [route.tsx](../../../../apps/web/app/og/itinerary/[itineraryId]/route.tsx) - GPT/ChatGPT용 일정 미리보기 이미지 렌더링.
- [planme-widget.ts](../../../../apps/mcp/src/planme-widget.ts) - MCP widget의 초기 preview 표시.

## 리스크

- 상세 화면과 GPT 응답, 미리보기 이미지가 서로 다른 라벨을 쓰면 사용자가 CarryME 의미를 다르게 이해할 수 있다.
- 같은 계산 결과라도 `절약 없음`과 `시간 절약 없음 · 짐 없이 바로 이동`이 섞이면 Roller 메시지 분기가 흔들릴 수 있다.
- 구현 단계에서는 절약 없음 문구를 한곳에서 만들거나, 최소한 동일한 조건으로 생성되도록 정렬해야 한다.
