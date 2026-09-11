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

| 결과 | 뜻 |
|---|---|
| `created-unverified` | 암호화 백업 생성 완료. 복원 확인 전 |
| `verified-local-postgresql` | 별도 로컬 PostgreSQL에서 내용·정의·권한 대조 완료 |
| `localRestorePlaintextRemoved: true` | 이번 검증의 평문 임시 폴더와 서버 정리 완료 |
| `empty-inventory-verified-no-file-restore-claim` | 원본 파일과 DB 파일 참조가 0건. 실제 파일 복원 성공을 의미하지 않음 |
| `local-byte-restore-verified` | 파일을 불투명한 로컬 파일명으로 복원해 실제 바이트 해시 확인 |
| `supabaseStorageRestoreVerified: false` | 별도 Supabase 버킷으로의 재업로드·접근 시험은 수행하지 않음 |
| `local-cleanup-required` | 서버 종료 또는 임시 폴더 정리 실패. 출력된 정확한 비공개 경로를 확인해야 함 |

복원 비교가 실패하면 내용이나 SQL을 출력하지 않고 달라진 테이블·정의 범주만 표시한다. 백업 파일 변조·잘못된 복구 키·잘린 파일은 복호화 단계에서 거절한다. 정상 중단 신호는 진행 중 작업을 중단하고 정리 경로로 연결한다. 기동 중 중단은 제한 시간 안에 기동 작업이 끝난 후 정리한다. 전원 차단이나 강제 프로세스 종료처럼 처리할 수 없는 중단까지 자동 정리를 보장하지는 않는다.

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
2. **정기 실행:** 주기·보관 기간·실패 알림을 결정하고 운영 자동화에 연결해야 한다. 현재 도구를 만든 것만으로 정기 백업이 실행되는 것은 아니다.
3. **새 Supabase 환경 복구:** 새 프로젝트의 DB·Storage 설정과 서버 비밀값을 준비하고, 검토한 별도 복구 절차로 실제 버킷 재업로드·접근 권한·앱 로그인을 시험해야 한다. 현재 CLI는 원격 복원을 지원하지 않는다.
4. **원본 Sites 이전:** 이번 백업은 새 Supabase 상태의 백업이며 기존 Sites 자료를 확보하거나 이전한 것이 아니다.

Supabase 관리용 스키마 전체, 프로젝트 요금제·비밀값·도메인·플랫폼 설정은 이 앱 백업의 범위 밖이다. 로컬 마이그레이션 SQL과 해시는 암호화 백업 안에 보존한다. 앱 DB의 실제 스키마·데이터는 `pg_dump`로 보존한다. Supabase의 관리용 마이그레이션 기록을 복구할 때는 별도 절차가 필요하다. [Supabase 공식 백업·복원 안내](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)

현재 검증 한도는 DB 내용 인코딩 64MiB, 테이블당 100,000행·전체 1,000,000행, 파일당 25MiB·파일 전체 256MiB, 객체 및 파일 원장 각 10,000건, 암호화 파일 512MiB다. 지원하지 않는 스키마 객체나 한도 초과는 중단한다. 대규모 운영 데이터로 확장하기 전에 스트리밍·보관 정책과 변경 중 백업 절차를 보완해야 한다.
