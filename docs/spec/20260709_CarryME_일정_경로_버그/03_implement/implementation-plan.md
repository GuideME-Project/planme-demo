# CarryME 일정 경로 버그 구현계획

## 결론

- 구현 방향: `standardStops`와 `carrymeStops`를 일자별 전체 이동 흐름으로 확장하고, 각 stop의 역할(`role`)과 다음 구간 이동수단(`mode`)을 AI 생성부터 상세 화면 row까지 보존한다.
- 완료 조건: 행선지 편집에서 첫 방문지가 `출발지`로 오표시되지 않고, 출발지/방문지/숙소/복귀지가 데이터 role대로 보이며, CarryME 경로 재계산이 route/path/time만 갱신하고 CarryME timeline 의미를 보존한다.
- 하위 호환 조건: 새 생성 데이터는 role/mode 필수 계약으로 검증하되, 기존 저장 preview는 화면 열람이 가능해야 한다. 기존 저장값에 role/mode가 없으면 role을 추론해 확정하지 않고 기존 caption 표시 또는 `확인 필요` 상태로 제한하며, 재계산은 차단한다.
- 주요 리스크: 기존 코드가 index 기반 role 계산과 generic timeline 생성에 의존한다. 특히 `computedRoutes.carryme?.timeline`이 기존 AI timeline을 덮으면 `짐 숙소 도착` 이벤트가 사라질 수 있다.

## 근거

- 설계 문서:
  - [행선지 편집 설계](../02_design/destination-editor-design.md)
  - [AI 데이터 경계 설계](../02_design/ai-data-boundary.md)
  - [사용자 흐름과 상태 설계](../02_design/user-flow-and-state.md)
  - [화면과 문구 설계](../02_design/screen-and-copy-design.md)
  - [검증 계획](../02_design/validation-plan.md)
- 관련 스레드:
  - `019f46d8-193c-7e23-a9c1-7893c9440d08`: 이동수단 선택 정책. 사용자가 `대중교통` 또는 `자동차/자차`를 선택하면 처음부터 끝까지 모든 이동 구간에 적용한다. 웹 선택지는 `자동차`, `대중교통`만 둔다.
- 관련 코드:
  - `packages/planme-core/src/mock-data.ts`
  - `packages/planme-core/src/openai-itinerary-generator.ts`
  - `packages/planme-core/src/draft-itineraries.ts`
  - `packages/planme-core/src/gpt-actions.ts`
  - `apps/web/components/itinerary/ItineraryDashboard.tsx`
  - `apps/web/components/itinerary/RouteMap.tsx`
  - `apps/mcp/scripts/check-planme-mcp.ts`
  - `scripts/check-planme-design.mjs`
  - `apps/web/e2e/gpt-itinerary-generation.spec.ts`
- 미확인 자료:
  - 구현 후 실제 Custom GPT/MCP 대표 입력으로 새로 생성한 1박/2박 이상 일정.

## 범위

- 포함:
  - stop role/mode type 추가와 정규화.
  - 새 생성 preview의 role/mode 필수 계약 검증.
  - 기존 저장 preview의 화면 열람 하위 호환.
  - AI JSON schema/prompt에 role/mode 계약 반영.
  - 상세 화면 `DestinationRow`에 role/placeId 보존.
  - index 기반 `출발지`/`도착지` 라벨 계산 제거.
  - 웹 이동수단 선택지에서 `도보` 제거.
  - CarryME 재계산 시 route/path/time만 갱신하고 CarryME timeline 보존.
  - MCP/actions/design/e2e fixture와 검증 스크립트 갱신.
- 제외:
  - 기존 Redis preview 저장값 직접 수정.
  - 기존 저장 preview의 role/mode를 index, 이름, caption으로 확정 보정하는 migration.
  - 배송 차량 경로 점선 표시.
  - 외부 배송 ETA 연동.
  - 코드의 호텔/숙소 키워드 보정 또는 레거시 role 기반 보정.
  - 새 장소 검색/좌표 보강 체계 도입.
  - DB 마이그레이션.

