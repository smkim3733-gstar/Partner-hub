# 포털 상태 루트 행 수명주기 무결성 경계

기준일: 2026-09-05

## 문제

`portal_state`의 `keve-partner-hub` 행은 회원·진행·업무·일정·기업자료 연결 등 전체 운영 상태의 루트다. 애플리케이션은 고정 ID만 읽고 조건부 저장하지만 D1 직접 SQL은 다른 루트 ID를 추가하거나 기존 ID를 바꾸고, 단일 운영 루트를 삭제할 수 있었다. 삭제되면 다음 저장이 빈 상태에서 시작할 수 있어 기존 상태의 CAS·권한·감사 검증을 우회할 위험이 있었다.

## 적용

- `portal_state` 신규 행은 고정 ID `keve-partner-hub`만 허용한다.
- 생성된 루트 행의 ID 변경을 D1 트리거로 거절한다.
- 루트 행의 모든 직접 삭제를 D1 트리거로 거절한다.
- `0029_portal_state_root_lifecycle.sql`과 런타임 테이블 준비에 같은 세 트리거를 적용했다.
- 기존 루트 payload와 수정시각은 마이그레이션에서 읽거나 다시 쓰지 않는다.
- 운영 코드 전체를 검사해 루트 삭제·ID 재배정 SQL이 없음을 확인했다.
- 정상 쓰기 소유자는 포털 CAS 저장, 계정 변경의 원자적 상태 저장, 원본 회수의 조건부 저장 세 경로로 고정했다.

## 검증

- 다른 ID의 루트 삽입이 `portal state identity is fixed`로 거절된다.
- 기존 ID 변경이 `portal state identity is immutable`로 거절된다.
- 기존 루트 삭제가 `portal state root is durable`로 거절된다.
- 세 거절 뒤 ID·payload·수정시각이 보존되고 정상 `mutatePortalState` 저장이 계속 동작한다.
- 가입·인증·원본 회수·전체 상태 CAS와 동시 저장 회귀검사가 통과한다.
- 30개 추가형 마이그레이션을 기존 포털 상태가 있는 격리 D1에서 두 번 적용해도 기존 상태를 교체하지 않는다.
- Node 회귀 검사 633/633 통과
- 격리 workerd/D1/R2 검사 441/441 통과
- 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 운영 Worker `/`, `/account`, `/account/setup` HTTP 200과 CSP, `X-Frame-Options: DENY`, `nosniff`, `no-referrer` 확인
- 실제 운영 쓰기, 이메일 발송, 유료 AI 요청, 외부 요청 0건

## 저장·운영 경계

- 기능 커밋: `df95dbe73510341533157d4da085fc146d70fa89`
- 릴리스 보관본: `outputs/release/partner-hub-v179.tar.gz`
- 로컬 보관본 SHA-256: `837408acd28e1c982d4fc0b82f3be177e8fbe73eb96fd9249b9861c899c3f669`
- 로컬 보관본 크기·구성: 1,631,489바이트, 204개 항목, 30개 마이그레이션
- Sites 저장 버전: 179 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_10d11ab341dc819191e10997125d30a2`)
- 공개 운영본: 버전 107
- 버전 108~178은 버전 179로 대체하며 공개 배포하지 않는다.

버전 179 공개 배포에는 정확히 `버전 179 운영 배포 승인`이 필요하다. 다음 감사는 `portal_state`의 payload가 JSON 객체이고 수정시각이 정상 UTC 형식인 저장 envelope를 D1에서 강제한다.
