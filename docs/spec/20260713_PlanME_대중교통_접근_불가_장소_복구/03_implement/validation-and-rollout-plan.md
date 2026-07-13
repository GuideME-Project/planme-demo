# 검증과 적용 계획

## 결론

모의 공급자 테스트로 로직과 실패 계약을 먼저 고정하고, `off` 배포 후 `smoke` 모드에서 실제 ODsay 계약·반경·시간·호출 상한을 제한적으로 확인한다. GPTs OpenAPI를 다시 가져온 뒤 모든 활성화 조건이 충족된 경우에만 별도 PR로 `on`을 배포하고 두 ChatGPT 표면과 자동차 회귀를 즉시 검증한다.

## 검증 단계

### 1. 정적·공유 계약

목표:

- 공유 타입과 두 공개 표면의 스키마가 일치한다.
- 레거시 요청·저장 데이터가 깨지지 않는다.

명령:

```bash
npm --workspace @planme/core run build
npm --workspace @planme/mcp run typecheck
npm run test:actions
npm run test:route-normalization
```

주요 assertion:

- `destinationType`과 `mustVisitPlaces`가 GPTs·GPT 앱 모두에 존재
- 레거시 누락은 `place`·빈 배열로 정규화
- `savedMinutes`는 OpenAPI required 목록에 없음
- `savingStatus`는 신규 ready 응답에 존재
- `hidden_estimated` 응답에는 `savedMinutes`가 없음
- 신규 일정의 `stopRef`·`placeConstraint`·타임라인 매핑이 유효
- `RouteProviderStop`과 구조화된 복구 문맥까지 `stopRef`·`placeConstraint`가 유지

### 2. 핵심 패키지·MCP 오케스트레이션

명령:

```bash
npm run test:mcp
```

추가할 사례:

1. 지역 목적지가 방문지에 삽입되지 않음
2. 정확한 장소·필수 장소는 `fixed`
3. AI 장소는 `replaceable`
4. 교체 후보는 원래 장소 외 최대 세 곳
5. 실패 공급자 참조를 반복 선택하지 않음
6. 후보 소진 후 AI 장소만 제거
7. 방문 장소가 모두 제거되면 `needs_clarification`
8. 고정 장소 확인 필요를 공개 clarification으로 변환
9. GPTs와 GPT 앱 모두 공통 오케스트레이터 사용
10. 접근성 성공 뒤 최종 저장 fetch 정확히 한 번
11. 상세 저장 성공 전 page URL 미노출
12. 전역 deadline 부족 시 다음 후보 중단

### 3. 웹 경로·저장 계약

명령:

```bash
npm run test:finalization
```

추가할 사례:

- ODsay 코드 4에서 정류장 복구 시작
- 정류장 후보 최대 세 곳과 총시간 최솟값 선택
- 실제 도보 성공과 경로선 보존
- 도보 `411~414` 추정, `durationSource="estimated"`, 빈 도보 paths
- AI 30분 경계: 30분 유지, 31분 교체
- 고정 90분 경계: 90분 유지, 91분 확인
- 인증·계약 오류는 장소 교체하지 않음
- 캐시 적중 시 공급자 호출 없음
- 같은 추적 ID의 Standard·CarryME 동일 구간 캐시 공유
- 다른 추적 ID는 캐시 격리
- 캐시 키·로그에 출발지 원문 없음
- 사전검사가 preview revision을 만들지 않음
- 최종 저장은 캐시 결과로 V2 revision 1회 생성
- 캐시 만료 후 정확한 재계산
- 같은 동시 실패 집합의 응답 지연 순서를 바꿔도 같은 `stopRef` 선택
- 호출 상한 직전까지는 공급자 요청 허용, 상한 도달 뒤에는 네트워크 요청 전에 차단
- 사전검사와 최종 저장이 같은 추적 ID의 호출 카운터 공유
- 시간표 시각 보정, 제목·순서 보존
- 레거시 시간표 불변
- 날짜 경계 초과 원자 실패
- 추정 상태의 절약시간 누락
- 자동차 기존 provider 결과 유지

### 4. 린트·프로덕션 빌드

명령:

```bash
npm run lint
npm run build
npm --workspace @planme/mcp run typecheck
```

확인:

- Next.js 서버·클라이언트 경계에서 Node crypto·Redis 코드가 브라우저 번들로 들어가지 않음
- MUI 컴포넌트 prop 선택값 변경이 타입 오류를 만들지 않음
- OpenAI 구조화 출력 JSON Schema가 빌드됨
- `unknown` 신규 도입 없음

### 5. 브라우저 E2E

명령:

```bash
npx playwright test apps/web/e2e/itinerary-finalized-routes.spec.ts apps/web/e2e/gpt-itinerary-generation.spec.ts
```

시나리오:

1. 실제 provider 결과만 있는 일정은 기존 절약 UI 표시
2. 추정 구간 일정은 총시간·보정 시간표 표시, 절약 UI 숨김
3. `0분 절약`과 `경로 계산 불가` 문구 없음
4. 추정 마지막 도보 가짜 경로선 없음
5. 저장된 최종 일정 페이지를 열거나 일차를 바꿔도 브라우저 provider 재호출 없음
6. 레거시 저장 일정은 기존 시간표로 표시
7. 자동차 상세 화면과 경로 다시 계산 유지

## 테스트 더블 설계

ODsay 모의 응답은 공급자 원문 전체를 fixture로 저장하지 않고 필요한 최소 필드만 만든다.

필요 fixture:

- 일반 대중교통 성공
- 오류 코드 4
- `pointSearch` 정류장 0·1·3·4개
- 실제 도보 성공
- 도보 `411`, `412`, `413`, `414`
- 인증 실패
- HTTP 429 후 한 번 성공
- 캐시 적중 구간

시간은 실제 대기 대신 주입 가능한 clock 또는 짧은 timeout을 사용한다. 기존 260ms 요청 간격 테스트가 불필요하게 전체 테스트를 느리게 만들면 request scheduler를 주입 가능하게 분리한다.

## 실제 ODsay 검증

### 실행 전 조건

- 배포 모드 기본값 `PLANME_TRANSIT_ACCESS_RECOVERY_MODE=off`
- 실제 검증은 별도 검증 배포가 확인되면 그 환경에서, 없으면 PR로 배포한 `smoke` 모드에서만 수행
- `smoke`에서는 서명된 내부 스모크 요청만 사전검사를 호출하고 GPTs·GPT 앱 공개 요청은 기존 흐름 유지
- `PLANME_ODSAY_STATION_SEARCH_RADII_METERS`는 실제 검증할 후보 반경만 사용
- 스모크 실행은 승인받은 테스트 행렬에서 계산한 실행 전용 최대 호출 수를 명시적으로 받아야 하며 기본값 없이 거부함. 측정 결과 없이 `PLANME_ODSAY_MAX_REQUESTS_PER_TRACE`의 `on` 값을 확정하지 않음
- 실제 외부 호출 확인용 명시적 환경 플래그
- 공급자 키와 내부 토큰이 존재하는지만 확인하고 원문 출력 금지
- 예상 최대 호출 횟수 기록
- 운영과 같은 Referer·호출 위치 사용

신규 스크립트 후보:

- `apps/mcp/scripts/check-planme-transit-recovery-smoke.ts`
- package script: `smoke:transit-recovery`

예정 명령:

```bash
PLANME_CONFIRM_EXTERNAL_API_SMOKE=1 npm run smoke:transit-recovery
```

스크립트는 확인 플래그가 없으면 공급자를 호출하지 않고 종료해야 한다.

### 확인 항목

1. 서버에서 `searchWalkPathV2`가 운영 계약상 성공하는지
2. `pointSearch` 반경별 성공·오류와 최대 허용값
3. 남해독일마을·보리암 주변 정류장 반환 여부
4. 실제 도보 성공과 정상적인 도로망 실패 구분
5. 실제 도보시간과 승인된 추정값 비교
6. 정류장 후보 세 곳 기준 호출 수
7. 사전검사 후 최종 저장의 캐시 적중
8. MCP 전체 처리시간이 후보 55초 예산 안인지
9. 대표 일정과 정류장 후보 세 곳·한 번 재시도에서 추적 ID별 최대 실제 요청 수
10. 상한 초과 직전 요청이 ODsay에 전달되지 않는지

결과 기록:

- 성공·실패 코드, 호출 수, 처리시간과 선택 정류장 수만 기록
- 키, 전체 URL, 좌표 원문, 사용자 출발지와 공급자 응답 본문은 기록하지 않음

## 실제 ChatGPT 수락 테스트

### 사전 준비

1. 코드 배포 후 맞춤형 GPT PlanME Action에서 OpenAPI를 다시 가져온다.
2. GPTs 추천 응답의 `savedMinutes`가 선택 필드로 인식되는지 확인한다.
3. GPT 앱 도구 목록에서 `destinationType`, `mustVisitPlaces`와 `savingStatus` 계약을 확인한다.
4. MCP와 웹의 배포 모드가 모두 `on`인지 확인한다.
5. 스모크 결과로 확정된 공급자 호출 상한이 두 서비스에서 동일한지 확인한다.

### GPTs PlanME

새 대화에서 PlanME를 호출한다.

- 지역 시나리오: `강동역 출발, 남해 1박 2일, 대중교통`
- 고정 장소 시나리오: 위 요청에 `남해독일마을과 보리암은 꼭 포함`

### GuideME-PlanME 앱

일반 ChatGPT 새 대화에서 GuideME-PlanME 앱을 호출하고 같은 두 요청을 실행한다.

