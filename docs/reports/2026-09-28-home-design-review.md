# 홈페이지 디자인 반영 및 화면 검토

기준: 2026-09-28 확인한 [Figma 홈페이지](https://www.figma.com/design/ohvUFxqAa753Iw0VDL2FsP/?node-id=28566-6536), 한글 전체 화면 `28881:24`, [전달 자료 폴더](https://drive.google.com/drive/folders/1DANFk_WeL0j-TXRZon4kBXIMT4y1Upf-).

후속 반영: 홈페이지 미디어 44개를 `planme.kr` S3 버킷으로 이전하고 로컬 화면도 S3 주소를 사용하도록 변경했다. 구성과 검증은 [미디어 저장소 보고서](2026-09-28-planme-media-storage.md)에 기록했다.

## 반영

- 가을 사진 히어로, 헤더, 큰 제목, 검색창과 본문의 간격.
- 롤러·GuideME·ThrillME 영상 3개와 전달받은 표지.
- 안내 배너 5종 원본 GIF와 3초 전환, 추천 콘텐츠 모자이크, 서비스 홍보 카드 3종 원본 GIF 선택, DealME·RestME 원본 배너 표시.
- 광고 이미지, 여행 소개 및 Star/Pro Roller 두 카드, 앱 연결 영역.
- 프로세스·FAQ·뉴스레터·앱 다운로드와 실제 스토어 주소의 QR.
- 영문·한글 화면의 데스크톱/모바일 배치.

## 이미지 출처와 제한

| 파일 | 출처 및 상태 |
| --- | --- |
| `hero-autumn.jpg` | Figma `28566:6575`의 원본 이미지 다운로드 후 웹용 변환 |
| `roller-feature.mp4` | Drive `19752TtdhZ6q6VNF8i4cqtKu_c1KqSi4b`, 4K 원본을 1280px 영상으로 변환 |
| `guideme-feature.mp4`, `thrillme-feature.mp4`, 각 표지 | 전달된 Drive 자료 |
| `dealme-en.jpg`, `dealme-ko.jpg`, `restme-banner.jpg` | 전달된 Drive 배너, 이미지 위 별도 문구/흐림 제거 |
| `advertisement-design.jpg` | Figma 전체 화면에서 광고 작품을 추출. 설계서의 임시 광고이며 예약 주소 연결 없음 |
| `roller-landscape.jpg` | Figma `28566:6651`의 원본 1015×760 이미지. 이전 잘라 쓴 사진의 브라우저 캐시와 분리한 새 파일명 사용 |
| `star-roller.jpg`, `pro-roller.jpg` | Figma `28566:6665`, `28566:6670`의 4096px 원본에서 변환. 대표 사진 보관용이며 현재 회전 카드에는 아래 8종 사용 |
| `star-roller-1.jpg`~`star-roller-4.jpg` | Figma `28866:2783`, `28866:2805`, `28866:2827`, `28866:2832` 원본에서 웹용 변환 |
| `pro-roller-1.jpg`~`pro-roller-4.jpg` | Figma `28866:2788`, `28866:2842`, `28866:2871`, `28866:2892` 원본에서 웹용 변환 |
| `banner-*.gif` | Figma `28850:58`, `28850:67`, `28850:71`, `28850:75`, `28866:2702`의 원본 GIF 5종 |
| `service-*.gif` | Figma `28850:1074`, `28865:1087`, `28865:1090`의 WinkME·GiftME·CarryME 원본 GIF |
| `banner-*.png`, `service-*.png` | 원본 GIF의 첫 장면. 동작 줄이기 설정 및 안내 배너 일시정지에 사용 |
| `guideme-logo-transparent.png` | Figma 전체 화면에서 로고 추출 후 단색 배경 투명 처리 |
| `guideme-ios-qr.svg`, `guideme-android-qr.svg` | 기존 코드의 실제 App Store/Google Play 주소로 생성 |

Figma MCP의 View 권한 호출 한도와 Chrome 응답 문제를 겪었으나, Chrome 복구 후 실제 이미지 레이어의 다운로드와 페이지에서 읽은 원본 이미지 주소로 나머지 자료를 확보했다. 하단 풍경·롤러 사진의 잘라 쓴 임시 이미지를 교체했으며 안내/서비스 카드의 임시 아이콘도 원본 GIF로 교체했다.

Star·Pro 카드는 각각 지정 사진 4장을 3초마다 순환한다. 일시정지·재개·다음 버튼을 제공하며 마우스 올림, 키보드 포커스, 숨겨진 탭, 동작 줄이기 설정에서 자동 전환을 멈춘다. 가상의 이름·팔로워 수·인물 지역은 표시하지 않는다. 상단 안내 배너도 요청대로 3초마다 전환한다.

뉴스레터는 기존 연동이 없어 비활성 상태로 표시한다. FlyME·PlayME 신규 제휴 설정/연결은 요청에 따라 보류했다. YouTube 주소는 추후 제공 예정이다.

OpenGraph는 후속 확인에서 Drive의 새 `planme_og.png`를 발견하여 교체했다. 2026-09-23 업로드된 가을 배경·PlanME 로고 이미지(2500×1313)를 S3 `home/planme-og-20260923.png`로 제공하며, 한글·영문 페이지의 `og:image`와 크기 메타데이터가 새 파일을 가리키는 것을 확인했다. 이전에 ‘추후 전달 예정’으로 분류했던 판단을 정정한다.

## 검증

- 로컬 서버 `http://localhost:4173`에서 Orca 내장 브라우저 사용.
- 디자이너 페르소나 서브에이전트가 실제 1440px·390px 캡처를 Figma 화면과 비교.
- 히어로 부제의 검색창 가림, 모바일 사진 잘림, 로고 사각 배경, QR이 문구를 좁히는 문제를 수정하고 실제 캡처로 재검토.
- 영문·한글 화면과 RestME 배너의 실제 표시 확인. DealME는 마지막 Orca 연결 종료 후 회사 Chrome 플러그인으로 전환해 탭 선택 상태와 한글 배너 표시를 확인했다. 당시 보류했던 1920px 전체 폭 검수는 아래 후속 검수에서 완료했다.
- 영상 3개를 활성 브라우저에서 재생: 모두 `paused=false`, `readyState=4`, 영상폭 1280 확인. 롤러 약 35.97초, GuideME 약 19.83초, ThrillME 약 54.52초.
- 변경 컴포넌트 ESLint, Next.js 운영 빌드 및 TypeScript 검사 통과.
- 원본 추가 반영 후 회사 Chrome에서 하단 풍경의 전체 구도와 Star·Pro 사진 8장의 로딩 완료를 확인했다. 웹용으로 변환한 회전 사진은 직접 제공하며, 전환 중 빈 화면이 생기던 이미지 요청 문제를 해소했다.
- 원본 추가 반영 후 `PlanmeHome.tsx`·`RollerCards.tsx` ESLint와 Next.js 운영 빌드·TypeScript 검사 재통과.
- 회사 Chrome에서 원본 적용 후 영문 1440px·390px, 한글 390px 화면을 추가 캡처했다. 모바일 가로 넘침은 없었다. 디자이너 서브에이전트는 부모가 로컬 브라우저에서 저장한 실제 화면과 Figma 기준 이미지를 독립 비교했다.
- 추가 검토에서 모바일 서비스 링크와 선택 버튼의 겹침, 데스크톱 서비스 카드 옆의 큰 빈 공간을 발견했다. 하단 버튼 여백을 확보하고 콘텐츠 6개와 서비스 카드가 3열 격자를 채우도록 수정했다. 수정 후 실제 캡처 재검토에서 해당 문제의 해소를 확인했다.
- 최신 캡처는 `original-en1440-media.png`, `original-en1440-services-fixed.png`, `original-en1440-rollers.png`, `original-en390-media.png`, `original-en390-services-fixed.png`, `original-en390-rollers.png`, `original-ko390-media.png`, `original-ko390-rollers.png`이다.

검토 캡처와 원본 및 교체 전 이미지 백업은 `/Users/mion/.codex/tmp/planme-design-20260928/`에 보관한다. 보류한 외부 연동과 뉴스레터 기능의 완료를 의미하지 않는다.

## 1920px 후속 검수

- 회사 Chrome 플러그인에서 로컬 서버의 `/en`, `/ko`를 1920×1080으로 열고 히어로부터 푸터까지 각각 10개 구간을 실제 캡처하여 확인했다. 이전 오른쪽 반복 현상은 재현되지 않았다.
- 두 언어 모두 문서 폭 1905px(스크롤바 제외)으로 가로 넘침이 없었고, 전체 페이지를 스크롤한 뒤 이미지 로딩 실패가 없었다.
- 한글 이용 순서 설명에서 ‘여행’과 ‘확인하고’가 단어 중간에서 줄바꿈되는 문제를 발견했다. 해당 설명에 `word-break: keep-all`을 적용하고 1920px 한글 및 390px 한글·영문 실제 화면으로 재검토했다.
- 임시 광고에는 문구와 버튼 모양이 이미지 자체에 함께 들어가 있어 광고 본문과 겹쳐 보인다. 최종 광고 소재 교체와 실제 연결 주소 적용은 여전히 남아 있다.
- 증거: `review1920-en-top.png`, `review1920-en-1.png`~`review1920-en-9.png`, 한글의 동일 이름 `review1920-ko-*`, `review1920-ko-process-fixed.png`, `review390-ko-process-fixed.png`, `review390-en-process-fixed.png`.
- 이번 검수는 홈페이지 기본 화면의 배치·문구·이미지 표시 범위이며, 외부 제휴 연동이나 운영 배포 완료를 뜻하지 않는다.
