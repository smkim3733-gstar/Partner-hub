# 상담 FLOW AI 작업 수명주기 전이 무결성

기준일: 2026-09-06

## 문제·적용

기존 AI 작업과 증거·감사기록의 보존 경계는 있었지만, 증거가 없는 작업은 후속 FLOW revision에서 신원 필드를 바꾸거나 허용되지 않은 상태로 도약하고 수명주기 필드를 다시 쓸 수 있었다. 이제 애플리케이션 커밋 검사와 추가형 `0045` D1 트리거가 같은 작업 수명주기 전이를 강제한다.

## 전이 경계

- 작업 단계, 근거 녹취·보고서 ID와 생성시각은 생성 후 바꿀 수 없다.
- `queued`는 `processing/blocked`, `blocked/failed/processing`은 명시적 재시도로 `queued`, `processing`은 `blocked/failed/complete`로만 이동한다.
- `complete` 작업은 되돌리거나 완료시각·보고서·성공 증거를 다시 쓸 수 없다.
- 대기·처리·보류·실패·완료 상태마다 허용되는 시작시각, 완료시각, 보고서, 성공·실패 증거 조합을 전이 시점에 검사한다.
- 전사문 보완으로 막힌 작업을 다시 대기시키는 정상 경로는 이전 처리 잠금시각을 제거한다.
- 기존 행과 운영 자료를 변경하지 않는 추가형 트리거만 설치한다.

## 검증·저장

- Node 651/651, 격리 workerd/D1/R2 462/462, 타입, lint, 포맷, 프로덕션 빌드 통과
- 로컬 Worker `/`, `/account`, `/account/setup` HTTP 200과 CSP·`DENY`·`nosniff`·`no-referrer` 통과
- 실제 운영 쓰기·이메일·유료 AI·외부 요청 0건
- 기능 커밋: `27099de818d002406630113da149ae5e1fe6b44f`
- 마이그레이션: `drizzle/0045_consulting_flow_ai_job_lifecycle.sql`
- 릴리스: `outputs/release/partner-hub-v204.tar.gz`
- SHA-256: `f6295769c02329ccc05d7ac0ed87c8cea7e25d3d94bc6afaaee82a455f1ce58d`
- 크기·구성: 1,647,711바이트, 220개 항목, 46개 마이그레이션
- Sites 저장 버전: 204 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_55c60f2f014c8191a3d97ad0d4b7b4dc`)
- 공개 운영본: 버전 107

버전 108–203은 버전 204로 대체해 공개하지 않는다. 버전 204 공개 배포에는 정확히 `버전 204 운영 배포 승인`이 필요하다. 다음 감사는 작업 시작·완료시각이 각 FLOW revision의 권위 수정시각과 일치하도록 애플리케이션과 D1 전이를 결속한다.