## 작업 순서

1. 공통 type을 확장한다.
   - stop 역할(`PlanmeStopRole`)은 `출발지 | 방문지 | 숙소 | 복귀지`.
   - 웹 행선지 row 대표 이동수단(`PlanmeRowMode`)은 `drive | transit`.
   - provider segment/sub-path 이동수단(`ProviderSegmentMode`)은 `drive | transit | walk`.
   - 웹 선택지에서 `walk`를 제거하는 것은 provider 내부 도보 sub-path 금지가 아니다.
2. AI 생성 schema/prompt를 갱신한다.
   - `standardStops`와 `carrymeStops` 각 stop에 `role`, `mode`, `caption`을 요구한다.
   - 마지막 stop은 다음 구간이 없으므로 구현상 `mode`를 쓰지 않을 수 있지만, 요구사항 문구는 “처음부터 끝까지 모든 이동 구간에 적용”으로 유지한다.
   - 새 생성 데이터는 role/mode 누락을 계약 위반으로 다룬다.
3. draft 정규화를 갱신한다.
   - `caption`을 role 대용으로 쓰지 않는다.
   - role/mode/placeId/coordinate가 `RoutePlan.stops` 또는 상세 화면 row까지 끊기지 않게 한다.
   - 레거시 role 문자열(`origin`, `visit`, `finalDestination`)은 새 판단 근거로 쓰지 않는다.
   - 기존 저장 preview에 role/mode가 없으면 화면 열람용으로 기존 caption/name은 유지하되 role을 확정하지 않는다.
4. validation을 추가한다.
   - role 누락/invalid, 이동 구간이 있는 stop의 mode 누락을 구분한다.
   - 좌표 누락은 기존 장소 검색/상세 조회로 해결 가능한 상태다.
   - role/mode 누락은 `확인 필요`로 보고 경로 재계산을 막는다. 이 규칙은 기존 저장 preview에도 동일하게 적용한다.
5. 상세 화면 상태를 갱신한다.
   - `DestinationRow`에 `role`, `placeId`를 추가한다.
   - `createDestinationRows`, `createRouteRequestRows`, `createRouteStopsFromRows`, `createTimelineFromRows`에서 role/mode를 보존한다.
   - `getDestinationRole(index, total)` 의존을 제거하거나 fallback 전용으로 격하한다.
   - `createRouteStopsFromRows`는 index 기반 `getDestinationRole`과 name keyword icon inference를 주요 의미 판단으로 쓰지 않는다.
   - row의 역할은 `RouteStop.caption` 또는 새 `role` 필드로 보존한다.
   - icon은 role 기반 최소 매핑 또는 별도 표시 보조값으로만 처리하며, 업무 의미 판단 근거가 되면 안 된다.
6. 웹 이동수단 UI를 정리한다.
   - `destinationModeOptions`에서 `도보(walk)`를 제거한다.
   - 사용자가 구간별 수동 변경을 하더라도 가능한 값은 `자동차(drive)`와 `대중교통(transit)`뿐이다.
7. CarryME 재계산 적용을 정리한다.
   - 재계산 성공 시 CarryME route의 path/segments/duration/routeText/stops만 갱신한다.
   - `computedRoutes.carryme?.timeline`이 기존 AI timeline을 덮을 수 있는 현재 위험을 제거한다.
   - timeline 렌더링은 `selectedDayPlan.carrymeTimeline ?? selectedDayPlan.timeline` 우선 또는 동등한 보존 정책을 사용한다.
   - 재계산 결과는 route/path/time/stops만 갱신하고 timeline 렌더링 데이터는 기존 AI 제공 값을 우선한다.
   - fallback 시에도 Standard timeline으로 CarryME timeline을 덮지 않는다.
