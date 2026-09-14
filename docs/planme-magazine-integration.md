# 국가별 구 매거진 연결

검색에서 확인한 국가에 맞는 실제 매거진 기사를 기존 추천 탭과 기사 영역에 표시합니다.

- 이슈: [GUI-302([PlanME] 구 매거진 데이터 조회 기능 구현)](https://linear.app/guideme/issue/GUI-302/planme-구-매거진-데이터-조회-기능-구현)
- 디자인: [02_Homepage v2](https://www.figma.com/design/ohvUFxqAa753Iw0VDL2FsP/?node-id=28566-6536). 회사 Chrome에서 검색 장소의 매거진 노출 주석 확인.
- 기획: [글로벌 여정 확장 PRD](https://docs.google.com/document/d/1DoI46xBLsglRv8SNyWgKbyRKqD5EeOIoPTgsPnt5eEk/edit). 1단계의 검색 국가별 자사 기사 노출.
- API 기준: GuideME-API `origin/main`의 `17ccee15`, `guideme-api/apps/api/src/service/magazine/v1`의 컨트롤러와 요청·응답 DTO.
- PlanME 기준: `origin/main`의 `0204ee2`, 한국어·영어 페이지와 선택 출발지 반영 상태.

## 표시와 연결

해외 검색은 기존 국가 판별 결과의 국가 코드(countryCode)를 전달합니다. 목적지가 해외이면 목적지 국가, 목적지가 국내이고 출발지가 해외이면 기존 글로벌 준비 화면이 선택한 출발지 국가를 사용합니다. 국내 일정 결과는 기존 국내 일정 생성 성공 후 한국 기사를 표시합니다. 국가를 확인하지 못한 검색과 검색 전 상태에서는 임의의 국가를 선택하지 않습니다.

검색 변경 시 이전 기사를 숨기고 이전 요청을 취소합니다. 국가와 언어를 요청 식별값에 포함해 늦은 응답이 다른 국가 기사로 표시되는 것을 방지합니다. 서버와 클라이언트 양쪽에서 응답 국가·필수 필드·기사 주소를 검증하며, 국가가 다른 응답 전체를 거절합니다.

최초 6건을 조회하고 `기사 더 보기`로 6건씩 추가합니다. 추가 기사도 기존 격자·목록 보기, 콘텐츠 검색과 페이지 이동에 포함합니다. 콘텐츠 검색은 현재 불러온 기사에 적용합니다. 중복 기사 번호는 추가 표시하지 않습니다. 기사 없음, 조회 실패와 로딩을 구분하고 실패 시 재시도를 제공합니다.

한국어 페이지는 `language=ko`, 영어 페이지는 `language=en`을 요청합니다. API가 반환한 제목·요약만 사용하며 별도 자동 번역을 수행하지 않습니다. 실제 언어(contentLanguage)를 제목·요약의 HTML 언어 속성에 적용하고, 영어 화면에서 원문 복귀가 있으면 기존 원문 안내를 표시합니다. 기사 주소(articleUrl)는 API가 제공하는 원문 상세 주소이므로 상세 페이지 자체는 한국어일 수 있습니다.

대표 이미지가 없거나 브라우저에서 로드되지 않으면 일반 아이콘으로 대체합니다. 요약이 null이면 본문을 임의 생성하지 않습니다. 구 사이트 `guidemetrip.co.kr`의 API 데이터만 사용하며 신규 `guideme.co.kr` 스크래핑은 포함하지 않습니다.

## 추가 API 계약

- 엔드포인트: `GET /api/magazine`
- 변경 구분: 추가. PlanME 내부 동일 출처 조회 경로이며 인증 없는 기존 공개 API로 전달합니다.
- 상위 API: `https://api.guidemetrip.co.kr/api/v1/service/magazine/articles`
- 응답: `Cache-Control: no-store`. 상위 요청 대기 한도 8초.

| 영역 | 구분 | 필드 | 변경 전 | 변경 후 | 설명 |
|---|---|---|---|---|---|
| 요청 | 추가 | 국가(countryCode) | 없음 | 필수 문자열 | 대문자 ISO2, 실제 유효성은 상위 DTO에서도 검증 |
| 요청 | 추가 | 언어(language) | 없음 | 선택 ko/en | 기본 ko |
| 요청 | 추가 | 시작 위치(skip) | 없음 | 선택 정수 | 0 이상 안전 정수, 기본 0; take는 서버에서 6으로 고정 |
| 성공 응답 | 추가 | 성공(success) | 없음 | true | 정상 목록 응답 |
| 성공 응답 | 추가 | 전체 개수(data.count) | 없음 | 정수 | 전체 국가별 기사 수 |
| 성공 응답 | 추가 | 기사 목록(data.list) | 없음 | 배열 | 최대 6건, 빈 배열 허용 |
| 목록 항목 | 추가 | 기사 번호(articleNo) | 없음 | 정수 | 기사 식별자 |
| 목록 항목 | 추가 | 국가(countryCode) | 없음 | 문자열 | 요청 국가와 일치해야 함 |
| 목록 항목 | 추가 | 제목(title) | 없음 | 문자열 | API에서 적용한 언어 |
| 목록 항목 | 추가 | 요약(summary) | 없음 | 문자열/null | API 텍스트 그대로 사용 |
| 목록 항목 | 추가 | 이미지(thumbnailUrl) | 없음 | HTTP(S) URL/null | 상대 주소를 생성하지 않음 |
| 목록 항목 | 추가 | 기사 주소(articleUrl) | 없음 | URL | 구 사이트의 해당 기사 상세 주소 |
| 목록 항목 | 추가 | 실제 언어(contentLanguage) | 없음 | ko/en/ja/zh | API의 실제 콘텐츠 언어 |
| 오류 응답 | 추가 | 오류(error) | 없음 | 문자열 | 입력 오류 400 `INVALID_REQUEST`, 조회 장애 503 `MAGAZINE_UNAVAILABLE` |

기존 GuideME API, DB 스키마와 데이터는 변경하지 않았습니다. 새 배포 환경변수나 API 키도 필요하지 않습니다.

## 검증 실행 기준

| 항목 | 값 |
|---|---|
| 날짜 | 2026-09-14 |
| 호출 환경 | 운영 GuideME 공개 읽기 API, 로컬 PlanME 빌드 |
| 기본 URL | `https://api.guidemetrip.co.kr`, `http://localhost:3102` |
| 구현 버전 | 위 PlanME 기준 커밋에 이 문서와 함께 커밋되는 변경 |
| 재현 기록 | `apps/web/scripts/check-planme-magazine.mjs` |
| 외부 연동 | 실제 HTTP, 모의 응답·기사·DB 사용 없음 |

### GET /api/v1/service/magazine/articles

| 케이스 | 요청 차이 | 기대 | 실제 HTTP | 실제 응답 주요 값 | 판정 |
|---|---|---|---:|---|---|
| 일본 | JP/ko | 국가 일치 | 200 | count=54, 6건 모두 JP | 통과 |
| 영어 일본 | JP/en | 번역 또는 원문 | 200 | count=54, 실제 언어 ko/en 혼재 | 통과 |
| 프랑스 | FR/ko | 다른 국가 일치 | 200 | count=32, 6건 모두 FR | 통과 |
| 바티칸 | VA/en | 기사 없음 | 200 | count=0, list=[] | 통과 |
| 한국 | KR/ko | 국내 기사 | 200 | count=284, 6건 모두 KR | 통과 |
| 다음 페이지 | JP/skip=6 | 다음 6건 | 200 | 최초 페이지와 기사 번호 중복 없음 | 통과 |
| 마지막 이후 | JP/skip=54 | 개수 유지 | 200 | count=54, list=[] | 통과 |
| 비표준 국가 | ZZ | 입력 거절 | 400 | 상태 및 오류 본문의 성공 목록 파서 거절 확인 | 통과 |

실제 JP 성공 본문을 FR 요청의 응답으로 파서에 전달하면 국가 불일치로 거절됩니다. 이 검사는 실제 수신 본문의 순수 파서 검사이며, 서버가 잘못된 국가를 반환했다는 뜻은 아닙니다.

### GET /api/magazine

| 케이스 | 요청 차이 | 기대 | 실제 HTTP | 실제 응답 주요 값 | 판정 |
|---|---|---|---:|---|---|
| 국가·언어 조합 | JP/FR/VA × ko/en | 계약 유지 | 200 | success=true, count/list 및 국가 검증, no-store | 통과 |
| 잘못된 입력 | Japan, ZZ, language=fr, skip=-1 | 입력 거절 | 400 | 오류 응답 | 통과 |

상위 API의 운영 장애를 일으키지 않았으므로 상위 503을 이용한 통합 검증은 미실행입니다. 브라우저 연결 실패는 로컬 검증 서버를 중지해 직접 재현했고, 조회 실패 안내 후 서버 재기동·재시도로 6건에서 12건으로 복구되었습니다.

### 브라우저와 회귀 검증

회사 Chrome `guideme-trip.com` 프로필의 기존 탭을 사용했습니다.

- `/ko`: 서울→도쿄 검색, 일본 기사·실제 이미지 표시, 매거진 탭, 6건 추가 조회.
- 오류: 로컬 서버 중지 중 추가 조회 실패 안내, 재기동 후 재시도 성공.
- `/en`: 언어 전환 후 일본 국가와 선택 탭 유지, 실제 영어 제목과 한국어 원문 복귀 안내.
- 국가 변경: 도쿄→파리에서 프랑스 기사로 교체. 바티칸에서는 이전 기사 없이 영어 빈 결과 안내.
- 국내 검색: 서울→부산 일정 생성 후 기존 홈 안에 일정 결과와 한국 기사가 함께 표시됨.
- 기사 이동: 카드 클릭 후 `https://guidemetrip.co.kr/post/detail/4739`의 제목과 실제 본문 확인. 이미지 주소도 HTTP 200 확인.
- 자동 검사: 빌드, 린트, 한·영 HTTP·메타데이터·공유 이미지·기존 주소 검사, 실제 국가 판별, 선택 목적지, 선택 출발지 생성·편집 검증.
- 린트: 오류 없음. 기존 `ItineraryDashboard.tsx` 경고 3건은 유지.
- 지도 제한: `localhost:3102`에서 지도 인증 실패 표시. 변경 전 `0204ee2`를 `git archive`로 별도 디렉터리에 추출해 같은 환경 파일·같은 포트·같은 일정으로 실행해도 동일하게 재현됨. 지도·경로 코드 차이 없음. 이 환경에서 실제 지도 타일 표시는 통과로 판단하지 않았고 인증 실패의 구체적인 설정 원인은 확정하지 않음.
- DB 변경 없음. 매거진은 공개 GET만 호출했고 테스트용 기사 생성·삭제는 없습니다. 선택 출발지 자동 검증은 프로세스 내부 저장소로 실행합니다.

재현 명령:

```sh
npm ci --ignore-scripts
npm run build
npm run lint
npm --workspace @planme/web run start -- --port 3102
PLANME_BASE_URL=http://localhost:3102 node apps/web/scripts/check-planme-magazine.mjs
PLANME_BASE_URL=http://localhost:3102 npx --no-install tsx apps/web/scripts/check-planme-locales.ts
node --env-file=apps/web/.env.local apps/web/scripts/check-planme-global-trip.mjs --confirm-external-api
node --env-file=apps/web/.env.local apps/web/scripts/check-planme-selected-destination.mjs --confirm-external-api
node --env-file=apps/web/.env.local --import tsx apps/web/scripts/check-planme-selected-origin.ts --confirm-external-api
```

초기 실행에서는 의존성 미설치로 린트를 실행하지 못해 잠금 파일 기준 설치 후 통과했습니다. 루트 `npm run start -- --port 3102`는 인수 전달에 실패하여 위 workspace 직접 명령으로 기동했습니다. 브라우저 도구 연결 재설정 이후 회사 프로필을 다시 대조했습니다. 설치 시 기존 잠금 파일 의존성에서 취약점 14건이 보고되었으며 이 작업에서 의존성 버전은 변경하지 않았습니다.
