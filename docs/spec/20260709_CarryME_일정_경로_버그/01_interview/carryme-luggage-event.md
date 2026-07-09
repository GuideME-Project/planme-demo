# CarryME 타임라인의 짐 숙소 도착 이벤트

## 목적

- 이 주제를 확인하는 이유: CarryME 일정에서는 여행자가 호텔/숙소에 들르지 않지만, 짐이 호텔/숙소로 간다는 사실은 보여줘야 한다.
- 이 주제가 불명확하면 생기는 리스크: 타임라인에서 호텔/숙소 이벤트가 여행자 이동처럼 보이거나, 반대로 짐이 어디로 갔는지 사라질 수 있다.

## Questions

1. CarryME 일정에서 호텔/숙소 관련 이벤트를 보여줄 것인가?
2. 이벤트 문구는 무엇으로 할 것인가?
3. 이벤트 시간은 어떻게 정할 것인가?
4. 별도 배송 예상 도착 시간 계산이 필요한가?

## Answers

1. CarryME 일정 쪽 타임라인에서 짐 흐름을 알려주는 이벤트로 보여준다.
2. 문구는 `짐 숙소 도착`으로 한다.
3. Standard 일정에서 사람이 호텔/숙소에 도착하던 시간을 그대로 재사용한다.
4. 별도 배송 예상 도착 시간 계산, 고정 시간, 외부 배송 연동은 하지 않는다.

## Score

- 현재 불명확성 점수: `0.12`
- 목표 임계값: `Standard 0.20`
- 점수 근거: 이벤트 문구와 시간 기준이 확정됐다.
- 다음에 낮춰야 할 불확실성: 구현 시 기존 타임라인 데이터에서 Standard 호텔/숙소 도착 시간을 안정적으로 참조하는 방식.

## Confirmed

- CarryME 일정은 여행자가 이동하는 일정이다.
- `짐 숙소 도착`은 여행자 도착 이벤트가 아니라 짐 흐름 이벤트다.
- Standard 일정에서 사람이 호텔/숙소에 도착하던 시간은 CarryME 일정에서 `짐 숙소 도착` 시간으로 재해석한다.
- 이번 대표 시나리오는 시간 절약이 없는 시나리오다.
- 시간 절약이 없어도 `짐 없이 바로 이동`의 의미가 화면에 남아야 한다.

## Open Questions

- 구현 단계에서 Standard 타임라인의 호텔/숙소 이벤트가 없는 경우를 어떻게 다룰지는 코드 근거와 실제 데이터 구조를 보고 정한다.
- 다만 인터뷰 결정은 "별도 fallback을 복잡하게 만들지 않고 Standard를 따른다"이다.

## References

- [generated-itineraries.ts](../../../../packages/planme-core/src/generated-itineraries.ts) - 생성 일정의 Standard/CarryME stops와 timeline 구성.
- [draft-itineraries.ts](../../../../packages/planme-core/src/draft-itineraries.ts) - GPT 초안 timeline 정규화.
- [ItineraryDashboard.tsx](../../../../apps/web/components/itinerary/ItineraryDashboard.tsx) - 경로 재계산 후 timeline 생성.
