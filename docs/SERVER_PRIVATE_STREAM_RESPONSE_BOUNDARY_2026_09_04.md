# 서버 민감 스트림·문서 응답 보안 경계 통합

## 목적

기업 원본파일, 상담 FLOW 첨부파일, 보고서 다운로드·인쇄 화면과 기업자료 삭제의 빈 응답이 JSON 응답과 같은 비공개 캐시·참조정보·MIME 보호 정책을 사용하도록 한다.

## 적용 범위

- 기업 원본과 상담 첨부 스트림은 기존 파일명·MIME·다운로드 헤더를 유지하면서 공용 `privateResponseHeaders`를 적용한다.
- 보고서 Markdown 다운로드와 nonce 기반 HTML 인쇄 화면은 기존 `Content-Disposition`·`Content-Security-Policy`를 유지하면서 같은 공용 경계를 적용한다.
- 기업자료 삭제의 모든 HTTP 204 경로도 공용 경계를 사용한다.
- 공통 경계는 `Cache-Control: private, no-store, max-age=0`, `Pragma: no-cache`, `Expires: 0`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`를 강제한다.

## 유지한 경계

파일 내용·이름·MIME·다운로드 방식, 보고서 본문·인쇄 CSP, 인증·권한 재확인, 삭제 tombstone, D1/R2 스키마와 보관 정책은 변경하지 않았다. 운영 자료를 읽거나 내려받지 않고 가상 데이터와 격리 R2로 검증했다.

## 재발 방지

API 라우트의 직접 `Cache-Control` 선언을 금지하고, `new Response`를 사용하는 스트림·문서·빈 응답이 공용 헤더 경계를 참조하는지 전체 소스 정적 검사로 고정했다.

## 검증 결과

- 대상 회귀검사 18개 통과
- 전체 자동 테스트 433개 통과
- 격리 workerd/D1/R2 검사 129개 통과
- TypeScript 타입검사, 전체 lint, 프로덕션 빌드 통과
- 로컬 Workers `/` HTTP 200, 익명 보고서 요청 HTTP 401·보안 헤더 확인
- 격리검사 중 운영 쓰기, 메일, 유료 AI, 외부 요청 0건

2026-09-04 자동 운영 승인 원칙에 따라 커밋 `82adb09`를 GitHub `main`과 공개 Sites 버전 84에 반영했다. D1 `DB`, R2 `AI_SOURCE_FILES`, 공개 범위를 유지했으며 운영 `/`, `/account`, `/account/setup`의 HTTP 200과 파일·첨부·보고서 대표 API의 익명 HTTP 401·공통 비공개 보안 헤더를 확인했다. 배포 결과는 `outputs/release/server-private-stream-response-boundary-deployment.json`을 기준으로 삼는다.
