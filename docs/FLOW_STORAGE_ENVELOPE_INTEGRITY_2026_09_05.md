# 상담 FLOW 저장 행·payload 무결성 경계

기준일: 2026-09-05

## 확인한 문제

`consulting_flows`는 진행 ID, 담당 계정 ID와 revision을 D1 열과 JSON payload에 함께 저장한다. 기존 읽기 경로는 payload만 파싱해 그 안의 값을 권한 확인과 진행 투영에 사용했다.

D1 행의 `partner_id`와 payload의 `partnerId`가 다르면 payload에 적힌 다른 계정이 진행을 열 수 있었다. `case_id`·`revision` 불일치도 감지하지 않았고 손상 JSON은 저장 데이터 오류가 아닌 요청 형식 오류 또는 일반 서버 오류로 처리될 수 있었다.

## 적용한 경계

- 상세 조회는 D1의 `case_id`·`partner_id`·`revision`과 payload를 함께 읽는다.
- JSON이 일반 객체이고 schema version이 1인지 확인한 뒤 진행 ID·담당 계정 ID·revision이 D1 열과 정확히 같은지 검증한다.
- URL로 요청한 진행 ID와 D1 행·payload의 진행 ID가 모두 같은지 권한 판단 전에 확인한다.
- 대시보드는 기존처럼 SQLite 안에서 보고서·녹취 내용을 축소해 민감한 전체 payload를 메모리에 올리지 않는다. 축소 결과에도 같은 행·payload 무결성 검증을 적용한다.
- 손상 JSON과 식별값·revision 불일치는 HTTP 503과 관리자 복구 안내로 격리한다. 다른 계정에 제공하거나 자동 수정·삭제하지 않는다.
- 기존 D1/R2 스키마, 정상 FLOW 명령, 권한, 보관·삭제 정책은 변경하지 않았다.

## 검증

- 수정 전 재현: D1 담당 열은 원래 계정인 채 payload 담당 ID만 다른 계정으로 바꾸면 그 계정의 조회가 HTTP 200으로 성공했다.
- 수정 후: 담당 ID 불일치는 접근권한 판단 전에 HTTP 503으로 차단한다.
- 진행 ID·revision 불일치와 손상 JSON을 상세 조회에서 모두 같은 복구 경계로 차단한다.
- 손상 JSON은 대시보드 SQLite 투영에서도 누락하거나 일반 오류로 바꾸지 않고 HTTP 503으로 격리한다.
- 격리 Worker의 실제 D1 경로에서 상세 ACL과 관리자 대시보드를 모두 차단하고 원래 payload 복구 뒤 정상 조회가 재개된다.
- Node 자동 테스트 565/565 통과.
- 격리 workerd+D1+R2 검사 357/357 통과.
- 타입검사, 전체 lint, 프로덕션 빌드 통과.
- 로컬 프로덕션 `/`, `/account`, `/account/setup` HTTP 200과 CSP·`nosniff`·`no-referrer` 확인.
- 실제 운영 쓰기, 메일 발송, 유료 AI 요청, 외부 요청 0건.

## 반영 상태

- 기능 커밋: `c3b622247278a9175fdb2152691a41b223fea9a8`
- Sites 저장 버전: 142 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_6b17858082e48191a5af5c5edd36432f`)
- Sites 저장 산출물: 157개 파일, 4,413,440바이트, `sha256:b22611db12c9e5163d6116321056fe56ee5ed0a7b44d0508e6c67e371860fccb`
- GitHub `main`과 Sites 소스: 동일 기능 커밋 반영
- 공개 운영본: 버전 107 유지

버전 108~141은 버전 142로 대체하며 공개 배포하지 않는다. 버전 142 공개 배포는 정확히 `버전 142 운영 배포 승인`이라는 사용자 명시 승인 뒤 진행한다.

## 다음 감사

`commitFlow`가 저장 전 진행 ID·담당 ID 불변, revision 정확히 1 증가, D1 `updated_at`과 payload `updatedAt` 일치를 강제하는지 확인한다. 잘못된 내부 상태 전이는 D1에 손상 행을 만든 뒤 읽기 경계에서 발견되도록 두지 않고 쓰기 전에 차단한다.
