# Supabase 이전 현황

## 목표

Vercel의 Next.js 앱을 프로젝트 `yievsveuxjnbygatvjtb`의 Supabase PostgreSQL과 비공개 Storage에 연결한다. 기존 Sites/Cloudflare 운영 경로와 데이터는 전환 검증이 끝날 때까지 변경하지 않는다.

## 2026-09-10 현재 완료

### 공개 Storage 서버 응답 규격 대조와 독립 회귀검사

- Supabase Storage 공개 소스 `7d7757dc971ed83e6d8bcc42a61497428b7a84a0`을 기준으로 HTTP 응답 규격을 대조했다. [InfoRenderer](https://github.com/supabase/storage/blob/7d7757dc971ed83e6d8bcc42a61497428b7a84a0/src/storage/renderer/info.ts)는 `bucket_id`를 반환하므로 버킷 일치 검사를 완화하지 않았다. 이 공개 커밋이 현재 프로젝트에 배포된 버전이라는 의미는 아니다.
- [AssetRenderer](https://github.com/supabase/storage/blob/7d7757dc971ed83e6d8bcc42a61497428b7a84a0/src/storage/renderer/asset.ts)는 `If-Match`를 저장소 백엔드에 전달하지 않는다. 따라서 요청 헤더만으로 조건부 읽기가 보장된다고 간주하지 않는다. 기존 앱의 실제 응답 ETag·길이·MIME·압축 여부 및 스트림 길이/SHA-256 검증을 유지하고, 해당 이유를 코드 주석에 기록했다. ETag가 앱의 SHA-256과 같아야 한다는 가정도 추가하지 않았다.
- 기존 업무용 모의 저장소와 별도로 `tests/supabase-storage-http-contract.test.ts`에 6개 검사를 추가했다. 불일치 ETag인데도 HTTP 200을 돌려주는 제공자, 응답 본문 취소, 잘린/초과/손상된 바이트, multipart 형태의 불투명 ETag, 누락된 버킷/권한 거절을 파일 부재로 오인하지 않는 경계를 확인했다. [공개 Renderer의 400/NoSuchKey 응답](https://github.com/supabase/storage/blob/7d7757dc971ed83e6d8bcc42a61497428b7a84a0/src/storage/renderer/renderer.ts)도 별도 검사했다.
- 신규 6개와 기존 Storage 6개 집중검사 **12/12**, 전체 직렬 회귀검사 **1027/1027**(실패/건너뜀 0건, 약 304초), TypeScript·lint·변경 파일 서식 검사를 통과했다. 전체 로그는 `work/supabase-storage-contract-final-tests.log`다. 이번 변경은 테스트·주석·문서뿐이며 실제 앱 로직, 적용 SQL, 비밀키, 운영 데이터, 배포 설정을 바꾸지 않았다. 실행 로직 변경이 없어 Next/Sites 빌드를 다시 실행하지 않았고 직전 빌드 증거는 아래 1021건 단계에 남겼다. **공개 소스와 합성 HTTP 검사이며 실제 프로젝트의 업로드·DB 연결 검증을 대신하지 않는다.**

### 실제 비공개 Storage 버킷 생성과 DB 연결 화면 확인

- 기존 Supabase 대시보드의 로그인 세션과 정확한 프로젝트를 확인했다. MCP 재로그인이나 새 API 키 생성은 하지 않았다. 비밀키가 포함된 전체 화면의 로컬 내보내기는 보안 검토에서 차단됐다. 우회하지 않고, 기존 Secret key 하나만 Git 제외 `.env.local`에 저장하는 별도 승인을 요청했다. 실제 `.env.local`과 프로세스의 앱용 키/DB 연결값은 아직 없다.
- Supabase 대시보드에서 `partner-hub-private` 버킷을 생성했다. **`public=false`, `file_size_limit=26214400`, `allowed_mime_types=["application/octet-stream"]`**를 원격 읽기 전용 SQL로 다시 확인했다. Storage 테이블을 SQL로 직접 생성·수정하지 않았다. 공개/회원 업로드 정책을 추가하지 않았으며 `storage.objects` RLS는 활성이고 해당 정책은 0개다.
- 생성 후 버킷 객체, 포털 명단, FLOW, 기업 파일, Storage 버전, 직접 전송 예약은 각각 0행이다. 업무 테이블 38개 모두 RLS를 유지한다. 기존 Sites 운영과 원본 데이터는 변경하지 않았다. **버킷 설정 완료이며 앱의 실제 Storage HTTP 전송·Supavisor 접속·Vercel 배포 검증 완료가 아니다.**
- Vercel용 `Transaction pooler`를 선택한 연결 화면에서 호스트 `aws-0-ap-southeast-1.pooler.supabase.com`, 포트 `6543`, 사용자 `postgres.yievsveuxjnbygatvjtb`, DB `postgres`를 확인했다. DB 비밀번호는 `[YOUR-PASSWORD]` 자리표시자이므로 실제 값 입력이 필요하다. 비밀번호를 재설정하거나 새 DB 계정을 만들지 않았다. 연결 화면을 사용자에게 열어두고 `.env.example`에는 공개 연결 구조만 기록했다.
- 이번 변경은 실제 빈 버킷과 설정 안내뿐이다. 앱 코드·적용 마이그레이션·의존성은 그대로이며 직전 소스 검증은 아래 1021건을 따른다. 파일 정리 코드는 아직 추가하지 않았다. 실제 연결을 확보한 뒤 임시 파일과 복구 원본을 분리해 검증한다.

#### 보존·정리 경계

- 앱 제출 만료 10분과 Storage 서명의 유효기간은 다르다. `0019`의 `retain_until`(등록 후 133분)이 지나지 않은 staging은 삭제 대상이 아니다. 만료 여부만으로 실제 업로드 중단·최종 원본 복구·삭제 완료까지 증명했다고 간주하지 않는다.
- 최종 `partner-hub/objects/v1/` 객체, 불변 Storage 버전, tombstone 이전 버전, 실패/경쟁 쓰기의 미참조 원본은 자동 삭제하지 않는다. 백업·이관/롤백 증거와 명시적인 보존 정책을 먼저 확정해야 한다.
- 물리 삭제는 [Supabase Storage API](https://supabase.com/docs/guides/storage/management/delete-objects)로만 수행한다. DB 메타데이터 삭제는 파일 삭제를 대신하지 않으며 Storage의 물리 삭제는 복구할 수 없다. 이번 작업에서는 파일/예약/원장을 삭제하지 않았다.

### 기존 Sites 데이터의 읽기 전용 이전·복원 사전 검사

- 원본 Sites DB 목록 30개를 확인했고 누락/잘림은 없었다. 그러나 `portal_state` 행 본문은 `truncated_values=1`로 잘려 반환됐다. 조회가 끝났다는 표시를 무손실 백업 증거로 사용하지 않았다. 구형 `portal_chatgpt_member_bindings`를 포함한 모든 원본 표를 보존 대상으로 등록했다.
- `scripts/check-sites-snapshot.mjs`에 `inspect`/`compare`만 제공한다. 동결된 독립 SQLite 사본을 읽기 전용으로 열고 원본 마이그레이션 99개의 정확한 스키마·전체 표·기본 SQLite 검사·타입/바이트 기반 해시를 대조한다. JSON 원문, 64비트 정수, 인접 실수, NULL/BLOB/UTF-8을 손실 정규화하지 않는다. 비밀번호·세션·본문·이메일·원본 경로는 출력하지 않는다.
- 긴 본문, 중복 JSON 키, UTF-8/NUL, 비표준 키/날짜, 빠진/추가/변경 표, 외래 키, 악성 CHECK/view, WAL/SQL 입력, 행 제한, 복원본 차이와 종료 코드를 포함한 집중검사 **15/15**가 통과했다. 로그는 `work/sites-snapshot-focused-tests.log`다. 도구에는 가져오기·삭제·강제 통과·배포 기능이 없으며 실제 운영/원격 테이블은 변경하지 않았다.
- 전체 회귀검사는 `--test-concurrency=1`로 **1021/1021**, 실패/건너뜀 0건, 약 311초에 통과했다(`work/sites-snapshot-final-tests.log`). TypeScript·lint·변경 파일 서식 검사도 통과했다. 직접 전송 절의 1006건은 직전 단계 기록이다.
- Supabase Next.js 프로덕션 빌드·비활성 API HTTP 123건·인증/비밀키 경계 검사(`work/sites-snapshot-next-build.log`), 기존 Sites 빌드(`work/sites-snapshot-sites-build.log`)와 번들 한도(페이지 380725/460800, 전체 1043430/1310720바이트)를 통과했다. Sites 빌드 후 Next 타입을 다시 생성했다. 앱 소스·의존성·적용 SQL·운영 배포는 변경하지 않았다.
- **이 단계는 실제 백업과 PostgreSQL 복원 완료가 아니다.** 모든 결과의 `migrationReady=false`를 유지한다. 원본 전체 사본·R2 바이트, 역사 FLOW의 별도 복원 경로, 인증 결속, Supavisor/Storage/Vercel 검증이 남았다. 상세 조건·종료 코드·분류·안전한 절체/역방향 데이터 보존은 [Sites 데이터 이전 사전 검사](SITES_DATA_MIGRATION_PREFLIGHT.md)를 따른다.

### Supabase 브라우저 직접 업로드·완료 API와 기존 업무 저장 연결

- `0019_direct_file_transfers.sql`을 원격 `20260909164931`로 적용했다. 서버 전용 RLS 전송 예약 테이블 한 개를 추가해 총 38개다. `service_role`에는 SELECT/INSERT만 허용하고 UPDATE/DELETE 및 브라우저 접근은 막았다. 예약은 세션 해시·사용자·정확한 명세/명령 본문·서버 생성 staging 경로·만료/보존시각에 결속한다. 실제 원문 세션/Storage 서명/서비스 키는 저장하지 않는다. 기존 `0001`~`0018`은 변경하지 않았다. 적용 SHA-256: `28BE921900F55F7B6D6BE500E32BAD8F7AAE990CA357194FAD82FD0278CFBDEA`.
- Next.js `supabase-v1` 빌드는 직접 업로드 기능과 Supabase 전용 브라우저/서버 전송 모듈을 선택한다. 기존 `/api/blob-transfers` 주소는 호환되는 JSON 제어 주소로 유지하며 실제 Vercel Blob 서비스는 사용하지 않는다. 브라우저 파일 바이트는 Supabase의 임시 경로로 직접 PUT하고, Vercel에는 명세와 완료 요청 JSON만 보낸다. 기본 업무 multipart 업로드는 계속 거절한다.
- 발급 전 실제 독립 로그인·제출 동의·업무 역할·담당/사건·FLOW 명령/대상/현재 revision을 검사한다. 서명은 서버가 만든 무작위 staging 경로에만 발급하고 덮어쓰기를 허용하지 않는다. 브라우저는 모든 슬롯의 URL·프로젝트 호스트·경로·메서드·헤더·만료를 먼저 검증하며 쿠키/서비스 키/임의 헤더를 Storage에 전달하지 않는다. 잘못된 추가 필드나 외부 URL/완료 callback은 업무 저장을 시작할 수 없다.
- 버킷은 비공개, `allowed_mime_types=["application/octet-stream"]`, 정수 `file_size_limit` 1~26214400바이트여야 서명을 발급한다. 기존 25MiB 기능을 전부 쓰려면 26214400으로 설정한다. Supabase 서명은 [공식 Storage SDK의 2시간 유효기간](https://github.com/supabase/storage-js/blob/master/src/packages/StorageFileApi.ts)을 따른다. 앱의 제출 허용시간은 10분이며, 서명 요청 지연 2분과 시계 여유 1분까지 고려해 등록 후 133분 동안 사용자당 최대 20개 예약을 계산한다. 새 로그인으로 한도를 우회하지 못한다. 서명 자체에 정확한 파일 크기/해시가 묶였다고 간주하지 않는다.
- 완료 API는 브라우저가 제출한 경로/URL을 쓰지 않고 불변 예약을 읽는다. 현재 인증/권한을 재검사한 뒤 private Storage의 정보·조건부 GET·실제 길이·SHA-256을 검증하고 원래 기업/FLOW 저장 함수를 호출한다. 파일 서명/동의·revision·업로드 예약·완료 영수증·최종 권한 및 원자성 검사는 유지된다. 최종 물리 객체 검증이 지연돼도 업무 저장 직전에 제출 유효시간을 다시 검사한다. 실패 시 남은 임시/최종 객체나 예약은 임의로 삭제하지 않는다.
- **브라우저 업로드가 직접 전송된다는 뜻이지 서버가 파일을 전혀 읽지 않는다는 뜻은 아니다.** 최종 확정 시 Vercel 서버가 임시 바이트를 읽고 무결성을 확인하며 기존 Storage 어댑터로 별도 불변 최종 객체와 조건부 포인터를 저장한다. 다운로드는 매 요청 기존 권한/원장 검사를 거치는 비공개 스트리밍 응답이다. 실제 Vercel 배포에서의 응답 한도·지연·CORS·Supabase 네트워크 검증은 아직 남아 있다.
- 새 집중검사 10개가 실제 PostgreSQL 엔진(PGlite), 독립 관리자/파트너 로그인, 실제 Storage HTTP/버전 원장 어댑터와 모의 HTTP 바이트 저장소를 결합한다. 브라우저 전송 함수의 4.5MiB 초과 기업 파일, FLOW 전사문 5MiB+음성 25MiB, 두 슬롯 중 하나 누락 시 전체 업무 저장 차단, 완료 재시도, 25MiB 다운로드 해시, 손상/외부 경로/세션 교체·철회/중간 권한 변경/서명 중 철회/만료 직전·최종 저장 중 만료/사용자별 한도/자동 재전송 없음까지 통과했다(`work/supabase-0019-transfer-final-tests.log`). 실제 Supabase 바이트·브라우저 UI·독립 DB 세션 시험은 아니다.
- `tests/supabase-transfer-rollback.sql`을 로컬 PostgreSQL에서 먼저 검증하고 원격 `service_role`로 실행했다. 합성 예약 한 개, 수정/삭제 금지, 중복 경로·최종 객체 경로·짧은 보존기간 거절을 검사한 뒤 전부 롤백했다. 후속 조회에서 예약·기업 파일·FLOW·명단·관리자·Storage 버전은 각각 0행이다. 새 테이블은 RLS 활성, `anon`/`authenticated` 읽기 불가, 서버 INSERT 가능/UPDATE 불가다. 보안 진단은 서버 전용 [RLS 정책 없음 INFO](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) 38건뿐이며 경고/오류는 없었다.
- 최종 전체 검사는 **1006/1006**, 건너뜀 0건이며 `work/supabase-0019-serial-final-tests.log`에 보존했다(약 307초). `--test-concurrency=2` 검사 중 Node/V8 `Check failed: jit_page_->allocations_.erase(addr) == 1` 내부 오류로 `supabase-flow-domain.test.ts` 프로세스가 종료됐다. 원인은 확정하지 않았고 앱이나 기대값을 변경하지 않은 `--test-concurrency=1` 전체 재실행으로 통과했다. 앞선 메모리 부족 오류와 동일 원인이라고 단정하지 않는다. 후속 무거운 PostgreSQL 전체 검증도 직렬 실행을 우선한다.
- 최종 Supabase Next.js 프로덕션 빌드·비활성 API HTTP 123건·독립 인증/비밀키 경계가 통과했다(`work/supabase-0019-final-next-build.log`). 검사기는 서버에 Supabase 전송 테이블 코드가 포함되고 Vercel Blob 전송 테이블은 없으며, 브라우저에는 Supabase staging 전송 코드만 있고 서버 전용 테이블/키는 없는지도 확인한다. 기존 Sites 빌드(`work/supabase-0019-final-sites-build.log`), 번들 한도(페이지 380725/460800, 총 1043430/1310720바이트), Next 타입 재생성 후 TypeScript·lint도 통과했다.
- 이번 경로는 표준 서명 PUT이다. [Supabase가 6MB 초과에서 권장하는 TUS 재개 전송](https://supabase.com/docs/guides/storage/uploads/standard-uploads)은 아직 구현하지 않았으며 네트워크 장애 뒤 자동 이어올리기로 표현하지 않는다. 실제 연결의 지연/안정성 확인, 만료 staging 및 불변 버전 보존/정리, 역사 자료 이관/롤백, Vercel Preview/운영 검증이 남았다. 백엔드는 계속 비활성이며 실제 계정/파일 생성이나 운영 배포는 하지 않았다.

### 관리자 파일 재고·원본 존재 확인·문서 연결 복구

- `0018_file_inventory_read_helpers.sql`을 원격 `20260909162113`으로 적용했다. 안전한 JSON 파싱과 중복 키 확인을 위한 읽기 전용 함수 두 개만 추가했다. `SECURITY INVOKER`와 고정 `search_path`를 사용하고 PUBLIC/브라우저 역할의 실행 권한을 회수했다. 테이블은 서버 전용 RLS 37개 그대로이며 기존 `0001`~`0017`은 변경하지 않았다. 적용 파일 SHA-256: `84F0148D53580A6E0DEACC249D1A2F5380230B4DE4246CF0A2D69875E6787BA1`.
- `lib/file-inventory-postgres.ts`에 PostgreSQL 전용 목록/존재 SQL을 구현했다. SQLite SQL을 문자열 치환하지 않으며 사용자 필터/커서는 바인딩한다. 동일한 CTE로 파일 소유권·메타데이터·무결성·체크섬·예약/완료 영수증·FLOW payload와 명령/감사/대상을 확인한다. 목록에는 본문·전사문·저장 키·해시·토큰을 노출하지 않는다.
- 원장 일부나 소유권이 사라져도 payload/하위 원장/완료 영수증의 고아 항목을 한 번씩 유지한다. 손상된 JSON과 중복 키는 조회 전체를 중단하거나 고아 파일을 숨기지 않는다. 기업/FLOW 같은 ID 충돌은 두 항목 모두 불일치·증명 없음으로 표시한다. 다섯 상태·25개 커서 페이지·필터와 독립적인 전체 저장 증명 집계를 유지한다.
- 현재 원본 확인은 기존 관리자 권한과 파일 원장 검사를 유지하고 `head` 정보만 비교한다. 영수증 행위자/지문/대상/감사 상세 또는 파일 슬롯이 변조되면 저장소를 조회하기 전에 차단한다. PostgreSQL 기업 파일의 비표준 저장 키는 목록에서 불일치로 표시하고 존재 확인/복구는 차단한다. 기존 사용자 키를 자동 재작성하지 않으며 별도 이관 사전검증이 필요하다.
- 문서 연결 복구의 PostgreSQL JSON/NULL 비교와 최종 조건부 갱신을 연결했다. 명시 확인·사유·관리자 신원·정확한 사건/파일 버전·안정 담당 ID·활성 담당자·기존 참조 부재를 다시 검사한다. 직접 API 호출에서도 ID 충돌을 원본 조회 전에 거절하고 최종 갱신에서 FLOW 소유/메타데이터/무결성/체크섬/예약/완료 및 payload 참조를 재확인한다. 문서와 감사 이력은 함께 저장되며 정확한 재시도는 한 번만 기록된다. 바이트 삭제나 담당자 재배정은 하지 않는다. 기존 PostgreSQL 어댑터는 모든 작업을 SERIALIZABLE 트랜잭션으로 수행하지만 독립 세션 경합 실증은 별도다.
- 새 네이티브 집중검사 7개가 실제 독립 관리자/파트너 로그인, 21종 실제 FLOW 명령과 첨부, metadata-only/NULL ETag 레거시, 실패 롤백/재시도/오래된 최종 CAS, 모든 주요 영수증 변조, 원장 누락/JSON 손상/충돌/페이지 경계를 검사한다. 전체 **996/996**, 건너뜀 0건으로 통과했다(`work/supabase-0018-final-tests.log`, 약 166초, `--test-concurrency=2`). PGlite는 실제 PostgreSQL 엔진이지만 단일 연결이며 Storage 바이트는 모의 객체다.
- 원격에서 앱이 내보내는 실제 목록/존재 SQL을 `service_role`로 실행했다. 빈 목록/존재 결과와 합성 metadata-only 기업 파일의 미연결 목록/집계를 확인하고 모든 시험 쓰기를 롤백했다. 후속 조회의 기업 파일·FLOW·명단·관리자·Storage 버전은 각각 0행이고 새 함수의 `anon`/`authenticated` 실행 권한도 0건이다. 보안 진단은 의도된 서버 전용 [RLS 정책 없음 INFO](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) 37건뿐이며 경고/오류는 없었다. 실제 Storage 바이트나 운영 계정을 만들지 않았다.
- Supabase Next.js 프로덕션 빌드·비활성 API HTTP 123건·인증/비밀키 번들 경계(`work/supabase-0018-next-build.log`), 기존 Sites 빌드(`work/supabase-0018-sites-build.log`), 번들 한도(페이지 380725/460800, 총 1043430/1310720바이트), Sites 빌드 후 Next.js 타입 재생성과 TypeScript·lint를 통과했다. UI는 저장 원장과 현재 원본의 제공자 중립 문구를 쓰며 본문 검증과 존재 확인을 구분한다.
- **0018 시점의 다음 항목:** 대용량 직접 전송 API(위 `0019`에서 연결), 실제 Supavisor/Storage·독립 세션 경합, 비표준 키/날짜 및 역사 자료 이관/롤백, Vercel 배포 검증. 운영 백엔드는 `PARTNER_HUB_BACKEND_ENABLED=0`이며 기존 Sites 운영과 공개 배포는 변경하지 않았다.

### 중복·충돌·복구 및 관리자 진행 통계 연결

- `0017_portal_operational_metrics.sql`을 원격 `20260909154846`으로 적용했다. 기존 `0001`~`0016`은 수정하지 않았다. 중복 요청·저장 충돌·익명 복구 영수증·복구 집계의 네 테이블을 추가해 서버 전용 RLS 테이블은 총 37개다. `anon`과 `authenticated`의 스키마 접근은 없고, 새 함수도 `SECURITY INVOKER`와 고정 `search_path`를 사용한다.
- PostgreSQL 경로는 요청 중 SQLite DDL을 실행하지 않고 적용된 스키마를 확인한다. 한국 날짜·1~30일 집계·기존 집계 차원·용량 충돌 제외 규칙을 유지한다. 사용자·회사·파일·요청 키·원문은 집계에 추가하지 않았다.
- 복구 영수증은 원문 토큰 대신 SHA-256 해시만 저장하며, 발급과 분모 증가가 하나의 트랜잭션이다. PostgreSQL에서는 영수증 소비·복구 건수/시간 구간 증가·만료 정리를 한 함수 호출로 처리한다. 중간 실패는 영수증 삭제까지 롤백해 재시도를 보존한다. 출처/역할 결속·한 번만 소비·정확한 24시간 만료·동일 차원 5건 미만의 시간 구간 비공개를 유지한다. 영수증은 통계용이며 업무 승인이나 사용자 인증을 대신하지 않는다.
- `readConsultingFlowMetricRows`도 PostgreSQL 전용 축약 SQL에 연결했다. 1차 상담 완료·최신 1차 보고서·공동 분석 확인·서류 접수/검토에 필요한 필드만 반환하며 보고서 본문·전사문·저장 키·명령 영수증은 반환하지 않는다. 기존 Sites SQL은 유지했다.
- 집중 검사 10개가 통과했다. 독립 관리자/파트너 로그인 후 실제 FLOW 명령 재시도와 `/api/state`까지 검증하여 중복 요청 집계가 더 이상 조용히 실패하지 않고, 관리자 집계가 `null`로 대체되지 않으며 파트너 응답에는 포함되지 않음을 확인했다. 원자적 실패 주입, 소비 재시도, 만료 경계, 시간 구간, RLS/권한, 스키마 미준비 시 업무 응답 보존도 검사했다. PGlite는 단일 연결이며 독립 PostgreSQL 세션 경합 검증은 아직 아니다.
- 원격 `tests/supabase-metrics-rollback.sql` 검사는 `service_role`로 시험 집계·잘못된 역할 거절·정상 소비·재사용 거절을 실행하고 전부 롤백했다. 후속 조회에서 통계 네 테이블과 FLOW·명단·관리자·기업 파일·Storage 버전은 각각 0행이었다. 보안 진단은 서버 전용 설계에 따른 [RLS 정책 없음 INFO](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) 37건이며 경고/오류는 없었다.
- Next.js 프로덕션 빌드·비활성 API HTTP 123건·인증 및 비밀키 번들 경계, 기존 Sites 빌드, 번들 한도(페이지 380725/460800, 총 1043437/1310720바이트), Next.js 타입 재생성 후 TypeScript·lint가 통과했다. 실제 배포나 운영 데이터 이관은 하지 않았다.
- 최종 전체 검사는 **989/989**, 누락/건너뜀 0건이다(`work/supabase-0017-bounded-tests.log`, 약 145초). 처음 전체 실행에서는 새 테스트의 정적 import가 모의 인증을 먼저 불러오는 문제가 있어 실제 인증 로더 등록 후 동적 import로 수정했다. 후속 기본 병렬 실행은 Node/V8 `Fatal process out of memory: Zone`으로 한 테스트 프로세스가 중단됐다. `node --import ./tests/register.mjs --test --test-concurrency=2 tests/*.test.ts`로 동시 메모리 사용을 줄인 최종 실행은 정상 종료했다. 앱 보호 장치나 테스트 기대값을 완화하지 않았으며, 후속 전체 검사도 이 동시 실행 수를 사용한다.
- 적용 파일 SHA-256: `EF55FD71290FB1EC4490E81505260B35CB3351ABA86FBEC1743F07A4C291CE51`.
- **0017 시점의 다음 항목:** 관리자 파일 재고/존재 확인/복구 SQL(위 `0018`에서 연결), 대용량 직접 전송 통합, 실제 Supavisor/Storage 연결, 역사 자료 이관/롤백과 Vercel 배포 검증. 백엔드 기본 비활성은 유지한다.

### FLOW 루트 저장·조회·대시보드와 독립 인증 HTTP 연결

- `0016_consulting_flow_root.sql`을 원격 `20260909152346`으로 적용했다. 기존 `0001`~`0015` 파일은 수정하지 않았다. 서버 전용 `consulting_flows`를 추가해 총 33개 테이블이며, `assert_consulting_flow_schema()`가 루트·파일 원장 및 지연 제약의 준비 상태를 확인한다. 이는 전체 서비스나 외부 연결의 준비 완료 판정이 아니다.
- 명령 21종의 기존 상세 효과와 저장 객체 17종의 구조/참조 검사를 루트 트리거에 결합했다. 새 명령 영수증은 고정 관리자 키/이름 또는 FLOW에 배정된 파트너 ID/이름과 결속한다. 실제 사용자 인증은 독립 관리자·파트너 세션과 기존 서버 권한/배정 재검사로 수행하며, 영수증만으로 인증을 대체하지 않는다.
- 내부 AI 변경은 한 작업의 처리 시작·보류·실패·완료만 허용한다. 재시도는 명시적인 업무 명령으로 남긴다. 보고서 ID/버전/작성자/출처·자동생성 감사 상세·실패 이력을 보존하며, 승인 철회 또는 근거 버전 변경 후 처리 시작/성공 결과 저장을 거절한다. 명령도 작업 변경도 없는 업무 데이터 덮어쓰기를 차단했다.
- 최초 빈 revision 0 기준행과 첫 명령을 한 트랜잭션으로 쓴다. 초기 이력/승인 데이터 선적재와 기준행만 남기는 커밋은 거절한다. 기존 역사 데이터는 이 보호 장치를 우회하는 일반 API가 아니라 별도 이관/검증 절차가 필요하다.
- 파일 소유권·메타데이터·ETag·SHA-256 원장 검사는 지연 제약으로 최종 커밋 상태에 결합했다. 기준행이나 파일 원장 중간 상태가 아니라 마지막 루트 상태를 확인하며, 원장이 없거나 다르면 전체 저장이 롤백된다. 기존 metadata-only 예외는 보존한다. 이 검사는 실제 객체 바이트 검증을 대신하지 않는다.
- `readFlow`, `commitFlow`, `stateWithConsultingFlows`를 PostgreSQL 쿼리에 연결했다. 명단의 exact TEXT CAS와 수정 revision을 유지하고, 진행판 축약은 PostgreSQL 내부에서 수행한다. 보고서 본문·전사문·파일 키·AI 입력·감사/명령 영수증·작업 세부는 전체 진행판 조회에 실리지 않는다.
- 신규 집중검사 7개와 최종 전체 **984/984**가 통과했다. 실제 21종 명령의 연속 저장/조회·파일 원장·3단계 AI 실패/재시도/성공·4차 AI와 승인 철회·위조/누락/오래된 CAS·초기행 롤백을 검사했다. 독립 관리자/파트너 로그인으로 FLOW HTTP 접근·역할 제한·정확한 재시도·첨부 예약/완료/다운로드·정지 계정 거절까지 연결했다. DB는 실제 PostgreSQL 엔진이지만 단일 연결이며, 파일 객체와 AI 제공자는 모의 구성이다. 독립 DB 세션 경합/실제 Storage/AI 네트워크 검증은 아니다.
- Next.js 프로덕션 빌드·비활성 API HTTP 123건과 기존 Sites 빌드가 통과했다. 번들 크기는 페이지 380725/460800, 총 1043437/1310720바이트다. Sites 빌드 후 Next.js 타입을 재생성하고 TypeScript·lint도 통과했다. 최종 전체 로그는 `work/supabase-0016-final-tests.log`다. 초기 집중 실행에서 Node/V8 Wasm 종료가 한 번 더 발생했으며 원인은 확정하지 않았다. 재실행 및 984개 최종 실행은 정상 종료했다.
- `tests/supabase-flow-root-rollback.sql`을 로컬에서 검증한 다음 원격 실행했다. 합성 기준행과 명령의 실제 트리거·원문 보존·미승인 업무 변경 거절·브라우저 권한을 확인하고, **ROLLBACK 전에 `SET CONSTRAINTS ALL IMMEDIATE`로 지연 제약도 실제 검사**했다. 전부 롤백한 후 FLOW·파일 소유권·명단·관리자·기업 파일·Storage 버전이 각각 0행임을 별도 조회했다. 보안 진단은 의도된 서버 전용 [RLS 정책 없음 INFO](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) 33건이며 경고/오류는 없었다.
- 적용 파일 SHA-256: `55E57348A31DD7CE7A1710DA0B60D379F9B5CBF16E16137A7CD430E5328FBAC4`.
- **0016 시점의 남은 항목:** 관리자 파일 재고와 중복/충돌 통계, 대용량 직접 전송 통합, 실제 Supavisor/Storage 연결, 역사 자료 이관/롤백, Vercel 배포 검증. 이때 남았던 중복 요청 통계 경고는 위 `0017` 연결로 해결했다. 앱의 백엔드는 기본 비활성(`PARTNER_HUB_BACKEND_ENABLED=0`)이며 실제 운영 사용자/업무 자료는 만들지 않았다.

### 로컬 검증 환경 복구 기록

- 기존 패키지 폴더에서 실제 파일 누락과 `UNKNOWN: unlink` 잠금 오류를 확인했다. 외부 가상 저장소 분리 실험은 React 타입의 조상 경로 검색을 바꾸어 실패했으며 UI 소스/타입을 우회 수정하지 않았다.
- 기본 `.pnpm` 폴더는 보존하고 `pnpm install --offline --frozen-lockfile --ignore-scripts --no-optimistic-repeat-install --virtual-store-dir node_modules/.pnpm-20260910 --hoist-pattern '*'`로 프로젝트 내부 새 생성 경로에 같은 버전을 복구했다. `.pnpm-20260910`은 로컬 생성물이며 소스·의존성 버전·잠금파일·기존 복구 폴더는 변경하지 않았다.
- 임시 저장소 경로가 기본 pnpm 설정과 달라 `pnpm run build`의 자동 재설치가 non-TTY 오류로 중단될 수 있다. 이번 Sites 빌드는 설치된 동일 명령 `node node_modules/vinext/dist/cli.js build`로 통과했다. 후속 로컬 검증도 명시적 Node CLI를 사용하고 의존성 폴더를 반복 삭제하지 않는다.
- 이미 원격 적용된 `0014`의 파일 끝 빈 줄은 해시 보존을 위해 유지했다. 기본 `git diff --check`의 해당 경고를 기록하고, EOF 빈 줄 항목만 제외한 나머지 공백 검사를 통과했다. 적용된 SQL 파일을 포맷 목적으로 수정하지 않는다.

### 앞서 완료한 FLOW 저장 구조·참조·AI 증거 및 전사문 첨부 분류

- `0014_consulting_flow_transcript_purpose.sql`을 원격 `20260909144600`으로 적용했다. 기존 `0013`은 수정하지 않았다. 실제 `flowUploadReceiptRules.save_transcript`는 `transcript`인데 이전 상세 효과 검사와 테스트가 `recording`을 사용했다. 테스트가 실제 업로드 정책에서 분류를 가져오도록 고쳤고 올바른 새 전사문은 허용, `recording`으로 바꾼 요청은 거절하는 회귀를 추가했다.
- `0015_consulting_flow_domain.sql`을 원격 `20260909144626`으로 적용했다. 저장형 객체 **17종**의 필드 규칙과 전체 도메인 검사 함수 등 서버 전용 함수 7개를 추가했다. 앱의 객체 키 목록과 비교하고 자료 구조·필수/선택 필드·형식·상한·중복 ID·보고서/녹취/서류/계약의 참조를 검사한다. JSONB는 참조 검색에만 사용하며 기존 저장 원문이나 불변 이력을 재작성하지 않는다.
- 파일은 실제 업로드 정책의 용도/확장자/고정 MIME/바이트 상한, 파일 ID에 연결한 키, NFC·경로 문자·제어 문자·180자 파일명 규칙을 검사한다. 상담과 서류의 시각/상태 증거, 계약 완료/서명본, 입금 합계와 수행 시작의 동치, 사후관리 시간 순서도 확인한다. 실제 Storage 바이트 검증을 대신하지 않는다.
- AI 성공/실패/이전 실패 증거는 필드·토큰 수·HTTP 상태·순서와 작업 시각을 확인하고, 각 관측을 작업 ID/관측시각/자동생성 행위자/`ai_result`에 연결한 유일한 감사 기록에 결속한다. 실제 AI 호출이나 내부 작업 결과 전이 전체가 완료됐다는 뜻은 아니다.
- 시간 해석은 UTC를 고정하고 ISO 날짜 및 명시적인 시각/오프셋을 처리한다. 밀리초 아래 자릿수는 앱과 같이 버리며 PostgreSQL의 상대 날짜·무한대·로케일 의존 형식을 받아들이지 않는다. 기존 자료에 비표준/유효하지 않은 날짜가 있다면 **이관 사전검사에서 식별하고 별도 판단**해야 한다. 원문을 임의로 정규화하거나 이런 레거시 자료의 이전이 이미 검증됐다고 간주하지 않는다.
- 로컬 라이브러리 일부의 실제 패키지 파일 누락을 확인해 잠금파일·버전 변경 없이 오프라인 재설치했다. 설치 상태 건너뛰기를 끄고 기존 캐시로 복구했으며 사용자 복구 폴더는 보존했다. 초기 집중검사 중 Node/V8 Wasm 종료 1회, 첫 전체 실행에서 롤백 검사 프로세스 종료 1회가 있었다. 원인은 확정하지 않았으며 각각의 재실행 및 최종 전체 실행을 통과했다.
- 최종 전체 회귀검사 **977/977**, 신규 도메인 집중검사 8개, 상세 효과/도메인 결합 검사 17개, Next.js 빌드·비활성 API HTTP 123건, 기존 Sites 빌드를 통과했다. 전체 재검증 로그는 로컬 `work/supabase-0015-full-tests.log`에 보존했다. 공개 배포는 하지 않았다.
- 원격 `tests/supabase-flow-domain-probe.sql`은 정상 초기 구조, 누락 참조·알 수 없는 필드·명시적 null·입금 없는 수행 시작·모호한 시간 형식 거절을 변수로 검사하고 롤백했다. 후속 조회에서 명단·관리자·기업 파일·Storage 버전은 각 0행이며 FLOW 루트/전체 준비 함수는 없다. 브라우저 역할 함수 실행 권한과 SECURITY DEFINER는 없고, 보안 진단은 기존 서버 전용 RLS의 INFO 32건이다.
- 적용 파일 SHA-256: `0014`는 `AF2E0B277689CEBDC2A78B51E5DD34AF74E08F4A767BA886CCE1090C8D1129EA`, `0015`는 `08DC8901E85502FFF31842DCF6830CF33DC3B6A23141D11D7295499C53062259`다.
- **남은 필수 단계:** 실제 계정에 연결한 행위자와 내부 AI 결과 전이 검사, 위 도메인 검사와 루트/조회/저장 SQL의 결합, 관리자 재고·통계, 실제 Supavisor/Storage·대용량 직접 전송 통합, 이관/롤백·Vercel 배포 검증. 원격 FLOW 루트/전체 준비 함수/업무 쓰기는 아직 열지 않으며 기존 Sites 운영을 유지한다.

### FLOW 나머지 15종 상세 효과 및 전체 21종 결합

- `0013_consulting_flow_business_effects.sql`을 원격 `20260909141850`로 적용했다. 보고서·공동분석·상담·솔루션·서류·계약·입금·사후관리·녹취 상세 효과와 전체 명령 결합 함수 등 서버 전용 함수 9개를 추가했다. 테이블 32개와 기존 적용 마이그레이션은 변경하지 않았다. 파일 SHA-256은 `04FCD5997FB69B3D9553229EBC327167655B8776B08F0542CD37BCF3CBE7DE30`이다.
- 실제 `applyFlowCommand`의 21개 명령을 모두 거치는 합성 업무 흐름을 독립 fixture로 추출했다. 각 전이를 PostgreSQL 핵심/범위/대상/상세 효과 함수에 함께 통과시키고, 20종은 기존 SQLite 상세 트리거와도 대조한다. 신청자료 가져오기는 실제 PostgreSQL 기업 파일 원장을 사용한다. 테스트 fixture를 인증된 HTTP·실제 파일 바이트·실제 AI 실행으로 표현하지 않는다.
- 보고서 버전·이전 보고서/녹취/의사결정/서류 검토 지문·첨부·작성자, 공동분석 주체별 시각, 상담 시간/참석/선행 준비, 서류 접수와 재검토 초기화, 서명본과 계약 상담 연결을 검증한다. 약정액 충족 전에는 수행 시작을 만들지 않고 이후 추가 입금에서도 최초 시작시각을 보존한다. 서명/입금 날짜는 앱과 같은 UTC+9 기준이다.
- 녹취는 본문·문서·음성 한 슬롯/두 슬롯과 생성 작업 연결을 검사한다. 전사문 보완은 다른 작업과 이전 실패 증거를 보존한다. AI 비활성 상태의 실패 작업은 자동 재시도하지 않는다. 신규 파일의 출처 위조와 무관한 파일 추가를 거절한다. Storage 바이트/소유권 검사는 별도 원장 및 추후 실제 연결 검증에 속한다.
- 신규 집중검사는 정상 분기 외에도 오래된 참조, 다른 작성자, 미검토 서류, 계약/입금 금액·날짜 위조, 조기 수행, 파일 역할·명령 대상·감사 기록 변조를 거절하는지 확인한다. PostgreSQL 함수의 변수/열 이름 충돌도 전체 상담 흐름 검사에서 발견해 수정했다.
- 전체 회귀검사 **969개**, 신규 상세 효과 집중검사 9개와 명령 경계 7개, TypeScript·lint를 통과했다. Supabase Next.js 프로덕션 빌드와 비활성 API HTTP 123건, 기존 Sites 빌드 및 번들 제한 검사(페이지 380725/460800, 총 1043435/1310720바이트)도 통과했다. Sites 빌드 후 Next.js 경로 타입을 다시 생성하고 TypeScript·lint를 재검사했다. 기존 의존성 복구 폴더는 lint 대상에서만 제외하고 삭제/변경하지 않았다.
- `tests/supabase-flow-business-probe.sql`을 원격 서버 역할로 실행해 분할입금·한국 날짜 경계의 정상 결과와 금액/미래일/작성자 변조·조기 수행 거절을 확인했다. 변수·카탈로그 검사만 수행하고 롤백했다. 후속 조회에서 명단·관리자·기업 파일·Storage 버전·FLOW 파일 소유 원장은 각각 0행이고 FLOW 루트/전체 준비 함수는 없다. 함수의 브라우저 역할 실행 권한과 SECURITY DEFINER가 없으며, 원격 보안 진단은 기존 서버 전용 RLS의 INFO 32건뿐이다.
- **완료 범위는 명령 상세 효과 계층이다.** 전체 FLOW 도메인/참조/AI 증거, 실제 계정에 연결한 행위자 검증, 내부 AI 결과 전이 및 완전한 루트/조회/저장 SQL 연결은 아직 미완료다. 원격 FLOW 루트와 전체 준비 함수·업무 쓰기 API는 열지 않는다. 실제 Supavisor/Storage 접속, 관리자 재고·통계, 직접 전송, 자료 이관/롤백, Vercel 배포 검증도 남아 있다. 기존 Sites 운영과 비활성 기본값을 유지한다.

### 앞서 완료한 FLOW 근거자료·AI 제어 명령 6종의 정확한 효과 이식

- `0012_consulting_flow_source_ai_effects.sql`을 원격 `20260909134340`로 적용했다. 근거자료 저장/신청자료 가져오기/AI 입력 제외, AI 정책 변경/1차 생성 요청/작업 재시도 6종의 정확한 결과를 검사한다. 네이티브 함수 4개를 추가했으며 루트·전체 준비 판정·쓰기 API는 아직 만들지 않았다. 전체 21종의 변경 범위는 앞 단계에서 이식했고, **나머지 15종의 상세 효과는 미완료**다.
- JSON 객체의 지정 필드를 제거·변경할 때 기존 키 순서와 이스케이프/숫자 표기를 보존하는 함수를 추가했다. PostgreSQL 파서로 값을 다루고 원시 최상위 키만 토큰으로 보존한다. `jsonb_set`으로 불변 이력을 정규화하지 않는다. SQLite 원본 결과와 빈 객체·중첩 배열/객체·따옴표·이스케이프된 키·삭제 후 추가 순서를 비교했다.
- AI 중지 시 기존 queued 작업 전부를 정확한 보류 상태/사유로 바꾸고 다른 작업을 보존한다. 1차 생성 요청은 정해진 필드 순서·상태·사유·명령 ID·시각의 작업 한 개만 추가한다. 재시도는 허용된 기존 작업 한 개만 바꾸며, 실패 증거를 기존 이력 뒤에 정확히 추가한 다음 현재 증거와 시작시각을 지운다. 실패 이력 상한도 검사한다. 실제 AI 실행은 하지 않았다.
- 수동 근거자료는 기존 파일을 그대로 두고 source 파일을 최대 한 개 추가한다. 신청자료는 source 파일 한 개와 검토시각/담당자/출처 지문을 요구하고 실제 기업 파일 원장에 연결한다. 회사·사건·담당 ID 또는 명시적인 레거시 담당명, 삭제 영수증, 저장 키·전체 메타데이터·MIME/ETag 증거를 확인한다. 새 업로드 영수증이 있는 draft 자료는 실제 제출 문서 연결이 필요하다. 원래 레거시 예외는 유지하며, 출처 지문 검사를 실제 Storage 바이트 해시 검증으로 표현하지 않는다.
- AI 입력 제외는 기존 source 한 개의 목적만 source_archived로 바꾼다. 파일 순서/신원/이름/기타 필드 변경, 둘 이상의 제외와 되돌리기는 거절한다. 로컬 PostgreSQL의 실제 원장으로 담당 이름 변경·안정 ID 재배정·관리자 전용 빈 배정·다른 사건·삭제·누락/불일치 증거·잘못된 문서 배열·중복 JSON 키도 검사했다.
- 신규 집중검사 6개와 앞 단계 7개를 함께 통과했고, 실제 `applyFlowCommand`의 전체 정상 흐름에도 새 6종 효과를 결합했다. 전체 회귀검사 960개, Supabase Next.js 빌드·비활성 API HTTP 123건, 기존 Sites 빌드·번들 검사(페이지 380,725/460,800바이트, 전체 1,043,435/1,310,720바이트)가 통과했다. Sites 빌드 후 Next 타입을 재생성했다. 이 검사는 합성 원장/메타데이터이며 FLOW 루트 HTTP·Storage 바이트·유료 AI·다중 DB 세션 경쟁 검증이 아니다.
- 원격 `tests/supabase-flow-source-ai-rollback.sql`로 빈 대상 확인 후 합성 기업 파일/증거를 만들고, 증거 누락 거절·정상 가져오기·담당명 불일치 거절·안정 ID 이름 변경 허용·자료 보관/복원 금지를 검사한 뒤 전부 롤백했다. 후속 조회에서 원본·키·메타데이터·무결성·배정·명단은 각각 0행이며 FLOW 루트는 없다. 보안 진단은 의도된 서버 전용 RLS INFO 32건만 반환했다.
- 작업 중 기존 의존성 복구 자료가 `1260809123955-node_modules/.recovery-20260909`로 나타났다. 원본을 이동/삭제하거나 Git에 포함하지 않았다. 일반 lint가 오래 실행되는 상태를 확인해 직접 시작한 검사만 중단하고, `node node_modules/oxlint/bin/oxlint --ignore-pattern '1260809123955-node_modules/**'`로 해당 복구 폴더만 제외한 코드 검사를 통과했다. 응용 소스나 검사 규칙은 제외하지 않았다.
- 남은 15개 명령의 상세 효과, 내부 AI 결과·도메인/참조/증거·권위 있는 행위자 검사와 FLOW 루트/조회/저장 SQL, 관리자 재고/통계, 실제 직접 전송·Supavisor/Storage·이관/롤백·Vercel 배포 검증을 이어간다. 기존 Sites 운영과 `PARTNER_HUB_BACKEND_ENABLED=0`을 유지한다.

### 앞서 완료한 FLOW 명령별 변경 범위·대상 PostgreSQL 이식

- `0011_consulting_flow_command_boundaries.sql`을 원격 `20260909132201`로 적용했다. 명령 규칙·JSON 경로/타입 비교·변경 범위·대상·핵심 규칙 결합을 위한 순수 함수 6개다. 테이블은 기존 32개 그대로이며 FLOW 루트·전체 준비 함수·업무 쓰기 API는 만들지 않았다. 이 단계의 통과는 **전체 FLOW 권한·정확한 명령 효과·도메인 검증 완료를 뜻하지 않는다.**
- 기존 21개 명령의 효과 경로, 허용 변경 경로와 대상 규칙을 모두 이식하고 `db/schema.ts`의 규칙과 정확히 일치하는지 검사했다. 18개 상태 경로의 개별 변경 378조합을 기존 SQLite 효과/범위 트리거와 대조했다. 허용된 부수 변경만 있고 명령의 실제 주 변경이 없는 경우도 거절한다.
- 보고서·상담·녹취·서류요청·입금의 추가는 명령 ID에 묶인 항목 한 개만 허용하며 기존 항목의 순서·원문을 보존한다. 대상 수정은 지정된 항목·필드·개수·상태·시각에 제한한다. 영수증 대상과 다른 항목, 최신이 아닌 녹취, 다른 서류의 동시 수정, 보호 필드 추가/삭제/타입 변경을 거절한다. 계약 상담은 이미 완료된 대상이면 기존 항목을 다시 바꾸지 않아도 되지만, 존재하지 않거나 완료되지 않은 대상을 선택할 수 없다.
- 숫자 타입 비교는 SQLite `json_type`의 정수/실수 표기를 따른다. 정수 범위를 넘었을 때 `typeof(json_extract(...))`가 실수가 되는 현상과 구분했으며, 공백·큰 정수·`1`/`1.0` 차이를 검사했다. 중첩 객체의 불변 비교는 `jsonb` 정규화가 아닌 기존 compact JSON 원문 비교를 유지한다.
- 실제 `applyFlowCommand` 코드로 21개 명령 전체를 포함한 근거자료→분석→상담→서류→계약→분할입금→사후관리 경로를 생성하고, 핵심 규칙과 새 경계 함수의 결합을 통과했다. **DB 루트 쓰기·HTTP 권한·파일 원본·AI 네트워크 검증은 아니다.** 자료·파일 메타데이터는 합성이고 외부 제공자를 호출하지 않는다.
- 신규 집중검사 7개와 전체 회귀검사 954개, TypeScript·lint를 통과했다. Supabase Next.js 프로덕션 빌드·비활성 API HTTP 123건, 기존 Sites 빌드·번들 제한 검사도 통과했다. 기존 운영이나 공개 배포는 변경하지 않았다.
- 원격에서 `tests/supabase-flow-commands-probe.sql`을 실행해 정상 서류 검토, 범위 밖 입금 주입·서류 제목 변경·잘못된 대상·검토시각 누락·최초 명령 주입 거절을 확인했다. 변수와 카탈로그만 사용하고 롤백했다. 후속 조회에서 FLOW 루트/전체 준비 함수는 없고, 명단·관리자·Storage 버전은 각각 0행이었다. 함수는 서버 역할에만 허용하고 SECURITY DEFINER를 쓰지 않는다. 원격 보안 진단은 의도된 RLS INFO 32건뿐이다.
- 다음 필수 작업은 21개 명령의 **정확한 변경 결과**, 도메인/참조/AI 증거·권위 있는 행위자·내부 작업 결과 검증과 전체 루트/조회/저장 SQL 연결이다. 이후 관리자 재고·통계, 직접 전송, 실제 Supavisor/Storage 접속·다중 세션 경합·자료 이관/롤백·Vercel 배포 검증을 이어간다. `PARTNER_HUB_BACKEND_ENABLED=0`을 유지한다.

### 앞서 완료한 FLOW 파일 원장·예약·완료 영수증 PostgreSQL 이식

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
- 이 기반 단계에서는 브라우저 직접 업로드용 임시 `staging` 서명만 구현했다. 화면·예약·완료 처리·세션 재검사는 위 `0019`에서 연결했으며 실제 네트워크 검증은 남았다.
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

1. 원본 전체 D1/R2 사본 확보 후 읽기 전용 사전검사 도구를 실제 자료에 실행하고, 원장/바이트 대조·역사 FLOW 이관/복원 경로 검증(현재는 합성 SQLite 검사 도구만 완료)
2. 만료 staging·미참조 최종 객체·불변 버전의 보존/정리 절차와 안전한 재시도 검증
3. 실제 Supavisor 연결·독립 다중 세션 경합·최종 스키마 무결성 검증
4. 생성한 비공개 버킷에서 실제 Storage 서명/CORS·최대 크기·대용량 다운로드 검증; 필요 시 TUS 재개 전송 연결
5. 독립 인증·FLOW·파일·진행판·관리자 원격 CLI를 실제 저장소와 결합한 통합검사
6. Vercel Preview에서 업로드/다운로드 한도·시간·권한·비밀키 경계 검사 후 기존 자료 전환/롤백 검증
7. 검증된 브랜치의 main 반영 및 Vercel 운영 결과 확인(현재 main/운영은 변경하지 않음)

## 현재 외부 입력 필요 시점

코드·오프라인 검사 및 MCP를 통한 스키마 적용은 계속 진행 가능하다. 앱의 실제 DB/Storage 연결과 Vercel 배포 단계에는 다음 값이 각 서비스의 비밀 저장소에 필요하다.

- Supabase DB 비밀번호가 포함된 트랜잭션 풀러 연결 문자열
- Supabase 신형 Secret key
- Vercel 프로덕션 도메인

실제 값은 Vercel 환경변수 또는 Git에서 제외된 로컬 `.env.local`에 등록한다. MCP 접속 승인과 애플리케이션 실행용 자격증명은 별개다. `0019` 검사 종료 시 `.env.local`과 프로세스의 두 Supabase 자격증명은 없었고, `storage.buckets`에서 `partner-hub-private`을 조회한 결과도 없었다. 실제 Storage HTTP 업로드와 앱의 Supavisor 연결은 아직 검증하지 않았다. 해당 연결값과 Vercel 주소 입력을 요청했으며 그동안 코드·사전검증 작업을 계속할 수 있다.

이후 위 최신 단계에서 비공개 버킷을 실제 생성했다. 버킷 부재는 해소됐지만 앱용 Secret key 저장 승인, DB 비밀번호/연결값, Vercel 주소 및 원본 D1/R2 전체 백업은 여전히 필요하다. 기존 Secret key를 읽어 `.env.local`에 저장하는 승인만 요청한 상태이며, 새 키/권한을 임의로 생성하거나 DB 비밀번호를 자동 재설정하지 않는다.

## 공식 기준 문서

- [Supabase PostgreSQL 연결 방식](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase API key 보안](https://supabase.com/docs/guides/getting-started/api-keys)
- [PostgreSQL Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Storage 접근 제어](https://supabase.com/docs/guides/storage/security/access-control)
- [Storage 스키마 변경 금지 원칙](https://supabase.com/docs/guides/storage/schema/design)
- [PostgreSQL 트랜잭션 격리](https://www.postgresql.org/docs/18/transaction-iso.html)
- [postgres.js 정수 타입 설정](https://github.com/porsager/postgres)
- [PGlite 테스트 엔진 API](https://pglite.dev/docs/api)
