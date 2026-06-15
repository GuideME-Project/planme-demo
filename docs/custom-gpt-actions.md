# PlanME Custom GPT Actions Demo

## 목적

Custom GPT가 PlanME API를 호출한 뒤 짧은 안내 문구와 상세 일정 링크를 반환하는 흐름을 검증합니다.

## 테스트 경로

- 데모 홈: `/`
- 상세 일정: `/itinerary/osaka-2d1n`
- Actions API: `/api/gpt/itineraries/recommend`
- Itinerary lookup API: `/api/gpt/itineraries/{itineraryId}`
- Share API: `/api/gpt/itineraries/{itineraryId}/share`
- OpenAPI schema: `/api/gpt/openapi`
- OpenGraph image: `/og`

## Custom GPT 응답 방향

```text
GuideME 스타일의 여정으로 안내할께요.
간단히 보면, 첫날은 간사이 공항 도착 후 바로 USJ로 이동하고,
CarryME를 사용하면 호텔에 들르지 않고 바로 관광할 수 있어요.

[플랜미로 상세 일정 보기](https://planme.guideme.app/itinerary/osaka-2d1n)
```

## 기술 판단

Custom GPT Actions는 링크 반환까지 안정적으로 검증합니다. ChatGPT 대화창 안의 큰 웹카드 노출은 보장하지 않고, OpenGraph는 가능한 클라이언트에서 미리보기 품질을 높이기 위한 보조 장치로 둡니다.

## 1차 Actions 설계

- `POST /api/gpt/itineraries/recommend`: GPT가 사용자 조건을 넘기면 PlanME 추천 일정과 상세 링크를 반환합니다.
- `GET /api/gpt/itineraries/{itineraryId}`: 후속 대화에서 기존 일정 상세를 다시 조회합니다.
- `POST /api/gpt/itineraries/{itineraryId}/share`: 사용자가 링크 공유를 요청할 때 상세 일정 URL을 반환합니다.

초기 기술 검증 단계에서는 GuideME API를 직접 호출하지 않고 mock 일정 데이터를 반환합니다. GuideME CarryME, RestME, Google Maps 연동은 이 Actions API 내부 구현으로 점진 연결합니다.
