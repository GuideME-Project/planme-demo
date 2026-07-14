# 채널과 웹 전환 구현계획

## 결론

GPTs Actions와 GPT App MCP는 현재 도구 이름을 유지하되 웹 오케스트레이터를 호출하는 얇은 어댑터로 바꾼다. GPTs는 단일 Action에서 42초 예산으로 terminal 상태까지 실행하고, GPT App은 처리 중 위젯이 상태 도구를 자동 호출한다. 웹은 active revision을 표시하고 contentId 기반 편집만 전송하며 브라우저에서 경로 공급자를 호출하지 않는다.

## 근거

- 설계: [채널과 웹 연동](../02_design/channel-and-web-integration.md)
- 현재 MCP: `apps/mcp/src/planme-mcp.ts`, `apps/mcp/src/gpts-actions-api.ts`, `apps/mcp/api/gpt/itineraries/recommend.ts`
- 현재 웹: `apps/web/components/itinerary/ItineraryDashboard.tsx`, `apps/web/app/api/places/search/route.ts`, `apps/web/app/api/gpt/itineraries/[itineraryId]/routes/finalize/route.ts`
- 현재 위험: MCP가 OpenAI 생성과 clarification을 수행하고 브라우저가 `/routes/finalize`와 `/api/places/search`를 호출한다.

## GPT 질문 정책 전환

질문 가능한 업무 슬롯은 다음 네 개뿐이다.

```ts
type RequiredPlanningSlot =
  | "origin"
  | "destination"
  | "transportMode"
  | "durationDays";
```

- planning schema, tool input, tool description, 오류 문구의 질문 가능 항목을 같이 바꾼다.
- 숙소·선호·여행 날짜·인원·짐·도착시각·특정 장소는 먼저 묻지 않는다.
- 자발적으로 받은 선택 필드는 start 요청에 전달할 수 있다.
- 좌표 확인 실패 시 origin 또는 destination만 다시 요청한다.
- TourAPI 후보 부족, AI 실패, 경로 실패는 질문으로 바꾸지 않는다.

## GPTs Actions 계획

### 유지할 공개 동작

| 경로 | operationId | V3 동작 |
| --- | --- | --- |
| `POST /api/gpt/planning/start` | 기존 planning operation | 네 필수 슬롯만 평가 |
| `POST /api/gpt/itineraries/recommend` | `recommendPlanmeItinerary` | invocationId로 start 후 42초 run, ready/failed |
| `GET /api/gpt/itineraries/{id}` | 조회 operation | 웹 read-only status 프록시 |

변경 파일 후보:

- `apps/mcp/src/gpts-actions-api.ts`
- `apps/mcp/api/gpt/planning/start.ts`
- `apps/mcp/api/gpt/itineraries/recommend.ts`
- `apps/mcp/api/gpt/itineraries/[itineraryId]/index.ts` 또는 Vercel이 지원하는 동등한 조회 entrypoint
- `apps/mcp/api/gpt/openapi.ts`
- `apps/mcp/vercel.json`

동적 Vercel 함수 파일 구조는 현재 배포 방식에서 실제 route가 생성되는지 build 결과로 확인한다. 확인 없이 경로 이름을 확정하지 않는다.

### OpenAPI 요청·응답

- recommend body에 사용자에게 묻지 않는 필수 기술 필드 `invocationId`를 둔다.
- GPT 지침은 한 사용자 생성 요청마다 새 식별자를 만들고 동일 Action 재전송에는 같은 값을 재사용하도록 한다.
- recommend는 웹 start 뒤 내부 run을 호출해 42초 안에 ready 또는 failed를 반환한다.
- processing과 공개 advance operation을 생성 완료 흐름에 사용하지 않는다.
- ready일 때만 page URL과 제외 장소 안내를 최종 응답에 사용한다.

## GPT App MCP 계획

### `start_planme_planning`

