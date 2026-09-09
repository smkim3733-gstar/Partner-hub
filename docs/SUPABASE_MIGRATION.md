# Supabase 이전 현황

## 목표

Vercel의 Next.js 앱을 프로젝트 `yievsveuxjnbygatvjtb`의 Supabase PostgreSQL과 비공개 Storage에 연결한다. 기존 Sites/Cloudflare 운영 경로와 데이터는 전환 검증이 끝날 때까지 변경하지 않는다.

## 2026-09-09 현재 완료

### FLOW 파일 원장·예약·완료 영수증 PostgreSQL 이식

- `0010_consulting_flow_file_ledgers.sql`을 원격 `20260909125315`로 적용했다. 소유권·메타데이터·객체 무결성·체크섬·업로드 예약·완료 영수증 6개 원장과 동시 슬롯 결속용 예약 명령 키 테이블을 추가했다. 서버 전용 테이블은 총 32개다. 기존 Sites·업무 자료·Storage 바이트는 변경하지 않았다.
- 기존 FLOW 원장의 수정/삭제 금지, `source`에서 `source_archived`로만 변경 가능한 보관 상태, 정확한 예약 구성과 `pending`에서 `ready`로만 변경 가능한 완료 상태를 보존했다. 기업 파일과 달리 FLOW 원장에는 연쇄 삭제 외래 키를 추가하지 않았다. 레거시/고아 증거를 보존하며 소유·출처·체크섬을 임의로 채우지 않는다. 새 대상의 ETag 모드는 NULL을 명시적으로 거절한다.
- 같은 사건·행위자·명령의 두 슬롯은 공통 불변 `consulting_flow_upload_command_keys` 행에 묶인다. `ON CONFLICT`의 행 잠금과 불변성 검사로 서로 다른 지문을 가진 슬롯이 병렬로 삽입되는 것을 방지하는 구조다. 단순 사전 조회만으로 PostgreSQL의 동시 삽입을 보호했다고 간주하지 않는다. **별도 PostgreSQL 세션을 동시에 사용하는 실제 경합 검사는 아직 남았다.**
- 완료 처리에는 실제 명령 ID, 예약과 같은 행위자/지문, 해당 녹취의 두 파일 연결이 필요하다. 재시도에서 새 명령 ID를 사용해도 기존 예약을 재사용할 수 있다. `ready` 변경에는 완료 영수증, 소유·전체 메타데이터·ETag·체크섬과 같은 FLOW 파일 항목이 모두 필요하다. 파일 ID 중복, 잘못된 JSON 형식/타입·중복 키, 소유 원장과 다른 생성시각도 거절한다.
- 공통 파일 SQL을 `lib/consulting-flow-file-sql.ts`로 분리했다. DB 인스턴스에 따라 NULL 비교를 명시적으로 선택하고, PostgreSQL UNION의 숫자 바인딩을 `bigint`로 고정했다. 명령 SQL을 임의 문자열 치환하지 않는다. 기존 SQLite FLOW 회귀검사 188개를 통과했다.
- `reserveFlowUploads`와 `readFlowFileObjectIntegrity`는 PostgreSQL 원장 준비 검사를 사용한다. 예약의 정확한 재사용, 사건/행위자 격리, 재시도 시 원래 신청자료 검토시각 보존, 레거시 metadata 모드의 NULL ETag/체크섬 읽기를 실제 저장 함수와 PGlite로 검사했다. 원장 준비 검사는 전체 FLOW 준비 또는 전체 스키마 해시 확인이 아니다.
- `flowDatabase()`는 PostgreSQL에서 별도의 전체 FLOW 준비 함수를 요구한다. 그 함수는 전체 루트/쿼리 이식 전까지 생성하지 않는다. SQLite 초기화 캐시가 남았다고 미완성 PostgreSQL 루트를 사용할 수 없다. **원격 FLOW 루트 테이블·실제 FLOW 업무 HTTP 경로는 아직 활성화하지 않았다.**
- 로컬 PostgreSQL 집중검사 7개, 전체 회귀검사 947개와 TypeScript·lint를 통과했다. 파일 완료의 긍정 경로와 마지막 단계 실패의 원자적 롤백은 앱 파일 SQL 및 **테스트 전용 로컬 루트 테이블**로 검사했다. 이 테이블은 전체 명령/권한/도메인 보호를 대체하지 않으며, 원격·마이그레이션에 만들지 않았다. Supabase Storage 네트워크·전체 FLOW HTTP 통합 검증으로 취급하지 않는다.
- 실제 Supabase에서 `tests/supabase-flow-files-rollback.sql`로 빈 대상 여부, RLS/역할 권한, 예약 지문·완료 전환 보호, 잘못된 ETag 삽입 시 이전 소유권 쓰기 롤백, 보관 상태 복원 금지를 확인했다. 모든 합성 변경을 롤백하고 신규 7개 테이블 각각 0행을 별도 확인했다. 보안 진단은 의도된 서버 전용 RLS INFO 32건만 반환했다.
- Supabase Next.js 프로덕션 빌드·비활성 API HTTP 123건, 기존 Sites 빌드·번들 검사도 통과했다. 페이지 380,725/460,800바이트, 전체 1,043,435/1,310,720바이트다. Sites 빌드 후 Next 타입 파일을 재생성하고 TypeScript·lint를 다시 통과했다. 실제 운영 배포는 하지 않았다.
- 다음 핵심 작업은 FLOW 명령별 정확한 효과/범위·도메인 참조/AI 증거·권위 있는 행위자 검사와 전체 루트/조회/저장 연결이다. 이후 관리자 재고/통계 쿼리, Supabase 직접 전송, 실제 연결·데이터 이관·Vercel 배포 검증이 남았다. 운영 백엔드는 계속 비활성으로 유지한다.

