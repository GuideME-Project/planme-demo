# TourAPI와 AI 계약

## 결론

PlanME 웹 서버가 TourAPI 후보를 수집·정규화·캐시한 뒤 제한된 후보 스냅샷을 Luna에 전달한다.
Luna는 후보의 `contentId`만 배열하고, 서버는 허용 목록 검증을 통과한 ID를 저장된 TourAPI 스냅샷과 다시 결합한다.

프롬프트는 장소 발명 금지를 명시하지만 보안 경계로 취급하지 않는다. 최종 통제는 서버의 스키마, 허용 목록과 데이터 재결합이다.

## TourAPI 조회 계약

기준 서비스는 한국관광공사 국문 관광정보 서비스 `KorService2`다.

| 목적 | API | 적용 조건 |
| --- | --- | --- |
| 법정동 코드 확인 | `ldongCode2` | 목적지 문자열을 `lDongRegnCd`, `lDongSignguCd` 조회 범위로 변환 |
| 일반 장소 후보 | `areaBasedList2` | 콘텐츠 유형별 지역 후보 조회 |
| 숙소 후보 | `searchStay2` | 고정 숙소 후보 조회 |
| 행사·축제 | `searchFestival2` | 사용자가 실제 여행 날짜를 제공한 경우만 조회 |
| 선택 장소 보강 | `detailCommon2` | 목록 응답에 표시 필드가 부족한 선택 장소만 조회 |

콘텐츠 유형은 다음 값만 허용한다.

| contentTypeId | 의미 | 사용 |
| ---: | --- | --- |
| 12 | 관광지 | 방문 장소 |
| 14 | 문화시설 | 방문 장소 |
| 15 | 행사·축제 | 여행 날짜가 있을 때만 방문 장소 |
| 28 | 레포츠 | 방문 장소 |
| 32 | 숙박 | 전체 일정의 고정 숙소 |
| 38 | 쇼핑 | 방문 장소 |
| 39 | 음식점 | 선택적 점심·저녁 장소 |
| 25 | 여행코스 | 제외 |

구현 전 공식 샘플로 각 API의 필드 이름, 페이지네이션과 오류 본문을 다시 검증한다. 문서에 없는 필드를 추정해 필수 계약으로 사용하지 않는다.

## 후보 수집과 정규화

### 조회 단위

- 목적지의 TourAPI 법정동 시도·시군구 코드와 콘텐츠 유형을 캐시 단위로 사용한다.
- 사용자가 말한 특정 장소는 같은 지역 후보에서 정규화 제목으로 일치 여부를 확인한다.
- 텍스트가 일치하지 않는 장소를 유사하다는 이유만으로 자동 포함하지 않는다.
- 이벤트는 `travelStartDate`와 여행 종료일 범위에 유효한 항목만 남긴다.

### 정규화 필드

```ts
type NormalizedTourCandidate = {
  contentId: string;
  contentTypeId: AllowedTourContentTypeId;
  title: string;
  coordinate: { lat: number; lng: number };
  address?: string;
  regionCode?: string;
  districtCode?: string;
  fetchedAt: string;
  cacheStatus: "fresh" | "stale";
};
```

- `mapX`는 경도(`lng`), `mapY`는 위도(`lat`)로 변환한다.
- 값이 없거나 숫자가 아니거나 0이면 제외한다.
- 경도는 -180~180, 위도는 -90~90 범위를 먼저 검사한다.
- `regionCode`는 TourAPI `lDongRegnCd`, `districtCode`는 `lDongSignguCd`에서만 만든다.
- 목적지 법정동 코드가 요청 범위와 다른 후보는 제외한다.
- `(contentTypeId, contentId)`를 안정 식별자로 사용하고 제목이나 좌표로 ID를 새로 만들지 않는다.
- 제목의 HTML 태그와 불필요한 공백만 정규화하며 임의로 이름을 고치지 않는다.

### 후보 상한

초기 상한은 콘텐츠 유형별 30개다. 상한은 모델 계약이 아니라 서버 정책 상수로 두고, 구현 시 단위와 근거를 주석으로 남긴다.

