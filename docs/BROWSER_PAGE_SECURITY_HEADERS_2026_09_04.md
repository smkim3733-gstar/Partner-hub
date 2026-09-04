# 브라우저 화면 보안 헤더 경계

기준일: 2026-09-04

## 확인한 문제

공개 운영 사이트의 `/`, `/account`, `/account/setup` 응답에는 `Content-Security-Policy`, `X-Frame-Options`, `Permissions-Policy`, `Referrer-Policy`, `X-Content-Type-Options`가 없었다. API와 보고서 응답은 별도 보안 경계를 갖고 있었지만 로그인·계정 설정·포털 화면을 외부 사이트의 iframe에 넣는 클릭재킹을 애플리케이션이 직접 차단하지 못했다.

## 반영한 경계

현재 vinext/Next 규약인 `proxy.ts`를 사용해 Worker가 생성하는 브라우저 화면 세 경로에 다음 헤더를 적용했다. 운영 배포 점검에서 정적 HTML은 Cloudflare 자산 계층이 Worker보다 먼저 응답할 수 있음을 확인해 `public/_headers`에도 같은 경계를 추가했다. 이 규칙은 정적 화면 전체에 적용하고, 내용 해시가 붙은 `/_next/static/*`의 장기 캐시는 별도 규칙으로 유지한다.

- `Content-Security-Policy: frame-ancestors 'none'; base-uri 'none'; object-src 'none'`
- `X-Frame-Options: DENY`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- `X-Permitted-Cross-Domain-Policies: none`

초기에는 `next.config.ts`의 정적 헤더 규칙을 검토했지만 로컬 운영 Worker의 동적 SSR 응답에 헤더가 적용되지 않는 것을 확인했다. 설정 존재만 검사하지 않고 실제 응답을 기준으로 `proxy.ts` 경계로 교체했다. matcher는 `/`와 `/account/:path*`로 제한해 API의 비공개 응답 정책과 보고서의 더 강한 nonce CSP를 덮어쓰지 않는다. `public/_headers`는 Cloudflare가 직접 제공하는 정적 자산 응답에만 적용되므로 Worker API 응답의 정책을 변경하지 않는다.

## 검증 결과

- Node 자동 검사: 464개 통과
- 격리 workerd/D1/R2 검사: 135개 통과
- 타입검사, 전체 lint, 변경 파일 형식검사, 프로덕션 빌드: 통과
- 로컬 운영 Worker: `/`, `/account`, `/account/setup` HTTP 200과 CSP·프레임 차단·권한 제한 헤더 확인
- 빌드 결과 `dist/client/_headers`: 정적 화면 보안 헤더 규칙 1개와 해시 자산 장기 캐시 규칙 1개 확인
- `/api/state`: 익명 HTTP 401 유지
- 격리 검사 중 운영 쓰기·메일·유료 AI·외부 요청: 0건

## 저장소와 배포 상태

- Worker 화면 기능 커밋: `3b41b21b485eecf771eebeb119a5a8bb5654e9be` (`fix: protect browser pages with security headers`)
- 정적 자산 보완 커밋: `44808687b4b98ae9b097fdabd2456e793a44af96` (`fix: secure static page responses`)
- GitHub `main`과 Sites 소스 저장소: 보완 커밋까지 반영
- 버전 104 배포: `appgdep_6a9ad4b896d08191a7854d79d24ec0e7`
- 버전 104 운영 점검: `/`, `/account`, `/account/setup` HTTP 200과 보호 API 3곳의 익명 HTTP 401 확인. 캐시 우회 화면은 새 헤더가 있었지만 기본 `/`와 `/account/setup`의 정적 자산 응답에는 헤더가 없어 보완함
- Sites 저장 버전 105: `appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_1164854357a48191b8e1e01e8eec6fd1`, 소스 `44808687b4b98ae9b097fdabd2456e793a44af96`
- 현재 공개 운영본: 버전 105, 배포 `appgdep_6a9ad7b533b88191bea822ed2dd10a11`
- 버전 105 운영 점검: 캐시 우회 없이 `/`, `/account`, `/account/setup` HTTP 200과 여섯 가지 화면 보안 헤더 확인. 보호 API 3곳은 익명 HTTP 401과 `private, no-store, max-age=0`, 참조정보 차단, MIME 오인 방지 헤더 유지

버전 105는 기존 공개 범위와 D1 `DB`, R2 `AI_SOURCE_FILES` 연결을 유지해 배포했다. 운영 점검은 조회만 수행했고 고객 데이터·원본·메일·유료 AI를 변경하거나 실행하지 않았다.
