# MCP 계약 설계

## 결론

MCP 응답은 Function Calling 기반 장소 검증 결과를 기준으로 성공 일정과 사용자 확인 필요 상태를 분리한다. 모든 장소가 AI 판단과 hard gate를 통과한 경우에만 `pageUrl`과 상세 itinerary를 반환한다. `ambiguous`, `rejected`, 후보 없음, hard gate 실패가 남아 있으면 링크와 위젯 없이 `needs_clarification`을 반환한다.

`PLANME_WEB_ORIGIN`은 pageUrl뿐 아니라 preview 저장 호출, widget CSP, redirect metadata에도 동일하게 반영한다.

## 이유

- 좌표 없는 상세 링크를 생성하면 ChatGPT, 웹페이지, 지도 계산이 서로 다른 상태를 보게 된다.
- 장소 검증 결과가 MCP structured content에 없으면 ChatGPT가 사용자에게 어떤 의도를 다시 물어봐야 하는지 알 수 없다.
- 로컬/운영 분리를 pageUrl에만 적용하면 widget 클라이언트가 metadata enforcement에서 localhost 링크를 막을 수 있다.

## 응답 상태

```ts
type PlanmeMcpStatus = "ready" | "needs_clarification";

type PlanmeClarification = {
  status: "needs_clarification";
  message: string;
  unresolvedStops: string[];
  questions: string[];
  clarificationContext: PlanmeClarificationContext;
  validationIssues: string[];
};

type PlanmeReadySummary = {
  status: "ready";
  itineraryId: string;
  title: string;
  summary: string;
  pageUrl: string;
  detailUrl?: string;
  validationIssues?: string[];
};

type PlanmeClarificationContext = {
  round: number;
  originalRequest?: RecommendItineraryRequest;
  unresolvedPlaces: string[];
  previousQuestions: string[];
  previousAnswers: string[];
};
```

기존 클라이언트 호환이 필요하면 `status`는 optional로 시작하되, 신규 테스트는 반드시 `ready` 또는 `needs_clarification`을 확인한다.

## Clarification 처리

Function Calling 기반 장소 검증에서 unresolved stop이 남으면 다음을 수행한다.

1. preview store 저장을 호출하지 않는다.
2. `createRecommendedItineraryResponse`로 pageUrl을 만들지 않는다.
3. widget resource를 응답하지 않는다.
4. MCP tool result의 `structuredContent`에 `needs_clarification` 정보를 넣는다.
5. text content에는 ChatGPT가 사용자에게 물어볼 질문을 자연스럽게 담는다.

예:

```json
{
  "status": "needs_clarification",
  "message": "일부 장소 후보가 사용자 의도와 맞는지 확인이 필요합니다.",
  "unresolvedStops": ["거제도 바다 낚시터"],
  "questions": ["바다낚시터는 방파제 낚시와 유료 낚시공원 중 어느 쪽을 원하시나요?"],
  "clarificationContext": {
    "round": 1,
    "unresolvedPlaces": ["거제도 바다 낚시터"],
    "previousQuestions": ["바다낚시터는 방파제 낚시와 유료 낚시공원 중 어느 쪽을 원하시나요?"],
    "previousAnswers": []
  },
  "validationIssues": ["거제도 바다 낚시터 후보가 ambiguous로 판정됨"]
}
```

## Clarification 재호출

사용자가 답변하면 ChatGPT는 다음 `recommend_planme_itinerary` 호출에 `clarificationContext`와 사용자 답변을 함께 넘긴다. 서버는 기존 후보만 재평가하지 않고, 답변을 포함해 Google/Naver 검색을 다시 실행한다.

규칙:

- 되묻기는 최대 2라운드이다.
- 라운드 상태는 MCP 요청의 `clarificationContext`로 이어간다.
- `originalRequest`는 다음 MCP 요청의 일반 입력 필드와 중복되면 생략할 수 있다.
- 서버는 별도 세션 저장소를 만들지 않고 Redis/Upstash에는 일별 호출량 카운터만 저장한다.
- 2라운드 후에도 애매하면 마지막 검색 1회 후 내부 AI가 최후 확정할 수 있다.
- 마지막 검색 후보가 없거나 hard gate를 통과하지 못하면 상세 링크를 만들지 않는다.

## Origin 처리

`PLANME_WEB_ORIGIN`은 lazy helper로 읽고 normalize한다.

```ts
function getPlanmeWebOrigin(): string {
  const raw = process.env.PLANME_WEB_ORIGIN?.trim() || PLANME_WEB_ORIGIN;
  return new URL(raw).origin;
}

function buildPlanmeWebUrl(path: string): string {
  return new URL(path, `${getPlanmeWebOrigin()}/`).toString();
}
```

적용 대상:

- PlanME core link generation request URL: `/mcp`
- preview store handoff URL: `/api/preview-itineraries`
- MCP widget `_meta["openai/widgetCSP"]`
- legacy widget `redirect_domains`
- Google Places referer header

## Widget Metadata

widget metadata는 module load 시점 상수 대신 요청 처리 시점 또는 resource 등록 시점에 helper로 생성한다. 운영 fallback은 기존 `https://planme-demo.vercel.app`을 유지하되, env override가 있으면 metadata에도 같은 origin을 포함한다.

## 리스크

- `new URL(raw)`는 invalid origin에서 예외를 던진다. MCP 시작 시 명확한 설정 오류로 드러나게 해야 한다.
- 기존 GPT Action 응답 소비자가 `status` 필드를 모를 수 있다. ready 상태의 기존 필드는 유지한다.
- clarification 상태를 error로 던지면 클라이언트가 대화형 질문 대신 실패로 표시할 수 있다. tool result는 정상 응답이되 status로 구분하는 편이 안전하다.
- `clarificationContext`가 누락되면 라운드 추적이 약해질 수 있다. 이 경우 서버는 새 요청으로 처리하되, hard gate는 동일하게 적용한다.

## 검증 연결

- `ambiguous` 또는 `rejected`이면 링크와 위젯 없이 clarification 응답
- 후보 없음 또는 hard gate 실패 시 링크 생성 금지
- clarification 질문은 최대 2개
- `clarificationContext` 라운드 최대 2회
- `PLANME_WEB_ORIGIN`이 저장/링크/widget metadata에 모두 반영
- `PLANME_WEB_ORIGIN` trailing slash normalize
- Google Places referer가 web origin 기준으로 전달됨
