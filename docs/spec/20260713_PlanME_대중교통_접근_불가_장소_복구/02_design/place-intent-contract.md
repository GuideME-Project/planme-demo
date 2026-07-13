# 장소 의도와 고정 계약

## 목적

사용자가 말한 여행 지역을 방문지로 오해하지 않고, 사용자가 직접 지정한 장소와 AI가 추천한 장소를 경로 복구 단계까지 구분한다.

## 현재 문제

GPTs와 GPT 앱은 하나의 `destination` 필드에 도시·지역과 정확한 장소를 모두 받는다. 핵심 처리기의 `resolveRequiredPlaces`와 `applyRequiredPlacesToDraft`는 이 값을 필수 목적지로 적용한다. 이 때문에 `남해` 같은 여행 범위가 행정 중심 좌표를 가진 방문지로 삽입될 수 있다.

초안에는 `requiredPlaceKind`가 있지만 `toRouteStop` 변환에서 제거된다. 웹이 ODsay 실패를 발견하는 시점에는 해당 장소가 사용자 고정 장소인지 AI 추천 장소인지 판단할 근거가 없다.

## 공개 요청 계약

기존 `destination`은 호환성을 위해 유지하고 다음 필드를 추가한다.

| 필드 | 형식 | 필수 여부 | 의미 |
| --- | --- | --- | --- |
| `destination` | `string` | 필수 | 여행 범위 또는 대표 목적지 문자열 |
| `destinationType` | `"region" \| "place"` | 신규 클라이언트 필수, 전환기 선택 | `destination`의 의미 |
| `mustVisitPlaces` | `string[]` | 선택 | 사용자가 직접 지정한 필수 방문지 |

### 해석 규칙

1. `destinationType="region"`이면 `destination`은 생성 범위와 후보 검색 지역으로만 사용하며 경로 정류장에 삽입하지 않는다.
2. `destinationType="place"`이면 `destination`을 `mustVisitPlaces`에 중복 없이 포함한다.
3. `mustVisitPlaces`의 각 장소는 고정 장소다.
4. `destinationType`이 없는 레거시 요청은 기존 의미를 보존하기 위해 `place`로 취급한다. 신규 GPTs·GPT 앱 지침은 필드를 항상 보내도록 갱신한다.
5. 빈 문자열과 중복 장소는 정규화 단계에서 제거하되 사용자가 지정한 서로 다른 장소를 이름 유사성만으로 합치지 않는다.

### 예시

| 사용자 의도 | 정규화 요청 |
| --- | --- |
| 남해 1박 2일 | `destination="남해"`, `destinationType="region"` |
| 보리암에 가고 싶다 | `destination="보리암"`, `destinationType="place"`, `mustVisitPlaces=["보리암"]` |
| 남해에서 보리암과 독일마을 | `destination="남해"`, `destinationType="region"`, `mustVisitPlaces=["보리암", "남해독일마을"]` |

## 내부 장소 계약

### 초안

AI 생성 초안은 기존 `requiredPlaceKind`를 유지하고 필수 방문지까지 표현할 수 있도록 확장한다.

```ts
type PlanmeDraftRouteStop = {
  name: string;
  requiredPlaceKind?: "origin" | "destination" | "must_visit";
  // 기존 필드 생략
};
```

### 저장 경로 정류장

`RouteStop`에 다음 필드를 추가한다.

```ts
type RouteStop = {
  stopRef?: string;
  placeConstraint?: "fixed" | "replaceable";
  // 기존 필드 생략
};
```

- `stopRef`는 같은 논리적 일정 장소를 Standard·CarryME·타임라인·복구 응답에서 연결하는 안정적인 식별자다.
- 장소가 다른 후보로 교체돼도 논리적 슬롯의 `stopRef`는 유지한다.
- 출발지, `destinationType="place"` 목적지, `mustVisitPlaces`는 `fixed`다.
- AI 생성 방문지는 `replaceable`이다.
- 숙소가 사용자 지정 숙소가 아니라 AI가 고른 장소라면 방문 장소로서는 `replaceable`이지만, 해당 시도 안에서 CarryME 인계 기준점과 Standard 숙박지는 같은 `stopRef`를 사용한다.

## 식별자 생성

`stopRef`는 모델이 작성하지 않고 서버가 정규화 후 생성한다.

- 형식 예: `day-1:visit-2`
- 장소명, 좌표, 공급자 장소 ID를 식별자에 넣지 않는다.
- Standard와 CarryME에서 같은 논리 장소는 같은 `stopRef`를 공유한다.
- 교체·재해석이 발생해도 기존 참조를 유지한다.
- 새 슬롯이 생기거나 슬롯이 제거될 때만 참조 집합이 달라진다.

## 처리 흐름

1. GPTs 또는 GPT 앱이 공개 요청 의도를 명시한다.
2. MCP가 `region` 범위와 고정 장소 목록을 분리한다.
3. OpenAI 생성 프롬프트에 지역 범위와 고정 장소를 별도 제약으로 전달한다.
4. 초안 정규화가 모델 출력을 검증하고 서버가 `stopRef`와 `placeConstraint`를 부여한다.
5. 네이버 장소 후보 해석은 제약을 변경하지 않고 좌표와 공급자 참조만 채운다.
6. 웹 경로 최종화는 `placeConstraint`에 따라 고정 장소 복구 또는 AI 장소 교체 요청을 선택한다.

## 호환성과 오류 처리

- 저장된 레거시 일정에 `stopRef` 또는 `placeConstraint`가 없으면 상세 조회는 허용한다.
- 레거시 일정 재최종화 시 장소명을 이용해 고정 여부를 추론하지 않는다.
- 신규 생성 요청인데 필수 장소가 정규화 후 사라지거나 고정 제약이 손실되면 저장하지 않고 안정적인 내부 계약 오류로 종료한다.
- 공개 응답에는 내부 `placeConstraint`를 노출할 필요가 없다.

## 검증 기준

1. `destinationType="region"`인 `남해`가 방문 정류장으로 삽입되지 않는다.
2. `mustVisitPlaces`의 장소는 경로 실패 후에도 자동 교체·제거되지 않는다.
3. AI 장소는 `replaceable`로 저장되고 교체 후에도 같은 `stopRef`를 유지한다.
4. GPTs와 GPT 앱이 동일한 정규화 결과를 만든다.
5. 레거시 요청은 필드 부재로 즉시 실패하지 않는다.

## 리스크

- 레거시 호출이 넓은 지역을 보내면서 `destinationType`을 누락하면 기존처럼 장소로 처리된다. 이는 호환성을 위한 의도적 제한이며 새 스키마 지침 배포로 줄인다.
- 모델이 필수 장소를 누락할 수 있으므로 프롬프트만 믿지 않고 정규화 단계에서 다시 삽입·검증해야 한다.

## References

- [장소 고정 범위 인터뷰](../01_interview/place-scope-and-priority.md)
- [GPT Actions 입력 처리](../../../../packages/planme-core/src/gpt-actions.ts)
- [AI 일정 생성기](../../../../packages/planme-core/src/openai-itinerary-generator.ts)
- [일정 초안 정규화](../../../../packages/planme-core/src/draft-itineraries.ts)
- [공유 일정 자료형](../../../../packages/planme-core/src/mock-data.ts)
- [GPT Actions API](../../../../apps/mcp/src/gpts-actions-api.ts)
- [GPT 앱 MCP](../../../../apps/mcp/src/planme-mcp.ts)
