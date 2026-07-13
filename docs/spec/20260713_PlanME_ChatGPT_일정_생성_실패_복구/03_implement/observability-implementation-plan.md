# ChatGPT 일정 생성 관측성 구현계획

## 결론

- 구현 방향: 맞춤형 GPT 요청과 GPT 앱 MCP 요청에 임의 추적 식별자를 부여하고, MCP에서 웹 상세 저장까지 같은 값으로 연결한다. 응답 본문은 기록하지 않고 크기와 안전한 오류 분류만 구조 로그로 남긴다.
- 완료 조건: 맞춤형 GPT의 성공 응답 크기와 GPT 앱 상세 저장 422의 제공자·실패 단계·내부 오류 코드를 운영 로그에서 추적 식별자로 조회할 수 있어야 한다.
- 주요 리스크: 오류 객체를 일반 오류로 다시 감싸는 현재 흐름에서 제공자 코드가 사라질 수 있으며, 로그에 사용자 위치나 일정 본문이 유입되면 안 된다.

## 근거

- 설계 문서: [관측·배포·검증 설계](../02_design/observability-rollout-validation.md)
- 관련 코드: 맞춤형 GPT Actions API, MCP 일정 저장 연결, 웹 상세 저장 API, 경로 최종화 모듈
- 미확인 자료: 기존 운영 로그에는 422의 하위 오류 코드가 없어 과거 실패의 정확한 제공자 원인은 확인할 수 없다.

## 범위

### 포함

- 맞춤형 GPT 요청별 추적 식별자 생성
- GPT 앱 일정 생성 요청별 추적 식별자 생성
- MCP에서 웹 상세 저장 API로 추적 식별자 전달
- 맞춤형 GPT 성공 응답의 UTF-8 JSON 바이트 수 기록
- 웹 상세 저장 API의 단계별 안전한 오류 기록
- 경로 제공자 오류의 제공자·내부 코드·일차·경로 종류·재시도 여부 보존
- MCP와 최종화 자동 테스트 보강

## 작업 순서

1. 공통 추적 식별자와 안전한 로그 필드 계약을 MCP·웹 경계에 추가한다.
2. MCP의 웹 상세 저장 요청에 추적 헤더를 전달하고 실패 응답의 안전한 오류 코드만 읽는다.
3. 맞춤형 GPT 성공 응답을 직렬화하기 직전에 바이트 수를 계산해 기록한다.
4. 경로 최종화에서 제공자 오류 컨텍스트가 사라지지 않도록 안전한 오류 타입 또는 결과 컨텍스트를 보강한다.
5. 웹 상세 저장 API에서 좌표 확인, 경로 제공자, 저장 단계 오류를 구조 로그로 기록한다.
6. MCP와 웹 최종화 테스트에 로그 필드·추적 헤더·민감정보 미포함 검증을 추가한다.
7. 승인된 자동 테스트와 타입 검증을 실행하고 결과를 기록한다.

## 변경 파일 후보

| 파일 | 변경 목적 | 주의점 |
| --- | --- | --- |
| `apps/mcp/src/gpts-actions-api.ts` | 맞춤형 GPT 추적 식별자와 응답 바이트 수 기록 | 응답 본문과 입력값 로그 금지 |
| `apps/mcp/src/planme-mcp.ts` | GPT 앱 추적 식별자 생성, 웹 저장 헤더 전달, 안전한 하위 오류 코드 보존 | 내부 인증값 로그 금지 |
| `apps/web/app/api/gpt/itineraries/preview-store/route.ts` | 추적 헤더 수신과 단계별 구조 로그 | 일정 객체 로그 금지 |
| `apps/web/lib/itinerary-route-finalizer.ts` | 제공자 오류의 일차·경로 종류 컨텍스트 보존 | 외부 오류 원문 기록 금지 |
| `apps/web/lib/route-providers/types.ts` | 필요 시 안전한 제공자 식별자 타입 보강 | 외부 오류 원문 저장 금지 |
| `apps/mcp/scripts/check-planme-mcp.ts` | 추적 헤더, 응답 크기 로그, 하위 오류 코드 검증 | 실제 외부 API 호출 금지 |
| `apps/web/scripts/check-itinerary-finalization.ts` | 제공자 실패 로그 컨텍스트 검증 | 실제 외부 API 호출 금지 |

