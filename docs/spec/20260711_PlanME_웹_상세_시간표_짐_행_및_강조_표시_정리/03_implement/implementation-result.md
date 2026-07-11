# 구현 결과

## 결론

Standard 시간표에서 CarryME 배송 사건을 제거하고 기존 짐 보관 표현을 호텔 체크인으로 보정했다. CarryME 배송 사건은 유지하며, 웹 상세 시간표 행의 공통 강조는 제거하되 CarryME 배송 아이콘과 총 이동 시간 상자의 절약 칩은 유지했다.

## 공통 일정 보정

- `packages/planme-core/src/draft-itineraries.ts`
  - Standard의 CarryME 배송 사건을 제목·설명·분류 기준으로 제거한다.
  - 기존 `체크인 전 짐 보관` 사건을 `{호텔명} 체크인`과 승인된 설명으로 보정한다.
  - 관광 후 호텔 복귀·숙박 같은 정상 호텔 사건은 유지한다.
  - CarryME의 명백한 배송 사건 분류를 `carryme`로 보정한다.
  - 보정된 동일 입력을 식별자 생성, 검증, 초안 생성에 사용한다.
  - 배송 사건 제거 후 Standard가 비면 기존 `needs_revision`과 `missing_timeline` 오류를 반환한다.
  - 원본 입력 배열과 사건 객체를 변경하지 않는다.

## 생성 지침

- `packages/planme-core/src/openai-itinerary-generator.ts`
  - Standard 호텔 중간 방문을 짐 보관이 아닌 체크인으로 작성하도록 지시한다.
  - 이후 같은 호텔 방문은 복귀·숙박으로 작성하도록 구분한다.
  - Standard에서 CarryME 배송 사건과 `carryme` 분류를 금지한다.
  - CarryME 배송 사건에는 `carryme` 분류를 요구한다.

## 웹 상세 화면

- `apps/web/lib/itinerary-timeline-display.ts`
  - 웹에서도 공통 보정 함수를 재사용해 기존 저장 일정에 같은 의미 규칙을 적용한다.
- `apps/web/components/itinerary/TimelinePanel.tsx`
  - Standard의 배송 사건을 표시하지 않고 기존 짐 보관 표현을 체크인으로 표시한다.
  - 일정 행의 연한 초록 배경·테두리, 초록 체크, 행 내부 절약 칩을 제거한다.
  - CarryME 배송 사건의 차량 아이콘과 빛나는 효과를 유지한다.
  - CarryME 총 이동 시간 상자 오른쪽 절약 칩을 유지한다.
  - 화면 회귀 검사가 MUI 자동 클래스명에 의존하지 않도록 안정적인 검사 속성을 추가한다.

## 자동 검사

- `apps/mcp/scripts/check-planme-mcp.ts`
  - 보정 규칙, 입력 불변성, 빈 Standard 오류, 생성 지침 계약을 검사한다.
- `apps/web/e2e/gpt-itinerary-generation.spec.ts`
  - 2일 일정, Light·Dark, Standard·CarryME 분리, 체크인·복귀 보존, 배송 표시와 강조 규칙을 검사한다.

## 설계 대비 차이

- 설계 범위와 동일하게 구현했다.
- 데이터 마이그레이션이나 저장 형식 변경은 하지 않았다.
- 지도 컴포넌트와 경로 계산 로직은 변경하지 않았다.

## 남은 작업

- GitHub PR 생성과 병합.
- Vercel 자동 배포 성공 확인.
- 운영 기존 일정과 ChatGPT 신규 일정 생성 검증.

