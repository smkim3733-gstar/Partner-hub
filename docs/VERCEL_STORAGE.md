# Vercel 연동 저장소 배포 안내

새 배포의 기준 구성은 **Next.js on Vercel + Turso DB + 비공개 Vercel Blob**입니다. 사용자가 GitHub 저장소를 Vercel에 직접 연결해 배포합니다. 별도 Cloudflare 계정·D1·R2·Worker 배포는 필요하지 않습니다. 기존 Sites 운영은 그대로 유지합니다.

## 저장소 선정

- DB: [Vercel Marketplace Turso](https://vercel.com/marketplace/tursocloud/database). 기존 SQLite SQL·JSON 처리·트리거를 유지하기 위해 SQLite/libSQL 호환 연결과 `@libsql/client`를 사용합니다. PostgreSQL로 스키마를 다시 작성하는 방식이 아닙니다.
- 파일: [Vercel 비공개 Blob](https://vercel.com/docs/vercel-blob/private-storage). 공개 Blob 저장소를 선택하지 마세요. 비용·용량·지역·백업 옵션은 실제 서비스 연결 화면에서 확인합니다.
- 기존 Cloudflare HTTP 연결 코드는 Sites 회귀 검증과 이전 설계 기록으로 남아 있지만 새 Vercel 경로에서 사용하지 않습니다.

## GitHub 연결 후 설정

1. Vercel에서 이 저장소의 `main` 브랜치를 연결하고 Production Branch도 `main`으로 지정합니다. Framework는 Next.js, Root Directory는 `package.json`이 있는 저장소 루트입니다. `vercel.json`이 설치·빌드 명령을 지정하며 Git 배포를 차단하던 설정은 제거했습니다.
2. Vercel Marketplace에서 Turso 데이터베이스를 연결합니다. `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`이 연결되는 환경을 확인합니다. 기존 앱 스키마와 호환되는 SQLite/libSQL DB를 사용합니다.
3. Vercel Storage에서 **Private** Blob 저장소를 만들고 같은 프로젝트에 연결합니다. `BLOB_READ_WRITE_TOKEN`을 서버 환경변수로 사용합니다.
4. `.env.example` 기준으로 `PARTNER_HUB_NEXT_BACKEND=vercel-storage-v1`, `PARTNER_HUB_APP_ORIGIN=https://정확한-서비스-주소`를 지정합니다. 주소 끝 `/`는 제외합니다. 처음에는 `PARTNER_HUB_BACKEND_ENABLED=0`으로 유지합니다. 이 상태의 업무 API 503은 의도된 보호 동작입니다.
5. 동일한 대상의 환경변수를 로컬의 무시되는 `.env.local`에만 넣고 아래 명령을 실행합니다. 비밀값은 GitHub·채팅·`NEXT_PUBLIC_*`에 넣지 않습니다.

```text
pnpm storage:check
pnpm storage:init
pnpm admin:vercel
pnpm admin:vercel:check
```

`storage:init`은 대상 주소를 확인받고 새 DB에 102개 스키마 파일을 순서대로 적용합니다. 기존 99개 마이그레이션은 수정하지 않습니다. 파일별 해시·순서와 적용 내역을 기록하며, 각 파일과 기록은 같은 트랜잭션으로 확정합니다. 관리 이력이 없는 기존 스키마는 자동 덮어쓰기하지 않습니다. 운영 관리자 비밀번호는 터미널에서 직접 설정하며 기본 비밀번호·이메일만으로 생성되지 않습니다. `admin:vercel:recover`는 기존 관리자 자격증명과 세션을 안전하게 회수하는 별도 운영자 명령입니다.

6. 신규 빈 서비스로 시작할지, 기존 Sites 데이터를 이관할지 결정하고 완료한 뒤 `PARTNER_HUB_BACKEND_ENABLED=1`로 변경해 다시 배포합니다. 로그인·파트너 승인·자료 제출·상담 FLOW·다운로드를 Preview에서 먼저 확인합니다.

Preview와 Production에는 **분리된 DB·Blob·관리자 자격증명**을 연결하세요. Origin 설정도 각 환경의 정확한 주소를 사용합니다. 다른 Preview 도메인을 자동 허용하지 않습니다. Vercel 계정 로그인이나 유료 자원 생성은 소스 준비에 필요한 조건이 아니며, 이 저장소에는 실제 서비스 키가 포함되지 않습니다.

## 파일 보안과 운영

웹 서버는 첫 DB 접근 전에 적용된 전체 스키마의 순서·해시와 외래 키 강제를 확인합니다. 초기 설정이 누락되었거나 파일 기록이 다르면 업무 저장을 시작하지 않습니다. 웹 요청이 테이블·마이그레이션을 자동 초기화하지 않습니다.

업로드는 서버의 권한·동의 사전 검사 → 경로·크기·기간이 제한된 Blob 업로드 토큰 → 비공개 임시 파일 → 서버의 크기·SHA-256·형식·현재 권한 재검사 → 기존 업무 저장 로직 순서입니다. 원본 바이트는 Vercel 함수의 브라우저 업로드 요청에 실리지 않습니다. 공개 완료 웹훅이나 브라우저가 지정한 URL만으로 업무 기록을 확정하지 않습니다.

확정 파일은 8KiB 형식 헤더와 원본 바이트를 하나의 비공개 Blob에 저장합니다. 이 헤더에 MIME·사용자 메타데이터·SHA-256을 결속해 별도 메타데이터 파일과의 갱신 경쟁을 피합니다. 실제 Blob ETag를 기존 무결성 원장에 기록하며 조건부 쓰기를 유지합니다. 저장소의 원시 객체는 원본 파일과 형식이 다르므로 Blob URL에서 직접 내려받지 말고 앱의 인증된 다운로드를 사용합니다. 보관 현황의 head 조회는 이 작은 형식 헤더를 읽고 취소하며 전체 본문 해시 검증과는 구분됩니다.

다운로드는 매 요청 현재 로그인·담당 권한·삭제 상태를 확인하고 [Vercel 스트리밍 응답](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)으로 원본만 전달합니다. 브라우저에 Blob 읽기 토큰이나 재사용 가능한 공개 URL을 주지 않습니다. 실제 배포에서 최대 크기 파일의 스트리밍도 확인해야 합니다.

임시 업로드 토큰은 10분 유효합니다. 중단·실패한 임시 파일은 즉시 지우지 않고 만료 후 15분 유예를 둡니다. 운영자가 아래 명령으로 목록 수만 확인한 다음 만료된 정확한 임시 경로만 정리할 수 있습니다. 회당 최대 100건이며 확정 원본은 대상이 아닙니다. 자동 정리 작업은 아직 등록하지 않았으므로 정기 정리가 필요합니다.

```text
pnpm storage:cleanup:check
pnpm storage:cleanup
```

## 검증 범위와 남은 작업

로컬 실제 libSQL 드라이버로 전체 스키마·외래 키·트리거·트랜잭션 롤백을 검증합니다. Blob은 SDK 인터페이스의 격리된 모의 저장소로 권한·조건부 쓰기·체크섬·기업자료/FLOW 업로드·재시도·세션 철회를 검증합니다. 이것은 실제 Turso/Blob 계정 연결이나 공개 Vercel 배포 완료를 의미하지 않습니다.

기존 Sites 데이터는 자동 복사하지 않았습니다. 기존 DB/파일 전체 내보내기, 백업, 새 Blob 형식과 ETag 원장 변환, 행 수·첨부 체크섬 대조, 세션 재로그인, 전환·롤백은 별도 이관 작업입니다. DB만 복사하거나 기존 ETag를 그대로 새 Blob에 연결하면 파일 검증이 실패하므로 그렇게 배포하지 마세요. 기존 Sites를 유지한 채 Preview에서 이관 검증을 마친 후 서비스 주소를 전환합니다.
