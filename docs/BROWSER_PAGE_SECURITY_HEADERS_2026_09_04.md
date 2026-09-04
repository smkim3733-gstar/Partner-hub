# 브라우저 화면 보안 헤더 경계

기준일: 2026-09-04

## 확인한 문제

공개 운영 사이트의 `/`, `/account`, `/account/setup` 응답에는 `Content-Security-Policy`, `X-Frame-Options`, `Permissions-Policy`, `Referrer-Policy`, `X-Content-Type-Options`가 없었다. API와 보고서 응답은 별도 보안 경계를 갖고 있었지만 로그인·계정 설정·포털 화면을 외부 사이트의 iframe에 넣는 클릭재킹을 애플리케이션이 직접 차단하지 못했다.

## 반영한 경계

현재 vinext/Next 규약인 `proxy.ts`를 사용해 실제 브라우저 화면 세 경로에 다음 헤더를 적용했다.

- `Content-Security-Policy: frame-ancestors 'none'; base-uri 'none'; object-src 'none'`
- `X-Frame-Options: DENY`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- `X-Permitted-Cross-Domain-Policies: none`

초기에는 `next.config.ts`의 정적 헤더 규칙을 검토했지만 로컬 운영 Worker의 동적 SSR 응답에 헤더가 적용되지 않는 것을 확인했다. 설정 존재만 검사하지 않고 실제 응답을 기준으로 `proxy.ts` 경계로 교체했다. matcher는 `/`와 `/account/:path*`로 제한해 API의 비공개 응답 정책과 보고서의 더 강한 nonce CSP를 덮어쓰지 않는다.

## 검증 결과

- Node 자동 검사: 464개 통과
- 격리 workerd/D1/R2 검사: 135개 통과
- 타입검사, 전체 lint, 변경 파일 형식검사, 프로덕션 빌드: 통과
- 로컬 운영 Worker: `/`, `/account`, `/account/setup` HTTP 200과 CSP·프레임 차단·권한 제한 헤더 확인
- `/api/state`: 익명 HTTP 401 유지
- 격리 검사 중 운영 쓰기·메일·유료 AI·외부 요청: 0건

## 저장소와 배포 상태

- 기능 커밋: `3b41b21b485eecf771eebeb119a5a8bb5654e9be` (`fix: protect browser pages with security headers`)
- GitHub `main`과 Sites 소스 저장소: 동일 커밋 반영
- Sites 저장 버전: 104 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_3e903f7857dc81919346322305667979`)
- 현재 공개 운영본: 버전 103
- 버전 104 배포: 플랫폼 안전 심사가 이번 전역 브라우저 보안 헤더 변경에 대한 명시적 승인을 요구해 시작하지 않음

버전 104 승인 뒤 기존 공개 범위와 D1 `DB`, R2 `AI_SOURCE_FILES` 연결을 유지해 배포하고, 공개 화면 세 곳의 새 헤더와 보호 API의 기존 401·비공개 보안 헤더를 다시 확인한다.
