# 절약 시간 문구와 적용 범위

## 목적

- 이 주제를 확인하는 이유: 절약 시간이 없을 때도 CarryME 총 이동 시간이 표시되어 사용자가 오류처럼 느낄 수 있다.
- 이 주제가 불명확하면 생기는 리스크: "시간 절약 없음"과 "CarryME 이동 시간 있음"이 서로 충돌하는 문구처럼 보인다.

## Questions

1. 절약 시간이 없을 때 문구를 어떻게 바꿀 것인가?
2. 절약 시간이 있을 때 문구는 유지할 것인가?
3. 변경을 어느 화면과 응답까지 적용할 것인가?

## Answers

1. `시간 절약 없음 · 짐 없이 바로 이동`으로 바꾼다.
2. 절약 시간이 있을 때는 기존 `약 N분 절약`을 유지한다.
3. 상세 화면, GPT/ChatGPT용 일정 미리보기 이미지, GPT Action API 응답까지 같은 기준으로 맞춘다.

## Score

- 현재 불명확성 점수: `0.10`
- 목표 임계값: `Standard 0.20`
- 점수 근거: 문구와 적용 범위가 모두 확정됐다.
- 다음에 낮춰야 할 불확실성: 구현 시 새로 생성되는 일정과 화면 표시가 같은 formatter를 공유하는지.

## Confirmed

- 절약 있음 문구는 `약 N분 절약`을 유지한다.
- 절약 없음 문구는 `시간 절약 없음 · 짐 없이 바로 이동`으로 바꾼다.
- 지도 말풍선은 `절약 없음` 문자열 비교보다 실제 절약 여부 기준으로 분기하는 편이 안전하다.
- 일반 상세 페이지 OpenGraph metadata는 현재 제목 중심 이미지라 이번 문구 적용의 핵심 범위가 아니다.
- GPT/ChatGPT용 일정 미리보기 이미지는 저장 절약 문구를 표시하므로 적용 범위에 포함한다.

## Open Questions

- 기존 Redis preview 저장값은 직접 수정하지 않는다.
- 새로 생성되는 일정과 화면/API 응답 기준으로 맞춘다.

## References

- [ItineraryDashboard.tsx](../../../../apps/web/components/itinerary/ItineraryDashboard.tsx) - 절약 시간 라벨 계산.
- [RouteMap.tsx](../../../../apps/web/components/itinerary/RouteMap.tsx) - 롤러 말풍선과 지도 범례.
- [draft-itineraries.ts](../../../../packages/planme-core/src/draft-itineraries.ts) - GPT 초안의 저장 절약 문구.
