# 구현 결과

## 결론

AI가 만든 장소 순서와 시간표 배열은 유지하고, 모든 일차의 Standard·CarryME 순수 이동 시간과 지도 데이터를 웹 서버에서 최종 계산해 버전 2로 저장하도록 구현했다. MCP 생성 도구는 이 저장이 성공한 뒤에만 준비 완료를 반환하며, 위젯 조회 도구와 상세 웹은 같은 저장 일정을 사용한다.

## 핵심 구현

### 제공자와 최종화

- 자동차: 네이버 Directions 서버 모듈로 구간 시간·형상 계산
- 대중교통: ODsay 웹 키와 고정 운영 `Referer`로 구간 시간·제공 가능한 형상 계산
- 좌표 누락: 네이버 지역 검색의 첫 대표 후보를 선택하고 같은 장소를 경로 간 재사용
- 동시성: Standard·CarryME 두 경로씩 계산하고 묶음 실패 시 다음 묶음을 시작하지 않음
- 동일 장소만 남는 경로: 제공자를 호출하지 않고 순수 이동 시간 0분·경로선 없음으로 완료
- 재시도: 일시적 실패 구간만 한 번 재시도
- 제한시간: 좌표 검색과 전체 경로 계산이 40초를 공유
- 저장 형상: `geoSegments`만 저장하고 중복된 평탄화 `geoPath`는 저장하지 않음

### 저장과 인증

- Upstash Redis 버전 1 읽기 호환과 버전 2 완료 저장 추가
- Lua 비교-저장으로 `revision` 확인과 교체 원자화
- `SET NX EX` 계산 잠금과 소유자 확인 Lua 해제
- MCP 저장 API는 내부 Bearer 인증 적용
- 브라우저 재계산은 일정 ID·revision·15분 만료에 묶인 HMAC 서명 토큰 적용
- 요청 출처를 해시해 일정별 5분 4회 호출 제한 적용
- 편집 입력은 저장된 제목·일차·Standard·AI 시간표를 유지하고 CarryME 행선지와 일정 전체 이동수단만 허용

### MCP·위젯·웹

- MCP 저장 요청 제한을 43초로 늘리고 최종 저장 응답을 생성 결과로 사용
- 생성 도구에는 위젯 템플릿을 연결하지 않고, 성공 후 조회 도구 한 번만 호출하도록 계약 유지
- 조회 도구는 MCP 메모리 대신 웹의 버전 2 최종 일정을 읽음
- 위젯과 웹의 `예상` 문구 제거
- 버전 2 웹은 저장 경로를 즉시 사용하고 새로고침·일차 전환에서 제공자를 호출하지 않음
- 버전 1 웹은 장소·AI 시간표·마커를 유지한 채 이동 시간과 경로만 계산 중으로 숨겼다가 전체 성공 후 교체
- 편집 재계산 실패 시 기존 성공 일정을 계속 표시

## 주요 변경 파일

- `apps/web/lib/route-providers/*`
- `apps/web/lib/itinerary-route-finalizer.ts`
- `apps/web/lib/itinerary-coordinate-resolver.ts`
- `apps/web/lib/edited-itinerary-validator.ts`
- `apps/web/lib/route-finalization-token.ts`
- `apps/web/lib/preview-itinerary-store.ts`
- `apps/web/app/api/gpt/itineraries/preview-store/route.ts`
- `apps/web/app/api/gpt/itineraries/[itineraryId]/routes/finalize/route.ts`
- `apps/web/components/itinerary/ItineraryDashboard.tsx`
- `apps/mcp/src/planme-mcp.ts`
- `apps/mcp/src/gpts-actions-api.ts`
- `apps/mcp/src/planme-widget.ts`
- `apps/web/e2e/itinerary-finalized-routes.spec.ts`
- `apps/web/scripts/check-itinerary-finalization.ts`

## 설계 대비 확정·변경점

- ODsay Server 키와 고정 IP를 추가하지 않았다. 공식 Vercel 사례와 실제 호출로 기존 웹 키 + 등록 주소 `Referer`가 인증됨을 확인했다.
- 자유로운 전체 일정 편집 대신 현재 UI가 제공하는 CarryME 행선지와 일정 전체 이동수단만 서버가 반영한다. AI 시간표 불변을 요청 신뢰가 아닌 서버 경계에서 강제하기 위한 변경이다.
- 작업자 풀 대신 두 경로 단위 묶음을 사용한다. 한 경로가 빨리 끝난 뒤 다음 일차가 선행 시작되는 실패 조건을 막기 위한 변경이다.
- 정적 데모 일정은 기존 브라우저 계산 흐름을 유지한다. Redis에 저장된 생성 일정 버전 1·2만 새 서버 최종화 계약의 대상이다.

## 남은 작업

- GitHub PR 생성·`main` 병합
- Vercel 웹·MCP 자동 배포와 운영 검증