### 공통 확인

- 지역 `남해`가 행정 방문지로 삽입되지 않음
- 필수 장소가 자동 교체·제거되지 않음
- AI 장소 후보가 세 곳을 넘지 않음
- 사용자에게 내부 422가 노출되지 않음
- 상세 링크가 열리고 `routeFinalized=true`
- 시간표에 실제·추정 이동시간이 반영됨
- 추정이 있으면 절약 숫자·문구와 가짜 경로선이 없음
- 로그에서 trace ID로 MCP·웹 흐름을 연결할 수 있음
- 출발지 원문이 로그에 없음

### 자동차 회귀

두 표면 중 적어도 하나에서 다음을 실행한다.

- `동탄호수공원 출발, 부산 1박 2일, 자동차`

확인:

- 사전검사 API 호출 없음
- ODsay 정류장·도보 함수 호출 없음
- 네이버 자동차 경로와 상세 화면 정상
- 기존 절약시간 표시 정상

## 관측 지표

### MCP

- 전체 추천 처리시간
- 사전검사 호출 수
- AI 장소별 후보 시도 수
- 최종 저장 호출 수
- clarification·timeout·운영 오류 수

### 웹

- 코드 4 발생 수
- 정류장 후보 수와 복구 성공률
- 실제·추정 도보 수
- 캐시 적중률과 오류 수
- 공급자 호출 수·응답시간·429·인증 오류
- 추적 ID별 호출 카운터 최대값과 `PROVIDER_CALL_BUDGET_EXCEEDED` 수
- 최종 저장 시간과 revision 충돌

진입점별 `GPTs`·`GPT app` 태그는 허용하되 전체 프롬프트를 로그에 넣지 않는다.

## 적용 순서

1. `off` 모드로 공유 타입·웹·MCP 코드를 하나의 PR에서 검증한다.
2. PR 병합을 통한 자동 배포만 사용한다.
3. 별도 검증 배포가 확인되면 사용한다. 없으면 `smoke` 전환 PR을 병합한 뒤 서명된 스크립트로만 실제 ODsay 제한 검증을 수행한다.
4. 검색 반경, 공급자 호출 상한과 시간 예산을 스모크 결과로 확정한다.
5. GPTs Action 스키마를 다시 가져온다.
6. 활성화 조건을 모두 확인하고 `off` 원복 PR을 미리 준비한 뒤, 별도 승인·PR로 MCP와 웹을 함께 `on`으로 전환한다.
7. 자동 배포 직후 두 ChatGPT 표면과 자동차 회귀를 새 대화에서 시험한다.
8. 첫 대표 요청들의 지표와 로그를 확인하고 실패 시 `off` 원복 PR을 즉시 진행한다.

직접 Vercel MCP 배포, Vercel 대시보드의 즉시 모드 변경이나 즉석 운영 코드 변경을 사용하지 않는다.

## 활성화 조건

- 실제 도보 API 서버 호출 허용
- 실제 `pointSearch` 반경이 대표 사례를 지원
- 운영 공유 Redis 캐시 정상
- 스모크 측정으로 `PLANME_ODSAY_MAX_REQUESTS_PER_TRACE` 확정
- 대표 일정이 전역 시간 예산 안에 완료
- 자동 테스트·빌드·E2E 통과
- GPTs OpenAPI 재가져오기 완료
- GPTs·GPT 앱 수락 테스트 통과
- 자동차 회귀 없음

## 롤백

### 즉시 중단 조건

- 인증·계약 오류 증가
- MCP 시간 초과 증가
- 캐시 장애로 공급자 호출 폭증
- 추적 ID별 공급자 호출 상한 초과 또는 상한 이후 실제 요청 관측
- 고정 장소 교체·제거
- 추정 절약시간·가짜 경로선 노출
- 자동차 요청이 대중교통 복구 경로 실행

### 순서

1. `PLANME_TRANSIT_ACCESS_RECOVERY_MODE=off` 변경 PR을 병합해 자동 배포한다.
2. 기존 자동차·대중교통 저장 흐름으로 되돌아갔는지 확인한다.
3. 신규 필드의 읽기 호환 코드는 유지한다.
4. GPTs 스키마는 optional 필드이므로 되돌리지 않아도 기존 응답을 수용한다.
5. 문제가 코드 자체면 되돌림 PR을 병합해 자동 배포한다.

## 테스트 로그 작성 기준

이 문서는 실행 계획이며 테스트 통과를 주장하지 않는다. 구현 후 별도 테스트 로그를 만들 때 다음을 기록한다.

- 실행 명령
- 시작·종료 시각과 결과
- 첫 실패와 원인
- 재시도 여부
- 기존 baseline 실패인지 신규 회귀인지
- 실제 외부 호출 수와 민감정보 제거 여부
- 미실행 항목과 사유