8. fixture와 테스트를 갱신한다.
   - MCP mock AI 응답에 role/mode를 넣는다.
   - design check는 role/mode 계약과 웹 도보 제거를 확인한다.
   - E2E fixture는 첫 방문지 오표시, 숙소 role, 복귀지 role을 확인한다.
   - 기존 preview 하위 호환 fixture는 `role`/`mode` 없음 + `caption` 있음, `role`/`mode` 없음 + `caption` 없음 2개를 분리한다.
   - provider 실패 fixture와 role/mode 누락 fixture는 같은 fallback 기대값을 공유하지 않는다.

## 변경 파일 후보

| 파일 | 변경 목적 | 주의점 |
| --- | --- | --- |
| `packages/planme-core/src/mock-data.ts` | RouteStop 또는 관련 type에 role/mode/placeId 보존 가능성 추가 | 기존 preview와 하위 호환 유지 |
| `packages/planme-core/src/openai-itinerary-generator.ts` | AI schema/prompt에 stop role/mode 계약 반영 | 웹 mode는 `drive/transit`만 요구 |
| `packages/planme-core/src/draft-itineraries.ts` | AI stop을 role/mode 포함 route plan으로 정규화 | 레거시 role을 새 판단 근거로 쓰지 않음 |
| `packages/planme-core/src/gpt-actions.ts` | 숙소 후보 좌표 보강 시 role/mode/placeId 보존 | 기존 장소 검색/좌표 보강 흐름 유지 |
| `apps/web/components/itinerary/ItineraryDashboard.tsx` | DestinationRow role/placeId 추가, index 기반 라벨 제거, 웹 도보 선택 제거, CarryME timeline 보존 | 가장 큰 충돌 영역 |
| `apps/web/components/itinerary/RouteMap.tsx` | 지도 범례/문구 현행 유지 확인 | 이미 `짐 없이 바로 이동하는 경로` 반영됨 |
| `apps/mcp/scripts/check-planme-mcp.ts` | MCP fixture에 role/mode 계약 반영 | 문자열 조각 검사보다 계약 검증 |
| `scripts/check-planme-design.mjs` | role/mode 계약, 도보 웹 선택지 제거, 공개 문구 검증 | 내부 구현명 고정 지양 |
| `apps/web/e2e/gpt-itinerary-generation.spec.ts` | 상세 화면 role 표시와 CarryME timeline 보존 검증 | 현재 환경에 Playwright 의존성 여부 확인 필요 |

## 팀 개발 write set

- 병렬 분리 가능:
  - core schema/normalization: `packages/planme-core/src/openai-itinerary-generator.ts`, `packages/planme-core/src/draft-itineraries.ts`, `packages/planme-core/src/mock-data.ts`, `packages/planme-core/src/gpt-actions.ts`.
  - tests/fixtures: `apps/mcp/scripts/check-planme-mcp.ts`, `scripts/check-planme-design.mjs`, `apps/web/e2e/gpt-itinerary-generation.spec.ts`.
- shared type/schema 소유:
  - shared type/schema owner는 core schema/normalization 담당으로 둔다.
  - stop 역할(`role`)과 웹 대표 이동수단(`mode`)의 optional/required 기준은 shared type/schema owner가 먼저 확정한다.
  - web/tests 담당은 shared type/schema owner의 변경을 기준으로 후속 적용한다.
  - web/tests 담당은 하위 호환, fallback, fixture 요구사항을 shared type 기준과 다르게 임의 재해석하지 않는다.
- 충돌 주의:
  - web row/timeline 변경은 대부분 `apps/web/components/itinerary/ItineraryDashboard.tsx`에 집중된다.
  - `ItineraryDashboard.tsx` 내부는 role 보존, mode UI, route 재계산, timeline 보존이 같은 상태와 helper를 만지므로 단일 소유 영역으로 두는 것을 권장한다.
  - 팀 개발 시 이 파일을 여러 작업자가 동시에 수정하면 `DestinationRow`, `createRouteStopsFromRows`, 재계산 결과 적용, timeline 렌더링 우선순위에서 충돌 가능성이 크다.

## API/DTO 계획

