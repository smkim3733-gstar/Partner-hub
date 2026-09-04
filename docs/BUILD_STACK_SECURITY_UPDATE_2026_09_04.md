# 빌드 스택 잔여 취약성 제거

기준일: 2026-09-04

## 변경 목적

선행 감사에서 운영 입력 경로와 분리해 관리하던 `image-size@2.0.2` 높음 위험 2건과 Windows 개발 서버의 `esbuild@0.27.3` 낮음 위험 1건을 의존성 트리에서 제거한다. 검증되지 않은 강제 override나 공급망 출시연령 예외는 사용하지 않는다.

## 반영 내용

- `vinext`를 `1.0.0-beta.9`로 갱신해 `image-size` 하위 의존성을 제거했다.
- Vite 계열을 호환되는 묶음으로 갱신했다: `vite@8.2.2`, `@vitejs/plugin-react@6.1.1`, `@vitejs/plugin-rsc@0.5.34`.
- Cloudflare 개발·빌드 계열을 검증 시점의 출시연령 정책을 통과한 `@cloudflare/vite-plugin@1.53.0`, `wrangler@4.127.0`, `@cloudflare/workers-types@5.20260826.1`로 갱신했다.
- 새 Workers 타입의 `Uint8Array` 반환 계약에 맞춰 비밀번호 해시·토큰의 16진수 변환을 명시적인 `Buffer.from` 경계로 통일했다. 저장 문자열과 scrypt 매개변수는 바꾸지 않았다.
- Miniflare 5의 명시적 이전 옵션 변환기를 격리 테스트 하네스에 적용했다. 운영 Worker 코드는 변경하지 않았다.
- JSON 모듈 import attribute를 명시해 새 Vite 빌드 경고를 제거했다.
- lockfile에 `image-size` 또는 `esbuild@0.27.3`이 다시 들어오면 실패하는 회귀검사를 추가했다.

## 검증 결과

- `pnpm audit --prod`: 알려진 취약성 0건
- `pnpm peers check`: 문제 0건
- 공급망 출시연령 검사: 통과, 예외 목록 0개
- Node 자동 검사: 465개 통과
- 격리 `workerd`/D1/R2 검사: 135개 통과
- 타입검사, 전체 lint, 프로덕션 빌드: 통과
- 로컬 프로덕션 화면 `/`, `/account`, `/account/setup`: HTTP 200과 화면 보안 헤더 확인
- 보호 API `/api/state`, `/api/admin/file-inventory`, `/api/consulting-flow/test-case`: 익명 HTTP 401과 비공개 캐시·참조정보·MIME 경계 확인
- 격리 검사 중 운영 쓰기·메일·유료 AI·외부 요청: 0건

## 운영 경계

기능, D1/R2 스키마, 인증·권한, 파일 보관·삭제 정책은 변경하지 않았다. 새 패키지는 기존 Sites 프로젝트와 D1 `DB`, R2 `AI_SOURCE_FILES` 연결로만 검증한다. 공개 운영본은 별도 명시 승인 전까지 버전 105를 유지한다.

## 저장소와 Sites 상태

- 기능 커밋: `debbef1522f041653ce2ce1ef8b9bf8d5ffb09e9` (`fix: update secure build stack`)
- GitHub `main`과 Sites 소스 저장소: 기능 커밋 반영 완료
- Sites 저장 버전: 106 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_27746f11d2b48191bfb8510b9c59d72b`)
- 현재 공개 운영본: 버전 105 (`appgdep_6a9ad7b533b88191bea822ed2dd10a11`)
- 버전 106 공개 배포: 사용자 명시 승인 대기
