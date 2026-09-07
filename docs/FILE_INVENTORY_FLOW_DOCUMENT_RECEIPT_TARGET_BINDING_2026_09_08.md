# 파일 재고 FLOW 요청서류 영수증 대상 결속

기준일: 2026-09-08

## 문제

`receive_document` 완료 예약은 명령 영수증의 대상 요청 ID, 업로드 목적 `requested_document`, `file` 슬롯까지 확인했지만 실제 대상 요청의 `fileId`가 예약 파일을 가리키는지는 재고 증명에서 확인하지 않았다.

실패 우선 회귀에서는 영수증·감사·파일 원장을 그대로 둔 채 대상 요청의 `fileId`만 제거해도 파일이 정상 메타데이터 증명을 유지하고 R2 `head`까지 진행했다.

## 적용

- 파일 재고 중앙 대상 규칙에 `receive_document`를 추가했다.
- 영수증 `targetId`와 같은 요청이 정확히 한 건 존재하고 해당 요청의 `fileId`가 완료 예약의 `file_id`와 같을 때만 정상 증명을 인정한다.
- 요청 파일 연결 누락·변경 또는 영수증 대상 위조는 `inconsistent`·증명 없음·`unavailable`로 격리하고 R2 `head` 전에 503으로 닫는다.
- 명령 ID, 대상 요청 ID, 저장 키, 행위자 키, 지문, 객체 증명값은 재고 응답에 노출하지 않는다.
- 기존 FLOW payload·요청·파일을 자동 수정하거나 삭제하지 않는다. 손상 상태는 관리자 재고 증명만 보수적으로 격리한다.
- 기존 `receive_document` 명령의 앱·D1 대상 결속과 추가형 마이그레이션은 이미 적용돼 있어 새 마이그레이션은 만들지 않았다.

## 검증

- 수정 전 회귀: 대상 요청의 `fileId` 제거 뒤에도 정상 증명·R2 `head` 1회
- 파일 재고 집중 회귀: 29/29
- 전체 Node 회귀: 785/785
- 격리 workerd + 실제 D1/R2: 627개 검사
- 실제 격리 R2 요청서류 객체와 D1 ETag·SHA-256·예약·완료 원장으로 영수증 대상·요청 `fileId` 손상 및 복구 확인
- 추가형 마이그레이션 99개를 빈 D1에 두 번 적용
- 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 Worker 공개 화면 `/`, `/account`, `/account/setup`: 200 및 CSP·`nosniff`·`no-referrer`
- 비인증 `/api/state`, `/api/admin/file-inventory`, `/api/consulting-flow/synthetic-case`: 401 및 private/no-store·`nosniff`·`no-referrer`
- 실제 운영 쓰기, 메일 발송, 유료 AI 요청, 외부 네트워크 요청: 0건

기능 커밋은 `051f681` (`fix: bind flow document receipt target`)이다. GitHub `main` 직접 푸시와 Sites 소스 전송은 버전 334의 정확한 승인을 기다린다. 원격 기준 커밋은 `ee40a91b5de4ef8fed06245ba2b636e623773b0c`이다.

## 배포 후보

- 아카이브: `outputs/release/partner-hub-v334.tar.gz`
- 크기: 1,698,188바이트
- 항목: 244개
- 마이그레이션: 99개, 마지막 `0098_consulting_flow_save_transcript_target.sql`
- 금지 항목: `.git`, `node_modules`, `.wrangler`, `.env*` 0개
- 필수 Sites 산출물: `dist/.openai/hosting.json`, `dist/server/wrangler.json`, `dist/server/index.js`
- SHA-256: `B5E6A089E6563E0AF5866935320BF021AC1018DF463F78B35AEF75B070087FD3`

Sites 최신 저장 버전은 309이며 공개 운영본은 버전 107이다. 버전 334의 Sites 소스 전송·버전 저장·공개 배포에는 정확히 `버전 334 Sites 소스 전송 및 공개 운영 배포 승인`이 필요하다.

## 다음 감사

`record_contract` 영수증의 선택 회의 ID와 실제 계약의 `meetingId`·`signedFileId`가 완료 예약 파일에 정확히 결속되는지 점검한다.
