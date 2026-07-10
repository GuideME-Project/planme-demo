# 웹 장소 검색 및 경로 재계산 구현계획

## 결론

웹은 네이버 장소 후보가 좌표를 포함하는 `POST /api/places/search` 하나만 사용한다.
Google 자동완성 session token과 상세 조회 단계는 제거한다.
사용자가 장소명을 직접 수정하면 이전 좌표·Google ID·검색 출처를 모두 지우고, 검색 후보를 선택해야만 다시 길안내할 수 있다.

이동 수단은 Dashboard의 일정 전체 상태로 올린다.
`경로 다시 계산` 버튼은 현재 선택한 날짜의 Standard·CarryME 두 경로를 같은 이동 수단으로 각각 계산한다.
다른 날짜까지 한 번에 계산하지 않으며, 한쪽 실패를 다른 쪽 경로나 임의 직선으로 채우지 않는다.

## 현재 코드와 충돌

| 현재 코드 | 문제 | 구현 방향 |
| --- | --- | --- |
| `/api/places/autocomplete` | Google과 오사카 50km 편향 사용 | 제거, 네이버 검색 route로 교체 |
| `/api/places/details` | 후보 선택 뒤 두 번째 호출 필요 | 제거, 검색 후보에 좌표 포함 |
| `DestinationCandidate`가 Google `placeId` 중심 | 네이버 영속 ID가 있다고 가정 | 공급자 중립 후보 타입 사용 |
| 장소명 입력 시 좌표와 `placeId`만 제거 | 이전 `placeSourceRef`가 남을 수 있음 | 좌표·ID·출처 전체 제거 |
| 각 segment에 mode 선택기 | 일정 전체 mode가 섞임 | selector 하나로 통일 |
| `requestRouteCheck(rows)`가 row mode를 검사 | 전체 mode 원본이 없음 | `requestRouteCheck(rows, transportMode)` |
| 버튼이 CarryME만 계산 | Standard가 변경 mode를 반영하지 않음 | 현재 날짜 두 요청 독립 실행 |
| CarryME 실패 시 Standard 복제 | 실패를 성공처럼 표시 | 실패 상태·경로선 없음 |
| Core 초안 `geoPath`가 stop 직선 | 공급자 실패 시 실제 경로로 오해 | provider success일 때만 경로선 표시 |
| 계산 상태가 선택 날짜 하나에만 존재 | 날짜 전환·전체 mode 변경 시 stale 가능 | 날짜별 상태 map |

## 웹 장소 검색 엔드포인트 검증

### 엔드포인트

| 작업 | Method | Path | Request | Response | 상태 코드 | 권한 | 관례 일치 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 국내 장소 후보 검색 | POST | `/api/places/search` | `PlaceSearchRequest` | `PlaceSearchResponse` | 200, 400, 405, 429, 502, 503 | 기존 demo와 같은 공개 same-origin | 기존 장소 proxy가 POST이므로 일치 |

`places`는 안정적인 업무 resource이고 `search`는 외부 후보 조회 동작을 나타낸다.
정확한 주소가 URL·접근 로그에 남지 않도록 PlanME 내부 endpoint는 POST를 사용한다.
서버가 네이버 공급자의 `GET /v1/search/local.json`을 호출한다.

### 요청 DTO

후보:

```ts
type PlaceSearchRequest = {
  query: string;
  limit?: number;
};
```

| 업무 필드 | DTO 필드 | 타입 | 필수 | Nullable | 생략 | 기본값·빈 값 | 검증 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 검색어 | `query` | string | 예 | 아니요 | 불가 | trim 후 2자 미만 거부 | 최대 길이 제한 포함 |
| 후보 개수 | `limit` | integer 1~5 | 아니요 | 아니요 | 가능 | 5 | 범위 밖 400 |

검색어 최대 길이는 네이버 공식 query 제한과 현재 UI 필요를 구현 시 다시 확인해 상수로 둔다.
확인 전 임의로 매우 큰 body를 공급자에 전달하지 않는다.

