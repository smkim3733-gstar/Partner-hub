# 포털 상태 저장 envelope 무결성 경계

기준일: 2026-09-05

## 문제

`portal_state`의 payload와 `updated_at`은 전체 운영 상태를 읽고 조건부 저장하는 기본 envelope다. 애플리케이션의 정상 쓰기는 객체를 JSON으로 직렬화하고 UTC 시각을 기록하지만 D1 직접 SQL은 손상 JSON, 배열·원시값 JSON 또는 잘못된 수정시각을 저장할 수 있었다. 이후 읽기는 실패 폐쇄하더라도 루트 행 자체가 사용할 수 없는 상태가 되는 저장소 계약 공백이 남아 있었다.

## 적용

- 신규·수정 payload는 유효한 JSON 객체일 때만 저장된다.
- 수정시각은 24자 UTC 밀리초 형식의 구성과 SQLite 날짜 판독을 모두 통과해야 한다.
- `0030_portal_state_storage_envelope.sql`과 런타임 테이블 준비에 같은 INSERT·UPDATE 트리거를 적용했다.
- ID 변경은 버전 179의 전용 신원 불변 트리거가 계속 담당하도록 UPDATE envelope 트리거를 기존 ID가 유지되는 경우에만 적용했다.
- 마이그레이션은 기존 payload나 수정시각을 검사·교체하지 않고 이후 쓰기만 보호한다.
- 정상 포털 CAS, 계정 가입·변경, 원본 회수, 테스트 초기 상태 저장 경로는 같은 JSON 객체·UTC 시각 계약을 유지한다.

## 검증

- 손상 JSON payload 직접 수정과 잘못된 수정시각 직접 수정이 `portal state update envelope is invalid`로 거절된다.
- 거절 뒤 기존 ID·payload·수정시각이 그대로 보존된다.
- 고정 ID·ID 불변·삭제 방지 트리거와 정상 CAS 저장 회귀검사가 함께 통과한다.
- 31개 추가형 마이그레이션을 기존 포털 상태가 있는 격리 D1에서 두 번 적용해도 기존 상태를 교체하지 않는다.
- Node 회귀 검사 633/633 통과
- 격리 workerd/D1/R2 검사 442/442 통과
- 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 운영 Worker `/`, `/account`, `/account/setup` HTTP 200과 CSP, `X-Frame-Options: DENY`, `nosniff`, `no-referrer` 확인
- 실제 운영 쓰기, 이메일 발송, 유료 AI 요청, 외부 요청 0건

## 저장·운영 경계

- 기능 커밋: `5d197a8c667f32bb5fafd368d54109c1e06bed19`
- 릴리스 보관본: `outputs/release/partner-hub-v180.tar.gz`
- 로컬 보관본 SHA-256: `469b9cbc75e012e930caf50cea29600a71bc253bdf1309860f351d0b7bc15b0c`
- 로컬 보관본 크기·구성: 1,632,253바이트, 205개 항목, 31개 마이그레이션
- Sites 저장 버전: 180 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_31f321dbdf7481919dbccb4519bceef8`)
- 공개 운영본: 버전 107
- 버전 108~179는 버전 180으로 대체하며 공개 배포하지 않는다.

버전 180 공개 배포에는 정확히 `버전 180 운영 배포 승인`이 필요하다. 다음 감사는 애플리케이션의 900,000바이트 포털 상태 상한을 D1의 UTF-8 payload 저장 경계에도 적용한다.
