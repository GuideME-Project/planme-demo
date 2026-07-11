# Standard 체크인과 CarryME 배송 사건 정책

## 목적

- 이 주제를 확인하는 이유: Standard의 호텔 체크인 사건과 CarryME의 짐 배송 사건이 같은 열에 함께 표시되어 두 경로의 의미가 섞이고 있다.
- 이 주제가 불명확하면 생기는 리스크: 정상적인 호텔 중간 방문까지 제거하거나, 반대로 CarryME 배송이 Standard에도 제공되는 것처럼 보일 수 있다.

## Questions

1. Standard가 호텔/숙소를 중간 방문하는 업무 목적은 무엇인가?
2. 호텔 중간 방문과 관광 후 호텔 도착이 같은 날 함께 표시되어도 되는가?
3. Standard에서 제거해야 하는 행은 무엇인가?
4. 기존 `체크인 전 짐 보관`은 어떻게 표시할 것인가?
5. AI가 지침을 어기고 Standard에 배송 사건을 만들면 어떻게 처리할 것인가?
6. 실제 체크인 가능 시간을 확인할 수 없으면 어떻게 표시할 것인가?

## Answers

1. 짐을 놓기 위해 호텔/숙소를 중간 방문하여 체크인하는 경로다.
2. 목적과 시간이 다르면 정상이다. 예를 들어 13시 호텔 체크인과 18시 관광 후 호텔 도착은 함께 표시할 수 있다.
3. 같은 시각·장소의 `짐 호텔 도착`처럼 CarryME 전용 배송 사건만 Standard에서 제거한다.
4. `{호텔명} 체크인`으로 바꾸고 설명도 `호텔에 체크인한 뒤 다음 일정으로 이동합니다.`로 보정한다.
5. 생성 결과 후처리에서 Standard의 CarryME 배송 사건만 제거하고 정상 일정을 유지한다.
6. `호텔 체크인`으로 표시하되 AI가 통상적인 오후 시간대에 배치하도록 지침을 추가한다.

## Score

- 현재 불명확성 점수: `0.04`
- 목표 임계값: `Standard 0.20`
- 점수 근거: 정상 호텔 사건, 오류 배송 사건, 기존 문구 보정과 새 생성 후처리 기준이 확정됐다.
- 다음에 낮춰야 할 불확실성: 배송 사건 판별에 사용할 구조화 분류와 제한된 문구 보조 조건의 구체적 우선순위.

## Confirmed

- Standard의 호텔 중간 방문과 관광 후 호텔 복귀는 서로 다른 여행자 사건이다.
- Standard의 첫 호텔 중간 방문은 체크인으로 표현한다.
- Standard에는 CarryME 배송 사건을 작성하거나 표시하지 않는다.
- CarryME에는 짐 배송 사건을 유지한다.
- 기존 `체크인 전 짐 보관`은 체크인 의미가 명시된 경우에만 제목과 설명을 함께 보정한다.
- 일반 짐 보관 문구를 모두 체크인으로 임의 변환하지 않는다.
- 호텔의 실제 체크인 가능 시간 외부 검증은 이번 범위가 아니다.

## Open Questions

- 없음. 구체적인 판별 함수와 적용 계층은 설계 문서에서 정한다.

## References

- [기존 CarryME 타임라인의 짐 숙소 도착 결정](../../20260709_CarryME_일정_경로_버그/01_interview/carryme-luggage-event.md) - CarryME 짐 배송 사건의 기존 제품 의미.
- [openai-itinerary-generator.ts](../../../../packages/planme-core/src/openai-itinerary-generator.ts) - Standard와 CarryME 생성 지침 및 공통 시간표 스키마.
- [draft-itineraries.ts](../../../../packages/planme-core/src/draft-itineraries.ts) - 생성 결과 검증과 시간표 변환 코드.
- [TimelinePanel.tsx](../../../../apps/web/components/itinerary/TimelinePanel.tsx) - 두 시간표 열을 렌더링하는 웹 컴포넌트.

