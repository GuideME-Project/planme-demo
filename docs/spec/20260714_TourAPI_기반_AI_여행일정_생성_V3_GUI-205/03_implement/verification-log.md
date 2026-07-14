# 검증 로그

## 상태

- 실행일: 2026-07-14
- 단계: Goal WP0~WP7 구현·회귀 검증 완료
- 소스 코드 변경: V3 core, 웹 공급자·저장소·오케스트레이터·API·상세 화면, GPTs·MCP·위젯
- 외부 API smoke: 운영 GPT Action으로 시도했으나 TourAPI 환경 설정 누락으로 공급자 호출 전에 중단

## 환경 준비

첫 `npm run build`는 `tsc: command not found`로 실패했다. worktree에 프로젝트 의존성이 없어서 발생한 환경 실패이며 `npm ci`로 lockfile 기준 의존성을 설치했다.

`npm ci` 결과:

- 590 packages 설치
- moderate severity 2건 관측
- 범위 밖 breaking 자동수정인 `npm audit fix --force`는 실행하지 않음

## 변경 전 기준선

| 명령 | 결과 | 관측 |
| --- | --- | --- |
| `npm run build` | 통과 | core TypeScript와 Next.js production build 통과 |
| `npm run lint` | 통과 | 오류 0, 기존 경고 3 |
| `npm run test:actions` | 통과 | 현재 GPT Actions 계약 통과 |
| `npm run test:design` | 실패 | 서버 없이 실행 시 3009 connection refused; 서버 실행 후에도 `총 이동 시간(예상)` 문구 assertion 실패 |
| `npm run test:mcp` | 통과 | 현재 MCP 계약 통과 |
| `npm run test:finalization` | 통과 | Upstash 미설정으로 local memory 사용 |
| `npm run test:route-normalization` | 통과 | 현재 traveler route normalization 통과 |
| `npm --workspace @planme/mcp run typecheck` | 통과 | TypeScript 오류 없음 |

## 기존 lint 경고

`apps/web/components/itinerary/ItineraryDashboard.tsx`:

- 2275: `useEffect`의 `transportMode` dependency 누락
- 2298: `_uiId` 미사용
- 2902: `carrymeTimeline` 미사용

이 경고는 V3 소스 변경 전에 존재했고 현재 린트 exit code는 0이다.

## 기준선 판단

- `test:design` 실패는 V3 변경 전부터 재현되는 기존 failure다.
- 나머지 필수 기존 명령은 통과했다.
- WP0 채널 전제 중단 조건은 승인된 전달 계약 보완으로 해소됐다.

## WP1 공통 V3 계약

추가 범위:

- V3 입력·TourAPI 스냅샷·AI 선택·계획·revision·표시 계약
- TourAPI 허용 유형·좌표·행사 날짜·안정 정렬 정규화
- AI JSON 추가 필드·후보 밖 ID·유형·중복 strict 거부
- 결정적 후보 배열, 서버 체류·일차 시간 정책
- ODsay `-98`, 411~414, 700m, 일시 오류와 예상 도보 정책
- 2026-01-12 TourAPI 법정동 코드 전환(`lDongRegnCd`, `lDongSignguCd`) 반영

| 명령 | 결과 | 관측 |
| --- | --- | --- |
| `npm --workspace @planme/core run build` | 최초 실패 후 통과 | 신규 스케줄 방문 배열의 암시적 any를 `ScheduledVisit[]`로 명시해 해결 |
| `npm run test:v3` | 통과 | V3-01·03·04·05 core 정책 검사 통과 |
| `npm run test:route-normalization` | 통과 | 기존 V1/V2 route normalization 회귀 없음 |
| V3 신규 파일 `unknown`·`any` 검색 | 통과 | 신규 금지 타입 없음 |
| 문서 상대 링크 검사 | 통과 | 전체 spec 문서 링크 유효 |
| `git diff --check` | 통과 | 공백 오류 없음 |

WP1에서 외부 API와 Redis는 호출하지 않았다.

## WP2~WP6 구현 결과

