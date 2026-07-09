# 경로 의미와 화면 표현

## 목적

- 이 주제를 확인하는 이유: 지도와 일정 화면의 CarryME 경로가 여행자 이동 경로인지 짐 배송 경로인지 분명해야 한다.
- 이 주제가 불명확하면 생기는 리스크: 사용자는 "내가 가는 길"과 "짐이 가는 길"을 혼동하고, 절약 시간 문구도 모순처럼 보인다.

## Questions

1. "캐리미 전용 경로도로"는 지도에서 어떤 의미로 보여야 하는가?
2. 지도 범례와 안내 문구에서 "CarryME 경로"라는 이름을 계속 써도 되는가?

## Answers

1. "짐 없이 바로 이동하는 길"로 답변했다.
2. 지도 범례/안내 이름은 `짐 없이 바로 이동하는 경로`로 확정했다.

## Score

- 현재 불명확성 점수: `0.12`
- 목표 임계값: `Standard 0.20`
- 점수 근거: CarryME 경로의 업무 의미는 여행자 CarryME 경로로 확정됐다.
- 다음에 낮춰야 할 불확실성: 지도 범례와 화면 라벨의 최종 문구.

## Confirmed

- CarryME 전용 경로는 짐 배송 차량의 이동선이 아니다.
- CarryME 전용 경로는 여행자가 짐 없이 바로 이동하는 길이다.
- 지도 범례/안내의 CarryME 여행자 경로 이름은 `짐 없이 바로 이동하는 경로`다.
- 현재 코드도 큰 방향에서는 Standard 경로는 호텔/숙소 경유, CarryME 경로는 방문지를 바로 이어 붙이는 비교 구조다.

## Open Questions

- 짐 배송 차량 경로 점선 표시는 이번 구현 범위에서 제외한다.

## References

- [RouteMap.tsx](../../../../apps/web/components/itinerary/RouteMap.tsx) - 지도 범례와 롤러 말풍선 표시.
- [ItineraryDashboard.tsx](../../../../apps/web/components/itinerary/ItineraryDashboard.tsx) - Standard/CarryME 비교 경로 생성.
- [mock-data.ts](../../../../packages/planme-core/src/mock-data.ts) - 짐 배송 경로 후보로 보이는 점선 데이터가 있으나 현재 렌더링에서는 사용되지 않음.
