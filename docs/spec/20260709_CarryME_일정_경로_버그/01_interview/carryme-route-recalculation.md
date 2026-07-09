# CarryME 경로 재계산과 실패 처리

## 목적

- 이 주제를 확인하는 이유: CarryME 경로는 Standard 일정에서 호텔/숙소 중간 방문을 제거한 뒤의 여행자 경로여야 한다.
- 이 주제가 불명확하면 생기는 리스크: CarryME 경로가 Standard와 같은 숙소 경유 경로로 남거나, 재계산 실패가 사용자에게 오류처럼 보일 수 있다.

## Questions

1. CarryME 경로의 기본 기준은 무엇인가?
2. 호텔/숙소 중간 방문을 제거한 뒤 CarryME 시간은 어떻게 정하는가?
3. CarryME 경로 재계산이 실패하면 어떻게 보여줄 것인가?

## Answers

1. 기본 기준은 Standard 일정이다.
2. Standard 일정에서 호텔/숙소 중간 방문을 제거한 뒤 CarryME 경로만 다시 계산한다.
3. CarryME 경로 재계산이 실패하면 별도 오류로 보이지 않게 하고, CarryME 경로/시간을 Standard와 동일하게 표시한다.

## Score

- 현재 불명확성 점수: `0.10`
- 목표 임계값: `Standard 0.20`
- 점수 근거: 재계산 대상, 절약 시간 계산 기준, 실패 처리 방식이 확정됐다.
- 다음에 낮춰야 할 불확실성: 구현 시 재계산 실패를 어떤 상태값으로 내부 표현할지.

## Confirmed

- Standard 일정은 사람이 짐 때문에 호텔/숙소에 들르는 기본 일정이다.
- Standard 경로는 다시 만들 필요가 없다.
- CarryME 경로만 Standard에서 호텔/숙소 중간 방문을 뺀 `출발 -> 방문지 -> 최종 목적지` 기준으로 다시 계산한다.
- 절약 시간은 `Standard 총 이동 시간 - CarryME 재계산 총 이동 시간`이다.
- CarryME 재계산이 성공하면 재계산 결과를 사용한다.
- CarryME 재계산이 실패하면 CarryME 경로/시간은 Standard와 동일하게 표시한다.
- 이 실패 fallback에서는 절약 시간을 0으로 보고 `시간 절약 없음 · 짐 없이 바로 이동`을 표시한다.
- 재계산 실패를 사용자에게 오류 메시지로 드러내지 않는다.

## Open Questions

- 구현 단계에서 실패 fallback을 저장 데이터에 반영할지, 화면 표시 상태로만 유지할지는 코드 구조를 보고 정한다.
- 다만 인터뷰 결정은 "사용자에게는 자연스럽게 Standard와 같은 값으로 보이게 한다"이다.

## References

- [ItineraryDashboard.tsx](../../../../apps/web/components/itinerary/ItineraryDashboard.tsx) - 상세 화면 경로 재계산, 절약 라벨, computed route 적용.
- [RouteMap.tsx](../../../../apps/web/components/itinerary/RouteMap.tsx) - 지도 경로 표시와 범례.