### 앞서 완료한 FLOW 핵심 보호 함수 1차 이식

- `0009_consulting_flow_core_guards.sql`의 순수 PostgreSQL 함수 7개를 원격 마이그레이션 `20260909122615`로 적용했다. **이 단계는 FLOW 루트 테이블·쓰기 API·준비 완료 판정을 만들지 않는다.** 기존 25개 서버 전용 테이블과 Sites 운영은 그대로다. 함수의 `true`는 핵심 규칙만 통과했다는 뜻이며 전체 명령의 정당성·권한·파일 증거가 검증되었다는 뜻이 아니다.
- 원문을 `json`으로 보존하면서 문자열 바깥의 JSON 공백만 제거한다. 감사·성공 증거·실패 이력은 키 순서, 숫자 표기와 이스케이프 표기까지 비교한다. `jsonb` 동등성으로 기존 불변 기록 검사를 완화하지 않는다. 중첩 객체/배열의 중복 키, 디코딩하면 같은 키가 되는 중복, NUL·짝 없는 서로게이트도 거절한다.
- 사건/담당 신원, 안전 정수 revision과 정확한 다음 revision, 행과 payload의 일치, 최초 명령/감사/작업 주입 금지, 명령의 한 건씩 추가, 감사의 원문 접두부 보존, 영수증의 신원·표시 의미·대상 보존과 새 명령 증거 연결을 구현했다.
- AI 작업의 25가지 상태 쌍, 실행 시작/완료 시각, 고정 출처·신원, 성공 증거 불변성, 실패 증거를 지우기 전 정확히 한 번 이력에 추가하는 규칙을 검사한다. 새 작업은 새 명령과 같은 감사·생성시각에 묶이며 4차 작업은 최신 녹취와 최신 1차 보고서를 참조해야 한다. 내부 AI 결과 감사와 사용자 명령 감사, 재시도 감사의 개수·신원을 구분한다.
- 테스트는 `db/schema.ts`에서 선택한 기존 UPDATE 트리거 24개를 실제 SQLite에서 실행하고 네이티브 함수 결과와 비교한다. 이는 **289개 트리거 전체나 FLOW HTTP 경로의 이식 완료 검사가 아니다.** 단독 SQLite 수명주기 트리거는 완료 `reportId`/`evidence` 누락에서 SQL UNKNOWN을 반환해 거절하지 않는 경우가 있어 이를 명시적으로 고정하고, PostgreSQL 함수는 필드 누락을 거절한다. 기존 앱의 전체 의미 검증과 분리된 단독 트리거 결과를 운영 취약점으로 단정하지 않는다.
- 전체 회귀검사 940개(로컬 PostgreSQL 집중검사 6개 포함)와 TypeScript·lint를 통과했다. 원격에서도 `tests/supabase-flow-core-probe.sql`로 실제 함수 실행, 브라우저 역할 실행 권한 회수, SECURITY DEFINER 미사용, 일부 보호만 적용된 FLOW 테이블 부재를 확인했다. 시험은 변수와 카탈로그만 사용하고 업무 행·계정·파일을 만들지 않는다. 후속 조회에서 명단·AI 실행·Storage 버전은 각각 0행이었다.
- 원격 보안 진단은 기존 25개 RLS 테이블의 `rls_enabled_no_policy` INFO만 반환했다. Supabase Next.js 프로덕션 빌드·비활성 API HTTP 123건, 기존 Sites 빌드·번들 검사도 통과했다. 페이지 번들은 380,725/460,800바이트, 전체 1,043,435/1,310,720바이트다. 이 검사는 운영 백엔드 활성화나 Vercel 배포 검증과 다르다.
- 다음 필수 단계: 명령별 정확한 변경 범위와 효과, 도메인 객체/참조/AI 증거의 전체 의미, 권위 있는 행위자 확인, FLOW 파일·업로드 완료 원장, 루트 트리거 및 조회/저장 SQL 연결. 전체 컬렉션 상한에서의 성능, 독립 DB 세션 경쟁과 실제 FLOW HTTP 경로도 통합 단계에서 검사해야 한다. 이 단계들이 완료되기 전 `PARTNER_HUB_BACKEND_ENABLED=0`을 유지한다.