### 응답 DTO

후보:

```ts
type PlaceSearchCandidate = {
  candidateId: string;
  name: string;
  address?: string;
  category?: string;
  coordinate: MapCoordinate;
  placeSource: "naver_local" | "naver_geocode";
  placeSourceRef: string;
};

type PlaceSearchResponse = {
  candidates: PlaceSearchCandidate[];
  message?: string;
};
```

| 업무 필드 | DTO 필드 | 타입 | Response 필수 | Nullable | 생략 | 빈 값 정책 |
| --- | --- | --- | --- | --- | --- | --- |
| 후보 목록 | `candidates` | array | 예 | 아니요 | 불가 | 결과 없음은 `[]` |
| 후보 식별값 | `candidateId` | string | 예 | 아니요 | 불가 | 빈 문자열 금지 |
| 표시 장소명 | `name` | string | 예 | 아니요 | 불가 | HTML 제거 후 빈 값 후보 제외 |
| 표시 주소 | `address` | string | 아니요 | 아니요 | 가능 | 빈 문자열은 생략 |
| 분류 | `category` | string | 아니요 | 아니요 | 가능 | 빈 문자열은 생략 |
| 좌표 | `coordinate` | object | 예 | 아니요 | 불가 | 유효 범위 밖 후보 제외 |
| 검색 출처 | `placeSource` | enum | 예 | 아니요 | 불가 | 기본값 없음 |
| 출처 참조 | `placeSourceRef` | string | 예 | 아니요 | 불가 | 빈 문자열 금지 |
| 사용자 메시지 | `message` | string | 아니요 | 아니요 | 가능 | 성공 빈 결과에는 불필요 |

Google `placeId`, `mainText`, `secondaryText`, session token은 새 응답에서 제외한다.

### 오류 응답

| 조건 | 상태 코드 | 사용자 응답 |
| --- | --- | --- |
| JSON 파싱 실패 | 400 | 잘못된 요청 문구 |
| query 누락·2자 미만·limit 범위 오류 | 400 | 입력 검증 문구 |
| POST 외 method | 405 | method 오류 코드 |
| 네이버 요청 제한 | 429 | 잠시 후 다시 시도 문구 |
| 네이버 5xx·잘못된 원본 응답 | 502 | 장소 검색 실패 문구 |
| 서버 인증 설정 누락 | 503 | 장소 검색을 사용할 수 없음 |
| 정상 빈 결과 | 200 | `candidates: []` |

공급자 상태 본문과 인증 header는 반환하지 않는다.

## 서버 route 구현

후보:

```ts
export async function POST(request: Request) {
  const input = await parsePlaceSearchRequest(request);

  if (!input.ok) {
    return NextResponse.json(input.error, { status: 400 });
  }

  const result = await searchPlanmePlaceCandidates({
    query: input.value.query,
    maxCandidates: input.value.limit,
  });

  return NextResponse.json({ candidates: result.candidates });
}
```

구현 규칙:

- Core의 네이버 후보 정규화 함수를 재사용한다.
- route에 별도 좌표 변환 공식을 중복 작성하지 않는다.
- 서버 전용 인증값만 읽는다.
- 요청 body·검색어·원본 응답을 console log에 남기지 않는다.
- 인증 누락과 공급자 실패를 빈 결과로 조용히 바꾸지 않는다.

## 제거 대상

- `apps/web/app/api/places/autocomplete/route.ts`
- `apps/web/app/api/places/details/route.ts`
- Google 자동완성 session token 상태
- `PlacesAutocompleteApiResponse`
- `PlaceDetailsApiResponse`
- Google `DestinationCandidate` 필드
- 자동완성 선택 후 상세 조회 호출
- 오사카 중심·반경 설정

`scripts/check-planme-actions.mjs`에 두 legacy route가 다시 생기지 않도록 정적 금지 검사를 추가한다.

## 장소 검색 UI 상태

후보:

