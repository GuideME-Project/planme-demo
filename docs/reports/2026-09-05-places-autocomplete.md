# 검색창 장소 자동완성 구현 결과

출발지·목적지에 Google Places Autocomplete(New)를 연결했습니다. 선택한 장소는 서버 Place Details(New)에서 국가·좌표·공식 이름과 주소를 확인하며, 출발지 또는 목적지 어느 한쪽이라도 해외로 확인되면 기존 준비 화면으로 보냅니다. 후보를 선택하지 않은 직접 입력도 양쪽 국가를 조회하고 국내끼리는 기존 원문과 검색 흐름을 유지합니다.

## 최종 상단 카드 디자인

사용자가 작은 글씨와 분산된 설명을 줄여 달라고 요청하여 상단을 흰 패널과 파란 상단선, 작은 항공 아이콘으로 다시 구성했습니다. 제목은 “이 여행은 준비 중이에요”, 출발지→목적지는 강조 영역, 안내는 “먼저 여행에 필요한 준비물을 살펴보세요.” 한 문장입니다. 국가 중복·Updating·학습 설명·지구 배경은 제거하고 Google Maps와 응답에 포함된 제3자 출처는 유지했습니다. 아래의 이전 배지 설명은 수정 경위 기록입니다.

변경 컴포넌트 린트·빌드가 통과했으며 회사 Chrome 데스크톱과390×844에서 Los Angeles→부산의 표시와 줄바꿈, 겹침 없음을 확인했습니다. 하단6개 카드와 검색 판정은 유지했습니다. DB 스키마·마이그레이션 변경은 없습니다.

## 후속 수정: 해외 출발 → 국내 목적지

사용자가 제보한 로스앤젤레스→부산 실패의 원인은 서버가 출발지 Details를 확인해 놓고도 목적지 국가만 준비 화면 분기에 사용한 것이었습니다. `apps/web/lib/planme-global-trip.ts`에 양쪽 국가 판정을 모아, 선택한 쪽은 서버 검증 Details를 재사용하고 직접 입력한 쪽은 기존 Geocoding 조회를 병렬 실행합니다. 어느 한쪽 해외 확인 시 국내 장소 연결과 V3 생성 전에 반환하며, 기존 입력 검증·요청 제한·선택 검증 오류는 그대로 앞에서 처리합니다. 양쪽 모두 미확정/실패이면 해외로 단정하지 않습니다.

`PlanmeGlobalPreparation`과 홈 전달 속성에 출발지 및 해외 판정 방향을 추가했습니다. 해외 출발만 확인된 경우 `출발 · 미국 · 로스앤젤레스` 배지와 `출발 로스앤젤레스 → 목적지 부산광역시`, 해외 출발 자동 일정 준비 안내를 표시합니다. 부산을 해외 도시로 표시하지 않습니다. 양쪽 해외는 기존처럼 목적지 중심이며 기존 기획 문구와 준비 카드6개, 재검색 동작을 재사용합니다. 기사나 링크는 추가하지 않았습니다.

이 수정은 직접 입력한 출발지에 최대1회의 기존 Geocoding 호출을 추가합니다. 각 조회의 기존2.5초 제한을 유지하며 선택한 출발지에는 Geocoding을 중복 호출하지 않습니다. 새 키·API·클라우드 설정 변경은 없습니다.

실제 검증 스크립트 `apps/web/scripts/check-planme-global-trip.mjs` 실행 결과:

| 입력 | 실제 결과 |
| --- | --- |
| Google 후보 선택 LA → 부산 | 출발 미국, 목적지 부산광역시, 준비 화면 분기 |
| 직접 입력 LA → 부산 | 출발 미국, 목적지 부산, 준비 화면 분기 |
| 서울 → 도쿄 | 목적지 일본 중심 준비 화면 분기 |
| Seoul → 부산 | 준비 화면 판정 없음, 기존 국내 경로 유지 |
| 로스앤젤레스 → 도쿄 | 목적지 일본 중심 준비 화면 분기 |
| 존재하지 않는 출발지 → 부산 | 준비 화면 판정 없음 |
| 양쪽 직접 입력·키 미설정 | 준비 화면 판정 없음 |

