# 구현 검증 로그

## 현재 상태

- ODsay 서버 인증 사전조건: 통과
- Vercel 환경변수 사전조건: 통과
- 로컬 구현·통합 검증: 통과
- Git 커밋·PR·운영 배포: 대기

## ODsay 인증 재검증

최초 검사는 등록 주소와 일치하는 `Referer` 없이 요청해 HTTP 200 안의 `ApiKeyAuthFailed`를 받았다. 이 결과만으로 웹 키의 서버 사용이 불가능하다고 판정한 것은 잘못이었다.

ODsay의 [Vercel 서버 호출 공식 답변](https://lab.odsay.com/community/boardView?seq=695)은 웹 키가 등록 URI와 요청 `Referer`를 비교하며, Vercel 서버 호출도 인증됐다고 설명한다. 같은 조건으로 현재 키를 다시 검증했다.

```text
요청 런타임: Node.js 서버
인증 방식: 현재 웹 키 + 등록 운영 주소 Referer
HTTP 상태: 200
대중교통 후보 경로: 15개
첫 경로 순수 이동 시간: 47분
```

판정:

- 현재 ODsay 웹 키로 Next.js·Vercel 서버 호출이 가능하다.
- Server 플랫폼, 별도 Server 키, 고정 송신 IP는 이번 구현의 필수조건이 아니다.
- `Referer`는 강한 비밀 인증이 아니므로 서버에서 고정하며, 요청 시작을 직렬화해 Basic 호출 제한을 완화한다.
- 장기적으로 ODsay의 웹 키 서버 사용 정책은 서면 확인하는 것이 안전하다.

## Vercel 실행시간 검증

- 웹 최종화 함수: 코드에 `maxDuration = 45` 설정
- MCP 생성·조회 함수: `vercel.json`에 `maxDuration = 60` 설정
- MCP 운영 로그에서 함수 최대 실행시간 5분 확인
- Vercel 공식 문서상 Fluid Compute Hobby 기본·최대 실행시간은 300초이며, Next.js App Router는 경로 파일의 `maxDuration` 내보내기를 지원한다.
- 근거: [Vercel 함수 실행시간 설정](https://vercel.com/docs/functions/configuring-functions/duration)

따라서 웹 45초와 MCP 60초 설정은 현재 상한 안에 있다. 웹 배포 후 운영 로그에서 실제 적용값을 한 번 더 확인한다.

## 환경변수 반영

값을 출력하지 않고 동일한 내부 인증값을 다음 대상에 반영했다.

- 원본 `main`: 웹·MCP의 `.env.local`, `.env.development`
- 구현 워크트리: 웹·MCP의 `.env.local`, `.env.development`
- Vercel `planme-demo`: Production, Preview
- Vercel `planme-demo-mcp`: Production, Preview

MCP 로컬 런타임에는 웹 최종화 주소도 `http://localhost:3000`으로 설정했다. 모든 로컬 환경파일은 Git 제외 상태다.

## 로컬 실제 제공자 통합 검증

3000번 서버에서 내부 인증을 거쳐 `POST /api/gpt/itineraries/preview-store`를 호출했다.

### 자동차 2일 일정

```text
HTTP 상태: 200
저장 상태: ready
저장 버전: version 2, revision 1
Standard 이동 시간: 286분, 68분
CarryME 이동 시간: 279분, 56분
네 경로 지도 형상: 모두 있음
```

### 대중교통 2일 일정

```text
소요 시간: 약 5.95초
HTTP 상태: 200
저장 상태: ready
저장 버전: version 2, revision 1
Standard 이동 시간: 195분, 93분
CarryME 이동 시간: 196분, 82분
네 경로 지도 데이터: 형상 또는 제공자 탑승·하차 마커 있음
```

## 자동 검증 중 확인된 계약

- 최대 동시 경로 계산 2개
- 한 묶음의 첫 실패 이후 다음 경로 호출 중단
- 일시적 네이버 구간 실패 1회 재시도
- 전체 제한시간 초과 오류
- AI 시간표 배열의 바이트 수준 불변
- 좌표 없는 장소의 첫 네이버 대표 후보 자동 선택과 경로 간 재사용
- 편집 요청이 제목·Standard·AI 시간표를 변조하지 못함
- 중복 제거 후 동일 장소 하나만 남는 경로는 제공자 호출 없이 0분으로 완료
- 버전 1 읽기와 버전 2 원자적 비교 저장
- 잘못된 내부 인증과 브라우저 서명 토큰 거부
- 버전 2 상세 화면의 3.5초 후 값 불변과 일차 전환 제공자 무호출
- 버전 1 상세 화면의 장소·시간표·마커 유지 후 서버 최종화
- 1박 2일 저장 payload 약 16KB, 2박 3일 약 24KB이며 중복 `geoPath` 미저장

## 남은 검증

- 전체 필수 테스트와 빌드 최종 실행
- PR 병합과 웹·MCP 자동 배포 성공 확인
- 운영 ChatGPT 위젯 1회 표시와 웹 시간 일치
- 운영 일차 전환·상세 지도·직선 점멸·중복 숙소·동일 장소 오류 회귀 확인

## 최종 자동 검증 결과

```text
npm run test:route-normalization                                      통과
npm run test:actions                                                  통과
npm run test:mcp                                                      통과
npm run test:finalization                                             통과
npm run build                                                         통과
npx playwright test apps/web/e2e/gpt-itinerary-generation.spec.ts     7개 통과
npx playwright test apps/web/e2e/itinerary-finalized-routes.spec.ts    2개 통과
npx playwright test apps/web/e2e/itinerary-map-view-layout.spec.ts     1개 통과
git diff --check                                                      통과
웹·MCP TypeScript 검사                                                통과
```

린트는 저장소 규칙에 따라 별도 승인 없이 실행하지 않았다. 상세 지도 E2E의 정적 데모는 테스트 주소 `127.0.0.1`이 ODsay 등록 URI와 달라 브라우저 인증 경고를 남겼지만, 저장된 생성 일정의 서버 최종화 E2E에서는 브라우저 제공자 호출 0회를 확인했다.
