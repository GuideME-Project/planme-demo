# 검증과 테스트 계획

## 결론

테스트는 내부 문자열 조각으로 구현 방식을 고정하지 않는다.
AI가 생성한 stop role/mode 계약, 사용자가 보는 행선지 편집 라벨, GPT/MCP 응답 계약, 상세 화면 표시 결과를 검증한다.
특히 좌표 보강을 새로 만들었는지가 아니라 기존 장소 검색/상세 조회 흐름이 유지되는지 확인한다.

## 테스트 갱신 원칙

- 내부 함수명이나 과거 구현 세부 문자열을 필수 조각으로 검사하지 않는다.
- 공개 화면 문구, 공개 응답 필드, route plan 결과, timeline 결과를 검사한다.
- AI 생성 계약은 mock generator 입력/출력으로 검증한다.
- 새 생성 데이터는 role/mode 필수 계약을 검증한다.
- 기존 저장 preview는 role/mode가 없어도 상세 화면 열람이 가능해야 한다.
- 기존 저장 preview의 role/mode 누락은 role 확정 추론으로 메우지 않고 기존 caption 표시 또는 `확인 필요` 상태로 제한한다.
- role/mode가 없는 기존 저장 preview는 경로 재계산이 차단되어야 한다.
- 웹 대표 이동수단 선택지는 `자동차`, `대중교통`만 검증한다.
- `walk`는 웹 선택지로 노출하지 않는다. provider 내부 도보 sub-path까지 금지하지 않는다.
- 기존 Redis preview 저장값을 직접 수정하거나 migration하는 테스트는 만들지 않는다.
- CarryME timeline은 AI 제공 timeline을 우선 표시하고, 재계산/fallback 결과가 Standard timeline으로 덮지 않는지 검증한다.

## 자동 검증 후보

| 명령 | 목적 | 갱신 필요 |
| --- | --- | --- |
| `npm --workspace @planme/core run build` | core type/schema 변경 컴파일 확인 | role/mode type 오류 확인 |
| `npm run test:actions` | GPT Action/OpenAPI/preview image URL 계약 검증 | 공개 계약 기준 유지 |
| `npm run test:mcp` | MCP 생성, AI 계약, preview 저장 흐름 검증 | role/mode fixture 반영 |
| `npm run test:design` | 상세 화면/RouteMap/TimelinePanel 디자인 계약 검증 | index 기반 role, 웹 도보 선택지 회귀 방지 |
| `npx playwright test apps/web/e2e/gpt-itinerary-generation.spec.ts` | 저장된 generated itinerary 상세 화면 검증 | 새 role/mode fixture 반영 |

## 하위 호환 검증 방향

기존 저장 preview는 새 계약을 만족하지 않을 수 있다.
검증은 기존 저장값을 고치지 않고도 화면이 열리는지와, 의미를 임의 확정하지 않는지를 나눠서 본다.

- Fixture A:
  - 기존 preview payload에 stop 역할(`role`)과 웹 대표 이동수단(`mode`)이 없다.
  - 기존 preview payload에 표시 문구(`caption`)는 있다.
  - 상세 화면은 열려야 한다.
  - `index`, `name`, `caption`으로 stop 역할(`role`)을 확정하지 않아야 한다.
  - 화면 표시는 기존 표시 문구(`caption`)를 열람용으로만 사용할 수 있다.
  - 경로 재계산은 `확인 필요` 상태로 차단되어야 한다.
- Fixture B:
  - 기존 preview payload에 stop 역할(`role`)과 웹 대표 이동수단(`mode`)이 없다.
  - 기존 preview payload에 표시 문구(`caption`)도 없다.
  - 상세 화면은 열려야 한다.
  - `index`, `name`, `caption`으로 stop 역할(`role`)을 확정하지 않아야 한다.
  - 화면 표시는 `확인 필요` 상태를 보여야 한다.
  - 경로 재계산은 `확인 필요` 상태로 차단되어야 한다.
