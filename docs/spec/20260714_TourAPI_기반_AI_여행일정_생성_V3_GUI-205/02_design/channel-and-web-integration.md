# 채널과 웹 연동

## 결론

GPTs Actions와 GPT App MCP는 웹 서버가 소유한 같은 V3 입력·상태·결과 DTO와 일정 오케스트레이터를 사용한다.
기존 공개 도구 이름은 유지하되 GPTs는 45초 제한 안의 단일 동기 실행, GPT App은 처리 중 위젯의 자동 도구 호출로 결과를 전달한다. 숙소·선호 확인 질문과 장소 clarification 흐름은 제거한다.

웹은 서버가 활성화한 revision을 읽고 편집 명령만 보낸다. TourAPI 장소 선택과 경로 계산을 브라우저가 소유하지 않는다.

## 사용자 질문 정책

질문 가능한 슬롯은 다음 네 개뿐이다.

```ts
type RequiredPlanningSlot =
  | "origin"
  | "destination"
  | "transportMode"
  | "durationDays";
```

- 누락된 슬롯이 있으면 한 번에 필요한 값만 질문한다.
- 이미 받은 값을 다시 질문하지 않는다.
- 출발지·목적지 좌표 확인이 실패한 경우에만 해당 슬롯을 다시 질문할 수 있다.
- 숙소명, 선호, 특정 장소, 여행 날짜, 인원, 짐 개수와 시간 선호는 먼저 질문하지 않는다.
- 사용자가 자발적으로 제공하면 DTO에 포함할 수 있으며 검증 실패 시 조용히 무시하거나 구조화된 제외 결과로 처리한다.
- TourAPI 후보 부족, AI 실패와 경로 실패를 추가 질문으로 전환하지 않는다.

## 공통 요청 DTO

```ts
type StartItineraryRequest = {
  invocationId?: string;
  origin: string;
  destination: string;
  transportMode: "drive" | "transit";
  durationDays: number;
  travelStartDate?: string;
  preferences?: string[];
  requestedPlaces?: string[];
  travelerCount?: number;
  luggageCount?: number;
};
```

| 필드 | required | nullable | 기본값 | 검증 |
| --- | --- | --- | --- | --- |
| `origin` | 예 | 아니요 | 없음 | 공백 제거 후 비어 있지 않음 |
| `destination` | 예 | 아니요 | 없음 | 공백 제거 후 비어 있지 않음 |
| `transportMode` | 예 | 아니요 | 없음 | `drive`, `transit` |
| `durationDays` | 예 | 아니요 | 없음 | 정수 1~14 |
| `travelStartDate` | 아니요 | 아니요 | 없음 | `YYYY-MM-DD`, 제공 시 여행 종료일 계산 |
| `preferences` | 아니요 | 아니요 | `[]` | 빈 문자열 제거, 후보 순위에만 사용 |
| `requestedPlaces` | 아니요 | 아니요 | `[]` | TourAPI 정확 일치 검증 |
| `travelerCount` | 아니요 | 아니요 | `1` | 정수 1~20 |
| `luggageCount` | 아니요 | 아니요 | `1` | 정수 0~20 |

`invocationId`는 GPTs Actions 요청에서만 필수인 기술 필드다. 사용자에게 묻지 않으며 여행 의도나 AI 장소 선택 입력으로 전달하지 않는다. 한 사용자 생성 요청에는 새 값을 만들고 동일 Action 전송 재시도에는 같은 값을 재사용한다. GPT App MCP는 JSON-RPC 요청 ID를 서버 내부 멱등성 키로 사용하므로 입력 스키마에 이 필드를 노출하지 않는다.

API 경계에서 `null`은 허용하지 않는다. 정보가 없으면 선택 필드를 생략한다. `hotelName`, AI days, timeline, 좌표와 clarification context는 V3 요청에서 제거한다.

