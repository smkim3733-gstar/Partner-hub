# 파일 재고 FLOW 레거시 영수증 대상 봉투

기준일: 2026-09-08

## 문제

파일 재고는 표시 행위자 `actor`와 동작 `action`이 모두 없는 과거 FLOW 업로드 영수증을 레거시 호환으로 인정했다. 이 분기는 출처 불명의 `targetId`가 함께 존재하는지는 확인하지 않았다.

실패 우선 회귀에서는 정상 레거시 봉투에 임의 `targetId`를 주입해도 파일이 정상 증명을 유지하고 R2 `head`까지 진행했다.

## 적용

- 레거시 호환 경로는 `actor`·`action`·`targetId` 세 필드가 모두 없을 때만 허용한다.
- 레거시 영수증에 텍스트, JSON `null`, 객체 등 어떤 형태로든 `targetId`가 존재하면 정상 증명을 인정하지 않는다.
- 손상 파일은 `inconsistent`·증명 없음·`unavailable`로 격리하고 개별 현재 원본 확인을 R2 `head` 전에 503으로 닫는다.
- 현대 영수증의 action별 대상 필수·금지 규칙과 정상 레거시 호환은 그대로 유지한다.
- 기존 FLOW·파일·D1 원장을 자동 수정하거나 삭제하지 않았고 새 마이그레이션도 추가하지 않았다.

## 검증

- 실패 우선: 수정 전 집중 회귀 30개 중 새 레거시 대상 주입 시나리오 1개가 실패했고 R2 `head` 1회를 확인했다.
- 수정 후 파일 재고 집중 회귀 30/30
- 전체 Node 회귀 786/786
- 격리 workerd + 실제 D1/R2 647개 검사
- 추가형 마이그레이션 99개를 같은 데이터베이스에 2회 적용
- TypeScript 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 Worker `/`, `/account`, `/account/setup` 200과 CSP·`nosniff`·`no-referrer` 확인
- 비인증 `/api/state`, `/api/admin/file-inventory`, `/api/consulting-flow/synthetic-case` 401과 `private, no-store`·`nosniff`·`no-referrer` 확인
- 운영 쓰기·메일 발송·유료 AI·외부 요청 0건

## 버전 경계

기능 커밋은 `6137f65` (`fix: reject legacy flow receipt targets`)이다. GitHub `main`은 버전 338의 정확한 승인을 기다린다. 원격 기준 커밋은 `ee40a91b5de4ef8fed06245ba2b636e623773b0c`이다.

## 배포 후보

- 아카이브: `outputs/release/partner-hub-v338.tar.gz`
- 크기: 1,698,458바이트
- 항목: 244개
- 마이그레이션: 99개, 마지막 `0098_consulting_flow_save_transcript_target.sql`
- 금지 항목: `.git`, `node_modules`, `.wrangler`, `.env*` 0개
- 필수 Sites 산출물: `dist/.openai/hosting.json`, `dist/server/wrangler.json`, `dist/server/index.js`
- SHA-256: `52F73A1C24C4AF81C2B02251BB541FC641BDCDD26F693F1DC598262775123631`

Sites 최신 저장 버전은 309이며 공개 운영본은 버전 107이다. 버전 338의 Sites 소스 전송·버전 저장·공개 배포에는 정확히 `버전 338 Sites 소스 전송 및 공개 운영 배포 승인`이 필요하다.

## 다음 감사

FLOW 업로드 영수증의 `actor`·`action` 의미 필드가 한쪽만 존재하거나 텍스트가 아닌 타입으로 변조돼도 정상 증명으로 통과하지 않는지 점검한다.