```ts
type PlaceSuggestionState = {
  status: "idle" | "loading" | "success" | "error";
  candidates: PlaceSearchCandidate[];
  message?: string;
};
```

처리 순서:

1. active row가 없거나 trim한 이름이 2자 미만이면 검색하지 않는다.
2. 입력 후 300ms 동안 추가 입력이 없을 때만 요청한다.
3. 새 검색을 시작하면 이전 `AbortController`를 취소한다.
4. `POST /api/places/search`에 `query`, 필요 시 `limit`를 보낸다.
5. 빈 결과와 오류를 구분한다.
6. 후보 이름·주소·분류를 표시한다.
7. 후보 선택 시 상세 조회 없이 row에 좌표·출처를 반영한다.

현재 `onChange`와 `onInput`이 모두 `updateDestinationName`을 호출할 수 있으므로 한 입력 이벤트 경로만 유지한다.

## 장소 row 상태

후보:

```ts
type DestinationRow = {
  caption?: string;
  coordinate?: MapCoordinate;
  id: string;
  name: string;
  placeSource?: RouteStop["placeSource"];
  placeSourceRef?: string;
  role?: PlanmeStopRole;
};
```

row에서 독립 `mode`를 제거한다.
공급자 요청을 만들 때 일정 전체 `transportMode`를 주입한다.
legacy `placeId`는 읽기 호환을 위해 `RouteStop`에 남을 수 있지만 새로 선택한 후보에는 기록하지 않는다.

### 자유 입력

후보:

```ts
function clearResolvedPlace(row: DestinationRow, name: string): DestinationRow {
  return {
    ...row,
    name,
    coordinate: undefined,
    placeSource: undefined,
    placeSourceRef: undefined,
  };
}
```

실제 기존 타입에 `placeId`가 남아 있으면 함께 `undefined`로 만든다.
한 글자라도 선택된 장소명과 달라지면 좌표를 신뢰하지 않는다.

### 후보 선택

후보:

```ts
function applyPlaceCandidate(
  row: DestinationRow,
  candidate: PlaceSearchCandidate,
): DestinationRow {
  return {
    ...row,
    name: candidate.name,
    coordinate: candidate.coordinate,
    placeSource: candidate.placeSource,
    placeSourceRef: candidate.placeSourceRef,
  };
}
```

선택한 후보가 coordinate 또는 sourceRef를 잃은 경우 UI에 반영하지 않는다.

## 날짜별 편집 상태

현재 `DestinationEditor` 내부 local rows는 날짜를 바꾸거나 component가 remount되면 재구성될 수 있다.
현재 선택 날짜만 계산하되 편집 내용과 계산 상태를 날짜별로 보존하도록 Dashboard가 상태를 소유한다.

후보:

```ts
type RouteCalculationStatus = "idle" | "dirty" | "checking" | "success" | "failed";

type RouteResultState = {
  status: RouteCalculationStatus;
  result?: ComputedRouteResult;
  message?: string;
};

type DayRouteEditorState = {
  carrymeRows: DestinationRow[];
  standard: RouteResultState;
  carryme: RouteResultState;
};

type RouteEditorStateByDay = Record<string, DayRouteEditorState>;
```

Standard stop 목록은 기존 Standard 일정에서 가져오고, 현재 UI가 편집하는 CarryME 목록은 `carrymeRows`로 보존한다.
사용자가 CarryME 장소를 바꿨다는 이유로 이름이 같은 Standard 장소를 자동 교체하지 않는다.

## 일정 전체 이동 수단 UI

후보:

```ts
const [transportMode, setTransportMode] = useState<PlanmeTransportMode>(
  itinerary.transportMode,
);
```

- 선택기는 Dashboard 일정 편집 영역에 하나만 둔다.
- 선택지는 자동차·대중교통이다.
- 기존 `destination-segment-mode` selector와 handler를 제거한다.
- 이동 수단은 날짜 탭을 바꿔도 유지된다.
- 변경 시 모든 날짜 상태를 `dirty`로 바꾼다.
- 이전 이동 수단으로 계산된 경로선은 지도에 성공 경로처럼 표시하지 않는다.
- 변경 이벤트 자체는 네이버 Directions나 ODsay를 호출하지 않는다.

