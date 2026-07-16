# GUI-157 완료 기준 추적표

## 결론

[GUI-157 완료 검증 기준](../../PlanME%20좌표%20보장%20및%20대중교통%20표시%20개선%20GUI-157/01_interview/completion-criteria.md)을 V3에 다시 적용한 결과, 현재 결정과 양립하는 자동 검증은 통과했다. Google 장소 검색, AI의 장소 사실 생성, 장소 추가 질문은 V3 정책으로 대체됐으며 재도입하지 않는다.

실제 양양 → 거제 생성은 운영 PlanME GPT 기본 주소의 새 채팅과 GPT Action으로 실행했다. TourAPI 후보·숙소·방문 장소, Luna 선택, Naver 지오코딩, ODsay 대중교통 경로, Upstash revision 1 저장을 거쳐 `ready` 일정과 상세 페이지가 생성됐다. 따라서 실제 공급자 조합과 원격 저장 성공을 운영 적용·통과로 판정한다.

## 판정 기준

| 상태 | 의미 |
| --- | --- |
| 적용·통과 | V3에도 그대로 적용되며 자동 검증 근거가 있다. |
| V3 대체·통과 | GUI-157의 구형 구현 방식 대신 현재 승인된 V3 계약으로 같은 위험을 차단한다. |
| 적용·통과 (V2 유지) | V3가 대체하지 않는 기존 상세 화면·경로 표시 계약을 자동 테스트로 보존한다. |
| 운영 적용·통과 | 실제 외부 서비스와 원격 저장소를 사용한 운영 시나리오 증거가 있다. |

## 운영 ChatGPT 최종 점검 시나리오

### 공통 규칙

- 모든 조합은 운영 PlanME GPT의 독립된 새 채팅에서 실행한다.
- 각 큰 시나리오는 자동차와 대중교통을 번갈아 실행한다.
- 첫 프롬프트에 출발지와 이동 수단이 모두 없으면 두 항목만 순서대로 확인한다.
- 사용자가 이미 답한 출발지 또는 이동 수단은 같은 대화의 다음 턴에서도 유지하며 다시 묻지 않는다.
- 네 필수 항목인 출발지, 목적지, 이동 수단, 여행 일수가 모두 모이면 추가 질문 없이 일정을 생성한다.
- 출발지 `동탄`과 `마포구청`은 유효한 입력으로 처리하며 더 구체적인 주소나 장소명을 요구하지 않는다.
- 한 조합이라도 이동 수단 재질문, 답변한 조건 유실, 출발지 재입력 요구, 일정 생성 실패가 발생하면 최종 점검을 통과로 판정하지 않는다.

### 시나리오 1: 부산역 1박 2일

첫 프롬프트는 정확히 `부산역 1박 2일 여행 추천`을 사용한다.

| 조합 | 출발지 답변 | 이동 수단 답변 | 현재 상태 |
| --- | --- | --- | --- |
| 1-A | `동탄` | `자동차` | 실패 — 이동 수단 재질문 |
| 1-B | `동탄` | `대중교통` | 실패 — 이동 수단 재질문 |

### 시나리오 2: 양양 2박 3일

첫 프롬프트는 정확히 `양양 2박 3일 여행 추천`을 사용한다.

| 조합 | 출발지 답변 | 이동 수단 답변 | 현재 상태 |
| --- | --- | --- | --- |
| 2-A | `마포구청` | `자동차` | 실패 — 이동 수단 재입력 요구 |
| 2-B | `마포구청` | `대중교통` | 실패 — 이동 수단 재질문 |

### 2026-07-14 운영 실행 결과

