# 다른 컴퓨터에서 이어서 개발하기

기준일: **2026-10-07 (한국 시간)**

현재 인계 기준은 이 문서다. 날짜가 오래된 문서의 Sites 배포 대기, 관리자 미설정, 운영 백엔드 비활성 설명은 당시 기록이며 현재 상태로 적용하지 않는다. GitHub에는 개발 코드·테스트·마이그레이션·비식별 문서만 포함한다.

## 저장소와 운영 대상

| 항목 | 기준 |
| --- | --- |
| 저장소 | https://github.com/smkim3733-gstar/Partner-hub |
| 개발 기준 브랜치 | `main` |
| 이번 인계 전 기능 커밋 | `884d95d244a545f9939442f6c723d97c647f3f6b` — 일일 백업·복원 검증 |
| 공식 서비스 | https://partner-hub-gamma-five.vercel.app/ |
| Vercel 프로젝트 | `keve1/partner-hub` |
| Supabase 프로젝트 | `yievsveuxjnbygatvjtb` |
| 파일 버킷 | `partner-hub-private` (비공개) |

확정 구조는 **Next.js + Supabase**이며 Vercel은 Next.js 배포와 실행을 담당한다. 로그인 로직은 Next.js에 있고 회원·세션은 Supabase PostgreSQL에 저장한다. Supabase Auth 제품으로 전환한 상태는 아니다. 기존 Sites·Cloudflare D1/R2·Turso·Vercel Blob 관련 코드는 과거 호환과 검증용이며 새 운영 연결의 요구사항이 아니다.

이미 운영 프로젝트·관리자·DB 스키마가 존재한다. 컴퓨터를 바꾸는 이유만으로 프로젝트를 새로 만들거나 관리자·DB 비밀번호를 재설정하지 않는다. 기존 `codex/*` 브랜치 대신 최신 `main`에서 이어간다.

## 확인된 진행 상황과 검증 범위

- **2026-10-07:** Vercel Production Ready를 확인했다. 확인 당시 배포 소스는 위 `884d95d`이며 배포 생성일은 9월 11일이다.
- 같은 날 공식 서비스 접속·비인증 접근 제한 검사 **7건 통과**, 실제 로그인 화면을 확인했다. 이날 관리자 로그인이나 전체 업무 흐름을 다시 실행한 것은 아니다.
- **2026-09-11:** 관리자 생성·실제 로그인, 회원가입 최소 비밀번호 6자, 실제 Supabase DB 인증·파일 처리 검사, 별도 25MiB Storage 전송 검증을 완료했다.
- 승인·담당 배정·기업자료·상담 FLOW·계약·입금 기록·사후관리 기능은 구현됐다. 실제 Vercel 브라우저에서 모든 과정을 연결한 검증은 미완료다.
- 기존 Sites 자료·원본 파일의 완전한 확보와 Supabase 이관은 미완료다. 새 DB를 기존 자료 이전 완료로 간주하지 않는다.
- 마지막 확인 설정에서 외부 AI 처리는 비활성이다. AI는 일부 초안 경로이며, 문서 등록·메일/카톡 전달·입금 확인 등의 수동 절차가 남아 있다.
- 판단: **내부 시험 사용 가능. 실고객 본격 운영 준비 완료는 아님.**

## 새 컴퓨터 준비

OneDrive 동기화 폴더 밖의 일반 개발 폴더를 권장한다. Git과 Node.js를 준비한다. 저장소 CI의 재현 기준은 **Node.js 24.19.0 + pnpm 11.19.0**이며, `package.json`의 Node 최소 조건은 22.13.0이다.

PowerShell 예시:

```powershell
npm install --global pnpm@11.19.0
git clone --branch main https://github.com/smkim3733-gstar/Partner-hub.git
Set-Location Partner-hub
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm run test:next:supabase
pnpm run typecheck
pnpm run lint
node --import ./tests/register.mjs --test --test-concurrency=1 tests/*.test.ts
```

이미 pnpm 12 이상이 전역 설치된 PC에서는 저장소의 `packageManager` 버전으로 전환하는 단계에서 명령이 멈출 수 있다(2026-10-24 확인). 전역 버전을 바꾸지 않으려면 `npx pnpm@11.19.0 install --frozen-lockfile`처럼 고정 버전을 직접 실행한다. 같은 날 새 PC(`D:\dev\Partner-hub`)에서 설치, `test:next:supabase`, 타입검사, lint, 직렬 회귀검사 1106개가 통과했다.

위 명령은 새 PC에서 실행할 절차다. 이번 문서 인계 작업에서 새 PC 검사를 대신 실행했거나 모든 검사가 현재 통과했다고 주장하지 않는다.

