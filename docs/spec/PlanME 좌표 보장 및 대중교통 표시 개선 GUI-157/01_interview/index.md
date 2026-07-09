# PlanME 좌표 보장 및 대중교통 표시 개선 인터뷰

## 문서 목록

- [좌표 보장 정책](./coordinate-guarantee.md)
- [대중교통 표시 정책](./transit-display.md)
- [완료 검증 기준](./completion-criteria.md)
- [로컬 운영 분리와 화면 정리](./origin-and-ui-cleanup.md)
- [AI 장소 후보 검증 정책](./ai-place-validation.md)

## 주제별 불명확성 점수

- 좌표 보장 정책: `0.12`
- 대중교통 표시 정책: `0.14`
- 완료 검증 기준: `0.12`
- 로컬 운영 분리와 화면 정리: `0.10`
- AI 장소 후보 검증 정책: `0.12`

## 관련 링크

- Linear: [GUI-157 PlanME 좌표 보장 및 대중교통 표시 개선](https://linear.app/guideme/issue/GUI-157/planme-%EC%A2%8C%ED%91%9C-%EB%B3%B4%EC%9E%A5-%EB%B0%8F-%EB%8C%80%EC%A4%91%EA%B5%90%ED%86%B5-%ED%91%9C%EC%8B%9C-%EA%B0%9C%EC%84%A0)
- 작업 브랜치: `codex/planme-naver-coordinate-fallback`
- 문서 경로: `docs/spec/PlanME 좌표 보장 및 대중교통 표시 개선 GUI-157/`

## 다음 설계 액션

- OpenAI Function Calling이 장소 검색 함수 호출을 주도하고, PlanME 서버가 Google/Naver 검색을 실행해 후보를 돌려주는 흐름을 설계한다.
- 장소 후보의 사용자 의도 적합성은 AI가 판단하고, 코드는 좌표와 `placeId` 또는 검색 출처 hard gate만 맡는 구조를 설계한다.
- 대중교통 장거리 구간의 탑승역/하차역 추출 모델을 정리한다.
- MCP clarification 응답 계약과 웹 partial route 표시 상태를 설계한다.
- 완료 기준을 테스트 케이스와 로컬 실제 검증 절차로 연결한다.
