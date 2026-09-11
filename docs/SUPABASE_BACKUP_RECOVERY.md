# Supabase 백업과 격리 복원 검증

대상은 `keve1/partner-hub`의 [공식 서비스](https://partner-hub-gamma-five.vercel.app/)와 Supabase 프로젝트 `yievsveuxjnbygatvjtb`다. 이 도구는 현재 앱의 `partner_hub` 스키마와 지정 비공개 Storage 버킷을 백업한다. 운영 Supabase에 복원하거나 쓰는 모드는 없다.

## 제공 기능

- 공식 PostgreSQL 17 `pg_dump`로 테이블·데이터·함수·트리거·제약조건·소유자·권한을 함께 보존한다.
- 읽기 전용 REPEATABLE READ 트랜잭션의 스냅샷을 `pg_dump`에 전달한다. 앱의 트랜잭션 풀러 6543 대신 같은 Supabase 세션 풀러 5432를 사용한다.
- Storage 버킷 설정, 전체 폴더·페이지·파일을 읽고 경로·크기·실제 파일 SHA-256을 기록한다. 임시 파일과 과거 버전도 빠뜨리지 않는다.
- DB 파일 원장이 참조하는 모든 보존 버전이 실제 백업에 있는지 대조한다. 파일 누락·크기/내용 불일치·불완전한 목록은 실패한다.
- DB 내용·정의의 전후 비교 및 Storage 버전·목록·설정의 전후 비교로 관측된 변경을 감지한다. DB와 Storage를 묶은 원자적 스냅샷은 아니다.
- AES-256-GCM으로 암호화하고 무작위 256비트 복구 키를 별도 폴더에 저장한다. 원본 DB 덤프를 평문 파일로 저장하지 않는다. 백업마다 새 키를 만든다.
- 검증 모드는 암호화 백업을 새 localhost PostgreSQL에 복원한다. 38개 테이블의 정확한 내용과 권한·함수·트리거·제약조건을 대조한 뒤 서버와 평문 임시 폴더를 정리한다.

## 준비 사항

Node.js와 프로젝트 의존성, `pg_dump`·`pg_restore`·`initdb`·`pg_ctl`이 포함된 PostgreSQL 17 바이너리가 필요하다. [PostgreSQL 공식 Windows 다운로드](https://www.postgresql.org/download/windows/)가 연결하는 설치 없는 EDB ZIP도 사용할 수 있다.

Windows의 PostgreSQL 도구 경로는 ASCII 문자만 사용한다. 이 환경에서는 한글 경로에 둔 PostgreSQL이 `initdb` 중 UTF-8 오류로 실패했다. Windows 서버 기동은 관리자 토큰을 제한하는 `pg_ctl`을 사용하며 서비스 등록이나 새 Windows 계정 생성은 하지 않는다.

백업 생성은 기존 Git 제외 `.env.local`의 Supabase 연결 정보를 사용한다. 비밀번호·키를 명령 인수에 입력하지 않는다. 검증 명령은 `.env.local`을 로드하지 않으며 원격 복원 주소를 받지 않는다.

## 실행

프로젝트 루트에서 실행한다. PostgreSQL 경로는 이 컴퓨터에서 실제 확인한 경로다.

```powershell
node --env-file-if-exists=.env.local scripts/supabase-backup.mjs create --pg-bin "C:\Users\smkim\AppData\Local\PartnerHubTools\postgresql-17.11\pgsql\bin"
```

Windows 기본 보관 위치는 사용자 프로필의 `PartnerHubBackups`와 `PartnerHubRecoveryKeys`다. AppData·Codex 캐시·OneDrive 안에 만들지 않는다. 백업과 키를 같은 폴더나 서로 포함되는 폴더에 둘 수 없다. 새 보관 하위 폴더의 접근 권한은 현재 Windows 사용자와 SYSTEM만 허용한다.

생성 결과의 `archiveFile`, `keyFile` 경로를 검증 명령에 전달한다. 아래는 이번에 생성한 백업이다. 경로는 비밀값이 아니지만 키 파일 내용은 표시하거나 공유하지 않는다.

```powershell
node scripts/supabase-backup.mjs verify --pg-bin "C:\Users\smkim\AppData\Local\PartnerHubTools\postgresql-17.11\pgsql\bin" --archive "C:\Users\smkim\PartnerHubBackups\backup-8DlVC6\partner-hub.phbackup" --key-file "C:\Users\smkim\PartnerHubRecoveryKeys\key-qcTpUL\recovery.key"
```

`backup:create`, `backup:verify` 패키지 명령도 같은 CLI를 실행한다. `--help`로 형식을 확인할 수 있다.

## 결과 판독

| 결과                                             | 뜻                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `created-unverified`                             | 암호화 백업 생성 완료. 복원 확인 전                                         |
| `verified-local-postgresql`                      | 별도 로컬 PostgreSQL에서 내용·정의·권한 대조 완료                           |
| `localRestorePlaintextRemoved: true`             | 이번 검증의 평문 임시 폴더와 서버 정리 완료                                 |
| `empty-inventory-verified-no-file-restore-claim` | 원본 파일과 DB 파일 참조가 0건. 실제 파일 복원 성공을 의미하지 않음         |
| `local-byte-restore-verified`                    | 파일을 불투명한 로컬 파일명으로 복원해 실제 바이트 해시 확인                |
| `supabaseStorageRestoreVerified: false`          | 별도 Supabase 버킷으로의 재업로드·접근 시험은 수행하지 않음                 |
| `local-cleanup-required`                         | 서버 종료 또는 임시 폴더 정리 실패. 출력된 정확한 비공개 경로를 확인해야 함 |

복원 비교가 실패하면 내용이나 SQL을 출력하지 않고 달라진 테이블·정의 범주만 표시한다. 백업 파일 변조·잘못된 복구 키·잘린 파일은 복호화 단계에서 거절한다. 정상 중단 신호는 진행 중 작업을 중단하고 정리 경로로 연결한다. 기동 중 중단은 제한 시간 안에 기동 작업이 끝난 후 정리한다. 전원 차단이나 강제 프로세스 종료처럼 처리할 수 없는 중단까지 자동 정리를 보장하지는 않는다.

## 일일 예약 실행

2026-09-11에 현재 Codex 작업의 heartbeat **파트너 허브 일일 백업·복원 검증**(`automation-2`)을 ACTIVE로 등록했다. 실행 시각은 매일 오전 9시, 시간대는 Asia/Seoul이다. 실패 실행 알림을 설정했고 정상 누적에는 반복 보고를 하지 않는다. 예약 등록과 첫 수동 실행 검증은 완료했지만 다음 예약 시각의 무인 실행 및 실제 OS 알림 수신은 아직 관찰 전이다. [OpenAI 공식 예약 안내](https://learn.chatgpt.com/docs/automations?surface=app)에 따라 로컬 파일을 사용하는 동안 PC와 앱이 켜져 있어야 한다. PC가 꺼진 동안 즉시 실패 알림을 보내는 외부 감시 장치는 아니다.

```powershell
node --env-file-if-exists=.env.local scripts/supabase-backup-scheduled.mjs run --pg-bin "C:\Users\smkim\AppData\Local\PartnerHubTools\postgresql-17.11\pgsql\bin"
node scripts/supabase-backup-scheduled.mjs status
```

패키지 명령은 `backup:daily --pg-bin <경로>`, `backup:status`다. 작업 폴더에서 실행한다. 예약은 기존 `.env.local`, Node.js, 프로젝트 의존성 및 PostgreSQL 도구 경로에 의존하며 비밀값을 예약 프롬프트에 저장하지 않는다.

- `run`은 동일 프로세스에서 생성과 격리 복원을 순서대로 실행한다. 검증 해시·대상·38개 테이블·파일 참조·운영 쓰기 0건·평문 정리 완료를 모두 확인해야 성공 기록을 남긴다.
- 제어 폴더는 `C:\Users\smkim\PartnerHubBackups\schedule`이다. 현재 사용자와 SYSTEM만 접근하며 독점 `active.lock`으로 동시 실행을 거절한다. 오래된 잠금도 자동 삭제하지 않는다. 원래 프로세스가 종료됐는지와 `partner-hub-restore-*` 임시 폴더 및 해당 로컬 PostgreSQL을 확인한 뒤 잠금의 정확한 경로·소유 정보를 검토해야 한다.
- 마지막 시도와 마지막 성공을 분리한다. 실패가 이전 정상 백업을 없애지 않는다. 같은 한국 날짜에 성공한 백업이 있으면 암호문 해시와 복구 키의 AES-GCM 인증을 다시 확인하고 생성은 생략한다. 재확인은 별도 기록이며 백업 건수를 늘리지 않는다. 실패 후 재확인에 성공하면 정상 상태로 회복한다.
- `status`도 최신 성공 백업과 키를 실제로 읽어 확인한다. 잠금·미완료 실행, 마지막 실패, 정상 백업 36시간 초과, 손상 또는 키 누락은 정상으로 보고하지 않는다. 실패 명령의 종료 코드는 1이며 오류 원문·DB 값은 출력하지 않는다.
- **30일은 보관 구간 집계 기준이다. 자동 삭제는 하지 않는다.** 이전 검증본·복구 키도 계속 남긴다. 외부 사본 확인 전에는 삭제 정책을 활성화하지 않는다. `retention.inventoryScope`는 예약 실행 기록이며 기존 수동 백업·고아 파일·실제 전체 디스크 파일 수를 뜻하지 않는다. 모든 과거 암호문을 매번 복호화하는 것도 아니며 실물 점검은 최신 성공본에 적용한다.
- 개별 생성·복원 보고서의 `scheduledBackupConfigured: false`는 범용 CLI가 스케줄러를 조회하지 않는다는 뜻이다. 실제 예약 활성 상태는 Codex 자동화에서 별도로 확인한다. 외부 사본과 별도 Supabase Storage 복원은 계속 미확인 상태다.

2026-09-11 20:46 KST에 새 예약 명령을 실제 실행했다. 테이블 38개·전체 9행, 파일 0건을 백업하고 로컬 PostgreSQL에서 내용·권한 대조 및 평문 정리를 완료했다. 업무 데이터 9건이라는 뜻은 아니다. 암호문 SHA-256은 `1e4e9d127c7dc3b618ec79d3f5e65e57395a29c911f88439c10a1bd4c04e75eb`, 파일은 `C:\Users\smkim\PartnerHubBackups\backup-yk2qUB\partner-hub.phbackup`이다. 키 경로와 검증 보고서는 제어 폴더의 `run-da521741-da25-41f8-95b9-0c6407893989.json`에서 확인하며 키 내용은 출력하지 않는다. 같은 날짜의 재실행이 `already-verified-today`, 후속 상태가 `healthy`였고 복원 임시 폴더 0개를 확인했다.

예약 정책 5개와 실행 통합 10개를 포함한 백업 회귀 55개, 변경 파일 lint·서식·전체 TypeScript 검사를 통과했다. 기존 네이티브 PostgreSQL 기동 중 SIGINT 시험도 다시 통과했다. 운영 DB·Storage에 쓰는 시험은 하지 않았다.

## 2026-09-11 실제 검증 기록

- 원본 PostgreSQL 17.6, 공식 도구 PostgreSQL 17.11. 앱 소스 기준 `f35f3d8d1e6b37e74d533fb05b0a0b0581d115ae`.
- 2026-09-11 19:52~19:53 KST에 읽기 전용 백업 생성. 테이블 38개, 전체 8행. 업무 건수 8건이라는 뜻은 아니며 관리자·인증·빈 포털 상태 등을 포함한다.
- Storage 객체·보존 파일 버전·활성 파일 참조·삭제 표시 참조 모두 0건.
- 실제 네이티브 PostgreSQL에 복원 후 테이블 내용·스키마·소유자·ACL·실효 권한·RLS·함수·트리거 대조 일치. 임시 서버 및 평문 폴더 정리 확인.
- 복원 중 SIGINT 및 기동 초기 SIGINT 시험에서 실패 응답과 임시 폴더 정리를 확인했다.
- 합성·PGlite 회귀 40개, 전체 TypeScript, 변경 파일 lint 통과. 로그는 Git 제외 `work/backup-final-tests-20260911.log`다.
- 암호화 파일 SHA-256: `cb3bc9144dd8e95ad6168b416be441f325f898f79d96c3932c0376134c81433e`.
- PostgreSQL ZIP SHA-256: `4b8db0930c38f6ef845db919551dedda3b6b845aeb0927b3d79a6e8e9e4537cf`. [공식 연결의 EDB 바이너리 페이지](https://www.enterprisedb.com/download-postgresql-binaries)에서 받은 17.11 Windows ZIP이다.
- 첫 생성 파일은 Codex가 재지정한 LocalAppData 아래에 만들어졌다. 이후 앱 캐시 밖의 위 사용자 프로필 폴더로 옮겼고 암호화 파일 SHA-256과 제한 ACL을 유지했다. 원래 생성 보고서는 당시 경로를 기록하므로 이동 후 `location-report.json`을 함께 확인한다.

## 아직 별도로 완료할 항목

1. **PC 밖 보관:** 현재 백업과 키는 서로 다른 폴더지만 같은 컴퓨터에 있다. 장치 고장에 대비하려면 암호화 백업 사본과 복구 키를 각각 안전한 외부 보관 위치에 복사하고 실제 읽기·복호화를 확인해야 한다. 복구 키가 없으면 백업을 복호화할 수 없다.
2. **무인 실행 관찰:** 매일 오전 9시 로컬 예약은 등록했다. 첫 예약 실행과 실제 실패 알림 수신을 확인해야 하며 PC 종료 중에도 실행되는 외부 백업 서비스는 아직 없다.
3. **새 Supabase 환경 복구:** 새 프로젝트의 DB·Storage 설정과 서버 비밀값을 준비하고, 검토한 별도 복구 절차로 실제 버킷 재업로드·접근 권한·앱 로그인을 시험해야 한다. 현재 CLI는 원격 복원을 지원하지 않는다.
4. **원본 Sites 이전:** 이번 백업은 새 Supabase 상태의 백업이며 기존 Sites 자료를 확보하거나 이전한 것이 아니다.

Supabase 관리용 스키마 전체, 프로젝트 요금제·비밀값·도메인·플랫폼 설정은 이 앱 백업의 범위 밖이다. 로컬 마이그레이션 SQL과 해시는 암호화 백업 안에 보존한다. 앱 DB의 실제 스키마·데이터는 `pg_dump`로 보존한다. Supabase의 관리용 마이그레이션 기록을 복구할 때는 별도 절차가 필요하다. [Supabase 공식 백업·복원 안내](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)

현재 검증 한도는 DB 내용 인코딩 64MiB, 테이블당 100,000행·전체 1,000,000행, 파일당 25MiB·파일 전체 256MiB, 객체 및 파일 원장 각 10,000건, 암호화 파일 512MiB다. 지원하지 않는 스키마 객체나 한도 초과는 중단한다. 대규모 운영 데이터로 확장하기 전에 스트리밍·보관 정책과 변경 중 백업 절차를 보완해야 한다.
