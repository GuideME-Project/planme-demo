# 구현 순서

## 결론

- 구현 방향: 공유 자료형을 먼저 하위 호환 형태로 확장하고, 웹의 접근성 사전검사와 5분 Redis 구간 캐시를 만든 뒤, MCP 공통 오케스트레이터에서 AI 장소를 교체한다. 모든 후보가 확정된 후 기존 미리보기 저장 API를 한 번 호출한다.
- 완료 조건: GPTs PlanME와 GuideME-PlanME 앱에서 대표 대중교통 일정이 저장되고, 고정 장소와 AI 장소 정책·시간표·추정 상태가 보존되며 자동차 일정이 회귀하지 않는다.
- 주요 리스크: MCP 함수의 60초 제한, ODsay 도보 계약·검색 반경 미확인, GPTs가 캐시한 기존 OpenAPI 응답 계약이다.

## 근거

- 설계 문서: [설계 색인](../02_design/index.md)
- 서비스 경계: [장소 교체 오케스트레이션](../02_design/replacement-orchestration.md)
- API 계약: [장소 의도와 고정 계약](../02_design/place-intent-contract.md)
- 시간표 계약: [경로 최종화와 표시](../02_design/route-finalization-and-presentation.md)
- Linear 이슈: 없음
- 패키지 관리자: npm workspaces
- 현재 테스트 명령: `npm run test:mcp`, `npm run test:finalization`, `npm run test:actions`, `npm run lint`, `npm run build`

## 범위

### 포함

- GPTs REST·OpenAPI와 GPT 앱 도구의 요청·응답 계약
- OpenAI 일정 초안과 서버 정규화 계약
- 사용자 지역, 필수 장소와 AI 장소의 고정 상태
- 내부 대중교통 접근성 사전검사 API
- ODsay 주변 정류장·도보·추정 복구
- 요청 추적 범위의 5분 공유 구간 캐시
- AI 장소 최대 세 후보 교체와 제거
- 실제·추정 구간 상태, 시간표 보정과 절약시간 숨김
- Redis 저장 JSON 읽기 호환성
- 자동 테스트, 제한된 실제 공급자 검증과 ChatGPT 수락 테스트

### 제외

- 자동차 네이버 경로 알고리즘 변경
- 새 사용자 입력 화면이나 실패 경고 UI
- 장소 영업시간 검증
- 데이터베이스 스키마와 마이그레이션
- 직접 Vercel MCP 배포
- ODsay 외 대체 공급자 도입

## 구현 원칙

1. `drive` 분기는 신규 접근성 사전검사와 ODsay 복구를 호출하지 않는다.
2. 신규 필드는 저장 레거시 호환을 위해 TypeScript에서 선택 필드로 읽되, 신규 AI 생성 계약에서는 필수 검증한다.
3. 사용자 고정 장소를 장소명으로 추론하지 않고 `placeConstraint`로 판단한다.
4. 공급자 인증·계약 오류를 보행 경로 없음으로 오인하지 않는다.
5. 사전검사는 저장하지 않고, 최종 저장만 기존 잠금·revision 비교를 사용한다.
6. `unknown` 또는 `unknown[]` 신규 타입을 도입하지 않는다.
7. 민감값, 전체 공급자 요청·응답과 사용자 출발지를 로그에 남기지 않는다.

## 작업 순서

### 1단계: 공유 자료형과 레거시 읽기

변경 목적:

- 지역·고정 장소·AI 장소를 구분한다.
- 타임라인을 정류장과 안정적으로 연결한다.
- 실제·추정 시간과 절약시간 표시 상태를 저장한다.

주요 작업:

