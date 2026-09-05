# 상담 FLOW 루트 행 수명주기 무결성 경계

기준일: 2026-09-05

## 문제

`consulting_flows`는 상담 진행 ID, 담당 계정 ID, revision, 전체 JSON payload와 수정시각을 보관하는 운영 루트 행이다. 애플리케이션의 `commitFlow`는 진행·담당 신원 변경을 거절하고 조회 경로는 D1 권위 열과 payload 불일치를 격리하지만, D1 자체는 진행·담당 열의 직접 변경과 루트 행 삭제를 허용했다. 정상 운영 코드에는 재배정이나 삭제 경로가 없으므로 최초 귀속과 운영 이력을 저장소에서 보존할 필요가 있었다.

## 적용

- 루트 행의 `case_id`와 `partner_id`가 생성 뒤 달라지는 모든 직접 `UPDATE`를 D1 트리거로 거절한다.
- 루트 행의 모든 직접 `DELETE`를 D1 트리거로 거절한다.
- `0026_consulting_flow_root_lifecycle.sql`과 런타임 테이블 준비에 동일한 두 트리거를 적용했다.
- 운영 `app/`·`lib/` 전체를 검사해 루트 삭제 또는 진행·담당 열 재배정 SQL이 없음을 확인했다.
- 정적 회귀검사가 운영 코드의 루트 삭제와 신원 열 수정 재도입을 차단한다.
- 테스트의 격리 데이터 초기화만 전용 fixture에서 삭제 트리거를 잠시 해제하고 `finally`에서 즉시 복구한다.
- 정상 `commitFlow`의 revision 증가, payload·수정시각 저장, 권한 재확인과 원자적 파일 원장 저장은 그대로 유지한다.

## 검증

- 정상 저장된 FLOW의 진행 ID와 담당 계정 ID 직접 변경이 `consulting flow identity is immutable` 오류로 거절된다.
- 같은 루트 행의 직접 삭제가 `consulting flow root is durable` 오류로 거절된다.
- 거절 뒤 원래 진행을 다시 읽으면 전체 payload와 신원·revision이 보존된다.
- 27개 추가형 마이그레이션을 기존 FLOW 행과 파일 원장이 있는 격리 D1에서 두 번 적용해도 기존 상태를 교체하지 않는다.
- Node 회귀 검사 628/628 통과
- 격리 workerd/D1/R2 검사 438/438 통과
- 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 운영 Worker `/`, `/account`, `/account/setup` HTTP 200과 CSP, `X-Frame-Options: DENY`, `nosniff`, `no-referrer` 확인
- 실제 운영 쓰기, 이메일 발송, 유료 AI 요청, 외부 요청 0건

## 저장·운영 경계

- 기능 커밋: `8fa9e4d957b929e4c19172ddc135dc32b6f3dbed`
- 릴리스 보관본: `outputs/release/partner-hub-v176.tar.gz`
- 로컬 보관본 SHA-256: `9b6625f2954122483f49252d5d1d3cf704ae71ae2586849ded6f8893f3f8c860`
- 로컬 보관본 크기·구성: 1,630,109바이트, 201개 항목, 27개 마이그레이션
- Sites 저장 버전: 176 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_08aec5de34e081919e599452163a59ef`)
- 공개 운영본: 버전 107
- 버전 108~175는 버전 176으로 대체하며 공개 배포하지 않는다.

버전 176 공개 배포에는 정확히 `버전 176 운영 배포 승인`이 필요하다. 다음 감사는 루트 행 revision·수정시각·payload 권위 필드가 하나의 정상 전이로 함께 바뀌도록 D1 경계를 보완한다.
