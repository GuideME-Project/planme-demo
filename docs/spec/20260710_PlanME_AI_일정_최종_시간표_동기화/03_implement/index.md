# 구현 인덱스

## 목적

AI 일정의 장소 순서와 시간표를 유지하면서 길찾기 순수 이동 시간과 지도 경로를 서버에서 확정하고, ChatGPT 위젯과 상세 웹에 동일하게 제공하기 위한 구현계획·결과·검증 로그를 관리한다.

## 문서 목록

| 문서 | 목적 | 상태 |
| --- | --- | --- |
| [route-finalization-work-plan.md](route-finalization-work-plan.md) | 서버 제공자 호출, API, Redis 저장과 MCP 연동 작업 순서 | 구현 반영 |
| [widget-web-work-plan.md](widget-web-work-plan.md) | 최종 위젯 1회 표시와 상세 웹 상태 전환 작업 순서 | 구현 반영 |
| [environment-release-verification.md](environment-release-verification.md) | 환경변수, 테스트, PR 배포, 운영 확인과 중단 조건 | 검증 중 |
| [implementation-result.md](implementation-result.md) | 실제 변경 범위와 설계 대비 확정점 | 구현 완료 |
| [verification-log.md](verification-log.md) | 제공자·환경·로컬·자동 검증 결과 | 검증 중 |

## 관련 근거

| 출처 | 링크 | 관련 이유 | 확인 상태 |
| --- | --- | --- | --- |
| 인터뷰 | [01_interview/index.md](../01_interview/index.md) | 사용자 확정 범위 | 확인함 |
| 서버 설계 | [server-finalization-design.md](../02_design/server-finalization-design.md) | API·저장·정합성 기준 | 확인함 |
| 화면 설계 | [widget-web-state-design.md](../02_design/widget-web-state-design.md) | 위젯·상세 웹 상태 기준 | 확인함 |
| 배포 설계 | [rollout-and-validation.md](../02_design/rollout-and-validation.md) | 환경변수·검증·롤백 기준 | 확인함 |
| Linear | 없음 | 사용자가 기존 이슈 연결을 제외함 | 해당 없음 |

## 현재 상태

- 서버 최종화 구현 완료
- 체류 시간과 방문 시각 재계산은 범위에서 제외
- 현재 ODsay 키는 등록 운영 주소 `Referer`를 사용한 Node 서버 호출에서 인증 성공
- DB 마이그레이션은 없고 Upstash Redis 저장 형식만 버전 2로 확장
- 내부 인증값은 로컬 8개 런타임 파일과 Vercel 두 프로젝트의 Production·Preview에 반영 완료

## 다음 액션

- 전체 필수 테스트와 빌드를 최종 실행한다.
- PR을 `main`에 병합해 Vercel 자동 배포를 확인한다.
- 운영 ChatGPT 위젯과 상세 웹을 재검증한다.
