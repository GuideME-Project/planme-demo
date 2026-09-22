# 영문 홈 제휴 위젯 구현 가능성 검토

[GUI-327([PlanME] 영문 홈 탭별 콘텐츠 및 제휴 위젯 연동 검토·구현)](https://linear.app/guideme/issue/GUI-327/planme-영문-홈-탭별-콘텐츠-및-제휴-위젯-연동-검토구현)

## 목적
영문 홈의 PlanME’s Pick 영역을 피그마 주석에 맞춰 검색 장소별 콘텐츠로 연결한다. 현재 고정 제휴 홍보 카드와 실제 검색 결과를 구분하고, 구현 가능성을 먼저 검토한 뒤 확인된 범위를 작업한다.

## 기준
- 영문 버전 우선. 국문 시안과 최종 이미지는 별도 전달 예정.
- 피그마: https://www.figma.com/design/ohvUFxqAa753Iw0VDL2FsP?node-id=28566-6536
- 운영: https://www.planme.kr/en
- Roller’s Dispatch: 검색 장소 관련 실제 매거진 기사.
- DealME: 실제 쿠폰 데이터. 출처 및 계약 확인 필요.
- FlyME / RestME / PlayME: 장소 관련 항공 / 숙소 / 투어. Travelpayouts 공식 삽입 도구 검토.

## 사전 검토 결과
- 공식 White Label 항공 위젯은 사이트 내부 검색·결과 표시 및 영문 설정 지원.
- 자체 도메인·로고를 쓰는 Page 방식도 지원하나 실제 항공 예약·결제는 외부 판매처에서 진행한다.
- 숙소·Tiqets 상품 위젯은 제공되지만 계정의 활성 프로그램, 발급 코드, 목적지 전달 규격, 결과 이동 경로를 확인해야 한다.
- 일반 aviasales.com URL에 제휴 marker가 있다고 iframe용 코드가 되는 것은 아니다.
- 현재 홈은 고정 제휴 카드 필터링이며 DealME 탭이 없다. 매거진은 국가별 조회 구현이 있다.

## 작업 순서
1. main 기준 별도 워크트리 생성. 기존 작업 및 다른 서비스 API 이슈 범위 보존.
2. 계정에서 발급한 실제 위젯 코드 / White Label ID / 등록 도메인 확인. 쿠폰 출처와 최종 시안 확인.
3. 실제 코드로 삽입 검증: 영문, 장소 전달, 검색 결과, 외부 예약 전환, 추적 정보, 모바일, 로딩·실패·재진입.
4. 검증된 공급자만 영문 탭에 연결. 임의 위젯 ID·상품·가격·쿠폰·예약 결과 생성 금지.
5. 빌드·린트와 브라우저 대조 후 PR. 운영 변경은 main PR 병합에 따른 CI/CD만 사용.

## 완료 조건
- 탭에 해당하는 실제 콘텐츠가 검색 장소와 연결된다.
- 공식 위젯 지원 제약과 피그마 차이를 명시한다.
- 검색·격자/목록 전환의 적용 범위, 빈 결과 및 공급자 오류를 검증한다.
- 기존 국내 일정 생성과 한국어 화면에 의도하지 않은 회귀가 없다.
- 미확인 계정 설정 및 예약 흐름을 완료로 보고하지 않는다.

## 공식 근거
- https://support.travelpayouts.com/hc/en-us/articles/203955753-What-is-White-Label-Web-by-Travelpayouts
- https://support.travelpayouts.com/hc/en-us/articles/26857907357458-Setting-up-a-White-Label-with-Widget-type
- https://support.travelpayouts.com/hc/en-us/articles/26856689805586-How-to-add-a-hotel-search-or-any-other-widget-to-your-White-Label
- https://support.travelpayouts.com/hc/en-us/articles/360032321331-Types-of-widgets

## 작업 공간 및 구현 착수 판정 — 2026-09-22

아래 내용은 초기 조사 시점의 기록입니다. 후속 검증과 선배포 범위는 문서 마지막 절을 기준으로 합니다.

- 작업 브랜치: `issue/327-english-partner-widgets`
- 작업 경로: `/Users/mion/Documents/01_develop/01_GuideME/.worktrees/planme-demo/issue-327-english-partner-widgets`
- 기준: `origin/main`, `fdef558`.
- 원본 체크아웃 변경 없이 워크트리 생성, Git에서 제외된 런타임 파일 5개 복사.
- 판정: 공식 도구 기반 구현은 조건부 가능. 실제 위젯 연결은 계정 자료 확인 전 착수 보류.

### 코드 근거

- `apps/web/components/home/home-content.ts`: All / Roller’s Dispatch / FlyME / RestME / PlayME. DealME 없음. 항공 Aviasales·숙소 KKday·투어 Tiqets 외부 제휴 주소 및 고정 카드.
- `apps/web/components/home/PlanmeHome.tsx`: 탭·검색은 현재 메모리의 카드/기사 필터. 공급자 검색 요청을 만드는 검색창이 아님. 격자/목록은 자체 카드에만 적용 가능하며 공급자 위젯에 동일 적용 가능하다고 가정할 수 없음.
- `apps/web/components/home/MagazineContext.tsx`, `use-magazine.ts`: 국가 코드만 공유하고 국가별 기사 조회. 도시·날짜·공항 코드·여행 인원까지 전달하는 검색 맥락은 별도 설계 필요.
- `apps/web/lib/planme-magazine-server.ts`: 신규 기사 원문은 한국어 계약. 영어 화면이라고 자동 영문 기사로 바뀌는 구조가 아니므로 기사 번역 여부 확정 필요.
- 확인한 루트 및 웹의 로컬 환경 파일에서 위젯·화이트라벨·쿠폰·매거진 관련 설정 항목을 찾지 못함. 운영 설정 전체가 없다고 단정하지 않음.

### 실제 구현을 시작할 필수 입력

1. 계정에서 발급한 항공 White Label 위젯 코드(실제 ID·등록 프로젝트·영문 설정). 기존 제휴 marker를 White Label ID로 대체하지 않음.
2. 숙소 공급자 확정: 현재 KKday 링크와 시안의 Aviasales hotels 사이의 선택 및 해당 공식 위젯.
3. 투어 공급자의 실제 상품/검색 위젯 코드와 도시별 설정 지원 규격.
4. DealME 쿠폰 조회 출처·표시 항목·사용 링크·유효기간 계약.
5. 피그마 전체 영문 프레임 및 최종 이미지. 현재 제공된 부분 캡처로 전체 치수 일치를 확정하지 않음.

비밀 토큰을 이슈나 소스에 붙이지 않는다. 발급 코드는 외부 브라우저에 노출하는 공식 코드인지 확인한다.

### 구현 순서 및 검증

- 항공은 공식 Widget 방식부터 검증하여 기존 PlanME 페이지 내부 검색·결과 표시를 확인한다. Page 방식 및 DNS 변경은 필요성 확정 후 별도 범위로 처리한다.
- 초기에는 발급된 그대로 로컬에서 영문·결과·예약 외부 이동 확인 후 컴포넌트로 분리한다. 언마운트/재진입 중복 삽입과 모바일 폭도 확인한다.
- 검색 장소 전달은 공식 지원 규격으로 구현한다. 공급자별 국가·도시·공항 식별값을 혼용하지 않는다.
- 공식 위젯 내부 디자인과 PlanME 자체 카드 디자인을 구분하여 피그마 재현 가능 범위를 보고한다.
- 실제 공급자 연결 없이 가짜 결과나 장식용 탭을 먼저 출시하지 않는다.
- 이번 검토에서는 코드 변경·빌드·브라우저 검증·배포를 수행하지 않았다. 이전 브라우저 권한 확인 실패 및 Figma MCP 호출 한도 때문에 시각적 일치도는 미검증이다.

## 후속 검증과 선배포 범위 — 2026-09-22

- 피그마 전체와 주석을 브라우저로 다시 확인했습니다. 상단 검색은 기존 유지, Pick의 별도 Search·탭·그리드/목록·페이지 이동·배너, 매거진 영어 표시와 guideme.co.kr 연결 요구를 확인했습니다. 최종 디자인 전체 구현은 이번 선배포 범위가 아닙니다.
- 영문 페이지 요청에서 신규·구 매거진 제목과 요약이 영어가 아니면 OpenAI로 번역합니다. 이미 영어인 기사는 유지합니다. 외부 사이트의 기사 본문은 변경하지 않습니다. 번역 캐시 및 실패 동작은 `docs/new-magazine-integration.md`에 기록했습니다.
- 웹의 외부 링크는 같은 창으로 이동하며 관련 새 탭 안내 문구를 제거합니다. ChatGPT 위젯은 상위 iframe 이동 대신 공식 `window.openai.openExternal`을 우선 사용하고 미지원 호스트에서 일반 새 탭 링크를 유지합니다. 기존 허용 도메인 설정을 사용합니다. 근거: https://developers.openai.com/apps-sdk/reference
- 제휴 추적 정보와 도시별 연결이 없어지는 일반 홈페이지 URL 교체는 반영하지 않습니다. 기존 항공·숙소·투어 및 도시별 제휴 주소를 유지합니다. Aviasales·Tiqets 단축 링크가 제휴 식별자를 포함한 실제 페이지로 연결되는 것을 HTTP로 확인했습니다. KKday는 자동 HTTP 조회가 403이므로 정상 예약 흐름을 확인했다고 판단하지 않습니다.
- 공식 항공 시연 위젯을 별도 로컬 페이지에 삽입해 서울→도쿄 검색 결과가 같은 페이지에 표시되는 것을 확인했습니다. 회사 계정의 운영 White Label ID를 연결한 것은 아닙니다. Tiqets 제휴 딥링크의 도시 목록·상품 상세 이동은 확인했지만 투어 iframe 삽입을 검증 완료로 보지 않습니다.
- 제공된 Aviasales 항공·숙소 페이지 자체는 `frame-ancestors 'none'`으로 일반 iframe 삽입을 차단합니다. 숙소는 Booking.com 이동 후 오류를 관측하여 대체 공급자 검증이 남아 있습니다. 이번 배포에 신규 항공·숙소·투어 위젯은 포함하지 않습니다.
- DealME 쿠폰 출처는 미확인입니다. 제공된 쿠폰 문서는 일정 생성 후 GuideME 앱에서 사용하는 쿠폰팩을 설명하며, DealME 탭과 연결한다는 근거는 없습니다.
- 웹 빌드, 린트(오류 0·기존 경고 3), 언어 검사, MCP 타입·계약 검사를 통과했습니다. DB 스키마 변경은 없습니다. 다른 AI의 변경도 검토해 함께 배포하라는 사용자 승인에 따라 위 변경을 포함합니다.
