# 독립 배포 준비와 운영 전환 순서

> 이 문서는 이전 Worker 패키지 설계 기록입니다. 새 Vercel 배포에는 적용하지 않습니다. 현재 기준은 [Vercel 저장소 연결 안내](VERCEL_STORAGE.md)이며 사용자가 GitHub를 Vercel에 연결해 배포합니다.

2026-09-08: **로컬 패키지 준비와 격리 검증 단계입니다. 실제 계정 연결·배포·데이터 이관은 완료되지 않았습니다.** 기존 Sites 운영 설정과 원본 SQL 99개를 보존합니다. Next 실행·인증 경계는 [독립 운영 연결 기록](NEXT_REMOTE_BACKEND.md)을 참고하세요.

## 먼저 필요한 대상 정보

`infra/standalone/target.example.json`은 의도적으로 비어 있습니다. 실제 값을 알고 있는 운영자가 Git에서 제외된 `private/preview-target.json` 등에 작성합니다. 값은 다음과 같습니다.

- 환경: `preview` 또는 `production`.
- Vercel 프로젝트 ID, 팀/개인 조직 ID, 고정 HTTPS 서비스 origin.
- Cloudflare 계정 ID, Workers 하위 도메인, 기존 대상 D1 ID/이름, R2 버킷 이름, 독립 Worker 이름 세 개.

**비밀번호·API 토큰·서비스 비밀값은 이 파일에 넣지 않습니다.** 허용하지 않은 필드는 거절하며 입력값을 오류 메시지에 출력하지 않습니다. 대상 ID를 추측하거나 기존 Sites 바인딩 이름 `DB`/`AI_SOURCE_FILES`를 실제 리소스 ID로 취급하지 않습니다.

현재 준비 도구는 `<worker>.<선택한 하위 도메인>.workers.dev` 주소만 만듭니다. 사용자 도메인/DNS는 자동 설정하지 않습니다. Vercel의 임의 배포별 URL과 고정된 `PARTNER_HUB_APP_ORIGIN`은 같지 않을 수 있으므로 실제 Preview에서 URL·Origin·쿠키 흐름을 검증해야 합니다.

ID/버킷 이름이 없는 Wrangler 바인딩은 자동 리소스 생성으로 이어질 수 있습니다. 도구는 빈 ID와 자리표시자 ID를 거절하고 명시적 바인딩을 생성합니다. **형식 검사는 실제 리소스 존재·소유권·기존 운영과의 분리를 증명하지 않습니다.** [Cloudflare 자동 프로비저닝](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)

## 오프라인 명령

대상 파일 검사만 수행할 때:

```sh
pnpm run deployment:prepare --target private/preview-target.json --check
```

새 패키지 파일을 만들 때:

```sh
pnpm run deployment:prepare --target private/preview-target.json
```

다른 환경의 대상 파일도 확보한 경우:

```sh
pnpm run deployment:prepare --target private/preview-target.json --compare-target private/production-target.json
```

두 환경의 앱 origin, 동일 계정 내 DB·버킷·Worker 이름 중복을 거절합니다. 비교 파일이 없으면 `comparedEnvironment: false`로 표시하며 환경 분리 확인을 주장하지 않습니다. Vercel 프로젝트 자체는 같은 프로젝트의 Preview/Production 환경을 쓸 수 있으므로 공유를 무조건 금지하지 않습니다. 대신 실제 환경변수의 DB·파일 대상 분리를 확인해야 합니다.

이 명령에는 `--deploy`, `--enable`, 자동 자원 생성 모드가 없습니다. 셸 환경이나 dotenv에서 서비스 비밀값을 읽지 않습니다. 프로젝트 파일을 수정하거나 Vercel 프로젝트를 연결하지 않고, 새로운 `work/standalone-*` 디렉터리만 생성합니다. 기존 패키지는 덮어쓰지 않습니다.

## 생성되는 패키지

- `d1/`, `r2/`, `files/`: 각 `worker.mjs`와 `wrangler.json`. 격리 검사와 같은 빌더로 만든 실제 ESM 코드입니다. 지원하지 않는 외부 패키지 참조는 거절합니다.
- `next-environment.json`: 고정 주소·런타임 선택·비활성화 상태만 포함합니다. Vercel에 자동 등록하지 않습니다.
- `required-secret-names.json`: 서비스별 필요한 비밀값의 **이름만** 포함합니다.
- `schema/original/`: 원본 SQL 99개의 바이트 그대로인 보관본.
- `schema/standalone/`: 새 대상 전용 관리자 스키마. 자동 실행하지 않습니다.
- `target.json`, `manifest.json`, `READ-ME-FIRST.txt`: 대상 정보·파일별 크기/SHA-256·준비 상태 및 주의사항.

manifest는 손상 여부를 대조할 수 있는 파일 목록이지 서명된 배포 승인이나 데이터 이관 증거가 아닙니다. 실제 운영 코드의 출처는 검증한 Git 변경분·커밋과 패키지 해시를 함께 기록해야 합니다. 부분 생성/실패한 디렉터리는 사용하지 않습니다.

모든 실행 플래그는 `0`, 외부 AI 처리는 `false`입니다. Worker의 추가 preview URL·로그 저장·Logpush·추가 파일 탐색은 꺼집니다. 필수 secret 이름을 선언하고 세 서비스는 다른 비밀값을 사용합니다. 준비한 설정의 재배포는 비활성 플래그를 다시 적용하므로 운영 중인 Worker에 무심코 덮어씌우면 안 됩니다.

파일 Worker와 D1 Worker는 같은 대상 DB, 파일 Worker와 R2 Worker는 같은 대상 버킷에 연결됩니다. 패키지에는 계정 전체 관리 토큰, 세션, 고객 데이터, 업로드 원본이 없습니다.

