# 협업신청 임시저장 수명주기 무결성 경계

기준일: 2026-09-05

## 문제

`application_drafts`는 계정별 작성 중 신청서를 revision 기반으로 저장하고, 삭제 뒤에도 tombstone을 남겨 오래된 창의 초안 부활을 막는다. API는 소유 계정과 revision을 검사했지만 D1 직접 SQL은 소유자를 바꾸거나 revision을 건너뛰고, 삭제 tombstone을 제거하거나 초안 ID·payload를 허용되지 않은 순서로 바꿀 수 있었다.

## 적용

- 최초 행은 revision 1, 허용 형식의 초안 ID, JSON 객체 payload, UTC 밀리초 수정시각일 때만 삽입된다.
- `owner_key`는 생성 뒤 변경할 수 없다.
- 모든 수정은 revision이 정확히 1 증가하고 payload가 실제로 바뀌어야 한다.
- 작성 중에는 같은 초안 ID로 저장하거나 같은 ID를 payload 없는 tombstone으로 전환할 수 있다.
- tombstone에서는 다른 새 초안 ID와 JSON 객체 payload로만 작성을 다시 시작할 수 있다.
- 루트 행 직접 삭제를 차단해 clear revision과 오래된 요청 차단 증거를 보존한다.
- `0028_application_draft_transition_envelope.sql`과 런타임 테이블 준비에 동일한 네 트리거를 적용했다.
- 운영 코드의 초안 삽입·수정 소유자를 `app/api/application-draft/route.ts` 한 곳으로 고정하고 삭제·소유자 변경 SQL 재도입을 정적 검사한다.

## 검증

- revision 건너뛰기, 소유자 재배정, 루트 삭제와 revision 0 신규 삽입이 각각 D1에서 거절된다.
- 거절 뒤 원래 소유자·revision·초안 ID·payload·수정시각이 보존된다.
- 정상 임시저장, 동일 저장 재시도, 두 창 경쟁, clear tombstone, 새 초안 재시작, 접수 응답 유실과 최종 제출 경로가 통과한다.
- 긴 날짜 `GLOB` 표현은 실제 workerd의 패턴 복잡도 한계에서 실패해 `length`·`substr`·`julianday` 조합으로 교체했다.
- 29개 추가형 마이그레이션을 기존 상태가 있는 격리 D1에서 두 번 적용해도 기존 행을 교체하지 않는다.
- Node 회귀 검사 631/631 통과
- 격리 workerd/D1/R2 검사 440/440 통과
- 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 운영 Worker `/`, `/account`, `/account/setup` HTTP 200과 CSP, `X-Frame-Options: DENY`, `nosniff`, `no-referrer` 확인
- 실제 운영 쓰기, 이메일 발송, 유료 AI 요청, 외부 요청 0건

## 저장·운영 경계

- 기능 커밋: `f5fc52c37d045430375d10371218bfd5b1c0c189`
- 릴리스 보관본: `outputs/release/partner-hub-v178.tar.gz`
- 로컬 보관본 SHA-256: `05c6df4652601163af51c54058a80df0c490fb3918f56742c4cd4141ae22bfcc`
- 로컬 보관본 크기·구성: 1,630,920바이트, 203개 항목, 29개 마이그레이션
- Sites 저장 버전: 178 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_d3bd29e1ec608191a84ac943d4860819`)
- 공개 운영본: 버전 107
- 버전 108~177은 버전 178로 대체하며 공개 배포하지 않는다.

버전 178 공개 배포에는 정확히 `버전 178 운영 배포 승인`이 필요하다. 다음 감사는 전체 운영 상태를 보관하는 `portal_state` 루트 행의 고정 ID와 내구성 삭제 경계를 D1에서 강제한다.
