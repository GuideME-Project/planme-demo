# 현재 코드와 전환 리스크

## 목적

- 이 주제를 확인하는 이유: 확정한 V3 정책과 현재 구현의 구조적 차이를 기록해 단순 TourAPI 어댑터 추가로 끝내지 않도록 한다.
- 이 주제가 불명확하면 생기는 리스크: 네이버 검색만 TourAPI로 바꾸고 AI 시간표, 중복 데이터, 브라우저 경로 계산을 남겨 같은 회귀가 반복될 수 있다.

## Questions

1. 현재 코드에서 AI와 서버 중 누가 일정 초안을 소유하는가?
2. 현재 장소·시간표·경로·저장 구조는 V3 정책을 수용할 수 있는가?
3. 유지할 수 있는 기반과 교체해야 할 경계는 무엇인가?
4. 웹에서 장소·순서·이동 수단을 편집하면 어느 범위까지 재계산하는가?
5. 회귀 방지를 구현 완료로 인정할 검증 기준은 무엇인가?

## Answers

1. 현재는 OpenAI가 장소 검색, Standard·CarryME 방문지, 두 시간표와 설명을 모두 만들고 PlanME가 결과를 검증·렌더링한다.
2. 그대로는 수용하기 어렵다. 장소 출처 타입에 TourAPI `contentId`가 없고, 실제 경로 계산 후에도 AI 시간표를 바이트 단위로 보존한다. Redis는 revision 비교 저장이 있지만 활성·대기·직전 정상 스냅샷이 없다.
3. 공통 코어 호출 구조, Redis revision 원자 비교, 서버 경로 제공자와 테스트 주입 구조는 재사용할 수 있다. AI 출력 계약, 장소 후보 계층, 시간표 계산 경계, 저장 스냅샷, 웹 편집과 브라우저 ODsay 계산은 V3 기준으로 교체해야 한다.
4. 공통 여행계획을 수정한 뒤 `pending` revision에서 Standard·CarryME·전체 시간표를 서버가 다시 계산한다. 성공 시에만 `active`를 교체하고 실패하면 편집 전 일정을 유지한다.
5. 장소 허용 목록, TourAPI 스냅샷, AI 데이터 차단, 질문 제한, ODsay 보정, revision 원자성, ID·멱등성, 채널 공통 결과, 브라우저 경로 호출 제거와 TourAPI 캐시 시나리오의 자동 검증을 모두 통과해야 한다.

## Score

- 현재 불명확성 점수: `0.12`
- 목표 임계값: `Standard 0.20`
- 점수 근거: 구조적 문제, 목표 경계, 비동기 생성, 서버 단일 경로 계산과 필수 회귀 게이트가 확인됐다.
- 다음에 낮춰야 할 불확실성: 공개 계약 전환 순서와 외부 연동 검증 환경을 설계한다.

## Confirmed

- 현재 기본 AI 모델은 `gpt-5.4-mini`이며 V3 선택 모델과 다르다.
- 현재 AI 도구는 `search_naver_places`이고 TourAPI 구현은 없다.
- 현재 AI 응답 스키마는 `standardTimeline`과 `carrymeTimeline`을 요구한다.
- 현재 서버 경로 확정기는 제공자 이동시간을 반영하면서 AI 시간표를 변경하지 않는다.
- 현재 서버 ODsay 제공자는 일시 오류 한 번 재시도 외에 `-98`·700m·411~414 보정이 없다.
- 현재 웹 화면에도 브라우저 ODsay 계산 코드가 남아 있어 서버 구현과 동작이 갈릴 수 있다.
- 현재 웹 편집은 CarryME 방문지만 바꾸고 Standard·시간표를 보존한다.
- 현재 자동화 테스트는 모의 AI·장소·경로 제공자 중심이며 실제 TourAPI 계약과 AI 허용 목록 위반을 검증하지 않는다.
- V3 생성 실패 시 정책을 위반하는 V2 생성기로 자동 복귀하지 않는다.
- 일정 수정 실패 시 기존 `active` 일정을 유지한다.
- 배포 롤백과 기능 플래그는 이번 기능 설계 범위에 포함하지 않는다.
- V3 생성은 시작 요청과 결과 조회를 분리한 비동기 2단계로 처리한다.
- 시작 요청은 새 일정 ID와 작업 상태를 반환한다.
- GPTs와 GPT App 어댑터는 사용자에게 추가 질문하지 않고 결과 조회를 반복해 완료된 일정을 표시한다.
- 웹 편집은 공통 여행계획만 변경하고 Standard·CarryME·전체 시간표를 함께 서버 재계산한다.
- 브라우저는 편집 결과의 부분 경로를 별도로 계산하거나 저장값을 낙관적으로 덮어쓰지 않는다.
- ODsay·네이버 경로 계산과 오류 보정은 서버만 수행한다.
- 기존 브라우저 ODsay 계산·캐시 코드는 V3 전환 범위에서 제거한다.
- 웹은 계산 중 `pending` 상태와 저장된 `active` revision만 표시한다.
- AI가 허용 목록 밖 `contentId`를 반환하면 반드시 거부한다.
- 저장된 일정 장소는 모두 TourAPI revision 스냅샷을 참조해야 한다.
- AI가 반환한 장소명·좌표·시간표를 저장 데이터에 직접 반영하지 않는다.
- 질문 제한, ODsay 오류 행렬, revision 원자성, ID·멱등성, 채널 공통 결과, 브라우저 경로 호출 제거와 TourAPI 캐시 시나리오를 자동 검증한다.
- 필수 회귀 검증 중 하나라도 실패하면 구현 또는 PR 완료로 보지 않는다.

## Open Questions

- 실제 TourAPI·OpenAI·ODsay를 포함한 외부 연동 검증의 실행 환경과 비용 한도가 미정이다.

## References

- [현재 OpenAI 일정 생성기](../../../../packages/planme-core/src/openai-itinerary-generator.ts) - 모델, 네이버 도구 호출과 AI 전체 일정 스키마 근거다.
- [현재 생성 오케스트레이션](../../../../packages/planme-core/src/gpt-actions.ts) - AI가 초안을 소유하는 현재 책임 경계 근거다.
- [현재 일정 도메인](../../../../packages/planme-core/src/mock-data.ts) - Standard·CarryME와 복수 시간표가 한 객체에 중복 저장되는 구조다.
- [현재 초안 변환](../../../../packages/planme-core/src/draft-itineraries.ts) - AI 초안을 저장 일정으로 변환하는 코드다.
- [현재 서버 경로 확정기](../../../../apps/web/lib/itinerary-route-finalizer.ts) - 경로 결과와 AI 시간표의 분리 근거다.
- [현재 ODsay 제공자](../../../../apps/web/lib/route-providers/odsay.ts) - 오류별 보정 부재의 근거다.
- [현재 웹 편집 화면](../../../../apps/web/components/itinerary/ItineraryDashboard.tsx) - 브라우저 ODsay와 편집 상태의 근거다.
- [현재 경로 확정 검사](../../../../apps/web/scripts/check-itinerary-finalization.ts) - AI 시간표 불변을 기존 성공 조건으로 검사한다.
