# 검증 구현계획

## 결론

V3 완료는 외부 API 성공 한 건이 아니라 V3-01~V3-10, 타입·빌드·린트, 채널 공통성과 브라우저 공급자 호출 차단이 자동으로 확인되는 상태다. 외부 smoke는 별도 승인과 키가 있을 때만 실행하며 모의 계약 테스트를 대체하지 않는다.

## 기준선 명령

실제 구현 시작 직후 다음을 실행해 변경 전 상태를 기록한다.

```bash
npm run build
npm run lint
npm run test:actions
npm run test:design
npm run test:mcp
npm run test:finalization
npm run test:route-normalization
npm --workspace @planme/mcp run typecheck
```

실패하면 명령, 첫 오류, 변경 전 재현 여부를 기록한다. 설정 변경이나 대량 자동수정으로 우회하지 않는다.

## 테스트 구조 계획

| 후보 파일 | 역할 |
| --- | --- |
| `packages/planme-core/src/v3/*.test.ts` 또는 저장소 관례에 맞춘 script fixture | 순수 정책 단위 검사 |
| `apps/web/scripts/check-planme-v3.ts` | 오케스트레이터·저장소·공급자 계약 |
| `scripts/check-planme-v3.mjs` | 패키지 경계를 포함한 필수 게이트 집계 |
| `apps/mcp/scripts/check-planme-mcp.ts` | GPT App 도구·웹 어댑터 계약 |
| `scripts/check-planme-actions.mjs` | GPTs OpenAPI·HTTP 계약 |
| `apps/web/scripts/check-itinerary-finalization.ts` | V3 서버 시간표·경로 확정 계약 |
| `apps/web/e2e/gpt-itinerary-generation.spec.ts` | processing→ready와 상세 표시 |
| `apps/web/e2e/itinerary-finalized-routes.spec.ts` | active revision과 브라우저 provider 0건 |
| `apps/web/e2e/destination-editor-recorded-flow.spec.ts` | TourAPI contentId 편집·revision 전환 |

테스트 프레임워크를 새로 도입하기 전에 현재 TypeScript script 방식으로 충분한지 먼저 확인한다. 새 의존성이 필요한 경우 범위 확장이므로 중단하고 승인받는다.

## V3 필수 게이트 매핑

| ID | 핵심 assertion | 주 테스트 계층 |
| --- | --- | --- |
| V3-01 AI 허용 목록 | 후보 밖 ID가 저장되지 않고 AI 응답 전체가 거부됨 | core + web 통합 |
| V3-02 TourAPI 스냅샷 | 모든 장소 참조가 같은 revision snapshot에 존재 | core + 저장소 |
| V3-03 AI 필드 차단 | title·coordinate·time·description 추가 시 거부 | core schema |
| V3-04 질문 allowlist | 생성 질문 집합이 네 slot의 부분집합 | core + GPTs + MCP |
| V3-05 ODsay 오류 행렬 | -98, 700m, 411~414, retry, fail-closed | core + provider mock |
| V3-06 revision 원자성 | 편집 실패·충돌에서 active 불변 | 저장소 + API |
| V3-07 ID·멱등성 | 새 요청 새 ID, 같은 재시도 같은 ID, 충돌 409 | 저장소 + API |
| V3-08 채널 공통성 | GPTs·MCP가 같은 web revision 사용 | 채널 통합 |
| V3-09 브라우저 경로 차단 | 공급자·finalize 요청 0건 | Playwright + 정적 검색 |
| V3-10 TourAPI 캐시 | fresh·empty·outage·last-good 유형별 정책 | provider + 저장소 |

## fixture 계획

### TourAPI

- 유효 관광지·문화·레포츠·숙박·쇼핑·음식점
- 여행코스 25와 날짜 밖 행사
- mapX/mapY 누락, 0, 비숫자, 범위 초과, 반전 의심
- 중복 `(contentTypeId, contentId)`
- 정상 빈 결과
- 네트워크 오류, HTTP 429·500, TourAPI 오류 응답
- 유형별 fresh와 last-good 조합

### Luna

- 정상 선택
- 후보 밖 ID, 잘못된 유형, 중복, day 오류
- 추가 title·coordinate·time·description
- malformed JSON, 빈 응답, 네트워크 오류
- 첫 실패 후 성공, 두 번 실패 후 결정적 배열

모의 호출에는 `gpt-5.6-luna`와 `low` 설정 assertion을 둔다. 다른 모델이나 V2 fallback 호출 횟수는 0이어야 한다.

### 경로

- ODsay 성공
- `-98`에서 699m, 700m, 701m
- 도보 411~414
- 3·4·5·6·`-99`, `-8`·`-9`, 408·429·500·`-1`, 미분류 오류
- 네이버 자동차 성공·일시 실패·영구 실패
- `estimated_walk`의 빈 path와 geometry unavailable

### 일정 계산

- 1일 일정: 실제 목적지 도착 이후 시작, 같은 날 17:00 복귀 이동 시작, 유효 방문 불가 시 실패
- 2일 일정: 첫날 실제 도착, 마지막 날 09:30 숙소 출발과 17:00 복귀 이동 시작
- 14일 일정: 중간 날 09:30, 장소 중복 없음, 부족한 날 자유시간·숙소 휴식
- 음식점 없음, 숙소 없음, 실제 방문 장소 없음
- 점심 12:00~14:00, 저녁 18:00~20:00와 이동시간 전파
- Standard 숙소 경유와 CarryME 수하물 이벤트 분리
- 경로 실패 장소의 단조로운 제외와 재계산 상한

### 저장과 동시성

