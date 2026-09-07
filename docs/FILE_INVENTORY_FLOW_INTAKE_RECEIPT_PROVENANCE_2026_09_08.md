# 파일 재고 FLOW 신청자료 영수증 출처 결속

기준일: 2026-09-08

## 문제

수동 근거자료 저장 `save_source`와 신청자료 불러오기 `import_intake_source`는 모두 `source` 목적과 `file` 슬롯을 사용한다. 완료 영수증과 감사기록의 `action`을 함께 둘 중 다른 값으로 바꾸면 목적·슬롯 검사를 통과하면서 실제 신청 원본 출처 증빙과 어긋날 수 있었다.

수정 전 회귀에서는 신청 원본 증빙이 전혀 없는 수동 근거자료의 두 `action`을 `import_intake_source`로 함께 바꿔도 파일 재고가 정상 증명을 유지해 R2 객체 `head`까지 1회 진행했다.

## 적용

FLOW 업로드 명령 권위 규칙에 신청 원본 출처 증빙 모드를 추가했다.

- `import_intake_source`는 예약 원장의 `intake_file_id`, `intake_source_hash`, `source_reviewed_at`, `source_reviewed_by`가 모두 존재해야 한다.
- `save_source`와 나머지 직접 업로드 명령은 네 출처 필드가 모두 없어야 한다.
- 이 규칙은 기존 명령별 `purpose`·`slot` 규칙과 함께 파일 재고 목록·증명 현황·개별 현재 R2 확인에 공통 적용한다.
- 수동 저장을 신청자료 불러오기로 바꾸는 방향과 신청자료 불러오기를 수동 저장으로 바꾸는 방향을 모두 차단한다.
- 어긋난 파일은 `inconsistent`·증명 없음·`unavailable`로 격리하고 R2 `head` 전에 503으로 닫는다.
- 영수증 의미 필드가 모두 없던 기존 파일은 레거시 호환을 유지한다.
- 신청 원본 ID·해시·검토 정보, 명령 ID, 저장 키와 지문은 응답에 노출하지 않는다.

스키마와 마이그레이션은 바꾸지 않았다. 기존 추가형 98개를 그대로 두고 읽기 검증을 강화했다.

## 검증

- 수정 전 회귀: 출처 증빙 없는 수동 자료를 신청자료 동작으로 위조한 상태에서 R2 `head` 1회 진행
- 파일 재고 단위 회귀: 25/25
- 파일 재고·업로드 정책 집중 회귀: 29/29
- 재고·응답·복구·FLOW 업로드 관련 회귀: 92/92
- 전체 Node 회귀: 780/780
- 격리 workerd + 실제 D1/R2: 597개 검사
- 추가형 마이그레이션 98개를 빈 D1에 두 번 적용
- 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 Worker 공개 화면 `/`, `/account`, `/account/setup`: 200 및 `frame-ancestors 'none'`, `DENY`, `nosniff`, `no-referrer`
- 비인증 `/api/state`, `/api/admin/file-inventory`, `/api/consulting-flow/test-case`: 401 및 private/no-store·`nosniff`·`no-referrer`
- 실제 운영 쓰기, 메일 발송, 유료 AI 요청, 외부 네트워크 요청: 0건

기능 커밋은 `6e5605f` (`fix: bind flow intake receipt provenance`)이다. GitHub `main` 직접 푸시는 앱 자동 보안 검토가 이번 변경의 명시 승인을 요구해 보류했다. 원격 기준 커밋은 `ee40a91b5de4ef8fed06245ba2b636e623773b0c`이다.

## 배포 후보

- 아카이브: `outputs/release/partner-hub-v330.tar.gz`
- 크기: 1,695,972바이트
- 항목: 243개
- 마이그레이션: 98개, 마지막 `0097_r2_sha256_integrity.sql`
- 금지 항목: `.git`, `node_modules`, `.wrangler`, `.env*` 0개
- SHA-256: `4EA3A5C960BA7C5A0CF048D2C187298B9172A65169581A469C356A8CC63720F5`

Sites 최신 저장 버전은 309이며 공개 운영본은 버전 107이다. 버전 330의 Sites 소스 전송·버전 저장·공개 배포에는 정확히 `버전 330 Sites 소스 전송 및 공개 운영 배포 승인`이 필요하다.

## 다음 감사

`save_report` 영수증의 동작·목적·슬롯이 모두 맞아도 실제 보고서의 `fileId`가 해당 업로드 파일을 가리키지 않는 손상 상태를 파일 재고가 정상 증명으로 오인하지 않는지 점검한다.