- TourAPI `KorService2`·법정동 코드 기반 관광지·문화·행사·레포츠·숙박·쇼핑·음식점 조회와 유형별 캐시를 웹 서버에 구현했다.
- Luna는 `gpt-5.6-luna`, 낮은 추론 강도, strict JSON schema로 후보 ID만 선택한다. 동일 모델 1회 재시도 뒤 결정적 배열로 종료한다.
- 네이버 지오코딩·자동차 경로와 ODsay 대중교통·도보 경로는 서버에서만 호출한다.
- Redis 작업 meta, 단계 checkpoint, 잠금, 멱등성, pending/active/previous revision, 절대 만료시각을 구현했다.
- 한 routing advance는 신규 공급자 호출 4건에서 checkpoint를 저장하고 양보한다. 남은 마감시간과 요청 취소 신호는 공급자 호출에 전달한다.
- GPTs와 MCP 멱등 키는 `gpts:`·`mcp:` namespace로 분리하고 128자를 넘는 원본 ID는 채널별 SHA-256 키로 정규화한다.
- GPTs는 한 요청에서 42초 예산으로 terminal 결과를 만들고, GPT App 위젯은 processing 동안 자동으로 MCP 도구를 호출하다 ready·failed에서 멈춘다.
- 웹 편집 POST는 pending 생성 뒤 같은 서버 요청에서 42초 terminal 실행을 수행한다. 실패·충돌에서는 기존 active revision을 유지한다.
- 상세 화면은 TourAPI 숙소 교체, 방문 유지·순서 변경·일차별 추가, 이동수단 변경을 contentId만으로 전송한다.
- CarryME 수하물 이동 구간·인계·숙소 도착 이벤트와 부족 일자의 자유시간·숙소 휴식 블록을 별도 데이터로 저장·표시한다.

## 독립 회귀 감사와 보완

별도 읽기 전용 서브에이전트가 WP7을 두 차례 감사했다. 최초 감사에서 다음 고위험 이탈을 찾아 보완했다.

- 웹 편집 영구 processing: 편집 API의 terminal 실행 추가
- 한 요청 전체 routing: 4-call checkpoint batch와 최대 128단계 진행 추가
- timeout 뒤 공급자 호출 지속: AbortSignal 전달과 취소 테스트 추가
- 잠금 전 meta 사용: 잠금 획득 뒤 phase·revision·cursor 재검증, Redis lock owner CAS 추가
- 편집 정상 empty에서 active 후보 부활: 유형별 현재 조회 결과로 교체
- GPTs·MCP 멱등 namespace 충돌: 채널 namespace와 장문 ID hash 추가
- CarryME 수하물·0개 짐·빈 일차 누락: 별도 수하물 구간·이벤트와 idle block 추가
- ODsay 도보 408·429·5xx·network 재시도와 top-level 411~414 누락 보완
- Upstash Lua 키 위치 오류: savePhase lock key와 activate routing checkpoint key를 분리하고 정적 키 계약 검사 추가
- 위젯 terminal 뒤 stale processing 재호출: terminal latch와 Chromium 회귀 검사 추가

재감사 결과 남은 P1은 확인되지 않았다.

## 최종 V3 게이트

| ID | 결과 | 핵심 확인 |
| --- | --- | --- |
| V3-01 | 통과 | AI 후보 밖 ID·유형·중복 거부, 오케스트레이터 이중 검증 |
| V3-02 | 통과 | revision의 모든 장소 참조가 TourAPI snapshot에 존재 |
| V3-03 | 통과 | AI title·coordinate·time·description·추가 필드 거부 |
| V3-04 | 통과 | 사용자 질문 slot은 출발지·목적지·이동수단·기간만 허용 |
| V3-05 | 통과 | -98, 699·700·701m, 411~414, 3~6, -8·-9·-99, HTTP·network 보정 |
| V3-06 | 통과 | 편집 실패·충돌·정상 empty에서 active revision 불변 |
| V3-07 | 통과 | 새 요청 새 ID, replay, 다른 body 충돌, 동시 start, 채널 namespace |
| V3-08 | 통과 | GPTs·MCP가 같은 웹 작업·revision 계약 사용 |
| V3-09 | 통과 | V3 브라우저·MCP에 직접 공급자·finalize 경로 없음, 위젯 자동 진행 E2E |
| V3-10 | 통과 | fresh 24h, last-good 7d, 정상 empty, outage, 유형 격리 |

## 최종 실행 결과

