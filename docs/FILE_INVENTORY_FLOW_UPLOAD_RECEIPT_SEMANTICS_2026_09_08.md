# 파일 재고 FLOW 업로드 영수증 목적·슬롯 결속

기준일: 2026-09-08

## 문제

완료 FLOW 첨부의 명령 영수증과 같은 명령 감사기록의 `action`을 함께 같은 거짓값으로 바꾸면 두 원장은 서로 일치하지만 실제 업로드 예약의 `purpose`·`slot`과 어긋날 수 있었다.

수정 전 회귀에서는 보고서 업로드의 두 `action`을 `save_source`로 함께 바꿔도 파일 재고의 정상 증명을 유지해 개별 확인이 R2 객체 `head`까지 1회 진행했다. 서로 일치하는 두 기록만으로 실제 업로드 의미까지 신뢰한 공백이었다.

## 적용

FLOW 업로드 명령별 허용 목적과 슬롯을 하나의 권위 규칙으로 정의하고, 업로드 정책과 파일 재고 검증이 함께 사용하도록 했다.

- `save_source`, `import_intake_source`: `source`·`file`
- `save_report`: `report`·`file`
- `save_recording`: `recording`·`file` 또는 `audio`
- `save_transcript`: `transcript`·`file`
- `receive_document`: `requested_document`·`file`
- `record_contract`: `signed_contract`·`file`
- 새 형식 영수증은 감사기록과의 일치뿐 아니라 예약 `purpose`·`slot`과 명령 규칙의 일치도 요구한다.
- 어긋난 파일은 `inconsistent`·증명 없음·`unavailable`로 격리하고 개별 확인을 R2 `head` 전에 503으로 닫는다.
- 영수증 의미 필드가 모두 없던 기존 파일은 레거시 호환을 유지한다.
- 위조 동작, 명령 ID, 저장 키, 지문과 내부 원장값은 응답에 노출하지 않는다.

스키마와 마이그레이션은 바꾸지 않았다. 기존 추가형 98개를 그대로 두고 읽기 검증과 정책 재사용을 강화했다.

## 검증

- 수정 전 회귀: 동작 두 원장을 함께 위조한 상태에서 R2 `head` 1회 진행
- 파일 재고·업로드 정책 집중 회귀: 29/29
- 재고·응답·복구·FLOW 업로드 관련 회귀: 92/92
- 전체 Node 회귀: 780/780
- 격리 workerd + 실제 D1/R2: 592개 검사
- 추가형 마이그레이션 98개를 빈 D1에 두 번 적용
- 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 Worker 공개 화면 `/`, `/account`, `/account/setup`: 200 및 `frame-ancestors 'none'`, `DENY`, `nosniff`, `no-referrer`
- 비인증 `/api/state`, `/api/admin/file-inventory`, `/api/consulting-flow/test-case`: 401 및 private/no-store·`nosniff`·`no-referrer`
- 실제 운영 쓰기, 메일 발송, 유료 AI 요청, 외부 네트워크 요청: 0건

기능 커밋은 `09d7adb` (`fix: bind flow upload receipt semantics`)이다. GitHub `main` 직접 푸시는 앱 자동 보안 검토가 이번 변경의 명시 승인을 요구해 보류했다. 원격 기준 커밋은 `ee40a91b5de4ef8fed06245ba2b636e623773b0c`이다.

## 배포 후보

- 아카이브: `outputs/release/partner-hub-v329.tar.gz`
- 크기: 1,696,234바이트
- 항목: 243개
- 마이그레이션: 98개, 마지막 `0097_r2_sha256_integrity.sql`
- 금지 항목: `.git`, `node_modules`, `.wrangler`, `.env*` 0개
- SHA-256: `583ACF828E24329E902BF1A88B751297AEF280CDBED686585DD0927B2594DB8F`

Sites 최신 저장 버전은 309이며 공개 운영본은 버전 107이다. 버전 329의 Sites 소스 전송·버전 저장·공개 배포에는 정확히 `버전 329 Sites 소스 전송 및 공개 운영 배포 승인`이 필요하다.

## 다음 감사

같은 `source`·`file` 규칙을 공유하는 `save_source`와 `import_intake_source`를 서로 바꿔도 신청 원본 출처 증빙의 존재 여부와 어긋난 상태를 파일 재고가 정상 증명으로 오인하지 않는지 점검한다.