- role/mode가 없는 기존 preview 상세 URL이 렌더링된다.
- role/mode가 없는 row는 index 또는 장소명으로 `출발지`, `숙소`, `복귀지`를 확정하지 않는다.
- 표시 가능한 기존 `caption`이 있으면 caption을 보여주고, 없으면 `확인 필요` 상태로 표시한다.
- role/mode 누락 row가 포함된 상태에서는 경로 재계산 버튼 또는 재계산 요청이 차단된다.
- 차단 사유는 provider 실패 fallback과 구분된다. provider 실패는 Standard-equivalent fallback이지만 role/mode 누락은 사용자 확인 필요 상태다.

## mode 타입 검증 방향

웹 행선지 row 대표 이동수단과 provider 세부 segment 이동수단을 분리해서 검증한다.

- 웹 행선지 row 대표 이동수단은 `drive`, `transit`만 허용한다.
- AI 생성 stop의 mode도 웹 대표 이동수단 기준 `drive`, `transit`만 허용한다.
- provider 응답의 segment/sub-path에는 `walk`가 남을 수 있다.
- 웹 선택지에서 `walk`가 사라졌다는 검증이 provider 내부 도보 sub-path 제거 검증으로 확장되면 안 된다.

## `apps/mcp/scripts/check-planme-mcp.ts` 갱신 방향

AI generator contract fixture는 `standardStops`와 `carrymeStops`에 role/mode를 포함하도록 바꾼다.
검증은 다음을 본다.

- AI 프롬프트가 일자별 전체 이동 흐름과 stop role/mode를 요구하는지.
- mock AI 응답의 `role`이 `출발지`, `방문지`, `숙소`, `복귀지` 중 하나인지.
- mock AI 응답의 `mode`가 웹 대표 이동수단 기준 `drive` 또는 `transit`인지.
- mock AI 응답의 이동 구간이 있는 stop에 mode가 누락되면 계약 위반으로 잡히는지.
- 마지막 stop의 mode 생략이 허용되는 경우에도 요구사항 문구는 “처음부터 끝까지 모든 이동 구간 적용”으로 유지되는지.
- `carrymeTimeline`에 `짐 숙소 도착` 이벤트가 들어 있고 route 재계산/fallback으로 덮이지 않는지.
- 절약 없음 fixture에서 `savedMinutes = 0`과 `시간 절약 없음 · 짐 없이 바로 이동`이 유지되는지.

## `scripts/check-planme-design.mjs` 갱신 방향

디자인 계약 검증은 공개 동작과 회귀 위험 중심으로 둔다.

- 유지/추가 후보:
  - 상세 화면에 `짐 없이 바로 이동하는 경로`가 표시되는지.
  - 절약 없음 상태에서 `시간 절약 없음 · 짐 없이 바로 이동`이 표시되는지.
  - 행선지 편집이 stop role을 표시할 수 있는 구조인지.
  - index 기반 `출발지`/`도착지` 라벨 계산을 주요 표시 경로로 쓰지 않는지.
  - `createRouteStopsFromRows`가 index 기반 `getDestinationRole` 또는 name keyword icon inference를 주요 의미 판단으로 쓰지 않는지.
  - row role이 `RouteStop.caption` 또는 새 `role` 필드로 보존되는지.
  - icon이 role 기반 최소 매핑 또는 별도 표시 보조값이며 업무 의미 판단 근거가 아닌지.
  - 웹 이동수단 옵션에 `도보`가 노출되지 않는지.
  - `자동차`와 `대중교통` 선택지는 유지되는지.
  - provider 내부 segment/sub-path의 `walk` 타입은 금지하지 않는지.
  - CarryME timeline 렌더링이 `selectedDayPlan.carrymeTimeline ?? selectedDayPlan.timeline` 우선 또는 동등한 보존 정책을 따르는지.
- 제거 후보:
  - 레거시 role 문자열(`origin`, `visit`, `finalDestination`) 필수 검사.
  - 내부 함수명에 과하게 묶인 필수 검사.

