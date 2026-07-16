# ODsay Referrer 인증 운영 결정

- 결정 상태: 적용 예정
- 확인일: 2026-07-14
- 적용 범위: PlanME V3 서버의 ODsay 대중교통·도보·경로선 조회
- 구현 대상: `apps/web/lib/planme-v3/route-service.ts`, `apps/web/lib/planme-v3/runtime.ts`
- 결론: **조건부 가능** — 고정 출발 IP 기능을 사용하지 않는 현재 Vercel 환경에서는 등록된 Web 키와 URI를 사용하고, 서버가 신뢰된 고정 `Referer` 헤더를 붙여 호출한다.

## 1. 결정

PlanME V3의 ODsay 호출 인증을 서버 IP 기준이 아닌 등록 URI와 HTTP `Referer` 헤더 비교 기준으로 전환한다.

- ODsay 애플리케이션에 등록된 Web 키를 서버 전용 환경변수 `ODSAY_API_KEY`로만 읽는다.
- 모든 ODsay 요청에 `Referer: <등록된 PlanME origin>/`을 붙인다.
- `Referer` 값은 운영자가 관리하는 `PLANME_WEB_ORIGIN`에서만 만든다.
- 운영 환경에서 클라이언트 요청의 `Host`, `Origin`, `Referer` 값을 그대로 전달하지 않는다.
- API 키와 API 키가 포함된 전체 요청 URL은 로그에 남기지 않는다.
- 기존 ODsay 오류 보정 정책은 인증 변경과 분리해 그대로 유지한다.

HTTP 표준 헤더 이름은 역사적인 오탈자가 포함된 `Referer`이고, ODsay 설명에서는 `referrer`라는 표현도 사용한다. 코드에서는 실제 헤더 이름인 `Referer`를 사용한다.

## 2. 공식 근거 요약