멱등성 키는 GPTs의 `invocationId` 또는 MCP JSON-RPC 요청 ID에서 만들고 헤더나 서버 내부 메타데이터로 전달한다. 출발지·목적지 등 여행 입력의 해시로 대체하지 않는다.

## 공통 상태 응답

```ts
type ItineraryJobResponse =
  | {
      status: "processing";
      itineraryId: string;
      phase: ItineraryJobStatus;
      retryAfterMs: number;
    }
  | {
      status: "ready";
      itineraryId: string;
      revision: number;
      pageUrl: string;
      widget: ItineraryDisplayDto;
      excludedRequestedPlaces: ExcludedRequestedPlace[];
    }
  | {
      status: "failed";
      itineraryId: string;
      errorCode: string;
      message: string;
    };
```

- processing 응답은 사용자 질문을 포함하지 않는다.
- ready 전에는 사용할 수 있는 상세 일정 데이터나 성공 링크를 반환하지 않는다.
- failed 응답의 message는 채널 표시용 안전 문구이며 제공자 원본 메시지를 포함하지 않는다.
- `retryAfterMs` 초기값은 500ms로 두고 연속 processing에서는 최대 2초까지 늘릴 수 있다.

## 내부 오케스트레이터 명령

| 동작 | 의미 | 상태 변경 |
| --- | --- | --- |
| `assessPlanningInput` | 네 필수 입력 확인 | 없음 |
| `startItinerary` | 새 ID·pending revision 생성 | 있음 |
| `advanceItinerary` | 현재 단계 하나 진행 | 있음 |
| `getItineraryStatus` | meta와 active 조회 | 없음 |
| `startItineraryEdit` | 같은 ID에 pending revision 생성 | 있음 |
| `activateItineraryRevision` | 계산 완료 revision 원자 활성화 | 있음 |

GET 조회와 단계 진행을 서버 내부에서 분리한다. GPTs의 단일 Action은 내부 `runUntilTerminal`이 여러 단계를 실행하고, GPT App 처리 중 위젯은 `get_planme_itinerary`를 자동 호출해 한 단계씩 진행한다.
모든 상태 변경 명령은 `apps/web`에 두고 `apps/mcp`는 `PLANME_INTERNAL_API_TOKEN`으로 인증해 호출한다.

## GPTs Actions

### 계획 확인

기존 `POST /api/gpt/planning/start`를 유지하되 스키마에서 `hotelName`, `preferences` 필수 질문과 arrivalAirport 대체 규칙을 제거한다.

응답의 `missingSlots`와 `questions`는 네 허용 슬롯만 포함할 수 있다.

### 생성 시작

기존 `POST /api/gpt/itineraries/recommend`와 operationId `recommendPlanmeItinerary`를 유지한다.

- 42초 내부 예산 안에 완료: HTTP 200, `status=ready`
- 42초 내부 예산 초과 또는 복구 불가 실패: HTTP 200, `status=failed`
- 입력 오류: 400
- 동일 멱등성 키 충돌: 409
- rate limit: 429

요청 body의 `invocationId`는 필수이며 비어 있지 않은 128자 이하의 안전한 식별자 형식만 허용한다. GPT 지침은 한 사용자 생성 요청에서 한 번 만들고 네트워크 재전송에는 같은 값을 재사용하도록 명시한다. 사용자에게 값을 요청하거나 보여주지 않는다.

Actions 응답은 `ready` 또는 `failed`만 반환한다. `processing`이나 다음 Action 호출을 요구하는 `advance` 경로에 의존하지 않는다. 내부 42초 예산은 공식 45초 왕복 제한에 응답 직렬화·네트워크 여유를 남기기 위한 값이다.

### 상태 조회

기존 `GET /api/gpt/itineraries/{itineraryId}`는 웹 링크와 진단용 읽기 전용 상태·ready 결과 조회로 유지한다. GPTs 완료 전달은 이 조회의 반복 호출에 의존하지 않는다.