## `scripts/check-planme-actions.mjs` 갱신 방향

GPT Action 계약 검증은 공개 응답 중심으로 유지한다.

- OpenAPI schema에 `ogImageUrl`과 `previewMarkdown`이 남아 있다.
- `.png` 미리보기 이미지 URL 형식이 유지된다.
- web generation POST generator가 다시 노출되지 않는다.
- 응답의 `savedMinutes`, `standardTotalMinutes`, `carrymeTotalMinutes`, `summary`가 새 문구 기준과 맞는다.

## Playwright 검증 방향

저장된 itinerary fixture를 새 의미에 맞게 갱신한다.
검증은 다음 사용자 표시를 중심으로 둔다.

- 상세 화면 heading과 일정 제목이 렌더링된다.
- 지도 범례에 `짐 없이 바로 이동하는 경로`가 표시된다.
- 절약 없음이면 `시간 절약 없음 · 짐 없이 바로 이동`이 표시된다.
- 행선지 편집 첫 방문지가 `출발지`로 오표시되지 않는다.
- 숙소 row는 마지막에 있어도 `숙소`로 표시된다.
- 마지막 날 처음 출발지로 돌아가는 row는 `복귀지`로 표시된다.
- 웹 이동수단 선택지에 `도보`가 없고 `자동차`, `대중교통`만 있다.
- 대중교통 provider 세부 경로에 도보 sub-path가 있어도 화면 row 대표 mode가 `walk`로 바뀌지 않는다.
- CarryME timeline에 `짐 숙소 도착` 이벤트가 표시된다.
- CarryME 재계산 후에도 `짐 숙소 도착` 이벤트가 Standard timeline 또는 computed fallback timeline으로 사라지지 않는다.
- role/mode가 없는 기존 preview fixture는 상세 화면이 열리되 재계산은 `확인 필요`로 차단된다.
- missing generated itinerary id는 기존처럼 404를 유지한다.

## 수동 검증

1. 실제 Custom GPT/MCP 흐름으로 새 일정을 생성한다.
2. 1박 일정과 2박 이상 일정을 각각 확인한다.
3. 생성된 상세 URL을 연다.
4. 행선지 편집에서 `출발지`, `방문지`, `숙소`, `복귀지`가 데이터 role대로 보이는지 확인한다.
5. 웹 이동수단 선택지가 `자동차`, `대중교통`만 보이는지 확인한다.
6. 선택한 대표 이동수단이 처음부터 끝까지 모든 이동 구간에 적용되는지 확인한다.
7. 좌표 없는 행선지가 있으면 기존 장소 검색/상세 조회로 좌표 확정 전까지 재계산이 막히는지 확인한다.
8. CarryME timeline의 `짐 숙소 도착`이 재계산/fallback 뒤에도 유지되는지 확인한다.
9. 절약 없음 상태에서 `시간 절약 없음 · 짐 없이 바로 이동`이 상세 화면과 미리보기 이미지에 같이 보이는지 확인한다.
10. GPT Action 응답의 `savedMinutes`와 summary가 화면과 같은 의미인지 확인한다.
11. 기존 저장 preview 샘플을 열어 role/mode 누락 때문에 화면 열람이 깨지지 않는지 확인한다.
12. 기존 저장 preview의 role/mode 누락 row가 index나 이름으로 확정 보정되지 않고 재계산이 차단되는지 확인한다.

## 실패 처리 검증

CarryME 경로 provider 호출이 실패하는 경우를 mock 또는 fixture로 만든다.
이때 기대 결과는 다음과 같다.

- 입력 조건:
  - stop 역할(`role`)은 정상이다.
  - 웹 대표 이동수단(`mode`)은 정상이다.
  - 좌표(`coordinate`)는 정상이다.
  - provider 호출만 실패한다.
