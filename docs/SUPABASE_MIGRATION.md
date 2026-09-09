# Supabase 이전 현황

## 목표

Vercel의 Next.js 앱을 프로젝트 `yievsveuxjnbygatvjtb`의 Supabase PostgreSQL과 비공개 Storage에 연결한다. 기존 Sites/Cloudflare 운영 경로와 데이터는 전환 검증이 끝날 때까지 변경하지 않는다.

## 2026-09-09 현재 완료

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
- Vercel 서버만 DB 연결과 Supabase Secret key를 사용한다. Secret key는 `NEXT_PUBLIC_*`, 채팅, Git, 로그에 넣지 않는다.
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
4. Supabase 비공개 Storage 어댑터와 서명 업로드 완료 검증 구현
5. 관리자 초기화·로그인·가입 승인·업로드/다운로드 통합검사
6. 빈 Supabase 프로젝트에 마이그레이션 적용 후 Vercel Preview 연결
7. 기존 운영 데이터 백업·변환·복원 대조 및 전환/롤백 검증

## 현재 외부 입력 필요 시점

코드·오프라인 검사는 계속 진행 가능하다. 실제 Supabase 적용 및 Vercel 연결 단계에는 다음 값이 각 서비스의 비밀 저장소에 필요하다.

- Supabase DB 비밀번호가 포함된 트랜잭션 풀러 연결 문자열
- Supabase 신형 Secret key
- Vercel 프로덕션 도메인

값은 채팅으로 받지 않는다. Supabase/Vercel 웹 설정 화면에서 직접 등록하고, Codex에는 값이 아니라 “등록 완료”만 알려도 된다.

## 공식 기준 문서

- [Supabase PostgreSQL 연결 방식](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase API key 보안](https://supabase.com/docs/guides/getting-started/api-keys)
- [PostgreSQL Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Storage 접근 제어](https://supabase.com/docs/guides/storage/security/access-control)
- [Storage 스키마 변경 금지 원칙](https://supabase.com/docs/guides/storage/schema/design)
