# TourAPI 기반 AI 여행일정 생성 V3 설계

## 목적

이 디렉토리는 [인터뷰에서 확정한 V3 요구사항](../01_interview/index.md)을 구현 가능한 계약으로 정리한다.
핵심은 TourAPI 장소 스냅샷을 유일한 일정 장소 원천으로 사용하고, AI의 출력을 `contentId` 선택·순서·일차 배분으로 제한하며, 서버가 일정·경로·저장 상태를 원자적으로 완성하는 것이다.

## 문서 목록

| 문서 | 목적 | 상태 |
| --- | --- | --- |
| [architecture-and-domain-model.md](architecture-and-domain-model.md) | V3 책임 경계, 공통 도메인, 비동기 상태 머신과 Standard·CarryME 파생 구조 | 초안 |
| [tourapi-ai-contract.md](tourapi-ai-contract.md) | TourAPI 조회·정규화·캐시·스냅샷과 Luna 제한 출력 계약 | 초안 |
| [scheduling-and-routing.md](scheduling-and-routing.md) | 서버 시간표 생성, 숙소·식사·자유시간과 경로 오류 보정 | 초안 |
| [storage-and-consistency.md](storage-and-consistency.md) | Redis 키, `active/pending/previous`, 멱등성과 원자적 활성화 | 초안 |
| [channel-and-web-integration.md](channel-and-web-integration.md) | GPTs·GPT App 공통 요청/응답, 자동 상태 조회와 웹 편집 흐름 | 초안 |
| [validation-plan.md](validation-plan.md) | 필수 회귀 게이트, 계약 테스트, E2E와 외부 연동 검증 범위 | 초안 |

## 관련 외부 링크

| 출처 | 링크 | 관련 이유 | 확인 상태 |
| --- | --- | --- | --- |
| Linear | [GUI-205](https://linear.app/guideme/issue/GUI-205) | 관련 이슈 식별자 | 본문·댓글 미확인 |
| 공공데이터포털 | [한국관광공사 국문 관광정보 서비스](https://www.data.go.kr/data/15101578/openapi.do) | TourAPI `KorService2` 공식 계약 | 확인함 |
| OpenAI | [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) | 일정 후보 선택 모델 | 확인함 |
| ODsay LAB | [도보 오류 코드](https://lab.odsay.com/guide/releaseReference?platform=web) | 411~414 오류 의미 | 확인함 |
| ODsay LAB | [대중교통 700m 검색 범위](https://lab.odsay.com/community/boardView?seq=530) | 근거리 도보 보정 기준 | 확인함 |

## 확인한 코드 근거

- `packages/planme-core/src/openai-itinerary-generator.ts` - 현재 AI가 네이버 검색, 장소, 두 시간표를 모두 생성한다.
- `packages/planme-core/src/gpt-actions.ts` - 현재 AI 초안을 PlanME 일정으로 변환하는 공통 코어다.
- `packages/planme-core/src/mock-data.ts` - 현재 Standard·CarryME와 시간표가 중복 저장되는 데이터 모델이다.
- `apps/mcp/src/gpts-actions-api.ts`와 `apps/mcp/src/planme-mcp.ts` - GPTs와 GPT App의 중복 계약이다.
- `apps/web/lib/itinerary-route-finalizer.ts` - 현재 실제 경로를 계산하면서 AI 시간표는 보존한다.
- `apps/web/lib/preview-itinerary-store.ts` - 현재 Redis 7일 TTL과 revision 비교 저장 기반이다.
- `apps/web/components/itinerary/ItineraryDashboard.tsx` - 현재 브라우저 경로 계산과 CarryME 중심 편집 흐름이다.

## 현재 상태

- 인터뷰 요구사항은 `01_interview`에 문서화됐다.
- 설계는 기존 V1/V2 일정 호환과 마이그레이션을 다루지 않는다.
- DB 신규 도입, 외부 작업 큐, 배포 롤백과 기능 플래그는 설계 범위가 아니다.
- V3 전체 오케스트레이터는 `apps/web`이 소유하고 `apps/mcp`는 내부 인증 API 어댑터로 동작한다.
- 기존 MCP 전용 OpenAI 키 배치 결정은 V3 생성 경로에서 교체한다.
- Linear GUI-205 본문·댓글은 현재 도구 범위에서 확인하지 못했으므로 설계 근거로 사용하지 않았다.
- 실제 외부 API 호출 검증은 민감값·비용·할당량 영향이 있으므로 실행 전에 별도 승인 절차를 따른다.

## 다음 액션

- 설계 검토 후 `mion-implementation-plan-writer`로 변경 파일, 구현 순서와 검증 명령을 구체화한다.
- 구현 전 TourAPI의 실제 응답 필드와 오류 코드를 공식 샘플 또는 승인된 개발 키 호출로 재검증한다.
- 구현 완료 시 [필수 회귀 게이트](validation-plan.md)를 모두 통과해야 한다.