- 입력 schema에서 허용 네 슬롯만 required 판단에 사용한다.
- 선택 입력이 없어도 ready가 된다.
- 반환 questions에 허용되지 않은 slot이 있으면 계약 테스트가 실패한다.

### `recommend_planme_itinerary`

- 직접 `createAiRecommendedItineraryResponse`를 호출하지 않는다.
- `PLANME_WEB_ORIGIN`의 내부 start API를 내부 토큰으로 호출한다.
- processing structured content와 처리 중 위젯 리소스를 반환한다.
- 처리 중 위젯은 사용자 응답 없이 `window.openai.callTool`로 `get_planme_itinerary`를 호출한다.

### `get_planme_itinerary`

- processing이면 내부 advance를 한 번 호출한 뒤 상태를 반환한다.
- processing에는 처리 중 위젯 `_meta`를 붙이고 `retryAfterMs` 이후 같은 일정 ID로 자동 호출한다.
- ready일 때 active display DTO로 위젯을 교체하고 자동 호출을 멈춘다.
- failed이면 안전 문구로 끝내며 추가 장소·숙소 질문을 요구하지 않는다.
- 자동 호출에는 최대 횟수와 전체 경과시간 상한을 두고, 초과 시 위젯에서 실패를 표시한다.

### 제거·격리할 현재 경로

- MCP의 V3 OpenAI 생성 호출
- MCP에서 전체 itinerary를 `/preview-store`로 보내는 handoff
- 네이버 장소 clarification과 replacement query
- AI가 만든 days·timeline·hotelName 입력
- V3 경로에서 MCP가 읽는 `OPENAI_API_KEY`

기존 V2 함수가 다른 테스트나 데모에 남더라도 V3 tool·GPTs route에서 import하지 못하도록 금지 경계 검사를 둔다.

## MCP 내부 웹 클라이언트

후보:

```ts
type PlanmeWebClient = {
  start(input: StartItineraryRequest, idempotencyKey: string): Promise<ItineraryJobResponse>;
  runUntilTerminal(itineraryId: string, deadlineEpochMs: number): Promise<ItineraryJobResponse>;
  advance(itineraryId: string): Promise<ItineraryJobResponse>;
  getStatus(itineraryId: string): Promise<ItineraryJobResponse>;
};
```

- 모든 요청에 bounded timeout과 내부 인증 헤더를 사용한다.
- 웹의 safe error response를 채널 DTO로 전달하고 provider 원문을 만들지 않는다.
- 같은 도구 호출 재시도에서 같은 멱등성 키를 재사용한다.
- GPTs 멱등성 키는 OpenAPI 필수 기술 필드 `invocationId`, MCP 멱등성 키는 SDK의 JSON-RPC 요청 ID로 제한한다. 입력 해시나 시간창으로 대체하지 않는다.
- GPTs와 MCP가 별도 DTO 변환기를 만들지 않고 core의 표시 DTO를 공유한다.

## 웹 상세 계획

변경 파일 후보:

- `apps/web/app/itinerary/[id]/page.tsx`와 실제 상세 로더
- `apps/web/components/itinerary/ItineraryDashboard.tsx`
- V3 표시 DTO를 기존 UI props로 바꾸는 얇은 adapter
- `apps/web/app/api/gpt/itineraries/[itineraryId]/route.ts`

상태별 화면:

| 상태 | 화면 |
| --- | --- |
| processing, active 없음 | 생성 중; 장소·경로·절약 수치 미표시 |
| ready | active revision만 표시 |
| edit processing | 기존 active 표시 + 변경 계산 중 |
| edit failed | 기존 active 유지 + 안전 오류 안내 |
| generation failed | 실패 안내; 추가 입력 질문 없음 |

`estimated_walk`는 예상 배지와 duration을 표시하되 geometry가 없으므로 지도 경로선을 그리지 않는다.

## 웹 장소 검색과 편집

### 장소 검색

현재 `/api/places/search`는 TourAPI 검색 계약으로 교체한다.

요청:

- itinerary ID
- active revision
- 검색어
- 필요 시 허용 content type

응답:

- `contentId`
- TourAPI 공식 title
- address
- coordinate
- contentTypeId

서버는 active 목적지 지역 안의 후보만 반환한다. 브라우저가 작성한 이름·좌표를 저장하지 않는다.

### 편집 명령

```ts
type ItineraryEditCommand = {
  baseRevision: number;
  operations: Array<
    | { type: "replace_visit"; day: number; fromContentId: string; toContentId: string }
    | { type: "remove_visit"; day: number; contentId: string }
    | { type: "add_visit"; day: number; contentId: string; position: number }
    | { type: "replace_lodging"; contentId: string }
    | { type: "reorder_visits"; day: number; contentIds: string[] }
    | { type: "change_transport"; transportMode: "drive" | "transit" }
  >;
};
```

- null은 허용하지 않는다.
- contentId는 active 지역의 TourAPI 후보인지 서버에서 재검증한다.
- 일차 수 변경과 여러 숙소는 거부한다.
- 성공 전까지 브라우저 로컬 상태를 canonical 일정으로 취급하지 않는다.

## 브라우저 경로 제거

현재 `ItineraryDashboard.tsx`의 다음 책임을 제거한다.

- `NEXT_PUBLIC_ODSAY_API_KEY` 읽기
- ODsay 외부 origin 호출
- `/api/naver/directions/routes` 호출
- `/routes/finalize` 호출로 저장 일정 변경
- 화면에서 계산한 경로를 canonical 데이터로 병합

서버의 `/api/naver/directions/routes`와 `/routes/finalize`가 다른 데모에서 사용 중이면 무조건 삭제하지 않고 V3 브라우저 import·fetch 경로만 제거한다. deprecated 범위가 확인되면 별도 승인 없이 수정하지 않는다.

## 채널별 제외 안내

| 채널 | 처리 |
| --- | --- |
| GPTs ready 응답 | 제외 장소가 있으면 안내 |
| GPT App ready 위젯 | 제외 장소가 있으면 안내 |
| 웹 상세 | 제외 안내를 렌더링하지 않음 |

표시 문구는 TourAPI에서 확인되지 않아 제외됐다는 사실만 말하고 대체했다고 표현하지 않는다.

## 검증 계획

- OpenAPI schema에서 질문 slot, 필수 invocationId, 42초 동기 ready/failed 계약을 검사한다.
- MCP tool descriptor와 실행 fixture에서 processing 위젯 자동 호출과 terminal 정지를 검사한다.
- 같은 fixture로 GPTs와 MCP가 같은 revision·display DTO를 반환하는지 검사한다.
- Playwright request 감시로 `api.odsay.com`, 네이버 Directions, `/routes/finalize` 호출이 0건인지 검사한다.
- 웹 ready·edit processing·edit failed·estimated walk 상태를 화면에서 검사한다.
- GPT 결과에는 제외 안내가 있고 웹에는 없는지 검사한다.

## 리스크와 완화

- GPTs가 42초 안에 14일 일정을 끝내지 못하면 부분 결과 없이 failed가 된다. mock 성능 테스트와 공급자 timeout 예산으로 완료 가능성을 검증한다.
- GPT App 자동 호출이 호스트 제한으로 중단되면 processing이 남을 수 있다. 위젯 호출 상한과 작업 TTL을 두고 사용자 입력 없이 실패를 표시한다.
- 공개 도구 이름은 같지만 응답 계약이 바뀐다. OpenAPI와 MCP 계약 테스트를 같은 작업 묶음에서 갱신한다.
- 큰 `ItineraryDashboard.tsx` 수정은 회귀 범위가 넓다. V3 adapter와 상태 hook을 먼저 분리하고 표시 컴포넌트 변경을 최소화한다.
- 기존 V2 코드가 남아 V3에 다시 import될 수 있다. 금지 import·문자열 검사를 보조 게이트로 둔다.