| 명령 | 결과 | 관측 |
| --- | --- | --- |
| `npm run build` | 통과 | Next.js production build·TypeScript 통과 |
| `npm run lint` | 통과 | 오류 0, 변경 전부터 존재한 경고 3 |
| `npm --workspace @planme/mcp run typecheck` | 통과 | MCP TypeScript 오류 없음 |
| `npm run test:actions` | 통과 | GPT Actions OpenAPI·HTTP 계약 통과 |
| `npm run test:mcp` | 통과 | 기존 MCP 회귀와 V3 채널·위젯 resource 계약 통과 |
| `npm run test:finalization` | 통과 | 기존 V2 일정 확정 회귀 통과, 로컬 memory 사용 |
| `npm run test:route-normalization` | 통과 | 기존 traveler route 정규화 회귀 통과 |
| `npm run test:v3` | 통과 | V3-01~V3-10 집계 통과 |
| `npm run test:completion` | 통과 | GUI-157 장거리 partial 경로·탑승/하차 표시 회귀 통과 |
| `npm run test:local-v3` | 통과 | 웹·MCP 실제 HTTP 흐름, revision 1 ready 링크와 화면, 브라우저 공급자 요청 0건 |
| `npm run test:design` | 통과 | 현재 승인된 부산 데모 UI·경로 표시 계약 통과 |
| `PLANME_INTERNAL_API_TOKEN=playwright-local-token npx playwright test apps/web/e2e/planme-v3-widget.spec.ts` | 통과 | click 없이 callTool 실행, ready 뒤 재호출 중단 |
| `git diff --check` | 통과 | 공백 오류 없음 |

## 기존 실패와 환경 의존 E2E

- `npm run test:design`은 로컬 서버 실행 뒤에도 변경 전과 동일하게 `총 이동 시간(예상)` 문구 assertion으로 실패한다.
- 기존 Playwright 전체 14건은 10건 통과, 4건 실패였다. 세 건은 로컬 외부 경로 공급자 환경이 없어 V2 preview finalization이 실패했고, 한 건은 테스트 프로세스와 Next 서버 프로세스가 local memory를 공유하지 못해 실패했다. V3 변경 전부터 존재한 환경 의존 경로이며 V3 위젯 E2E는 별도로 통과했다.

## 미실행·잔여 리스크

- 실제 TourAPI·OpenAI·네이버·ODsay smoke는 비용·할당량과 별도 승인 범위이므로 실행하지 않았다.
- Upstash Lua는 memory 계약 테스트와 Lua 키 정적 검사만 통과했다. 실제 Redis의 `EVAL`·`EXAT`·`cjson` 동작은 미확인이다.
- 위젯 자동 진행은 Chromium의 모의 `window.openai` bridge에서 실행했다. 실제 ChatGPT host bridge는 미확인이다.
- 첫날 출발시각은 사용자 추가 질문 금지와 결정적 계산을 위해 서버 호환 기본값 09:30을 사용한다. 별도 제품 확정 전까지 잔여 정책 리스크다.
- TourAPI 유형당 기본 조회는 100개×3페이지로 제한한다. 300개 이후에만 존재하는 요청 장소는 누락될 수 있으므로 운영 전 targeted keyword 조회 또는 불완전 검색 오류 구분을 추가 검토해야 한다.
- 운영 환경변수, PR, 병합, 배포는 이번 Goal 범위에서 변경하지 않았다.

## GUI-157 완료 기준 재검증

GUI-157 완료 기준을 현재 V3 정책에 맞춰 다시 분류한 결과는 [completion-criteria-traceability.md](completion-criteria-traceability.md)에 기록했다. Google·Function Calling·장소 clarification 구현은 TourAPI 단일 원천과 네 질문 allowlist로 대체했으며 V3에 재도입하지 않았다.

### 추가한 회귀 경계

- `npm run test:completion`: ODsay 장거리 본선 좌표가 없을 때 `paths=[]`, `geometryStatus=partial`, 첫 탑승·최종 하차 marker를 보장한다.
- 같은 검증에서 지도 역할별 marker, 타임라인 탑승·하차 이벤트, 본선 좌표 미제공 경고와 직선 SVG fallback 부재를 고정한다.
- TourAPI·OpenAI·Naver geocode·Directions·ODsay·ready 이벤트의 usage recorder 호출을 V3 공급자·오케스트레이터 테스트에 추가했다. 기록 실패는 일정 생성을 막지 않는다.

### 로컬 웹·MCP 실제 흐름

`npm run test:local-v3`로 웹 3011과 MCP 8791을 실제 프로세스로 실행했다. 개발 전용 TourAPI 형태 fixture와 로컬 memory 저장소를 사용해 MCP JSON-RPC의 start, replay, conflict, 반복 get/advance, ready, revision 1 링크와 Chromium 상세 화면까지 통과했다. 생성 화면은 해운대·부산 호텔·Standard·CarryME를 표시했고 브라우저 공급자 요청은 0건이었다.

### 디자인과 E2E

