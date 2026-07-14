# TourAPI 기반 AI 여행일정 생성 V3 인터뷰

## 문서 정보

- 한글 주제명: TourAPI 기반 AI 여행일정 생성 V3
- Linear 이슈: [GUI-205](https://linear.app/guideme/issue/GUI-205)
- 인터뷰 깊이: Standard (`0.20` 이하)
- 인터뷰 종료 사유: 사용자가 인터뷰 문서 작성과 설계 단계 전환을 승인함
- Linear 확인 범위: 이슈 식별자는 사용자에게 받았으며, 현재 세션의 도구 제한으로 본문과 댓글은 확인하지 못함

## 문서 목록

| 문서 | 주제 | 현재 불명확성 점수 |
| --- | --- | ---: |
| [제품 범위와 사용자 질문 정책](product-scope-and-user-policy.md) | 회귀 방지 목표, 지원 범위, 질문 제한과 비목표 | 0.05 |
| [TourAPI와 AI 책임 경계](tourapi-and-ai-boundary.md) | 장소 원천, 후보 검증, Luna 출력 제한과 좌표 정책 | 0.12 |
| [일정과 경로 보정 정책](schedule-and-routing-policy.md) | 서버 시간표, 숙소·식사 기본값, ODsay 예외 처리 | 0.14 |
| [저장과 정합성 정책](storage-and-consistency.md) | Redis 캐시, 일정 스냅샷, ID와 멱등성 | 0.15 |
| [채널 계약과 사용자 노출](channel-contract-and-notices.md) | GPTs·GPT App·웹 공통 흐름과 제외 안내 범위 | 0.10 |
| [현재 코드와 전환 리스크](current-code-and-transition-risk.md) | 구현 격차, 회귀 원인, 설계 단계 미결정사항 | 0.12 |

## 핵심 확정사항

- 최우선 목표는 새 일정 생성과 수정에서 기존 오류를 되살리지 않는 것이다.
- 목적지의 관광지·문화시설·레포츠·쇼핑·숙소·음식점은 TourAPI만 장소 원천으로 사용한다.
- AI는 검증된 TourAPI 후보의 `contentId` 선택, 방문 순서, 일차 배분만 수행한다.
- 서버는 체류시간, 식사, 숙소 복귀, 실제 이동시간, 최종 시간표와 오류 보정을 소유한다.
- 사용자에게 능동적으로 물을 수 있는 값은 출발지, 목적지, 이동 수단, 여행 기간뿐이다.
- GPTs Actions와 GPT App MCP는 같은 서버 오케스트레이터와 계약을 사용한다.
- 일정 수정은 `pending` 계산 성공 후 `active`를 원자적으로 교체하고 실패하면 기존 `active`를 유지한다.
- 기존 V1/V2 일정 호환과 마이그레이션은 범위에서 제외한다.

## 관련 외부 링크

| 출처 | 링크 | 관련 이유 | 확인 상태 |
| --- | --- | --- | --- |
| Linear | [GUI-205](https://linear.app/guideme/issue/GUI-205) | 관련 이슈 식별자 | 본문·댓글 미확인 |
| 공공데이터포털 | [한국관광공사 국문 관광정보 서비스](https://www.data.go.kr/data/15101578/openapi.do) | TourAPI `KorService2`, 지역·숙박·행사·상세 조회 계약 | 확인함 |
| OpenAI | [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) | 선택 모델과 추론 지원 범위 | 확인함 |
| ODsay LAB | [도보 길찾기 오류 코드](https://lab.odsay.com/guide/releaseReference?platform=web) | 411~414 오류 의미 | 확인함 |
| ODsay LAB | [대중교통 700m 검색 범위 안내](https://lab.odsay.com/community/boardView?seq=530) | 근거리 대중교통 미검색 보정 근거 | 확인함 |

## 다음 설계 액션

- V3 공통 도메인 모델과 AI 허용 출력 계약을 설계한다.
- TourAPI 후보 수집·정규화·캐시와 장애 시 마지막 정상 데이터 사용 정책을 설계한다.
- 서버 시간표 계산기와 ODsay 오류 코드별 보정 행렬을 설계한다.
- Redis `active/pending/previous` 전환과 멱등성 경계를 설계한다.
- GPTs·GPT App·웹의 API 및 화면 상태 전환을 설계한다.
- 구현 전 생성 처리 방식과 정량 검증 기준을 확정한다.
