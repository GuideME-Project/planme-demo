# PlanME Custom GPT Actions Demo

## 목적

Custom GPT가 PlanME API를 호출한 뒤 짧은 안내 문구와 상세 일정 링크를 반환하는 흐름을 검증합니다.

## 테스트 경로

- 데모 홈: `/`
- 상세 일정: `/itinerary/osaka-2d1n`
- Actions API: `/api/plan`
- OpenAPI schema: `/api/openapi`
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
