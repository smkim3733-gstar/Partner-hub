# 파일 재고 FLOW 감사기록 필드 봉투

기준일: 2026-09-08

## 문제

파일 재고는 완료 FLOW 업로드 영수증과 같은 명령의 감사기록에서 `id`·`actor`·`action`·`at`을 결속했지만 감사 객체에 허용되지 않은 추가 필드가 존재하는지는 확인하지 않았다.

실패 우선 회귀에서는 정상 영수증·예약·파일 연결은 그대로 둔 채 감사기록에 임의 필드와 값을 주입해도 파일이 정상 증명을 유지하고 R2 `head`까지 진행했다.

## 적용

- 연결 감사기록 객체는 `id`·`at`·`actor`·`action`·`detail`만 포함할 수 있다.
- 허용 키 목록은 상세·저장 검증이 사용하는 공유 FLOW 스키마 `FLOW_OBJECT_KEYS.audit`에서 가져와 재고 규칙과 중복 정의하지 않는다.
- 허용되지 않은 필드는 `inconsistent`·증명 없음·`unavailable`로 격리하고, 키와 값을 응답에 노출하지 않은 채 R2 `head` 전에 503으로 닫는다.
- 최초 중첩 JSON 순회 구현은 실제 D1의 큰 재고 SQL에서 표현식 복잡도 한계를 넘어 500을 반환했다. 같은 허용 키를 `json_remove`한 뒤 잔여 객체가 `{}`인지 확인하는 방식으로 단순화하고 전체 격리 검사를 재실행했다.
- 기존 FLOW·파일·D1 원장을 자동 수정하거나 삭제하지 않았고 새 마이그레이션도 추가하지 않았다.

## 검증

- 실패 우선: 수정 전 집중 회귀 30개 중 새 감사 추가 필드 시나리오 1개가 실패했고 R2 `head` 1회를 확인했다.
- 수정 후 파일 재고 집중 회귀 30/30
- 첫 격리 시도에서 D1 재고 응답 500을 발견해 SQL을 단순화한 뒤 전체 재실행
- 전체 Node 회귀 786/786
- 격리 workerd + 실제 D1/R2 659개 검사
- 추가형 마이그레이션 99개를 같은 데이터베이스에 2회 적용
- TypeScript 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 Worker `/`, `/account`, `/account/setup` 200과 CSP·`nosniff`·`no-referrer` 확인
- 비인증 `/api/state`, `/api/admin/file-inventory`, `/api/consulting-flow/synthetic-case` 401과 `private, no-store`·`nosniff`·`no-referrer` 확인
- 운영 쓰기·메일 발송·유료 AI·외부 요청 0건

## 버전 경계

기능 커밋은 `84343de` (`fix: bind flow audit field envelope`)이다. GitHub `main`은 버전 340의 정확한 승인을 기다린다. 원격 기준 커밋은 `ee40a91b5de4ef8fed06245ba2b636e623773b0c`이다.

## 배포 후보

- 아카이브: `outputs/release/partner-hub-v340.tar.gz`
- 크기: 1,698,705바이트
- 항목: 244개
- 마이그레이션: 99개, 마지막 `0098_consulting_flow_save_transcript_target.sql`
- 금지 항목: `.git`, `node_modules`, `.wrangler`, `.env*` 0개
- 필수 Sites 산출물: `dist/.openai/hosting.json`, `dist/server/wrangler.json`, `dist/server/index.js`
- SHA-256: `309F447AF16E806DA5B2489207914E135D4FC6CF0D86E75C6666F702D041767E`

Sites 최신 저장 버전은 309이며 공개 운영본은 버전 107이다. 버전 340의 Sites 소스 전송·버전 저장·공개 배포에는 정확히 `버전 340 Sites 소스 전송 및 공개 운영 배포 승인`이 필요하다.

## 다음 감사

완료 FLOW 업로드 증명에 연결된 감사기록 `detail`이 누락·빈 문자열·비텍스트로 손상돼도 정상 증명으로 통과하지 않는지 점검한다.
