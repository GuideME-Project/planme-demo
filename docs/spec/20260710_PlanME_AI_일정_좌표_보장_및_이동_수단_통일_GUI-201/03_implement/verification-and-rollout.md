# 검증 및 rollout 계획

## 결론

구현 완료 판정은 정적 문자열 확인이 아니라 `모의 공급자 계약 → Core·MCP·Web build → 웹 자동화 → 실제 MCP 생성 → Edge 또는 앱 내 브라우저 지도 확인`으로 증명한다.
실제 외부 호출은 모의 테스트가 모두 통과하고 예상 호출 범위를 확인한 뒤에만 실행한다.

실제 완료 시나리오는 `동탄 → 경주월드 → 동탄, 1박 2일, 자동차`다.
대중교통은 전체 이동 수단 계약과 공급자 내부 도보 구간을 mock으로만 확인하고 실제 ODsay 호출은 하지 않는다.

## 검증 단계 요약

| 단계 | 목적 | 외부 호출 | 완료 조건 |
| --- | --- | --- | --- |
| A. baseline | 기존 실패와 신규 회귀 분리 | 없음 | 현재 명령 결과 기록 |
| B. Core·MCP 계약 | DTO·anchor·AI 함수·2회 대체 확인 | mock | 모든 assertion 통과 |
| C. build·typecheck | 패키지 경계와 Next build 확인 | 없음 | exit code 0 |
| D. 웹 자동화 | 검색·mode·버튼·부분 실패 확인 | mock | 대상 spec 통과 |
| E. 실제 MCP smoke | 네이버 장소·OpenAI·상세 링크 확인 | 있음 | ready 링크와 좌표 hard gate |
| F. 실제 지도 | 선택 날짜 두 자동차 경로 확인 | 있음 | 두 실제 도로 경로선 |

## A. 구현 전 baseline

