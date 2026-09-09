# Supabase 이전 현황

## 목표

Vercel의 Next.js 앱을 프로젝트 `yievsveuxjnbygatvjtb`의 Supabase PostgreSQL과 비공개 Storage에 연결한다. 기존 Sites/Cloudflare 운영 경로와 데이터는 전환 검증이 끝날 때까지 변경하지 않는다.

## 2026-09-09 현재 완료

- Supabase MCP로 프로젝트 URL과 빈 업무 스키마를 확인했다. MCP 재로그인은 현재 필요하지 않다.
- 손상된 개발 의존성을 lockfile 버전으로 재설치했다. 이전 폴더는 로컬 `node_modules/.recovery-20260909`에 보존했다.
- Supabase Next.js 런타임의 DB 타입 오류와 빌드 선택자 거절 오류를 수정하고, 요청 시점에만 DB·Storage 클라이언트를 구성하도록 연결했다.
- 비공개 Storage HTTP 전송, 새 물리 경로에만 쓰기, 저장 후 본문 SHA-256 검증, 기존 R2 형식의 메타데이터·체크섬 읽기를 구현했다.
- Supabase 객체를 직접 덮어쓰지 않고 PostgreSQL의 `storage_object_versions`/`storage_object_heads`로 논리 키를 조건부 교체한다. 경쟁 저장은 하나만 반영된다. 삭제는 복구 가능한 tombstone이며 물리 파일·구버전은 보존한다. 보존 기한 기반 정리는 별도 구현이 필요하다.
- 브라우저 직접 업로드용 서명은 임시 `staging` 경로에만 발급하도록 구현했다. 실제 화면·업로드 예약·완료 처리·세션 재검사 연결은 아직 남아 있다.
- 원격 Supabase에 `partner_hub_private_schema` (`20260909102118`), `storage_object_versions` (`20260909102136`)를 적용했다. 기존 Sites D1/R2와 운영 데이터는 변경하지 않았다.
- 실제 PostgreSQL에서 비공개 스키마 권한, RLS, 조건부 생성·교체, 오래된 삭제 거절, 외래 키, 원장 수정·삭제 금지, 원자적 롤백을 검증했다. 시험 종료 후 두 원장 테이블 모두 0행임을 별도 확인했다. 재실행 SQL은 `tests/supabase-storage-rollback.sql`에 있다.
- Supabase 보안 진단은 정책 없는 RLS 테이블 3개의 INFO만 반환했다. 서버 전용 테이블을 브라우저에 개방하지 않는 의도된 상태다.
- 전체 회귀검사 905건 통과 후 최신 Supabase 검사 17건과 Vercel 접속 주소 검사 5건을 통과했다. TypeScript와 lint, Supabase 모드 Next.js 프로덕션 빌드, 실제 로컬 프로덕션 서버의 HTTP 123건과 서버 비밀정보 번들 유출 검사도 통과했다. 기존 Sites 빌드·클라이언트 번들 제한 검사도 통과했다. HTTP 검사는 백엔드 비활성 상태의 보호 경계 검증이며, 업무 API가 Supabase에서 정상 작동한다는 증거는 아니다.
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

1. PostgreSQL 최종 테이블·인덱스·무결성 함수/트리거 이식
2. PostgreSQL 서버 어댑터를 Supavisor 클라이언트에 연결하고 실제 트랜잭션 회귀검사
3. 21개 DB 쿼리 파일을 PostgreSQL 문법으로 이식하고 원자적 batch/CAS 회귀검사
4. 구현된 Storage 어댑터·임시 서명을 업로드 예약/완료 API와 연결하고 세션·권한 재검증, 대용량 다운로드, 보존 기한 정리 구현
5. 관리자 초기화·로그인·가입 승인·업로드/다운로드 통합검사
6. Supabase에 남은 업무 스키마 마이그레이션 적용, 비공개 버킷 생성 후 Vercel Preview 연결
7. 기존 운영 데이터 백업·변환·복원 대조 및 전환/롤백 검증

## 현재 외부 입력 필요 시점

코드·오프라인 검사는 계속 진행 가능하다. 실제 Supabase 적용 및 Vercel 연결 단계에는 다음 값이 각 서비스의 비밀 저장소에 필요하다.

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
