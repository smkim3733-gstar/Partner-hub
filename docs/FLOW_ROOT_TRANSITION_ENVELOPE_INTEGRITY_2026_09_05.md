# 상담 FLOW 루트 전이 envelope 무결성 경계

기준일: 2026-09-05

## 문제

`consulting_flows`는 진행·담당 계정·revision·수정시각을 권위 열에, 전체 상담 상태를 JSON payload에 함께 저장한다. 애플리케이션은 정상 저장에서 revision을 한 단계 올리고 조회 때 두 표현을 대조했지만, D1 직접 SQL은 payload만 바꾸거나 revision을 건너뛰고 권위 열과 JSON이 다른 신규 행을 만들 수 있었다. 손상 상태는 조회에서 격리되더라도 저장소가 불완전한 전이를 받아들이는 공백이 남아 있었다.

## 적용

- 신규 루트 행은 유효한 JSON 객체와 0 이상의 정수 revision을 요구한다.
- `case_id`, `partner_id`, `revision`, `updated_at` 권위 열이 payload의 `caseId`, `partnerId`, `revision`, `updatedAt`과 각각 정확히 일치해야 삽입된다.
- 기존 루트 행은 신원이 그대로인 상태에서 revision이 정확히 1 증가하고 네 권위 필드와 payload가 함께 일치할 때만 수정된다.
- `0027_consulting_flow_transition_envelope.sql`과 런타임 테이블 준비에 같은 삽입·전이 트리거를 적용했다.
- 운영 `app/`·`lib/` 전체에서 루트 저장 SQL의 단일 소유자가 `lib/consulting-flow-store.ts`임을 정적 회귀검사로 고정했다.
- 손상 읽기 회귀검사는 전용 fixture가 전이 트리거를 잠시 해제하고 `finally`에서 즉시 복구한다.
- 버전 176의 진행·담당 신원 불변과 루트 삭제 차단은 그대로 유지한다.

## 검증

- payload만 바꾸는 직접 수정과 revision을 두 단계 건너뛰는 수정이 `consulting flow transition envelope is invalid`로 거절된다.
- 다른 진행의 payload를 넣는 직접 삽입이 `consulting flow insert envelope is invalid`로 거절된다.
- 거절 뒤 원래 revision·payload·수정시각과 정상 읽기 결과가 보존된다.
- 정상 FLOW 생성·명령 저장·파일 원장·복구·지표 경로가 새 D1 계약을 통과한다.
- 28개 추가형 마이그레이션을 기존 FLOW 행과 파일 원장이 있는 격리 D1에서 두 번 적용해도 기존 상태를 교체하지 않는다.
- Node 회귀 검사 629/629 통과
- 격리 workerd/D1/R2 검사 439/439 통과
- 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 운영 Worker `/`, `/account`, `/account/setup` HTTP 200과 CSP, `X-Frame-Options: DENY`, `nosniff`, `no-referrer` 확인
- 실제 운영 쓰기, 이메일 발송, 유료 AI 요청, 외부 요청 0건

## 저장·운영 경계

- 기능 커밋: `a6162bf2e9741b0202d204084829111e7cd16b28`
- 릴리스 보관본: `outputs/release/partner-hub-v177.tar.gz`
- 로컬 보관본 SHA-256: `60158e2b5dd34edd61f6b454e2ef6d3106872f902e50aa28f404ef610c1caf57`
- 로컬 보관본 크기·구성: 1,630,502바이트, 202개 항목, 28개 마이그레이션
- Sites 저장 버전: 177 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_de3950ac414481919e6f142a70e54609`)
- 공개 운영본: 버전 107
- 버전 108~176은 버전 177로 대체하며 공개 배포하지 않는다.

버전 177 공개 배포에는 정확히 `버전 177 운영 배포 승인`이 필요하다. 다음 감사는 `application_drafts`의 소유자·초안 ID·revision·payload·수정시각 전이가 하나의 정상 D1 envelope로만 저장되는지 확인한다.
