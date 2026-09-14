# 신규 매거진 연결

2026-09-14. 기준 `origin/main` b4fc9f5. 기존 국가 판정과 화면 구조를 유지하고 PlanME 서버의 기사 조회 경로를 확장했습니다.

## 조회 흐름

브라우저 → PlanME `GET /api/magazine` → 신규 `https://guideme.co.kr/planme-api/articles.php`.

- 해당 국가의 신규 기사 전체 개수(count)가 양수이면 신규 기사만 표시합니다.
- 신규 기사 전체 개수가 0일 때만 기존 GuideME 공개 매거진 API를 조회합니다. 두 목록을 합치거나 오래된 기사로 신규 목록을 채우지 않습니다.
- 페이지 범위를 넘어서 신규 list가 비어도 count가 양수이면 구 사이트로 바뀌지 않습니다.
- 신규 API 장애·인증 실패·설정 누락은 503과 기존 재시도 안내로 처리합니다. 장애를 기사 없음으로 바꾸지 않습니다.
- 양쪽 HTTP 호출은 기존 8초 제한을 공유합니다. 캐시는 사용하지 않습니다.
- 조회 사이에 원본 기사가 추가·삭제되는 경우를 고정하는 스냅샷 페이지네이션은 제공하지 않습니다.

## 요청과 응답

`GET /api/magazine?countryCode=US&language=ko&skip=0`

기존 countryCode, language(ko/en), skip 요청과 success/data/count/list 응답을 유지합니다. 페이지 크기는 기존 6건이며 skip 상한은 신규 API가 허용하는 1,000,000입니다.

서버가 신규 countryCodes 배열에 요청 국가가 포함됐는지 확인한 뒤 기존 단일 countryCode 형태로 변환합니다. 신규 기사 주소는 `https://guideme.co.kr/detail.php?number=<articleNo>`, 구 기사는 기존 주소만 허용합니다. 클라이언트도 두 정확한 주소 형식과 필수 필드·국가를 검사합니다. 기사 식별값은 출처 간 번호 충돌을 피하도록 원문 URL을 사용합니다.

신규 API에는 language를 보내지 않습니다. 신규 기사는 contentLanguage=ko이며 영어 화면에서도 원문을 유지합니다. 구 API의 번역 요청과 원문 복귀 동작은 보존합니다. 좌표나 국가 목록 등 화면에서 사용하지 않는 신규 필드는 브라우저에 추가 전달하지 않습니다.

## 서버 설정과 배포 전제

- `GUIDEME_MAGAZINE_API_KEY`: 신규 API의 `X-GuideME-Api-Key` 인증에 사용하는 서버 전용 환경변수입니다. `NEXT_PUBLIC_` 접두어를 붙이지 않습니다.
- 로컬은 Git에서 제외된 `apps/web/.env.local`에 설정했습니다. 값은 기존 저장소 밖의 인증키 파일에서 전달했고 문서·소스에 기록하지 않았습니다.
- 인증 호출은 `server-only` 모듈에만 있습니다. 다른 주소로 리다이렉트되는 응답도 거절합니다.
- 운영/미리보기 환경의 같은 환경변수를 등록한 뒤 PR 기반 자동 배포가 필요합니다. 이 변경 자체는 원격 환경변수를 등록하지 않습니다. 키 없이 배포하면 기사 조회가 503이므로 설정 전 병합하지 않습니다.
- GuideME API, 신규 PHP 서버, DB 스키마·기사 데이터는 이번 변경으로 수정하지 않았습니다.

## 검증

실제 외부 API를 호출했습니다. 모의 기사·가짜 DB·HTTP 응답 가로채기는 사용하지 않았습니다.

- `npm run build`: 통과. 최초 의존성 미설치로 tsc 실행 실패 후 `npm ci --no-audit --no-fund`와 재실행으로 통과.
- `npm run lint`: 오류 0, 기존 ItineraryDashboard 경고 3건.
- 로컬 `http://localhost:3104`의 `/api/magazine`: 미국 6건, 한국 3건, 캐나다 5건 모두 신규 사이트 주소 확인.
- 일본 54건, 프랑스 32건은 구 매거진 유지. 바티칸 0건 확인.
- 스위스·스페인·코스타리카에서 실제 다국가 기사 1297 확인.
- 신규 미국의 영어 요청은 한국어 원문 유지. 기존 일본 영어 요청은 ko/en 반환.
- 일본 더 보기, 신규·구 목록의 마지막 이후 빈 페이지와 전체 개수 유지, 잘못된 국가·언어·skip의 400 확인.
- 별도 로컬 서버 3105에서 인증키를 비운 상태로 실행해 일반화된 503 응답 확인. 실제 상위 서버 장애를 유발한 검증은 하지 않았습니다.
- 빌드된 클라이언트 JavaScript 25개에 실제 인증키가 포함되지 않음을 검사했습니다.
- 내장 브라우저 연결 실패, 이후 Computer Use의 앱·브라우저 연결 목록도 비어 있어 이번 변경의 실제 화면 조작은 미검증입니다. 기존 UI 검증 기록을 이번 결과로 간주하지 않습니다.

재현:

```sh
npm run build
npm run lint
npm --workspace @planme/web run start -- --port 3104
PLANME_BASE_URL=http://localhost:3104 node apps/web/scripts/check-planme-magazine.mjs
```

이번 작업은 로컬 구현·검증이며 운영 환경 설정·PR 배포·운영 화면 검증은 별도 완료가 필요합니다.
