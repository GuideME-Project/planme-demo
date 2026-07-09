# 행선지 편집 설계

## 결론

행선지 편집은 일자별 전체 이동 흐름을 편집하는 화면이다.
AI 출력 계약은 새 전용 구조를 만들기보다 기존 `standardStops`와 `carrymeStops`를 확장한다.
각 stop은 장소 이름과 설명뿐 아니라 역할(`role`)과 다음 구간 이동수단(`mode`)을 가져야 한다.

`startPoint` 같은 별도 출발지 필드는 새로 두지 않는다.
출발지는 각 day의 첫 stop으로 표현하고, 그 stop의 역할을 `출발지`로 둔다.
마지막 날 복귀지도 stop으로 표현하고, 역할을 `복귀지`로 둔다.

## 이유

현재 버그의 원인은 좌표 누락이 아니라 역할 정보 손실이다.
AI 생성 데이터의 `carryme.stops`가 부산 내부 방문지부터 시작했는데, 화면은 첫 row를 index 기준으로 `출발지`라고 표시했다.
따라서 해결책은 장소 검색이나 좌표 보강을 새로 만드는 것이 아니라, AI가 만든 이동 흐름의 역할을 화면 row까지 보존하는 것이다.

기존 코드에는 이미 장소 검색/상세 조회로 좌표를 확정하는 흐름이 있다.
좌표 없는 row를 경로 계산 전에 차단하는 방어도 있다.
설계는 이 흐름을 유지하고, 역할 계약과 row 변환만 명확히 한다.

## Stop 계약

`standardStops`와 `carrymeStops`는 더 이상 단순 방문지 배열이 아니다.
각 day의 화면 행선지 편집과 경로 계산에 사용할 전체 이동 흐름이다.

| 필드 | 의미 | 필수 |
| --- | --- | --- |
| `name` | 화면에 표시할 장소명 | 예 |
| `caption` | 보조 설명 | 예 |
| `role` | `출발지`, `방문지`, `숙소`, `복귀지` 중 하나 | 예 |
| `mode` | 이 stop에서 다음 stop으로 이동할 대표 이동수단. `drive`, `transit` 중 하나 | 예, 마지막 stop 제외 가능 |
| `coordinate` | provider 경로 계산에 쓰는 좌표 | 있으면 사용 |
| `placeId` | 장소 검색/상세 조회로 확정한 장소 식별자 | 있으면 사용 |

역할은 AI가 내려준다.
코드는 index나 이름으로 `출발지`, `숙소`, `복귀지`를 적극 추론하지 않는다.
역할이 누락되거나 유효하지 않으면 해당 row를 `확인 필요` 상태로 보고 경로 재계산을 막는다.

## 일자별 흐름

1일차:

```text
서울 마포구 / 출발지 / transit
오륙도 스카이워크 / 방문지 / transit
해운대 해수욕장 / 방문지 / transit
아난티 앳 부산 빌라쥬 / 숙소
```

중간일:

```text
아난티 앳 부산 빌라쥬 / 출발지 / transit
기장시장 / 방문지 / transit
아난티 앳 부산 빌라쥬 / 숙소
```

마지막 날:

```text
아난티 앳 부산 빌라쥬 / 출발지 / transit
기장시장 / 방문지 / transit
서울 마포구 / 복귀지
```

2일차 이상에서 AI가 출발지를 명시하지 못한 경우에는 전날 마지막 `숙소` role stop을 출발지 후보로 사용한다.
이 fallback은 이름 기반 추론이 아니라, 이전 day의 구조화된 role을 사용하는 제한된 보정이다.
전날 숙소 role도 없으면 `확인 필요` 상태로 두고 경로 재계산을 막는다.

## 화면 변환

`createDestinationRows`는 `RoutePlan.stops`의 label/coordinate만 복사하지 말고 role, mode, placeId를 보존해야 한다.
`getDestinationRole(index, total)`처럼 index만 보는 라벨 계산은 제거 대상이다.
화면 라벨은 row의 role을 그대로 표시한다.

숙소는 위치와 관계없이 `숙소`로 표시한다.
CarryME의 `짐 숙소 도착`은 타임라인 이벤트이며, 행선지 편집의 숙소 role과 섞지 않는다.

## 경로 계산

경로 다시 계산은 행선지 편집 rows 전체를 기준으로 provider API를 호출해 이동 시간과 지도 path/polyline을 갱신하는 작업이다.
구간 이동수단은 출발 row의 `mode`를 사용한다.

- `drive`: Naver Directions 자동차 경로
- `transit`: ODsay 대중교통 경로

웹 행선지 간 대표 이동수단으로 `walk`를 노출하지 않는다.
대중교통 provider 응답 안에 포함되는 도보 구간은 세부 sub-path로만 다룬다.

좌표가 없는 row가 있으면 기존 방어 로직대로 provider 호출 전에 차단한다.
좌표 확정은 기존 `/api/places/autocomplete`와 `/api/places/details` 흐름을 재사용한다.

행선지 편집 화면에서 숙소 row를 숨기거나 삭제하지 않는다.
다만 CarryME provider 계산 입력은 CarryME 여행자 이동 흐름이어야 한다.
따라서 Standard에서만 필요한 중간 짐 경유 숙소는 CarryME stops에 넣지 않는다.
CarryME stops에 남는 숙소는 사람이 실제로 들르거나 숙박하는 숙소다.

## 기존 결정과의 정합성

CarryME 경로는 여전히 짐 배송 경로가 아니라 여행자 경로다.
기존의 "Standard에서 호텔/숙소 중간 방문 제거" 결정은 CarryME stop 계약에서 다음처럼 반영한다.

- Standard stops에는 짐 때문에 사람이 숙소에 들르는 이동 흐름을 포함할 수 있다.
- CarryME stops에는 사람이 짐 없이 이동하는 전체 흐름을 포함한다.
- CarryME에서 숙소가 중간 짐 경유지일 뿐이면 그 stop은 CarryME stops에 넣지 않는다.
- CarryME에서 숙소가 실제 사람의 숙박/도착 지점이면 `숙소` role로 남는다.

즉 "숙소 제거"는 무조건 삭제가 아니라, CarryME 여행자 이동 흐름에 필요 없는 중간 경유 숙소만 제외하는 규칙이다.
편집 화면의 숙소 row 자체를 없애는 규칙이 아니다.

## 리스크

- AI가 role/mode를 누락하면 화면은 경로 재계산을 진행할 수 없다.
- 기존 preview payload에는 role/mode가 없을 수 있다. 기존 Redis preview는 직접 수정하지 않고, 새 생성 데이터부터 계약을 적용한다.
- 2일차 이상 fallback은 이전 day의 구조화된 `숙소` role에 의존한다. 이전 day도 불완전하면 `확인 필요`로 멈춰야 한다.

## 코드 근거

- [ItineraryDashboard.tsx](../../../../apps/web/components/itinerary/ItineraryDashboard.tsx) - 현재 `createDestinationRows`, `getDestinationRole`, `requestRouteCheck`, 장소 검색/상세 조회 흐름.
- [draft-itineraries.ts](../../../../packages/planme-core/src/draft-itineraries.ts) - AI stop을 route plan으로 정규화하는 위치.
- [openai-itinerary-generator.ts](../../../../packages/planme-core/src/openai-itinerary-generator.ts) - AI structured output schema를 정의하는 위치.
- [destination-editor-flow.md](../01_interview/destination-editor-flow.md) - 행선지 편집 전체 이동 흐름 인터뷰 결정.