| 조합 | 새 채팅 | 관측한 질문 순서 | 최종 판정 |
| --- | --- | --- | --- |
| 1-A | [대화](https://chatgpt.com/g/g-6a4f8507a7608191b72b721e54b889ff-planme/c/6a563b6c-fa60-83ee-9f22-f0e32acbe52a) | 이동 수단 → 출발지 → 이동 수단 | 실패 |
| 1-B | [대화](https://chatgpt.com/g/g-6a4f8507a7608191b72b721e54b889ff-planme/c/6a563c16-65ac-83e8-bba5-dfd8f9cd0ec4) | 이동 수단 → 출발지 → 이동 수단 | 실패 |
| 2-A | [대화](https://chatgpt.com/g/g-6a4f8507a7608191b72b721e54b889ff-planme/c/6a563c92-2764-83ee-a24c-6bedb6166b25) | 이동 수단 → 출발지 → 이동 수단 재입력 요구 | 실패 |
| 2-B | [대화](https://chatgpt.com/g/g-6a4f8507a7608191b72b721e54b889ff-planme/c/6a563cec-c54c-83ee-9791-7784c9a6c0de) | 이동 수단 → 출발지 → 이동 수단 | 실패 |

네 실행 모두 사용자가 이동 수단을 답한 뒤 출발지를 답하면 최종 `recommendPlanmeItinerary` Action 요청에서 `transportMode`가 누락됐다. 서버는 이동 수단이 없는 요청을 입력 부족으로 판정했고 GPT가 같은 이동 수단을 다시 물었다. 일정 ID와 상세 링크는 생성되지 않았다. 따라서 신규 운영 완료 게이트는 실패이며, 대화 상태 보존을 수정하고 네 조합을 새 채팅에서 다시 통과하기 전에는 완료로 표시하지 않는다.

## 완료 기준별 추적

| GUI-157 완료 기준 | 판정 | V3 또는 유지 계약 | 자동 검증 근거 |
| --- | --- | --- | --- |
| 양양 → 거제 1박 2일 실제 MCP 생성 | 운영 적용·통과 | 운영 PlanME GPT 기본 주소의 새 채팅에서 Action을 허용해 대중교통 revision 1 일정을 생성했다. 상세 페이지는 거제 방문 장소 3곳과 소노캄 거제 숙소를 표시한다. | 운영 일정 `planme-v3-fc53b4c0-d9ff-404c-ade5-72961d2fde65`, 공개 상태 API `ready` |
| 초안의 모든 장소를 Function Calling 검색으로 확인 | V3 대체·통과 | 일정 장소는 TourAPI snapshot만 사용하고 Luna는 snapshot의 `contentId` 선택·순서만 제안한다. | `npm run test:v3`의 V3-01~03, 공급자 계약 |
| AI가 후보를 `accepted`/`ambiguous`/`rejected`로 판단 | V3 대체·통과 | 구형 AI 판정 대신 후보 밖 ID·유형·중복·추가 필드를 strict 거부하고 실패 폐쇄한다. | `npm run test:v3`의 V3-01·03 |
| Google Places 1순위 자동 대체 미사용 | V3 대체·통과 | Google 장소 소스를 사용하지 않으며 TourAPI 정규화 후보만 일정에 저장한다. | `npm run test:v3`의 V3-01~03, 정적 금지 검색 |
| 좌표 없는 장소는 링크로 저장하지 않음 | 적용·통과 | TourAPI 후보 정규화에서 유효한 `mapx`·`mapy`가 없는 일정 장소를 제외하고 revision snapshot 참조를 다시 검증한다. | `npm run test:v3`의 V3-02 |
| `placeId` 또는 검색 출처 없는 장소는 링크로 저장하지 않음 | V3 대체·통과 | Google `placeId` 대신 TourAPI `contentId`와 snapshot 참조가 필수다. | `npm run test:v3`의 V3-01·02 |
| 장소가 애매하면 ChatGPT에서 최대 2개 질문 | V3 대체·통과 | 사용자 질문은 `origin`, `destination`, `transportMode`, `durationDays`만 허용한다. 장소 추가 질문은 하지 않고 TourAPI 미검색 장소를 제외 목록으로 알린다. | `npm run test:v3`의 V3-04, `npm run test:local-v3` allowlist·제외 목록 |
| 답변을 포함해 장소 검색 재실행 | V3 대체·통과 | 장소 clarification을 없앴으므로 재검색 대화도 없다. 새 입력은 새 요청으로 처리한다. | V3-04, MCP 입력 계약 |
| 되묻기 최대 2라운드 | V3 대체·통과 | 네 입력값 밖 질문 자체를 금지하므로 장소 질문 라운드가 없다. | V3-04, 로컬 MCP 질문 allowlist |
| 2라운드 뒤 내부 AI 최후 확정 | V3 대체·통과 | AI가 장소 사실을 확정하지 않는다. TourAPI 후보만 선택하며 strict 실패 뒤 결정적 후보 배열을 사용한다. | V3-01·03, Luna 재시도·fallback 공급자 계약 |
| 최후 후보도 좌표와 검색 출처 hard gate 통과 | V3 대체·통과 | 선택된 모든 `contentId`가 좌표를 가진 TourAPI snapshot에 존재해야 revision 활성화가 가능하다. | V3-01·02 |
| Redis/Upstash 일별 호출량 카운터 | 운영 적용·통과 | TourAPI, OpenAI, Naver geocode·Directions, ODsay, ready 이벤트를 안전 기록한다. 운영 작업 생성·단계 전이·revision 1 활성화 뒤 별도 상세 페이지와 공개 상태 API에서 재조회했다. | 운영 일정 `ready` 재조회, `npm run test:v3` 공급자·오케스트레이터 usage assertion |
| 장거리 본선 polyline이 없으면 선 없음 | 적용·통과 (V2 유지) | ODsay `mapObj` 경로가 없으면 `paths=[]`, `geometryStatus=partial`이며 직선 대체선을 만들지 않는다. | `npm run test:completion` |
| 지도에 첫 탑승역·최종 하차역 마커 | 적용·통과 (V2 유지) | ODsay 제공 좌표로 boarding·alighting marker만 만들고 지도에 역할별 marker를 표시한다. | `npm run test:completion` |
| 타임라인에 탑승·하차 이벤트 | 적용·통과 (V2 유지) | marker를 장거리 탑승·하차 timeline event로 변환한다. | `npm run test:completion` |
| partial route를 완료로 오인 표시하지 않음 | 적용·통과 (V2 유지) | 경로와 상위 결과를 `partial`로 유지하고 본선 좌표 미제공 경고를 표시한다. `경로 체크 완료` 문구는 없다. | `npm run test:completion` |
| 기존 부산/데모 E2E 회귀 없음 | 적용·통과, 기존 실패 분리 | 부산 지도·편집과 V3 위젯 관련 5건은 통과했다. 전체 15건 중 4건의 기존 V2 환경 의존 실패는 별도 기록한다. | 관련 Playwright 5 passed, 전체 11 passed·4 failed |
| `PLANME_WEB_ORIGIN`이 저장·링크·widget metadata에 반영 | 적용·통과 | 웹 오케스트레이터가 해당 origin으로 page URL을 만들고 MCP 결과·widget이 같은 URL을 사용한다. | `npm run test:mcp`, `npm run test:local-v3` |
| metadata/OG/H1의 `PlanME` prefix 제거 | 적용·통과 | title·OG title·H1은 일정 제목으로 시작한다. 전역 title suffix `| PlanME`는 prefix가 아니므로 유지한다. | `npm run test:local-v3` 브라우저 assertion |
| 상단 Standard / CarryME 정렬 | 적용·통과 | 생성 링크에서 두 제목의 세로 위치가 1px 미만 차이인지 확인한다. | `npm run test:local-v3` 브라우저 assertion |
| `npm run test:actions` | 적용·통과 | Actions 계약과 정적 경계를 검증한다. | 통과 |
| `npm run test:mcp` | 적용·통과 | 기존 MCP와 V3 도구·widget resource 계약을 검증한다. | 통과 |
| 관련 Playwright | 적용·통과, 기존 실패 분리 | 부산 지도·편집과 V3 widget의 관련 범위는 통과했다. | 5 passed |
| 로컬 웹/MCP 실제 tool 호출과 링크 화면 | 적용·통과 | 웹 3011·MCP 8791 실제 HTTP/JSON-RPC에서 processing → advance → ready → revision 1 링크 → Chromium 화면을 확인했다. | `npm run test:local-v3` |

## 로컬 두 서버 증거

`npm run test:local-v3`는 프로덕션에서 켤 수 없는 결정적 TourAPI 형태 fixture를 사용한다. 이 경로는 다음을 한 번에 검증한다.

- MCP 초기화와 도구 목록 조회
- 네 질문 슬롯 allowlist
- 동일 요청 ID replay 시 같은 itinerary ID
- 같은 ID의 다른 입력 충돌
- processing 중 자동 advance와 terminal 뒤 중단
- ready에서만 revision 1 page URL 노출
- TourAPI에 없는 요청 장소의 제외 결과
- 생성 링크의 active revision, 부산 일정·해운대·부산 호텔 렌더링
- metadata·OpenGraph·H1와 Standard/CarryME 정렬
- 브라우저 TourAPI·OpenAI·Naver Directions·ODsay 요청 0건

fixture는 `NODE_ENV !== production`과 `PLANME_V3_LOCAL_FIXTURE=1`을 동시에 만족할 때만 활성화된다. 프로덕션 fallback 또는 장소 생성 경로가 아니다.

## 리스크와 미확인

- 단일 운영 양양 → 거제 성공은 모든 외부 공급자 오류 응답을 증명하지 않는다. 인증 실패, 일시 오류, 700m 이내 예상 도보, 장거리 선형 없음은 mock 계약 테스트로 보완한다.
- 전체 Playwright의 기존 4개 실패는 V2 preview 저장소의 프로세스 간 memory 비공유와 외부 경로 확정 환경에 의존한다. V3 관련 회귀로 오인하지 않되 별도 개선 전에는 전체 E2E 녹색 상태가 아니다.
- GUI-157의 지도·타임라인 기준은 기존 V2 화면을 보존하는 기준이다. 현재 V3 상세 화면에 새 지도를 추가하는 것은 승인된 GUI-205 범위를 넓히므로 이번 Goal에서 확장하지 않았다.

## 완료 판단

기존 적용 기준과 V3 대체 기준에는 자동 증거가 있고, 운영 GPT 새 채팅에서 실제 외부 공급자 조합과 Upstash revision 활성화 및 상세 페이지 재조회까지 확인했다. 다만 위에 추가한 운영 ChatGPT 최종 점검 네 조합은 모두 이동 수단 상태 유실로 실패했으므로 현재 최종 점검은 완료되지 않았다. 대화 상태 보존을 수정한 뒤 네 조합이 모두 통과하고 증거가 기록돼야 GUI-205 최종 완료로 판정할 수 있다.