- 업무 의미(GPT/MCP 생성 일정 초안): AI가 일자별 Standard/CarryME 이동 흐름을 구조화해서 내려주는 데이터.
- 요청 DTO:
  - 기존 GPT/MCP 요청 필드는 유지한다.
  - 이동수단 선택 스레드의 사용자 선택값은 별도 작업에서 `drive` 또는 `transit` 기본 정책으로 연결한다.
- 응답/내부 DTO:
  - `standardStops[]`, `carrymeStops[]` stop에 `role`, `mode`, `placeId`, `coordinate`를 보존한다.
  - 공개 GPT Action 응답의 기존 `savedMinutes`, `standardTotalMinutes`, `carrymeTotalMinutes`, `summary`, `itinerary`는 유지한다.
- required:
  - 새 생성 stop의 `name`, `caption`, `role`.
  - 새 생성 stop에서 다음 구간이 있는 경우 `mode`.
- optional:
  - 마지막 stop의 `mode`.
  - `coordinate`, `placeId`.
  - 기존 저장 preview의 `role`, `mode`.
- nullable:
  - 새 필드는 nullable보다 optional을 우선한다.
- default:
  - role/mode는 조용히 임의 default하지 않는다.
  - 좌표가 없으면 기존 장소 검색/상세 조회로 확정하게 한다.
- 오류/확인 상태:
  - role/mode 누락은 `확인 필요`로 경로 재계산 차단.
  - 기존 저장 preview의 role/mode 누락은 열람 가능 상태로 두되, role 확정 추론 없이 기존 caption 표시 또는 확인 필요 표시로 제한.
  - provider 재계산 실패는 사용자 전면 오류가 아니라 Standard-equivalent fallback.

## 프론트엔드 계획

- 화면/라우트:
  - 상세 화면 `/itinerary/[id]`.
- 컴포넌트:
  - `ItineraryDashboard`: 행선지 편집 role/mode 보존, 경로 재계산, timeline 보존.
  - `RouteMap`: 지도 범례 현행 유지.
  - `TimelinePanel`: AI 제공 `carrymeTimeline` 표시 유지.
- 상태:
  - `DestinationRow.role`은 화면 라벨이다.
  - `DestinationRow.mode`는 다음 구간의 웹 대표 이동수단이며 `drive | transit`만 허용한다.
  - 웹에서 선택 가능한 mode는 `drive`, `transit`만이다.
  - `walk`는 provider 내부 segment/sub-path로만 존재할 수 있다.
  - role/mode가 없는 기존 저장 row는 경로 재계산 불가 상태로 둔다.
- API 연동:
  - 기존 `/api/places/autocomplete`, `/api/places/details`를 유지한다.
  - 기존 route provider 호출 구조를 유지하되 rows의 role/mode를 보존한다.
- 오류/로딩/빈 상태:
  - 좌표 누락은 기존 장소 선택 안내.
  - role/mode 누락은 `확인 필요`.
  - provider 실패는 fallback.
- timeline 렌더링:
  - CarryME timeline 표시 데이터는 AI가 제공한 `selectedDayPlan.carrymeTimeline`을 최우선으로 사용한다.
  - CarryME 전용 timeline이 없을 때만 기존 설계와 같은 제한된 fallback을 사용한다.
  - 경로 재계산 결과 또는 provider fallback이 Standard timeline으로 CarryME timeline을 덮어쓰면 안 된다.

## 코드 예시

후보: stop role/mode type.

```ts
type PlanmeStopRole = "출발지" | "방문지" | "숙소" | "복귀지";
type PlanmeRowMode = "drive" | "transit";
type ProviderSegmentMode = PlanmeRowMode | "walk";

type PlanmeDraftRouteStop = {
  name: string;
  caption: string;
  role: PlanmeStopRole;
  mode?: PlanmeRowMode;
  coordinate?: MapCoordinate;
  placeId?: string;
};
```

후보: 상세 화면 row.

