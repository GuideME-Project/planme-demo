# 검증 계획

## 결론

V3 완료 기준은 “일정이 한 번 생성된다”가 아니라 장소 원천, AI 권한, 시간표, 경로 보정, revision과 채널 경계가 자동 검증으로 고정되는 것이다.
아래 필수 게이트 중 하나라도 실패하면 구현 또는 PR 완료로 보지 않는다.

실제 외부 API 호출 검증은 모의 계약 테스트를 대체하지 않는다. 외부 상태와 할당량 때문에 결과가 흔들릴 수 있으므로 결정적 테스트를 먼저 통과시키고, 민감값·비용 영향에 대한 별도 실행 승인 뒤 smoke를 수행한다.

## 필수 회귀 게이트

| ID | 검증 | 성공 기준 |
| --- | --- | --- |
| V3-01 | AI 허용 목록 | 후보에 없는 `contentId`가 한 건도 저장되지 않음 |
| V3-02 | TourAPI 스냅샷 | 모든 일정 장소가 같은 revision의 스냅샷을 참조 |
| V3-03 | AI 필드 차단 | AI 이름·좌표·시간표·설명이 저장 데이터에 반영되지 않음 |
| V3-04 | 질문 allowlist | 네 허용 슬롯 외 질문이 생성되지 않음 |
| V3-05 | ODsay 오류 행렬 | `-98`, 411~414, 일시 오류와 실패 폐쇄가 계약대로 동작 |
| V3-06 | revision 원자성 | 편집 실패·충돌에서 active가 바뀌지 않음 |
| V3-07 | ID·멱등성 | 새 요청은 새 ID, 같은 멱등 요청은 같은 ID |
| V3-08 | 채널 공통성 | GPTs와 GPT App이 같은 오케스트레이터 결과 사용 |
| V3-09 | 브라우저 경로 차단 | 브라우저가 ODsay·네이버 Directions를 직접 호출하지 않음 |
| V3-10 | TourAPI 캐시 | fresh·빈 응답·유형별 장애·stale 정책이 계약대로 동작 |

## 단위·계약 테스트

### TourAPI 정규화

다음 고정 fixture를 사용한다.

- 모든 필드가 있는 관광지·숙박·음식점
- `mapX` 또는 `mapY` 누락
- 0, 숫자 아님, 위경도 반전과 범위 초과
- 같은 `(contentTypeId, contentId)` 중복
- 여행코스 유형 25
- 날짜 범위 안·밖 행사
- 정상 빈 응답
- HTTP 429·500, 네트워크 오류와 TourAPI 오류 본문

검증:

- 유효 후보만 `TourPlaceSnapshot`으로 변환된다.
- 이름·좌표를 AI나 다른 공급자로 보충하지 않는다.
- 정상 빈 응답에 last-good이 사용되지 않는다.
- 장애가 난 유형만 last-good을 사용한다.
- stale 후보에는 `fetchedAt`, `cacheStatus=stale`가 유지된다.

### AI 계약

고정 후보 스냅샷과 모의 Responses API 응답을 사용한다.

- 정상 `contentId` 배열
- 허용 목록 밖 ID
- 숙소가 아닌 lodging ID
- 음식점 슬롯에 관광지 ID
- 숙소 외 중복 ID
- 추가 `title`, `coordinate`, `time` 필드
- day 수 불일치와 day 번호 중복
- 빈 응답, 잘못된 JSON, 네트워크 오류

검증:

- 정상 응답만 `AiPlanSelection`이 된다.
- 추가 필드도 조용히 제거하지 않고 전체 거부한다.
- 같은 Luna 한 번 재시도 뒤 결정적 배열기로 전환한다.
- 결정적 배열기는 같은 후보 스냅샷에서 같은 결과를 만든다.
- 다른 모델과 V2 생성기는 호출되지 않는다.

### 질문 정책

모든 입력 조합에 대해 생성 가능한 질문 슬롯 집합이 다음의 부분집합인지 검사한다.

```text
origin, destination, transportMode, durationDays
```

- 네 값이 모두 있으면 숙소·선호가 없어도 ready다.
- TourAPI 장소 부족은 질문으로 변환되지 않는다.
- 출발지 확인 실패는 origin만, 목적지 확인 실패는 destination만 다시 질문한다.
- 자발적 선택 입력이 잘못돼도 신규 질문 슬롯을 만들지 않는다.

### 일정 계산