```sh
node --env-file=apps/web/.env.local apps/web/scripts/check-planme-global-trip.mjs --confirm-external-api
```

실제 Google 응답으로 검증했으며 가짜 공급자 응답은 사용하지 않았습니다. Next.js 전체 빌드와 이번 변경 코드4개·스크립트의 ESLint가 통과했습니다. 감독 회사 Chrome에서 미국 LA 후보 선택+부산 직접입력+당일치기·자동차 검색이 준비 화면으로 진입했고, 출발 미국 배지·출발→목적지 부산·해외 출발 안내·6카드를 시각 확인했습니다. 부산이 해외로 표시되지 않았고 2번 독립 코드 검토도 통과했습니다. 국내 일정 전체 생성 성공을 새로 검증한 것은 아닙니다.

## 변경과 판단

- `apps/web/components/planme-search/PlanmePlaceInput.tsx`: 기존 일정 편집의 2글자/300ms/최대5개 상호작용을 적용한 MUI 자동완성. 장소명과 주소, Google Maps 표시, 모바일 목록, 입력 아래 로딩·빈결과·실패·제한 안내를 제공합니다. MUI9의 `params.slotProps.input` 및 `htmlInput`을 보존합니다.
- `apps/web/components/planme-search/PlanmeSearchHome.tsx`: 출발지·목적지 선택 상태와 숨김 placeId/sessionToken, 수정 시 선택 해제, 제출 후 토큰 재사용 방지. 기존 제출 잠금·기간·이동수단·재검색 동작을 유지합니다.
- `apps/web/lib/planme-places.ts`: 서버 전용 기존 키, 3초 제한, 명시적 필드 마스크, 검증된 국가와 유효 좌표만 수용. 해외 표시에는 서버 `displayName`, 출발지에는 공식 주소+이름을 사용합니다. `types`의 political 여부로 행정지역을 구분합니다. 주소+이름이 기존 100글자 계약을 넘으면 선택 재확인을 안내하며 임의 절단하지 않습니다.
- `apps/web/lib/planme-selected-destination.ts`: 국내 행정지역 목적지는 상위지역 주소, 국내 장소 목적지는 기존 TourAPI `resolveDestination`의 유일한 장소 결과와 Google 좌표를 확인한 뒤 공식 이름만 전달합니다. 주소를 보내면 기존 지역 우선 분기로 관광지가 사라지는 문제를 피합니다. 기존 거리 계산을 재사용하며 2,000m 이내 기준은 보수적인 데모 허용값이고 동일 장소의 절대 보증이 아닙니다. 실제 에버랜드의 공급자 좌표 차이는1,208m였습니다. 미지원·불일치·지역만 반환하는 경우는 선택 필드 오류로 처리합니다. 사전확인에는 최대5초와 기존 TourAPI 조회가 추가되며 V3 내부는 변경하지 않았습니다.
- `apps/web/app/planme-search-actions.ts`: 기존 입력 검증·생성 제한 후 선택한 양쪽 장소를 서버 확인합니다. 선택 검증 실패는 해당 필드 오류이며 해외로 추정하지 않습니다. 선택하지 않은 국내 입력은 원문 그대로입니다.
- `apps/web/app/api/places/autocomplete/route.ts`: 동일 출처 POST만 수용, 2~100글자·UUIDv4 검증, 본문 크기 확인, 캐시 금지, 제한 초과429와 공급자 실패503 안내. 기존 `/api/places/search`는 변경하지 않았습니다.
- `apps/web/lib/planme-search-rate-limit.ts`: 기존 Redis/로컬 메모리 저장소에 자동완성 전용 키와 한도를 추가했습니다. 감독 승인 데모 초기값은 세션30/분·200/일, 전체300/분·3000/일이며 Google 기준이나 확정 상품 정책이 아닙니다. 기존 일정 생성2/분·20/일 카운터와 분리합니다. 출처 검사는 인증이 아니며 전체 한도가 쿠키 재생성을 통한 호출 증가도 제한합니다.
- `apps/web/components/planme-search/PlanmeGlobalPreparation.tsx`: 실제 Details의 제3자 출처가 있을 때 표시합니다. 기존 준비 카드·스크롤 수정은 보존했습니다.

