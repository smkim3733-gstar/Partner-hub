# Claude에서 Partner Hub 이어가기

기준일: **2026-10-23 KST**. 대표가 지금까지의 개발 내용을 기존 GitHub 저장소에 올리고 Claude에서 이어갈 수 있도록 준비하라고 요청했다. 이 문서는 저장소의 인계 설정이며 Claude 로그인·유료 실행·운영 배포 완료를 뜻하지 않는다.

## 바로 시작

**최신 개발은 `codex/handoff-2026-10-13` 브랜치**다. [GitHub 인계 브랜치](https://github.com/smkim3733-gstar/Partner-hub/tree/codex/handoff-2026-10-13)에서 받는다. 저장소 루트의 `CLAUDE.md`에 Claude가 읽을 작업 지침을 두었다.

같은 PC의 Claude Code에서 다음 프로젝트 폴더를 선택한다. 상위 폴더가 아닌 실제 저장소를 연다.

```text
C:\Users\A\OneDrive\바탕 화면\codex\한기평 파트너 허브\Partner-hub
```

새 PC라면 OneDrive 밖의 새 개발 폴더에서 복제한다. 이미 있는 checkout을 초기화하거나 덮어쓰지 않는다.

```powershell
git clone --branch codex/handoff-2026-10-13 --single-branch https://github.com/smkim3733-gstar/Partner-hub.git
Set-Location Partner-hub
git status --short --branch
git log -1 --format="%H %s"
```

아래 문안을 Claude Code의 첫 메시지에 붙여 넣는다. 일반 Claude 채팅을 사용한다면 GitHub에서 이 브랜치의 파일을 실제로 읽을 수 있는지 먼저 확인한다. 저장소 주소만 전달했다고 로컬 파일 쓰기 권한이나 개발 환경이 연결된 것은 아니다.

```text
이 저장소의 CLAUDE.md와 docs/CLAUDE_HANDOFF_2026_10_23.md를 먼저 읽고 이어서 개발해.
기준 브랜치는 codex/handoff-2026-10-13이야. 실제 Git 상태와 최신 인계 문서를 먼저 확인하고 기존 작업을 보존해.
V4/B4 완료, 전체 17/22개, 남은 M2/M3/B2/B3/O2를 유지해.
구체적 근거가 있는 로컬 결함 하나만 선정해 수정·관련 검사·기록까지 단독 진행해.
기존 SMTP 세 시도는 모두 거절됐고 네 번째 시도·새 입력창·재시도 경로·계정 조회는 자동 실행하지 마.
운영 배포·main 병합·운영 인증·실고객 이관·외부 발송·비용·권한 확대는 별도 승인이 필요해.
완료 검사를 반복하지 말고 새 근거가 없으면 임의 기능을 추가하거나 같은 실패·질문을 반복하지 마.
```

Claude Code는 프로젝트 지침 파일을 읽는 방식으로 설정한다. 계정 연결이나 GitHub 앱 설치를 자동 수행하지 않았으며 추가 모델 호출도 실행하지 않았다. 참고: [Claude 프로젝트 지침](https://code.claude.com/docs/en/memory), [Claude Code 데스크톱](https://code.claude.com/docs/en/desktop).

## 읽는 순서와 우선순위

1. `CLAUDE.md`와 이 문서.
2. [다른 컴퓨터에서 이어가기](CONTINUE_ON_ANOTHER_COMPUTER.md)의 맨 위 최신 기록.
3. [연결 복구 계획](CONNECTION_RECOVERY_PLAN_2026_10_08.md), [자동 개발 기록](CONTINUOUS_DEVELOPMENT_2026_10_14.md), [분리 Supabase 검증](SUPABASE_VERIFICATION_2026_10_14.md).
4. [Sites 사전 검사](SITES_DATA_MIGRATION_PREFLIGHT.md)의 2026-10-21 답변·종료 기록.
5. [백업·복구·알림](SUPABASE_BACKUP_RECOVERY.md)의 2026-10-22 SMTP 거절·승인된 읽기·진단 수정과 2026-10-23 잠금 시각 수정.
6. 관련 구현·테스트만 읽고 다음 작업을 선택한다. 과거 문서의 “대기”, “미조회”, “15/22”, “16/22”, “미게시”는 당시 이력이다.

## 지금까지 구현한 범위

기존 전체 소스에는 협업신청·승인·파트너 인증·역할별 접근, 기업진단, 반복 상담 FLOW, 서류요청·견적·계약·수행·사후관리, 비공개 기업/FLOW 파일, Next.js 및 Supabase 저장소 연결, 기존 Sites/D1/R2 경로, 마이그레이션·백업·복원과 합성 검사가 포함돼 있다. 상세 기능은 [README](../README.md), [현재 상태](CURRENT_STATUS.md)와 각 기능 문서를 따른다.

이번 게시에는 2026-10-13 이후 로컬에 남아 있던 다음 개발 묶음을 포함한다.

| 개발 묶음                                         | 주요 소스·기록                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 분리 Supabase 검증과 전체 업무·2슬롯·경합 도구    | `scripts/supabase-verification*.mjs`, `run/serve/check-supabase-verification*.mjs`, 관련 테스트·검증 문서                                         |
| 검증 백업과 분리 복원·Storage 시각 보정·보존 대조 | `supabase-backup-target.mjs`, `supabase-recovery-policy.mjs`, `restore/reconcile/check-supabase-recovery*.mjs`, 백업 runtime·CLI와 관련 테스트    |
| 예약 백업 알림과 단발 합성 메일                   | `supabase-backup-alert.mjs`, `preview-backup-alert.mjs`, `backup-alert-mail.mjs`, `send-backup-alert-test.ps1`, `nodemailer` 고정 의존성과 테스트 |
| SMTP 허용 목록 진단과 실행 잠금 시각 수정         | 메일 진단 34/34 및 예약 백업·알림 29/29의 기존 검증 기록                                                                                          |
| 인계                                              | 최신 상태·연결 복구·Sites 지원 답변·연속 개발 문서, `CLAUDE.md`, 이 문서                                                                          |

## 검증 결과와 한계

아래는 **기존 실행의 기록을 인계하는 것**이며 이번 게시에서 다시 실행한 결과가 아니다.

| 완료 근거                 | 결과                                                                                         | 범위                             |
| ------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------- |
| 2026-10-14 합성 재현      | 일반 회귀 1,148/1,148, Next 빌드 1/1, 기본 HTTP 123/123, 타입·lint 통과                      | 당시 소스·격리 환경              |
| V4                        | 업무 HTTP 134개, 2슬롯 51개, 독립 DB 경합, 브라우저·모바일 역할/저장/재조회                  | 실제 분리 환경 완료              |
| B4                        | DB 39테이블·108행, Storage 14객체·111,634,766 bytes 원격 복원, 앱 HTTP 84개와 별도 보존 대조 | 실제 분리 복원 완료              |
| 2026-10-22 SMTP 진단 수정 | 새 6개 수정 전 실패 → 관련 34/34 통과, lint·전체 타입·포맷 종료 코드 0                       | 합성 전송, 실제 발송 아님        |
| 2026-10-23 잠금 시각 수정 | 새 4개 수정 전 실패 → 관련 29/29 통과, lint·전체 타입·포맷 종료 코드 0                       | 합성 백업 의존성, 실제 예약 아님 |

B4의 최초 다운로드 실패는 Storage 저장 시각 차이로 복원 전용 원장을 보정해 해결했다. 불변 트리거는 독점 잠금·단일 트랜잭션 안에서 복구했다. 마지막 앱 보존 assertion 실패는 정상 `portal_login_stats` 갱신의 허용 목록 누락이었고, 별도 읽기 전용 대조에서 통과했다. 실패 보고서를 덮거나 `app-restore-reconciled-status.json`의 failed만 보고 전체 복원을 재실행하지 않는다.

OS 다운로드 경로·바이트의 종단 확인, 실물 휴대폰, 여러 Next 서버 사이의 경합은 미검증 한계로 유지한다. 전체 회귀 1,148개 통과를 이후 모든 새 소스에 대한 새 전체 통과로 확대하지 않는다.

## 남은 5개와 다음 조건

| 항목 | 실제 완료에 필요한 것                                                                                                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------- |
| M2   | 공식 경로로 확보한 전체 D1 원본·R2 파일·무결성 목록. 문의 17382449는 답변 2건 후 입력 종료됐고 확보 경로가 제시되지 않았다. |
| M3   | M2 원본, 대상 기준 상태와 관리자·세션 보존 계획, 실제 처리 승인 및 권한·자료 대조.                                          |
| B2   | 승인된 운영 연결과 중복 없는 무인 예약 백업 성공 증거.                                                                      |
| B3   | 승인된 외부 보관처·복구 키 분리, 실제 읽기와 복호화 검증.                                                                   |
| O2   | 승인된 발송 인증 연결, SMTP 수락과 실제 수신의 별도 증거, 예약 알림 연결. 현재 local-preview·transportConfigured=false.     |

우선 가능한 일은 새 근거가 있는 로컬 결함의 수정이다. 외부 조건이 없는 상태에서 완료 체크를 늘리지 않는다.

## SMTP 상태를 되돌리지 말 것

지정 합성메일은 발신·수신 `smkim3733@naver.com`, 표시명 `주식회사 한국기업가치평가원`, 제목 `[시험] Partner Hub 백업 알림`, 고객자료·첨부 없는 1통 범위였다. 기존 세 시도는 모두 `smtp-rejected / MAIL_TEST_REJECTED`로 끝났고 자동 재시도는 false다.

| 원장 | 기존 SHA-256                                                       | 추가로 확인된 범위                                                               |
| ---- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| v1   | `9B6462F1CC2699AE47D73E59DBFDA832A19AAC9C6201B463A06C4A11274F0A83` | 상세 거절 단계 없음                                                              |
| v2   | `BB29B5FD22DDAC90BA145F630981667E38B18A2B42CF57B1CEE669A17267084A` | 상세 거절 단계 없음                                                              |
| v3   | `B262C374AF7C37CF58EADCAFF5CAD278D00A7D1ACE8DDE9FC6F5C46962D94D60` | authentication, networkAttempted=true, smtpAccepted=false, receiptVerified=false |

사용자의 발급된 앱 비밀번호 입력 확인과 승인된 두 항목 읽기는 완료됐다. 화면에서 ID `smkim3733` 및 SMTP 사용함 저장 상태를 확인했으며, 전체 주소가 직접 표시된 것은 아니다. 앱 비밀번호 유효성·2단계 인증 상세·정확한 서버 거절 원인은 검증하지 않았다. 새 진단 코드로 과거 원인을 소급해 만들지 않는다.

현재 PC 원장은 `%USERPROFILE%\PartnerHubNotifications\naver-o2-test-v1.json`부터 v3까지다. **원장 원본은 GitHub에 없다.** 새 PC의 원장 부재를 신규 발송 허가로 해석하지 않는다. 원장 삭제·수정, 새 입력창, 네 번째 시도, 재시도 경로 추가, 계정 조회·변경은 자동 실행하지 않는다.

## 개발 환경

Node.js **24.19.0**, pnpm **11.19.0** 기준이다. 새 환경에서만 버전을 확인하고 `pnpm install --frozen-lockfile`로 설치한다. 이 저장소는 앱 코드가 루트에 있으며 `web/` 하위 프로젝트가 아니다. Next.js 버전 등 실제 의존성은 `package.json`과 lockfile을 따른다.

수정 후 필요한 검사 예시:

```powershell
pnpm run typecheck
pnpm exec oxlint scripts/<수정파일>.mjs tests/<관련검사>.test.ts
pnpm exec oxfmt --check scripts/<수정파일>.mjs tests/<관련검사>.test.ts
node --no-wasm-tier-up --wasm-num-compilation-tasks=1 --import ./tests/register.mjs --test --test-concurrency=1 tests/<관련검사>.test.ts
```

위 꺾쇠는 실제 관련 파일명으로 바꾼다. 코드 변경이 없는 인계에서 완료 검사를 반복하지 않는다. `pnpm run verify`는 빌드·브라우저 등 넓은 범위이므로 시작 절차로 실행하지 않는다. 실제 환경파일·자격증명을 불러오는 backup/admin/storage/원격 검증 명령은 별도 범위 확인 없이 실행하지 않는다.

## 게시와 제외 범위

- 개발 소스·테스트·SQL·고정 의존성·비식별 문서를 인계 브랜치에 게시한다. `main` 병합·운영 배포는 이번 범위가 아니다. 기존 `vercel.json`의 해당 브랜치 자동 배포 비활성화를 유지한다.
- 인계 커밋의 `[skip ci]`는 이미 완료한 검사의 자동 반복을 피하기 위한 기존 방식이다. 이번 게시를 새 CI 통과로 표현하지 않는다. 향후 제품 변경·병합 전에는 필요한 검사를 수행한다.
- `.env*` 실제 설정, 키·비밀번호·고객자료, DB/Storage 원본, 암호화 백업·복구 키, 로컬 원장, `work/` 로그·JSON·스크린샷, `node_modules`, 빌드 산출물은 게시하지 않는다. `.env.example` 등 비활성 예제는 포함한다.
- `work/supabase-recovery-live-proof-20261015.json`, `work/mail-safe-diagnostics-20261022.json`, `work/backup-alert-lock-age-fix-20261023.json` 등은 현재 PC에 보존하고, 공유할 결과는 이 문서와 상세 기록으로 전달한다. clone만으로 실제 원본 증거가 이전됐다고 주장하지 않는다.
- Codex의 `partner-hub` 예약은 저장소 파일이 아닌 현재 PC·채팅의 설정이다. Claude로 자동 이전되지 않는다. 같은 checkout의 동시 자동 편집을 피하고, Claude 작업을 Codex가 임의로 덮어쓰거나 커밋하지 않도록 인계한다.

실제 게시 커밋은 `git log -1`과 원격 인계 브랜치를 대조해 확인한다. 문서 안에 자기 자신의 커밋 해시를 고정해 순환 갱신하지 않는다.
