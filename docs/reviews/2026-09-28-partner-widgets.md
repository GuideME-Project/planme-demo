# FlyME·PlayME 공식 위젯 연결 검토

## 보존과 되돌리기

- 변경 전 홈페이지 전체 보존 커밋: `6ac0930`.
- 위젯 연결은 후속 커밋으로 분리한다. 그 커밋을 `git revert <위젯 커밋>`하면 기존 홈페이지를 유지하면서 이번 연결만 취소할 수 있다.
- 최초 구현 단계에서는 푸시·PR·병합·배포하지 않았다. 이후 사용자가 운영 배포를 승인했다.
- Travelpayouts에는 Planme 프로젝트의 항공 위젯 `22736`을 새로 만들었다. 코드 되돌리기는 이 외부 설정을 삭제하지 않는다. 설정을 남겨도 복구한 홈페이지에서는 호출하지 않는다.

## 실제 연결

- Planme 프로젝트 `576970`, 공개 파트너 식별자 `766533` 사용.
- FlyME: White Label Web의 Widget 유형. 공식 모듈 `https://tpscr.com/wl_web/main.js?wl_id=22736`, 공식 검색·결과 컨테이너 사용.
- 위젯 설정: 기본 영어·USD, 추가 한국어·KRW, 호텔 검색과 Travelpayouts 추천 링크 제외. 파란색 `#1955A5`, Inter, 모서리 12px.
- PlayME: Tiqets Popular Tours Widget, 프로그램 `89`, 도구 `3947`. 공식 발급 스크립트에 도시 식별자·영어·USD·가로 카드 4개를 전달한다.
- 도시 목록 419개는 아래 공식 자료의 Cities 시트에서 가져왔다. 도시 목록에 있다는 사실이 현재 상품 재고를 보장하지는 않는다. 기본 도시는 서울 `73067`이다.
- 홈페이지의 해당 탭에서 위젯을 표시하고, 기존 정적 콘텐츠용 검색·격자/목록·페이지 이동은 숨긴다. All 탭의 기존 제휴 카드 링크는 유지한다.
- 위젯 내부 스크립트와 탐색 상태를 Next.js 화면에서 분리하기 위해 같은 출처의 전용 HTML 경로를 iframe으로 표시한다. 이는 공급업체 코드를 신뢰하지 않아도 되는 보안 격리는 아니다.
- 항공은 검색 전에는 입력창 내용 높이를 사용한다. 자동완성·달력·인원 팝업 또는 결과가 표시될 때만 프레임을 확장하고 내부에서 스크롤한다. 투어는 공급업체의 크기 메시지를 확인해 높이를 조절한다.
- 입력칸의 고정 이름, 테두리, 검색 영역 배경은 로컬 CSS로 보완했다. 공식 설정은 글꼴과 공통 색상 위주여서 입력 이름은 렌더링된 Shadow DOM의 입력 `name`을 기준으로 적용한다. 팝업 높이는 공급업체의 `tpwl-modals` 및 Modal/Popover 클래스에 의존하므로 공급업체 UI 변경 시 재검수가 필요하다. 이번 스타일 수정에서 Travelpayouts 계정 설정은 변경하지 않았다.
- 위젯이 준비되지 않으면 20초 뒤 오류 화면을 숨기고 안내한다. 외부 제휴 링크는 항상 제공한다. 다른 출처 iframe의 403 본문을 앱에서 직접 읽을 수는 없으므로 Tiqets 공식 로더의 `postWidgetSize` 준비 신호를 사용한다.

## 확인 결과

