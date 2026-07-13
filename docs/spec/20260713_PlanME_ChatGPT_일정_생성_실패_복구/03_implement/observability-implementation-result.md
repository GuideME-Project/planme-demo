# ChatGPT 일정 생성 관측성 구현 결과

## 결론

- 맞춤형 GPT의 성공 응답 크기와 GPT 앱의 MCP → 웹 상세 저장 실패를 운영 로그에서 추적할 수 있도록 구현했다.

## 실제 변경

### MCP와 맞춤형 GPT

- 일정 추천 요청마다 UUID 추적 식별자를 생성한다.
- MCP → 웹 상세 저장 요청에 추적 헤더(`X-PlanME-Trace-Id`)를 전달한다.
- 웹의 실패 응답에서는 정규식으로 검증한 대문자 내부 오류 코드와 HTTP 상태만 보존한다.
- 맞춤형 GPT의 HTTP 200 응답은 본문 없이 UTF-8 JSON 바이트 수, 단계, 추적 식별자만 기록한다.
- AI 생성과 상세 저장 연결 실패는 일정 내용 없이 구조 로그로 기록한다.

### 웹 상세 저장과 경로 제공자

- 웹 상세 저장 API는 유효한 추적 헤더를 사용하고, 없거나 잘못된 값은 새 UUID로 교체한다.
- 인증, 요청 검증, 저장 기록 조회, 잠금, 경로 최종화, Redis 저장 단계를 구분한다.
- 경로 제공자 오류는 제공자, 내부 코드, 일차, Standard/CarryME, 구간 번호, 실제 재시도 여부를 보존한다.
- 실패 구간의 AI 방문지·숙소 장소명과 좌표를 기록하고 사용자 출발지·복귀지는 제거한다.
- 좌표 확인 실패 메시지에서 장소명과 좌표를 제거한다.

## 변경 파일

| 파일 | 실제 변경 |
| --- | --- |
| `apps/mcp/src/gpts-actions-api.ts` | 맞춤형 GPT 추적 식별자, 응답 바이트 수, 실패 구조 로그 |
| `apps/mcp/src/planme-mcp.ts` | 웹 저장 추적 헤더, 안전한 하위 오류 타입·코드 파싱, GPT 앱 실패 구조 로그 |
| `apps/mcp/scripts/check-planme-mcp.ts` | 추적 헤더와 응답 바이트 로그 계약 테스트 |
| `apps/web/app/api/gpt/itineraries/preview-store/route.ts` | 추적 헤더 검증과 단계별 실패 구조 로그 |
| `apps/web/lib/itinerary-route-finalizer.ts` | 구간·장소 컨텍스트 보존과 사용자 출발지·복귀지 제거 |
| `apps/web/lib/route-providers/types.ts` | 제공자 오류의 실패 구간과 실제 재시도 여부 필드 추가 |
| `apps/web/lib/route-providers/naver-directions.ts` | 네이버 재시도 후 실패 상태 보존 |
| `apps/web/lib/route-providers/odsay.ts` | ODsay 재시도 후 실패 상태 보존 |
| `apps/web/scripts/check-itinerary-finalization.ts` | 제공자·경로·재시도 로그 컨텍스트 테스트 |

## 보안 확인

구조 로그에 다음 값이 들어가지 않도록 구현했다.

- 일정 요청·응답 본문
- 사용자 출발지와 같은 장소인 복귀지의 장소명·좌표
- 전체 경로 형상
- 외부 API 응답 원문과 요청 URL
- API 키, 내부 인증값, 환경변수

## 남은 작업

- GitHub PR 검토 후 기준 브랜치 `main`에 병합한다.
- Vercel 자동 배포 후 탭 1의 응답 바이트 수와 탭 2의 상세 저장 하위 오류를 추적 식별자로 확인한다.