### AI Step 0 실행 원장 PostgreSQL 이식

- 원격 `ai_diagnosis_runs` 마이그레이션 `20260909115528`을 적용했다. 서버 전용 테이블은 총 25개다. 실제 AI 실행·계정 생성·운영 자료 이관은 하지 않았다.
- 사건별 생성 중 요청은 한 건만 허용하고, 동일 요청 재시도·다른 내용의 요청 충돌·5분 만료 잠금·완료 결과 재사용·실패 기록 보존을 유지한다. 완료와 실패 상태의 기록은 같은 값의 UPDATE를 포함해 다시 수정하거나 삭제할 수 없다.
- 원장 신원, UTC 밀리초 시각, 요청 지문, 제공자 요청·모델·메시지 ID, 사용량 범위, 결과의 필수 키·문자열·배열·UTF-8 바이트 상한을 PostgreSQL 함수와 트리거로 검증한다. JSONB 변환 전 중복 키가 사라지는 문제를 피하려고 검증에는 `json`을 사용한다. 중복 루트/후보 키, 보이지 않는 제어문자, 잘못된 Unicode와 범위 초과도 거절한다.
- 실행 저장 함수는 PostgreSQL에서 런타임 DDL 대신 스키마 준비 함수를 확인하고, 지문 조회를 PostgreSQL JSON 문법으로 분기한다. 기존 Sites SQLite 경로는 유지했다. 준비 확인은 테이블/RLS·트리거·부분 고유 인덱스 유무 검사이며 전체 스키마 해시 검증은 아니다.
- PGlite와 실제 관리자 비밀번호 인증을 통해 Step 0 HTTP 경로를 실행했다. 기업 원본 원장·바이트 확인, 결과 저장/조회, 동일 요청에서 제공자 중복 호출 없음, 생성 중 동의 철회 시 실패 처리와 후속 호출 차단을 확인했다. 제공자 응답과 Storage 바이트는 모의 객체다. **실제 Anthropic API·Supabase Storage 네트워크·다중 PostgreSQL 세션 경쟁 검증은 아니다.**
- 전체 회귀검사 934개와 TypeScript·lint를 통과했다. 로컬 SQL 검사에는 원장 직접 변조·결과 크기/형식/사용량·고유 잠금·트랜잭션 롤백도 포함한다.
- Supabase Next.js 프로덕션 빌드와 비활성 API 보호 HTTP 123건, 기존 Sites 빌드·번들 검사를 통과했다. 페이지 번들 380,725바이트, 전체 1,043,435바이트로 기존 제한 안이다. 실제 운영 배포는 하지 않았다.
- 실제 Supabase에서 `tests/supabase-ai-rollback.sql`을 실행해 비공개 권한, 사건별 잠금, 완료 기록 불변성, 사용량 제한, 실패 전이의 롤백을 검증했다. 모든 합성 변경을 롤백한 뒤 AI 실행·관리자·명단이 각각 0행임을 별도 확인했다. 이 검사는 업무 데이터가 있는 대상에서는 실행을 거절한다.
- 최신 보안 진단은 25개 서버 전용 RLS 테이블의 `rls_enabled_no_policy` INFO만 반환했다. 외부 AI 정책·API 키·Vercel 운영 설정은 변경하지 않았다.
- 남은 핵심 DB 작업은 상담 FLOW 루트의 명령·감사·AI 작업 상태 전이, FLOW 전용 파일/완료 영수증 원장, 관리자 재고 및 충돌·중복 통계 쿼리다. Step 0 완료를 FLOW 전체 준비로 취급하지 않는다.