1. `RecommendItineraryRequest`에 `destinationType?`, `mustVisitPlaces?`를 추가한다.
2. 초안 정류장의 `requiredPlaceKind`에 `must_visit`을 추가한다.
3. `RouteStop`에 `stopRef?`, `placeConstraint?`를 추가한다.
4. 웹 `RouteProviderStop`과 `toProviderStops`가 두 필드를 보존하도록 확장하고, 신규 일정에서 누락되면 공급자 호출 전에 실패시킨다.
5. 초안 시간표에 `stopIndex?`, `stayDurationMinutes?`를 추가하고 저장 시간표에 `stopRef?`, `stayDurationMinutes?`를 추가한다.
6. `RouteProviderSegment`에 `durationSource`를, `RoutePlan`에 집계 상태와 추정 구간 번호를 추가한다.
7. `ItineraryDay`에 `savingStatus?`를 추가하고 `savingMinutes`를 선택 필드로 전환한다.
8. `PlanmeItinerary`의 `carrymeSaving`과 `savedDurationLabel`을 선택 필드로 전환한다.
9. 레거시 일정은 신규 참조가 없으면 기존 시간표·절약시간을 그대로 읽는다.

검증 게이트:

- `@planme/core` 타입 빌드가 통과한다.
- 기존 결정형 일정과 V1·V2 저장 데이터가 읽힌다.
- `drive` 모의 일정의 직렬화 결과에서 기존 필드가 손실되지 않는다.

### 2단계: 요청 정규화와 신규 AI 초안 계약

변경 목적:

- `남해` 같은 지역이 임의 방문지가 되는 문제를 제거한다.
- 신규 일정에 신뢰할 수 있는 `stopRef`와 체류시간 매핑을 만든다.

주요 작업:

1. `destinationType="region"`이면 목적지 필수 장소 해석을 생략하고 생성 범위로만 전달한다.
2. `destinationType="place"`와 `mustVisitPlaces`를 필수 장소 목록으로 해석한다.
3. `PlanmeResolvedRequiredPlaces`를 출발지와 필수 장소 배열로 확장한다.
4. 서버가 일차·논리 슬롯 기준으로 `stopRef`를 생성한다.
5. 모델 출력의 `stopIndex`를 `stopRef`로 변환하고 정류장과 대표 타임라인 이벤트의 양방향 참조를 검증한다.
6. 신규 결과에서 매핑 누락·중복·범위 초과는 `needs_clarification`이 아니라 생성 계약 오류로 처리한다.
7. 기존 직접 후보와 별도로 AI 교체 후보를 세 곳까지 만들 수 있도록 교체 시도 타입을 확장한다.

검증 게이트:

- 지역, 정확한 장소, 지역과 복수 필수 장소의 핵심 패키지 테스트가 통과한다.
- Standard·CarryME에서 같은 논리 장소가 같은 `stopRef`를 가진다.
- 장소 교체 후에도 `stopRef`와 체류시간이 유지된다.

### 3단계: 웹 공급자 구간 복구와 공유 캐시

변경 목적:

- 오류 코드 4를 정류장과 마지막 도보로 복구한다.
- 사전검사와 최종 저장에서 같은 공급자 구간을 중복 계산하지 않는다.

주요 작업:

1. ODsay 모듈에서 단일 구간 계산 함수를 분리한다.
2. `pointSearch`와 `searchWalkPathV2` 응답 타입·오류 분류를 추가한다.
3. 정류장 후보 최대 세 곳을 평가하고 전체 이동시간이 가장 짧은 후보를 선택한다.
4. 도보 오류 `411~414`는 승인된 추정식으로 전환한다.
5. 공급자 구간 결과를 추적 ID와 좌표 쌍 해시로 5분간 Upstash Redis에 저장한다.
6. 같은 Redis 경계에 추적 ID별 실제 공급자 호출 카운터를 두고 모든 `pointSearch`·대중교통·도보·재시도 직전에 원자적으로 예산을 소비한다.
7. 호출 상한을 넘으면 실제 요청 전에 `PROVIDER_CALL_BUDGET_EXCEEDED`로 중단한다.
8. 로컬 테스트에는 메모리 캐시·카운터를 사용하고 운영에서 Redis나 검증된 호출 상한이 없으면 `on` 모드를 허용하지 않는다.

검증 게이트:

- 코드 4, 후보 선택, 실제 도보, 추정 도보, 인증 오류와 캐시 적중 테스트가 통과한다.
- 사용자 출발지가 캐시 키와 로그 원문에 나타나지 않는다.
- 자동차 제공자 테스트 결과가 변하지 않는다.

### 4단계: 내부 접근성 사전검사 API

변경 목적:

- 장소 교체를 최종 저장 전에 완료한다.
- 저장 API 반복 호출 없이 MCP 60초 제한 안에서 작업한다.

주요 작업:

1. 내부 인증·추적 ID 검증을 재사용 가능한 웹 유틸리티로 추출한다.
2. `POST /api/gpt/itineraries/transit-preflight`를 추가한다.
3. 대중교통 일정과 전체 Standard·CarryME 경로를 입력받아 구간을 검사하고 캐시에 저장한다.
4. 일차별 Standard·CarryME 작업을 묶어 완료하고 실패를 `dayIndex`, Standard 우선, `segmentIndex`, `stopRef` 순으로 정렬한다.
5. 도메인 결과를 `accessible`, `replacement_required`, `confirmation_required`로 반환한다.
6. 공급자 설정·계약 오류, 호출 상한 초과와 시간 초과는 도메인 결과가 아닌 안정적인 HTTP 오류로 분리한다.
7. 전달받은 남은 시간 예산을 40초 이하로 제한하고 AbortSignal에 연결한다.

검증 게이트:

- 인증, DTO 검증, 세 상태와 공급자 오류의 API 계약 테스트가 통과한다.
- 사전검사는 미리보기 revision을 만들지 않는다.
- 최종 저장이 캐시된 구간을 재사용한다.

### 5단계: MCP 공통 추천·교체 오케스트레이터

변경 목적:

- GPTs와 GPT 앱에서 동일한 교체·확인·저장 흐름을 사용한다.

주요 작업:

1. 두 진입점의 `생성 → 저장` 중복을 공통 추천 오케스트레이터로 이동한다.
2. MCP 요청 시작 시 60초보다 짧은 전역 deadline을 만든다.
3. AI 일정 생성 후 대중교통만 웹 사전검사를 호출한다.
4. `replacement_required`이면 실패 후보를 제외하고 같은 `stopRef`를 최대 세 후보까지 교체한다.
5. 세 후보가 실패하면 AI 장소를 모든 경로에서 제거하고 체류시간을 자유시간으로 남긴다.
6. `confirmation_required`이면 공개 `needs_clarification`으로 변환한다.
7. 사전검사가 성공한 뒤 최종 저장 API를 한 번 호출한다.
8. 최종 저장의 구조화된 422는 안전장치로만 처리하고 남은 deadline이 부족하면 추가 루프를 중단한다.

검증 게이트:

- GPTs REST와 GPT 앱 도구가 같은 모의 시나리오에서 같은 상태를 반환한다.
- 후보·시간 상한과 단일 최종 저장 호출이 검증된다.
- 최종 성공 전 상세 URL을 노출하지 않는다.

### 6단계: 경로 최종화와 시간표

변경 목적:

- 공급자·추정 이동시간을 이후 일정 시각에 반영한다.

주요 작업:

1. 현재 시간표 바이트 불변 검사를 신규 참조 기반 재계산으로 교체한다.
2. 경로별 첫 출발 시각부터 구간 시간과 체류시간을 순차 합산한다.
3. CarryME 짐 숙소 이벤트를 Standard 숙소 도착과 동기화한다.
4. 날짜 경계를 넘으면 원자 저장을 중단한다.
5. 실제·추정 구간 상태를 경로와 일차에 집계한다.
6. 하나라도 추정이면 `savingStatus="hidden_estimated"`로 저장하고 절약 숫자·문구를 생략한다.

검증 게이트:

- 제목·설명·순서를 보존하면서 시각만 계산대로 바뀐다.
- 레거시 일정은 참조가 없으면 시간표가 바뀌지 않는다.
- 추정 일정도 허용 기준 안이면 `routeFinalized=true`다.

### 7단계: 공개 스키마와 화면

변경 목적:

- 두 ChatGPT 표면과 상세 화면이 추정 상태를 같은 방식으로 처리한다.

주요 작업:

