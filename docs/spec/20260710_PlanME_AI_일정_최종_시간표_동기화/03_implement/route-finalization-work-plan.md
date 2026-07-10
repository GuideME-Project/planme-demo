# 서버 최종 경로 계산 구현계획

## 결론

- 구현 방향: 웹 서버에 자동차·대중교통 경로 최종화 모듈을 만들고, 기존 GPT 일정 저장 API가 전체 계산 성공 결과만 Redis에 저장하도록 변경한다.
- 완료 조건: 모든 일차의 Standard·CarryME 이동 시간과 지도 경로가 저장되고 MCP 조회 결과와 상세 웹 조회 결과가 동일하다.
- 사전검증 결과: 현재 ODsay 웹 키는 등록 운영 주소 `Referer`를 사용하는 Node 서버 호출에서 인증됐다.

## 범위

### 포함

- ODsay 서버 호출 가능 여부 사전 검증
- 네이버 자동차 경로 계산 코드의 서버 모듈화
- ODsay 대중교통 경로 계산 코드의 서버 모듈화
- 전체 40초 제한과 실패 구간 1회 재시도
- 기존 저장 API의 내부 인증과 최종 계산
- Redis 저장 래퍼 버전 2와 기준 버전 충돌 방지
- 기존 일정·편집 경로 재계산 API
- MCP 생성 도구와 최종 조회 도구의 웹 저장 결과 사용

### 제외

- 체류 시간 데이터
- 방문 시각 재계산
- 전체 일정 소요 시간
- 장소 자동 삭제와 AI 일정 자동 재생성
- 과거 ChatGPT 위젯 소급 갱신
- 관계형 DB 변경

## 사전 중단 조건

구현 첫 단계에서 현재 `NEXT_PUBLIC_ODSAY_API_KEY`를 값 출력 없이 읽어 웹 서버 런타임과 같은 Node 환경에서 대중교통 경로 한 건을 호출한다.

- 성공: 이동 시간과 구간 데이터가 정상이며 서버 모듈 구현을 계속한다.
- 실패: URI 제한 또는 서버 호출 불가 오류를 기록하고 구현·배포를 중단한다.
- 금지: 자동차 결과를 대중교통 결과로 복사하거나 브라우저 계산을 위젯 최종값처럼 사용하지 않는다.

## 작업 순서

### 1. 런타임 파일 준비와 기준 상태 확인

1. 원본 `main`의 앱별 `.env.local`, `.env.development`를 이번 구현 워크트리에 안전하게 복사한다.
2. 민감값을 출력하지 않고 필요한 변수 이름의 존재 여부만 확인한다.
3. 현재 브랜치, 변경 파일, 기준 테스트 상태를 기록한다.
4. ODsay 서버 호출 사전 검증을 실행한다.

### 2. 제공자 경로 모듈 분리

1. 네이버 자동차 호출과 응답 변환을 `apps/web/lib/route-providers/naver-directions.ts` 후보 모듈로 이동한다.
2. 기존 네이버 API 경로가 같은 모듈을 호출하도록 변경해 동작 중복을 없앤다.
3. ODsay의 요청, 오류 판정, 터미널 검색, 장거리·지역 대중교통 변환을 `apps/web/lib/route-providers/odsay.ts` 후보 모듈로 이동한다.
4. 브라우저 저장소와 UI 상태에 의존하는 캐시 코드는 서버 제공자 모듈에 넣지 않는다.
5. 자동차와 대중교통 결과를 공통 경로 결과 형태로 정규화한다.

### 3. 전체 일정 최종화 서비스 구현

1. `apps/web/lib/itinerary-route-finalizer.ts` 후보 파일에 전체 일차 순회와 원자적 결과 조립을 구현한다.
2. 한 번에 최대 두 경로만 계산한다.
3. 한 경로의 구간 순서는 유지한다.
4. 실패한 구간만 한 번 재시도한다.
5. 하나의 `AbortController`와 40초 타이머를 모든 좌표·경로 호출에 전달한다.
6. 모든 일차의 Standard·CarryME가 성공한 뒤 복제된 일정 객체에 결과를 적용한다.
7. AI 시간표 배열은 변경 전후 동일성을 테스트한다.

