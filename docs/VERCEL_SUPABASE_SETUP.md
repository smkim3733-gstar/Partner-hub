# Vercel + Supabase 연결 안내

**최신 정정(2026-09-11):** 사용자 푸시·배포 요청에 따라 Production의 `PARTNER_HUB_BACKEND_ENABLED=1` 저장을 완료했습니다. 변수는 총 9개(Config 7+Secret 2)이며 새 배포를 진행합니다. 로그인 화면 공개와 업무 데이터 복원은 별개입니다. 관리자 설정과 기존 자료 이관은 남아 있습니다. 아래 활성화 전 순서와 비활성 값은 이전 준비 시점 기록입니다. 최종 배포 검증 결과는 [인계 문서](NEXT_SESSION_HANDOFF.md)를 따릅니다.

**확정 구조:** Next.js는 화면·API·로그인 로직, Supabase는 PostgreSQL·비공개 파일·회원/세션 정보, Vercel은 Next.js 배포와 실행을 담당합니다. 기존 Sites 로그인·Cloudflare D1/R2·Turso·Vercel Blob은 새 운영 연결에 사용하지 않습니다. 현재 독립 로그인은 Next.js 구현이며 Supabase Auth 제품을 도입한 상태는 아닙니다. 기존 자료 수집·이관은 별도 작업이고, 기존 Sites 로그인이나 외부 AI 키가 기본 서비스 개통의 필수 조건은 아닙니다.

현재 대상은 GitHub `smkim3733-gstar/Partner-hub`의 `main`과 Supabase 프로젝트 `yievsveuxjnbygatvjtb`입니다. Turso·Vercel Blob·별도 Cloudflare Worker는 필요하지 않습니다. 기존 Sites 운영과 데이터는 별도로 유지합니다.

2026-09-11 사용자가 지정한 Vercel 대상은 **`keve1/partner-hub`**이며 운영 주소는 **`https://partner-hub-gamma-five.vercel.app`**입니다. Vercel의 Connected Git Repository 및 `main` 운영 배포를 직접 확인했습니다. `partner-hub-3733`에는 이 작업의 DB·비밀값을 설정하지 않습니다. 기본 빌드 명령은 `pnpm run build`이며 공식 Next.js를 실행합니다.

같은 날 기존 Supabase Secret key와 사용자가 제공한 비밀번호를 포함한 DB URI를 Git 제외 로컬 설정에 저장했습니다. 새 세션의 MCP 실제 SQL 조회 및 앱의 `admin-next-remote.mjs --check`를 통한 Supavisor 접속·관리자 테이블 검사가 성공했습니다. 관리자는 아직 미설정입니다. 비공개 버킷 메타데이터 조회 성공은 실제 파일 업로드·다운로드 검증과 구분합니다.

## "연결을 확인해 주세요" 원인

**2026-09-11 최신 저장 상태:** 사용자 승인 후 선택된 `partner-hub` Production에 Config 6개와 `SUPABASE_SECRET_KEY`, `SUPABASE_DATABASE_URL` Secret 2개를 저장하고 확인했습니다. DB URI 저장 성공 알림 및 목록의 Secret 유형·Production 범위를 확인했으며 Preview에는 공유하지 않았습니다. 백엔드는 `0`이고 새 배포는 아직 실행하지 않았습니다. 관리자·데이터 정책·분리된 실제 기능 검증을 마친 후 활성화합니다. 구체적인 순서는 [새 세션 인계](NEXT_SESSION_HANDOFF.md)를 따릅니다.

이 화면은 앱 서버가 초기 설정 검사를 통과하지 못했을 때 표시됩니다. GitHub 연결 자체가 실패했다는 뜻은 아닙니다. 이전 코드는 Vercel에서 백엔드 선택을 생략하면 Turso/Blob을 선택했습니다. 현재 코드는 Supabase를 기본 선택하지만, 명시적으로 설정된 이전 모드는 덮어쓰지 않습니다.

## Vercel 환경변수

Vercel 프로젝트의 Settings → Environment Variables에서 대상 환경을 확인해 설정합니다. 저장소 루트, Next.js, Production Branch `main`을 사용합니다. **로컬 `.env.local`은 Git 제외 파일이며 푸시로 전송되지 않습니다.**