### 환경 확인

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git status --short
```

기록할 내용:

- 현재 worktree 절대 경로
- detached HEAD 여부
- 사용자 변경과 문서 변경
- Node·npm은 저장소 lockfile과 기존 실행 환경을 사용
- `node_modules`, `dist`는 검색하지 않음

### 런타임 파일 준비

현재 worktree에 런타임 파일이 없으면 원본 체크아웃에서 gitignored 파일을 민감값 출력 없이 복사한다.
값이 아니라 다음 이름 그룹의 설정 유무만 확인한다.

- `OPENAI_API_KEY`
- `NAVER_MAPS_CLIENT_ID` 또는 `NCP_MAPS_CLIENT_ID`
- `NAVER_MAPS_CLIENT_SECRET` 또는 `NCP_MAPS_CLIENT_SECRET`
- `NEXT_PUBLIC_NAVER_MAPS_CLIENT_ID`
- `NEXT_PUBLIC_ODSAY_API_KEY`
- `PLANME_WEB_ORIGIN`
- 상세 일정 저장소 연결값

사용자 확정에 따라 네이버 지역 검색도 원본의 `NAVER_MAPS_CLIENT_ID`, `NAVER_MAPS_CLIENT_SECRET` 변수명을 사용한다.
실제 키가 지역 검색 API 권한을 갖지 않으면 401·403이 발생할 수 있으므로 실제 승인 검증에서 확인한다.
문서와 로그에 값을 출력하지 않는다.

### baseline 명령

```bash
npm run test:actions
npm run test:mcp
npm --workspace @planme/core run build
npm --workspace @planme/mcp run typecheck
npm --workspace @planme/web run build
```

lint·format 실행은 별도 승인 없이는 수행하지 않는다.
baseline 실패는 명령, exit code, 새 변경 전 재현 여부를 기록한다.

## B. Core·MCP 모의 계약 검증

주 검증 파일은 `apps/mcp/scripts/check-planme-mcp.ts`다.
실제 API 대신 주입한 `fetchImpl`, 장소 검색기, AI 생성기, 후보 판단기를 사용한다.

### 1. 이동 수단 준비 질문

테스트 후보:

```ts
assert.equal(
  assessment.questions.find((question) => question.slot === "transportMode")?.text,
  "일정 안내는 자동차와 대중교통만 지원합니다. 어떤 이동 수단으로 안내할까요?",
);
assert.deepEqual(
  assessment.questions.find((question) => question.slot === "transportMode")?.examples,
  ["자동차", "대중교통"],
);
```

케이스:

- mode 누락: `needs_input`
- `drive`: 재질문 없음
- `transit`: 재질문 없음
- `walk`: schema 거부
- 빈 문자열·null: 명시적으로 허용하지 않음
- 숙소·취향보다 이동 수단 질문 우선

### 2. MCP·REST·OpenAPI 일치

- 준비 request의 이동 수단은 optional
- 추천 request의 이동 수단은 required
- `NormalizedPlanningInput.transportMode`는 response required, value nullable
- 질문 slot과 missing slot enum에 이동 수단 포함
- 추천 destination이 POI를 허용하는 설명
- `origin` 또는 `arrivalAirport` 조건
- 일정 응답에 top-level 이동 수단 포함
- 사용자 enum에 `walk` 없음

REST handler에 다음 요청을 직접 보낸다.

- 올바른 `drive` 요청: 200
- 이동 수단 누락: 400, 외부 호출 0회
- `walk`: 400, 외부 호출 0회
- 잘못된 JSON: 400
- GET으로 추천 호출: 405

### 3. 네이버 지역 검색 계약

mock request에서 확인한다.

- URL host가 `openapi.naver.com`
- path가 `/v1/search/local.json`
- method가 GET
- `query` 존재
- `display`가 1~5
- client id·secret header 이름 존재
- 인증값이 응답·로그에 복사되지 않음

mock response에서 확인한다.

- `<b>경주월드</b>`가 `경주월드`로 정규화
- `roadAddress` 우선, 없으면 `address`
- `mapx=1292240315`가 경도 `129.2240315`
- `mapy=358355864`가 위도 `35.8355864`
- 숫자가 아니거나 범위 밖 좌표 제외
- 최대 5개 후보
- `candidateId`, `sourceRef` 빈 값 없음
- Google `placeId` 생성 안 함

### 4. 필수 장소 선검증

mock 검색 호출을 기록해 다음을 확인한다.

- 출발지 query는 `동탄`
- 목적지 query는 `경주월드`
- 출발지 query에 `경주`를 자동 prefix하지 않음
- 동탄 주소 좌표 후보와 경주월드 지역 검색 후보 선택 가능
- 하나라도 실패하면 OpenAI generator 호출 0회
- 실패 응답은 더 정확한 장소명·주소 질문
- 필수 장소 실패가 AI 중간 장소 제외로 처리되지 않음

### 5. AI 함수 호출

OpenAI request body에서 확인한다.

- 함수 이름은 `search_naver_places` 하나
- `strict: true`
- `additionalProperties: false`
- nullable 선택 필드도 required 목록에 포함
- 후보 수 최댓값 5
- center·radius·nearby tool 없음
- prompt에 anchor와 전체 이동 수단 포함

함수 호출 응답 흐름에서 확인한다.

- `function_call`의 `call_id`가 같은 `function_call_output`에 사용됨
- 함수 결과 후보만 AI에 반환
- 인증값·공급자 원본 응답 미포함
- AI가 함수 결과 밖 좌표를 써도 최종 저장에서 거부

### 6. 필수 장소 주입

- AI가 출발지 좌표를 바꿔도 동탄 anchor로 덮어씀
- AI가 경주월드 좌표를 바꿔도 목적지 anchor로 덮어씀
- Standard·CarryME에 경주월드 존재
- 마지막 날짜 복귀지가 동탄 anchor
- 목적지 누락 시 교정 요청 1회
- 교정 후 누락 시 link 저장 0회

### 7. 중간 장소 최대 2회 대체

각 stop별 독립 케이스:

1. 직접 검색 성공: 대체 호출 0회
2. 직접 실패·첫 대체 성공
3. 직접 실패·첫 대체 실패·두 번째 성공
4. 직접 실패·대체 2회 실패: stop 제외
5. 두 stop이 각각 2회 실패: 각자 2회 기회 보장
6. 공급자 5xx 한 번 재시도: AI 대체 횟수 증가 없음

제외 후 확인:

- Standard·CarryME stop에 원래 장소 없음
- timeline title·description에 원래 장소 없음
- route text에 원래 장소 없음
- 사용자 응답에 내부 실패 질문 없음
- resolution log에 attempt와 `excluded`
- 출발지·목적지만 남아도 ready 가능

### 8. 이동 수단 정규화

- AI가 mode를 생략해도 코드가 전체 mode 주입
- AI fixture가 혼합 mode를 주더라도 모두 전체 mode로 덮어씀
- Standard·CarryME·legacy stops 모두 동일 mode
- `PlanmeItinerary.transportMode`와 stop mode 일치
- 내부 ODsay walk segment는 유지

### 9. 최종 hard gate와 저장

- 좌표 없음: 중간 stop 제외 또는 필수 장소 실패
- source 없음: 저장 실패
- sourceRef 없음: 저장 실패
- NaN·범위 밖 좌표: 저장 실패
- 사용자 목적지 없음: 저장 실패
- 출발·복귀 anchor 불일치: 저장 실패
- 이동 수단 없음: 저장 실패
- gate 통과 전 `persistItineraryForDetailPage` 호출 0회
- gate 통과 후 한 번만 호출

## C. 정적 계약·build·typecheck

### 정적 계약

`scripts/check-planme-actions.mjs`에서 확인한다.

- Google autocomplete route 파일 없음
- Google details route 파일 없음
- `search_places_nearby` 없음
- 오사카 중심 좌표 없음
- `createStandardEquivalentComputedRoute` 없음
- 사용자용 walk selector 없음
- 신규 `/api/places/search` route 존재

정적 검사는 동작 테스트를 대신하지 않고 삭제 회귀를 빠르게 찾는 용도다.

### 실행 명령

```bash
npm run test:actions
npm run test:mcp
npm --workspace @planme/core run build
npm --workspace @planme/mcp run typecheck
npm --workspace @planme/web run build
```

각 명령의 시작·종료 시간, exit code, 실패 메시지의 핵심 원인을 구현 후 `test-log.md` 또는 작업 성격에 맞는 테스트 로그 파일에 기록한다.
현재 계획 단계에서는 테스트 로그 파일을 미리 만들지 않는다.

## D. 웹 자동화 검증

저장소 기존 자동화 spec을 모의 공급자 회귀 테스트로 사용한다.

```bash
npx playwright test apps/web/e2e/destination-editor-recorded-flow.spec.ts --project=chromium
```

이 명령은 자동화 회귀 테스트다.
최종 사용자 화면 확인은 Playwright 결과로 대체하지 않고 Edge 또는 앱 내 브라우저에서 수행한다.

### 장소 검색

- 1자 입력: `/api/places/search` 호출 0회
- 연속 입력: 300ms 뒤 마지막 query 한 번
- 새 입력: 이전 요청 abort
- request method POST, body `query`
- 후보 클릭: 상세 API 호출 0회
- 선택 직후 좌표·source·sourceRef 보존
- 다시 입력: 이전 좌표·ID·source·sourceRef 제거
- 미선택 상태 버튼: provider route 호출 0회, `장소를 선택해 주세요`

### 이동 수단

- 전체 selector 1개
- 자동차·대중교통만 존재
- segment selector 0개
- mode 변경 후 Directions·ODsay 호출 0회
- 날짜 변경에도 선택값 유지
- 다른 날짜의 이전 mode 경로를 성공 경로로 표시하지 않음

### 선택 날짜 두 경로

- 버튼 한 번으로 현재 날짜 요청 2개
- 다른 날짜 요청 0개
- Standard·CarryME 요청 mode 동일
- 자동차면 두 요청이 네이버 Directions 경로
- 대중교통이면 두 요청이 ODsay adapter 경로
- 내부 ODsay walk segment는 유지

### 부분 실패

| Standard | CarryME | 기대 결과 |
| --- | --- | --- |
| 성공 | 성공 | 두 실제 경로선과 두 성공 상태 |
| 성공 | 실패 | Standard만 경로선, CarryME 실패 문구 |
| 실패 | 성공 | CarryME만 경로선, Standard 실패 문구 |
| 실패 | 실패 | 두 실패 문구, 경로선 없음 |

모든 실패 케이스에서 확인한다.

- 다른 route 결과 복제 없음
- stop 직선 fallback 없음
- 실패 route의 이전 mode path 없음
- `경로를 확인하지 못했습니다` 표시

## E. 실제 외부 API smoke

### 실행 전 승인 gate

다음이 모두 충족돼야 한다.

- B·C·D 단계 통과
- 필요한 runtime 파일 준비
- 현재 worktree MCP·Web 실행 확인
- 오래된 `8787` listener 정리 또는 다른 임시 포트 사용
- 외부 호출 종류와 예상 범위 보고
- 실제 호출 승인

### 예상 호출 범위 산정

정확한 수는 AI가 만든 중간 장소 수를 `N`이라고 두고 실행 직전에 계산한다.

- 필수 장소: 네이버 지역 검색 최대 2회 + 필요 시 주소 좌표 변환 최대 2회
- OpenAI: 최초 일정 생성 1회 이상 + 도구 응답 loop + 필요 시 목적지 교정 1회
- 중간 장소: 장소당 직접 검색 1회 + 대체 검색 최대 2회
- 자동차 경로: 선택 날짜 Standard·CarryME 각 1회 이상
- ODsay: 실제 호출 0회

네이버 지역 검색 공식 최대 후보 수 5와 하루 호출 한도를 문서·콘솔에서 다시 확인한다.
실제 호출 script는 고정된 과소 추정치를 출력하지 않고 이번 입력에서 계산 가능한 상한과 동적 요소를 분리해 보여준다.

### smoke script 변경

`apps/mcp/scripts/check-planme-external-smoke.ts`를 다음 기준으로 바꾼다.

- Google Places 예상량·인증 확인 제거
- NAVER Developers 지역 검색 인증 그룹 확인 추가
- 실제 ODsay key와 호출 필수 조건 제거
- 입력을 동탄·경주월드·2일·자동차로 변경
- `transportMode: "drive"` 필수
- clarification 자동 답변으로 중간 장소를 사용자에게 묻지 않음
- ready 응답의 모든 stop coordinate·sourceRef 검사
- 경주월드 포함·동탄 복귀 검사
- page URL 접근 확인

실행 예시:

```bash
npm run smoke:external -- --confirm-external-api
```

환경변수 confirmation 방식은 기존 `PLANME_CONFIRM_EXTERNAL_API_SMOKE=1`도 유지할 수 있다.

### 실제 MCP 입력

```json
{
  "destination": "경주월드",
  "origin": "동탄",
  "durationDays": 2,
  "transportMode": "drive",
  "travelerCount": 2,
  "luggageCount": 0,
  "preferences": []
}
```

### MCP 완료 assertion

- 응답 `status`가 ready
- usable `pageUrl` 존재
- `itinerary.transportMode === "drive"`
- 모든 Standard·CarryME stop mode가 drive
- 모든 최종 stop coordinate·source·sourceRef 존재
- Standard·CarryME에 경주월드 존재
- 첫 출발·마지막 복귀가 동탄 anchor
- `unresolvedStops` 없음
- 필수 장소 clarification 없음
- 상세 링크 저장과 페이지 GET 성공

## F. Edge 또는 앱 내 브라우저 확인

### 실행 환경

- 로컬 Web URL과 생성된 상세 링크를 기록한다.
- Microsoft Edge 또는 앱 내 브라우저를 사용한다.
- 확인한 날짜 탭과 이동 수단을 기록한다.
- 화면 캡처가 필요하면 민감한 URL query와 키가 보이지 않는지 확인한다.

### 첫 화면

- 일정 전체 이동 수단이 자동차
- 이동 수단 selector 하나
- 사용자용 도보 없음
- segment별 selector 없음
- 경주월드와 동탄 복귀가 표시됨
- 좌표 없는 장소 표시 없음

### 장소 편집

1. 중간 장소 이름을 입력한다.
2. 네이버 후보가 나타나는지 확인한다.
3. 후보를 선택한다.
4. 좌표가 확정된 상태인지 확인한다.
5. 후보 선택 전에는 버튼이 provider를 호출하지 않는지 확인한다.

### 경로 재계산

1. 현재 날짜에서 자동차를 선택한다.
2. 변경만으로 route 호출이 없는지 확인한다.
3. `경로 다시 계산`을 누른다.
4. 현재 날짜의 Standard·CarryME만 계산되는지 확인한다.
5. 두 시간·거리 결과가 독립 표시되는지 확인한다.
6. 두 경로선이 네이버 실제 도로 형상을 따르는지 확인한다.
7. 다른 날짜가 자동 일괄 계산되지 않는지 확인한다.

실제 경로선 판정:

- 단순 stop 직선이 아니다.
- 네이버 Directions path 좌표를 사용한다.
- Standard와 CarryME 행선지 순서 차이가 경로 형상에 반영된다.
- map toggle이 각 route를 별도로 숨기고 보인다.

## 대중교통 mock 검증

실제 ODsay 호출 없이 다음을 확인한다.

- `transit`이 MCP·저장·웹에 유지된다.
- 선택 날짜 두 route가 ODsay adapter를 선택한다.
- 접근·환승·하차 walk segment가 유지된다.
- 내부 walk가 전체 이동 수단을 바꾸지 않는다.
- partial geometry는 실제 segment·marker만 표시한다.
- 본선 좌표가 없을 때 직선으로 연결하지 않는다.
- 429·5xx mock이 route별 실패 상태로 변환된다.

## 완료 기준

- 모든 자동 계약 테스트와 build가 통과한다.
- 신규 일정 경로에서 Google 장소 API와 nearby 함수 호출이 0회다.
- 이동 수단 누락·지원하지 않는 값이 외부 호출 전에 거부된다.
- `동탄 → 경주월드 → 동탄, 1박 2일, 자동차`가 ready 상세 링크를 만든다.
- 모든 최종 장소에 좌표·source·sourceRef가 있다.
- 경주월드가 Standard·CarryME에 포함된다.
- 복귀지가 동탄 anchor다.
- 현재 날짜의 Standard·CarryME가 같은 자동차 mode로 각각 계산된다.
- 지도에 두 실제 네이버 도로 경로선이 표시된다.
- 부분 실패 시 성공 경로만 남고 실패 경로는 문구만 표시된다.
- 사용자용 도보·segment별 mode·Google 장소 검색 UI가 없다.

## 중단 조건

- 모의 테스트·build 실패 상태에서 실제 API 호출이 필요해진다.
- 실제 인증값을 출력해야만 문제를 진단할 수 있다.
- `NAVER_MAPS_CLIENT_ID`, `NAVER_MAPS_CLIENT_SECRET`으로 네이버 지역 검색 인증이 실패한다.
- 필수 장소가 좌표 없이 ready가 된다.
- AI 내부 중간 장소 실패가 사용자 clarification으로 나온다.
- 전체 이동 수단 변경 즉시 route API를 호출한다.
- 다른 날짜까지 버튼 한 번으로 자동 계산한다.
- 한쪽 실패를 다른 경로나 직선으로 숨긴다.
- 실제 ODsay 호출이 완료 조건에 포함된다.

## 구현 후 문서 갱신

구현이 완료된 뒤에만 결과와 로그 문서를 추가한다.

- 구현 결과 문서: 실제 변경 파일, 설계 대비 차이, 남은 작업
- 테스트 로그 문서: 명령, exit code, 실패·재시도, 실제 API 사용 범위
- 화면 확인 기록: URL, 날짜 탭, 이동 수단, Standard·CarryME 결과

계획 단계에서는 통과하지 않은 결과를 미리 작성하지 않는다.