- 같은 멱등 키·같은/다른 digest
- 같은 멱등 키의 동시 start에서 정확히 한 itinerary ID만 생성
- 같은 phase 동시 advance
- 잠금 만료 후 재개
- 같은 base revision 동시 편집
- pending 편집 중 두 번째 편집 시작 409
- pending 실패와 active·previous 불변
- 절대 만료시각과 V1/V2 namespace 불변

## 채널 통합 검증

### GPTs

- planning 응답이 origin, destination, transportMode, durationDays 외 질문을 만들지 않는다.
- recommend의 `invocationId`가 필수이고 사용자 질문 슬롯에 포함되지 않는다.
- 같은 invocationId·같은 body 재시도는 같은 ID, 다른 body는 409를 반환한다.
- recommend 한 요청이 42초 안에 ready 또는 terminal failed를 반환한다.
- 공개 응답에 processing과 후속 advance 지시가 없다.
- ready 전 page URL과 전체 itinerary가 없다.
- OpenAPI가 import 가능한 JSON이며 operationId가 고유하다.

### GPT App MCP

- recommend가 web start를 정확히 한 번 호출하고 processing 위젯을 반환한다.
- processing 위젯이 사용자 동작 없이 get 도구를 호출한다.
- get이 processing 동안 advance를 한 번 호출한다.
- processing에는 자동 호출용 widget `_meta`가 있고 ready·failed에서 호출이 멈춘다.
- 자동 호출이 최대 횟수·경과시간 상한을 넘지 않는다.
- MCP 환경에서 V3 OpenAI·TourAPI 호출이 0번이다.
- failed 결과가 사용자에게 숙소·선호·장소 질문을 요구하지 않는다.

## 웹 E2E

1. 새 일정 processing에서 부분 장소·경로·절약 수치를 보이지 않는다.
2. ready에서 active revision만 표시한다.
3. 새로고침과 일차 전환 중 공급자 요청이 없다.
4. TourAPI 후보 contentId가 없는 자유 텍스트 편집을 거부한다.
5. 편집 processing 동안 기존 active를 유지한다.
6. 성공 시 Standard·CarryME·시간표가 같은 새 revision으로 바뀐다.
7. 실패·409 시 기존 active가 유지된다.
8. `estimated_walk`에 예상 배지가 있고 지도선이 없다.
9. GPT 결과·위젯에는 특정 장소 제외 안내가 있고 웹에는 없다.

감시 URL:

```text
api.odsay.com
/api/naver/directions/routes
/routes/finalize
네이버 Directions 외부 origin
```

## 정적 금지 경계

보조 검사로 다음을 `rg`로 확인한다.

- `ItineraryDashboard.tsx`와 클라이언트 모듈의 `NEXT_PUBLIC_ODSAY_API_KEY`
- V3 브라우저 코드의 `api.odsay.com`, `/api/naver/directions/routes`, `/routes/finalize`
- MCP V3 경로의 `OPENAI_API_KEY`, TourAPI client, `createAiRecommendedItineraryResponse`
- V3 AI schema의 이름·좌표·timeline 필드
- 질문 enum과 도구 설명의 `hotelName`, 숙소·선호 질문 문구
- V3에서 `search_naver_places` 또는 네이버 장소 후보 사용

문자열이 존재한다는 이유만으로 전체 실패시키지 않고 V3 실행 경로인지 import graph와 동작 테스트로 확인한다.

## 실행 명령 계획

구현 후 최소 실행 순서:

```bash
npm run test:v3
npm --workspace @planme/core run build
npm --workspace @planme/mcp run typecheck
npm run test:actions
npm run test:mcp
npm run test:finalization
npm run test:route-normalization
npm run build
npm run lint
```

Playwright는 관련 서버·환경 준비 후 변경된 세 spec을 실행한다. 루트에 기존 Playwright script가 없으면 `npx playwright test <spec...>` 형태를 사용하되 설치·브라우저 다운로드 같은 상태 변경은 사전 확인한다.

## 외부 smoke

외부 smoke는 다음 조건이 모두 충족될 때만 실행한다.

- 개발용 TourAPI, OpenAI, 네이버, ODsay 키가 현재 환경에 존재
- 예상 호출 수와 비용·할당량을 확인
- 실제 외부 요청에 대한 별도 승인
- 로그에 키·전체 URL·prompt·원본 응답이 남지 않음

순서:

1. TourAPI 한 지역의 관광지·숙소·음식점
2. Luna 한 structured selection
3. 네이버 자동차 한 일정
4. ODsay 대중교통과 700m 경계
5. 저장 revision과 GPTs/MCP·웹 결과 비교

키가 없거나 승인되지 않으면 `실행하지 않음`으로 기록한다. 모의 테스트 통과와 외부 연동 확인을 같은 결론으로 합치지 않는다.

## 성능과 payload

- 각 advance 단계의 실행시간과 외부 호출 수
- GPTs 1일·14일 mock 전체 실행시간과 42초 내부 예산 대비 여유
- GPT App 14일 최악 경로의 자동 도구 호출 횟수와 설정 상한 대비 여유
- 14일 후보 prompt 입력 크기
- 1일·3일·14일 revision JSON 크기
- 경로 batch 수와 재개 횟수
- 상세 API payload 1MB 미만 유지 여부

한 단계가 서버리스 제한에 근접하면 batch 크기를 줄인다. 경로선을 분리 저장해야 할 경우 장소·시간표 스냅샷은 revision에 유지하고 설계 변경 승인을 받는다.

## 완료 보고 형식

- 통과: 실행 명령과 확인한 게이트 ID
- 실패: 명령, 최초 관측 오류, 변경 전 실패 여부, 영향 게이트
- 미실행: 필요한 키·권한·환경과 이유
- 잔여 리스크: 외부 smoke, 운영 환경변수, 실제 배포 미확인

필수 게이트 하나라도 실패하면 구현 완료 또는 PR 준비 완료로 보고하지 않는다.