### 4. 저장소 버전과 정합성 확장

1. `StoredPreviewItinerary` 버전 1 읽기를 유지한다.
2. 버전 2 저장 타입에 `revision`과 완료된 경로 계산 메타데이터를 추가한다.
3. 버전 2만 최종 계산 완료 일정으로 판정한다.
4. 계산 잠금용 Redis 키를 일정 식별자별로 만들고 45초 뒤 자동 만료한다.
5. 저장 직전 기준 `revision`을 다시 확인한다.
6. 전체 성공 이전에는 기존 일정 키를 변경하지 않는다.

### 5. 기존 저장 API 확장

1. `POST /api/gpt/itineraries/preview-store`에서 내부 인증 헤더를 검증한다.
2. 일정 구조를 검증한 뒤 최종화 서비스를 실행한다.
3. 성공한 최종 일정만 저장한다.
4. 저장된 최종 일정과 상세 링크를 MCP에 반환한다.
5. 실패 유형을 400·401·409·422·504·500으로 구분한다.

### 6. 기존 일정·편집 재계산 API 추가

1. `POST /api/gpt/itineraries/[itineraryId]/routes/finalize`를 추가한다.
2. 저장된 일정 식별자와 `baseRevision`을 확인한다.
3. 일정·요청 출처 단위 호출 제한과 중복 계산 잠금을 적용한다.
4. 편집된 일정은 계산 성공 전 저장하지 않는다.
5. 실패 시 마지막 성공 일정 또는 기존 버전 1 일정을 유지한다.

### 7. MCP 연동 변경

1. `persistItineraryForDetailPage`가 최종 저장 결과를 반환하도록 변경한다.
2. 내부 인증 헤더를 서버 환경변수에서 읽어 전달한다.
3. `recommend_planme_itinerary`는 최종 저장 성공 후에만 `ready` 응답을 반환한다.
4. 응답 요약은 AI 초안이 아니라 반환된 최종 일정에서 만든다.
5. `get_planme_itinerary`는 MCP 프로세스 메모리가 아니라 웹의 일정 조회 API에서 최종 일정을 가져온다.
6. 위젯 조회 도구는 계속 한 번만 호출하게 한다.

## 변경 파일 후보

| 파일 | 변경 목적 | 주의점 |
| --- | --- | --- |
| `apps/web/lib/route-providers/naver-directions.ts` | 네이버 서버 호출과 변환 공용화 | 키와 요청 URL 로그 금지 |
| `apps/web/lib/route-providers/odsay.ts` | ODsay 서버 호출과 변환 공용화 | 고정 `Referer`와 호출 간격 제한 |
| `apps/web/lib/itinerary-route-finalizer.ts` | 전체 일차·두 경로 최종화 | AI 시간표 변경 금지 |
| `apps/web/app/api/naver/directions/routes/route.ts` | 공용 네이버 모듈 사용 | 기존 응답 계약 유지 |
| `apps/web/lib/preview-itinerary-store.ts` | Redis 버전 2, revision, 잠금 | 버전 1 읽기 호환 |
| `apps/web/app/api/gpt/itineraries/preview-store/route.ts` | 인증·최종화·저장 | 부분 결과 저장 금지 |
| `apps/web/app/api/gpt/itineraries/[itineraryId]/routes/finalize/route.ts` | 기존 일정·편집 재계산 | 호출 제한과 버전 충돌 |
| `apps/web/app/api/gpt/itineraries/[itineraryId]/route.ts` | 최종 저장 결과 조회 | 생성 ID 누락은 404 유지 |
| `apps/mcp/src/planme-mcp.ts` | 최종 저장 응답과 웹 조회 사용 | 2.5초 기존 저장 제한을 40초 흐름에 맞게 변경 |
| `apps/mcp/src/gpts-actions-api.ts` | GPT Actions 저장 흐름 호환 | MCP와 같은 인증·오류 처리 |
| `apps/mcp/scripts/check-planme-mcp.ts` | 최종 위젯 1회와 이동 시간 검증 | 외부 제공자는 모킹 |
| `scripts/check-planme-actions.mjs` | 계약·문구 회귀 검사 | AI 예상 시간 노출 금지 |

