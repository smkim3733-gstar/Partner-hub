# 상담 FLOW AI 작업 전이시각 무결성

기준일: 2026-09-06

## 문제·적용

버전 204는 작업 상태와 필드 조합을 보호했지만, 앱 커밋을 우회한 직접 SQL은 시간선 안의 과거 시각을 새 처리 시작·완료시각으로 넣을 수 있었다. 그러면 실제 FLOW revision 시각과 작업 처리시각이 달라져 잠금 만료와 처리 감사의 기준이 흔들린다. 이제 애플리케이션 커밋과 추가형 `0046` D1 트리거가 전이시각을 권위 수정시각에 결속한다.

## 전이 경계

- `queued → processing`의 `startedAt`은 해당 FLOW revision의 `updatedAt/updated_at`과 정확히 같아야 한다.
- `processing → complete`의 `completedAt`도 해당 FLOW revision의 권위 수정시각과 정확히 같아야 한다.
- 시간 형식과 시작·관측·완료 순서, 성공 증거·완료 감사 결속은 기존 검사와 함께 적용한다.
- 정상 작업 선점과 성공 완료 경로는 기존처럼 서버가 만든 단일 UTC 시각을 공유한다.
- 기존 완료 작업의 과거 시각을 재작성하거나 운영 자료를 자동 이관하지 않는다.

## 검증·저장

- Node 651/651, 격리 workerd/D1/R2 464/464, 타입, lint, 포맷, 프로덕션 빌드 통과
- 로컬 Worker `/`, `/account`, `/account/setup` HTTP 200과 CSP·`DENY`·`nosniff`·`no-referrer` 통과
- 실제 운영 쓰기·이메일·유료 AI·외부 요청 0건
- 기능 커밋: `f9d36252c54f61a520b3a03b5fe4786f426382b5`
- 마이그레이션: `drizzle/0046_consulting_flow_ai_job_transition_timestamp.sql`
- 릴리스: `outputs/release/partner-hub-v205.tar.gz`
- SHA-256: `1188dd2c3029bfff2a3c1383c2f2f18544d6f6035ca43257039fe3332592c85d`
- 크기·구성: 1,647,750바이트, 220개 항목, 47개 마이그레이션
- Sites 저장 버전: 205 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_b43f6d1885a481919d965cc6a6b8e5ce`)
- 공개 운영본: 버전 107

버전 108–204는 버전 205로 대체해 공개하지 않는다. 버전 205 공개 배포에는 정확히 `버전 205 운영 배포 승인`이 필요하다. 다음 감사는 증거 없는 처리 실패·보류와 명시적 재시도 상태 전이에 필수 감사기록이 함께 추가되는지 애플리케이션과 D1에서 확인한다.
