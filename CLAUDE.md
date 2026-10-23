# Partner Hub — Claude 작업 지침

대표님(한기평 김대표)을 보좌하는 주식회사 한국기업가치평가원의 기업컨설팅 협업 포털이다. 한국어로 결론과 실제 진행 결과를 짧게 보고한다. 추정·로컬 준비·실제 운영 완료를 구분한다.

## 첫 작업

- 시작 문서: [Claude 인계](docs/CLAUDE_HANDOFF_2026_10_23.md). 그 안의 순서대로 최신 기록과 실제 Git 상태를 먼저 읽는다.
- 저장소: `https://github.com/smkim3733-gstar/Partner-hub.git`.
- 인계 기준 브랜치: `codex/handoff-2026-10-13`. `main`은 운영 연결 브랜치다. 새 세션에서 무조건 `main`으로 전환하지 않는다.
- 2026-10-23 대표가 모든 개발 소스의 GitHub 게시와 Claude 이어받기를 요청했다. 과거 문서의 “Claude 없이”는 당시 Codex 단독 실행 범위다. 이제 Claude가 직접 이어받을 수 있으며, 하위 에이전트·다른 AI에 재위임하지 않는다.
- 미커밋 작업·기존 원장·실패 보고서를 보존한다. 다른 에이전트가 같은 checkout을 수정하고 있으면 덮어쓰지 않고 변경 주체를 먼저 확인한다.

## 현재 완료와 미완료

- 전체 **17/22개(77%)**. 남은 항목은 **M2/M3/B2/B3/O2**다.
- V4·B4의 분리 환경 검증은 완료했다. 완료한 백업·복원·로그인·파일·V4 검사를 새 근거 없이 재실행하지 않는다.
- O2는 SMTP 수락·실제 수신 모두 미확인이다. 예약은 `local-preview`, `transportConfigured=false`다.
- 최신 로컬 수정은 SMTP 진단 허용 목록(관련 34/34 통과)과 `active.lock` 시작 시각 기반 백업 알림(관련 29/29 통과)이다. 실제 발송·운영 무인 예약 완료가 아니다.
- 문서의 과거 대기·실패 이력보다 날짜가 최신인 확인·수정 기록을 우선한다. 상세 근거와 검증 한계는 인계 문서에 있다.

## 실행 경계

- 구체적인 근거가 있는 로컬 결함 하나를 분석·수정·관련 검사·인계 기록까지 자율 완료한다. 선행조건이 없으면 기능·할 일을 임의로 늘리거나 같은 질문·실패 안내를 반복하지 않는다.
- 운영 배포, `main` 병합, 운영 DB 추가 인증·비밀번호 재설정, 실고객 자료 처리·이관, 외부 발송·문의, 유료 AI·비용·권한 확대는 별도 명시 승인 전 실행하지 않는다.
- 이번 GitHub 게시·Claude 인계 요청은 위 외부 작업의 승인이 아니다. 인계 브랜치는 기존 `vercel.json`에서 자동 배포가 비활성화돼 있다.
- 접근 금지 운영 ref: `yievsveuxjnbygatvjtb`. 원본 검증 ref: `oaqodendjnztzcqaahaq`. 복원 전용 ref: `fkbxfdowgazmqoqykwyc`. 모든 접속 전에 분리를 확인한다. 마지막 확인(2026-10-15)은 원본 Healthy·복원 Paused이며 현재 실시간 상태로 단정하지 않는다.
- SMTP v1/v2/v3는 모두 거절로 종료됐다. **네 번째 SMTP 시도·새 입력창·재시도 경로 추가를 자동 실행하지 않는다.** 새 PC에 원장이 없어도 승인 횟수가 초기화된 것이 아니다.
- 네이버 계정 ID 일치·SMTP 사용함 저장 상태와 발급된 앱 비밀번호 입력에 대한 사용자 확인은 완료됐다. 같은 질문·화면 조회·저장 안내를 반복하지 않는다. 정확한 인증 실패 원인은 미확인이다.
- Sites 문의 17382449는 담당자 답변 2건 후 입력이 종료됐다. 전체 D1/R2 내보내기 경로는 확보되지 않았다. 일반 ChatGPT 내보내기를 전체 Sites 백업으로 간주하지 않는다. Gmail·지원 대화를 반복 조회하지 않는다.
- 비밀값을 요청·열람·저장하지 않는다. 실제 `.env*`, 키·비밀번호·연결 문자열·세션·고객자료·백업·복구 키·원시 로그·스크린샷은 Git·채팅·OneDrive에 넣지 않는다. 예제와 합성 fixture만 사용한다.
- `work/`와 PC 외부 원장이 clone에 없는 것은 의도된 제외다. 원본을 재생성·덮어쓰거나 외부 검증을 반복해 채우지 않는다. 원본 필요 시 승인된 보안 수단으로 별도 접근해야 한다.

## 도구와 코드 위치

- 기준 도구: **Node.js 24.19.0 / pnpm 11.19.0**, `pnpm-lock.yaml` 고정. 설치가 필요할 때만 `pnpm install --frozen-lockfile`.
- `app/`, `components/`: Next.js 화면·API. `lib/`: 인증·업무·저장소. `drizzle/`: 기존 SQL. `scripts/`: 운영/검증 도구. `tests/`: 합성 회귀.
- 기본 `pnpm dev/build/start`는 Next.js다. `*:sites`는 기존 Sites 경로다. `backup:create`, `backup:daily`, `admin:*`, `storage:*`, `test:postgres:*`, Supabase 검증·복원 실행기는 시작 확인용 명령이 아니다.
- 변경에 맞는 검사만 실행한다. 타입: `pnpm run typecheck`, lint: `pnpm exec oxlint <변경 파일>`, 포맷 확인: `pnpm exec oxfmt --check <변경 파일>`.
- 합성 회귀 예시: `node --no-wasm-tier-up --wasm-num-compilation-tasks=1 --import ./tests/register.mjs --test --test-concurrency=1 tests/<관련파일>.test.ts`. 이미 완료한 34/34·29/29를 문서 인계만으로 반복하지 않는다.
- 실제 환경파일이 있는 checkout에서 빌드·검사를 무작정 실행하지 않는다. 합성 빌드가 필요하면 비밀값이 없는 별도 checkout을 사용한다. 상위 폴더 설정을 복사하지 않는다.
- Windows Git 소유권 오류는 확인한 checkout에 한해 명령별 `git -c safe.directory=<절대경로> ...`를 사용한다. 전역 `safe.directory=*` 또는 TLS 검증 해제를 사용하지 않는다.

## 작업 종료

변경 목적, 관련 검사의 실제 결과·종료 코드, 남은 조건을 기록한다. 운영 체크리스트는 실제 완료 근거가 있을 때만 갱신한다. 단순 로컬 수정·게시·Claude 설정만으로 17/22개를 올리지 않는다.
