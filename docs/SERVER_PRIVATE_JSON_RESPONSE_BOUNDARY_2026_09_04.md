# 서버 민감 JSON 응답 보안 경계 통합

## 목적

인증된 기업자료·신청 임시저장·상담 FLOW·원본 보관·회수·AI 진단 API의 성공과 실패 JSON이 브라우저나 중간 캐시에 남거나 다른 콘텐츠 형식으로 오인되지 않도록 하나의 비공개 응답 경계를 사용한다.

## 적용 범위

- 모든 `app/api` JSON 응답을 공용 `privateJsonResponse` 경계로 통합했다.
- 기업자료 업로드·다운로드 오류·삭제 오류, 신청 임시저장, 상담 FLOW 조회·저장·실행·사전점검·신청자료 검토, 대표 원본 보관·회수, AI 준비상태·Step 0 응답을 포함한다.
- 공통 경계는 `Cache-Control: private, no-store, max-age=0`, `Pragma: no-cache`, `Expires: 0`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`를 강제한다.
- 개별 경로의 HTTP 상태, `Retry-After`, `Set-Cookie`와 향후 필요한 작업별 헤더는 유지하되 호출자가 공통 보안 헤더를 약화할 수 없게 했다.

## 유지한 경계

인증·역할·권한·동일 출처·요청 크기·멱등성·revision/CAS·D1/R2 저장과 보관 정책, 외부 AI 호출 승인 조건은 변경하지 않았다. 파일·보고서 본문을 스트리밍하는 비-JSON 응답은 기존 `private, no-store`와 MIME 보호를 유지하며 이번 JSON 통합과 분리해 다음 감사 대상으로 남긴다.

## 재발 방지

API 라우트가 `Response.json`을 직접 다시 사용하지 못하도록 전체 `app/api` 소스를 검사한다. 공통 헤더를 공개 캐시·외부 참조·잘못된 MIME 값으로 덮어쓰려는 호출과 상태·작업별 헤더 보존도 단위검사로 고정했다.

## 검증 결과

- 대상 회귀검사 46개 통과
- 전체 자동 테스트 432개 통과
- 격리 workerd/D1/R2 검사 129개 통과
- TypeScript 타입검사, 전체 lint, 프로덕션 빌드 통과
- 로컬 Workers `/` HTTP 200, 익명 `/api/state` HTTP 401·보안 헤더 확인
- 격리검사 중 운영 쓰기, 메일, 유료 AI, 외부 요청 0건

2026-09-04 현재 자동 운영 반영 전 로컬 검증·커밋 단계다.
