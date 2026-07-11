# 검증과 배포 계획

## 결론

자동 검증은 새 일정의 공통 초안 보정과 기존 저장 일정의 웹 표시 회귀를 분리한다. 수동 검증은 기존 부산 일정과 새 ChatGPT 일정의 1일차·2일차, Light·Dark, 상세 지도 호텔 경유를 확인한다. 배포는 최신 `main` 기준 PR 병합에 따른 Vercel 자동 배포만 사용한다.

## 검증 순서

### 1. 변경 전 기준선

- 최신 `main`에서 관련 기존 테스트가 통과하는지 확인한다.
- 기존 부산 일정에서 현재 오류인 Standard의 동일 시각·장소 짐 도착 행을 재현한다.
- 현재 화면에서 행 내부 배경·체크·빨간 칩과 CarryME 하단 칩을 구분해 기록한다.

### 2. 공통 초안 보정 검사

대상:

`apps/mcp/scripts/check-planme-mcp.ts`

필수 사례:

1. Standard의 `category=carryme` 사건 제거.
2. 잘못 분류된 `짐 호텔 도착` 배송 완료 사건 제거.
3. `체크인 전 짐 보관`을 호텔 체크인 제목·승인 설명으로 보정.
4. 정상 호텔 체크인 유지.
5. 관광 후 같은 호텔 복귀·숙박 유지.
6. CarryME의 짐 호텔 도착 유지.
7. 입력 배열과 원본 event 객체가 변경되지 않음.
8. 배송 사건 제거 후 Standard 시간표가 비면 `needs_revision`과 `missing_timeline` 오류가 생성됨.
9. 검증과 일정 생성이 같은 정규화 입력을 사용함.
10. CarryME의 명백한 짐 배송 사건이 `category=carryme`로 정규화됨.
11. 생성 프롬프트가 CarryME 배송 사건에 `category=carryme`를 요구하고 Standard에서는 금지함.

예상 실행 명령:

```bash
npm run test:mcp
```

### 3. 웹 상세 화면 회귀 검사

대상:

`apps/web/e2e/gpt-itinerary-generation.spec.ts`

fixture 요구사항:

- `standardTimeline`과 `carrymeTimeline`을 분리해 명시한다.
- Standard에 첫 호텔 체크인과 이후 호텔 복귀를 넣는다.
- Standard에 같은 시각·장소의 잘못된 짐 호텔 도착을 추가한다.
- CarryME에는 짐 호텔 도착을 유지한다.
- 기존 호환 사례로 `체크인 전 짐 보관` 제목과 짐 보관 설명을 포함한다.
- 실제 절약이 있는 `savingLabel`과 `highlight=true`를 포함한다.

assertion 요구사항:

- Standard 열에 배송 사건이 없음.
- Standard 열에 호텔 체크인과 호텔 복귀가 모두 있음.
- 기존 체크인 문구의 제목과 설명이 승인 문구로 보임.
- CarryME 열에는 배송 사건이 있음.
- 일정 행 내부 빨간 칩과 체크 아이콘이 없음.
- 일정 행에 강조 배경·테두리가 없음.
- CarryME 배송 아이콘의 빛나는 효과가 유지됨.
- CarryME 총 이동 시간 상자의 절약 칩이 유지됨.
- 1일차에서 2일차로 전환한 뒤에도 같은 규칙이 유지됨.

시각 assertion은 MUI 생성 클래스명에 의존하지 않는다.

- `timeline-event-content`의 계산된 배경색이 투명이고 테두리 폭이 0인지 확인한다.
- Standard·CarryME 열 범위 안에 행 내부 절약 문구와 `CheckRoundedIcon`이 없는지 확인한다.
- CarryME 총 이동 시간 상자 범위 안에는 절약 문구가 남아 있는지 확인한다.
- `timeline-event-icon` 중 공통 의미 판별상 CarryME 배송 사건만 배송 차량 아이콘과 강조 그림자를 가지는지 확인한다.
- Light·Dark 각각에서 동일 assertion을 실행한다.

예상 실행 명령:

```bash
npx playwright test apps/web/e2e/gpt-itinerary-generation.spec.ts --project=chromium
```

자동 E2E는 Playwright 검사로 실행하되, 실제 브라우저 수동 확인은 Microsoft Edge를 사용한다.

### 4. 관련 회귀 검사

```bash
npm run test:actions
npm run test:route-normalization
npm run test:finalization
npm run build
```

- `test:actions`: GPT Actions/OpenAPI와 금지된 레거시 경로 회귀 확인.
- `test:route-normalization`: 기존 경로 stop 정규화 회귀 확인.
- `test:finalization`: 최종화가 AI 시간표 배열을 임의 변경하지 않는지 확인.
- `build`: core와 Next.js 타입·번들 경계 확인.

린트와 포맷 명령은 저장소 규칙에 따라 별도 승인 없이 실행하지 않는다.

## 로컬 수동 검증

### 서버 준비

1. 3000번 포트 사용 프로세스를 확인한다.
2. 현재 프로젝트 소유 프로세스인 경우에만 종료하고 로컬 서버를 3000번으로 실행한다.
3. `.env*` 값은 출력하지 않고 필요한 변수의 존재 여부만 확인한다.

