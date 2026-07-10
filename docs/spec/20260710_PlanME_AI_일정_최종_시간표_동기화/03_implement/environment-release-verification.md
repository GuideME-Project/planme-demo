# 환경변수·배포·검증 구현계획

## 결론

- 구현 시작 전에 원본과 구현 워크트리의 런타임 환경파일을 맞춘다.
- 내부 인증값은 제가 생성·배치하되 값은 출력하거나 커밋하지 않는다.
- Vercel 두 프로젝트의 환경변수는 로그인된 브라우저에서 직접 반영한다.
- 로컬 검증 통과 후 PR을 병합해 자동 배포하고 운영에서 다시 검증한다.

## 환경변수 작업

### 생성

- `PLANME_INTERNAL_API_TOKEN`을 암호학적으로 안전한 임의 값으로 한 번 생성한다.
- 명령 출력, 셸 기록, 문서, Git diff에 값을 남기지 않는다.
- 동일 값을 MCP 요청과 웹 검증에 사용한다.

### 로컬 반영 대상

원본 `main`:

```text
apps/mcp/.env.development
apps/mcp/.env.local
apps/web/.env.development
apps/web/.env.local
```

이번 구현 워크트리:

```text
apps/mcp/.env.development
apps/mcp/.env.local
apps/web/.env.development
apps/web/.env.local
```

과거 등록 워크트리에는 추가하지 않는다. 루트 `.env.local`에도 앱 런타임이 직접 사용하지 않으므로 추가하지 않는다.

### Vercel 반영

- 프로젝트: `planme-demo`, `planme-demo-mcp`
- 환경: Production, Preview
- 방식: 브라우저의 로그인 세션 사용
- 확인: 변수 이름과 적용 환경만 확인하고 값은 보고하지 않음

Development는 로컬 `.env.development`와 `.env.local`로 관리한다.

## 기준 테스트

코드 변경 전 다음 명령을 실행해 기존 실패를 분리한다.

```bash
npm run test:route-normalization
npm run test:actions
npm run test:mcp
npm run build
```

린트는 저장소 안전 규칙에 따라 별도 승인 없이는 실행하지 않는다.

## 변경 후 자동 검증

```bash
npm run test:route-normalization
npm run test:actions
npm run test:mcp
npx playwright test apps/web/e2e/gpt-itinerary-generation.spec.ts
npx playwright test apps/web/e2e/itinerary-finalized-routes.spec.ts
npx playwright test apps/web/e2e/itinerary-map-view-layout.spec.ts
npm run build
```

새 계약 검사에 포함할 항목:

- 내부 인증 성공·실패
- 전체 40초 제한
- 실패 구간 한 번 재시도
- 일부 경로 실패 시 중간 결과 미저장
- AI 시간표 배열 불변
- 체류 시간이 총 이동 시간에 포함되지 않음
- 버전 1·2 Redis 읽기
- 편집 기준 버전 충돌
- 지도 형상 저장·복원
- 위젯 최종 1회 표시

## 로컬 통합 검증

1. 3000번 포트를 사용 중인 기존 PlanME 프로세스만 확인해 종료한다.
2. 원본에서 복사한 환경파일로 로컬 웹과 MCP를 실행한다.
3. 자동차 일정 생성 API를 호출해 네이버 이동 시간과 저장 결과를 확인한다.
4. 대중교통 일정 생성 API를 호출해 ODsay 서버 계산과 저장 결과를 확인한다.
5. 잘못된 내부 인증값으로 401을 확인한다.
6. 저장된 상세 링크를 새로고침하고 일차 탭을 반복 전환한다.
7. 제공자 호출 횟수가 증가하지 않는지 확인한다.

실제 외부 제공자 호출이 필요한 검증에서는 인증값과 응답 원문 전체를 출력하지 않는다.

## Git·PR·배포 순서

1. 구현 파일과 문서만 Git 변경 범위에 포함됐는지 확인한다.
2. `.env*`가 Git 추적 또는 staged 상태가 아닌지 확인한다.
3. 로컬 자동·통합 검증을 완료한다.
4. 기능 브랜치를 push하고 GitHub PR을 생성한다.
5. 별도 Linear 이슈를 연결하지 않는다.
6. PR을 `main`에 병합한다.
7. Vercel 웹·MCP 자동 배포가 모두 성공했는지 확인한다.
8. 두 배포가 모두 준비된 후 운영 테스트를 실행한다.
9. 원격 기능 브랜치를 정리하고 원본 `main`을 최신화한다.

Vercel MCP 직접 배포는 사용하지 않는다.

## 운영 테스트

### ChatGPT Apps

1. 자동차 1박 2일 일정을 새로 생성한다.
2. 생성 중 위젯이 반복 표시되지 않는지 확인한다.
3. 최종 위젯이 한 번 표시되는지 확인한다.
4. 위젯의 Standard·CarryME 이동 시간을 기록한다.
5. 상세 링크에서 같은 이동 시간인지 확인한다.

### 상세 웹

1. 1일차·2일차를 처음 전환한다.
2. 3초 이상 기다린 뒤 이동 시간과 시간표가 바뀌지 않는지 확인한다.
3. 탭을 다시 전환해 같은 결과인지 확인한다.
4. 상세 지도에서 직선 점멸과 빈 높이 영역이 없는지 확인한다.
5. 중복 숙소 경로와 `출발지와 도착지가 동일합니다` 오류가 없는지 확인한다.

### 기존 링크

1. 버전 1 생성 링크를 연다.
2. 장소·시간표·마커가 유지되는지 확인한다.
3. 이동 시간과 지도 경로만 계산 중에서 최종값으로 바뀌는지 확인한다.
4. 새로고침 후 재계산하지 않는지 확인한다.

### 대중교통

1. 대중교통 일정을 생성한다.
2. ODsay 순수 이동 시간이 위젯과 웹에서 같은지 확인한다.
3. 부분 형상 구간에서는 제공 가능한 선과 탑승·하차 마커가 표시되는지 확인한다.

## 실패 시 중단 조건

- ODsay 서버 호출 불가: 구현·배포 중단
- 내부 인증값을 두 Vercel 프로젝트에 동일하게 반영하지 못함: 배포 중단
- 일부 경로 실패인데 위젯이 준비 상태가 됨: 병합 중단
- AI 시간표 내용이 제공자 계산 후 변경됨: 병합 중단
- 위젯과 상세 웹 이동 시간이 다름: 병합 중단
- `.env*` 또는 비밀값이 Git diff에 포함됨: 즉시 제거하고 비밀값 교체 검토
- 빌드 또는 핵심 테스트 실패: 병합 중단

## 롤백

- 운영 회귀 발생 시 이전 `main`으로 되돌리는 PR을 생성한다.
- 버전 2 데이터 읽기 때문에 이전 코드가 실패하지 않도록 구현 단계에서 하위 호환 파서를 먼저 배포한다.
- 새 흐름을 폐기하면 로컬과 Vercel 양쪽에서 `PLANME_INTERNAL_API_TOKEN`을 함께 제거한다.
- 롤백 후 기존 생성·상세 링크와 위젯 호출을 다시 확인한다.

## 구현 결과 문서

- [implementation-result.md](implementation-result.md): 실제 변경 파일, 설계 대비 차이, 남은 작업
- [verification-log.md](verification-log.md): 실행 명령, 성공·실패 결과, 운영 확인과 재시도 내역
