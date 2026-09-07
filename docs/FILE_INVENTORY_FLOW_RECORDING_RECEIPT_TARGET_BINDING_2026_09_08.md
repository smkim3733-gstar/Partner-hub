# 파일 재고 FLOW 녹취 영수증 대상 결속

기준일: 2026-09-08

## 문제

`save_recording` 업로드는 명령 영수증·감사기록의 동작, 예약 목적 `recording`, 슬롯이 모두 맞고 파일 원장이 정상이어도 실제 명령 기반 녹취가 각 업로드 파일을 가리키는지 파일 재고에서 다시 확인하지 않았다.

수정 전 회귀에서는 `file` 슬롯의 `recording.fileId` 또는 `audio` 슬롯의 `recording.audioFileId`만 제거해도 두 파일의 정상 증명이 유지되고 현재 R2 객체 확인까지 진행했다. 저장과 완료 영수증 생성 시점의 D1 트리거 보호에 더해 이후 합성 손상·과거 데이터 이상을 읽는 재고 경계에도 슬롯별 대상 결속이 필요했다.

## 적용

- 업로드 명령 대상 규칙을 중앙 정책표로 분리했다.
- `save_report`는 기존처럼 `${commandId}-report.fileId`와 `upload.file_id`를 결속한다.
- `save_recording`의 `file` 슬롯은 `${commandId}-recording.fileId`와 `upload.file_id`가 같아야 한다.
- `save_recording`의 `audio` 슬롯은 같은 녹취의 `audioFileId`와 `upload.file_id`가 같아야 한다.
- 같은 명령의 두 슬롯 중 한 대상만 손상되면 해당 파일만 `inconsistent`·증명 없음·`unavailable`로 격리하고 다른 정상 슬롯은 유지한다.
- 목록·증명 적용 현황·개별 현재 R2 확인이 같은 중앙 SQL을 사용하며 손상 파일은 R2 `head` 전에 503으로 닫는다.
- 명령 ID, 저장 키, 행위자 키, 지문, 객체 증명값은 응답에 노출하지 않는다.
- 의미 필드가 없던 기존 완료 영수증의 레거시 호환은 유지한다.

스키마와 마이그레이션은 바꾸지 않았다. 기존 추가형 98개를 그대로 두고 읽기 검증을 강화했다.

## 검증

- 수정 전 회귀: `fileId`·`audioFileId`를 각각 제거해도 증명 두 건 유지
- 파일 재고 집중 회귀: 27/27
- 전체 Node 회귀: 782/782
- 격리 workerd + 실제 D1/R2: 609개 검사
- 실제 격리 R2 텍스트·음성 객체와 D1 ETag·SHA-256·예약·완료 원장으로 두 슬롯 손상/복구 확인
- 추가형 마이그레이션 98개를 빈 D1에 두 번 적용
- 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 Worker 공개 화면 `/`, `/account`, `/account/setup`: 200 및 CSP·`nosniff`·`no-referrer`
- 비인증 `/api/state`, `/api/admin/file-inventory`, `/api/consulting-flow/synthetic-case`: 401 및 private/no-store·`nosniff`·`no-referrer`
- 실제 운영 쓰기, 메일 발송, 유료 AI 요청, 외부 네트워크 요청: 0건

기능 커밋은 `63cf9b4` (`fix: bind flow recording receipt targets`)이다. GitHub `main` 직접 푸시와 Sites 소스 전송은 버전 332의 정확한 승인을 기다린다. 원격 기준 커밋은 `ee40a91b5de4ef8fed06245ba2b636e623773b0c`이다.

## 배포 후보

- 아카이브: `outputs/release/partner-hub-v332.tar.gz`
- 크기: 1,696,581바이트
- 항목: 243개
- 마이그레이션: 98개, 마지막 `0097_r2_sha256_integrity.sql`
- 금지 항목: `.git`, `node_modules`, `.wrangler`, `.env*` 0개
- 필수 Sites 산출물: `dist/.openai/hosting.json`, `dist/server/wrangler.json`, `dist/server/index.js`
- SHA-256: `3806A64B0A3B6CF6509886326321701740FBE9942DF3CE32EA1ED741CB5F2215`

Sites 최신 저장 버전은 309이며 공개 운영본은 버전 107이다. 버전 332의 Sites 소스 전송·버전 저장·공개 배포에는 정확히 `버전 332 Sites 소스 전송 및 공개 운영 배포 승인`이 필요하다.

## 다음 감사

`save_transcript` 영수증의 목적·슬롯과 대상 녹취 ID가 맞아도 실제 대상 녹취의 `transcriptFileId`가 해당 업로드 파일을 가리키지 않는 손상 상태를 파일 재고가 정상 증명으로 오인하지 않는지 점검한다.