`test:next:supabase`는 합성 자격증명으로 Next.js 빌드와 비활성 API 경계를 검사한다. **`.env`, `.env.local`, `.env.production`, `.env.production.local`을 만들기 전에 실행해야 한다.** 이 파일들이 있으면 명령이 중단된다. 실제 운영 DB·로그인·업무 전체 검사가 아니다. 기존 작업 폴더에서 재검사할 때 환경파일을 삭제하지 말고 별도 깨끗한 checkout을 사용한다.

처음 복제한 폴더에서 위 검사가 끝나면 화면 확인용 설정을 만든다:

```powershell
Copy-Item -LiteralPath .env.example -Destination .env.local
pnpm dev
```

기존 `.env.local`이 있으면 덮어쓰지 않는다. 개발 화면은 `http://127.0.0.1:3001`, 로그인은 `/account`다.

예제는 `PARTNER_HUB_NEXT_BACKEND=supabase-v1`, `PARTNER_HUB_BACKEND_ENABLED=0`, `ANTHROPIC_EXTERNAL_PROCESSING_ENABLED=false`다. 서버 비밀값은 비어 있다. 따라서 복제 직후 업무 API가 차단되는 것은 정상이다. **새 PC의 로컬 비활성 상태와 이미 활성화된 Vercel 운영 환경을 구분한다.**

실제 기능 개발·통합 검사는 운영과 분리된 Supabase 자원, 정확한 HTTPS origin, 검증 범위를 준비한 뒤 활성화한다. 단순 화면 확인을 위해 운영 DB에 연결하거나 기존 운영 설정을 덮어쓰지 않는다.

## 비밀값과 계정 연결