## API와 로그 계획

업무 의미(웹 상세 저장 API, `POST /api/gpt/itineraries/preview-store`):

- 요청 헤더: 추적 식별자(`X-PlanME-Trace-Id`) 선택값
- 헤더가 없거나 유효하지 않으면 웹 서버가 새 UUID를 생성한다.

후보 로그 타입 예시:

```ts
type PlanmeFailureLog = {
  event: string;
  traceId: string;
  stage: "gpts_response" | "preview_handoff" | "coordinate_resolution" | "route_provider" | "preview_store";
  provider?: "naver" | "odsay";
  failureCode?: string;
  dayIndex?: number;
  routeId?: "standard" | "carryme";
  retried?: boolean;
  responseBytes?: number;
  statusCode?: number;
};
```

예시는 전달용이며 구현 시 기존 오류 타입과 테스트 패턴에 맞춘다.

## 추적 식별자 처리

- 추적 식별자는 관측용이며 인증·락·수정 번호 비교에 사용하지 않는다.
- 같은 MCP → 웹 저장 시도는 같은 추적 식별자를 사용한다.
- 사용자가 새 일정 요청을 시작하면 새 추적 식별자를 생성한다.

## 민감정보 차단

로그 금지 항목:

- 출발지, 목적지, 장소명
- 위도·경도, 지도 경로
- 일정 제목·요약·시간표·요청 본문
- 외부 API URL과 응답 원문
- OpenAI·네이버·ODsay 키
- 내부 API 인증값과 환경변수

응답 크기는 직렬화한 JSON의 UTF-8 바이트 수만 기록한다.

## 검증 계획

### 자동 테스트

- `npm run test:finalization`
- `npm run test:mcp`
- `npm run test:actions`
- `npm --workspace @planme/mcp run typecheck`
- `npm --workspace @planme/web exec tsc -- --noEmit`
- `git diff --check`

린트와 포맷 명령은 별도 승인 없이 실행하지 않는다.

### 테스트 단언

- MCP 웹 저장 요청에 유효한 추적 식별자 헤더가 존재한다.
- 맞춤형 GPT 성공 응답 로그에 양수인 응답 바이트 수가 존재한다.
- 제공자 실패 로그에 제공자, 일차, 경로 종류, 내부 오류 코드가 존재한다.
- 로그에 테스트용 장소명, 좌표, 토큰 문자열이 포함되지 않는다.

### 운영 검증

GitHub PR 병합 자동 배포 후 다음 두 사례를 맞춤형 GPT와 GPT 앱에서 각각 실행한다.

1. 강동역 → 남해, 1박 2일, 대중교통
2. 동탄호수공원 → 부산, 1박 2일, 자동차

맞춤형 GPT에서는 응답 바이트 수와 HTTP 상태를 확인한다. GPT 앱에서는 MCP와 웹 로그를 추적 식별자로 연결해 상세 저장 실패의 단계와 내부 오류 코드를 확인한다.

## 배포와 롤백

- 배포: 기준 브랜치 `main` 대상 GitHub PR 병합 후 Vercel 자동 배포
- 금지: Vercel MCP·CLI 직접 배포
- 롤백 조건: 정상 요청 실패 증가, 로그 예외로 응답 실패, 민감정보 노출 가능성 발견
- 롤백 방법: 로그 변경을 되돌리는 후속 PR 병합
- 데이터 롤백: 저장 포맷을 바꾸지 않으므로 없음

## 중단 조건

- 로그에 사용자 입력이나 좌표를 넣어야만 진단 가능한 설계가 필요한 경우
- 실제 외부 API 비용을 발생시키는 테스트가 필요한 경우

위 조건이 발생하면 구현을 멈추고 별도 범위 승인을 받는다.