이 30개는 AI에 전달하는 후보 상한이지 TourAPI 조회 상한이 아니다. 서버는 TourAPI가 제공하는 페이지 정보 안에서 결정적인 조회 범위를 소유하고, 사용자가 자발적으로 요청한 장소의 정확 일치 검사를 30개 절단 전에 수행한다. 구현 전 공식 샘플로 `totalCount`, 페이지 크기와 최대 조회 범위를 확인해 호출량 상한을 정한다. 확인된 상한 안에서 찾지 못한 장소는 `TOURAPI_NOT_FOUND`로 기록하며 다른 공급자나 AI로 보강하지 않는다.

정렬 우선순위는 다음과 같다.

1. 사용자가 자발적으로 요청한 장소와 정확히 일치
2. 목적지 하위 지역 일치
3. 자발적으로 제공한 선호 키워드 일치
4. 주소·좌표 등 필수 데이터 완전성
5. 제목과 `contentId`의 안정 정렬

후보가 상한을 넘으면 이 정렬로 자른다. AI가 검색 범위나 페이지 수를 결정하지 않는다.

## 유형별 캐시

성공한 조회는 두 키에 저장한다.

- fresh: 24시간 TTL
- last-good: 7일 TTL

정상 응답은 두 키를 갱신한다. fresh 키가 없고 해당 유형 요청이 네트워크·429·5xx 같은 장애로 실패했을 때만 last-good을 사용한다.

정상 HTTP·정상 TourAPI 응답이지만 후보가 0개인 경우에는 오래된 후보를 되살리지 않는다. 빈 결과도 해당 시점의 정상 결과로 기록한다.

| 유형 | 장애·last-good 없음 |
| --- | --- |
| 숙박 | 생성 실패 |
| 음식점 | 위치 없는 일반 식사 시간으로 계속 |
| 방문 장소 일부 유형 | 남은 유형으로 축소 |
| 모든 방문 장소 유형 | 생성 실패 |

각 후보는 `fetchedAt`과 `cacheStatus`를 가진다. 최종 revision은 자신이 사용한 값을 내장하므로 이후 캐시 갱신이 기존 일정에 영향을 주지 않는다.

## AI 입력 계약

모델은 `gpt-5.6-luna`, 추론 강도는 `low`로 고정한다. 입력에는 다음만 포함한다.

- 여행 기간과 날짜
- 이동 수단
- 서버가 확인한 목적지 지역
- 자발적으로 제공된 선호와 특정 장소
- 유형별 TourAPI 후보의 `contentId`, 유형, 공식 제목과 필요한 최소 설명 필드
- 숙소 하나, 중복 없는 방문 장소, 선택적 음식점을 골라야 한다는 규칙

출발지·목적지 경로 좌표는 AI가 판단할 필요가 없으므로 배열 기준 정보로만 제공하거나 생략한다. 좌표를 출력하도록 요구하지 않는다.

프롬프트에는 다음 금지사항을 명시한다.

- 후보에 없는 ID·장소를 만들지 않는다.
- 이름, 주소, 좌표, 방문 시각, 체류시간, 이동시간을 출력하지 않는다.
- 같은 방문 장소를 일정 채우기용으로 반복하지 않는다.
- 여행코스 유형을 선택하지 않는다.
- 날짜가 없는 행사·축제를 선택하지 않는다.

## AI 출력 스키마와 검증

