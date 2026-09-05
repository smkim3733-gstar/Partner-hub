# 상담 FLOW AI 작업 상태 전이 감사 무결성

기준일: 2026-09-06

## 문제·적용

작업 증거와 기존 감사기록은 보존됐지만, 앱 커밋이나 D1 직접 수정을 통해 증거 없는 `processing → blocked/failed` 또는 명시적 재시도를 새 감사기록 없이 만들 수 있었다. 한 재시도 감사로 여러 작업을 동시에 대기 상태로 바꾸는 것도 구분되지 않았다. 이제 애플리케이션과 추가형 `0047` D1 트리거가 상태 전이와 새 감사기록을 원자 결속한다.

## 감사·보존 경계

- `processing → blocked/failed/complete`마다 작업 ID와 revision 시각에 결속된 새 `ai_result` 감사기록 하나가 필요하다.
- `blocked/failed/processing → queued` 전이 건수와 같은 revision에 추가된 `retry_job/save_transcript` 감사기록 수가 정확히 같아야 한다.
- 기존 감사기록은 순서가 유지된 접두부로 보존하고 새 감사기록만 전이 증거로 인정한다.
- 한 감사기록으로 여러 작업 재시도를 덮거나 과거 감사기록을 재사용할 수 없다.
- 실패한 4차 작업의 전사문 보완 시 현재 실패 증거는 AI 활성 상태에서 이력 끝으로 이동한다. AI 비활성 상태에서는 실패 작업과 현재 증거를 그대로 두고 재승인 후 재시도를 요구한다.
- 기존 행과 운영 자료를 변경하지 않는 추가형 트리거만 설치한다.

## 검증·저장

- Node 652/652, 격리 workerd/D1/R2 466/466, 타입, lint, 포맷, 프로덕션 빌드 통과
- 로컬 Worker `/`, `/account`, `/account/setup` HTTP 200과 CSP·`DENY`·`nosniff`·`no-referrer` 통과
- 실제 운영 쓰기·이메일·유료 AI·외부 요청 0건
- 기능 커밋: `ea6cece0491bc62b35f37a54ae60449fc9a01357`
- 마이그레이션: `drizzle/0047_consulting_flow_ai_job_transition_audit.sql`
- 릴리스: `outputs/release/partner-hub-v206.tar.gz`
- SHA-256: `b967558441d1c9ffd25f4851f18be1ce1f0bf9f3352f2f2fe773521828dca121`
- 크기·구성: 1,647,852바이트, 221개 항목, 48개 마이그레이션
- Sites 저장 버전: 206 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_3aaf5c5f26548191bf2ca5c70fc709f9`)
- 공개 운영본: 버전 107

버전 108–205는 버전 206으로 대체해 공개하지 않는다. 버전 206 공개 배포에는 정확히 `버전 206 운영 배포 승인`이 필요하다. 다음 감사는 새 AI 작업의 생성시각, 단계별 근거 신원과 생성 명령 감사를 해당 FLOW revision에 결속한다.