| 이름                          | 값 / 입력 기준                                            |
| ----------------------------- | --------------------------------------------------------- |
| `PARTNER_HUB_NEXT_BACKEND`    | `supabase-v1` (이전 `vercel-storage-v1` 값이 있다면 변경) |
| `PARTNER_HUB_BACKEND_ENABLED` | 준비 단계 `0`; 아래 활성화 조건 확인 후 대상 환경만 `1`   |
| `PARTNER_HUB_APP_ORIGIN`      | 실제 서비스의 정확한 `https://호스트` (경로·끝 `/` 제외)  |
| `SUPABASE_URL`                | `https://yievsveuxjnbygatvjtb.supabase.co`                |
| `SUPABASE_SECRET_KEY`         | 해당 프로젝트의 기존 서버 전용 `sb_secret_...` 키         |
| `SUPABASE_DATABASE_URL`       | 비밀번호가 포함된 아래 Transaction pooler URI             |
| `SUPABASE_STORAGE_BUCKET`     | `partner-hub-private`                                     |

```text
postgresql://postgres.yievsveuxjnbygatvjtb:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require
```

`[YOUR-PASSWORD]`는 실제 DB 비밀번호로 교체하고 비밀번호의 URL 예약문자는 percent-encoding합니다. 이 예제는 접속 가능한 비밀번호를 포함하지 않습니다. Publishable/anon 키는 서버 Secret key를 대신할 수 없습니다. 비밀값은 `NEXT_PUBLIC_*`, Git, 문서, 로그에 넣지 마세요. 키나 비밀번호를 새로 만들거나 재설정할 필요가 있는지는 별도로 확인합니다.

## 활성화 순서

1. 실제 연결값을 선택된 `keve1/partner-hub`의 Git 제외 로컬 설정과 Vercel Production에 준비합니다. `PARTNER_HUB_APP_ORIGIN`은 `https://partner-hub-gamma-five.vercel.app`입니다. Preview 또는 다른 프로젝트에 같은 업무 DB를 자동 연결하지 않습니다. 2026-09-10 두 프로젝트의 환경변수가 비어 있던 기록과, 2026-09-11 로컬 Secret key 확보 이후 상태를 구분합니다.
2. PostgreSQL 적용 스키마와 비공개 버킷을 확인합니다. 이 프로젝트의 SQL `0001`~`0019`와 버킷은 준비됐고 앱의 실제 Supavisor 접속·인증 테이블 검사는 통과했습니다. 전체 무결성 및 실제 파일 전송 검증은 별도로 필요합니다. `storage:init` / `storage:check`는 **Turso 전용**이므로 실행하지 않습니다.
3. 독립 관리자 최초 설정 및 검사를 완료합니다. `admin:vercel` / `admin:vercel:check`는 명시적인 `supabase-v1` 로컬 설정을 지원합니다. 기본 비밀번호나 기존 Sites 계정을 자동 복제하지 않습니다.
4. 기존 Sites 데이터 이관 또는 신규 빈 서비스 시작 여부를 확정합니다. 빈 DB를 기존 데이터 이관 완료로 간주하지 않습니다. 이관한다면 전체 백업·복원·파일 해시·권한 검증이 먼저입니다.
5. 분리된 검증용 자원과 정확한 Preview 주소에 한해 활성화하여 로그인·승인·자료 업로드/다운로드·FLOW를 검증합니다. 검증 완료 후에만 Production 대상의 활성화와 주소 전환을 진행합니다. Preview/Production에 같은 업무 DB·버킷·관리자 자격증명을 자동 공유하지 않습니다.
6. 환경변수 변경 후 새 배포를 실행합니다. 기존 배포에는 변수 변경이 소급 적용되지 않습니다. [Vercel 환경변수 공식 안내](https://vercel.com/docs/environment-variables)

`PARTNER_HUB_BACKEND_ENABLED=0` 또는 필수값 누락 상태의 API 503은 데이터 보호를 위한 정상 동작입니다. 오류를 없애려고 검사·인증·RLS를 해제하지 않습니다. 상세 증거와 남은 이전 범위는 [Supabase 이전 현황](SUPABASE_MIGRATION.md)을 참고하세요.