신규 일정에 전체 이동 수단이 없을 수 있다는 fallback을 웹에 만들지 않는다.
기존 링크 호환이 비목표이므로 새 데이터 계약을 강제한다.

## 공급자 요청 row 생성

후보:

```ts
function createProviderRows(
  rows: DestinationRow[],
  transportMode: PlanmeTransportMode,
): ProviderDestinationRow[] {
  return rows.map((row) => ({
    ...row,
    mode: transportMode,
  }));
}
```

`requestRouteCheck`는 row 배열에서 mode를 추정하지 않는다.

후보:

```ts
async function requestRouteCheck(
  rows: DestinationRow[],
  transportMode: PlanmeTransportMode,
): Promise<RouteCheckResult> {
  const providerRows = createProviderRows(rows, transportMode);

  return transportMode === "transit"
    ? requestOdsayRoute(providerRows)
    : requestNaverRoute(providerRows);
}
```

- missing contract 검사는 `role`, `coordinate`를 확인한다.
- mode 누락 검사는 top-level schema에서 이미 처리한다.
- 마지막 row에도 동일 mode를 주입하지만 공급자 segment는 마지막 row mode를 읽지 않는다.
- ODsay 내부 `walk`는 `ProviderSegmentMode`로 유지한다.

## 버튼 재계산 범위

버튼은 현재 선택한 날짜만 처리한다.

- Standard: 현재 선택 날짜의 기존 Standard stop 목록
- CarryME: 현재 선택 날짜의 사용자 편집 row 목록
- 공통: 동일한 `transportMode`
- 다른 날짜: 자동 일괄 호출하지 않음

이동 수단 변경으로 다른 날짜가 `dirty`가 됐으면 해당 날짜를 열어 버튼을 누를 때 계산한다.
단순 날짜 선택이 사용자 이동 수단 변경을 우회해 공급자를 자동 호출하지 않도록 `dirty` 상태를 확인한다.

초기 신규 링크는 좌표 hard gate를 통과한 데이터이므로 첫 표시 날짜의 두 경로를 자동 계산할 수 있다.
사용자가 장소 또는 이동 수단을 바꾼 뒤에는 버튼 gate를 적용한다.

## Standard·CarryME 독립 계산

후보:

```ts
async function recalculateSelectedDay() {
  const standardRows = createRouteRequestRows(selectedDayPlan.standard);
  const carrymeRows = selectedDayState.carrymeRows;

  const [standardResult, carrymeResult] = await Promise.allSettled([
    requestRouteCheck(standardRows, transportMode),
    requestRouteCheck(carrymeRows, transportMode),
  ]);

  applyIndependentRouteResult("standard", standardResult);
  applyIndependentRouteResult("carryme", carrymeResult);
}
```

사전 gate:

1. Standard·CarryME row가 각각 2개 이상인지 확인한다.
2. 모든 row에 role과 coordinate가 있는지 확인한다.
3. 하나라도 좌표가 없으면 두 provider 요청을 시작하지 않는다.
4. 사용자 문구는 `장소를 선택해 주세요`로 고정한다.

결과 처리:

- 두 요청이 성공하면 두 결과를 각각 저장한다.
- Standard만 성공하면 Standard 결과만 저장하고 CarryME를 실패로 표시한다.
- CarryME만 성공하면 CarryME 결과만 저장하고 Standard를 실패로 표시한다.
- 실패 route의 이전 계산 결과를 새 이동 수단 결과처럼 유지하지 않는다.
- 성공 route는 다른 route 실패와 관계없이 유지한다.
- 실패 문구는 `경로를 확인하지 못했습니다`다.

## 경로선 표시

Core 초안의 `geoPath`는 stop 좌표를 이은 선일 수 있어 공급자 경로와 구분해야 한다.