- 상세 화면 전면 오류를 띄우지 않는다.
- CarryME 경로와 시간은 Standard와 동일하게 표시한다.
- 절약 시간은 0으로 처리한다.
- 문구는 `시간 절약 없음 · 짐 없이 바로 이동`이다.
- CarryME timeline은 Standard timeline으로 덮지 않는다.
- CarryME timeline 렌더링 우선순위는 AI 제공 `carrymeTimeline`을 먼저 사용한다.

role/mode 누락은 provider 실패 fallback과 다르게 본다.

- 입력 조건:
  - stop 역할(`role`) 또는 이동 구간이 있는 stop의 웹 대표 이동수단(`mode`)이 누락된다.
  - provider 호출 전에 차단해야 한다.
- role이 누락되면 `확인 필요` 상태로 재계산을 막는다.
- 이동 구간이 있는 stop의 mode가 누락되면 `확인 필요` 상태로 재계산을 막는다.
- provider 호출은 실행하지 않는다.
- Standard-equivalent fallback으로 처리하지 않는다.
- 기존 저장 preview도 role/mode 누락을 추론으로 채우지 않는다.
- 기존 caption이 있으면 화면 열람용 표시로만 쓰고, 업무 role 확정 근거로 쓰지 않는다.
- 좌표가 누락되면 기존 장소 검색/상세 조회로 좌표 확정을 유도한다.
- 좌표 누락 fixture가 있으면 다음 기준으로 분리한다.
  - stop 역할(`role`)과 웹 대표 이동수단(`mode`)은 정상이나 좌표(`coordinate`)만 없는 경우, 기존 장소 검색/상세 조회로 좌표 확정을 유도한다.
  - stop 역할(`role`) 또는 웹 대표 이동수단(`mode`)도 함께 누락된 경우, 장소 검색 유도보다 role/mode `확인 필요` 차단을 우선한다.
  - 좌표 누락은 provider 실패 fallback도 아니고 role/mode 누락 차단도 아니므로 기대 결과를 별도 fixture로 둔다.

## 팀 개발 검증 분리

- core schema/normalization 검증은 AI schema, draft 정규화, GPT/MCP fixture를 중심으로 맡긴다.
- web row/timeline 검증은 상세 화면 role 표시, mode 선택지, CarryME 재계산 적용, timeline 보존을 중심으로 맡긴다.
- tests/fixtures 검증은 공개 응답, design check, Playwright fixture를 중심으로 맡긴다.
- shared type/schema owner는 core schema/normalization 담당으로 둔다.
- stop 역할(`role`)과 웹 대표 이동수단(`mode`)의 optional/required 기준은 shared type/schema owner가 먼저 확정한다.
- web/tests 담당은 shared type/schema owner의 변경을 기준으로 fixture와 화면 검증을 후속 적용한다.
- web/tests 담당은 shared type 기준을 임의 재해석해서 provider 실패, role/mode 누락, 좌표 누락 fixture 기대값을 섞지 않는다.
- 단, `apps/web/components/itinerary/ItineraryDashboard.tsx`는 role row, mode UI, route 재계산, timeline 렌더링이 한 파일 안에서 충돌하므로 단일 소유자가 최종 통합 검증하는 것을 기준으로 둔다.

## 테스트 로그 작성 기준

구현 후 테스트 로그를 남길 때는 명령, 결과, 실패 여부, 실패 이유, 재시도 여부를 분리한다.
테스트를 실행하지 않았다면 실행하지 않은 이유를 적는다.
통과하지 않은 테스트를 통과한 것처럼 쓰지 않는다.

## 중단 조건

- 테스트가 내부 구현 문자열을 다시 강제해야만 통과하는 경우.
- AI 생성 구조를 바꿨는데 기존 GPT/MCP 응답 하위 호환이 깨지는 경우.
- `walk` 웹 선택지 제거가 provider 내부 도보 경로 처리까지 깨뜨리는 경우.
- AI가 `carrymeTimeline`의 `짐 숙소 도착` 이벤트를 만들지 못해 코드가 시간을 찾아야 하는 경우.
- 수동 MCP 생성에서 상세 화면 또는 미리보기 이미지가 비어 보이는 경우.
