# 다른 컴퓨터에서 이어서 개발하기

기준일: **2026-10-26 (한국 시간)**. 이 문서가 현재 인계 기준이다. 날짜가 오래된 다른 문서의 상태 설명은 당시 기록이다.

GitHub에는 코드·테스트·마이그레이션·문서·도구만 있다. **비밀값(키·비밀번호), 실제 고객 자료, 백업 파일, 복구 키는 GitHub에 없다.** 아래 "비밀값은 어디에 있나"를 따른다.

## 1. 지금 상태 한눈에 보기

| 항목 | 상태 |
| --- | --- |
| 공식 서비스 | https://partner-hub-gamma-five.vercel.app — 정상(운영 점검 7/7) |
| 구조 | Next.js + Supabase, Vercel은 배포만. `main`에 병합하면 자동 배포 |
| Vercel / Supabase | `keve1/partner-hub`(싱가포르 `sin1`) / `yievsveuxjnbygatvjtb`(싱가포르, Free 플랜) |
| 관리자 | `smkim3733@gmail.com` — 비밀번호는 대표님만 앎(2026-10-25 재설정) |
| 백업 | 매일 09:00 암호화 백업 + 복원 검증, 백업 파일은 OneDrive·복구 키는 Google Drive로 따로 복사 |
| 업무 흐름 검증 | 2026-10-25 시험 프로젝트에서 가입→승인→신청→상담 FLOW 15단계→사후관리→권한 분리 **전부 통과** |
| 속도 | DB 왕복을 7→3번으로 줄임(PR #12). 운영 DB 대기 약 40% 감소. 2026-10-26 구조 확인을 실제 질의와 같은 묶음에 넣어 요청당 DB 묶음 수를 절반으로 줄임 |

2026-10-24~25에 한 일: Supabase 일시정지 복구·재발 방지, 관리자 비밀번호 복구, 매일 백업과 PC 밖 사본, 보안 업데이트(Next.js 16.4.3 등, 취약점 0건), CI 안정화, 전체 업무 흐름 검증, 성능 개선. 자세한 내용은 [CURRENT_STATUS.md](CURRENT_STATUS.md) 맨 위.

## 2. 새 컴퓨터 준비 (처음 한 번)

1. **Git**, **Node.js 24**(LTS)를 설치한다. C 드라이브 여유가 적으면 개발 폴더는 D 드라이브에 둔다. OneDrive 동기화 폴더 안은 피한다.
2. 저장소를 내려받고 의존성을 설치한다 (PowerShell):

   ```powershell
   New-Item -ItemType Directory -Force D:\dev | Out-Null
   Set-Location D:\dev
   git clone https://github.com/smkim3733-gstar/Partner-hub.git
   Set-Location Partner-hub
   npx -y pnpm@11.19.0 install --frozen-lockfile
   ```

   전역 pnpm 12가 깔린 PC에서는 `pnpm` 대신 반드시 `npx -y pnpm@11.19.0`을 쓴다(12는 이 저장소에서 멈춤).
3. 정상 설치 확인 (환경파일 `.env.local`을 만들기 **전에** 실행):

   ```powershell
   npx -y pnpm@11.19.0 run test:next:supabase
   npx -y pnpm@11.19.0 run typecheck
   npx -y pnpm@11.19.0 test
   ```

   `test:next:supabase`는 `.env*` 파일이 있으면 일부러 멈춘다. 단위 테스트는 1114개(2026-10-25 기준)다.
4. **Claude Code로 이어가기:** Claude 데스크톱 앱(또는 Claude Code)을 설치하고 `D:\dev\Partner-hub` 폴더를 연다. 첫 메시지로 아래 문장을 보낸다.

   > CLAUDE.md와 docs/CONTINUE_ON_ANOTHER_COMPUTER.md를 먼저 읽고 이어서 진행해줘.

   Claude가 GitHub PR·병합, Vercel·Supabase 확인을 하려면 Chrome에 **Claude in Chrome 확장**을 설치하고 GitHub·Vercel·Supabase에 로그인해 둔다. (`gh` CLI는 없어도 된다.)

## 3. 운영 연결 열쇠 넣기 (백업·관리자 복구에 필요)

운영 사이트 자체는 Vercel에 설정이 저장돼 있어 새 PC와 상관없이 계속 돈다. 새 PC에서 **백업과 관리자 비밀번호 복구**를 하려면 열쇠 2개를 이 PC의 `.env.local`에 넣는다.

1. Supabase 대시보드 → 프로젝트 `yievsveuxjnbygatvjtb` → Project Settings → API Keys → secret key의 **Copy**.
2. `tools\windows\save-production-keys.cmd`를 더블클릭 → 비밀 키 붙여넣기 → DB 비밀번호(2026-10-24에 대표님이 정한 영어·숫자) 입력.
3. "연결 성공"이 나오면 끝. DB 비밀번호를 잊었다면 Supabase에서 재설정해야 하고, 그때는 **Vercel의 `SUPABASE_DATABASE_URL`도 같이 바꿔야** 운영이 멈추지 않는다([방법](SUPABASE_PAUSE_PREVENTION.md)).

관리자 비밀번호를 잊었을 때: `tools\windows\reset-admin-password.cmd` 더블클릭.

## 4. 매일 백업 옮기기

백업은 **한 대의 PC에서만** 돌리는 것을 권장한다. 새 PC로 옮기면 기존 PC의 작업 스케줄러에서 `PartnerHub Daily Backup`을 끈다(사용 안 함).

1. PostgreSQL 17 도구: EDB `postgresql-17.11-5-windows-x64-binaries.zip`을 내려받아 `D:\dev\tools\postgresql-17.11\`에 푼다(저장소 폴더 옆 `tools`). 다른 위치면 환경변수 `PARTNER_HUB_PG_BIN`에 `...\pgsql\bin` 경로를 넣는다.
2. 3번의 열쇠 저장을 먼저 끝낸다.
3. `tools\windows\register-daily-backup.cmd`를 더블클릭 → 매일 09:00 예약 등록.
4. OneDrive(백업 파일 사본)와 Google Drive 데스크톱(복구 키 사본, `내 드라이브`)에 로그인해 둔다. 실패하면 알림 창이 뜬다. 기록은 `work\backup-logs\`.
5. 확인: `node scripts/supabase-backup-scheduled.mjs status`

과거 백업을 복원하려면 그 백업을 만든 복구 키가 필요하다. 키는 Google Drive `내 드라이브\PartnerHubRecoveryKeys`에, 암호화 백업은 OneDrive `PartnerHubBackupCopies`에 있다. 절차: [백업·복구](SUPABASE_BACKUP_RECOVERY.md). USB 보관은 `tools\windows\copy-keys-to-usb.cmd`.

## 5. 시험 환경 (운영과 분리)

운영 DB로 시험하지 않는다. 별도 Supabase 프로젝트(무료)를 만들어 쓴다. 준비·실행 방법은 [tools/business-flow/README.md](../tools/business-flow/README.md). 2026-10-25에 쓴 시험 프로젝트가 있지만, 새 PC에서는 그 열쇠가 없으므로 같은 프로젝트를 쓰려면 대시보드에서 키를 다시 복사한다.

## 6. 비밀값은 어디에 있나

| 무엇 | 어디 |
| --- | --- |
| Vercel 운영 설정(키·DB 주소) | Vercel 프로젝트 환경변수 (GitHub 아님) |
| Supabase secret key | Supabase 대시보드에서 언제든 다시 복사 |
| 운영 DB 비밀번호 | 대표님 메모 (2026-10-24 재설정) |
| 관리자 비밀번호 | 대표님 (잊으면 `reset-admin-password.cmd`) |
| 암호화 백업 | 백업 PC `%USERPROFILE%\PartnerHubBackups` + OneDrive `PartnerHubBackupCopies` |
| 복구 키 | 백업 PC `%USERPROFILE%\PartnerHubRecoveryKeys` + Google Drive `PartnerHubRecoveryKeys` |
| 시험 프로젝트 열쇠 | 시험 작업 폴더의 `.env.local`, `.env.test-admin.local` (Git 제외) |

`.env.local`, 비밀번호, 키, 백업, 실제 고객 자료는 GitHub에 올리지 않는다. 서버 비밀값에 `NEXT_PUBLIC_` 접두어를 붙이지 않는다.

## 7. 알아 둘 점

- 관리자 로그인은 보안상 **1시간이 지나면 끝난다**. 작업 중 "로그인이 만료되었습니다"가 뜨면 다시 로그인한다.
- 화면을 열어 둔 채 저장 중에 창을 닫으면 마지막 변경이 저장되지 않을 수 있다("DB 저장됨" 표시 확인).
- Supabase Free 플랜은 7일 동안 접속이 없으면 일시정지된다. 6시간마다 도는 `Production health`가 이를 막는다. 그래도 멈추면 [복구 방법](SUPABASE_PAUSE_PREVENTION.md).
- `pnpm verify`는 옛 Sites 검사까지 포함한 묶음이다. Supabase 전용 준비 검사는 `test:next:supabase`.
- `storage:*` 명령은 옛 Turso/Vercel Blob용이다. Supabase 임시 업로드 정리는 `staging:check`(읽기 전용) → `staging:cleanup`([절차](SUPABASE_STAGING_CLEANUP.md)).

## 8. 다음 작업

1. **속도(완료 기록):** 2026-10-26 3단계로 관리자·파트너 로그인 확인을 한 묶음으로 합쳐 파트너 화면 데이터 요청은 DB 묶음 10→5→4번, 파트너 상담 FLOW는 14→7→5번이 됐다. 4단계로 관리자 화면 데이터는 로그인 확인 뒤의 읽기(FLOW 상태·로그인 통계·운영 통계)를 한 묶음으로 합쳐 18→9→3번이 됐다(묶음이 실패하면 예전처럼 하나씩 다시 읽어 통계별 실패 처리를 유지). 묶음 수는 `tests/supabase-request-batches.test.ts`가 지킨다. 파트너의 남은 4번은 화면 상태, 로그인 확인, 상담 FLOW, 로그인 기록이다. 남은 후보는 화면 상태 읽기와 로그인 확인을 합치는 것(모든 화면이 쓰는 로그인 확인 경로 변경 필요)이다. 운영에서의 실제 체감 속도는 시험 환경 측정으로 다시 확인한다.
2. **관리자 1시간 만료 안내(완료 기록):** 2026-10-26 만료 10분 전 안내와 만료 후 안내(새로고침 금지, 새 탭 재로그인 후 돌아와 저장)를 넣었다. 운영 화면에서 실제로 50분 이상 머물러 안내가 뜨는지 대표님 사용 중에 한 번 확인하면 좋다.
3. 이전 PC(`C:\Users\smkim\...`)의 9월 백업·복구 키를 새 보관 위치로 옮기기(대표님이 이전 PC를 켜야 함).
4. Supabase Pro 전환 여부 결정(일시정지 위험 제거, 유료) — 대표님 결정 사항.
5. 기존 Sites 원본 자료 확보와 이관 계획(접근 승인 필요).
6. 선택 기능: 알림, DOCX 출력, AI 초안(외부 전송은 별도 승인).

상세 과거 기록: [9월 11일 운영 설정](PRODUCTION_SETUP_PROGRESS_2026_09_11.md), [개발 점검](DEVELOPMENT_COMPLETION_AUDIT_2026_09_11.md), [Supabase 연결](VERCEL_SUPABASE_SETUP.md), [백업·복구](SUPABASE_BACKUP_RECOVERY.md).
