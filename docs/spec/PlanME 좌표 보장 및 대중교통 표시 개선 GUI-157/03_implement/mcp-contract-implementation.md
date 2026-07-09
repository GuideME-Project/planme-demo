# MCP 계약 구현 계획

## 결론

MCP는 Function Calling 기반 장소 검증 결과를 `structuredContent.status`로 분리한다. 성공 상태만 pageUrl과 widget metadata를 포함한다. `ambiguous`, `rejected`, 후보 없음, hard gate 실패는 링크와 위젯 없이 `needs_clarification`으로 반환한다.

`PLANME_WEB_ORIGIN`은 pageUrl, preview store, Google referer, widget CSP, redirect metadata에 모두 적용한다.

## 변경 파일 후보

| 파일 | 작업 |
| --- | --- |
| `apps/mcp/src/planme-mcp.ts` | input schema, output schema, summary 변환, widget metadata, origin helper |
| `apps/mcp/scripts/check-planme-mcp.ts` | ready/clarification/origin/clarificationContext 테스트 |
| `packages/planme-core/src/gpt-actions.ts` | core response에 clarification 상태와 context 반환 |

## 구현 순서

1. `recommend_planme_itinerary` 입력에 optional `clarificationContext`를 추가한다.
2. 사용자 답변 입력은 `clarificationAnswers?: string[]`로 추가한다. 단일 답변만 들어오면 배열 1개로 normalize한다.
3. `itinerarySummarySchema`를 ready와 `needs_clarification` 분기로 유지하되, clarification 필드를 새 계약으로 갱신한다.
4. `questions`를 최대 2개로 제한한다.
5. `clarificationContext.round`를 최대 2로 제한한다.
6. `needs_clarification` 상태에서는 preview store 저장을 호출하지 않는다.
7. `needs_clarification` 상태에서는 pageUrl과 widget metadata를 반환하지 않는다.
8. ready 상태에서는 기존 pageUrl, itinerary summary, metadata 호환 필드를 유지한다.
9. `getPlanmeWebOrigin`과 `buildPlanmeWebUrl` helper를 모든 URL 생성 위치에 적용한다.
10. widget metadata 생성은 module load 시점 상수 대신 helper 기반으로 정리한다.

## Output schema 후보

후보:

```ts
const itinerarySummarySchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    itineraryId: z.string(),
    title: z.string(),
    summary: z.string(),
    pageUrl: z.string(),
    validationIssues: z.array(z.string()).optional(),
  }),
  z.object({
    status: z.literal("needs_clarification"),
    message: z.string(),
    unresolvedStops: z.array(z.string()),
    questions: z.array(z.string()).max(2),
    clarificationContext: clarificationContextSchema,
    validationIssues: z.array(z.string()),
  }),
]);
```

## clarificationContext 후보

후보:

```ts
type PlanmeClarificationContext = {
  round: number;
  originalRequest?: RecommendItineraryRequest;
  unresolvedPlaces: string[];
  previousQuestions: string[];
  previousAnswers: string[];
};
```

규칙:

- 서버 세션 저장소에 라운드 상태를 저장하지 않는다.
- ChatGPT가 다음 호출에 context를 넘긴다.
- ChatGPT가 사용자 답변을 넘길 때는 `clarificationAnswers`를 사용한다.
- context가 누락되면 새 요청으로 처리하되 hard gate는 유지한다.
- Redis/Upstash에는 일별 호출량 카운터만 저장한다.

## Origin helper 후보

후보:

```ts
function getPlanmeWebOrigin(): string {
  const raw = process.env.PLANME_WEB_ORIGIN?.trim() || PLANME_WEB_ORIGIN;
  return new URL(raw).origin;
}

function buildPlanmeWebUrl(path: string): string {
  return new URL(path, `${getPlanmeWebOrigin()}/`).toString();
}
```

## 테스트 계획

- `PLANME_WEB_ORIGIN=http://localhost:3000`일 때 pageUrl이 localhost
- preview store URL도 localhost
- widget `_meta.ui.csp`에 localhost 포함
- legacy `redirect_domains`에 localhost 포함
- trailing slash가 있어도 origin이 정상화됨
- `needs_clarification`에서는 pageUrl 없음
- `needs_clarification`에서는 widget metadata 없음
- questions는 최대 2개
- `clarificationContext.round`가 2를 넘지 않음
- `clarificationAnswers` 단일/복수 입력이 모두 배열로 normalize됨

## 중단 조건

- output schema 변경으로 기존 MCP 테스트가 전체 파손되면 compatibility path를 추가한다.
- ChatGPT client가 `needs_clarification` 정상 응답을 실패처럼 표시하면 text content fallback 문구를 보강한다.