- 변경 파일 ESLint와 Next.js 운영 빌드 통과.
- 로컬 Chrome, 데스크톱 1440×1000 및 모바일 390×844에서 항공 UI 확인.
- 서울→도쿄, 2026-10-10 편도 검색: 실제 항공사·운임·시간·필터가 PlanME 안에 표시됨. 항공권 선택 후 수하물 조건과 판매처별 외부 예약 링크 확인. 결제는 하지 않음.
- 상세창이 화면 밖으로 밀리던 문제를 수정한 뒤 데스크톱·모바일에서 다시 확인.
- PlayME **상품 표시 검증 미완료**: 공식 Travelpayouts 미리보기에서는 뉴욕과 서울 상품이 표시되지만, localhost에서 Tiqets가 `Request filtered by WAF. (403)`을 반환했다. 계정 도구 자체가 미승인된 것으로 단정할 근거는 없다. 정확한 차단 규칙과 공개 주소에서의 성공 여부는 확인하지 못했다.
- 403 원인 비교: 공식 미리보기에서 생성된 서울 위젯 주소는 HTTP 200이었다. 같은 요청의 삽입 페이지 주소(`origin`)만 실제 로컬 주소 `http://localhost:4173/partner-widgets/tour?city=73067&lang=en`로 바꾸면 HTTP 403과 같은 WAF 차단 본문이 재현됐다. iframe 밖에서도 재현되므로 이 오류는 iframe 레이아웃 문제가 아니다. 주소의 어느 부분에 대응하는 WAF 규칙인지는 확인할 수 없으며 운영 도메인의 성공을 보장하지 않는다.
- 로컬 PlayME의 로딩 실패 안내와 외부 링크 표시 확인. 투어 상품의 로컬 표시 및 클릭 이동을 통과로 처리하지 않음.
- 항공·투어 HTML 경로 200, 알 수 없는 종류 404, 잘못된 도시 값은 서울로 제한, 임의 HTML 미반영, 검색 제외 및 동일 출처 프레임 정책 확인.

## 남은 확인

- 운영 배포 후 `www.planme.kr`의 Tiqets 요청은 HTTP 200이며 서울 상품 4개를 반환했다. 다만 초기 `visibility:hidden` 상태에서는 크기 준비 메시지가 오지 않아 실패 안내로 전환됐다. 브라우저에서 숨김을 해제하자 실제 상품 렌더링, 공급업체 높이 적용, 실패 안내 해제가 이어지는 것을 확인하여 초기 숨김을 제거했다. 20초 실패 처리와 메시지 출처·발신 프레임 검증은 유지한다.

- 배포가 승인되면 공개 미리보기 주소에서 Tiqets 상품 렌더링·도시 변경·외부 상품 이동 확인. 같은 403이면 Travelpayouts/Tiqets 지원에 Planme 등록 주소와 해당 요청을 근거로 문의해야 한다. 차단을 우회하는 변경은 하지 않는다.
- 홈페이지 상단 일정 입력과 위젯의 목적지·날짜·인원은 아직 연결하지 않았다. 현재 항공은 위젯 안에서 입력하고, 투어는 별도의 도시 선택을 사용한다.
- 제휴사 예약 완료·수수료 집계는 실제 거래 없이 확인하지 않았다.

## 공식 근거

- [White Label Web 개요](https://support.travelpayouts.com/hc/en-us/articles/203955753-What-is-White-Label-Web-by-Travelpayouts)
- [White Label Web 설정 안내](https://support.travelpayouts.com/hc/en-us/articles/16436383582226-Travelpayouts-White-Label-Web-Setup-Guide)
- [Widget 유형 설정](https://support.travelpayouts.com/hc/en-us/articles/26857907357458-Setting-up-a-White-Label-with-Widget-type)
- [Tiqets 공식 도시 식별자 안내](https://support.travelpayouts.com/hc/en-us/articles/360010455179-Data-from-Tiqets)
- [도시 목록 원본](https://docs.google.com/spreadsheets/d/1eKIViu-Hl_eTFdCbBwJa-sgD57iCmBazHMDTBDcFwis/edit), 2026-09-28 확인.
- [Tiqets 공식 로더](https://widgets.tiqets.com/loader.js): `postWidgetSize` 메시지에 따른 프레임 크기 조절 확인.
