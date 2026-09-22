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

신규 API에는 language를 보내지 않습니다. 신규 API의 한국어 원문 계약은 유지하지만, 2026-09-22부터 영문 요청은 PlanME 서버에서 기사 제목·요약을 영어로 번역하여 contentLanguage=en으로 반환합니다. 구 API가 한국어 원문으로 복귀한 경우에도 같은 번역 처리를 적용합니다. 원문 기사 주소·이미지·국가·정렬·개수는 유지하며, 외부 사이트의 기사 본문 자체를 변경하지는 않습니다. 좌표나 국가 목록 등 화면에서 사용하지 않는 신규 필드는 브라우저에 추가 전달하지 않습니다.

영문 번역은 기존 OPENAI_API_KEY와 PLANME_OPENAI_MODEL(미지정 시 gpt-5.4-mini)을 사용합니다. 번역 요청은 제목·요약·기사 번호만 전달하고 응답 저장을 끕니다. 원문과 모델을 기준으로 번역을 7일간 캐시하며, 설정된 Upstash Redis와 최대 128개 항목의 프로세스 메모리를 사용합니다. 원문이 바뀌면 다른 캐시 키가 생성됩니다. 최초 요청에는 번역 비용과 대기시간이 추가됩니다. 번역 요청 제한시간은 30초이며 기존 원문 조회 8초와 별도입니다. 번역 실패·누락·한국어 잔존 시 503으로 처리하고 영문 화면에 한국어 원문을 대신 내보내지 않습니다. 기존 재시도 안내를 사용합니다.

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
- 당시 검증에서는 신규 미국의 영어 요청이 한국어 원문을 유지했고 기존 일본 영어 요청은 ko/en을 반환했습니다. 2026-09-22 영문 요구 반영으로 이 동작은 변경되었으며, 현재 검사 스크립트는 두 경로 모두 영어만 허용합니다.
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

2026-09-15 Vercel planme-demo 프로젝트의 Production 및 Preview에 GUIDEME_MAGAZINE_API_KEY를 Secret으로 등록했습니다. PR #122의 신규 배포와 운영 브라우저 검증을 진행합니다. 기존 로컬 검증 기록과 운영 검증은 구분합니다.

## 2026-09-22 영문 기사 검증

- `npm run build`, 변경 파일 ESLint, 기존 `check-planme-locales.ts`: 통과.
- `check-planme-magazine-english.ts`: 운영 PlanME에서 공개된 미국 기사 6건을 읽고 실제 OpenAI 호출로 제목·요약의 영어 변환을 확인했습니다. 기사 번호·국가·링크·이미지·목록 개수·null 요약 보존, 동시 요청 결과 일치, API 키 없이 캐시 재사용, 이미 영어인 결과 재번역 생략을 확인했습니다.
- 별도의 실제 한국 기사에서 API 키를 제거한 경우 번역 오류가 발생하며, 한국어 원문을 정상 영문 결과로 반환하지 않는 것을 확인했습니다. 가짜 기사나 HTTP 응답 대체는 사용하지 않았습니다.
- 검증 프로세스에서는 공유 Redis 환경변수를 제거해 운영 저장소에 쓰지 않았습니다. Redis 저장·재조회 경로는 이번 실제 호출 검증에 포함하지 않았습니다.
- 이 워크트리의 로컬 환경에는 GUIDEME_MAGAZINE_API_KEY가 없어 수정된 `/api/magazine` 전체 호출과 브라우저 검증은 미실시했습니다. 실제 원문 조회와 번역 모듈 검증을 전체 API 검증으로 간주하지 않습니다. 배포하지 않았습니다.
- 재현 스크립트는 OPENAI_API_KEY와 PLANME_MAGAZINE_SOURCE_BASE_URL을 설정하고 공유 Redis 설정을 비운 프로세스에서 `npx --no-install tsx apps/web/scripts/check-planme-magazine-english.ts`로 실행합니다.
