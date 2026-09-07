# 파일 재고 FLOW 보고서 영수증 대상 결속

기준일: 2026-09-08

## 문제

`save_report` 업로드는 FLOW 명령 영수증·감사기록의 동작, 예약 목적 `report`, 슬롯 `file`이 모두 맞고 파일 자체의 소유·메타데이터·객체 증명 원장이 정상이어도 실제 저장 보고서가 그 파일을 가리키는지 파일 재고에서 다시 확인하지 않았다.

수정 전 회귀에서는 `${commandId}-report`의 `fileId`만 제거한 손상 FLOW가 계속 정상 증명을 유지하고 현재 R2 객체 `head`까지 1회 진행했다. 저장 시점 D1 트리거는 새 명령 효과를 보호하지만, 이후 합성 손상이나 과거 데이터 이상을 읽는 재고 경계에도 같은 대상 결속이 필요했다.

## 적용

- 새 형식 `save_report` 영수증은 같은 FLOW payload에 정확히 한 건의 `${commandId}-report`가 있어야 한다.
- 해당 보고서의 `fileId`는 완료 업로드 예약의 `file_id`와 정확히 같아야 한다.
- 이 대상 규칙은 기존 영수증-감사 동작, 명령별 목적·슬롯, 신청자료 출처 증빙 규칙과 함께 평가한다.
- 동일한 중앙 SQL 조각을 파일 재고 목록·증명 적용 현황·개별 현재 R2 확인이 공유한다.
- 어긋난 파일은 `inconsistent`·증명 없음·`unavailable`로 격리하고 R2 `head` 전에 503으로 닫는다.
- 명령 ID, 저장 키, 행위자 키, 지문, 객체 증명값은 응답에 노출하지 않는다.
- 의미 필드가 없던 기존 완료 영수증의 레거시 호환은 유지한다.

스키마와 마이그레이션은 바꾸지 않았다. 기존 추가형 98개를 그대로 두고 읽기 검증을 강화했다.

## 검증

- 수정 전 회귀: 실제 보고서 첨부 연결만 제거한 상태에서 R2 `head` 1회 진행
- 파일 재고 집중 회귀: 26/26
- 전체 Node 회귀: 781/781
- 격리 workerd + 실제 D1/R2: 600개 검사
- 추가형 마이그레이션 98개를 빈 D1에 두 번 적용
- 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 Worker 공개 화면 `/`, `/account`, `/account/setup`: 200 및 CSP·`nosniff`·`no-referrer`
- 비인증 `/api/state`, `/api/admin/file-inventory`, `/api/consulting-flow/synthetic-case`: 401 및 private/no-store·`nosniff`·`no-referrer`
- 실제 운영 쓰기, 메일 발송, 유료 AI 요청, 외부 네트워크 요청: 0건

기능 커밋은 `86ee366` (`fix: bind flow report receipt target`)이다. GitHub `main` 직접 푸시와 Sites 소스 전송은 버전 331의 정확한 승인을 기다린다. 원격 기준 커밋은 `ee40a91b5de4ef8fed06245ba2b636e623773b0c`이다.

## 배포 후보

- 아카이브: `outputs/release/partner-hub-v331.tar.gz`
- 크기: 1,695,950바이트
- 항목: 243개
- 마이그레이션: 98개, 마지막 `0097_r2_sha256_integrity.sql`
- 금지 항목: `.git`, `node_modules`, `.wrangler`, `.env*` 0개
- 필수 Sites 산출물: `dist/.openai/hosting.json`, `dist/server/wrangler.json`, `dist/server/index.js`
- SHA-256: `054E8751BC98478BFB003678DC174D2E4F8111219E6E160F1C8629D1E1B8AAE9`

Sites 최신 저장 버전은 309이며 공개 운영본은 버전 107이다. 버전 331의 Sites 소스 전송·버전 저장·공개 배포에는 정확히 `버전 331 Sites 소스 전송 및 공개 운영 배포 승인`이 필요하다.

## 다음 감사

`save_recording` 영수증의 동작·목적·슬롯이 모두 맞아도 실제 녹취 기록의 `fileId` 또는 `audioFileId`가 해당 슬롯의 업로드 파일을 가리키지 않는 손상 상태를 파일 재고가 정상 증명으로 오인하지 않는지 점검한다.