- `npm run test:design`: 통과. 이미 승인된 현재 UI와 달랐던 `(예상)` 문구, 제거된 직선 SVG fallback, 확정 절약 문구 변수 assertion을 현재 계약에 맞춰 갱신했다.
- `itinerary-map-view-layout.spec.ts`, `destination-editor-recorded-flow.spec.ts`, `planme-v3-widget.spec.ts`: 5건 통과.
- 전체 Playwright: 15건 중 11건 통과, 4건 실패. 세 건은 V2 preview 저장·외부 경로 확정 환경, 한 건은 테스트와 Next 서버 프로세스의 local memory 비공유에 의존하는 기존 실패다.

### 외부 검증

실제 TourAPI·OpenAI·Naver·ODsay를 사용하는 양양 → 거제 생성과 실제 Upstash Lua 성공은 확인하지 못했다. 아래 운영 반복 검증에서 GPT Action까지는 실행했지만 웹 환경 설정 누락으로 공급자 호출과 Upstash 작업 생성 전에 중단됐다.

## 2026-07-14 운영 배포 반복 검증

### 배포와 개선

| PR | 운영 개선 | 결과 |
| --- | --- | --- |
| [#67](https://github.com/GuideME-Project/planme-demo/pull/67) | V3 기준선과 불필요한 안정화 변경 정리 | `main` 병합·배포 |
| [#68](https://github.com/GuideME-Project/planme-demo/pull/68) | 저장소 설정 오류 분류 | `main` 병합·배포 |
| [#69](https://github.com/GuideME-Project/planme-demo/pull/69) | Redis 실패 진단 | `main` 병합·배포 |
| [#70](https://github.com/GuideME-Project/planme-demo/pull/70) | `invocationId`·`transportMode`가 없는 구형 GPT Action 요청을 V3로 연결 | `main` 병합·MCP 배포 |
| [#71](https://github.com/GuideME-Project/planme-demo/pull/71) | 저장소 시작 실패를 생성·checkpoint 조회·phase 저장·상태 조회로 구분 | `main` 병합·웹 배포 |
| [#72](https://github.com/GuideME-Project/planme-demo/pull/72) | TourAPI 설정 누락을 저장소 장애와 분리 | `main` 병합·웹 배포 |

### 운영 GPT 새 채팅 시나리오

PlanME GPT의 새 채팅에서 다음 요청을 실행했다.

```text
강원도 양양군에서 경상남도 거제시로 대중교통을 이용하는 1박 2일 여행 일정을 만들어줘.
```

1. 최초 호출은 기존 GPT Action이 `invocationId`와 `transportMode`를 보내지 않아 요청 형식 오류가 발생했다.
2. PR #70 배포 뒤 같은 새 채팅 시나리오는 형식 오류 없이 V3 웹 시작 API까지 도달했다.
3. PR #71 배포 뒤에도 저장 단계별 코드가 아니라 `STORE_UNAVAILABLE`이어서 저장소 호출 전 런타임 초기화 실패로 범위를 좁혔다.
4. Vercel 운영 환경에서 `UPSTASH_REDIS_REST_URL`·`UPSTASH_REDIS_REST_TOKEN`은 존재하지만 `TOUR_API_SERVICE_KEY`와 웹의 `OPENAI_API_KEY`가 없음을 확인했다. MCP 프로젝트에는 `OPENAI_API_KEY`가 존재한다.
5. PR #72 배포 뒤 운영 Action과 GPT 새 채팅 모두 `TOUR_API_CONFIGURATION_MISSING`을 반환해 원인 분류가 일치함을 확인했다.

키 값은 출력하거나 문서에 기록하지 않았다. `TOUR_API_SERVICE_KEY`가 없으므로 실제 TourAPI 후보 조회, Luna 선택, Naver·ODsay 경로 계산과 Upstash 작업 생성 성공은 아직 검증되지 않았다.

### 현재 main 재검증

| 명령 | 결과 | 관측 |
| --- | --- | --- |
| `npm run test:completion` | 통과 | 장거리 partial 경로·탑승/하차 marker 계약 통과 |
| `npm run test:actions` | 통과 | GPT Actions 계약 통과 |
| `npm run test:mcp` | 통과 | MCP 계약 통과 |
| `npm run test:v3` | 통과 | V3-01~V3-10 통과 |
| `npm run test:local-v3` | 통과 | 웹 3011·MCP 8791, 실제 JSON-RPC, revision 1 ready 링크와 Chromium 렌더링 통과 |
| `PLANME_INTERNAL_API_TOKEN=playwright-local-token npx playwright test apps/web/e2e/itinerary-map-view-layout.spec.ts apps/web/e2e/destination-editor-recorded-flow.spec.ts apps/web/e2e/planme-v3-widget.spec.ts --project=chromium` | 통과 | 관련 Playwright 5건 통과 |

로컬 두 서버 검증이 만든 일정 ID는 일회성 메모리 fixture 데이터이며 서버 종료와 함께 폐기됐다. 테스트 스크립트가 웹·MCP 프로세스를 종료해 백그라운드 서버는 남아 있지 않다.

## 2026-07-14 운영 환경 설정 재개

- `planme-demo` Production·Preview에 `OPENAI_API_KEY`와 `TOUR_API_SERVICE_KEY`를 추가했다.
- 현재 worktree와 기준 `main` 체크아웃의 웹 로컬 환경에 TourAPI 키를 반영했다.
- 민감값 원문은 Git과 검증 문서에 기록하지 않았다.

- PR #74의 병합 배포 뒤 PlanME GPT 새 채팅 시나리오와 실제 공급자·Upstash 흐름을 다시 검증한다.

### PR #74 운영 재검증

- PR #74 병합 커밋 `1bff3d8`의 웹·MCP 운영 배포가 모두 성공했다.
- PlanME GPT 새 채팅에서 양양 출발, 거제 도착, 대중교통, 1박 2일 요청을 실행하고 Action을 허용했다.
- Action은 `INTERNAL_CONFIGURATION_ERROR`를 반환했다.
- 코드와 Vercel 변수 이름을 대조한 결과 서버 지오코딩이 요구하는 `NAVER_MAPS_CLIENT_ID`와 대중교통 경로가 요구하는 `ODSAY_API_KEY`가 없고, 각각 브라우저용 변수만 존재했다.
- 기존 로컬 값을 새로 생성하지 않고 서버용 변수 이름으로 복제해 현재 worktree, 기준 `main` 체크아웃, Vercel Production·Preview에 반영했다.
- 민감값 원문은 Git과 검증 문서에 기록하지 않았다.

### PR #75 운영 재검증과 TourAPI 보정

- PR #75 병합 커밋 `a8c6f0f`의 웹·MCP 운영 배포가 모두 성공했다.
- PlanME GPT 새 채팅에서 같은 양양 → 거제 시나리오를 실행한 결과 서버 설정 오류는 해소됐고, 실제 생성 처리 뒤 `TOURAPI_UNAVAILABLE`로 종료됐다.
- 동일 키로 `ldongCode2`와 거제시 관광지·문화시설·레포츠·음식점 요청이 `0000/OK`를 반환해 키와 지역 조회가 정상임을 확인했다.
- 숙소 전용 `searchStay2` 요청에 `contentTypeId=32`를 함께 보내면 TourAPI가 `INVALID_REQUEST_PARAMETER_ERROR(contentTypeId)`를 반환하고, 해당 매개변수를 빼면 `0000/OK`와 숙소 결과를 반환했다.
- `searchStay2` 요청에서만 `contentTypeId`를 제외하고 공급자 계약 회귀 검사를 추가했다.
- `npm run test:v3`, `npm run lint`, `npm run build`가 통과했다. 린트에는 기존 `ItineraryDashboard.tsx` 경고 3건이 남아 있고 오류는 없다.

### PR #76 운영 재검증과 ODsay 인증 분류

- PR #76 병합 커밋 `539c07a`의 웹·MCP 운영 배포가 모두 성공했다.
- PlanME GPT 새 채팅에서 같은 시나리오를 실행한 결과 TourAPI 후보·숙소 조회는 통과하고 대중교통 경로 단계에서 `ROUTE_UNAVAILABLE`로 종료됐다.
- Upstash 작업 체크포인트에서 첫 필수 구간 `transit:origin:143125`가 `ODSAY_500`으로 실패한 것을 확인했다.
- 동일 좌표와 Production 키로 ODsay를 직접 호출한 결과 `500 [ApiKeyAuthFailed] ApiKey authentication failed.`가 반환됐다.
- Vercel Production의 기존 브라우저용 키와 로컬 값이 같은지 확인했고, 별도의 서버용 키는 저장소 환경 파일에서 발견되지 않았다.
- ODsay 인증 실패는 `ODSAY_CONFIGURATION_ERROR`로 분류하고 오케스트레이터가 `INTERNAL_CONFIGURATION_ERROR`로 전달하도록 보정했다. 장거리 구간을 추정 경로로 대체하지 않는다.
- `npm run test:v3`, `npm run lint`, `npm run build`가 다시 통과했다. 기존 린트 경고 3건 외 오류는 없다.