### 앞서 완료한 초안·기업 원본파일 PostgreSQL 이식

- 원격 Supabase에 `application_drafts` (`20260909113623`), `company_file_ledgers` (`20260909113630`)를 적용했다. 이 단계의 서버 전용 테이블은 24개였으며 실제 계정·업무 자료·Storage 바이트는 생성하거나 이관하지 않았다.
- 초안은 소유 계정, 정확한 다음 revision, 현재 draft ID, 삭제 후 재사용 금지, 영구 삭제 기록을 유지한다. PostgreSQL에서는 요청 중 DDL 대신 `assert_draft_schema()`를 확인한다. 실제 비밀번호 인증과 초안 HTTP 경로로 계정 격리·동일 요청 재시도·오래된 초안 제출 거절을 검사했다.
- 기업 파일의 변경 불가 원본 메타데이터와 6개 하위 원장, 영구 업로드 영수증을 이식했다. 부모 삭제만 하위 원장을 연쇄 삭제하며 영수증은 남는다. `pending→ready→deleted`의 단방향 상태와 삭제 재시도, 기존 request key 이전 규칙을 보존한다. 레거시 행에 소유 계정·체크섬·사건 연결을 임의로 채우지 않았다.
- 기존 integrity CHECK가 `etag` 모드에서 NULL ETag를 허용하던 SQL의 UNKNOWN 허점을 새 빈 대상 스키마에서 닫았다. `metadata` 모드의 NULL ETag와 소유 원장이 없는 레거시 이름 접근은 유지한다. 브라우저 역할 접근과 서버 역할의 TRUNCATE 권한은 열지 않았다.
- 업로드 저장 함수, 파일 다운로드·삭제 경로, 신청 원본 선택 필터와 명단 저장 내부의 원본 연결 검사에 PostgreSQL 분기를 추가했다. 명단 CAS는 JSON 동등성이 아닌 정확한 텍스트를 비교한다. 문서 배열 형식이 잘못된 경우 삭제를 허용하지 않는다.
- 최초 명단 CAS의 바인딩 순서를 후속 저장과 통일해 원본 검사가 식별자가 아닌 제안 payload를 검사하도록 수정했다. PostgreSQL 최초 INSERT의 text/jsonb 파라미터 추론 충돌도 명시적 text 캐스트로 해결했다. SQLite와 PostgreSQL 모두 최초 저장 회귀검사를 추가했다.
- 전체 회귀검사 927개를 통과한 뒤 레거시 NULL 원장 다운로드·삭제, 파일 조회 도중 계정 정지, SQLite 최초 저장 검사 3개를 추가해 각각 통과했다. PostgreSQL 파일 통합 7개, 초안 2개, 원격 롤백 SQL 로컬 실행 1개를 포함한다. TypeScript·lint와 Supabase Next.js 프로덕션 빌드·비활성 API HTTP 123건을 통과했다.
- 기존 Sites 빌드와 클라이언트 번들 검사도 통과했다. 페이지 380,725/460,800바이트, 전체 1,043,435/1,310,720바이트다. Sites·Vercel 운영 배포는 실행하지 않았다.
- 실제 Supabase에서 `tests/supabase-draft-file-rollback.sql`로 초안 수명주기, 원장 변경·직접 삭제 금지, 트랜잭션 롤백, 부모 연쇄 삭제, 영수증 보존, RLS·권한을 검사했다. 모든 합성 변경을 롤백한 뒤 새 9개 테이블 각각 0행임을 별도 확인했다. 기존 업무 데이터가 존재하면 실행을 거절하는 초기 대상 전용 검사다.
- 당시 보안 진단은 24개 서버 전용 RLS 테이블의 `rls_enabled_no_policy` INFO만 반환했다. 이는 브라우저 접근 정책을 열지 않은 의도된 상태이며 전체 앱 보안 완료 판정이 아니다.
- 파일 통합검사의 DB는 실제 PostgreSQL 엔진인 PGlite, 바이트 저장소는 메모리 R2 대체물이다. **Supabase Storage HTTP·브라우저 직접 전송·전체 `/api/files` 업로드 HTTP 경로 검증은 아직 아니다.** 해당 경로에 결합되는 FLOW 스키마/쿼리 이식, 다중 DB 세션 경쟁, 실제 Supavisor·Storage 연결 검사가 남았다. 스키마 준비 함수도 전체 제약조건 해시 검증을 대체하지 않는다.