1. GPT 앱 Zod 입력과 GPTs OpenAPI에 장소 의도 필드를 추가한다.
2. GPTs `savedMinutes`를 필수 목록에서 제거하고 `savingStatus`를 추가한다.
3. GPT 앱의 요약 응답도 `savingStatus`를 반환하고 숨김 상태에서 `savedMinutes`를 생략한다.
4. `TimelinePanel`, `RouteMap`, `ItineraryDashboard`가 절약 라벨 선택값을 허용하고 숨김 상태에서 렌더링하지 않는다.
5. MCP 위젯도 `savedDurationLabel` 부재를 빈 문자열로 표시하지 않고 요소를 숨긴다.

검증 게이트:

- 추정 상태에서 `0분 절약`과 `경로 계산 불가` 문구가 보이지 않는다.
- 공급자 값만 있는 일정의 기존 절약시간 UI가 유지된다.
- GPTs OpenAPI와 MCP 도구 스키마 계약 테스트가 통과한다.

### 8단계: 실제 공급자 검증과 활성화

변경 목적:

- 모의 테스트가 증명하지 못하는 계약·반경·시간 예산을 확인한다.

주요 작업:

1. `PLANME_TRANSIT_ACCESS_RECOVERY_MODE=off` 상태로 코드를 PR 병합·자동 배포한다.
2. 별도 검증 배포가 있으면 그 환경을 사용한다. 없으면 `smoke` 전환 PR을 병합하고 서명된 내부 스크립트만 허용한 상태에서 실제 ODsay 도보 계약, 검색 반경, 호출 수와 대표 사례 시간을 확인한다.
3. 스모크 측정값으로 `PLANME_ODSAY_MAX_REQUESTS_PER_TRACE`를 확정한다.
4. 맞춤형 GPT PlanME Action OpenAPI를 다시 가져온다.
5. 활성화 조건이 충족되면 별도 승인·PR로 MCP와 웹을 함께 `on`으로 전환한다.
6. 배포 직후 GPTs와 GuideME-PlanME 앱을 각각 새 대화에서 테스트하고 자동차 회귀와 관측 지표를 확인한다.

## 예상 변경 파일

| 파일 | 변경 목적 | 주의점 |
| --- | --- | --- |
| `packages/planme-core/src/gpt-actions.ts` | 장소 의도 정규화, 교체 함수와 응답 상태 | 기존 지역을 필수 장소로 처리하는 흐름 제거 |
| `packages/planme-core/src/place-candidates.ts` | 필수 장소 배열과 장소 종류 타입 | 기존 단일 destination 의존 제거 |
| `packages/planme-core/src/draft-itineraries.ts` | `stopRef`·타임라인 매핑과 저장 변환 | 레거시 시간표 추론 금지 |
| `packages/planme-core/src/openai-itinerary-generator.ts` | 신규 구조화 출력 필드와 교체 세 번째 시도 | 신규 생성 결과만 엄격 검증 |
| `packages/planme-core/src/mock-data.ts` | 공유 일정·경로·절약 상태 타입 | 기존 fixture를 한 번에 깨뜨리지 않도록 선택 필드 |
| `apps/mcp/src/planme-mcp.ts` | 앱 도구 스키마, 내부 웹 클라이언트 | 60초 전역 deadline 보존 |
| `apps/mcp/src/gpts-actions-api.ts` | REST Zod·OpenAPI·응답 DTO | `savedMinutes` 필수 제거 |
| `apps/mcp/src/itinerary-recommendation-flow.ts` 후보 | 두 진입점 공통 사전검사·교체·저장 | 신규 파일, HTTP 책임은 MCP에 한정 |
| `apps/web/app/api/gpt/itineraries/transit-preflight/route.ts` 후보 | 내부 접근성 사전검사 | 내부 bearer 인증 필수 |
| `apps/web/lib/internal-api-request.ts` 후보 | 내부 인증·추적 ID 공통화 | 민감 헤더 로깅 금지 |
| `apps/web/lib/route-segment-cache.ts` 후보 | 5분 Redis·메모리 캐시 | 키에 좌표 원문 금지 |
| `apps/web/lib/route-provider-call-budget.ts` 후보 | 추적 ID별 Redis 호출 카운터 | 모든 실제 요청 직전에 원자 소비 |
| `apps/web/lib/route-providers/odsay.ts` | 정류장·도보 복구와 오류 분류 | 실제 계약 전 기능 비활성 |
| `apps/web/lib/route-providers/types.ts` | 실제·추정 구간 타입 | 자동차 결과 기본값 명시 |
| `apps/web/lib/itinerary-route-finalizer.ts` | 캐시 재사용, 시간표 적용, 구조화 오류 | 원자성 유지 |
| `apps/web/lib/itinerary-timeline-finalizer.ts` 후보 | 참조 기반 시각 재계산 | 제목 기반 추론 금지 |
| `apps/web/lib/preview-itinerary-store.ts` | 저장 JSON 호환성 확인 | 저장 버전 3은 불필요 |
| `apps/web/components/itinerary/ItineraryDashboard.tsx` | `savingStatus` 표시 판정 | 자동차 상세 화면 보존 |
| `apps/web/components/itinerary/TimelinePanel.tsx` | 절약 칩 조건부 렌더링 | 신규 경고 UI 추가 금지 |
| `apps/web/components/itinerary/RouteMap.tsx` | 지도 절약 안내 조건부 렌더링 | 추정 직선 경로 생성 금지 |
| `apps/mcp/src/planme-widget.ts` | 절약 문구 부재 처리 | 기존 위젯 URI 유지 |
| `apps/mcp/vercel.json` | 배포 모드 기본값과 함수 시간 설정 확인 | 기본 `off`, maxDuration 60초 유지 |

