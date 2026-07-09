# 대중교통 표시 정책

## 목적

- 이 주제를 확인하는 이유: ODsay 장거리 대중교통 응답이 실제 polyline 없이 경계점만 제공할 때 선을 임의로 그리면 사용자가 실제 경로로 오해한다.
- 이 주제가 불명확하면 생기는 리스크: 양양에서 거제 같은 장거리 이동이 서울 경유 직선처럼 보이거나, 경로 검증 완료 상태가 실제보다 과장된다.

## Questions

1. 장거리 구간의 실제 polyline이 없을 때 선을 표시할지?
2. 대중교통 탑승/하차 지점은 숙소/목적지 기준인지, 실제 역/터미널 기준인지?
3. 환승역까지 모두 표시할지?

## Answers

1. 실제 polyline이 없는 장거리 구간은 선을 표시하지 않는다.
2. 실제 버스역, 기차역, 지하철역 같은 대중교통 승하차 지점을 표시한다.
3. 이번 범위에서는 장거리 구간의 첫 탑승역과 최종 하차역만 표시한다. 환승역 전체 표시는 제외한다.

## Score

- 현재 불명확성 점수: `0.14`
- 목표 임계값: `Standard 0.20`
- 점수 근거: 선 표시 금지, 탑승/하차 지점 의미, 노출 범위가 확정되었다.
- 다음에 낮춰야 할 불확실성: ODsay 응답에서 장거리 첫 탑승역/최종 하차역을 안정적으로 추출하는 필드 매핑.

## Confirmed

- 지도에는 장거리 첫 탑승역과 최종 하차역 마커를 표시한다.
- 타임라인에는 탑승/하차 이벤트를 표시한다.
- 장거리 본선 geometry가 없으면 partial route를 `경로 체크 완료`로 오인 표시하지 않는다.
- ODsay가 실제 polyline을 준 구간만 선으로 표시한다.

## Open Questions

- ODsay 장거리 subPath에서 `startName`, `endName`, `startX`, `startY`, `endX`, `endY`가 없는 케이스의 fallback 문구가 필요하다.
- 탑승역/하차역 마커 스타일은 구현 화면에서 최종 확인해야 한다.

## References

- [Linear GUI-157](https://linear.app/guideme/issue/GUI-157/planme-%EC%A2%8C%ED%91%9C-%EB%B3%B4%EC%9E%A5-%EB%B0%8F-%EB%8C%80%EC%A4%91%EA%B5%90%ED%86%B5-%ED%91%9C%EC%8B%9C-%EA%B0%9C%EC%84%A0) - 확정 요구사항
- `apps/web/components/itinerary/ItineraryDashboard.tsx` - ODsay route 계산과 timeline/map 표시
- `scripts/check-planme-actions.mjs` - 장거리 boundary fallback 방지 검사