### 앞서 완료한 인증·기본 명단 PostgreSQL 이식

- 원격 Supabase에 `authentication` (`20260909110358`), `portal_state` (`20260909110412`), `password_link_metrics` (`20260909110426`)를 추가 적용했다. 이 단계의 서버 전용 테이블은 15개였다. 관리자 계정이나 실제 업무 명단은 생성·이관하지 않았다.
- 관리자 최초 설정·로그인·세션 교체·만료·로그아웃·운영자 비밀번호 복구, 파트너 가입·승인 후 로그인·일회용 비밀번호 재설정·접근 철회 SQL을 PostgreSQL에서 실행했다. 기존 Sites SQL은 DB별 분기로 보존한다.
- 모든 PostgreSQL 요청/batch는 첫 데이터 쿼리 전에 `SERIALIZABLE` 격리를 설정한다. 동시 변경 충돌은 전체 트랜잭션 실패로 처리하며, 결과 불명인 쓰기를 자동 재실행하지 않는다. `bigint`는 안전한 JavaScript 정수 범위만 수용하고 범위 초과를 거절한다.
- 명단은 원문 JSON 텍스트를 유지해 정확한 CAS 비교를 보존한다. 고정 루트 ID, JSON 객체, UTF-8 900,000바이트 상한, UTC 밀리초 시각, 루트 삭제 금지와 로그인 통계의 30분 집계 규칙을 이식했다. PostgreSQL 멤버 조회는 중복 ID 및 문자열이 아닌 ID·이메일·상태를 거절한다.
- 요청 중 PostgreSQL DDL을 실행하지 않는다. 인증·명단은 사전 적용된 스키마의 테이블/RLS/필수 트리거 유무를 확인한다. 이 확인은 전체 스키마 해시·모든 제약조건 무결성 감사와 동일하지 않다. AI·파일·초안 스키마까지 준비되었다고 판정하지 않는다.
- `admin:vercel:check`, `admin:vercel`, `admin:vercel:recover` 운영자 경로에 Supabase 연결 분기를 추가했다. 비밀번호는 기존 대화형 입력을 사용하며 공개 초기화 API·기본 비밀번호는 없다. 실제 자격증명이 없으므로 원격 운영자 CLI 접속은 아직 검증하지 않았다.
- 테스트 전용 PGlite 0.5.8에서 실제 PostgreSQL 엔진·저장 SQL·마이그레이션을 실행했다. 비밀번호 처리 통합검사는 합성 환경값과 메모리 DB를 사용하며 실제 Supavisor·Storage 네트워크 연결은 사용하지 않는다. PGlite는 단일 연결이므로 독립 세션 간 경합 시험을 대체하지 않는다.
- 전체 테스트 918개와 추가 원격 인증 롤백 SQL 로컬 재검증 1개를 통과했다. TypeScript·lint·Supabase Next 프로덕션 빌드와 비활성 API 경계 HTTP 123건, 기존 Sites 빌드도 통과했다.
- 실제 Supabase에서 `tests/supabase-auth-rollback.sql`을 실행해 RLS/권한·복구 중복 영수증 실패의 원자적 롤백·기록 삭제 금지·명단 보호·로그인 집계 간격을 확인했다. 별도 후속 조회에서 관리자·세션·복구 기록·명단·로그인 통계가 모두 0행임을 확인했다. 이 SQL은 기존 계정·명단이 있으면 실행을 거절하는 초기 대상 전용 검사다.
- 당시 보안 진단은 서버 전용 RLS 테이블 15개의 `rls_enabled_no_policy` INFO만 반환했다. 브라우저 역할 접근을 열지 않는 의도된 상태이며 전체 앱 보안 검증 완료를 의미하지 않는다.

