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

- PR: 대기
- 병합 커밋: 대기
- Vercel 자동 배포: 대기
- 운영 기존 일정: 대기
- ChatGPT 신규 일정: 대기

