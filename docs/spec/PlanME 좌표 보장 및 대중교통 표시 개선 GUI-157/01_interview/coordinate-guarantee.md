# 좌표 보장 정책

## 목적

- 이 주제를 확인하는 이유: PlanME 일정 링크가 좌표 없는 방문지를 포함하면 지도, 경로 재계산, 대중교통 표시가 모두 불안정해진다.
- 이 주제가 불명확하면 생기는 리스크: AI가 만든 일반 장소명이 그대로 저장되어 지도에서 누락되거나 잘못된 장소로 연결될 수 있다.

## Questions

1. 좌표가 없는 방문지가 있으면 일정 링크 생성 자체를 막을지, AI 후보 검증 흐름으로 재검색할지?
2. AI 후보 검증과 최후 확정 후에도 좌표와 `placeId` 또는 검색 출처를 보장하지 못하면 어떻게 처리할지?
3. Function Calling 장소 검색에서 Text Search와 Nearby Search를 어떤 용도로 사용할지?
4. Nearby Search 반경은 어디까지 허용할지?
5. Text Search 후보 선택은 누가 판단할지?

## Answers

1. 좌표 없는 방문지는 기존 Google Places 1순위 자동 대체로 처리하지 않는다. OpenAI Function Calling 기반 장소 검색과 AI 후보 적합성 판단 흐름으로 재검색한다.
2. AI 후보 검증, 최대 2라운드 되묻기, 마지막 검색 1회, 내부 AI 최후 확정 후에도 좌표와 `placeId` 또는 검색 출처가 없으면 일정 링크를 생성하지 않는다.
3. `search_places_text`는 텍스트 기반 장소 후보 검색에 사용하고, `search_places_nearby`는 기준 좌표 주변 후보 검색에 사용한다.
4. Nearby Search 반경 정책의 구체값은 구현 설계 단계에서 정한다. 거리 기준이 사용자 의도에 따라 달라질 수 있으므로 인터뷰 문서에서는 고정 숫자를 두지 않는다.
5. Text Search 후보는 검색 순위만으로 자동 채택하지 않는다. AI가 사용자 의도 적합성을 판단하고, 코드는 좌표와 `placeId` 또는 검색 출처 hard gate만 확인한다.

## Score

- 현재 불명확성 점수: `0.12`
- 목표 임계값: `Standard 0.20`
- 점수 근거: 좌표 보장 hard gate, Function Calling 기반 재검색, 1순위 자동 대체 폐기, 최종 실패 처리까지 확정되었다.
- 다음에 낮춰야 할 불확실성: OpenAI Function Calling 후보와 Google/Naver 검색 출처를 저장하는 내부 데이터 구조.

## Confirmed

- 숙소뿐 아니라 낚시터, 관광지, 식당, 카페 등 비숙소 방문지도 좌표 보장 대상이다.
- 기존 Google Places 1순위 자동 대체 로직은 폐기한다.
- OpenAI Function Calling 기반 `search_places_text`, `search_places_nearby`로 장소 후보를 검색한다.
- AI가 검색 후보의 사용자 의도 적합성을 판단한다.
- 코드는 좌표와 `placeId` 또는 검색 출처 존재만 hard gate로 확인한다.
- AI 후보 검증과 최후 확정 후에도 hard gate를 통과하지 못하면 링크를 만들지 않는다.

## Open Questions

- Function Calling 도구의 실제 JSON schema와 후보 검색 출처 저장 방식을 설계 단계에서 결정해야 한다.
- `placeId`가 없는 Naver 결과를 어떤 검색 출처 식별자로 저장할지 설계 단계에서 결정해야 한다.

## References

- [Linear GUI-157](https://linear.app/guideme/issue/GUI-157/planme-%EC%A2%8C%ED%91%9C-%EB%B3%B4%EC%9E%A5-%EB%B0%8F-%EB%8C%80%EC%A4%91%EA%B5%90%ED%86%B5-%ED%91%9C%EC%8B%9C-%EA%B0%9C%EC%84%A0) - 확정 요구사항
- [Google Places Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search) - 텍스트 기반 장소 검색
- [Google Places Nearby Search](https://developers.google.com/maps/documentation/places/web-service/nearby-search) - 좌표와 반경 기반 주변 장소 검색
- [AI 장소 후보 검증 정책](./ai-place-validation.md) - Function Calling 기반 장소 후보 판단 정책
- `packages/planme-core/src/accommodation-candidates.ts` - 현재 숙소 후보 검색 구현
- `packages/planme-core/src/gpt-actions.ts` - MCP 일정 생성 흐름
