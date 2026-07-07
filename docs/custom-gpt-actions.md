# PlanME Custom GPT Actions Demo

## 목적

PlanME 일정 생성은 MCP 도구에서만 수행하고, Next.js 웹은 저장된 일정 상세 화면과 조회/공유 API만 제공하는 흐름을 검증합니다.

## 역할 분리

- 일정 생성(MCP `recommend_planme_itinerary`): 사용자 조건을 받아 서버 내부 OpenAI 호출로 일정 초안을 생성하고, 웹 저장 API에 저장한 뒤 상세 일정 URL을 반환합니다.
- 일정 조회(Web `GET /api/gpt/itineraries/{itineraryId}`): 저장됐거나 고정 데모로 제공되는 일정을 조회합니다.
- 일정 공유(Web `POST /api/gpt/itineraries/{itineraryId}/share`): 기존 일정의 상세 URL과 보조 미리보기 메타데이터를 반환합니다.
- 일정 렌더링(Web `/itinerary/{itineraryId}`): 저장된 generated 일정 또는 고정 데모 일정을 상세 화면으로 보여줍니다.

## 테스트 경로

- 데모 홈: `/`
- 고정 상세 일정: `/itinerary/busan-bts-1d1n`
- 저장된 generated 상세 일정: `/itinerary/generated-...`
- Itinerary lookup API: `/api/gpt/itineraries/{itineraryId}`
- Share API: `/api/gpt/itineraries/{itineraryId}/share`
- Read-only OpenAPI schema: `/api/gpt/openapi`
- Legacy OpenAPI schema: `/api/openapi`
- OpenGraph image: `/og`
- Itinerary preview image: `/og/itinerary/{itineraryId}.png`

## 생성 API 제거 정책

다음 웹 생성 API는 데모 웹에서 제공하지 않습니다.

- GPT 일정 추천 API(`POST /api/gpt/itineraries/recommend`): route 파일을 두지 않습니다.
- Legacy 계획 생성 API(`POST /api/plan`): GET 데모 조회만 남기고 POST 생성기를 두지 않습니다.

웹 OpenAPI 스키마에도 위 생성 operation을 노출하지 않습니다. Custom GPT에서 일정을 생성해야 할 때는 MCP 도구(`recommend_planme_itinerary`)를 사용해야 합니다.

## 저장 정책

MCP가 생성한 일정은 웹 저장 API(`POST /api/gpt/itineraries/preview-store`)에 먼저 저장되어야 합니다. 운영 환경에서는 Upstash Redis 환경변수가 없거나 저장에 실패하면 메모리 fallback으로 성공 처리하지 않습니다.

저장소에 없는 generated 상세 일정 ID(`/itinerary/generated-...`)는 고정 데모 일정으로 fallback하지 않고 404로 처리합니다.

## Custom GPT 응답 방향

```text
PlanME 일정이 준비됐습니다.
CarryME를 사용하면 짐은 목적지로 이동하고 여행자는 바로 일정으로 이동할 수 있어요.

[상세 일정 열기](https://planme-demo.vercel.app/itinerary/generated-...)
```

ChatGPT Builder 미리보기에서는 외부 Markdown 이미지가 안정적으로 인라인 렌더링되지 않습니다. 기본 응답은 짧은 요약과 상세 일정 링크를 우선합니다. `previewMarkdown`과 `ogImageUrl`은 이미지 미리보기를 지원하는 클라이언트나 별도 테스트용 보조 메타데이터로만 사용합니다.

## 검증 기준

- 웹 생성 API route와 POST 생성기가 존재하지 않습니다.
- 웹 OpenAPI 스키마는 생성 operation을 노출하지 않습니다.
- MCP 도구 목록에는 `recommend_planme_itinerary`, `get_planme_itinerary`, `start_planme_planning`만 생성/조회 핵심 도구로 남습니다.
- ChatGPT 초안 렌더링 도구(`preview_planme_itinerary`, `update_planme_itinerary_preview`, `commit_planme_itinerary`)는 노출하지 않습니다.
- MCP 저장 실패 시 상세 일정 URL을 성공 응답처럼 반환하지 않습니다.
