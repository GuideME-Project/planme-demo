# PlanME 홈페이지 미디어 저장소

## 구성

- 버킷: `planme.kr`, 서울 리전 `ap-northeast-2`.
- 경로: `s3://planme.kr/home/`.
- HTTPS 기본 주소: `https://s3.ap-northeast-2.amazonaws.com/planme.kr/home/`.
- 버전 관리 활성화, 기본 SSE-S3 암호화, ACL 비활성화.
- 공개 권한은 `s3:GetObject` 한 가지이며 공개 업로드·삭제·목록 조회 권한은 부여하지 않음.
- 수명 주기 자동 삭제 규칙 없음. 별도 CloudFront 배포나 도메인 DNS 변경 없이 S3 HTTPS 주소 사용.
- 점이 포함된 버킷 이름의 HTTPS 인증서 문제를 피하도록 경로 방식 주소를 사용.

## 반영

홈페이지에서 사용하는 이미지·GIF·정지 이미지·영상·QR 총 44개(53.55MiB)를 업로드했다. 파일명별 크기와 SHA-256은 함께 보관한 `2026-09-28-planme-media-manifest.json`에 기록했다.

`home-media.ts`에서 주소를 관리한다. 홈페이지 컴포넌트와 추천 카드 이미지가 이 주소를 사용하며, S3 이미지는 Next.js 이미지 프록시를 거치지 않고 브라우저에 직접 제공한다. 작은 기존 브랜드 로고·파비콘 파일은 기존 위치를 유지한다.

후속으로 Drive의 최신 OpenGraph 원본 `planme_og.png`(파일 ID `1boA2yLScFISNgIFWHXAw32JavOoRdwPQ`)를 `home/planme-og-20260923.png`로 추가하여 전체 파일 수는 45개가 되었다. `brand-metadata.ts`에서 새 주소와 실제 크기 2500×1313을 사용한다. 원본과 S3 파일의 SHA-256 일치 및 로컬 한글·영문 페이지의 OpenGraph 메타데이터를 검증했다.

미디어 원본은 `apps/web/public/home/`에 보존했다. 이 디렉터리를 Git 제외 목록에 추가하여 새 미디어가 커밋과 Vercel 배포에 다시 포함되지 않게 했다. 이미 Git에 추적된 기존 파일은 삭제하지 않았다.

## 검증

- 콘솔 업로드 결과: 44개 성공, 0개 실패.
- 인증 없는 HTTPS 다운로드: 44개 모두 상태 200, 원본 크기와 SHA-256 일치.
- 로컬 Chrome 화면: 렌더링된 S3 이미지 23개 로딩 확인.
- 동영상 3개 모두 S3 주소로 재생 진행, 준비 상태 4, 영상 폭 1280, 미디어 오류 없음 확인.
- 변경 파일 ESLint, TypeScript 및 Next.js 운영 빌드 통과.

스토리지 연결과 로컬 반영까지 완료했으며, 이번 작업에서 운영 홈페이지 배포는 수행하지 않았다. 버전 관리가 켜져 있어도 특정 버전의 영구 삭제나 계정·버킷 삭제까지 막는 것은 아니다.