출력은 [공통 `AiPlanSelection`](architecture-and-domain-model.md#ai-선택aiplanselection) 스키마만 허용한다. JSON 스키마는 추가 속성을 허용하지 않는다.

검증 순서는 다음과 같다.

1. JSON과 필수 필드 형식 검사
2. `days.length === durationDays`와 day 번호 연속성 검사
3. `lodgingContentId`가 숙박 후보인지 검사
4. 모든 방문 ID가 허용 목록에 있는지 검사
5. 음식점 ID가 음식점 후보인지 검사
6. 숙소 외 `contentId` 중복 금지
7. 요청한 특정 장소가 없을 경우 AI가 유사 장소로 치환하지 않았는지 검사
8. ID를 TourAPI 스냅샷과 서버에서 재결합

AI가 이름·좌표 같은 추가 필드를 보내도 전체 응답을 거부한다. 알려진 필드만 골라 쓰는 느슨한 파싱을 하지 않는다.

## 재시도와 결정적 대체

첫 Luna 요청이 네트워크 오류, 빈 응답, 스키마 오류 또는 허용 목록 위반으로 실패하면 같은 모델·같은 후보 스냅샷으로 한 번만 재시도한다.

두 번째도 실패하면 서버 배열기를 사용한다.

1. 숙소 후보 정렬의 첫 항목을 선택한다.
2. 방문 장소는 유형이 한쪽에 몰리지 않도록 라운드로빈으로 고른다.
3. 좌표 간 직선거리를 사용해 인접 이동이 짧은 안정 순서를 만든다.
4. 음식점은 식사 전후 방문 장소와 가까운 후보를 우선한다.
5. 동일 점수는 `contentId`로 정렬해 같은 입력 스냅샷에서 같은 결과를 만든다.
6. 장소가 부족한 일차는 자유시간·숙소 휴식으로 남긴다.

서버 배열기도 후보 허용 목록과 중복 금지 검증을 동일하게 통과해야 한다. 다른 AI 모델과 V2 생성기로 fallback하지 않는다.

## 특정 장소 제외 기록

자발적으로 요청한 장소가 후보에 없거나 좌표가 유효하지 않으면 다음 기록을 `TripPlan`에 남긴다.

```ts
type ExcludedRequestedPlace = {
  input: string;
  reason: "TOURAPI_NOT_FOUND" | "INVALID_COORDINATE" | "UNROUTABLE";
};
```

- GPTs 최종 텍스트와 GPT App 위젯에는 제외 사실을 표시한다.
- 웹 상세에는 제외 안내를 표시하지 않는다.
- 비슷한 TourAPI 후보를 요청 장소로 가장하지 않는다.

## 보안과 관측성

- TourAPI 서비스 키와 OpenAI 키는 `apps/web` 서버 전용 환경변수로만 읽는다.
- MCP 런타임은 V3 TourAPI·OpenAI 키를 읽거나 자체 후보 수집·AI fallback을 수행하지 않는다.
- 원본 요청 URL, 인증키, 전체 프롬프트와 전체 TourAPI 응답을 로그에 남기지 않는다.
- 로그에는 작업 ID, 단계, 콘텐츠 유형, 후보 수, fresh/stale, AI 시도 횟수와 안정된 오류 코드만 남긴다.
- 사용자 출발지와 자유 입력 선호를 Redis 키나 메트릭 라벨에 원문으로 넣지 않는다.
- AI 출력 원문은 허용 목록 위반 조사에 필요하더라도 기본 저장하지 않는다.

## 리스크

- 유형별 30개 상한이 장기 일정의 후보 다양성을 제한할 수 있다. 14일 계약 테스트와 입력 크기 측정으로 상한을 조정한다.
- TourAPI 제목이 같은 서로 다른 장소가 있을 수 있다. 사용자 요청 일치는 법정동 코드와 `contentId`를 함께 보고, 제목만으로 자동 치환하지 않는다.

2026-01-12부터 기존 `areaCode`, `sigunguCode` 입출력은 미표출되고 `lDongRegnCd`, `lDongSignguCd`로 대체됐다. V3 구현은 예전 필드를 fallback으로 읽지 않는다.
- last-good 혼합 스냅샷은 유형마다 조회 시각이 다를 수 있다. 각 장소의 `fetchedAt`을 보존하고 전체 일정에 stale 사용 여부를 집계한다.
- 공식 API 필드가 변경될 수 있다. 파서는 필수 식별·좌표 필드 누락을 실패로 처리하고 계약 테스트로 감지한다.

## References

- [TourAPI·AI 인터뷰](../01_interview/tourapi-and-ai-boundary.md)
- [한국관광공사 국문 관광정보 서비스](https://www.data.go.kr/data/15101578/openapi.do)
- [2026-01-12 지역·분류 코드 입출력 변경 공지](https://www.data.go.kr/bbs/ntc/selectNotice.do?originId=NOTICE_0000000004459)
- [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [현재 AI 생성기](../../../../packages/planme-core/src/openai-itinerary-generator.ts)
- [현재 네이버 장소 후보](../../../../packages/planme-core/src/place-candidates.ts)
- [현재 숙소 후보](../../../../packages/planme-core/src/accommodation-candidates.ts)
