# 완료 검증 기준

## 목적

- 이 주제를 확인하는 이유: 단일 양양-거제 시나리오만 통과하면 다른 fallback 경로에서 같은 문제가 반복될 수 있다.
- 이 주제가 불명확하면 생기는 리스크: 좌표 보장, 대중교통 표시, 로컬 origin 분리 중 일부만 고쳐도 완료로 오판할 수 있다.

## Questions

1. 양양-거제 실제 시나리오만 통과하면 완료로 볼 수 있는지?
2. Function Calling 기반 장소 검색과 실패 응답까지 계약 테스트에 포함할지?
3. 로컬 웹/MCP 서버에서 실제 tool 호출까지 검증할지?

## Answers

1. 단일 시나리오 통과만으로 완료 처리하지 않는다.
2. Function Calling 기반 `search_places_text`/`search_places_nearby`, AI 후보 판단, hard gate 실패, 되묻기, 최후 확정 흐름을 완료 기준에 포함한다.
3. 로컬 웹/MCP 서버에서 실제 MCP tool 호출 후 생성 링크 화면까지 확인한다.

## Score

- 현재 불명확성 점수: `0.12`
- 목표 임계값: `Standard 0.20`
- 점수 근거: 필수 검증 항목, 외부 API 테스트 승인 조건, 완료 판정 금지 조건이 확정되었다.
- 다음에 낮춰야 할 불확실성: 각 완료 기준을 어떤 mock 기반 계약 테스트, MCP 테스트, 외부 API 승인 테스트로 나눌지.

## Confirmed

- 양양 -> 거제 1박2일 실제 MCP 생성 통과
- 초안 생성 단계에서 모든 장소가 Function Calling 기반 검색으로 확인됨
- 후보 검증 단계에서 AI가 `accepted`/`ambiguous`/`rejected`를 판단함
- 기존 Google Places 1순위 자동 대체 로직을 사용하지 않음
- 좌표 없는 장소는 링크로 저장되지 않음
- `placeId` 또는 검색 출처 없는 장소는 링크로 저장되지 않음
- `ambiguous` 또는 `rejected`이면 링크와 위젯 없이 ChatGPT 대화에서 최대 2개 질문
- 사용자 답변을 포함해 장소 검색을 다시 실행
- 되묻기 최대 2라운드 준수
- 2라운드 후에도 애매하면 마지막 검색 1회 후 내부 AI가 최후 확정
- 최후 확정 후보도 좌표와 `placeId` 또는 검색 출처 hard gate 통과
- Redis/Upstash 일별 호출량 카운터 기록
- 대중교통 장거리 본선 polyline 없으면 선 없음
- 지도에 장거리 첫 탑승역/최종 하차역 마커 표시
- 타임라인에 장거리 탑승/하차 이벤트 표시
- partial route를 `경로 체크 완료`로 오인 표시하지 않음
- 기존 부산/데모 E2E 회귀 없음
- `PLANME_WEB_ORIGIN`이 저장/링크/widget metadata에 모두 반영
- metadata/OG/H1에서 `PlanME` prefix 제거
- 상단 `Standard / CarryME` 정렬 확인
- `npm run test:actions` 통과
- `npm run test:mcp` 통과
- 관련 Playwright 테스트 통과
- 로컬 웹/MCP 서버에서 실제 MCP tool 호출 후 생성 링크 화면 확인

## Open Questions

- 실제 OpenAI/Google/Naver/ODsay API 사용 검증과 mock 기반 회귀 테스트의 분리 기준을 구현 계획에서 정해야 한다.
- 외부 API 테스트 실행 전 예상 호출량 안내 문구와 승인 절차를 구현 계획에서 정해야 한다.

## References

- [Linear GUI-157](https://linear.app/guideme/issue/GUI-157/planme-%EC%A2%8C%ED%91%9C-%EB%B3%B4%EC%9E%A5-%EB%B0%8F-%EB%8C%80%EC%A4%91%EA%B5%90%ED%86%B5-%ED%91%9C%EC%8B%9C-%EA%B0%9C%EC%84%A0) - 완료 기준
- [AI 장소 후보 검증 정책](./ai-place-validation.md) - Function Calling 기반 장소 검증 완료 기준
- `apps/mcp/scripts/check-planme-mcp.ts` - MCP 계약 테스트
- `apps/web/e2e/destination-editor-recorded-flow.spec.ts` - 웹 경로 편집 회귀 테스트
- `scripts/check-planme-actions.mjs` - 액션/정적 계약 검사
