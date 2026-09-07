# 파일 재고 FLOW 영수증 감사시각 결속

기준일: 2026-09-08

## 문제

파일 재고는 표시 행위자·동작이 있는 현대 FLOW 업로드 영수증을 같은 명령 ID의 감사기록과 결속했지만 감사기록 `at`이 완료 예약과 파일의 권위 생성시각과 같은지는 확인하지 않았다.

실패 우선 회귀에서는 영수증·감사의 행위자와 동작, 예약·파일 원장을 그대로 둔 채 감사시각만 1초 바꿔도 파일이 정상 메타데이터 증명을 유지하고 R2 `head`까지 진행했다.

## 적용

- 현대 업로드 영수증과 같은 명령 ID의 감사기록은 `actor`·`action`뿐 아니라 `at`도 완료 예약 `created_at`과 정확히 같아야 정상 증명을 인정한다.
- 완료 예약 `created_at`은 이미 소유 원장과 FLOW payload 파일 `createdAt`에 결속돼 있어 감사기록·예약·파일의 동일 생성시각을 연쇄 검증한다.
- 감사시각 불일치는 `inconsistent`·증명 없음·`unavailable`로 격리하고 R2 `head` 전에 503으로 닫는다.
- 감사시각, 명령 ID, 저장 키, 행위자 키, 지문, 객체 증명값은 재고 응답에 노출하지 않는다.
- 표시 행위자·동작이 모두 없던 구형 영수증의 기존 호환 경계는 유지한다.
- 기존 FLOW payload·감사기록·파일을 자동 수정하거나 삭제하지 않는다.

## 검증

- 수정 전 회귀: 감사시각 1초 변경 뒤에도 정상 증명·R2 `head` 1회
- 파일 재고 집중 회귀: 30/30
- 전체 Node 회귀: 786/786
- 격리 workerd + 실제 D1/R2: 641개 검사
- 실제 격리 R2 객체와 D1 ETag·SHA-256·예약·완료 원장으로 감사시각 손상·R2 전 차단·정상시각 복구 확인
- 추가형 마이그레이션 99개를 빈 D1에 두 번 적용
- 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 Worker 공개 화면 `/`, `/account`, `/account/setup`: 200 및 CSP·`nosniff`·`no-referrer`
- 비인증 `/api/state`, `/api/admin/file-inventory`, `/api/consulting-flow/synthetic-case`: 401 및 private/no-store·`nosniff`·`no-referrer`
- 실제 운영 쓰기, 메일 발송, 유료 AI 요청, 외부 네트워크 요청: 0건

기능 커밋은 `ec9395f` (`fix: bind flow receipt audit time`)이다. GitHub `main` 직접 푸시와 Sites 소스 전송은 버전 336의 정확한 승인을 기다린다. 원격 기준 커밋은 `ee40a91b5de4ef8fed06245ba2b636e623773b0c`이다.

## 배포 후보

- 아카이브: `outputs/release/partner-hub-v336.tar.gz`
- 크기: 1,698,378바이트
- 항목: 244개
- 마이그레이션: 99개, 마지막 `0098_consulting_flow_save_transcript_target.sql`
- 금지 항목: `.git`, `node_modules`, `.wrangler`, `.env*` 0개
- 필수 Sites 산출물: `dist/.openai/hosting.json`, `dist/server/wrangler.json`, `dist/server/index.js`
- SHA-256: `A5EC0B5948F674EF41D169974BCA9A2BD963552A6A7585CB32102C5DB7F856C2`

Sites 최신 저장 버전은 309이며 공개 운영본은 버전 107이다. 버전 336의 Sites 소스 전송·버전 저장·공개 배포에는 정확히 `버전 336 Sites 소스 전송 및 공개 운영 배포 승인`이 필요하다.

## 다음 감사

현대 FLOW 업로드 영수증의 `targetId`가 action별로 필요한 경우 정확히 존재하고 불필요한 경우 완전히 부재하는지 점검한다.
