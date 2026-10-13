# Supabase 임시 업로드 정리 — 운영자 절차

기준일: 2026-10-08. 이 문서는 **O3 도구·검토·합성 검증** 범위다. 실제 운영 정리, 버전 API 호환 확인 또는 삭제 승인을 뜻하지 않는다. 실제 파일 삭제는 별도 승인 전 실행하지 않는다. 앱 화면·자동 예약·서버 시작 시 실행되는 작업이 아니다.

## 대상과 보존 경계

- `partner_hub.supabase_file_transfers`의 불변 예약에 있는 `partner-hub/staging/v1/<UUID>`만 검토한다. 원장의 사용자·세션·상담 내용·본문을 읽지 않으며 Storage 파일 본문을 다운로드하지 않는다.
- 기존 `retain_until = expires_at + 7,380,000ms`와 10분 발급 기간을 유지한다. 생성 후 **2시간 13분**이 정확히 지난 경계까지 보존하며, DB 시각이 그보다 큰 경우에만 후보로 삼는다. 보관 정책은 변경하지 않는다.
- 모든 예약의 file/audio 경로를 함께 비교한다. 중복·늦게 도착한 객체·버전 정보 없는 객체·조회 오류는 삭제 대상으로 확정하지 않는다. 최종 원본 `partner-hub/objects/v1` 및 원본 버전 원장은 삭제하지 않는다. 원본 원장에 staging 참조가 하나라도 있으면 전체 작업을 중단한다.
- 알 수 없는 경로를 나열하여 지우거나, 만료 예약을 DB에서 삭제하거나, 논리 삭제된 원본을 지우는 기능은 없다. SQL `DELETE`, `UPDATE`, 스키마 변경도 없다.
- 최대 예약 **10,000행**, 계획당 후보 **20개**, 계획 유효시간 **15분**이다. 원장이 한도를 넘으면 일부만 보고 삭제하지 않고 중단한다. 한도 변경은 별도 검토 대상이다.

## 1. 연결과 검토 계획

비밀값은 OneDrive·Git 밖의 비공개 파일에 둔다. 다음은 형식 예시이며 해당 파일이 이미 준비됐다는 뜻이 아니다.

```powershell
# 도움말: 환경파일 없이 실행하며 원격 연결 없음
node scripts/supabase-staging-cleanup.mjs --help

# 별도 승인된 대상에서 메타데이터만 조회하여 계획 생성
node --env-file=C:\PartnerHubPrivate\supabase.env scripts/supabase-staging-cleanup.mjs plan --output-dir C:\PartnerHubCleanupPlans
```

