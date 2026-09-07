# 파일 재고 FLOW 전사문 영수증 대상 결속

기준일: 2026-09-08

## 문제

`save_transcript` 명령은 사용자가 선택한 최신 녹취를 수정하지만 기존 완료 영수증에는 그 녹취 ID가 별도 증거로 남지 않았다. 파일 재고도 명령 동작·예약 목적 `transcript`·`file` 슬롯만 확인하고 실제 대상 녹취의 `transcriptFileId`가 완료 예약 파일을 가리키는지 다시 확인하지 않았다.

실패 우선 회귀에서는 실제 녹취의 `transcriptFileId`를 제거해도 파일이 정상 증명을 유지하고 R2 `head`까지 진행했다. 영수증 대상 ID가 없으므로 선택 대상 바꿔치기를 저장 결과만으로 독립 확인할 수도 없었다.

## 적용

- `flowCommandReceipt`가 새 `save_transcript` 영수증에 명령의 `recordingId`를 `targetId`로 보존한다.
- 앱 커밋 검사는 `targetId`가 실제 최신 녹취 ID와 정확히 같아야 저장을 허용한다.
- 추가형 `0098_consulting_flow_save_transcript_target.sql`은 새 전사문 영수증의 대상 ID를 필수화하고 직전·현재 최신 녹취에 함께 결속한다. 기존 영수증 대상 이력 불변 경계도 유지한다.
- 파일 재고 중앙 대상 규칙은 명령 ID에서 새 대상을 파생하는 보고서·녹취 등록과 영수증 `targetId`로 기존 대상을 선택하는 전사문 보완을 구분한다.
- `save_transcript` 완료 예약은 영수증 대상 녹취가 정확히 한 건이고 그 `transcriptFileId`가 `upload.file_id`와 같을 때만 정상 증명을 인정한다.
- 대상 ID 누락·바꿔치기 또는 `transcriptFileId` 손상 파일은 `inconsistent`·증명 없음·`unavailable`로 격리하고 R2 `head` 전에 503으로 닫는다.
- 명령 ID, 대상 녹취 ID, 저장 키, 행위자 키, 지문, 객체 증명값은 재고 응답에 노출하지 않는다.
- 기존 FLOW payload와 파일을 자동 수정하거나 삭제하지 않는다. 표시 행위자·동작이 있는 구형 `save_transcript` 영수증에 대상 증거가 없으면 관리자 재고 증명만 보수적으로 격리한다.

## 검증

- 수정 전 회귀: 대상 녹취의 `transcriptFileId` 제거 뒤에도 정상 증명·R2 `head` 1회
- `flowCommandReceipt`가 선택 녹취 ID를 보존하고 앱·D1이 대상 누락·바꿔치기를 거절
- 파일 재고 집중 회귀: 28/28
- 전체 Node 회귀: 784/784
- 격리 workerd + 실제 D1/R2: 619개 검사
- 실제 격리 R2 전사문 객체와 D1 ETag·SHA-256·예약·완료 원장으로 영수증 대상·`transcriptFileId` 손상 및 복구 확인
- 추가형 마이그레이션 99개를 빈 D1에 두 번 적용
- 런타임 D1 트리거와 `0098` 마이그레이션 SQL의 정규화된 전체 문장 일치 확인
- 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 Worker 공개 화면 `/`, `/account`, `/account/setup`: 200 및 CSP·`nosniff`·`no-referrer`
- 비인증 `/api/state`, `/api/admin/file-inventory`, `/api/consulting-flow/synthetic-case`: 401 및 private/no-store·`nosniff`·`no-referrer`
- 실제 운영 쓰기, 메일 발송, 유료 AI 요청, 외부 네트워크 요청: 0건

기능 커밋은 `01182e6` (`fix: bind flow transcript receipt target`)이다. GitHub `main` 직접 푸시와 Sites 소스 전송은 버전 333의 정확한 승인을 기다린다. 원격 기준 커밋은 `ee40a91b5de4ef8fed06245ba2b636e623773b0c`이다.

## 배포 후보

- 아카이브: `outputs/release/partner-hub-v333.tar.gz`
- 크기: 1,698,228바이트
- 항목: 244개
- 마이그레이션: 99개, 마지막 `0098_consulting_flow_save_transcript_target.sql`
- 금지 항목: `.git`, `node_modules`, `.wrangler`, `.env*` 0개
- 필수 Sites 산출물: `dist/.openai/hosting.json`, `dist/server/wrangler.json`, `dist/server/index.js`
- SHA-256: `F09CCA54F36BB325C47467BFE3A475709063861B70AB2DAB279498DDB4CBE6A6`

Sites 최신 저장 버전은 309이며 공개 운영본은 버전 107이다. 버전 333의 Sites 소스 전송·버전 저장·공개 배포에는 정확히 `버전 333 Sites 소스 전송 및 공개 운영 배포 승인`이 필요하다.

## 다음 감사

`receive_document` 영수증의 대상 요청 ID·목적 `requested_document`·`file` 슬롯이 맞아도 실제 요청의 `fileId`가 해당 업로드 파일을 가리키지 않는 손상 상태를 파일 재고가 정상 증명으로 오인하지 않는지 점검한다.