파일 후보는 구현 시 기존 책임을 다시 확인한 뒤 합치거나 나눌 수 있다. 이름이 바뀌면 구현 결과 문서에 설계 대비 차이를 기록한다.

## 트랜잭션과 정합성

- 접근성 사전검사: 읽기·공급자 호출·캐시 쓰기만 수행하며 일정 저장 잠금을 잡지 않는다.
- 최종 저장: 기존 일정 ID 잠금, 기준 revision 확인, 전체 경로 최종화, Redis Lua 원자 저장을 유지한다.
- AI 장소 교체: MCP 메모리 안의 일정 복사본에만 적용하고 성공 전 외부 저장하지 않는다.
- 캐시 실패: 경로 정확성은 유지되지만 시간 예산 보장이 깨지므로 운영 활성화 전에는 중단 조건이다.
- 배포 모드 불일치: MCP가 `on`인데 웹이 `off`·`smoke`이면 안정적인 설정 오류로 종료하고 기존 저장을 시도하지 않는다.

배포 모드 기술 식별자는 `PLANME_TRANSIT_ACCESS_RECOVERY_MODE`로 통일하고 값은 `off | smoke | on`, 기본값은 `off`다. 정류장 검색 반경 목록은 `PLANME_ODSAY_STATION_SEARCH_RADII_METERS`, 추적 ID별 공급자 호출 상한은 `PLANME_ODSAY_MAX_REQUESTS_PER_TRACE`로 주입한다. 실제 검증된 값이 없으면 `on` 모드를 허용하지 않는다. 모드 전환은 비민감 배포 설정 변경 PR과 자동 배포로만 수행한다.

## 미확인 자료

- ODsay 운영 계정의 `searchWalkPathV2` 서버 호출 권한
- `pointSearch` 최대 허용 반경과 비용
- 대표 남해 목적지의 실제 정류장·보행 도로망 결과
- 맞춤형 GPT가 OpenAPI 재가져오기 전까지 유지하는 캐시 기간

## 중단 조건

- 실제 도보 API가 운영 계약에서 허용되지 않음
- 실제 정류장 검색 반경으로 대표 목적지를 찾을 수 없음
- 운영 공유 Redis 캐시를 사용할 수 없음
- 대표 일정이 MCP 전역 시간 예산을 반복해서 초과함
- 검증된 추적 ID별 공급자 호출 상한이 없거나 상한 이후 실제 요청이 실행됨
- 같은 동시 실패 입력에서 다른 `stopRef`가 선택됨
- 사용자 고정 장소가 교체·제거됨
- 추정 구간에 절약시간이나 가짜 경로선이 노출됨
- 자동차 요청이 신규 대중교통 코드를 실행함

중단 조건이 발생하면 `on` 모드를 활성화하지 않거나 `off` 전환 PR로 원복한다. 자료형의 레거시 읽기 호환성과 기존 자동차 동작은 유지한다.
