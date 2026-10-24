# Supabase 일시정지 방지와 복구

기준일: **2026-10-24**

## 발생한 일

- 공식 서비스의 `/api/state`가 2026-10-08부터 500을 반환했고, 매일 도는 `Production health`가 계속 실패했다.
- 원인은 Supabase 무료(Free) 프로젝트 `yievsveuxjnbygatvjtb`의 **비활성 자동 일시정지**였다. 일시정지 중에는 프로젝트 도메인이 DNS에서 조회되지 않았다.
- 당시 `Production health`는 하루 1회 실행됐다. 익명 `/api/state`는 인증 전에 포털 상태를 DB에서 읽으므로 DB 조회는 매일 있었지만, 일시정지를 막지 못했다.

Supabase 문서는 정확한 기준을 공개하지 않는다. "지난 1주일 동안 사용자 DB 활동이 충분하지 않으면" 일시정지하며, "보통 하루 몇 번의 DB 요청이면 충분하다"고만 안내한다. [Supabase: Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing)

## 방지 조치

- `.github/workflows/production-health.yml`을 **6시간마다**(00:23·06:23·12:23·18:23 KST) 실행하도록 바꿨다. 실행마다 익명 `/api/state`가 DB를 읽는다. 비밀값이나 쓰기 없이 하루 4회 이상의 DB 조회가 생긴다.
- 이 조치로 일시정지가 막힌다고 아직 확인하지는 못했다. 기준이 비공개이기 때문이다. Supabase는 일시정지 약 1주일 전에 경고 메일을 보내므로, 메일이 오면 대시보드 방문으로 즉시 활동을 만들고 아래 대안을 검토한다.
- 확실한 방지책은 유료(Pro) 요금제다. 유료 프로젝트는 비활성으로 일시정지되지 않는다. 비용 결정 사항이다.
- GitHub는 공개 저장소에서 60일간 커밋이 없으면 예약 워크플로를 비활성화한다. 그 전에 GitHub가 메일로 알리므로, 받으면 워크플로를 다시 켠다.

## 복구 절차 (2026-10-24 실제 수행)

1. Supabase 대시보드에서 프로젝트를 **Resume**한다. 데이터·백업·Storage는 보존되며, 대시보드에 표시된 기한까지 재개할 수 있다(이번에는 2027-11-19).
2. 재개 후에도 `/api/state`가 500이면 Pooler 로그를 확인한다. 이번에는 `password authentication failed for user "postgres"`와 `SecretChecker not started`가 반복됐고, 프로젝트 재시작으로도 해결되지 않았다.
3. Database Settings에서 **DB 비밀번호를 재설정**한다. 연결 문자열에 쓰므로 **영문·숫자만** 사용한다. `@ : / # ?` 같은 문자는 URL 구분자라 앱의 연결 설정 검사(`MIGRATION_BACKEND_NOT_CONFIGURED`, 503)에서 거절된다.
4. Vercel `keve1/partner-hub` → Environment Variables → `SUPABASE_DATABASE_URL`(Secret, Production)을 `postgresql://postgres.yievsveuxjnbygatvjtb:<비밀번호>@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require` 형식으로 저장한다.
5. 최신 Production 배포를 **Redeploy**해야 새 값이 적용된다.
6. `node scripts/check-production-health.mjs`로 7개 항목 통과를 확인한다. 이번 복구 후 7/7 통과했다.

비밀번호를 바꾸면 이전 PC의 로컬 `.env.local`·백업 설정의 연결값도 쓸 수 없다. 새 PC의 Git 제외 `.env.local`에 같은 값을 설정해야 백업을 다시 실행할 수 있다.