필수 설정은 `PARTNER_HUB_NEXT_BACKEND=supabase-v1`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_DATABASE_URL`, `SUPABASE_STORAGE_BUCKET`이다. 프로젝트와 DB 사용자 대상이 일치해야 하며 기존 6543 연결은 이 작업 동안 같은 호스트의 5432 세션 연결로 바뀐다. 비공개 버킷·최대 25MiB·`application/octet-stream` 제한을 확인한다. **다른 프로젝트 생성, 버킷 설정 변경, 버전 기능 활성화는 자동으로 하지 않는다.**

계획은 매번 새 `partner-hub-cleanup-*` 비공개 폴더의 `plan.json`에 생성된다. Windows는 현재 사용자와 SYSTEM으로 새 폴더 권한을 제한한다. 계획에는 무작위 예약 ID·경로·객체 버전·크기·시각과 해시가 있으므로 Git에 올리거나 공개하지 않는다. 키·사용자 식별정보·고객 자료 본문은 포함하지 않는다. 경로는 OneDrive와 작업 폴더 밖이어야 한다. 이 검사만으로 모든 타사 동기화 프로그램을 탐지할 수 없으므로 운영자가 별도로 비동기화 위치를 선택한다.

운영자는 대상 프로젝트/버킷, 후보 각각의 `retainUntil`, 객체 시각·크기·버전과 제외 사유를 검토한다. `unexpired`, `ambiguous`, `missing`, `unversioned`, `lateObject`, `deferred` 합계와 후보 수를 확인한다. 후보가 0개면 실행할 삭제가 없다. 제외된 파일을 정리하려고 제한을 우회하지 않는다.

## 2. 승인 후에만 실행

최초 실제 사용 전에 **별도 격리 환경의 가상 파일**로 현행 Storage의 버전별 조회·삭제 계약을 검증해야 한다. 현재 운영 프로젝트의 지원 여부는 미확인이다. 버전 계약 미지원 시 경로만 지정하는 삭제로 대체하지 않는다.

```powershell
# 실제 삭제 승인 및 계획 검토가 끝난 운영자만 대화형 터미널에서 실행
node --env-file=C:\PartnerHubPrivate\supabase.env scripts/supabase-staging-cleanup.mjs apply --plan C:\PartnerHubCleanupPlans\partner-hub-cleanup-EXAMPLE\plan.json
```

터미널에 표시된 `DELETE EXPIRED STAGING <프로젝트>/<버킷> <계획 SHA-256>` 문장을 정확히 입력해야 한다. `--force`, 자동 승인, 파이프 입력은 지원하지 않는다. 계획 해시는 우발적 변경과 확인 대상 고정용이며 전자서명이나 별도의 사용자 인증 수단은 아니다.

실행은 다음을 순서대로 확인한다.

1. 대상별 DB advisory 잠금, 두 원장에 SHARE 잠금을 확보한다. 잠금 충돌 시 기다리거나 강제 진행하지 않고 중단한다. 잠금 전 SELECT가 오래된 스냅샷을 고정하지 않도록 READ COMMITTED를 사용하고, 테이블 잠금 이후 원장을 다시 읽는다.
2. 계획 대상·해시·유효시간, 전체 예약과 최종 원본 참조, 비공개 버킷을 재확인한다. 계획 후 원장이 바뀌면 중단한다.
3. 현재 객체가 계획과 다르면 보존한다. 존재하지 않는 무작위 버전 조회와 계획의 정확한 버전 조회로, 버전 매개변수를 무시하는 제공자를 차단한다.
4. 요청 전에 `execution.jsonl`에 `attempted`를 기록하고 디스크에 동기화한다. **`{path, versionId}`를 지정한 Storage API**로만 삭제한다. 문자열 경로만 보내는 삭제는 하지 않는다.
5. 같은 버전이 더 이상 존재하지 않는지 확인한 뒤 `removed`를 기록한다. 응답이 애매하거나 없어지면 즉시 중단하며 다음 후보도 처리하지 않는다.

SHARE 잠금 동안 **신규 업로드 예약과 원본 버전 발행의 DB 쓰기가 잠시 지연될 수 있다.** 조회는 가능하지만 업로드 완료 처리의 쓰기도 영향을 받을 수 있다. 사용자가 적은 시간에 실행한다. 네트워크 요청 창은 60초, 요청당 제한은 10초다. DB 문장 제한은 10초, 유휴 트랜잭션 제한은 70초이며 잠금 해제까지의 전체 시간을 정확히 60초로 보장하지 않는다.

## 3. 응답 유실·중단·재시도

`CLEANUP_OUTCOME_UNKNOWN`은 실패하여 아무것도 지워지지 않았다는 뜻이 아니다. 일부 버전이 이미 없어졌을 수 있다. 중단 후 **같은 계획의 apply를 다시 실행하면 거부**한다. `execution.jsonl`을 삭제하거나 계획을 복사해서 이 보호를 우회하지 않는다.

```powershell
# 실행했던 계획의 정확한 버전이 현재 존재하는지만 조회; 삭제·재시도 없음
node --env-file=C:\PartnerHubPrivate\supabase.env scripts/supabase-staging-cleanup.mjs reconcile --plan C:\PartnerHubCleanupPlans\partner-hub-cleanup-EXAMPLE\plan.json
```

`reconcile`의 `present`/`absent`는 조회 시점의 버전 존재 여부다. 사라진 이유, 새로운 버전의 상태, 이전 요청의 모든 처리 결과를 증명하지는 않는다. 운영자는 실행 기록과 조회 결과를 대조하고, 남은 후보를 다시 처리하려면 **새 plan → 재검토 → 별도 실행 확인**을 거친다. 재조정 명령도 오류가 나면 권한·버전 계약을 확인하기 전 재삭제하지 않는다. 잠금 강제 해제, 권한 상승, 삭제된 원본 복구를 자동으로 시도하지 않는다.

## 검증 범위

가상 메타데이터·모의 HTTP·로컬 실행 기록으로 보관 경계, 양쪽 열 중복, 객체 교체, 잠금 획득 순서, 응답 유실, 사용자 중단, 기록 실패, 재시작 후 재실행 거부, 실제 CLI의 비대화형 실행 거부를 검사한다. 기존 업로드·다운로드·버전 보존 회귀도 함께 수행한다. 이는 **실제 Supabase 버전 API 또는 독립 DB 세션의 동시 실행 검증을 대신하지 않는다.**

공식 계약 참고: [Supabase 버전 지정 삭제](https://supabase.com/docs/reference/javascript/file-buckets-remove), [삭제 라우트](https://github.com/supabase/storage/blob/master/src/http/routes/object/deleteObjects.ts), [객체 정보 라우트](https://github.com/supabase/storage/blob/master/src/http/routes/object/getObjectInfo.ts). 이 도구는 별도의 운영자 도구이므로 Vercel 배포 없이 사용할 수 있으며 제품 앱에 정리 작업을 자동 연결하지 않는다.