## API·DTO 계획

후보 요청 타입:

```ts
type FinalizePreviewRequest = {
  itinerary: PlanmeItinerary;
  baseRevision?: number;
};
```

- `itinerary`: 필수, `null` 불가
- `baseRevision`: 새 일정에서는 생략, 기존 일정 편집에서는 필수, `null` 불가
- 좌표: 입력에서는 생략 가능하지만 최종화 완료 전 반드시 확보
- 체류 시간: 추가하지 않음

후보 성공 응답 타입:

```ts
type FinalizePreviewResponse = {
  status: "ready";
  itineraryId: string;
  pageUrl: string;
  ogImageUrl: string;
  expiresAt: string;
  revision: number;
  itinerary: PlanmeItinerary;
};
```

후보 저장 타입:

```ts
type StoredPreviewItineraryV2 = {
  version: 2;
  revision: number;
  itinerary: PlanmeItinerary;
  routeCalculation: {
    status: "completed";
    calculatedAt: string;
    transportMode: PlanmeTransportMode;
  };
  savedAt: string;
  expiresAt: string;
};
```

`unknown` 또는 `unknown[]` 신규 타입은 도입하지 않는다. 기존 저장 파서의 입력 타입은 현재 선언을 유지한다.

## 핵심 구현 예시

후보: 전체 성공 후에만 결과를 반환하는 서비스 경계다.

```ts
/** 모든 일차의 두 경로를 계산하고 AI 시간표를 유지한 최종 일정을 반환한다. */
export async function finalizeItineraryRoutes(
  itinerary: PlanmeItinerary,
  options: FinalizeItineraryRouteOptions,
): Promise<PlanmeItinerary> {
  const finalizedDays = await finalizeAllDaysWithinDeadline(itinerary.days, options);

  // 입력 일정을 직접 수정하지 않아 실패 시 원본을 그대로 유지한다.
  return {
    ...itinerary,
    days: finalizedDays,
    totalDurationLabel: createFirstDayDurationLabel(finalizedDays),
  };
}
```

후보: 경로 계획에는 기존 필드를 사용한다.

```ts
const finalizedRoute: RoutePlan = {
  ...sourceRoute,
  durationLabel: providerResult.totalDurationLabel,
  durationMinutes: Math.max(1, Math.round(providerResult.totalDurationSeconds / 60)),
  geoSegments: providerResult.segments.map((segment) => segment.path),
  transitMarkers: providerResult.transitMarkers,
};
```

## 정합성과 실패 처리

- 트랜잭션 경계: 모든 경로 계산 성공 후 Redis 단일 값 교체
- 동시성: 일정 식별자 잠금과 `revision` 비교
- 중복 요청: 같은 일정 잠금이 존재하면 409
- 재시도: 제공자 오류가 일시적인 실패일 때 해당 구간 1회
- 시간 초과: 40초에 모든 실행을 중단하고 504
- 저장 실패: 계산 결과를 응답하거나 위젯 준비 상태를 반환하지 않음
- 편집 실패: 이전 성공 저장값 유지

## 구현 완료 조건

- 새 자동차 일정이 최종 네이버 이동 시간과 경로를 저장한다.
- 새 대중교통 일정이 최종 ODsay 이동 시간과 제공 가능한 경로를 저장한다.
- 모든 일차·두 경로 중 하나라도 실패하면 일정이 준비 상태가 되지 않는다.
- AI 시간표 배열은 최종화 전후 동일하다.
- MCP와 웹의 같은 일차 이동 시간이 일치한다.
- 새로고침과 일차 탭 전환에서 제공자 재호출이 없다.