### 앞서 완료한 Storage 기반

- Supabase MCP로 프로젝트 URL과 빈 업무 스키마를 확인했다. MCP 재로그인은 현재 필요하지 않다.
- 손상된 개발 의존성을 lockfile 버전으로 재설치했다. 이전 폴더는 로컬 `node_modules/.recovery-20260909`에 보존했다.
- Supabase Next.js 런타임의 DB 타입 오류와 빌드 선택자 거절 오류를 수정하고, 요청 시점에만 DB·Storage 클라이언트를 구성하도록 연결했다.
- 비공개 Storage HTTP 전송, 새 물리 경로에만 쓰기, 저장 후 본문 SHA-256 검증, 기존 R2 형식의 메타데이터·체크섬 읽기를 구현했다.
- Supabase 객체를 직접 덮어쓰지 않고 PostgreSQL의 `storage_object_versions`/`storage_object_heads`로 논리 키를 조건부 교체한다. 경쟁 저장은 하나만 반영된다. 삭제는 복구 가능한 tombstone이며 물리 파일·구버전은 보존한다. 보존 기한 기반 정리는 별도 구현이 필요하다.
- 브라우저 직접 업로드용 서명은 임시 `staging` 경로에만 발급하도록 구현했다. 실제 화면·업로드 예약·완료 처리·세션 재검사 연결은 아직 남아 있다.
- 원격 Supabase에 `partner_hub_private_schema` (`20260909102118`), `storage_object_versions` (`20260909102136`)를 적용했다. 기존 Sites D1/R2와 운영 데이터는 변경하지 않았다.
- 실제 PostgreSQL에서 비공개 스키마 권한, RLS, 조건부 생성·교체, 오래된 삭제 거절, 외래 키, 원장 수정·삭제 금지, 원자적 롤백을 검증했다. 시험 종료 후 두 원장 테이블 모두 0행임을 별도 확인했다. 재실행 SQL은 `tests/supabase-storage-rollback.sql`에 있다.
- 이 기반 단계에서는 전체 회귀검사 905건 통과 후 Supabase 검사 17건과 Vercel 접속 주소 검사 5건을 통과했다. 기존 Sites 빌드·클라이언트 번들 제한 검사도 통과했다. 최신 수치는 위 인증 이식 절을 따른다. HTTP 123건은 백엔드 비활성 상태의 보호 경계 검증이며, 모든 업무 API가 Supabase에서 정상 작동한다는 증거는 아니다.
- `pnpm run test:next:supabase`와 Supabase 전용 GitHub CI 작업을 추가했다. 실제 자격증명 없이 합성 값만 사용한다.