서버 IP 근접 편향을 피하기 위해 명시적인 전세계 사각형 `locationBias`를 적용했습니다. 실제 비교에서 기본 “파리”는 화성·오산 빵집5개였고, 전세계 범위에서는 프랑스 파리가 첫 후보였습니다. 한국어와 한국 지역 선호는 유지하고 도시 목록·국가 제한·POI 제외 필터는 추가하지 않았습니다. Google 순위가 항상 원하는 후보를 보장하지는 않으므로 주소를 보고 선택하거나 국가·도시를 구체적으로 입력할 수 있습니다.

## 공식 근거와 과금

- [Autocomplete(New)](https://developers.google.com/maps/documentation/places/web-service/place-autocomplete): 필드 마스크, 지역 선호, 기본 IP 편향과 명시적 위치 범위, 최대5개 후보.
- [세션 토큰](https://developers.google.com/maps/documentation/places/web-service/using-session-tokens): 출발지·목적지별 UUIDv4를 만들고 선택 후 제출의 Details에 같은 토큰을 사용합니다. 제출 후 동일 토큰을 다시 보내지 않습니다. 선택 없이 끝난 세션 및 재검증은 별도 호출 과금이 발생할 수 있습니다.
- [Place Details(New)](https://developers.google.com/maps/documentation/places/web-service/place-details): 최종 마스크는 `id,displayName,formattedAddress,types,addressComponents,location,attributions`. POI 이름을 보존하기 위한 `displayName`은 **Details Pro 등급**을 사용합니다. 기존 키로 실제 호출 가능함을 확인했으며 구매·계약·클라우드 설정 변경은 하지 않았습니다.
- [표시 정책](https://developers.google.com/maps/documentation/places/web-service/policies): 지도 없는 후보 목록에 Google Maps 표시, 번역 방지 및 가독성 유지, 응답의 제3자 출처 처리.
- [API 키 제한 권고](https://developers.google.com/maps/api-security-best-practices): 서버 키를 브라우저로 보내지 않습니다. 실제 콘솔의 IP/API 제한·할당량·청구 설정은 확인하거나 변경하지 않았습니다.
- [MUI Autocomplete](https://mui.com/material-ui/react-autocomplete/) 및 [MUI9 변경](https://mui.com/material-ui/migration/upgrade-to-v9/): 자유 입력과 후보 선택, 현재 입력 슬롯 전달 방식을 대조했습니다.

## 실제 검증

최종 국내 장소 보완 뒤 `npm run build` 통과: Next.js16.2.9 컴파일·타입 검사·페이지 생성 완료. 변경 코드8개와 검증 스크립트3개의 ESLint도 통과했습니다. 초기 MUI 입력 연결/타입 오류는 공식 슬롯 전달 방식으로 수정했습니다.

저장소 루트에서 재현합니다. 외부 API 스크립트는 실제 소량 유료 호출이며 키·토큰을 출력하지 않습니다.

```sh
node --env-file=apps/web/.env.local apps/web/scripts/check-planme-places.mjs --confirm-external-api
NODE_ENV=development node --experimental-transform-types apps/web/scripts/check-planme-autocomplete-limits.mjs
node --env-file=apps/web/.env.local --experimental-transform-types apps/web/scripts/check-planme-selected-destination.mjs --confirm-external-api
```

| 실제 조회 | 확인 결과 |
| --- | --- |
| 도쿄 | 후보5개, JP, 공식 이름 도쿄도 |
| 파리 | 후보5개, FR, 공식 이름 파리 |
| 서울 중구 | 후보5개, KR, 대한민국 서울특별시 중구 |
| 부산 중구 | 후보5개, KR, 첫 후보는 중구로5번길이며 부산광역시 상위지역 보존 |
| 에버랜드 | 후보5개, KR, 용인 주소 뒤 에버랜드 이름 보존 |
| 잘못된 placeId 형식 | 공급자 호출 전 거부 |

국내 실제 연결 검증: 에버랜드는 TourAPI `place.title=에버랜드`와 좌표 차이1,208m를 확인하고 목적지 `에버랜드`를 전달합니다. 경복궁은 현재 resolver가 null, 서울역은 지역 우선 해석으로 place가 없어 모두 선택 필드 오류로 차단됨을 확인했습니다. 관광지 이름 문자열만 남았다는 이유로 일정 연결 성공으로 판단하지 않았습니다. 에버랜드 전체 일정 생성과 경로 성공까지 실행한 검증은 아닙니다.

로컬 POST `/api/places/autocomplete`는 실제 Google 조회200/후보5개, 한 글자400, 다른 Origin403, no-store를 확인했습니다. 별도 프로세스의 실제 메모리 제한으로 세션·전체 분/일 한도와 일정 생성 카운터 분리를 검증했습니다. Redis 실서비스 한도 소진이나 Google 장애 응답을 인위적으로 만들지 않았습니다. Node 실행의 기존 모듈 형식/실험적 타입 변환 경고는 남아 있으나 검증 종료코드는0입니다.

작업자 Orca 브라우저에서 후보 목록, 입력 변경 즉시 placeId와 토큰 해제, 실제 없는 입력의 빈결과 안내를 확인했습니다. DOM 키 이벤트로 방향키 선택·Enter·Escape와 IME Enter의 기본동작 차단을 확인했습니다. 느린 공급자 응답 순서를 강제한 브라우저 검증은 하지 않았으며 AbortController와 응답 버전 검사를 코드에서 확인했습니다.

감독 회사 Chrome 검증: 도쿄 후보5개, ArrowDown+Enter 선택 시 조기 제출 없음, 서울역 마우스 선택 후 도쿄도 해외 준비 진입 성공. 모바일390×844 후보가 화면 안에 표시됨. 프랑스 파리 선택 후 나이로비로 수정하고 Escape 후 자유입력 제출 → 케냐 나이로비 준비 화면 성공, 재검색 시 출발지·기간·이동수단 유지.

최종 감독 검증: 전세계 범위 적용 후 파리가 첫 후보로 노출되고 없는 입력 안내가 표시됨. 서울식물원(강서구)을 국내 목적지로 선택해 제출하면 연결 실패 필드 오류를 표시하며 지역 일정으로 조용히 전환하지 않음.

국내 V3 내부는 수정하지 않았습니다. 이전 실제 부산 일정 생성은 후보180개 이후 `ROUTE_UNAVAILABLE`로 실패했으므로 국내 일정 전체 성공을 주장하지 않습니다. 이번 검증은 국내 후보 국가·행정지역 보존, 실제 TourAPI POI 연결 또는 명시적 거부, 직접 입력 계약 보존까지입니다. 실제 OS 한글 조합의 모든 입력기, 운영 프록시 Origin 정규화, Redis 운영 연결은 미확인입니다. 기존 스크립트의 tsx가 설치되지 않아 새 의존성 없이 Node의 로컬 TypeScript 모듈 해석으로 검증했습니다.

## 확인 경로

`http://localhost:3103/` — 출발지에 서울역 선택 → 목적지 도쿄/파리 후보 선택 → 기간·이동수단 선택 → 검색. 수정/직접 입력은 선택 후 다른 목적지로 바꾼 뒤 Escape와 검색으로 확인합니다. 빈결과는 `zxqv987654321없는도시`로 확인할 수 있습니다.

개발 서버는 별도 Orca 터미널 `term_f0bb330c-7872-4b69-888f-eeaef8dfd7cf`에서 유지 중입니다. 기존 해외 준비 화면과 다른 작업자 변경을 보존했으며 커밋·PR·배포는 하지 않았습니다.