- 필요한 서버 설정은 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_DATABASE_URL`, `SUPABASE_STORAGE_BUCKET`, `PARTNER_HUB_APP_ORIGIN`이다. 대상에 맞는 기존 연결값을 Git 밖에서 안전하게 설정한다.
- `.env.local`, DB 비밀번호, API 키, 계정 비밀번호, 인증 세션, 실제 DB·파일, 백업 암호문·복구 키를 Git에 넣지 않는다. 서버 비밀에 `NEXT_PUBLIC_` 접두어를 붙이지 않는다.
- Git 제외는 OneDrive 동기화 제외를 뜻하지 않는다.
- GitHub/Vercel/Supabase 로그인·MCP 연결, PostgreSQL 바이너리와 Codex 예약은 복제로 옮겨지지 않는다. 새 PC에서 필요한 연결을 직접 설정한다.
- Vercel 환경변수는 기존 프로젝트에 별도로 저장되어 있으며 GitHub 푸시로 전송되지 않는다. 이 문서에는 값을 포함하지 않는다.
- `pnpm dev`, `pnpm build`, `pnpm start`는 공식 Next.js 명령이다.
- `dev:sites`, `build:sites`, `dev:next:local*` 및 Worker/D1/R2 검사는 이전 호환 경로다. 새 PC의 Supabase 기본 설정 절차로 사용하지 않는다.
- `storage:check`, `storage:init`, `storage:cleanup*`은 이전 Turso/Vercel Blob용이므로 Supabase에 실행하지 않는다. Supabase 임시 업로드 정리는 `staging:check`(읽기 전용)·`staging:cleanup`을 사용한다. [정리 절차](SUPABASE_STAGING_CLEANUP.md)
- `pnpm verify`는 Sites 검사까지 포함하는 기존 전체 검증 묶음이다. Next.js + Supabase 전용 준비 검사는 `test:next:supabase`다.

## 백업 상태와 PC 이전

**2026-10-07:** 기존 PC 작업 폴더의 `.env.local` 누락을 확인했다. 예약 백업은 `backup-failed-redacted`, 상태는 `last-run-failed`였다. 마지막 성공은 **2026-09-27 09:03 KST**이며 10월 7일 확인 시 약 253시간 공백이었다. 기존 최신 백업 암호문과 복구 키 검증은 정상이다. 이 로컬 파일 누락이 Vercel 환경변수 삭제를 뜻하지 않는다.

9월 17·18·24·25·26·27일 예약 실행 성공 기록이 있다. 연속 매일 실행됐다고 보장할 수 없으며, PC가 꺼진 시간을 성공으로 간주하지 않는다. 최신 성공본은 38개 테이블·전체 16행·Storage 파일 0건이다. 16행은 고객 16건이라는 뜻이 아니며 실제 파일이 있는 Supabase 복구 검증도 아니다.

기존 PC의 경로:

- 암호화 백업: `C:\Users\smkim\PartnerHubBackups`
- 복구 키: `C:\Users\smkim\PartnerHubRecoveryKeys`
- PostgreSQL 도구: `C:\Users\smkim\AppData\Local\PartnerHubTools\postgresql-17.11\pgsql\bin`

백업과 키는 서로 다른 폴더지만 같은 PC에만 보관된 상태다. PC 밖 사본·별도 장치의 키 사본은 검증되지 않았다. 저장소 업로드는 DB 백업이나 복구 키 이전이 아니다.

새 PC에서 PostgreSQL 17 도구를 ASCII 경로에 준비하고 [백업·복구 절차](SUPABASE_BACKUP_RECOVERY.md)를 확인한다. 아래 예시의 도구 경로는 새 PC의 실제 경로로 바꾼다. 이 명령은 안전하게 복원한 기존 연결값이 있는 작업 폴더에서 실행한다.

```powershell
node --env-file-if-exists=.env.local scripts/supabase-backup-scheduled.mjs run --pg-bin "C:\Tools\postgresql-17\pgsql\bin"
node scripts/supabase-backup-scheduled.mjs status
```

- 기존 `automation-2`는 기존 PC·Codex·작업 경로에 의존하는 오전 9시 로컬 예약이다. 저장소 복제로 이전되지 않는다. 이번 GitHub 업로드에서 예약을 변경하거나 새로 만들지 않았다.
- 새 PC에서 예약을 옮길 때 실행 PC·폴더·도구 경로를 맞추고 기존 예약과 중복되지 않도록 확인한다.
- `status`는 실행한 PC의 로컬 기록을 본다. 새 PC의 기록 없음은 운영 DB 손실이라는 뜻이 아니다.
- 기존 백업·키를 안전하게 별도 전달하고 실제 읽기·복호화를 확인한다. GitHub로 전달하지 않는다.
- 오래된 잠금을 자동 삭제하거나 복원 프로세스를 강제 종료하지 않는다. 원래 프로세스와 평문 임시 폴더부터 확인한다.
- 30일은 예약 기록의 보관 구간 집계 기준이며 자동 삭제하지 않는다. 현재 CLI는 원격 Supabase 복원을 지원하지 않는다.

## 다음 작업 순서

1. 기존 연결값을 안전하게 확보해 로컬 백업 설정을 복구하고 새 백업·로컬 복원·평문 정리 성공을 확인한다.
2. 운영과 분리된 Next.js + Supabase 검증 배포에서 테스트 기업 1곳으로 가입 → 승인 → 신청 → 배정 → 업로드·다운로드 → 상담 FLOW → 계약·입금 기록 → 사후관리·권한 검증을 수행한다. 운영 대상 확인은 기존 자료 이전 계획과 데이터 보존 범위를 확정한 뒤 제한적으로 수행한다.
3. 기존 Sites의 완전한 원본·파일 목록을 확보해 이전 계획을 보완한다. 현재 포털 초기 상태와 이전 도구의 빈 대상 조건을 대조하고, 조건을 우회하거나 기존 행을 임의 삭제하지 않는다.
4. 암호화 백업과 복구 키의 별도 외부 보관 위치를 정하고 전달·복호화를 검증한다.
5. 실패 알림 수신, 실제 파일을 포함한 새 Supabase 환경 복구를 검증한다. Supabase 임시 업로드 정리 명령은 2026-10-24에 구현했으며 운영 Storage에서는 아직 실행하지 않았다. 처음에는 `staging:check` 결과부터 검토한다. AI 자동화는 별도 선택 기능으로 진행한다.

기존 Sites 접근에 대한 자동 승인 거절은 해제된 것으로 간주하지 않는다. 원본 확보가 필요하면 해당 접근의 승인 상태부터 확인한다. 실제 고객 자료를 테스트에 사용하거나 외부 발송·유료 AI를 실행하는 작업은 별도 범위를 확인한다.

상세 과거 기록: [9월 11일 운영 설정](PRODUCTION_SETUP_PROGRESS_2026_09_11.md), [개발 점검](DEVELOPMENT_COMPLETION_AUDIT_2026_09_11.md), [Supabase 연결](VERCEL_SUPABASE_SETUP.md), [백업·복구](SUPABASE_BACKUP_RECOVERY.md).

## 새 Codex 대화에 전달할 문장

> 이 저장소의 main에서 docs/CONTINUE_ON_ANOTHER_COMPUTER.md를 먼저 읽고 이어서 진행해 줘. Next.js + Supabase만 사용하고 Vercel은 배포용이야. 인계 문서의 완료 항목과 현재 환경을 구분해서 확인하고, 비밀값·고객 자료는 Git에 올리지 마. 다음 우선순위는 백업 설정 복구와 전체 업무 흐름 검증이야.