## GPT App MCP

### `start_planme_planning`

- 네 필수 입력만 평가한다.
- 선택 입력이 없어도 ready가 될 수 있다.
- 질문 배열에 허용되지 않은 슬롯이 들어가면 서버 계약 오류로 처리한다.

### `recommend_planme_itinerary`

- 공통 `startItinerary`를 호출하고 현재 상태를 반환한다.
- 실제 호출은 웹 내부 일정 시작 API로 전달한다.
- ChatGPT가 작성한 days·timeline·hotelName·좌표를 입력으로 받지 않는다.
- processing 결과에는 처리 중 위젯 리소스를 붙인다.
- 처리 중 위젯은 사용자 동작 없이 `get_planme_itinerary`를 자동 호출한다.

### `get_planme_itinerary`

- processing이면 내부 `advanceItinerary`를 한 번 호출하고 상태와 처리 중 위젯을 반환한다.
- 처리 중 위젯은 `retryAfterMs`를 지키고 `window.openai.callTool`로 같은 일정 ID를 재조회한다.
- ready이면 처리 중 위젯을 최종 일정으로 교체하고 자동 호출을 멈춘다.
- failed이면 안전한 실패 문구를 반환하고 사용자 추가 질문을 요구하지 않는다.
- 동일 단계가 잠겨 있으면 processing을 반환하고 다시 조회한다.

위젯은 TourAPI·Luna·경로 공급자를 직접 호출하지 않는다. 자동 호출 횟수와 전체 경과시간에 상한을 두며 상한에 도달하면 실패 상태를 표시하고 사용자 입력을 요구하지 않는다.

도구별로 별도 생성 프롬프트나 TourAPI 조회를 두지 않는다.

## 표시 DTO

저장 도메인을 그대로 외부에 노출하지 않고 화면용 DTO로 변환한다.

```ts
type ItineraryDisplayDto = {
  itineraryId: string;
  revision: number;
  title: string;
  region: string;
  durationDays: number;
  transportMode: "drive" | "transit";
  days: DisplayDay[];
  standardTotalMinutes: number;
  carrymeTotalMinutes: number;
  savedMinutes: number;
  pageUrl: string;
};
```

- 장소 표시값은 `selectedPlaceSnapshots[contentId]`에서 읽는다.
- 시간표는 서버 계산 결과만 사용한다.
- `estimated_walk`는 예상 도보 배지를 표시하고 경로선을 그리지 않는다.
- 저장 revision의 내부 캐시 상태·provider code는 기본 표시 DTO에 포함하지 않는다.

## 특정 장소 제외 안내

| 채널 | 표시 |
| --- | --- |
| GPTs 최종 응답 | 표시 |
| GPT App 위젯 | 표시 |
| 웹 상세 | 표시하지 않음 |

표시 문구는 “요청한 장소가 TourAPI에서 확인되지 않아 일정에서 제외되었습니다.” 수준으로 제한한다. 대체 장소로 바꿨다고 표현하지 않는다.

## 웹 상세 상태

| 상태 | 표시 |
| --- | --- |
| processing·active 없음 | 일정 생성 중 상태, 장소·경로 미표시 |
| ready | active revision 표시 |
| edit processing | 기존 active 유지, 변경 계산 중 표시 |
| edit failed | 기존 active 유지, 변경 실패 안내 |
| generation failed | 생성 실패 안내, 허용되지 않은 추가 입력 질문 없음 |

웹은 meta와 active를 읽기 위해 상태 API를 polling할 수 있다. provider API를 직접 호출하지 않는다.

## 웹 편집

### 편집 가능한 값

- TourAPI 후보를 통한 방문 장소 추가·교체·삭제
- TourAPI 숙박 후보를 통한 전체 여행의 고정 숙소 교체
- 공통 방문 순서 변경
- 일정 전체 이동 수단 변경