이하 항목은 이 단계 이전에 완료한 기반 작업이다.

- GitHub `origin/main`의 Next.js/Vercel 최신 소스(`822be29`)를 로컬에 동기화했다.
- `codex/supabase-migration` 브랜치를 만들었다.
- `supabase-v1` 백엔드 선택과 서버 전용 환경변수 검증 모듈을 추가했다.
- API URL, 프로젝트 ref, Supavisor 트랜잭션 풀러 포트 `6543`, 비공개 버킷 이름, 신형 `sb_secret_` 키 형식을 서로 묶어 검증한다.
- `.env.example`을 Supabase 대상 기준으로 바꿨다. 실제 비밀번호와 Secret key는 소스에 넣지 않는다.
- 브라우저 역할 `anon`/`authenticated`가 접근할 수 없는 `partner_hub` 스키마 기반 마이그레이션을 시작했다.
- 설정 모듈의 정상·실패 닫힘 검사를 Node 내장 TypeScript 실행으로 통과했다.
- D1 번호형 바인딩과 결과 형식을 보존하는 PostgreSQL 어댑터 골격을 추가했다. batch는 단일 트랜잭션과 `SET LOCAL search_path`를 사용한다.
- 아직 이식하지 않은 SQLite JSON/DDL/`IS ?n` 문장은 네트워크 요청 전에 거절한다. 바인딩·트랜잭션·실패 닫힘 검사를 통과했다.
- PostgreSQL 클라이언트 `postgres` 3.4.9를 고정했다. Supavisor 트랜잭션 모드에서 prepared statement를 끄고 연결 수 1, 연결/유휴 제한, 60초 연결 수명, 트랜잭션별 25초 statement timeout과 5초 lock timeout을 적용했다.
- 설정·어댑터·클라이언트 신규 단위검사 7건이 통과했다. GitHub `codex/**` CI가 별도로 전체 타입·회귀검사를 수행한다.

## 발견한 호환성 경계

현재 업무 DB는 SQLite/libSQL 전용이다. 최종 스키마 상수 25개, 순차 마이그레이션 99개, 트리거 선언 289개와 `json_each`, `json_extract`, `json_set`, `julianday`, 번호형 `?1` 바인딩을 사용한다. Supabase PostgreSQL 연결 문자열만 교체하면 실행되지 않으며, 무결성 검사를 우회하거나 데이터가 부분 저장될 수 있다.

따라서 기존 SQL을 런타임 문자열 치환으로 억지 실행하지 않는다. PostgreSQL 스키마·함수·트리거와 쿼리를 명시적으로 이식하고 회귀검사로 기존 거절 규칙을 비교한다.

## 보안 모델

