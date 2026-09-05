# 상담 FLOW 명령 상태 효과 무결성

기준일: 2026-09-06

## 문제·적용

새 명령의 멱등 영수증과 감사기록이 같은 action 이름을 가져도, 그 action이 실제 업무 상태 변화를 만들었는지는 별도로 증명하지 않았다. 영수증과 감사 action을 함께 바꾸면 구조상 정상인 명령 근거가 실제 변화와 무관하게 남을 수 있었다.

이제 상담 FLOW가 지원하는 21개 명령을 핵심 상태 효과에 결속한다. 예를 들어 `save_report`는 보고서, `confirm_analysis`는 공동분석 확인, `confirm_payment`는 입금 기록, `start_aftercare`는 사후관리 상태가 실제로 달라져야 한다. 알려지지 않은 action이나 선언한 상태 효과가 없는 명령은 저장하지 않는다.

## 강제 경계

- 애플리케이션 저장 전 새 명령마다 불변 영수증의 action과 이전·다음 FLOW 핵심 상태를 대조한다.
- 추가형 `0058` D1 트리거가 최초 루트 삽입과 후속 갱신의 동일 조건을 강제해 앱 우회 직접 SQL도 차단한다.
- `save_source`처럼 본문 또는 첨부 중 하나가 바뀔 수 있는 명령은 둘 중 실제 변화 하나를 요구한다.
- AI 결과 revision처럼 새 사용자 명령 ID가 없는 내부 작업 전이는 기존 AI 수명주기·증거·감사 트리거가 계속 담당한다.
- 기존 명령·영수증·감사기록은 다시 쓰거나 자동 보정하지 않는다.

## 검증·저장

- Node 664/664, 격리 workerd/D1/R2 483/483, 타입, lint, 포맷, 프로덕션 빌드 통과
- 로컬 Worker `/`, `/account`, `/account/setup` HTTP 200과 CSP·`DENY`·`nosniff`·`no-referrer` 통과
- 실제 운영 쓰기·이메일·유료 AI·외부 요청 0건
- 기능 커밋: `b7f41138ed63c1a0a8ee341b7e28b44e73a48dc2`
- 마이그레이션: `drizzle/0058_consulting_flow_command_effect.sql`
- 릴리스: `outputs/release/partner-hub-v217.tar.gz`
- SHA-256: `a813cf9f5b5f87a6b0fc26cffbea7949e58752989a1b66cc609e871773237a54`
- 크기·구성: 1,655,094바이트, 232개 항목, 59개 마이그레이션
- Sites 저장 버전: 217 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_fce556a508e08191b831f6d5ec9ee2ce`)
- 공개 운영본: 버전 107

공개 운영 교체는 Sites 안전 게이트가 요구하는 정확한 v217 승인이 필요해 수행하지 않았다. 다음 감사는 정상 action 효과와 함께 다른 업무 상태를 끼워 바꾸는 복합 변조를 막도록 명령별 허용 변경 범위를 좁힌다.
