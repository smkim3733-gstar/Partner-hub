# 빌드 도구와 운영 의존성 경계

기준일: 2026-09-04

## 변경 목적

`shadcn` CLI는 구성요소 생성과 CSS 빌드에 필요한 개발 도구이지만 운영 애플리케이션이 직접 실행하는 패키지는 아니다. 이를 운영 `dependencies`에 두면 `pnpm audit --prod`가 CLI의 MCP·Express 하위 경로에 포함된 `qs` 보통 위험 2건을 운영 의존성으로 계산했다.

## 반영 내용

- `shadcn@4.18.0`을 `dependencies`에서 `devDependencies`로 이동했다.
- 실제 화면 런타임 패키지 `@shadcn/react@0.3.0`은 `dependencies`에 유지했다.
- `app/globals.css`의 `shadcn/tailwind.css` 빌드 입력도 유지했다.
- 의존성 분류가 되돌아가지 않도록 전용 회귀검사를 추가했다.
- Windows의 CRLF 체크아웃에서도 서버 경로 경계 정적 검사가 동일하게 동작하도록 검사 입력만 LF로 정규화했다. 운영 코드는 변경하지 않았다.

## 보안 감사 결과

`pnpm audit --prod --audit-level moderate`에서 `qs` 보통 위험 2건이 제거됐다. 남은 항목은 `image-size@2.0.2` 높음 2건과 `esbuild@0.27.3` 낮음 1건이다.

`image-size`는 현재 배포된 `vinext`의 정적 메타데이터 이미지 빌드 경로에만 존재하며, 공인 수정 버전 `2.0.3`은 아직 npm에 배포되지 않았다. 현재 앱에는 해당 정적 메타데이터 이미지가 없고 사용자 업로드의 ICNS·JXL·HEIF·HEIC는 저장 전에 거절한다. `esbuild` 항목은 공개 운영 Worker가 아닌 Windows 개발 서버 경로다. 존재하지 않는 버전이나 검증되지 않은 강제 override는 적용하지 않았다.

## 검증

- 고정 lockfile 오프라인 설치: 통과
- Node 자동 검사: 463개 통과
- 격리 workerd/D1/R2 검사: 135개 통과
- 타입검사, 전체 lint, 변경 파일 형식검사, 프로덕션 빌드: 통과
- 격리 검사 중 운영 쓰기·메일·유료 AI·외부 요청: 0건

## 저장소와 운영 반영

- 기능 커밋: `8dfe8388dfaee4194d8087a51167ad73746655ab` (`fix: keep build tooling out of runtime deps`)
- GitHub `main`과 Sites 소스 저장소: 동일 커밋 반영
- Sites 저장 버전: 103 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_06a652e1fb74819184a0db6151cbf295`)
- 운영 배포: 성공 (`appgdep_6a9acbb1e88881918b6798729a462a71`)
- 공개 URL: `https://keve-partner-hub.smkim3733.chatgpt.site`

운영 `/`, `/account`, `/account/setup`은 HTTP 200을 반환했다. 보호 API `/api/state`, `/api/admin/file-inventory`, `/api/consulting-flow/test-case`는 익명 요청에 HTTP 401을 반환했고 `Cache-Control: no-store, max-age=0, private`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`를 유지했다. 공개 범위와 D1 `DB`, R2 `AI_SOURCE_FILES` 연결은 변경하지 않았다.