## 비밀값 등록은 배포와 구분

실제 계정과 대상이 확인되면 D1/R2 서비스 인증값과 파일 권한 암호화 키를 각각 생성해 서버/해당 Worker의 비밀값 저장소에 등록합니다. 비밀값을 채팅·명령행 인수·Git에 넣지 않습니다. D1/R2 비밀값을 브라우저로 보내거나 파일 권한 키와 재사용하지 않습니다.

`wrangler secret put/delete`는 단순 로컬 설정이 아니라 새 버전을 바로 배포할 수 있습니다. 버전 전용 secret 명령과 코드 업로드/배포 단계의 차이를 확인하고 기존 활성 버전을 보존합니다. [Cloudflare secret 변경 동작](https://developers.cloudflare.com/workers/configuration/secrets/#secrets-on-deployed-workers)

Vercel의 프로덕션 업로드가 기존 도메인에 바로 연결되지 않도록 단계별 배포를 사용해야 합니다. `--prod --skip-domain`은 자동 도메인 연결을 미룰 수 있지만 프로덕션 환경에서 실행되는 배포 자체를 취소하는 옵션은 아닙니다. 활성화된 운영 데이터 연결을 먼저 분리해야 합니다. 이 작업에서 해당 명령은 실행하지 않았습니다. [Vercel 도메인 연결 보류](https://vercel.com/docs/cli/deploy#skip-domain)

## 원본·비밀값 업로드 방지

`.vercelignore`에 `.wrangler`, `work`, `outputs`, `private`, `backups`, `data`, `uploads`, 환경 파일과 키/DB/로그 파일 제외를 추가했습니다. Next 컴파일·타입 검사에 필요한 소스는 유지합니다. 이 설정은 지정된 경로를 제외하는 방어이며, 임의 위치에 놓인 고객 파일까지 자동 분류하는 보장은 아닙니다. 실제 CLI 업로드 직전 파일 목록과 Git 변경분을 다시 검토해야 합니다. [Vercel 제외 파일 설정](https://vercel.com/docs/deployments/vercel-ignore)

## 검증

```sh
pnpm run test:deployment:package
```

Node 24.19.0과 잠금 파일의 Wrangler를 사용합니다. 합성 대상 JSON으로 실제 준비 명령을 실행하고 다음을 검사합니다.

1. 검사 전용 모드의 쓰기 없음, 파일별 SHA-256/크기, SQL 보관본 99+2개의 원본 바이트 일치(standalone 관리자·복구 기록 스키마).
2. 실제 생성 설정과 Worker 코드 세 종류에 `wrangler deploy --dry-run --no-autoconfig` 적용. 업로드는 하지 않습니다.
3. 생성된 비활성 설정을 네이티브 Worker로 읽어 모두 `503` 반환 확인.
4. 격리 환경에서만 활성화한 실제 패키지의 스키마 적용, D1 트랜잭션 롤백, R2 조건부 저장·SHA-256·본문·삭제 검사.
5. 실제 패키지의 파일 Worker에 기존 네이티브 권한·무결성·FLOW 검사 40개 적용.

2026-09-08 관리자 복구 스키마 추가 후 위 검사와 전체 단위 테스트 885건, TypeScript·lint 검사를 통과했습니다. 합성 패키지는 Git 제외 경로에 보관하며 실제 업로드·운영 쓰기는 수행하지 않았습니다. CI에 같은 검사를 추가했지만 원격 CI의 실행 결과를 대신하지 않습니다.

## 실제 전환에서 남은 게이트

1. 대상 계정/조직의 접근 권한과 리소스 소유권을 확인합니다. 기존 Sites 리소스를 새 대상이라고 가정하지 않습니다. 비용이 생기는 새 리소스가 필요하면 범위를 확인합니다.
2. 기존 Sites 데이터의 공식 내보내기 경로를 확보합니다. 일관된 시점의 DB 스키마·행·불변 원장·파일 목록과 본문을 확보하고 해시/개수/크기를 기록합니다. 소스 SQL만으로 실제 데이터 백업을 대신하지 않습니다.
3. 별도 대상에 복원하고 DB 무결성·참조·회원 권한·파일 키/ETag/크기/SHA-256를 대조합니다. 원장 값을 억지로 수정해 대조를 통과시키지 않습니다. 기존 세션·비밀번호의 이관/폐기 정책도 확정합니다.
4. 관리자 독립 인증의 복구, 필요 MFA, 실제 Vercel의 쿠키·Origin·분산 요청 제한을 확인합니다. 장시간 AI 작업은 중단·재시도·중복 처리 검증 전까지 비활성화합니다.
5. Preview에서 역할별 가입/조회/수정/파일 업무를 검증합니다. 미검증 운영 DB를 Preview에 연결하지 않습니다.
6. 변경 동결·최종 동기화·검증된 버전 활성화·업무 확인 순서로 전환합니다. 이중 쓰기를 허용하지 않고 전환 전후 발생한 쓰기의 처리 계획을 남깁니다.
7. 롤백 시에는 먼저 새 사이트 쓰기를 멈추고 신규 변경의 보존/역이관 필요 여부를 확인합니다. 단순 URL 복귀가 데이터 롤백을 의미하지 않습니다. 기존 사이트와 검증된 백업을 보존한 상태로 복원 시험을 완료해야 합니다.

현재 실제 대상 계정과 데이터 내보내기 경로가 없으므로 이 운영 게이트들은 완료되지 않았습니다. 코드·dry-run·합성 데이터 통과만으로 공개 운영 전환을 승인하지 않습니다.