- 1일, 2일, 14일 경계
- 장소가 일수보다 많은 경우와 적은 경우
- 음식점 없음, 숙소 없음, 실제 방문 장소 없음
- 첫날 실제 도착이 늦은 경우
- 중간 날 09:30, 마지막 날 09:30·17:00 규칙
- 점심·저녁 시간창
- 같은 contentId 중복 금지
- 장소 부족 시 자유시간·숙소 휴식
- Standard 숙소 경유와 CarryME 수하물 분리
- 이동시간 증가로 다음 일차 이동 또는 장소 제외

검증 결과의 모든 시간은 서버 경로 duration에서 전파돼야 한다. AI fixture의 임의 시간 문자열은 입력에도 없어야 한다.

### 경로 오류 행렬

모의 ODsay·네이버 제공자를 주입해 구간별로 검사한다.

- `-98`, 거리 699m: 도보 API 호출
- `-98`, 거리 701m: 예상 도보 금지
- 도보 411~414, 거리 700m 이하: 시속 4km·분 올림·최소 1분
- `estimated_walk`: 빈 paths, geometry unavailable
- 3·4·5·6·`-99`: 선택 장소 제외, 필수 기준점 실패
- `-8`·`-9`, 인증 오류, 미분류 오류: 재시도 없이 실패
- 408·429·500·`-1`: 해당 구간 한 번만 재시도
- 첫 실패가 다른 성공 revision을 덮어쓰지 않음

### Redis 정합성

메모리 구현과 Upstash 추상화가 같은 계약을 통과해야 한다.

- 새 ID가 정규화 입력과 무관하게 매번 다름
- 같은 멱등성 키·같은 입력은 같은 ID
- 같은 키·다른 입력은 409
- 동시에 같은 base revision 편집 시 하나만 활성화
- 실패한 pending 삭제와 active·previous 불변
- 성공 시 previous=기존 active, active=새 revision
- revision과 meta의 절대 만료시각 일치
- V1/V2 키를 읽거나 삭제하지 않음
- 잠금 만료 후 같은 단계 안전 재개

## 채널 통합 테스트

### GPTs Actions

- planning OpenAPI enum에 네 질문 슬롯만 존재한다.
- recommendation 요청에는 사용자에게 묻지 않는 기술 필드 `invocationId`가 필수다.
- 같은 `invocationId`·같은 body 재전송은 같은 ID와 결과를 반환하고 다른 body는 409다.
- recommendation은 한 Action 요청에서 42초 안에 ready 또는 terminal failed를 반환한다.
- GPTs 공개 응답에는 processing과 후속 advance 지시가 없다.
- terminal failed는 clarification 질문을 반환하지 않는다.
- ready 이전에 detail URL을 성공 링크로 노출하지 않는다.

### GPT App MCP

- `recommend_planme_itinerary`가 공통 start를 호출하고 processing 위젯을 렌더링한다.
- 처리 중 위젯이 사용자 동작 없이 `get_planme_itinerary`를 자동 호출한다.
- `get_planme_itinerary`가 processing 동안 단계 진행을 호출하고 ready·failed에서 자동 호출을 멈춘다.
- 위젯이 TourAPI·Luna·경로 공급자를 직접 호출하지 않는다.
- GPTs와 같은 입력·fixture에서 같은 itinerary revision DTO가 나온다.
- 두 채널에서 모델 프롬프트나 TourAPI 후보 수집 함수가 중복 구현되지 않는다.
- MCP 배포에는 V3 OpenAI·TourAPI 클라이언트를 두지 않는다.

기존 [MCP 검사 스크립트](../../../../apps/mcp/scripts/check-planme-mcp.ts)는 V3 DTO와 비동기 상태를 기준으로 갱신한다. 네이버 검색·AI 시간표 보존을 성공 조건으로 보는 기존 assertion은 제거한다.

## 웹 E2E

모의 외부 제공자와 고정 Redis 저장소를 사용해 다음을 검증한다.

1. processing 중 장소·경로를 임시 표시하지 않는다.
2. ready 후 active revision만 표시한다.
3. 일차 전환·새로고침에서 브라우저 provider 요청이 0건이다.
4. TourAPI 후보를 선택한 편집만 제출할 수 있다.
5. 편집 processing 동안 기존 active가 유지된다.
6. 편집 성공 시 두 변형과 전체 시간표가 한 revision으로 교체된다.
7. 편집 실패·409에서 기존 active가 유지된다.
8. `estimated_walk`에 지도 경로선이 없고 예상 상태가 표시된다.
9. GPT 결과에는 제외 안내가 있고 웹 상세에는 없다.

브라우저 요청 감시는 다음 URL을 포함한다.