### 기존 일정

- 기존 부산 상세 일정 링크를 연다.
- 1일차와 2일차를 각각 확인한다.
- Standard의 동일 시각·장소 `짐 호텔 도착`이 사라졌는지 확인한다.
- Standard 호텔 체크인과 관광 후 호텔 도착·복귀가 유지되는지 확인한다.
- 기존 `체크인 전 짐 보관`이 승인된 체크인 제목·설명으로 보이는지 확인한다.

### 신규 일정

- ChatGPT Chat 탭에서 GuideME-PlanME를 사용한다.
- `부산 1박 2일 여행 가고 싶어` 흐름으로 일정을 생성한다.
- 최종 위젯이 한 번만 표시되는지 확인한다.
- 상세 일정의 1일차·2일차를 확인한다.
- Standard에는 CarryME 배송 사건이 없고 CarryME에는 유지되는지 확인한다.

### 시각·지도

- Light·Dark 두 테마에서 일정 행 배경·체크·행 내부 빨간 칩 제거를 확인한다.
- CarryME 배송 아이콘과 빛나는 효과를 확인한다.
- CarryME 총 이동 시간 상자와 오른쪽 빨간 절약 칩을 확인한다.
- 상세 지도에서 Standard 호텔 경유와 기존 실제 경로가 유지되는지 확인한다.

## 완료 조건

- 모든 자동 검증 명령이 통과한다.
- 기존·신규 일정의 1일차·2일차에서 요구사항이 동일하게 적용된다.
- 정상 Standard 호텔 체크인·복귀가 사라지지 않는다.
- CarryME 배송 사건과 배송 아이콘은 유지된다.
- ChatGPT 위젯 시각과 경로 최종화 흐름에 회귀가 없다.
- 실패한 명령과 미확인 범위가 없거나 명시적으로 보고된다.

## 브랜치와 PR

1. 현재 문서 변경을 보존한다.
2. 최신 원격 `main`을 확인한다.
3. 최신 `main` 기준 새 작업 브랜치를 만든다.
4. 문서와 구현을 의도별 커밋으로 정리한다.
5. GitHub PR을 생성하고 변경 범위와 검증 결과를 기록한다.
6. 별도 대기 지시가 없고 실행 승인이 있으면 PR을 병합한다.
7. 원격 임시 브랜치와 안전하게 정리 가능한 worktree만 정리한다.

현재 저장소의 기준 브랜치는 `main`이며 `develop`을 사용하지 않는다.

## 배포와 운영 확인

- Vercel MCP나 CLI로 직접 배포하지 않는다.
- GitHub PR을 `main`에 병합해 Vercel 자동 배포를 시작한다.
- 웹 Production 배포 성공과 상세 일정 HTTP 200을 확인한다.
- MCP Production 배포가 변경 범위에 포함되면 `/health` HTTP 200을 확인한다.
- 운영 브라우저에서 기존 부산 일정과 신규 일정의 핵심 수용 기준을 다시 확인한다.

## 롤백 조건

- Standard의 정상 체크인·복귀가 제거됨.
- CarryME 배송 사건이 사라짐.
- 기존 일정 페이지가 오류 또는 빈 시간표를 표시함.
- 행 내부 강조 제거가 CarryME 총 이동 시간 상자까지 영향을 줌.
- 생성 실패나 최종 위젯 중복이 재발함.
- 상세 지도 경로 또는 호텔 경유가 변경됨.

롤백은 PR revert를 우선한다. 저장 데이터 마이그레이션은 없지만 배포 기간에 새로 생성된 일정은 이미 Standard 배송 사건이 제거되고 체크인 문구가 정규화된 상태로 유지된다. 코드 롤백은 이후 생성·표시 동작만 되돌리며, 배포 기간 생성 데이터의 제거된 사건을 자동 복원하지 않는다.

정규화된 Standard 데이터는 확정된 제품 의미에 부합하므로 기본적으로 별도 backfill이나 원복을 하지 않는다. 해당 데이터 자체의 복원이 필요해지는 경우에는 자동 추정하지 않고 별도 데이터 복구 범위와 승인을 정한다.

## 중단 조건

- 최신 `main`과 현재 문서 변경을 안전하게 합칠 수 없음.
- 3000번 포트의 프로세스 소유자를 확인할 수 없음.
- 필수 환경변수가 누락되어 실제 생성 검증을 할 수 없음.
- 외부 제공자 장애와 코드 오류를 구분할 수 없음.
- 자동 검사와 실제 Edge 화면 결과가 서로 다름.

## 결과 문서 갱신

구현 후 다음 실제 산출물만 추가한다.

- 구현 결과: 실제 변경 파일, 설계 대비 차이, 남은 작업.
- 검증 로그: 실행 명령, 성공·실패 결과, 재시도와 미실행 사유.
- 운영 확인: PR, 병합 커밋, 자동 배포와 운영 화면 확인.

실행 전에는 결과나 통과 로그를 미리 작성하지 않는다.

## References

- [호환성과 검증 설계](../02_design/compatibility-and-validation.md)
- [시간표 의미 보정 구현계획](timeline-correction-implementation.md)
