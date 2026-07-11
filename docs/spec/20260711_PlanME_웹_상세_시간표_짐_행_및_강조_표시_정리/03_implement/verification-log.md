# 검증 로그

## 자동 검증 결과

| 검사 | 결과 | 비고 |
| --- | --- | --- |
| `npm run test:mcp` | 통과 | 신규 fixture의 필수 이동 수단 누락을 수정한 뒤 재실행해 통과 |
| `npx playwright test apps/web/e2e/gpt-itinerary-generation.spec.ts --project=chromium` | 통과 | 8개 검사 통과 |
| `npm run test:actions` | 통과 | GPT Actions/OpenAPI 계약 회귀 없음 |
| `npm run test:route-normalization` | 통과 | 경로 정규화 회귀 없음 |
| `npm run test:finalization` | 통과 | 로컬 메모리 저장 방식으로 최종화 계약 통과 |
| `npm run build` | 통과 | core와 Next.js 빌드 성공 |
| `git diff --check` | 통과 | 공백 오류 없음 |

린트는 저장소 규칙에 따라 별도 승인 없이 실행하지 않았다.

## Microsoft Edge 로컬 확인

대상:

- 로컬 서버: `http://127.0.0.1:3000`
- 기존 부산 2일 일정

확인 결과:

- 1일차 Standard에서 `짐 파라다이스 호텔 부산 도착`이 제거됐다.
- 기존 짐 보관 사건이 `파라다이스 호텔 부산 체크인`과 승인된 설명으로 표시됐다.
- 이후 `파라다이스 호텔 부산 도착`은 유지됐다.
- 2일차 Standard에는 배송 사건이 없고 CarryME에는 `짐 파라다이스 호텔 부산 도착`이 유지됐다.
- 두 일차 모두 일정 행의 연한 초록 배경·테두리, 초록 체크, 행 내부 절약 칩이 제거됐다.
- CarryME 총 이동 시간 상자 오른쪽 절약 칩이 유지됐다.
- Light·Dark 두 테마에서 같은 규칙을 확인했다.
- 상세 지도 탭에서 마커와 Standard·CarryME 범례가 표시됐다.

## 로컬 지도 관찰사항

상세 지도 탭의 마커와 범례는 표시됐지만 로컬 Edge에서는 배경 지도 타일과 경로선이 보이지 않았다. 이번 변경에서 지도·경로 계산 코드는 수정하지 않았으며, 운영 배포 후 기존 지도 동작과 비교해 다시 확인한다.

## 운영 검증

- PR: [#40 PlanME 상세 시간표 배송 사건 및 강조 표시 정리](https://github.com/GuideME-Project/planme-demo/pull/40)
- 병합 커밋: `0e24b5bc6d99ca17153ed511c803fa92c6743859`
- 최종 `main`: `0e24b5bc6d99ca17153ed511c803fa92c6743859`
- Vercel 자동 배포: 웹과 MCP의 PR 검사가 통과한 뒤 `main` 병합으로 운영 배포됨
- 운영 웹 상세 일정: HTTP 200
- 운영 MCP `/health`: HTTP 200

운영 기존 부산 2일 일정 확인 결과:

- 1일차 Standard에 호텔 체크인과 이후 호텔 도착이 유지되고 배송 사건은 표시되지 않았다.
- 1일차 CarryME에는 배송 사건, 배송 차량 아이콘과 빛나는 효과가 유지됐다.
- 2일차 Standard에는 배송 사건이 없고 CarryME에는 배송 사건이 유지됐다.
- 1·2일차 모두 행 강조 수 0, 초록 체크 수 0, CarryME 하단 절약 칩 수 1로 확인됐다.
- Light·Dark 모두 같은 표시 규칙을 유지했다.
- 상세 지도 탭이 선택 상태로 전환되고 NAVER 지도 출처, 지도 타일 이미지, SVG 경로 요소가 표시됐다.
- Standard 경로 요약의 호텔 출발·경유 정보와 기존 행선지 순서는 유지됐다.

운영 기존 일정 확인은 Mac 잠금으로 Microsoft Edge 조작이 중단된 뒤 인앱 브라우저에서 이어서 수행했다.

### Microsoft Edge 신규 ChatGPT 일정

- ChatGPT 대화: `https://chatgpt.com/c/6a529c6a-9b1c-83ee-8b4f-8bf93e28aab6`
- 실제 입력: `GuideME-PlanME 부산 1박2일 여행`
- 추가 조건: `동탄역에서 출발하고 자동차로 안내해줘`
- 생성된 상세 일정: `https://planme-demo.vercel.app/itinerary/generated-부산광역시-동탄역-출발-부산-2일-해운대영도-여행-2d-i540p9`

확인 결과:

- ChatGPT가 출발지와 자동차·대중교통 중 이동 수단을 먼저 확인했다.
- 추천 일정 계산이 끝난 뒤 최종 PlanME 위젯이 한 번만 표시됐다.
- 위젯에는 Standard·CarryME 경로 요약, 최종 CarryME 시간표와 상세 일정 링크가 함께 표시됐다.
- 1일차 Standard에는 `베이몬드호텔 해운대 체크인`과 이후 호텔 복귀가 유지되고 배송 사건은 없었다.
- 1일차 CarryME에만 `짐 베이몬드호텔 해운대 도착` 배송 사건이 표시됐다.
- 2일차 Standard에는 배송 사건이 없고 호텔 출발·관광·복귀 일정이 유지됐다.
- 일정 행의 연한 초록 배경·테두리, 초록 체크, 행 내부 절약 칩은 표시되지 않았다.
- CarryME 배송 차량 아이콘과 총 이동 시간 상자 오른쪽 절약 칩은 유지됐다.
- 1·2일차 상세 지도에 NAVER 지도, 각 행선지 마커, Standard·CarryME 경로선과 범례가 표시됐다.
- Light·Dark 전환 후에도 같은 상세 지도와 시간표 표시 규칙이 유지됐다.

## 실패와 재시도

- 첫 `npm run test:mcp`에서 신규 fixture의 필수 이동 수단 누락이 발견돼 fixture를 보완한 뒤 통과했다.
- 첫 화면 회귀 검사에서 CarryME 하단 칩 문구가 최종화 결과에 따라 달라져 안정적인 검사 식별자로 바꾼 뒤 통과했다.
- PR 생성 명령의 본문 백틱이 셸 명령으로 해석돼 검증 명령이 한 차례 더 실행됐다. 모든 검사는 통과했으며, 생성된 PR 본문은 즉시 정상 본문으로 교체하고 재조회했다.
- `gh pr merge --delete-branch`는 병합 후 로컬 `main` 전환 단계에서 다른 worktree의 `main` 사용으로 오류를 반환했다. 원격 PR은 정상 병합됐음을 재조회했고 원격 기능 브랜치는 별도 삭제했다.

## 최종 결과

자동 검사, 로컬 Microsoft Edge, 운영 기존 일정, 운영 신규 ChatGPT 일정 검증을 모두 완료했다. 코드 변경 PR #40의 수용 기준을 모두 확인했으며 남은 기능 검증은 없다.
