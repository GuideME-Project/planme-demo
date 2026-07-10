# PlanME AI 일정 좌표 보장 및 이동 수단 통일 인터뷰

## 문서 목록

- [좌표 보장과 AI 행선지 교체](./coordinate-resolution.md)
- [네이버 단일 장소 검색](./naver-place-search.md)
- [일정 전체 이동 수단](./transport-mode.md)
- [웹 경로 재계산과 오류 표시](./web-route-recalculation.md)
- [완료 검증과 범위](./validation-and-scope.md)

## 주제별 불명확성 점수

- 목표와 성공 기준: `0.08`
- 좌표 보장과 AI 행선지 교체: `0.10`
- 네이버 단일 장소 검색: `0.10`
- 일정 전체 이동 수단: `0.28`
- 웹 경로 재계산과 오류 표시: `0.10`
- 완료 검증과 범위: `0.10`
- 기존 링크와 데이터 제외: `0.05`

## 확정 요약

- 새로 생성하는 일정은 네이버 지역 검색만 사용해 장소와 좌표를 확인한다.
- 출발지와 사용자 지정 목적지는 반드시 일정에 포함하고 좌표를 보장한다.
- 좌표가 없는 AI 생성 중간 행선지는 같은 지역, 일정 주제, 장소 종류를 우선해 최대 2회 자동 교체한다.
- 두 번 모두 실패한 중간 행선지는 일정에서 제외하고 생성을 계속한다.
- 출발지 또는 사용자 지정 목적지를 확인하지 못하면 임의로 바꾸지 않고 정확한 장소명이나 주소를 다시 묻는다.
- 사용자가 복귀지를 별도로 지정하지 않으면 출발지를 복귀지로 사용한다.
- 일정 안내는 자동차와 대중교통만 지원하고, 한 일정의 모든 대표 경로에는 선택한 이동 수단 하나를 적용한다.
- 웹에서는 일정 전체 이동 수단 하나만 변경할 수 있고, 사용자가 경로 재계산 버튼을 눌렀을 때 기본 경로(Standard)와 CarryME 경로를 함께 다시 계산한다.
- 사용자에게는 좌표가 확인된 최종 일정만 보여주며 AI의 중간 교체·제외 과정은 노출하지 않는다.

## 미결정사항

- `자차`, `렌터카`, `택시`, `버스`, `지하철`, `기차`, `KTX` 같은 자연어 표현을 자동차 또는 대중교통으로 자동 분류하는 구체 범위는 설계 단계에서 확정해야 한다.

## 관련 링크

- Linear: [GUI-201 AI로 일정 생성 시 행선지/목적지 좌표 누락 발생](https://linear.app/guideme/issue/GUI-201/ai%EB%A1%9C-%EC%9D%BC%EC%A0%95-%EC%83%9D%EC%84%B1-%EC%8B%9C-%ED%96%89%EC%84%A0%EC%A7%80%EB%AA%A9%EC%A0%81%EC%A7%80-%EC%A2%8C%ED%91%9C-%EB%88%84%EB%9D%BD-%EB%B0%9C%EC%83%9D)
- [네이버 지역 검색 API](https://developers.naver.com/docs/serviceapi/search/local/local.md)
- [네이버 지도 주소 좌표 변환 API](https://api.ncloud-docs.com/docs/ai-naver-mapsgeocoding-geocode)
- `packages/planme-core/src/openai-itinerary-generator.ts` - AI 일정 생성과 장소 검색 함수 호출
- `packages/planme-core/src/place-candidates.ts` - 현재 Google Places 후보 검색
- `apps/web/components/itinerary/ItineraryDashboard.tsx` - 웹 행선지 편집과 경로 재계산

## 다음 설계 액션

- 네이버 지역 검색 결과를 공통 장소 후보와 검색 출처 식별값으로 변환하는 구조를 설계한다.
- 출발지·목적지 필수 보장과 중간 행선지 최대 2회 교체·제외 흐름을 설계한다.
- 일정 전체 이동 수단 입력과 자연어 정규화 기준을 설계한다.
- 웹의 행선지별 이동 수단을 전체 이동 수단 하나로 바꾸는 상태 구조를 설계한다.
- 실제 네이버 지역 검색과 자동차 길안내 검증을 모의 응답 테스트와 분리한다.
