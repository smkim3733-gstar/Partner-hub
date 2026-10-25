# 전체 업무 흐름 자동 시험

가입부터 사후관리까지 실제 브라우저로 끝까지 진행하고, 단계마다 통과/실패를 표로 남긴다. **운영과 분리된 시험 Supabase 프로젝트 + 이 PC의 로컬 HTTPS 서버**에서만 돈다(운영 주소·운영 프로젝트는 스스로 거부).

## 시험하는 내용

| 구간 | 확인 |
| --- | --- |
| 기준선 | 관리자 로그인, 빈 운영 데이터 선택이 실제로 저장됨 |
| 가입 | 가상 파트너 A·B 가입 신청, 승인 전 로그인 차단 |
| 승인 | 대표가 유형 지정 후 승인 → A·B 로그인 |
| 협업신청 | A가 4단계 신청 + 첨부 2건(기업자료·녹취) 제출 |
| 상담 FLOW | 1차 보고서 → 공동분석(대표·파트너 각각) → 파트너 내려받기 → 초회상담 예약·완료 → 2·3차 → 녹취 전사문 → 4차 → 진행솔루션 → 추가서류 요청·발송·수령·보완·재제출·검토 → 5·6차 → 계약상담 → 계약 체결 → 계약금 일부(대기 유지)·잔액 → 수행·사후관리 (15/15) |
| 권한 분리 | 다른 파트너 B는 A의 FLOW·보고서·파일·기업자료에 403, 비로그인 401, B 화면 데이터에 A 기업 없음, B의 수정 시도 403 |

실행마다 새 가상 파트너·기업 이름(예: `시험기업83643a 주식회사`)을 쓰므로 같은 시험 DB에서 반복 실행할 수 있다. AI는 꺼진 상태로 시험하며 외부로 자료를 보내지 않는다.

## 처음 준비 (한 번)

운영 작업 폴더와 섞이지 않게 **별도 작업 폴더**를 만든다. 이 폴더의 `.env.local`이 시험용 값이 된다.

```powershell
Set-Location D:\dev\Partner-hub
git worktree add D:\dev\wt-flow main
Set-Location D:\dev\wt-flow
npx -y pnpm@11.19.0 install --frozen-lockfile
npx -y pnpm@11.19.0 exec playwright install chromium
```

1. Supabase에서 **새 무료 프로젝트**를 만든다(운영과 다른 프로젝트). 프로젝트 ID(주소의 20글자)와 리전의 풀러 주소(Connect 화면, 예: `aws-0-ap-northeast-1.pooler.supabase.com`)를 확인한다.
2. 대시보드 API Keys에서 secret key **Copy** 후 (시험 DB 비밀번호는 직접 입력):

   ```powershell
   $env:PARTNER_HUB_TEST_PROJECT_REF='<시험 프로젝트 ID>'
   $env:PARTNER_HUB_TEST_POOLER_HOST='aws-0-<리전>.pooler.supabase.com'
   node tools/test-env/save-test-keys.mjs
   node --env-file=.env.local tools/test-env/setup-test-db.mjs
   node --env-file=.env.local tools/test-env/setup-test-admin.mjs
   ```

   스키마 38개 테이블과 비공개 버킷을 만들고, 무작위 시험 관리자 비밀번호를 Git 제외 파일 `.env.test-admin.local`에만 저장한다.
3. 로컬 HTTPS 인증서 (한 번):

   ```powershell
   New-Item -ItemType Directory -Force work\tls | Out-Null
   openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1" -keyout work\tls\local.key -out work\tls\local.pem
   ```

   (OpenSSL은 Git for Windows에 포함된 `C:\Program Files\Git\usr\bin\openssl.exe`를 써도 된다.)

## 실행

창 1 — 시험 서버:

```powershell
$env:NODE_EXTRA_CA_CERTS="$PWD\work\tls\local.pem"
node_modules\.bin\next dev --hostname 127.0.0.1 --port 3443 --experimental-https --experimental-https-key work\tls\local.key --experimental-https-cert work\tls\local.pem --experimental-https-ca work\tls\local.pem
```

창 2 — 시나리오 (로컬→해외 DB라 20~40분 걸릴 수 있다):

```powershell
node tools/business-flow/run.mjs scenario
```

결과는 화면의 `PASS`/`FAIL` 목록과 `work/business-flow/result-<실행ID>.json`, 단계별 화면은 `work/business-flow/shots/`. 앞 단계가 실패하면 그 뒤는 멈춘다. 마지막 실행의 권한 분리만 다시 보려면 `node tools/business-flow/run.mjs isolation`.

## 주의

- 시험 관리자 로그인은 1시간 뒤 만료되며, 스크립트가 알아서 다시 로그인한다.
- 시험 DB는 운영과 같은 Free 플랜 제한(7일 비활성 시 일시정지)을 받는다. 오래 쉬었으면 대시보드에서 Resume 한다.
- 화면 문구나 버튼 이름을 바꾸면 이 시나리오도 함께 고친다.
