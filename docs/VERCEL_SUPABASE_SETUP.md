# Vercel + Supabase 연결 안내

현재 대상은 GitHub `smkim3733-gstar/Partner-hub`의 `main`과 Supabase 프로젝트 `yievsveuxjnbygatvjtb`입니다. Turso·Vercel Blob·별도 Cloudflare Worker는 필요하지 않습니다. 기존 Sites 운영과 데이터는 별도로 유지합니다.

## "연결을 확인해 주세요" 원인

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

1. 실제 연결값을 같은 대상의 Git 제외 로컬 설정과 Vercel에 준비합니다. 2026-09-10 확인 시 로컬 키·DB URI·앱 주소는 빈 값이었습니다. Vercel에 로그인해 확인한 `partner-hub`와 `partner-hub-3733` 프로젝트 모두 등록된 프로젝트 환경변수가 없었습니다. `partner-hub`에는 연결된 공유 환경변수도 없었습니다. 두 프로젝트에 같은 업무 DB를 자동 연결하지 말고 실제 사용할 주소를 먼저 선택합니다.
2. PostgreSQL 적용 스키마와 비공개 버킷을 확인합니다. 이 프로젝트의 SQL `0001`~`0019`와 버킷은 준비됐지만 앱의 실제 Supavisor 접속과 파일 전송 검증은 남아 있습니다. `storage:init` / `storage:check`는 **Turso 전용**이므로 실행하지 않습니다.
3. 독립 관리자 최초 설정 및 검사를 완료합니다. `admin:vercel` / `admin:vercel:check`는 명시적인 `supabase-v1` 로컬 설정을 지원합니다. 기본 비밀번호나 기존 Sites 계정을 자동 복제하지 않습니다.
4. 기존 Sites 데이터 이관 또는 신규 빈 서비스 시작 여부를 확정합니다. 빈 DB를 기존 데이터 이관 완료로 간주하지 않습니다. 이관한다면 전체 백업·복원·파일 해시·권한 검증이 먼저입니다.
5. 분리된 검증용 자원과 정확한 Preview 주소에 한해 활성화하여 로그인·승인·자료 업로드/다운로드·FLOW를 검증합니다. 검증 완료 후에만 Production 대상의 활성화와 주소 전환을 진행합니다. Preview/Production에 같은 업무 DB·버킷·관리자 자격증명을 자동 공유하지 않습니다.
6. 환경변수 변경 후 새 배포를 실행합니다. 기존 배포에는 변수 변경이 소급 적용되지 않습니다. [Vercel 환경변수 공식 안내](https://vercel.com/docs/environment-variables)

`PARTNER_HUB_BACKEND_ENABLED=0` 또는 필수값 누락 상태의 API 503은 데이터 보호를 위한 정상 동작입니다. 오류를 없애려고 검사·인증·RLS를 해제하지 않습니다. 상세 증거와 남은 이전 범위는 [Supabase 이전 현황](SUPABASE_MIGRATION.md)을 참고하세요.
