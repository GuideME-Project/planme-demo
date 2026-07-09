# 로컬 운영 분리와 화면 정리

## 목적

- 이 주제를 확인하는 이유: 로컬 MCP와 운영 MCP를 분리하기로 했지만 `PLANME_WEB_ORIGIN` 적용 범위가 일부 누락되어 같은 문제가 반복됐다.
- 이 주제가 불명확하면 생기는 리스크: 로컬 링크는 생성되지만 MCP widget metadata가 운영 도메인만 허용해 로컬 검증이 깨질 수 있다.

## Questions

1. `PLANME_WEB_ORIGIN` 적용 범위는 어디까지인가?
2. 화면 제목과 metadata에서 `PlanME` prefix 제거를 어디까지 적용할지?
3. 상단 `Standard / CarryME` 범례 정렬 문제도 이번 범위에 포함할지?

## Answers

1. 저장 호출, 응답 링크, MCP widget CSP/redirect metadata에 모두 적용한다.
2. H1뿐 아니라 metadata, OpenGraph title에서도 leading `PlanME` prefix를 제거한다.
3. 상단 `Standard / CarryME` 범례 정렬 확인도 완료 기준에 포함한다.

## Score

- 현재 불명확성 점수: `0.10`
- 목표 임계값: `Standard 0.20`
- 점수 근거: 기존 누락 범위가 확인됐고, 적용 대상과 검증 기준이 확정되었다.
- 다음에 낮춰야 할 불확실성: 공통 title normalize helper 위치와 MCP widget metadata 생성 함수 구조.

## Confirmed

- `PLANME_WEB_ORIGIN` 값은 trailing slash와 invalid origin에 안전하게 대응해야 한다.
- `ChatGPT 초안` 문구는 노출하지 않는다.
- CarryME 설명 문구는 고정한다.
- H1, metadata, OpenGraph title에서 leading `PlanME` prefix를 제거한다.

## Open Questions

- MCP widget CSP에서 MCP origin과 web origin을 동시에 포함하는 방식의 최종 테스트 위치를 구현 단계에서 정해야 한다.

## References

- [Linear GUI-157](https://linear.app/guideme/issue/GUI-157/planme-%EC%A2%8C%ED%91%9C-%EB%B3%B4%EC%9E%A5-%EB%B0%8F-%EB%8C%80%EC%A4%91%EA%B5%90%ED%86%B5-%ED%91%9C%EC%8B%9C-%EA%B0%9C%EC%84%A0) - 확정 요구사항
- `apps/mcp/src/planme-mcp.ts` - MCP origin, pageUrl, widget metadata
- `apps/web/app/itinerary/[id]/page.tsx` - metadata와 OpenGraph title
- `apps/web/components/itinerary/ItineraryDashboard.tsx` - H1, route copy, 범례 정렬
