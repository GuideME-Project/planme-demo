# 로그 관측·검증 설계

## 결론

- 맞춤형 GPT와 GPT 앱의 일정 생성 요청마다 임의 추적 식별자를 생성한다.
- GPT 앱은 MCP에서 웹 상세 저장 API까지 같은 추적 식별자를 전달한다.
- 운영 로그에는 응답 크기, 실패 단계, 내부 오류 코드, 경로 제공자, 일차, 경로 종류, 구간 번호와 재시도 여부를 기록한다.
- 경로 실패 구간의 AI 방문지·숙소는 장소명과 좌표를 기록한다.
- 사용자 출발지·복귀지, 일정 본문, 외부 응답 원문과 인증정보는 기록하지 않는다.

## 추적 식별자

- 형식: UUID
- 전달 헤더: `X-PlanME-Trace-Id`
- 전달 경로: MCP 일정 생성 → 웹 상세 저장 API
- 수명: 한 번의 일정 생성과 저장 시도
- 웹 처리: 헤더가 없거나 형식이 잘못되면 새 UUID 생성
- 사용 제한: 인증, 권한, 잠금과 데이터 식별에는 사용하지 않음

## 안전한 로그 계약

```json
{
  "event": "planme_route_finalization_failed",
  "traceId": "임의 UUID",
  "stage": "route_provider",
  "provider": "odsay",
  "failureCode": "ROUTE_NOT_FOUND",
  "dayIndex": 0,
  "routeId": "standard",
  "segmentIndex": 1,
  "originPlaceName": "AI 방문지 A",
  "originCoordinate": { "lat": 34.8, "lng": 127.9 },
  "destinationPlaceName": "AI 방문지 B",
  "destinationCoordinate": { "lat": 34.81, "lng": 127.91 },
  "retried": true
}
```

| 업무 의미(필드) | 설명 |
| --- | --- |
| 이벤트(`event`) | 요청과 실패 종류 식별 |
| 추적 식별자(`traceId`) | 맞춤형 GPT 또는 MCP·웹 로그 연결 |
| 처리 단계(`stage`) | 응답, 웹 전달, 좌표 확인, 경로 제공자, 저장 단계 |
| 응답 크기(`responseBytes`) | 맞춤형 GPT HTTP 200 JSON의 UTF-8 바이트 수 |
| HTTP 상태(`statusCode`) | 응답 또는 웹 전달 결과 상태 |
| 경로 제공자(`provider`) | `naver-directions`, `odsay` |
| 내부 오류 코드(`failureCode`) | 원문을 제거한 안전한 오류 코드 |
| 일차 번호(`dayIndex`) | 0부터 시작하는 내부 위치 |
| 경로 종류(`routeId`) | `standard`, `carryme` |
| 구간 번호(`segmentIndex`) | 0부터 시작하는 실패 이동 구간 |
| 출발 장소(`originPlaceName`, `originCoordinate`) | 사용자 출발지·복귀지가 아닌 실패 구간의 장소명·좌표 |
| 도착 장소(`destinationPlaceName`, `destinationCoordinate`) | 사용자 출발지·복귀지가 아닌 실패 구간의 장소명·좌표 |
| 재시도 여부(`retried`) | 재시도 후 실패 여부 |

로그 금지 항목:

- 사용자 출발지와 같은 장소인 복귀지의 장소명·좌표
- 전체 경로 좌표 배열
- 일정 제목, 요약, 시간표, 요청·응답 본문
- 외부 API 요청 주소와 응답 원문
- API 키, 내부 인증값, 환경변수
- 사용자의 ChatGPT 대화 내용

## 기록 지점

| 지점 | 기록 내용 |
| --- | --- |
| 맞춤형 GPT Actions API | 성공 응답 바이트 수, HTTP 상태, 추적 식별자 |
| GPT 앱 MCP | 웹 상세 저장 전달 실패 단계, HTTP 상태, 안전한 하위 오류 코드 |
| 웹 상세 저장 API | 인증, 요청 검증, 기록 조회, 잠금, 경로 최종화, 저장 실패 단계 |
| 경로 최종화 | 제공자, 내부 코드, 일차, 경로 종류, 구간 번호, 방문지·숙소 장소명·좌표, 재시도 여부 |

## 자동 검증

- MCP 웹 저장 요청에 유효한 추적 식별자 헤더가 존재한다.
- 맞춤형 GPT 성공 로그에 양수인 응답 바이트 수가 존재한다.
- 경로 제공자 실패 로그에 제공자, 일차, 경로 종류, 구간 번호와 내부 오류 코드가 존재한다.
- 방문지·숙소의 장소명·좌표는 존재하고 사용자 출발지·복귀지는 존재하지 않는다.
- 로그에 테스트용 토큰 문자열이 포함되지 않는다.
- 웹 오류 응답에서는 대문자 영문·숫자·밑줄 형식의 내부 코드만 MCP가 보존한다.

## 운영 확인

배포 후 실패 요청의 추적 식별자로 다음 흐름을 확인한다.

1. 맞춤형 GPT는 HTTP 상태와 응답 바이트 수를 확인한다.
2. GPT 앱은 MCP의 웹 전달 로그에서 추적 식별자를 확인한다.
3. 같은 추적 식별자로 웹 상세 저장 실패 단계를 찾는다.
4. 경로 제공자 실패라면 제공자, 내부 오류 코드, 일차, 경로 종류, 구간 번호, 방문지·숙소 장소명·좌표와 재시도 여부를 확인한다.

같은 실패 요청을 원인 확인 없이 반복하지 않는다.

## 배포와 롤백

- 기준 브랜치 `main` 대상 GitHub PR 병합 후 Vercel 자동 배포를 사용한다.
- Vercel MCP 또는 CLI 직접 배포는 사용하지 않는다.
- 로그 기록 때문에 정상 요청이 실패하거나 민감정보 노출 가능성이 발견되면 로그 변경을 되돌리는 후속 PR로 롤백한다.

## References

- [인터뷰 로그 관측·검증 기준](../01_interview/response-observability-and-validation.md)
- [맞춤형 GPT Actions API](../../../../apps/mcp/src/gpts-actions-api.ts)
- [MCP 일정 저장 연결](../../../../apps/mcp/src/planme-mcp.ts)
- [상세 일정 저장 API](../../../../apps/web/app/api/gpt/itineraries/preview-store/route.ts)
- [경로 최종화](../../../../apps/web/lib/itinerary-route-finalizer.ts)
- [경로 최종화 테스트](../../../../apps/web/scripts/check-itinerary-finalization.ts)
- [GPT 앱 MCP 테스트](../../../../apps/mcp/scripts/check-planme-mcp.ts)