| 공식 출처 | 확인 내용 | PlanME 판단 |
| --- | --- | --- |
| [ODsay FAQ](https://lab.odsay.com/community/faq) | 호출 환경과 등록한 플랫폼 상세값이 같아야 한다. Server 플랫폼은 등록 공인 IP와 실제 호출 서버의 공인 IP가 같아야 한다. 키에 특수문자가 있으면 URI 인코딩이 필요하다. | 고정 출발 IP를 사용하지 않는 Vercel 환경에서는 Server 키의 IP 일치 방식이 안정적이지 않다. |
| [ODsay 개발자 포럼: API 오류](https://lab.odsay.com/community/boardView?seq=630) | ODsay 관리자 답변은 Web 키 인증 시 HTTP 헤더의 referrer URL과 등록 URI를 비교하며, 값이 없거나 다르면 `ApiKeyAuthFailed`가 발생한다고 설명한다. | Web 키를 사용할 때 등록 URI와 일치하는 `Referer`가 필수다. |
| [ODsay 개발자 포럼: Vercel 서버 IP 문의](https://lab.odsay.com/community/boardView?seq=695) | Vercel의 유동 IP 문제에 관한 답변에서 ODsay 관리자는 Web 키가 등록 URI와 요청 헤더의 `Referer`를 비교해 인증된다고 다시 설명한다. | 현재 PlanME와 같은 Vercel 환경에서 Referrer 방식이 실제 ODsay 인증 동작과 맞는다. 다만 이 답변을 장기 지원 정책 보장으로 해석하지 않는다. |
| [ODsay 개발자 포럼: Web/Server 키 구분](https://lab.odsay.com/community/boardView?seq=657) | 일반 원칙으로 백엔드는 Server 키와 고정 IP, 프론트엔드는 Web 키와 등록 도메인을 사용하라고 안내한다. | 이번 결정은 ODsay의 일반적인 백엔드 권장 방식과 다르다. 제공사 정책이 강화되면 Server 키 또는 고정 출발 IP 구조를 다시 검토해야 한다. |
| [ODsay URI 인코딩 가이드](https://lab.odsay.com/guide/guide#guide1_7) | API 키의 특수문자를 포함해 쿼리 값을 올바르게 인코딩해야 한다. | 키는 문자열 치환이 아니라 URL 생성 API의 쿼리 파라미터 기능으로 인코딩한다. |
| [Vercel 공식 가이드: 배포 IP 허용 목록](https://vercel.com/guides/how-to-allowlist-deployment-ip-address) | 기본 Vercel Functions의 출발 IP는 동적이다. Pro·Enterprise에서는 Static IPs, Enterprise에서는 Secure Compute를 통해 안정된 출발 IP를 사용할 수 있다. | Referrer 방식이 유일한 기술적 해법은 아니다. 비용과 운영 범위를 허용하면 ODsay Server 키와 Vercel Static IPs 조합이 공식 권장에 더 가깝다. |

공식 자료가 보여주는 사실은 “Web 키가 등록 URI와 `Referer`를 비교한다”는 인증 동작이다. “백엔드가 임의로 `Referer`를 설정하는 방식을 공식 권장한다”는 문서는 확인되지 않았다. 따라서 아래 구현은 PlanME의 운영상 선택이며, ODsay의 공식 보증 범위로 표현하지 않는다.

## 3. 선택 이유

### 확인된 문제

- 고정 출발 IP 기능을 사용하지 않는 기본 Vercel Functions는 요청마다 동일한 출발 IP를 보장하지 않는다.
- Server 키는 등록 공인 IP와 실제 출발 IP가 다르면 `ApiKeyAuthFailed`가 발생한다.
- 현재 PlanME 도메인은 ODsay 애플리케이션의 Web URI로 등록되어 있다.
- Web 키 요청은 등록 URI와 일치하는 `Referer`가 있어야 인증된다.

### 선택하지 않은 대안

1. **기본 Vercel 출발 IP를 Server 플랫폼에 등록**
   - Static IPs를 활성화하지 않은 Vercel Functions의 출발 IP는 동적이므로 지속적으로 일치시킬 수 없다.

2. **브라우저에서 ODsay를 직접 호출**
   - 키가 브라우저 번들 및 네트워크 요청에 노출되고, V3의 서버 측 경로 확정 흐름과 호출량 통제를 우회한다.

3. **Vercel Static IPs, 고정 출발 IP 프록시 또는 별도 서버 도입**
   - ODsay의 일반 권장 방식에는 가장 가깝지만, 비용과 운영 범위를 늘린다. 현재 장애를 해결하기 위한 우선안에서는 제외하고, 제공사 정책 변경 시 대안으로 유지한다.

## 4. 구현 계약

### 환경변수

| 이름 | 공개 범위 | 용도 |
| --- | --- | --- |
| `ODSAY_API_KEY` | 서버 전용 | ODsay Web 키. 클라이언트 번들에 포함하지 않는다. |
| `PLANME_WEB_ORIGIN` | 서버 설정 | ODsay에 등록된 PlanME 원본 주소(origin). 경로·쿼리·프래그먼트 없이 관리한다. |
| `NEXT_PUBLIC_ODSAY_API_KEY` | 공개 | 기존 브라우저 경로의 레거시 변수. PlanME V3는 의존하지 않는다. |

민감값의 실제 값은 이 문서, 소스, 테스트 스냅샷, 로그에 기록하지 않는다.

### `Referer` 생성 규칙

1. `PLANME_WEB_ORIGIN`을 URL로 파싱한다.
2. `http:` 또는 `https:`만 허용한다.
3. 경로·쿼리·프래그먼트를 제거하고 `origin`만 사용한다.
4. 끝에 `/`를 붙여 `https://example.com/` 형태로 정규화한다.
5. 파싱 실패 또는 허용되지 않은 프로토콜이면 ODsay 호출을 진행하지 않고 구성 오류로 처리한다.
6. 운영 환경에서는 `PLANME_WEB_ORIGIN`이 없을 때 요청에서 추정한 origin으로 대체하지 않는다.

예시:

```ts
const configured = new URL(process.env.PLANME_WEB_ORIGIN!);
if (configured.protocol !== "https:" && configured.protocol !== "http:") {
  throw new Error("ODSAY_REFERER_CONFIGURATION_INVALID");
}
const odsayReferer = `${configured.origin}/`;
```

### 적용 요청

공통 ODsay 요청 함수에서 다음 API 호출 모두에 동일한 `Referer`를 적용한다.

- 대중교통 경로: `searchPubTransPathT`
- 도보 경로: `searchWalkPathV2`
- 지도 경로선: `loadLane`
- 이후 PlanME V3에 추가되는 모든 ODsay API

개별 호출부에서 헤더를 중복 구성하지 않는다.

### 오류 분류

- HTTP 응답 본문의 ODsay 오류 코드가 `500`이고 메시지에 `ApiKeyAuthFailed`가 있으면 `ODSAY_CONFIGURATION_ERROR`로 분류한다.
- 인증 실패를 경로 없음, 선택 장소 제외, 재시도 가능 장애로 오인하지 않는다.
- 인증 오류 발생 시 키, 전체 요청 URL, 원문 환경변수는 로그에 남기지 않는다.

## 5. 보안 및 운영 리스크

1. **공식 권장 방식과의 차이**
   - ODsay는 일반적으로 백엔드에 Server 키와 고정 IP 사용을 안내한다. 현재 방식은 Vercel 사례에서 확인된 Web 키 인증 동작을 이용하지만 장기 지원이 보장된 것은 아니다.

2. **`Referer`는 비밀이나 강한 인증 수단이 아님**
   - 서버에서는 헤더를 만들 수 있으므로 `Referer` 일치만으로 키 유출을 막을 수 없다. 키는 계속 서버 비밀로 관리하고 호출량 이상을 감시해야 한다.

3. **사용자 입력 전달 위험**
   - 요청의 `Host`, `Origin`, `Referer`, 전달 프록시 헤더를 신뢰하면 임의 도메인이 ODsay 인증 헤더로 사용될 수 있다. 운영 값은 고정 구성에서만 읽는다.

4. **API 키의 쿼리 문자열 노출 위험**
   - ODsay API 규격상 키가 쿼리에 포함되므로 전체 URL 로깅, 오류 추적 도구의 요청 URL 수집, 프록시 접근 로그를 점검해야 한다.

5. **첫 요청에 따른 런타임 캐시 오염 위험**
   - 런타임을 프로세스 전역으로 캐시하면서 요청 origin을 사용하면 첫 요청의 값이 이후 호출에 고정될 수 있다. 운영에서는 고정 `PLANME_WEB_ORIGIN`을 필수로 해 이 경로를 제거한다.

## 6. 기존 경로 보정 정책 보존

이번 변경은 인증 헤더만 다룬다. 다음 기존 정책은 변경하거나 제거하지 않는다.

- ODsay 대중교통 오류 `-98` 발생 시 도보 경로 조회
- ODsay 도보 오류 `411`~`414` 발생 시 직선거리 700m 이내에서만 예상 도보 생성
- 예상 도보는 실제 경로선이 아닌 `estimated` 상태로 구분
- 필수 장소의 경로 실패와 선택 장소 제외 정책
- 일시적 네트워크·서버 오류 재시도 정책

## 7. 검증 기준

### 자동 검증

- 등록 origin에 경로·쿼리가 있어도 `Referer`가 origin과 `/`만 포함하도록 정규화된다.
- `http:`·`https:` 외 프로토콜과 잘못된 URL은 거부된다.
- 대중교통, 도보, 경로선 요청 모두 같은 `Referer`를 보낸다.
- `ApiKeyAuthFailed`는 `ODSAY_CONFIGURATION_ERROR`로 분류된다.
- `-98`, `411`~`414`, 700m 예상 도보 보정 회귀 테스트가 계속 통과한다.
- 테스트는 가짜 키와 모의 응답을 사용하며 실제 키를 출력하지 않는다.

### 외부 스모크 검증

- 명시적으로 실행하는 외부 연동 테스트에서 등록된 운영 `Referer`로 ODsay 응답을 받는다.
- `Referer`가 없거나 등록값과 다른 경우 인증 실패가 발생하는지 제한된 1회 호출로 확인한다.
- 외부 호출 전 일일·초당 호출 한도를 확인하고 반복 테스트를 금지한다.
- 결과 로그에는 상태, API 종류, 오류 분류만 남기고 키와 전체 URL은 제거한다.

## 8. 재검토 조건

다음 중 하나가 발생하면 고정 출발 IP와 Server 키 방식으로의 전환을 다시 평가한다.

- ODsay가 서버 측 Web 키 사용을 제한하거나 `Referer` 검증 정책을 변경한다.
- `ApiKeyAuthFailed`가 등록 URI와 헤더 일치 상태에서도 반복된다.
- 키 유출 또는 비정상 호출량이 탐지된다.
- Vercel Static IPs 또는 비용상 적절한 고정 IP 프록시를 도입한다.
- ODsay 지원팀이 현재 사용 방식의 중단을 안내한다.