웹 Dashboard 규칙:

- route 계산 상태가 `success`이고 실제 provider segment/path가 있을 때만 지도 경로선을 표시한다.
- `idle`, `dirty`, `checking`, `failed` 상태에서는 해당 route의 provider 경로선을 표시하지 않는다.
- 네이버 Directions 실패 시 stop 직선을 만들지 않는다.
- ODsay partial 응답은 실제 공급자 좌표가 있는 segment와 탑승·하차 marker만 표시한다.
- `createStandardEquivalentComputedRoute`와 그 호출부를 제거한다.
- 실패 route를 map toggle에서 보이게 하더라도 선은 없고 실패 상태만 표시한다.

사용자가 말한 폴리곤은 구현 타입과 테스트 이름에서 실제 도로 경로선(`polyline`)으로 표현한다.

## 캐시 영향

기존 자동차·대중교통 cache key에는 row별 mode가 포함된다.
일정 전체 mode를 명시적으로 key에 넣고 row mode 의존을 제거한다.

후보:

```ts
function getRouteRowsSignature(
  rows: DestinationRow[],
  transportMode: PlanmeTransportMode,
) {
  return JSON.stringify({
    transportMode,
    stops: rows.map((row) => ({
      lat: row.coordinate?.lat,
      lng: row.coordinate?.lng,
      name: row.name,
      placeSourceRef: row.placeSourceRef,
    })),
  });
}
```

기존 cache version prefix는 payload 모양이 바뀌므로 version을 올린다.
이전 cache를 데이터 migration하지 않는다.

## UI 상태와 접근성

- 장소 검색 loading·빈 결과·오류를 서로 다른 상태로 표시한다.
- 후보 button에는 장소명과 주소를 읽을 수 있는 이름을 제공한다.
- 키보드 위·아래·Enter·Escape 동작을 유지하거나 추가한다.
- 전체 이동 수단 선택기에 명시적인 label을 연결한다.
- 경로 계산 중 버튼을 비활성화한다.
- Standard·CarryME 상태를 각각 보조 기술이 읽을 수 있는 live region으로 알린다.
- 색만으로 실패를 표현하지 않는다.

## 자동 테스트 변경

`destination-editor-recorded-flow.spec.ts`에서 다음 mock·assertion을 바꾼다.

### 제거

- `/api/places/autocomplete` mock
- `/api/places/details` mock
- Google session token assertion
- 오사카 중심 전제
- 구간별 대중교통·자동차 혼합 테스트
- CarryME 실패 시 Standard 복제 성공 assertion

### 추가

- `POST /api/places/search` request body와 네이버 후보 response
- 후보 선택 즉시 좌표·출처 저장
- 300ms 입력 지연과 이전 요청 취소
- 자유 입력 후 좌표·ID·출처 제거
- 전체 이동 수단 selector 하나
- mode 변경 직후 provider 호출 0회
- 버튼 클릭 후 현재 날짜 Standard·CarryME 요청 2개
- 두 요청에 같은 mode
- Standard 성공·CarryME 실패
- Standard 실패·CarryME 성공
- 실패 route에 복제·직선 경로선 없음
- 날짜 변경 후 전체 mode 유지와 dirty gate
- 사용자용 `도보` 문구·selector 없음

## 구현 중단 조건

- 검색 후보 선택 뒤 좌표를 얻기 위해 두 번째 공급자 호출이 다시 필요하다.
- query가 URL이나 console log에 노출된다.
- 전체 이동 수단 변경이 provider 호출을 즉시 시작한다.
- 버튼이 다른 날짜까지 자동으로 호출한다.
- Standard·CarryME가 서로 다른 mode로 요청된다.
- 실패 route가 기존 초안 직선 또는 다른 route의 경로를 표시한다.
- UI 테스트를 위해 실제 ODsay 호출이 필요하다.
- `ItineraryDashboard.tsx` 전면 리팩터링이 선행되지 않으면 구현할 수 없는 범위로 커진다.
