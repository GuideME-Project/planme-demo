# 테스트 로그

## 최종 자동 검증

| 명령 | 결과 |
| --- | --- |
| `npm run test:actions` | 통과 |
| `npm run test:mcp` | 통과 |
| `npm --workspace @planme/core run build` | 통과 |
| `npm --workspace @planme/mcp run typecheck` | 통과 |
| `npm --workspace @planme/web run build` | 통과 |
| `npx playwright test apps/web/e2e/destination-editor-recorded-flow.spec.ts --project=chromium` | 3개 통과 |
| `git diff --check` | 통과 |

Playwright 검증 범위:

- 일정 전체 이동 수단 선택기 1개와 사용자용 도보 부재
- 이동 수단 변경만으로 공급자 호출 없음
- 네이버 장소 후보 선택 한 번으로 좌표·출처 저장
- 자동차 모드가 모든 route stop에 적용됨
- Standard·CarryME 한쪽 실패 시 독립 실패 문구
- 후보를 선택하지 않은 자유 입력 차단

## 실패와 재시도

- 초기 MCP 타입 검증은 이전 Google Places·반경 테스트와 누락된 이동 수단 fixture 때문에 실패했다. 네이버 단일 검색 계약으로 갱신한 뒤 통과했다.
- MCP 실행 테스트에서 필수 anchor 선검증과 중간 장소 제외 정책이 이전 clarification 기대와 충돌했다. 신규 정책으로 fixture와 assertion을 갱신했다.
- Playwright 초기 2개 테스트는 고정 데모 Standard stop의 역할·출처 누락으로 `장소를 선택해 주세요`가 표시됐다. 데모 계약을 보강한 뒤 통과했다.
- 브라우저 육안 확인에서 편집 헤더 버튼이 좁은 열에 눌리는 레이아웃 회귀를 발견했다. 2열 헤더로 수정한 뒤 전체 화면에서 재확인했다.

## 외부 호출 기록

- 네이버 지역 검색 실제 호출: 미실행
- OpenAI 실제 호출: 미실행
- 네이버 Directions 실제 성공 검증: 미실행
- 앱 내 브라우저 육안 확인 중 초기 대중교통 자동 계산이 ODsay를 실제로 시도했으나 API 키 인증 실패로 종료됐다. 실제 경로 응답은 받지 못했다.
- 앱 내 브라우저에서 Naver 지도 SDK 인증 실패 문구가 보여 실제 지도선은 확인하지 못했다.

## 환경 준비

- `npm ci`로 workspace 의존성을 설치했다.
- 원본 체크아웃의 gitignored 런타임 파일을 민감값 출력 없이 현재 worktree로 복사했다.
- 환경변수 값은 문서와 로그에 기록하지 않았다.
