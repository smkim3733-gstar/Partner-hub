# 상담 FLOW 파일 원장 수명주기 무결성 경계

기준일: 2026-09-05

## 문제

상담 FLOW 파일은 소유 진행과 R2 저장 키를 `consulting_flow_file_owners`, 원본 메타데이터와 유입 증빙을 `consulting_flow_file_metadata`, R2 ETag·MIME 검증 증거를 `consulting_flow_file_object_integrity`에 보관한다. 모든 소비 경로가 이 원장과 FLOW payload를 대조했지만, D1 자체는 생성된 원장 행의 직접 수정과 삭제를 허용했다. 또한 원본 자료 제외 시 필요한 `source`에서 `source_archived`로의 목적 변경과 허용되지 않은 목적 변경을 저장소 계층에서 구분하지 않았다.

## 적용

- 파일 소유권 원장은 생성 뒤 모든 `UPDATE`와 `DELETE`를 거절한다.
- 객체 무결성 원장은 생성 뒤 모든 `UPDATE`와 `DELETE`를 거절한다.
- 메타데이터 원장은 파일 ID·원본 이름·MIME·크기·유입 파일 ID·원문 해시·검토 시각·검토자를 변경할 수 없다.
- 메타데이터 목적은 동일값 유지 또는 `source`에서 `source_archived`로의 단방향 전이만 허용한다. 보관된 자료를 다시 활성 원문으로 되돌리거나 다른 목적의 파일로 바꿀 수 없다.
- 메타데이터 원장 삭제를 거절해 payload만 남거나 원장만 사라지는 상태를 차단한다.
- `0025_consulting_flow_file_ledger_lifecycle.sql`과 런타임 테이블 준비에 동일한 여섯 개 트리거를 적용했다.
- 운영 `app/`·`lib/`에 세 원장의 직접 수정·삭제 SQL이 추가되면 정적 회귀검사가 실패한다. 정상 원문 보관 전이는 기존 원자적 `INSERT ... ON CONFLICT DO UPDATE` 경로와 D1 트리거를 함께 통과해야 한다.
- 손상 상태를 재현하는 테스트만 전용 fixture에서 삭제 트리거를 잠시 해제하고 `finally`에서 즉시 복구한다.

## 검증

- 실제 FLOW 명령으로 `source` 파일을 `source_archived`로 바꾸면 payload와 메타데이터 원장이 같은 커밋에서 함께 전진한다.
- 보관된 원문의 목적을 `source`로 되돌리는 직접 SQL은 거절된다.
- 소유 진행, 원본 파일명, 객체 MIME의 직접 변경과 세 원장 삭제가 각각 D1에서 거절된다.
- 26개 추가형 마이그레이션을 기존 FLOW 파일 원장이 있는 격리 D1에서 두 번 적용해도 기존 상태를 교체하지 않는다.
- Node 회귀 검사 626/626 통과
- 격리 workerd/D1/R2 검사 437/437 통과
- 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 운영 Worker `/`, `/account`, `/account/setup` HTTP 200과 CSP, `X-Frame-Options: DENY`, `nosniff`, `no-referrer` 확인
- 실제 운영 쓰기, 이메일 발송, 유료 AI 요청, 외부 요청 0건

## 저장·운영 경계

- 기능 커밋: `d4a191fa6e0232b37994be1df928edd77aeb3f06`
- 릴리스 보관본: `outputs/release/partner-hub-v175.tar.gz`
- 로컬 보관본 SHA-256: `535de6be986d5e7bb96c84020febc59d6c00c4901b8912ff58c58c51db7e87e9`
- 로컬 보관본 크기·구성: 1,629,542바이트, 200개 항목, 26개 마이그레이션
- Sites 저장 버전: 175 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_7629d192ef90819195aadb03d6f8d271`)
- 공개 운영본: 버전 107
- 버전 108~174는 버전 175로 대체하며 공개 배포하지 않는다.

버전 175 공개 배포에는 정확히 `버전 175 운영 배포 승인`이 필요하다. 다음 감사는 `consulting_flows` 진행 루트 행의 허용 revision 전이와 직접 변조·삭제 경계를 점검한다.