- 업무 테이블은 Data API 기본 노출 대상인 `public`이 아니라 `partner_hub` 스키마에 둔다.
- `anon`, `authenticated`, `public` 권한을 회수한다.
- 각 테이블에 RLS를 활성화하되 브라우저 직접 접근 정책은 만들지 않는다.
- Vercel 서버만 DB 연결과 Supabase Secret key를 사용한다. Secret key는 서버 비밀 저장소에서만 읽고 `NEXT_PUBLIC_*`, Git, 로그에 넣지 않는다.
- Storage 객체 조작은 Storage API로만 수행한다. `storage` 스키마를 직접 변경하지 않는다.
- 기존 앱 세션·역할·Origin 검사와 원본 SHA-256 원장을 유지한다.

## 환경변수

```text
PARTNER_HUB_NEXT_BACKEND=supabase-v1
PARTNER_HUB_BACKEND_ENABLED=0
PARTNER_HUB_APP_ORIGIN=https://<vercel-production-domain>
SUPABASE_URL=https://yievsveuxjnbygatvjtb.supabase.co
SUPABASE_SECRET_KEY=<Vercel server-only secret>
SUPABASE_DATABASE_URL=<Supavisor transaction pooler 6543 URL>
SUPABASE_STORAGE_BUCKET=partner-hub-private
```

`PARTNER_HUB_BACKEND_ENABLED`는 PostgreSQL 스키마, 관리자, 비공개 버킷, 데이터 이관 시험, Vercel Preview 검사가 모두 통과하기 전까지 `0`을 유지한다.

## 다음 자동 진행 순서

1. 상담 FLOW 및 FLOW 전용 파일 원장 테이블/인덱스/명령·AI 작업 무결성 함수·트리거 이식
2. 남은 업무·관리자 파일 재고 쿼리를 PostgreSQL 문법으로 이식하고 원자적 batch/CAS 회귀검사
3. 실제 Supavisor 연결·독립 다중 세션 경합·최종 스키마 무결성 검증
4. 구현된 Storage 어댑터·임시 서명을 업로드 예약/완료 API와 연결하고 세션·권한 재검증, 대용량 다운로드, 보존 기한 정리 구현
5. 이미 검증한 인증 흐름에 업로드/다운로드·관리자 원격 CLI를 결합해 실제 저장소 통합검사
6. Supabase에 남은 업무 스키마 마이그레이션 적용, 비공개 버킷 생성 후 Vercel Preview 연결
7. 기존 운영 데이터 백업·변환·복원 대조 및 전환/롤백 검증

## 현재 외부 입력 필요 시점

코드·오프라인 검사 및 MCP를 통한 스키마 적용은 계속 진행 가능하다. 앱의 실제 DB/Storage 연결과 Vercel 배포 단계에는 다음 값이 각 서비스의 비밀 저장소에 필요하다.

- Supabase DB 비밀번호가 포함된 트랜잭션 풀러 연결 문자열
- Supabase 신형 Secret key
- Vercel 프로덕션 도메인

실제 값은 Vercel 환경변수 또는 Git에서 제외된 로컬 `.env.local`에 등록한다. MCP 접속 승인과 애플리케이션 실행용 자격증명은 별개다. 현재 로컬에는 `.env.example`만 있으며, 실제 Storage HTTP 업로드와 앱의 Supavisor 연결은 아직 검증하지 않았다.

## 공식 기준 문서

- [Supabase PostgreSQL 연결 방식](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase API key 보안](https://supabase.com/docs/guides/getting-started/api-keys)
- [PostgreSQL Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Storage 접근 제어](https://supabase.com/docs/guides/storage/security/access-control)
- [Storage 스키마 변경 금지 원칙](https://supabase.com/docs/guides/storage/schema/design)
- [PostgreSQL 트랜잭션 격리](https://www.postgresql.org/docs/18/transaction-iso.html)
- [postgres.js 정수 타입 설정](https://github.com/porsager/postgres)
- [PGlite 테스트 엔진 API](https://pglite.dev/docs/api)