일차 수 변경은 V1 편집 범위에서 제외한다. 숙소를 바꾸더라도 전체 여행은 하나의 고정 숙소만 사용하며 여러 숙소는 지원하지 않는다.

### 장소 검색

현재 `/api/places/search`의 네이버 결과를 TourAPI 후보 조회로 교체한다.

- 요청에는 itinerary ID, active revision, 검색어를 전달한다.
- 서버는 active 일정의 목적지 범위 안에서만 TourAPI 후보를 반환한다.
- 응답은 `contentId`, 공식 제목, 주소, 좌표, 유형을 포함한 정규화 후보다.
- 브라우저가 직접 입력한 이름·좌표는 저장하지 않는다.
- 사용자가 후보를 선택하지 않은 자유 텍스트는 편집 제출 시 거부한다.

### 편집 제출

브라우저는 전체 `PlanmeItinerary`를 다시 보내지 않는다.

```ts
type EditItineraryRequest = {
  baseRevision: number;
  transportMode?: "drive" | "transit";
  lodgingContentId?: string;
  days: Array<{
    day: number;
    orderedVisitContentIds: string[];
    restaurantContentIds?: string[];
  }>;
};
```

서버는 저장된 장소 스냅샷과 TourAPI 후보를 다시 검증하고 `pending` revision을 만든다. Standard·CarryME·전체 시간표를 재계산해 성공 시 한 번에 활성화한다.

편집 processing 동안 추가 편집 제출을 비활성화한다. 409 충돌이면 최신 active를 다시 읽고 사용자가 변경을 다시 적용하도록 안내한다.

## 오류 응답

| 상황 | HTTP/상태 | 채널 처리 |
| --- | --- | --- |
| 네 필수 입력 누락 | 200 `needs_input` | 허용 슬롯만 질문 |
| 잘못된 요청 DTO | 400 | 필드 오류 안내 |
| 출발지·목적지 확인 실패 | 200 `needs_input` | 해당 슬롯만 재질문 |
| 비동기 작업 실패 | 200 `failed` | 안전 문구 표시, 추가 질문 금지 |
| revision 충돌 | 409 | 최신 active 재조회 |
| 일정 없음 | 404 | 만료 또는 잘못된 링크 안내 |
| rate limit | 429 | `retryAfterMs` 이후 자동 재시도 |

## 리스크

- 14일 일정이 GPTs 내부 42초 예산을 넘으면 결과를 전달할 수 없다. 부분 일정을 반환하지 않고 안전한 terminal failed로 종료하며, 성능 검증이 실패하면 완료로 승인하지 않는다.
- GPT App 위젯의 자동 도구 호출이 호스트 제한이나 일시 오류로 중단될 수 있다. 호출 횟수·시간 상한, 재시도 간격과 terminal failed 표시를 계약 테스트로 고정한다.
- 기존 GPTs OpenAPI 스키마 변경 후 GPT Builder 재가져오기가 필요할 수 있다. 구현 계획에서 설정 갱신을 별도 작업으로 다룬다.
- 웹 편집 DTO가 기존 전체 일정 payload와 호환되지 않는다. V1/V2 호환이 비목표이므로 V3 화면과 API를 함께 교체한다.
- 브라우저 계산 제거로 processing 표시 시간이 늘 수 있다. 잘못된 임시 시간·경로를 보여주는 것보다 기존 active 보존을 우선한다.

## References

- [채널 인터뷰](../01_interview/channel-contract-and-notices.md)
- [현재 GPTs Actions API](../../../../apps/mcp/src/gpts-actions-api.ts)
- [현재 GPT App MCP](../../../../apps/mcp/src/planme-mcp.ts)
- [현재 GPT App 위젯](../../../../apps/mcp/src/planme-widget.ts)
- [현재 웹 일정 화면](../../../../apps/web/components/itinerary/ItineraryDashboard.tsx)
- [현재 웹 편집 검증기](../../../../apps/web/lib/edited-itinerary-validator.ts)
