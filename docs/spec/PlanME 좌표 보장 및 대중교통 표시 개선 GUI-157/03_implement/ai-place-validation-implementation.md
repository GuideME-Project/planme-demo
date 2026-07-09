# AI 장소 후보 검증 구현 계획

## 결론

AI 장소 후보 검증은 `packages/planme-core`의 OpenAI 호출 계층에서 구현한다. 모델은 장소 검색 tool 호출을 요청하고, 서버는 Google/Naver 검색 결과를 후보 목록으로 반환한다. 이후 모델이 후보를 판단하고, 서버는 hard gate를 적용해 ready 또는 `needs_clarification`으로 분기한다.

## 현재 코드 상태

- `openai-itinerary-generator.ts`는 Responses API에 `json_schema` structured output만 보내고 있다.
- `place-candidates.ts`는 Google Places Text/Nearby 검색을 수행하지만 단일 후보를 반환한다.
- `gpt-actions.ts`는 draft 생성 후 좌표 없는 stop에 대해 후보 검색을 수행하고, 후보가 있으면 stop을 교체한다.
- 현재 구조는 Function Calling 중심이 아니라 서버 후처리 중심이다.
- `apps/mcp/scripts/check-planme-mcp.ts`에는 단일 후보 반환과 자동 대체를 성공으로 보는 테스트가 남아 있다.

## 변경 파일 후보

| 파일 | 작업 |
| --- | --- |
| `packages/planme-core/src/openai-itinerary-generator.ts` | Responses API tool loop 추가, tool call/result 처리, 판단 structured output 추가 |
| `packages/planme-core/src/place-candidates.ts` | `search_places_text`, `search_places_nearby`에 맞는 후보 목록 검색 함수 추가 |
| `packages/planme-core/src/gpt-actions.ts` | 초안 생성/후보 검증/clarification 분기 연결 |
| `packages/planme-core/src/index.ts` | 신규 타입 export |
| `apps/mcp/scripts/check-planme-mcp.ts` | OpenAI tool call mock 테스트 추가 |

## 구현 순서

1. 기존 자동 대체 흐름을 깨는 mock 테스트를 먼저 작성한다.
2. `PlanmePlaceCandidate`, `PlaceCandidateDecision`, `PlanmeClarificationContext` 타입을 core에 정의한다.
3. `search_places_text`, `search_places_nearby` tool schema를 정의한다.
4. OpenAI Responses API 요청에 tools를 추가한다.
5. 모델이 tool call을 반환하면 PlanME 서버가 해당 함수를 실행한다.
6. tool result를 OpenAI에 다시 전달해 초안 또는 후보 판단을 받는다.
7. tool call/result 흐름은 실제 API 호출 전에 fetch mock으로 먼저 고정한다.
8. tool call이 누락되거나 잘못된 인자를 반환하면 OpenAI 요청을 1회 재시도한다.
9. 재시도 후에도 후보를 확보하지 못하면 hard gate 실패로 처리한다.
10. 후보 판단 결과가 `accepted`이면 hard gate를 수행한다.
11. 후보 판단 결과가 `ambiguous` 또는 `rejected`이면 질문 최대 2개와 `clarificationContext`를 반환한다.
12. 최대 2라운드 후 마지막 검색 1회를 실행하고, 후보가 있을 때만 내부 AI 최후 확정을 허용한다.

## Tool Schema 후보

예시:

```ts
const searchPlacesTextTool = {
  type: "function",
  name: "search_places_text",
  description: "사용자 일정 의도와 지역 맥락으로 장소 후보를 검색한다.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: { type: "string" },
      region: { type: "string" },
      userIntent: { type: "string" },
      maxCandidates: { type: "number" },
    },
  },
};
```

예시:

```ts
const searchPlacesNearbyTool = {
  type: "function",
  name: "search_places_nearby",
  description: "기준 좌표 주변의 장소 후보를 검색한다.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["center", "radiusMeters"],
    properties: {
      center: {
        type: "object",
        additionalProperties: false,
        required: ["lat", "lng"],
        properties: {
          lat: { type: "number" },
          lng: { type: "number" },
        },
      },
      query: { type: "string" },
      radiusMeters: { type: "number" },
      maxCandidates: { type: "number" },
    },
  },
};
```

## 후보 판단 DTO

예시:

```ts
type PlaceCandidateDecision = {
  status: "accepted" | "ambiguous" | "rejected";
  originalPlaceName: string;
  selectedCandidateId?: string;
  reason: string;
  questions?: string[];
  feedbackNeeded?: boolean;
  feedbackMessage?: string;
};
```

검증 규칙:

- `accepted`는 `selectedCandidateId`가 필요하다.
- `ambiguous`와 `rejected`는 `questions` 최대 2개까지만 허용한다.
- `feedbackMessage`는 ChatGPT 대화에만 노출한다.

## 실패 처리

- OpenAI tool call 누락: OpenAI 요청 1회 재시도
- tool call 인자 파싱 실패: OpenAI 요청 1회 재시도
- Google/Naver 후보 없음: hard gate 실패
- 후보는 있으나 좌표 없음: hard gate 실패
- 후보는 있으나 `placeId` 또는 검색 출처 없음: hard gate 실패
- hard gate 실패: pageUrl, widget, preview 저장 금지

## 테스트 계획

- OpenAI mock이 `search_places_text` tool call을 반환하면 서버 검색 함수가 호출됨
- tool result를 다시 모델에 넘긴 뒤 `accepted` 판단을 처리함
- tool call 누락 시 1회 재시도함
- 재시도 후 후보 없으면 기존 1순위 자동 대체를 사용하지 않음
- 기존 `replacementLogs`, `suggestedQueries`, 단일 `candidate` 성공 전제가 테스트에서 제거됨
- `ambiguous` 판단이면 questions 최대 2개와 `clarificationContext`를 반환함
- 2라운드 후 마지막 검색 후보가 없으면 최후 확정하지 않음

## 중단 조건

- OpenAI Responses API tool call payload 구조가 현재 구현 예상과 다르면 설계를 갱신한다.
- 기존 structured output schema와 tool loop를 한 요청에서 안정적으로 처리하기 어렵다면, 초안 생성 요청과 후보 검증 요청을 분리하는 대안을 사용자에게 보고한다.
