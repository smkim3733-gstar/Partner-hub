# 파일 재고 FLOW 영수증 전체 필드 봉투

기준일: 2026-09-08

## 문제

파일 재고는 FLOW 업로드 영수증의 행위자·동작·대상 의미를 각각 결속했지만 영수증 객체에 허용되지 않은 추가 필드가 존재하는지는 확인하지 않았다.

실패 우선 회귀에서는 `actor`·`action`의 한쪽 누락과 비텍스트 변조가 기존 규칙으로 이미 R2 전에 닫히는 것을 먼저 확인했다. 그러나 정상 현대 영수증에 임의 필드와 값을 주입하면 파일이 정상 증명을 유지하고 R2 `head`까지 진행했다.

## 적용

- FLOW 업로드 영수증 객체는 `actorKey`·`fingerprint`·`actor`·`action`·`targetId`만 포함할 수 있다.
- 허용 키 목록은 상세·저장 검증이 사용하는 공유 FLOW 스키마 `FLOW_OBJECT_KEYS.receipt`에서 가져와 재고 규칙과 중복 정의하지 않는다.
- 의미 필드 한쪽 누락, 비텍스트 타입, 허용되지 않은 필드 중 하나라도 있으면 `inconsistent`·증명 없음·`unavailable`로 격리한다.
- 허용되지 않은 키와 값은 목록·현황·개별 확인 응답에 노출하지 않고 R2 `head` 전에 503으로 닫는다.
- 기존 FLOW·파일·D1 원장을 자동 수정하거나 삭제하지 않았고 새 마이그레이션도 추가하지 않았다.

## 검증

- 실패 우선: 의미 필드 일부 누락·비텍스트 변조는 수정 전부터 격리됐고, 새 추가 필드 주입 시나리오만 집중 회귀 30개 중 1개가 실패하며 R2 `head` 1회를 확인했다.
- 수정 후 파일 재고 집중 회귀 30/30
- 전체 Node 회귀 786/786
- 격리 workerd + 실제 D1/R2 656개 검사
- 추가형 마이그레이션 99개를 같은 데이터베이스에 2회 적용
- TypeScript 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 Worker `/`, `/account`, `/account/setup` 200과 CSP·`nosniff`·`no-referrer` 확인
- 비인증 `/api/state`, `/api/admin/file-inventory`, `/api/consulting-flow/synthetic-case` 401과 `private, no-store`·`nosniff`·`no-referrer` 확인
- 운영 쓰기·메일 발송·유료 AI·외부 요청 0건

## 버전 경계

기능 커밋은 `397d3b4` (`fix: bind flow receipt field envelope`)이다. GitHub `main`은 버전 339의 정확한 승인을 기다린다. 원격 기준 커밋은 `ee40a91b5de4ef8fed06245ba2b636e623773b0c`이다.

## 배포 후보

- 아카이브: `outputs/release/partner-hub-v339.tar.gz`
- 크기: 1,698,659바이트
- 항목: 244개
- 마이그레이션: 99개, 마지막 `0098_consulting_flow_save_transcript_target.sql`
- 금지 항목: `.git`, `node_modules`, `.wrangler`, `.env*` 0개
- 필수 Sites 산출물: `dist/.openai/hosting.json`, `dist/server/wrangler.json`, `dist/server/index.js`
- SHA-256: `97DD1D2C82815A14E8BD1D162348BA74988CCC1E9A3D99D0198494008911DFFD`

Sites 최신 저장 버전은 309이며 공개 운영본은 버전 107이다. 버전 339의 Sites 소스 전송·버전 저장·공개 배포에는 정확히 `버전 339 Sites 소스 전송 및 공개 운영 배포 승인`이 필요하다.

## 다음 감사

완료 FLOW 업로드 증명에 연결된 감사기록 객체에 허용되지 않은 추가 필드가 주입돼도 정상 증명으로 통과하지 않는지 점검한다.
