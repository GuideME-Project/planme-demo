# WP0 선행 조사 결과

## 결론

현재 승인된 비동기 설계는 GPT App MCP에서는 JSON-RPC 요청 식별자를 사용할 수 있지만 GPTs Actions에서 동일 호출 재시도를 식별할 안정 토큰을 확보하지 못했다. ChatGPT가 14일 일정의 모든 `advance`를 사용자 응답 없이 반복한다는 공식 호출 한도도 확인되지 않았다.

두 항목은 합의 리뷰가 정한 구현 중단 조건이어서 설계 보완 전까지 WP1 이후 코드 구현을 시작하지 않았다.

2026-07-14 사용자 승인으로 GPTs는 필수 기술 `invocationId`와 42초 내부 예산의 단일 동기 실행을 사용하고, GPT App은 처리 중 위젯이 사용자 동작 없이 MCP 상태 도구를 자동 호출하는 보완안을 채택했다. 이에 따라 기존 중단 조건은 해소되어 WP1부터 Goal 실행을 재개한다.

## 확인한 근거

### GPT App MCP

- 현재 `@modelcontextprotocol/sdk` 버전은 `1.29.0`, `@modelcontextprotocol/ext-apps`는 `1.7.4`다.
- MCP SDK `ToolCallback`은 두 번째 인자로 `RequestHandlerExtra`를 받고 `requestId`를 노출한다.
- ext-apps `registerAppTool`은 SDK `ToolCallback`을 그대로 전달한다.
- 현재 `apps/mcp/src/planme-mcp.ts`의 callback은 두 번째 인자를 아직 사용하지 않지만 코드 변경으로 받을 수 있다.
- MCP 명세에서 request ID는 한 JSON-RPC request를 식별하며 같은 session에서 새 request에 재사용할 수 없다.

판단: 같은 MCP protocol request의 전송·응답 상관관계에는 `requestId`를 사용할 수 있다. 모델이 새 tool call을 만든 경우에는 새 ID이므로 별도 호출이다.

### GPTs Actions

- 현재 `apps/mcp/api/gpt/itineraries/recommend.ts`는 Node `IncomingMessage`를 `gpts-actions-api.ts`에 넘기며 안정 invocation ID를 요구하거나 생성하지 않는다.
- 현재 OpenAPI request body에도 비사용자 기술 요청 ID가 없다.
- OpenAI GPT Actions 운영 문서는 API 호출의 45초 round-trip timeout을 명시한다.
- 확인한 공식 GPT Actions 문서에는 호출 재시도에 재사용되는 request ID 또는 idempotency header 계약이 없다.

판단: V3-07의 “같은 도구 재시도는 같은 itinerary ID”를 GPTs Actions에서 서버가 현재 계약만으로 판별할 수 없다. Vercel request ID처럼 각 HTTP 요청마다 바뀌는 값은 이 목적에 사용할 수 없다.

### 자동 연속 처리

- Apps SDK는 tool 결과의 output schema가 후속 tool call 추론에 쓰인다고 설명하고 위젯의 `callTool`도 제공한다.
- GPT Actions 문서는 ChatGPT가 적절할 때 action을 자동 사용한다고 설명하지만, 한 사용자 turn에서 같은 workflow를 몇 번 연속 호출하는지 보장하지 않는다.
- 현재 설계는 한 `advance`가 한 phase 또는 한 route batch만 실행한다.
- 14일 일정에서 route batch를 일차·변형 단위로만 나눠도 Standard·CarryME에 최대 28번의 route advance가 필요할 수 있고, 기준점·후보·배열·일정·활성화 phase 호출이 추가된다.

판단: 사용자 추가 행동 없이 완료된다는 요구를 현재 문서·로컬 handler만으로 입증할 수 없다.

### 공식 비동기 대안 확인

- OpenAI 개발자 문서에서 ChatGPT Apps가 MCP Tasks extension을 자동 polling해 최종 위젯을 갱신한다는 공개 계약을 확인하지 못했다.
- GPT Actions 문서에서도 HTTP 202 작업을 ChatGPT가 백그라운드에서 추적하거나 API가 현재 대화에 결과를 push하는 callback 계약을 확인하지 못했다.
- Responses API의 background mode는 PlanME 웹 서버가 Luna 선택 요청을 비동기로 실행하는 기능일 뿐, GPT Actions 호출 자체의 45초 제한이나 현재 ChatGPT 대화로 결과를 전달하는 문제를 해결하지 않는다.

판단: MCP Tasks, GPT Actions async callback, Responses background mode 중 어느 것도 현재 승인된 두 채널의 완료 전달 계약을 근거 있게 대체하지 못한다.

## 추가로 확인한 위험

- GPT Actions timeout은 45초인데 현재 MCP Vercel recommendation 함수는 `maxDuration=60`이다. GPT Actions 경로는 Vercel 제한보다 먼저 ChatGPT에서 끊길 수 있다.
- 후보 선택 후 일정 계산이 route 수를 줄이더라도 일차·변형 수에 대한 자동 tool-call 보장은 생기지 않는다.
- 입력 hash나 짧은 시간창으로 dedupe하면 독립적인 동일 요청과 네트워크 재시도를 구분하지 못하므로 합의된 새 요청·새 ID 정책을 위반한다.
- 모델이 기술 UUID를 생성하도록 schema에 넣는 방법은 구현 가능성이 있지만 “멱등성 키는 모델 입력이 아니다”라는 승인된 계약을 바꾸므로 임의 적용할 수 없다.

## 승인된 설계 보완

다음 계약으로 확정했다.

- GPTs Actions request body에 사용자에게 묻지 않는 필수 기술 `invocationId`를 추가한다.
- 같은 사용자 생성 요청의 전송 재시도에는 같은 값을, 새 생성 요청에는 새 값을 사용한다.
- GPTs는 ChatGPT 연속 Action 호출에 의존하지 않고 45초 제한보다 짧은 42초 내부 예산 안에 ready 또는 terminal failed를 반환한다.
- GPT App은 processing 위젯을 허용하고 위젯이 `window.openai.callTool`로 MCP 상태 도구를 자동 호출한다.
- 처리 중 위젯과 GPTs 모두 부분 일정이나 미확정 성공 링크를 표시하지 않는다.

남은 검증 리스크는 14일 mock 일정이 42초 안에 완료되는지와 실제 ChatGPT 호스트에서 처리 중 위젯 자동 호출이 동작하는지다. 구현·모의 검증은 진행하되 해당 채널 게이트가 실패하면 완료로 승인하지 않는다.

## References

- [OpenAI GPT Actions production timeouts](https://developers.openai.com/api/docs/actions/production#timeouts)
- [OpenAI Apps SDK reference](https://developers.openai.com/apps-sdk/reference)
- [OpenAI Apps SDK MCP server guide](https://developers.openai.com/apps-sdk/build/mcp-server)
- [OpenAI GPT Actions getting started](https://developers.openai.com/api/docs/actions/getting-started)
- [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [MCP JSON-RPC request IDs](https://modelcontextprotocol.io/specification/2025-11-25/basic)
- [MCP TypeScript SDK v1.29.0](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.29.0)
- [MCP ext-apps v1.7.4](https://github.com/modelcontextprotocol/ext-apps/tree/v1.7.4)
