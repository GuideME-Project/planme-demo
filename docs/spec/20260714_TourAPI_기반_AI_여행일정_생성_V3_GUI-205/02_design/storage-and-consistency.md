# 저장과 정합성

## 결론

현재 Upstash Redis를 재사용하되 V3 전용 키 공간을 만든다.
일정 본문은 revision별 불변 스냅샷으로 저장하고, 메타 키가 `active`, `pending`, `previous` revision 번호만 가리킨다.

생성·편집의 부분 결과는 `pending`에서만 처리한다. 모든 장소·시간표·경로가 완성된 뒤 Redis 원자 연산으로만 `active`를 교체한다.

## 저장 객체

### 작업 메타(ItineraryJobMeta)

```ts
type ItineraryJobStatus =
  | "queued"
  | "resolving_anchors"
  | "collecting_candidates"
  | "arranging"
  | "scheduling"
  | "routing"
  | "activating"
  | "ready"
  | "failed";

type ItineraryJobMeta = {
  schemaVersion: 3;
  itineraryId: string;
  status: ItineraryJobStatus;
  activeRevision: number | null;
  pendingRevision: number | null;
  previousRevision: number | null;
  routingCursor?: { day: number; variant: "standard" | "carryme" };
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  errorCode?: string;
};
```

사용자 입력 원문이나 외부 API 원본 응답은 메타에 넣지 않는다.
`ItineraryJobMeta`가 `activeRevision`, `pendingRevision`, `previousRevision` 포인터의 단일 원천이다. 별도 포인터 키를 중복 저장하지 않는다. 단계 결과와 revision payload는 별도 키에 둘 수 있지만 조회·활성화 판단은 항상 같은 meta를 기준으로 한다.

### revision 스냅샷

revision은 다음을 함께 저장한다.

- 검증된 사용자 의도와 고정 경로 기준점
- 선택된 TourAPI 최소 장소 스냅샷
- 공통 `TripPlan`
- Standard·CarryME 경로와 서버 시간표
- 제외된 요청 장소와 reason code
- 경로 제공자 계산 시각과 stale 캐시 사용 집계

활성화된 revision은 수정하지 않는다. 편집은 항상 새 revision을 만든다.

## Redis 키

```text
planme:v3:itinerary:{itineraryId}:meta
planme:v3:itinerary:{itineraryId}:revision:{revision}
planme:v3:itinerary:{itineraryId}:phase:{revision}
planme:v3:lock:{itineraryId}:{revision}
planme:v3:idempotency:{channel}:{idempotencyHash}

planme:v3:tourapi:fresh:{destinationHash}:{contentTypeId}
planme:v3:tourapi:last-good:{destinationHash}:{contentTypeId}
```

- `itineraryId`는 입력 해시가 아니라 `crypto.randomUUID()` 기반 새 ID다.
- destination과 idempotency 입력은 SHA-256 등 안정 해시로 키를 만들고 원문을 키에 넣지 않는다.
- origin은 TourAPI 캐시 키에 포함하지 않는다.
- V1/V2의 `planme:preview:*` 키를 읽거나 삭제하지 않는다.

## TTL

| 데이터 | TTL |
| --- | ---: |
| 일정 meta·revision·phase | 최초 생성부터 7일 |
| `previous`가 가리키는 revision | 일정과 같은 만료시각 |
| idempotency | 24시간 |
| TourAPI fresh | 24시간 |
| TourAPI last-good | 7일 |
| 단계 잠금 | 45초 |

편집 성공 시 기존 일정의 절대 만료시각을 유지한다. 편집이 공유 링크를 무기한 연장하지 않는다.

## 새 생성

1. 어댑터가 멱등성 키와 정규화 입력 해시를 전달한다.
2. 같은 멱등성 키가 없으면 새 `itineraryId`, revision 1과 `queued` 메타를 만든다.
3. `pendingRevision=1`, `activeRevision=null`이다.
4. 각 `advance`가 phase 상태를 예상값 비교로 전진시킨다.
5. 최종 revision 스냅샷 저장 후 원자적으로 `activeRevision=1`, `pendingRevision=null`, `status=ready`로 전환한다.
6. 실패하면 pending payload를 폐기하고 `status=failed`, `errorCode`만 남긴다.

같은 입력이라도 새 멱등성 키이면 새 일정 ID를 만든다.

## 편집

1. 클라이언트가 `baseRevision=activeRevision`과 변경된 공통 방문계획 명령을 보낸다.
2. 다른 pending이 없을 때만 서버가 `pendingRevision=activeRevision+1`을 만든다. 이미 편집이 진행 중이면 두 번째 편집 시작은 409로 거부한다.
3. TourAPI 후보 선택을 다시 검증하고 두 경로·전체 시간표를 재계산한다.
4. 계산 중 웹은 기존 active를 계속 표시한다.
5. 활성화 Lua는 요청의 base revision과 현재 active revision이 같은지 확인한다.
6. 성공하면 `previousRevision=기존 active`, `activeRevision=pending`, `pendingRevision=null`로 바꾼다.
7. 실패하면 pending을 삭제하고 active와 previous를 바꾸지 않는다.

동시에 두 편집이 시작되면 pending을 먼저 만든 요청만 진행한다. 둘 다 생성 단계를 통과한 예외적 경합에서도 활성화 compare-and-set은 하나만 성공하고 나머지는 `ITINERARY_VERSION_CONFLICT`로 끝난다.

## 원자적 활성화

활성화는 Redis Lua 또는 동등한 단일 원자 연산으로 수행한다.