- `api.odsay.com`
- `/api/naver/directions/routes`
- 네이버 Directions 외부 origin

웹이 호출할 수 있는 것은 전체 일정 상태·편집 오케스트레이터와 TourAPI 장소 후보 API뿐이다.

## 기존 테스트 전환

| 현재 테스트 | V3 변경 |
| --- | --- |
| `test:mcp` | 네이버 tool·AI timeline fixture를 TourAPI ID 선택과 비동기 상태 fixture로 교체 |
| `test:finalization` | “AI 시간표 불변” assertion 제거, 실제 이동시간 기반 서버 시간표 검증 추가 |
| `test:actions` | GPTs OpenAPI 네 질문 슬롯, invocationId, 42초 동기 ready·failed 계약 검증 |
| `test:route-normalization` | TourAPI 스냅샷 참조와 `estimated_walk` 정규화 추가 |
| `itinerary-finalized-routes.spec.ts` | 브라우저 provider 0건은 유지, V3 active/pending 전환으로 수정 |
| `destination-editor-recorded-flow.spec.ts` | 네이버 장소 fixture를 TourAPI contentId fixture로 교체 |

V3 전용 계약 스크립트를 추가할 경우 루트 `test:v3` 하나에서 핵심 단위·계약 검사를 실행하고, 기존 스크립트와 역할이 겹치지 않게 한다.

## 정적 검증

- TypeScript 빌드와 MCP typecheck
- ESLint
- OpenAPI 스키마 생성 및 import 가능한 JSON 검사
- `rg` 기반 금지 경계 검사:
  - V3 생성 경로의 `search_naver_places`
  - AI 스키마의 `standardTimeline`, `carrymeTimeline`, 좌표 필드
  - 브라우저의 `api.odsay.com`, `NEXT_PUBLIC_ODSAY_API_KEY`
  - V3 질문 enum의 `hotelName`, `preferences`

텍스트 검색은 보조 게이트이며 동작 테스트를 대체하지 않는다.

## 외부 연동 smoke

실제 호출은 다음 순서로 수행한다.

1. 개발 TourAPI 키로 한 지역의 관광지·숙소·음식점 조회
2. `gpt-5.6-luna`, `low`로 한 후보 선택
3. 네이버 자동차 경로 한 일정
4. ODsay 대중교통 한 일정과 700m 근거리 사례
5. 저장된 revision을 GPT App 또는 GPTs 결과와 웹에서 비교

실행 전 확인할 항목:

- 키가 개발용인지 운영용인지
- 호출 할당량과 예상 호출 수
- 실제 외부 요청 허용 승인
- 민감값이 출력되지 않는 로그 설정

외부 서비스의 일시 장애로 smoke가 실패하면 실패를 숨기지 않고 명령, 관측 이유와 모의 계약 테스트 결과를 분리해 보고한다.

## 성능과 payload 검증

- 한 advance 단계가 서버리스 실행 제한 안에 끝나는지 측정한다.
- GPTs의 1일·14일 mock 실행이 42초 내부 예산 안에 terminal 상태가 되는지 측정하고 45초를 넘기기 전에 안전하게 응답하는지 검사한다.
- 14일 일정의 candidate prompt 크기와 Luna 입력 토큰을 기록한다.
- 1일·3일·14일 revision JSON 크기를 측정한다.
- 기존 E2E 기준인 1MB 미만을 우선 유지한다.
- 경로선이 payload를 키우면 좌표 단순화 또는 별도 경로 키 분리를 검토하되 장소·시간표 스냅샷은 유지한다.

## 완료 체크리스트

- [ ] V3-01~V3-10 모두 자동 통과
- [ ] 타입 검사, 빌드, 린트 통과
- [ ] GPTs·GPT App 공통 fixture 결과 일치
- [ ] 웹 브라우저 provider 호출 0건
- [ ] 실패한 편집에서 active 불변
- [ ] 금지된 AI 필드와 질문 슬롯 없음
- [ ] 테스트 로그에 키·토큰·원본 API URL 없음

## References

- [현재 코드와 전환 리스크](../01_interview/current-code-and-transition-risk.md)
- [현재 MCP 검사](../../../../apps/mcp/scripts/check-planme-mcp.ts)
- [현재 경로 확정 검사](../../../../apps/web/scripts/check-itinerary-finalization.ts)
- [현재 경로 E2E](../../../../apps/web/e2e/itinerary-finalized-routes.spec.ts)
- [현재 GPT 생성 E2E](../../../../apps/web/e2e/gpt-itinerary-generation.spec.ts)
