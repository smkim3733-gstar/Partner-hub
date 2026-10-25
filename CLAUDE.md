# Partner-hub 작업 안내 (Claude Code용)

새 컴퓨터에서 이어서 작업할 때 이 파일과 [docs/CONTINUE_ON_ANOTHER_COMPUTER.md](docs/CONTINUE_ON_ANOTHER_COMPUTER.md)를 먼저 읽는다. 최신 상태는 [docs/CURRENT_STATUS.md](docs/CURRENT_STATUS.md) 맨 위 항목이다.

## 사용자와 일하는 방식

- 사용자(한기평 김성민 대표)는 개발자가 아니다. **모든 안내는 쉬운 한국어로** 한다. 코드·명령어·파일명만 원문 그대로 둔다.
- 사용자는 매 단계 확인을 원하지 않는다. 스스로 개발·시험·커밋·PR까지 진행한다. 사용자가 직접 해야 하는 일(비밀번호·키 입력, 유료 요금제 변경, 실제 데이터 삭제, 외부 발송, 사용자만 가진 자료)만 모아서 마지막에 한 번 요청한다.
- 소유자 상시 지시(2026-10-25): **"CI 7개가 모두 통과한 PR은 내 검토 없이 main에 병합해도 돼. 병합 후 운영 점검을 돌리고 실패하면 되돌려줘."** `main`은 Vercel 운영에 자동 배포된다. 병합 뒤 `node scripts/check-production-health.mjs`(운영 주소 지정)로 7/7을 확인하고, 실패하면 즉시 되돌림 PR을 만든다.
- 비밀번호·키를 대화창에 붙여넣게 하지 않는다. 사용자가 직접 입력하는 도우미 창(`tools/windows/*.cmd`)을 쓴다. Claude가 운영 비밀번호를 대신 입력하지 않는다.
- 이 저장소는 **공개(public)** 다. 비밀값·실제 고객 자료·백업 파일·복구 키·`.env*`(예제 제외)를 절대 커밋하지 않는다.

## 구조와 운영 대상

- Next.js 16 + Supabase(PostgreSQL 스키마 `partner_hub`, 비공개 Storage 버킷 `partner-hub-private`). Vercel은 배포만 담당한다.
- 운영: https://partner-hub-gamma-five.vercel.app (Vercel `keve1/partner-hub`, 리전 `sin1`) / Supabase 프로젝트 `yievsveuxjnbygatvjtb`(싱가포르, Free 플랜 — 7일 비활성 시 일시정지될 수 있음, [방지 문서](docs/SUPABASE_PAUSE_PREVENTION.md)).
- Sites·Cloudflare D1/R2·Turso·Vercel Blob 코드는 과거 호환용이다. 새 기능은 Supabase 경로로만 만든다.

## 개발 환경 요령

- pnpm은 **11.19.0 고정**. 전역 pnpm 12는 이 저장소에서 멈추므로 `npx -y pnpm@11.19.0 <명령>`을 쓴다.
- 단위 테스트: `npx -y pnpm@11.19.0 test` (PGlite의 V8 Wasm 충돌 때문에 `--liftoff-only`, 순차 실행). 타입검사 `npx tsc --noEmit -p .`, lint `npx oxlint`. 저장소 전체가 oxfmt 형식은 아니므로 파일 전체 재정렬은 하지 않는다.
- CI는 7개 작업이다. `gh` CLI가 없을 수 있다. CI 결과는 공개 API(`https://api.github.com/repos/smkim3733-gstar/Partner-hub/commits/<sha>/check-runs`)로 읽고, PR 생성·병합은 사용자의 Chrome(Claude in Chrome, GitHub 로그인 상태)으로 한다.
- 커밋 작성자: `git -c user.name="smkim3733-gstar" -c user.email="smkim3733@gmail.com" commit ...`
- Windows: 한글이 든 `.ps1`은 BOM 포함 UTF-8, `.cmd`는 ASCII만. 새 PowerShell 창에는 빈 Enter가 들어오므로 입력 도우미는 빈 입력을 다시 묻는다. 예약 작업 등록은 사용자가 `.cmd`를 더블클릭하게 한다.
- 예약 백업이 운영 작업 폴더의 코드를 실행하므로 그 폴더는 `main`에 두고, 브랜치 작업은 `git worktree`로 별도 폴더에서 한다.
- C 드라이브 여유가 적은 PC가 있었다(2026-10-25 0바이트). 캐시·임시 파일은 D 드라이브에 둔다(`TEMP`/`TMP`, `PLAYWRIGHT_BROWSERS_PATH`).

## 시험

- 운영 DB로 시험하지 않는다. 운영과 분리된 시험 Supabase 프로젝트 + 로컬 HTTPS 서버에서 [tools/business-flow](tools/business-flow/README.md) 시나리오로 가입→승인→신청→상담 FLOW 15단계→권한 분리까지 확인한다.
- 시험 도구는 운영 프로젝트 ID를 받으면 스스로 중단한다. 이 안전장치를 없애지 않는다.

## 다음 작업 후보

[docs/CONTINUE_ON_ANOTHER_COMPUTER.md](docs/CONTINUE_ON_ANOTHER_COMPUTER.md)의 "다음 작업" 절을 따른다.