```text
입력: itineraryId, expectedActiveRevision, pendingRevision, revisionPayload

1. meta가 존재하고 만료되지 않았는지 확인
2. meta.activeRevision == expectedActiveRevision 확인
3. meta.pendingRevision == pendingRevision 확인
4. pending phase가 모든 계산 완료 상태인지 확인
5. revision payload 저장
6. previous = active
7. active = pending
8. pending = null, status = ready
9. 모든 키 만료시각을 itinerary 절대 만료시각에 맞춤
```

revision payload 저장 뒤 메타 전환 전에 실패해 고아 revision이 생길 수 있으므로, 활성화 연산 안에서 둘을 함께 처리한다. 구현 환경 제약으로 분리가 필요하면 고아 revision은 active 포인터가 없으므로 조회하지 않으며 같은 TTL로 자동 제거한다.

## 단계 실행 잠금

- `advance`는 `(itineraryId, pendingRevision)` 잠금을 `SET NX EX`로 획득한다.
- 잠금을 얻지 못하면 외부 API를 다시 호출하지 않고 현재 processing 상태를 반환한다.
- 잠금 획득 뒤에도 meta status와 routing cursor를 다시 확인한다.
- 단계 결과는 예상 status가 그대로일 때만 기록한다.
- 잠금 해제 실패는 성공 결과를 되돌리지 않으며 TTL로 해소한다.
- 45초 안에 끝나지 않는 routing 작업은 일차·변형 단위로 더 분할한다.

## 멱등성

어댑터는 모델이 만드는 임의 문자열이 아니라 도구 호출 단위의 안정된 멱등성 키를 전달한다.

idempotency 값에는 다음을 저장한다.

```ts
type IdempotencyRecord = {
  requestHash: string;
  itineraryId: string;
  createdAt: string;
};
```

- 같은 키·같은 입력 해시: 기존 일정 ID와 상태 반환
- 같은 키·다른 입력 해시: `IDEMPOTENCY_KEY_REUSED` 409
- 다른 키·같은 입력: 새 일정 ID 생성
- 24시간 이후 같은 입력: 새 요청으로 취급

## TourAPI 캐시 정합성

유형별 정상 응답은 fresh와 last-good 키를 함께 갱신한다.

- fresh 저장 성공, last-good 저장 실패: 현재 요청은 fresh로 진행하지만 저장 실패를 기록한다.
- fresh 저장 실패: 현재 응답 데이터로 생성은 계속할 수 있으나 후보 캐시 저장 실패를 기록한다.
- 장애 시 fresh가 없고 last-good이 7일 이내면 stale로 사용한다.
- 정상 빈 응답은 fresh·last-good 모두 빈 결과로 갱신해 삭제된 장소를 되살리지 않는다.

최종 revision은 선택 장소를 내장하므로 후보 캐시 키를 장기 참조하지 않는다.

## 읽기 계약

```text
GET itinerary meta
  ready      -> active revision 반환
  processing -> status, retryAfterMs 반환
  failed     -> 안정된 errorCode 반환
  missing    -> 404
```

웹 상세와 위젯은 `activeRevision` 외 revision을 렌더링하지 않는다. 편집 화면만 기존 active와 pending 상태를 함께 표시할 수 있으며 pending 본문은 렌더링하지 않는다.

## 오류 코드

| 코드 | 의미 |
| --- | --- |
| `ITINERARY_NOT_FOUND` | 일정 또는 작업 없음 |
| `ITINERARY_VERSION_CONFLICT` | 편집 base revision 충돌 |
| `IDEMPOTENCY_KEY_REUSED` | 같은 멱등성 키에 다른 입력 |
| `GENERATION_ALREADY_RUNNING` | 다른 advance가 단계 처리 중 |
| `PENDING_REVISION_MISSING` | 상태와 pending 데이터 불일치 |
| `PREVIEW_STORE_UNAVAILABLE` | Redis 읽기·쓰기 실패 |

외부 제공자 오류는 저장 계층 코드로 뭉개지 않고 작업의 안정된 도메인 error code로 변환해 meta에 기록한다.

## 보안과 개인정보

- Redis 키에는 출발지, 목적지 원문, 선호와 주소를 넣지 않는다.
- revision에는 화면과 재현에 필요한 최소 장소·기준점 데이터만 저장한다.
- Redis 오류 로그에 payload와 인증 토큰을 출력하지 않는다.
- 프로덕션에서는 Upstash 설정 누락 시 메모리 저장소로 조용히 fallback하지 않고 실패한다.
- 내부 `advance`·활성화 엔드포인트는 기존 내부 bearer 인증 또는 동등한 서버 간 인증을 사용한다.

## 리스크

- revision 내 경로선과 장소 스냅샷으로 payload가 커진다. 기존 E2E의 1MB 기준을 V3에서도 측정하고 초과 시 경로선 단순화를 검토한다.
- 자동 조회가 중단된 processing 작업이 TTL 동안 남을 수 있다. 외부 부작용은 없으며 같은 일정 ID의 조회로 재개할 수 있다.
- 24시간 멱등성 TTL 이후 동일 도구 요청 재전송은 새 일정을 만든다. 이는 새 생성은 새 ID라는 제품 정책과 일치한다.
- Redis Lua 복잡도가 늘어난다. 메모리 구현도 같은 CAS 계약을 가져 단위 테스트에서 동작 차이를 검증한다.

## References

- [저장·정합성 인터뷰](../01_interview/storage-and-consistency.md)
- [현재 Redis 저장소](../../../../apps/web/lib/preview-itinerary-store.ts)
- [현재 경로 활성화 API](../../../../apps/web/app/api/gpt/itineraries/[itineraryId]/routes/finalize/route.ts)
- [현재 MCP 내부 저장 API](../../../../apps/web/app/api/gpt/itineraries/preview-store/route.ts)
- [현재 결정적 일정 ID](../../../../packages/planme-core/src/generated-itineraries.ts)