```ts
type DestinationRow = {
  id: string;
  name: string;
  caption?: string;
  role?: PlanmeStopRole;
  mode?: PlanmeRowMode;
  coordinate?: MapCoordinate;
  placeId?: string;
};
```

후보: 화면 mode 선택지.

```ts
const destinationModeOptions = [
  { label: "자동차", value: "drive" },
  { label: "대중교통", value: "transit" },
] satisfies Array<{ label: string; value: PlanmeRowMode }>;
```

후보: CarryME 재계산 결과 적용 원칙.

```ts
const nextCarrymeRoute = applyComputedRoute(selectedDayPlan.carryme, computedRoutes.carryme);
const nextCarrymeTimeline =
  selectedDayPlan.carrymeTimeline ?? selectedDayPlan.timeline;
```

후보: row에서 route stop 생성.

```ts
function createRouteStopsFromRows(rows: DestinationRow[]): RouteStop[] {
  return rows.map((row) => ({
    name: row.name,
    caption: row.role ?? row.caption ?? "확인 필요",
    role: row.role,
    coordinate: row.coordinate,
    placeId: row.placeId,
  }));
}
```

## DB 계획

- 테이블: 없음.
- 컬럼: 없음.
- 인덱스: 없음.
- 마이그레이션: 없음.
- 데이터 보정: 기존 Redis preview 저장값을 직접 수정하지 않는다.
- 하위 호환: 기존 저장 preview는 열람 가능해야 하지만, role/mode 없는 값의 재계산은 `확인 필요`로 차단한다.
- 롤백: 코드 롤백으로 새 생성/표시 흐름만 되돌린다.

## 배포와 롤백

- 배포 순서:
  1. core type/schema/정규화 변경.
  2. web 상세 화면 role/mode 보존 및 도보 선택지 제거.
  3. MCP/actions/design/e2e fixture 변경.
  4. 검증 후 배포.
- 운영 확인:
  - 새 GPT/MCP 생성 일정 링크가 열린다.
  - 기존 저장 preview 링크가 role/mode 없음 때문에 열람 자체에 실패하지 않는다.
  - 행선지 편집에서 첫 방문지가 출발지로 보이지 않는다.
  - 웹 이동수단 선택지가 자동차/대중교통만 보인다.
  - CarryME timeline에 `짐 숙소 도착`이 유지된다.
- 롤백 조건:
  - GPT/MCP 생성 payload를 정규화하지 못하는 경우.
  - 상세 화면이 기존 preview를 열지 못하는 경우.
  - 행선지 편집 또는 지도 경로가 비어 보이는 경우.

## 중단 조건

- role/mode를 기존 공개 GPT Action 응답과 하위 호환으로 보존할 수 없을 때.
- 기존 저장 preview를 열람 가능하게 유지할 수 없을 때.
- `walk` 제거가 provider 내부 도보 sub-path 처리까지 깨뜨릴 위험이 확인될 때.
- CarryME 재계산 결과 적용에서 timeline 보존이 현재 상태 구조와 충돌할 때.
- 테스트 fixture가 실제 제품 의미와 충돌하는 경우.

## 대안 B 재검토 트리거

- A안 구현 중 기존 preview 열람 하위 호환이 깨지면 B안을 재검토한다.
- `standardStops`/`carrymeStops` 확장만으로 stop 역할(`role`)과 웹 대표 이동수단(`mode`) 계약을 안정적으로 보존할 수 없으면 B안을 재검토한다.
- 상세 화면 row와 route row의 책임이 계속 섞여 role/mode 보존 기준이 흔들리면 별도 `destinationRows`/`routeRows` 계약을 재검토한다.
- 재검토 시 기존 preview 열람, 새 생성 계약 검증, CarryME timeline 보존을 동시에 만족하는지 먼저 비교한다.

## 미해결 질문

- 2박 이상 대표 입력은 구현/검증 단계에서 새로 생성해 고정한다.
- 이동수단 선택 정책의 별도 구현은 스레드 `019f46d8-193c-7e23-a9c1-7893c9440d08`와 충돌하지 않게 순서를 조정한다.
