# 파일 재고 FLOW 영수증 대상 봉투 결속

기준일: 2026-09-08

## 문제

파일 재고는 대상이 필요한 `save_transcript`·`receive_document`·`record_contract` 영수증의 `targetId`를 실제 업무 객체와 결속했지만 대상이 필요 없는 업로드 action에 해당 필드가 완전히 없어야 하는지는 확인하지 않았다.

실패 우선 회귀에서는 정상 `save_source` 영수증과 실제 `save_report` 영수증에 임의 `targetId`를 주입해도 파일이 정상 증명을 유지하고 R2 `head`까지 진행했다.

## 적용

- 현대 FLOW 업로드 영수증은 `save_transcript`·`receive_document`·`record_contract`에서 비어 있지 않은 텍스트 `targetId`를 반드시 가져야 한다.
- `save_source`·`import_intake_source`·`save_report`·`save_recording` 영수증에는 `targetId`가 완전히 없어야 한다. JSON `null`이나 다른 타입도 정상으로 인정하지 않는다.
- 대상 필요 action 목록은 기존 중앙 업로드 대상 규칙에서 파생해 새 action 추가 시 재고 규칙과 따로 갈라지지 않게 했다.
- 봉투 위반은 `inconsistent`·증명 없음·`unavailable`로 격리하고 개별 현재 원본 확인을 R2 `head` 전에 503으로 닫는다.
- 기존 FLOW·파일·D1 원장을 자동 수정하거나 삭제하지 않았고 새 마이그레이션도 추가하지 않았다.

## 검증

- 실패 우선: 수정 전 집중 회귀 30개 중 새 대상 주입 시나리오 1개가 실패했고 R2 `head` 1회를 확인했다.
- 수정 후 파일 재고 집중 회귀 30/30
- 전체 Node 회귀 786/786
- 격리 workerd + 실제 D1/R2 644개 검사
- 추가형 마이그레이션 99개를 같은 데이터베이스에 2회 적용
- TypeScript 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 Worker `/`, `/account`, `/account/setup` 200과 CSP·`nosniff`·`no-referrer` 확인
- 비인증 `/api/state`, `/api/admin/file-inventory`, `/api/consulting-flow/synthetic-case` 401과 `private, no-store`·`nosniff`·`no-referrer` 확인
- 운영 쓰기·메일 발송·유료 AI·외부 요청 0건

## 버전 경계

기능 커밋은 `009ef16` (`fix: enforce flow receipt target envelope`)이다. GitHub `main`은 버전 337의 정확한 승인을 기다린다. 원격 기준 커밋은 `ee40a91b5de4ef8fed06245ba2b636e623773b0c`이다.

## 배포 후보

- 아카이브: `outputs/release/partner-hub-v337.tar.gz`
- 크기: 1,698,480바이트
- 항목: 244개
- 마이그레이션: 99개, 마지막 `0098_consulting_flow_save_transcript_target.sql`
- 금지 항목: `.git`, `node_modules`, `.wrangler`, `.env*` 0개
- 필수 Sites 산출물: `dist/.openai/hosting.json`, `dist/server/wrangler.json`, `dist/server/index.js`
- SHA-256: `FBAAD3AEBBD605E69BDB406449FD214987611ED15DB399BE77A6311CEEFB317A`

Sites 최신 저장 버전은 309이며 공개 운영본은 버전 107이다. 버전 337의 Sites 소스 전송·버전 저장·공개 배포에는 정확히 `버전 337 Sites 소스 전송 및 공개 운영 배포 승인`이 필요하다.

## 다음 감사

표시 의미 필드가 모두 없는 레거시 FLOW 업로드 영수증에 출처 불명의 `targetId`가 주입된 경우 정상 증명으로 통과하지 않는지 점검한다.
