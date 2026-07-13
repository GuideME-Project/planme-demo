# ChatGPT 일정 생성 관측성 검증 로그

## 검증 환경

- 작업 경로: `/Users/mion/.codex/worktrees/dc1f/planme-demo`
- 검증일: 2026-07-13
- 설치 명령: `npm ci`
- 데이터베이스 변경: 없음

## 결과 요약

| 명령 | 결과 | 확인 범위 |
| --- | --- | --- |
| `npm run test:actions` | 통과 | GPT Actions 정적 계약 |
| `npm run test:finalization` | 통과 | 경로 제공자 실패 로그 컨텍스트 |
| `npm run test:mcp` | 통과 | 추적 헤더와 MCP 실패 로그 계약 |
| `npm --workspace @planme/mcp run typecheck` | 통과 | MCP TypeScript 계약 |
| `npm --workspace @planme/web exec tsc -- --noEmit` | 통과 | 웹 TypeScript 계약 |
| `npm run build` | 통과 | Next.js 운영 빌드 |
| `git diff --check` | 통과 | 공백과 패치 형식 |

## 확인 내용

- 맞춤형 GPT 성공 로그에 양수인 UTF-8 JSON 응답 바이트 수가 존재한다.
- MCP 웹 저장 요청에 UUID 추적 식별자 헤더가 존재한다.
- 웹 오류 응답 코드는 대문자 영문·숫자·밑줄 형식만 MCP가 보존한다.
- 경로 제공자 실패 컨텍스트에 제공자, 일차, 경로 종류, 구간 번호, 내부 오류 코드와 재시도 여부가 존재한다.
- ODsay `-98` 모의 응답에서 실제 실패 구간 번호와 양쪽 정류장이 제공자 오류에 보존된다.
- 방문지·숙소의 장소명과 좌표는 최종 로그 컨텍스트에 존재한다.
- 사용자 출발지·복귀지의 장소명·좌표, 일정 본문, 외부 응답 원문과 인증정보는 구조 로그에 포함되지 않는다.

## 실행 중 확인한 환경 사항

- 최초 경로 최종화 검사는 공통 모듈 빌드 산출물이 없어 시작되지 않았다.
- `npm --workspace @planme/core run build` 실행 후 같은 검사를 다시 실행해 통과했다.
- 경로 최종화 검사는 Upstash 환경변수가 없어 로컬 메모리 저장소를 사용했다.
- `npm ci` 감사 결과 중간 등급 취약점 2건이 보고됐으며 자동 수정은 적용하지 않았다.

## 운영 확인 조건

GitHub PR 병합과 자동 배포 후 다음 값을 실제 요청의 추적 식별자로 확인한다.

1. 맞춤형 GPT의 HTTP 상태와 응답 바이트 수
2. GPT 앱 MCP의 웹 상세 저장 전달 상태
3. 웹 상세 저장 실패 단계와 안전한 내부 오류 코드
4. 경로 제공자 실패 시 제공자, 일차, 경로 종류, 구간 번호, 방문지·숙소 장소명·좌표와 재시도 여부
