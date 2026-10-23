# 운영과 분리된 Supabase 검증 환경

> **2026-10-15 02:26 KST 최종 상태:** B4 완료·전체 **17/22개(77%)**, 남은 M2/M3/B2/B3/O2 5개. 복원용 `fkbxfdowgazmqoqykwyc`는 **Paused**, 원본 검증 `oaqodendjnztzcqaahaq`는 **재개 완료·Healthy**를 실제 대시보드에서 확인했다. 재개 직후의 Coming up/Unhealthy는 뒤이은 Healthy로 해소됐다. 두 환경의 자료는 보존했고 FREE 요금제를 유지했다. 운영 프로젝트는 변경하지 않았다. `partner-hub` heartbeat를 공식 도구로 **ACTIVE·15분** 유지하면서 최신 완료 수·두 프로젝트 상태·남은 선행조건으로 갱신했다. 비밀번호·키·인증서·정지·재개·통과 검사를 다시 요구하거나 반복하지 않는다.

환경 화면 증거는 Git 제외 `work/supabase-recovery-paused-20261015.jpg`, `work/supabase-verification-resumed-20261015.jpg`, `work/supabase-recovery-lifecycle-complete-20261015.jpg`다. 최종 목록 화면의 사용량은 지연 집계일 수 있으므로 실제 복원·해시 검증 바이트를 대체하지 않는다. 로컬 테스트 서버는 종료됐으며 검증 Supabase의 재개가 상시 앱 배포를 뜻하지 않는다. 현재 필요한 추가 사용자 입력은 없고 남은 항목은 아래 선행조건의 새 근거가 생긴 경우에 이어간다.

## 2026-10-15 02:19 KST — B4 원격 DB·파일 복원과 앱 접근 검증 완료

**B4 완료. 전체 17/22개(77%), 남은 M2/M3/B2/B3/O2 5개.** 실제 분리 Supabase의 DB·Storage 복원에 이어 실제 Next HTTPS 앱의 **84개 확인 항목**(기존 계정 로그인, 역할 제한, 복원 FLOW 열람, 업무 첨부 7개·55,817,383 bytes 다운로드 SHA-256, 비담당자 차단, 관리자 파일 7개 무결성, 로그아웃 후 401)을 통과했다. 기존 V4 업무 전체를 다시 작성한 것이 아니라 복원된 계정·기록·파일을 사용했다.

앱 실행기의 마지막 DB 보존 검사는 `portal_login_stats`를 허용 목록에서 빠뜨려 실패했다. `/api/state`가 기존 `recordPortalLogin`을 호출해 로그인 시각·횟수를 갱신하는 정상 동작을 확인하고 실행기를 수정했다. 통과한 HTTP를 반복하지 않고 **마지막 보존 검사만 읽기 전용으로 별도 실행**했다. 원본 암호화 백업의 DB 지문과 대조해 인증·로그인 통계 4개 테이블 외 업무 테이블·스키마·권한·트리거가 일치함을 확인했다. Storage 원장 7행도 SELECT에서 저장 시각만 원본 값으로 환산한 전체 행 지문이 원본과 정확히 일치했다. 이 환산은 비교용이며 DB 쓰기는 0건이다.

최종 증거는 `app-restore-reconciled-status.json`의 **84개 HTTP 확인 통과·최종 보존 assertion 실패**와 이를 해결한 `app-preservation-status.json`의 **passed·appAccessVerified=true**를 함께 읽는다. 앞선 실패 보고서는 덮거나 성공으로 바꾸지 않았다. 새 읽기 전용 확인기는 `scripts/check-supabase-recovery-preservation.mjs`다. Git 제외 비밀값 없는 요약은 `work/supabase-recovery-live-proof-20261015.json`이며 기록 시점의 소스 SHA-256을 함께 남겼다. 이는 이전 모든 실행 시점의 코드 해시를 소급 증명하는 것은 아니다.

**환경 정리 완료:** 복원용 `fkbxfdowgazmqoqykwyc`의 실제 Paused를 확인한 후 원본 검증 `oaqodendjnztzcqaahaq`의 Resume을 실행했고 Restoration complete 및 Healthy까지 확인했다. 운영 DB 인증·운영 배포·main 병합·실고객 이관·외부 발송·유료 변경은 0건이다. OS 인증서 신뢰를 바꾸지 않았고 이번 앱 세션·Next 서버는 정리됐다.

**범위 한계:** 합성 자료의 실제 원격 복구 성공이며 운영 복구·무인 백업 예약·외부 분리 보관 완료가 아니다. 브라우저 다운로드의 OS 저장 위치/바이트, 실물 휴대폰, 여러 Next 서버 경합은 여전히 미검증이다. B2는 운영 연결과 무인 예약 성공, B3는 승인된 외부 보관처·키 분리와 읽기/복호화, M2/M3는 전체 원본·대상 기준과 실제 처리 승인, O2는 수신처·시험 발송 승인 및 수신 근거가 필요하다. 새 근거가 없으면 V4/B4나 비밀번호·키·인증서 단계를 반복하지 않는다.

## 2026-10-15 02:11 KST — 원격 복원 대조 통과·앱 다운로드 재검증 중

대표의 `SAVED` 화면과 보호 상태 `password-input-status.json`의 `saved`를 확인했다. 이전 비밀번호 입력 대기는 해소됐다. 원격 복원 실행기를 구현해 기존 암호화 아카이브 한 개만 새 복원 전용 `fkbxfdowgazmqoqykwyc`에 실제 복원했다. 복원·검사 도구는 운영 `yievsveuxjnbygatvjtb`·원본 검증 `oaqodendjnztzcqaahaq`에 DB/Storage 네트워크 요청·쓰기를 하지 않았다. 대시보드의 승인된 검증 환경 정지·재개는 별도 관리 동작이다.

- **DB 복원 통과:** 빈 대상(앱 스키마 없음, public 테이블·auth 사용자·Storage 버킷/객체 0개)을 확인하고 PostgreSQL 17 `pg_restore --single-transaction --exit-on-error`로 복원했다. `--clean`과 기존 데이터 삭제는 없다. 39개 테이블·108개 행 및 스키마·소유자·권한·함수·트리거의 지문이 원본 백업과 같았다.
- **파일 복원 통과:** 비공개 버킷에 객체 14개·111,634,766 bytes를 `upsert=false`로 올리고 전부 내려받아 경로·크기·SHA-256을 대조했다. 보존 버전 7개·활성 참조 7개·원장 외 객체 7개를 보존했다. 원본 아카이브 SHA-256은 `97fb9424bf7fef79e5c87c93009ed210b46d1775c6a46e381a640f868f74c5cf`다. 덤프·파일 평문은 디스크에 쓰지 않았다.
- **앱 첫 검사 실패 보존:** 복원 계정 로그인·역할 제한은 통과했으나 누적 20개 확인 후 첫 파일 다운로드에서 실패했다. 세션·Next 서버는 정상 정리됐다. 원인은 새 Storage에 업로드하며 `last_modified`가 바뀐 것: 원장 파일 7개 모두 크기·ETag 일치, 저장 시각만 7개 불일치였다. 원시 파일 바이트 대조 성공을 앱 복구 성공으로 오인하지 않았다.
- **복원 메타정보 보정 통과:** 실제 원장 파일 7개·55,817,383 bytes를 SHA-256으로 다시 대조한 뒤, 복원 DB의 `storage_object_versions.wire.uploaded`만 새 저장소 시각에 맞췄다. 일반 UPDATE는 불변 트리거에 막혀 전부 롤백됐다. 후속 도구는 해당 복원 테이블의 독점 잠금 안에서 불변 트리거 일시 중단 → 정확한 기존 값 조건의 7개 UPDATE → 같은 트랜잭션 안에서 트리거 복구를 수행했다. 오류 시 DDL·행 변경 전체 롤백이며 다른 세션이 중간 상태를 볼 수 없다. 완료 후 다른 테이블·스키마·권한·트리거와 파일 키·버전·경로·크기·체크섬이 그대로임을 대조했다. 앱의 파일 검증 규칙은 완화하지 않았다. 원본 백업의 DB 일치 증거는 보정 전 시점의 증거로 보존하고 보정 후 DB 전체가 원본과 동일하다고 주장하지 않는다.
- **도구 검사:** 복원 대상·빈 상태·경로·바이트·시각 보정 가드 6/6, TypeScript 및 변경 파일 lint·서식 통과. V4·전체 일반 회귀·새 백업 생성은 반복하지 않았다.

실행기: `scripts/restore-supabase-verification.mjs`, `scripts/reconcile-supabase-recovery-storage.mjs`, `scripts/check-supabase-recovery-app.mjs`. 복원 설정 폴더의 `restore-status.json`, 실패한 `app-restore-status.json`·`storage-reconciliation-status.json`, 통과한 `storage-reconciliation-transaction-status.json`을 모두 보존한다. 앱 후속 결과는 별도 `app-restore-reconciled-status.json`에 기록한다. 상태 파일이 있으면 자동 덮어쓰기·재실행하지 않는다.

**이 시점에는 앱 후속 검사가 진행 중이다. B4는 아직 미완료이며 전체 16/22개 유지.** 통과 후 복원 프로젝트를 정지하고 원본 검증을 재개해야 한다. 원본 검증은 현재 정지 상태이며 새 비밀번호·키 발급·인증서 등록을 다시 요청하지 않는다.

> **2026-10-15 최종 갱신:** 정의된 V4 검증 범위를 실제 분리 환경에서 통과했다. HTTP 업무 134개·문서/음성 2슬롯 51개 확인 항목, 독립 DB 세션 2개 경합, 관리자/파트너 브라우저 로그인 및 모바일 저장·타 계정 재조회를 확인했다. **V4 완료, 전체 16/22개(73%), 남은 6개.** 준비·로그인·키·비밀번호·인증서 대기로 되돌아가거나 완료한 검사를 반복하지 않는다. 실제 운영 배포·고객 이관·백업 복구 완료와는 구분한다.

## 2026-10-15 01:51 KST — 복원 프로젝트 생성 확인·PC 비밀번호 입력 오류 수정

대표의 생성 완료 답변 후 실제 대시보드에서 **`partner-hub-recovery-20261015` / `fkbxfdowgazmqoqykwyc`**, 기존 FREE 조직·Singapore·NANO를 확인했다. 운영 `yievsveuxjnbygatvjtb` 및 원본 검증 `oaqodendjnztzcqaahaq`와 모두 다른 새 ref다. Connect 화면에 표시된 transaction pooler는 `aws-0-ap-southeast-1.pooler.supabase.com:6543`, 사용자 `postgres.fkbxfdowgazmqoqykwyc`다. 01:37의 ‘프로젝트 생성 대기’는 해소됐다.

새 설정은 `C:\Users\A\AppData\Local\Temp\partner-hub-verification-recovery-182a07b9523f45f2aac5884a4dfc4ac1\config.json`에 별도 준비했다. 기존 원본 설정은 수정하지 않았다. 현재 사용자·SYSTEM만 접근하는 폴더의 ACL을 유지하며 기존 새 프로젝트 Secret key를 보호 설정에 저장했다. API 키 생성·삭제·권한 확대는 하지 않았다. 브라우저의 비동기 키 복사 완료를 확인하고 RSA-OAEP 암호화 전달을 사용했으며 임시 전달 파일·암호화용 개인키·클립보드를 정리했다. 키 값은 출력하거나 OneDrive에 기록하지 않았다.

대표의 오류 화면은 Windows PowerShell에서 `Get-Acl`의 `Microsoft.PowerShell.Security` 모듈 자동 로딩 실패를 보여줬다. 비밀번호 입력 전에 중단됐으며 그 시점의 보호 설정에도 DB 비밀번호가 없었다. `set-supabase-recovery-password.ps1`에서 실행 파일 자체의 `$PSHOME` 보안 모듈을 명시적으로 불러오도록 수정하고 `-CheckOnly`를 추가했다. Windows 기본 모듈 경로를 지정한 PowerShell 5.1.19041.6456에서 모듈 로딩·ACL 읽기·실제 보호 파일 사전 검사가 통과했다. 전역 실행 정책이나 폴더 권한을 완화하지 않았다.

**현재 입력 창:** 제목 `Partner Hub - Recovery DB password`, 프로세스 38252. `password-input-status.json`의 `awaiting-password`로 실제 숨김 입력 단계 도달을 확인했다. 새 복원 프로젝트 생성 때 사용한 비밀번호를 직접 입력하면 `saved`가 기록된다. 값은 출력하지 말고 상태만 확인해 다음 단계로 진행한다. 저장 완료를 확인하기 전 DB 인증을 시도하지 않는다. 오래된 오류 창이나 새 비밀번호 생성 대기로 돌아가지 않는다.

복원 가드 `supabase-recovery-policy.mjs`는 새 ref·호스트·기존 아카이브 SHA-256을 고정하고 운영/원본 주소·기존 스키마/사용자/객체·경로 이탈·파일 바이트 불일치를 차단한다. 관련 검사 **4/4**, 변경 파일 lint·서식 및 TypeScript 검사가 통과했다. 이는 가드 검증이며 **원격 복원 실행기는 아직 미구현·원격 DB/Storage 복원은 미실행**이다. 다음은 저장된 연결정보 확인 → 빈 대상 확인을 포함한 실행기 구현 → 기존 백업의 DB·파일 14개 복원·대조 → 앱 접근 확인 → 복원용 정지·원본 재개 순서다. 전체 **16/22개**를 유지한다.

## 2026-10-15 01:37 KST — 무료 복원 시험 승인·원본 검증 환경 일시 정지 완료

대표가 **“검증 환경만 잠시 정지하고 무료 복원 시험 진행”**을 선택했다. 아래 01:26 실행안의 검증 환경 정지 → 무료 복원 프로젝트 생성·시험 → 복원용 정지·원본 검증 재개가 승인됐다. 동일한 정지 승인을 다시 요청하지 않는다. 운영·비용·자료 삭제·권한 확대는 승인 범위에 포함되지 않는다.

- 기존 `backup-status.json`의 통과 상태와 검증 ref, 로컬 평문 정리 상태를 확인했고 암호화 백업·별도 복구 키·검증 보고서의 파일 존재를 확인했다. 백업이나 복호화 검사를 다시 실행하지 않았다.
- 검증 `oaqodendjnztzcqaahaq`의 설정에서 **Pause project**를 실행했고 대시보드의 **Project "partner-hub-verification-20261014" is paused**와 Resume project 버튼으로 정지 완료를 확인했다. 운영 `yievsveuxjnbygatvjtb`는 접속·변경하지 않았다. 기존 검증 자료·파일·증거는 보존했다.
- 같은 FREE 조직 `sljbkadzyilbddtludmh`의 새 프로젝트 화면에서 이전 한도 차단이 사라졌다. 이름 `partner-hub-recovery-20261015`, Singapore `ap-southeast-1`을 준비하고 Data API·자동 테이블 노출은 해제했다. 생성은 아직 제출하지 않았다.
- 양식에 남아 있던 이전 입력을 정리해 복원 프로젝트 이름을 정확히 맞추고 비밀번호 칸은 빈 상태로 인계했다. 비밀번호 생성·입력·제출은 브라우저 도구의 인증정보 변경 인계 규칙에 따라 대표에게 요청했다. 이는 새로운 복원 대상의 비밀번호이며 기존 검증 비밀번호 입력 완료를 번복하는 대기가 아니다.
- 화면 증거: Git 제외 `work/supabase-verification-paused-20261015.jpg`, `work/supabase-recovery-create-ready-20261015.jpg`. 브라우저 생성 양식은 이 채팅에서 이어갈 수 있도록 남겼다.

**현재 단계:** 원본 검증 환경은 정지됐고 새 프로젝트 생성 완료를 기다린다. 새 목적지 ref·DB 연결은 아직 없으며 원격 복원은 미실행이다. 생성 후 실제 새 ref가 운영·원본 검증 ref와 모두 다름을 확인하고, 기존 백업 한 개를 빈 DB·버킷에 복원하는 별도 도구를 준비한다. 원본 검증 설정·고정 백업 프로필·아카이브의 원본 환경 표시는 바꾸지 않는다. 생성 실패나 결제 요구 시 우회하지 말고 원인을 기록하며 원본 검증 재개를 우선 검토한다. 전체 **16/22개**를 유지한다.

## 2026-10-15 01:26 KST — 별도 원격 복원 대상의 무료 한도 확인

Git 브랜치·기존 미커밋 파일 및 위 백업 증거를 읽고 B4의 남은 원격 복원 대상을 검토했다. 앱 어댑터는 `partner_hub` search_path를 고정 사용하고 덤프도 같은 스키마를 포함하므로 기존 검증 프로젝트에 그대로 복원하면 보존할 원본과 충돌한다. 임의 스키마 변경이나 원본 덮어쓰기로 복구 성공을 만들지 않는다.

Supabase 조직 `partner-hub`(FREE)의 실제 프로젝트 목록에서 운영 `yievsveuxjnbygatvjtb`와 검증 `oaqodendjnztzcqaahaq` 2개를 확인했다. 새 프로젝트 화면은 해당 계정의 **무료 활성 프로젝트 한도 2개 도달** 메시지로 생성을 차단했다. 생성 양식 제출·비밀번호 입력·프로젝트 일시 정지·삭제·업그레이드는 수행하지 않았다. 화면 증거는 Git 제외 `work/supabase-recovery-free-limit-20261015.jpg`다. 조직 사용량은 집계 지연 가능성이 있으므로 이 화면의 Storage 사용량을 방금 직접 대조한 객체 14개의 바이트 총량 대신 사용하지 않는다.

[공식 요금 안내](https://supabase.com/docs/guides/platform/billing-on-supabase#free-plan)는 소유자/관리자인 조직 전체에 무료 프로젝트 2개 한도를 적용하며 일시 정지한 프로젝트는 한도에서 제외한다고 설명한다. [공식 일시 정지 안내](https://supabase.com/docs/guides/platform/free-project-pausing#restoring-a-paused-project)는 정지 후 1년 이내 데이터·설정을 포함한 재개를 안내한다. 이는 제공자의 정책이며 로컬 암호화 백업·복구 키를 대체하지 않는다.

**당시 대표 결정용 실행안(후속 01:37 기록에서 승인·정지 완료):**

1. 운영 프로젝트는 유지하고 `partner-hub-verification-20261014`만 잠시 정지한다. 이 동안 기존 검증 앱의 접속은 중단되며 가상자료·암호화 백업·기존 증거는 삭제하지 않는다.
2. 무료 한도가 실제 확보된 경우에만 같은 조직에 `partner-hub-recovery-20261015`를 생성한다. 유료 전환이나 카드/결제 요구가 있으면 중단한다. 새 DB 비밀번호 입력·제출은 대표가 한 번 직접 수행해야 한다. 기존 운영·검증 비밀번호 재설정은 없다.
3. 새 ref가 운영·원본 검증 ref 모두와 다른지, `partner_hub` 스키마 및 복원 버킷이 비어 있는지 먼저 확인한 뒤 복원 도구를 해당 대상에만 제한한다. 기존 고정 백업 프로필을 새 ref로 덮어 바꾸지 않는다. 복원한 원본의 환경 표시·마이그레이션 이력은 원본 근거로 보존하고 새 목적지 신원은 별도 검증 기록으로 결속한다.
4. 이미 검증한 암호화 백업 한 개로 DB와 파일 14개를 복원한다. 기존 자료를 지우는 `--clean` 복원·원본 DB 쓰기·새 전체 백업 생성은 하지 않는다. 대상의 테이블·권한·파일 해시 및 앱 로그인/담당 접근을 대조한다. 모바일·전체 업무 V4는 반복하지 않는다.
5. 완료 후 복원용 프로젝트를 일시 정지하고 원래 검증 프로젝트를 재개한다. 두 프로젝트를 삭제하지 않고 무료 한도와 복원 결과를 기록한다. 정지·재개·신규 생성은 이 실행안에 대한 대표 승인을 받은 뒤에만 수행한다.

현재는 무료 한도를 확보하려면 기존 검증 프로젝트의 가용성을 바꿔야 하므로 결정 대기다. 이는 자동 승인 심사 거절이나 로그인/키/비밀번호 실패가 아니다. 기존 기록의 완료 수 **16/22개**를 유지하고, 답변 또는 새 근거가 없으면 같은 한도 화면·검사·백업을 반복하지 않는다. 새 목표·기능을 임의로 추가하지 않는다.

## 2026-10-15 01:16 KST — 합성 DB·실제 파일의 암호화 백업 및 로컬 복원 통과

V4가 남긴 실제 검증 DB와 Storage 파일을 원본으로 B2/B4의 로컬 복원 부분을 진행했다. **39개 테이블·108개 행, 파일 객체 14개·111,634,766 bytes**의 암호화 백업을 생성하고 별도 localhost PostgreSQL 17.11에서 복원·대조했다. 스키마·소유자·권한·규칙·테이블 내용과 파일 바이트가 일치했고 임시 DB 서버·평문 복원 폴더 정리까지 확인했다. 108개 행에는 인증·세션·이력·합성 업무가 포함되며 고객 108건을 뜻하지 않는다.

파일 원장이 참조한 보존 버전 7개·활성 참조 7개가 모두 일치했고, 원장 외 객체 7개도 빠뜨리거나 삭제하지 않고 함께 보존했다. 원장이 참조한 총량은 55,817,383 bytes다. 원본에는 읽기 전용 DB 스냅샷과 Storage 조회만 수행했으며 원본 쓰기 0건이다. DB와 Storage 사이의 원자적 스냅샷은 아니고, 기존 도구의 전후 내용·목록 대조가 일치한 결과다.

- 새 `supabase-backup-target.mjs`는 기존 운영 프로필(38개 테이블)을 유지하고 이번 검증 ref·loopback origin·전용 버킷만 별도 고정 프로필(환경 표시 포함 39개 테이블)로 허용한다. 검증 설정 누락 시 부모 환경으로 대체하지 않는다. DB 스냅샷의 singleton 검증 표시와 복원 archive의 ref·purpose·bucket도 대조한다.
- 새 `check-supabase-verification-backup.mjs`는 보호 설정과 통과한 HTTP 상태를 읽어 기존 암호화·로컬 복원 함수를 실행한다. `backup-status.json`을 배타적으로 생성하므로 통과·실패 기록이 있으면 자동 재실행하지 않는다. 원격 복원 대상 인수는 없다.
- `supabase-backup.mjs`의 기존 CLI·일일 예약은 기본 운영 프로필을 그대로 쓴다. 운영 연결을 실행한 것이 아니다. Git commit 읽기에는 이 checkout 한정 `safe.directory`를 명령별 적용한다.
- 새 대상/환경/복원 차단 검사 **4/4**, 관련 런타임·예약 회귀 **22/22**, 변경 파일 lint·서식 및 전체 TypeScript 검사가 통과했다. 실제 실행은 exit 0이다. 이미 통과한 V4·전체 일반 회귀·앱 빌드는 반복하지 않았다.
- 보호 상태: `C:\Users\A\AppData\Local\Temp\partner-hub-verification-WxDlWT\backup-status.json`. 백업: `C:\Users\A\PartnerHubBackups\backup-6ylaLP\partner-hub.phbackup`. 복구 키는 별도 `C:\Users\A\PartnerHubRecoveryKeys` 하위 보호 폴더에 있으며 상태 파일에서만 정확한 경로를 확인한다. 키 내용은 출력하지 않았다. 실제 파일 존재와 현재 사용자·SYSTEM만 허용한 ACL을 재확인했다.
- 암호문 SHA-256: `97fb9424bf7fef79e5c87c93009ed210b46d1775c6a46e381a640f868f74c5cf`. Git 제외 비밀값 없는 증거는 `work/supabase-backup-live-proof-20261015.json`이며 실제 실행 소스 4개의 SHA-256도 보존했다. 소스는 아직 미커밋이므로 archive의 Git HEAD만으로 새 실행기 코드를 식별하지 않는다.

**전체 완료는 16/22개로 유지한다.** B2의 이 PC 무인 백업 예약 관찰, B3의 PC 밖 암호문·복구 키 분리 보관, B4의 별도 Supabase DB·Storage 재업로드 및 앱 접근 대조는 미완료다. 합성 파일의 실제 로컬 복원 성공을 운영 복구 성공으로 바꾸어 기록하지 않는다. 다음에는 기존 원본·검증 증거를 덮지 않는 별도 복원 대상 조건과 승인 범위를 검토한다. 이번 백업과 V4를 새 근거 없이 재실행하지 않는다.

## 승인과 실제 준비 결과

2026-10-14 대표가 운영과 분리된 Supabase 검증 환경 준비 및 실제 업무 흐름의 자동 검증을 명시 승인했다. 앞선 문서의 신규 환경 승인 대기는 이 범위에서 해소됐다. 단독 작업과 15분 heartbeat를 유지한다.

| 항목 | 실제 확인 결과 |
| --- | --- |
| 프로젝트 | `partner-hub-verification-20261014` |
| 검증 ref | `oaqodendjnztzcqaahaq` |
| 운영 ref, 접근 금지 | `yievsveuxjnbygatvjtb` |
| 조직·요금 | 기존 `partner-hub` 조직, 대시보드 Free 표시. 유료 변경 없음 |
| 리전·상태 | Singapore / `ap-southeast-1`, Healthy |
| 앱용 스키마 | 대시보드 SQL Editor에서 저장소의 0001~0019를 한 트랜잭션으로 실제 적용 |
| 이력·격리 표시 | `partner_hub.schema_migrations` 19개, 원본 SHA-256 기록. `verification_environment`에 검증 ref·목적 기록 |
| RLS | 실제 쿼리에서 RLS 미설정 테이블 0개 |
| 브라우저 역할 접근 | `anon`·`authenticated` 모두 `partner_hub` USAGE false |
| Storage | `partner-hub-verification-private` 생성 후 API 재조회. public=false, 26,214,400 bytes, MIME `application/octet-stream` 단일 허용 |
| Next 업무 검증 | 실제 Next HTTPS + 검증 Supabase로 **134개 확인 항목 통과**. 상담부터 사후관리까지 저장, 파일 해시·권한·세션 폐기 확인 |
| 독립 DB 세션 | 서로 다른 PostgreSQL 세션 2개의 겹친 SERIALIZABLE 트랜잭션에서 초안 동시 수정·충돌·재저장 확인 |
| 문서·음성 2슬롯 | 별도 실제 HTTP 검사 51개 통과. 5MiB 문서·25MiB 무음 음성, 부분 저장 차단·중복 방지·양쪽 다운로드 해시 일치 |
| 브라우저·모바일 | 관리자 로그인·15/15 사후관리 표시, 모바일 저장 및 담당 파트너 새 로그인에서 재조회, 역할별 수정 UI 제한, 메뉴·계약/입금·다운로드 처리 확인 |

Supabase의 새 프로젝트 내부 기본 브랜치에는 `main PRODUCTION`이라는 공급자 표시가 붙는다. 이는 이 새 검증 프로젝트의 기본 브랜치다. 기존 Partner Hub 운영 프로젝트·Git main·Vercel 운영 배포와 혼동하지 않는다.

가상 업무 자료만 쓴다. 실제 고객자료·외부 발송·은행 이체·실제 계약·유료 AI·운영 인증은 실행하지 않았다.

## 최신 실행 결과 — 2026-10-14 11:41 KST 이후

대표가 비밀번호 저장 완료 문구를 확인한 뒤 `plan` 및 `prepare`를 실제 실행했다. 보호 설정·운영 ref 분리·DB 인증이 통과했고 기존 스키마와 버킷은 각각 `already-prepared`로 대조됐다. **비밀번호 저장·새 키 교체는 모두 완료됐다. 아래 이전 대기 이력으로 돌아가지 않는다.**

실제 업무 실행 ID는 `e076ccd9-49f7-4864-9b67-972b11d4bf7f`, 합성 업무 ID는 `verification-e076ccd9-49f7-4864-9b67-972b11d4bf7f`다. mock HTTP·로컬 DB 대체 없이 실제 Next와 Supabase를 사용했다.

| 단계 | 확인한 결과 |
| --- | --- |
| 인증·권한 | 24개 누적 확인. 관리자 독립 로그인, 가상 파트너 2명 가입·승인·로그인, 역할 제한과 잘못된 Origin 차단 |
| 전체 업무 | 123개 누적 확인, FLOW revision 23. 보고서 1~6, 1차 상담·수동 전사 검토, 솔루션 확정, 서류 요청·수령·검수, 계약 상담·가상 계약, 가상 입금 2건, 사후관리 |
| 파일 | 130개 누적 확인. 5MB 이상 합성 파일의 앱 발급 직접 업로드, 파트너 다운로드 SHA-256 원본 일치, 비담당자 거절, 원장·객체 크기·무결성 일치 |
| 세션 종료 | **134개 최종 확인**. 두 번째 관리자 세션 폐기 후 401, 첫 번째 세션 유효 유지 |
| 독립 DB 경합 | 서로 다른 backend PID 2개와 겹친 스냅샷 확인. 실제 앱 DB 어댑터의 초안 CAS에서 1건만 커밋·다른 1건은 직렬화 충돌, 오래된 revision 저장 0건, 최신 revision 저장 성공 |

업무 실행기는 exit 0으로 끝났고 소유한 Next 프로세스·연결을 정리했다. 독립 DB 검사도 exit 0이다. 경합 합성 행의 owner는 `verification:5287b50e-6822-4b2d-802f-e9ce82c9282b`이며 증거를 보존했다. 이 결과는 **독립 DB 세션의 초안 저장 경합**이며 두 개의 Next 서버 전체 경합이나 모바일 검증까지 증명하지 않는다.

증거는 아래 보호 폴더의 `status.json`, `run-e076ccd9-49f7-4864-9b67-972b11d4bf7f.jsonl`, `concurrency-status.json`이다. 비밀값 없는 상태 필드만 골라 Git 제외 `work/supabase-verification-live-proof-20261014.json`에도 기록했다. 계정 파일은 비밀값을 포함하므로 내용 출력·Git/OneDrive 복사 금지. 확인 항목 134개는 실제 업무 실행기의 assertions이며 기존 일반 회귀 테스트 개수와 합산하지 않는다. 완료된 HTTP·DB 경합 검사는 새 실패 근거 없이 반복하지 않는다.

통과한 상태를 보여주는 임시 미리보기 `serve-supabase-verification.mjs`의 최초 실행에서 Codex 브라우저는 `https://127.0.0.1:3443`의 자체 인증서에 `ERR_CERT_AUTHORITY_INVALID`를 반환했다. 경고 페이지도 URL 정책상 도구로 캡처할 수 없었다. 인증서 검증 비활성화·HTTP 전환·공개 배포로 우회하지 않았다. 브라우저 도구의 사용자 인계 규칙에 따라 대표에게 **임시 인증서 직접 등록**을 안내했고 후속 실제 등록 확인으로 해소됐다.

- 공개 인증서만 `localhost-public.cer`로 보호 폴더에 내보냈다. 비밀키는 이동·출력하지 않았다.
- 대상 `CN=127.0.0.1`, SAN `127.0.0.1`·`localhost`, 유효기간 종료 2026-10-16 11:22:27 KST.
- 인증서 SHA-1 지문 `DA0D6E7CC16B581AC2BD83F9A48EE902FDA65677`은 공개 식별자다.
- 대표가 해당 인증서를 `Cert:\CurrentUser\Root`에 직접 등록했고 실제 저장소 존재 확인 후 브라우저 검증을 재개했다. 검증 후 이번에 등록된 위 지문 인증서만 제거하고 부재를 확인했다. 다른 인증서나 시스템 정책은 변경하지 않았다.
- 미리보기는 최대 30분 뒤 자동 종료하며 `stop` 입력으로도 종료한다. 만료됐다면 미리보기만 다시 실행한다. HTTP 전체 업무를 재실행할 이유가 아니다.

대표가 인증서 등록 절차의 상세 설명을 요청해 Windows+R → PowerShell → 공개 인증서 등록 명령 → `CN=127.0.0.1` 확인 순서로 안내했다. 11:49 KST 읽기 전용 확인에서는 없었으나 후속 확인에서 해당 CurrentUser 인증서가 실제 등록된 것을 확인했다. 추가 사용자 답변을 기다리지 않고 브라우저를 열었으며 실제 Partner Hub 로그인 화면이 표시됐다. 등록 대기는 해소됐으며 검증 후 제거 결과는 아래 정리 기록을 따른다.

인증서 인계를 기다리면서 기존 V4 범위의 **문서·음성 2슬롯 실전송 51개 확인 항목이 실제 통과**했다(exit 0). 기존 계약 이후 FLOW는 수정하지 않고 `verification-two-slot-60836e29-9d32-4f4a-975c-75c8f529eb13` 상담을 앱 API로 새로 만들었다. 5,242,880-byte TXT와 26,214,400-byte 무음 WAV를 사용했다. 문서만 제출했을 때 409 및 FLOW revision·파일 수 불변, 양쪽 제출 후 revision 1회 증가와 파일 2건 등록, 같은 제출 중복 방지, 두 다운로드의 SHA-256 원본 일치를 확인했다. 검사 전용 로그인 2개는 종료했다. 보호 폴더 `two-slot-status.json`이 근거이며 같은 검사를 반복하지 않는다.

### 실제 브라우저·모바일 확인과 한계

- Codex 브라우저에서 검증 관리자 로그인 후 대표 대시보드와 기존 합성 FLOW의 **15/15 사후관리**를 확인했다.
- 모바일 viewport를 390×844로 요청했다. 실제 DOM의 `clientWidth`, `scrollWidth`, body 폭은 모두 375px로 수평 넘침이 없었다. 실제 휴대폰 하드웨어·Safari 시험은 아니다.
- 모바일에서 사후관리 내용을 `가상 수행 확인 · 모바일 화면 저장 검증`으로 입력하고 확인 체크 후 저장했다. 실제 성공 문구와 갱신 시각을 확인했다.
- 관리자 로그아웃 후 담당 파트너로 새 로그인하여 같은 저장 내용을 서버에서 다시 조회했다. 파트너에게 관리자 전용 사후관리 입력란·계정관리 메뉴가 표시되지 않음을 확인했다.
- 모바일 메뉴와 담당 기업 선택, 계약·입금 탭에서 가상 입금 2건·약정 계약금 일치·잔액 0원을 확인했다.
- 브라우저 다운로드 이벤트 추적(`waitForEvent`)이 응답하지 않아 첫 미리보기의 30분 종료 후 연결 거절이 확인됐다. 도구 호출이 장시간 반환되지 않았으며 PC 절전 등 정확한 원인은 확정하지 않는다. 두 번째 10초 제한 시도도 도구 시간 초과여서 이벤트 추적은 중단했다.
- 미리보기만 다시 실행하고 기본 AX 제어로 다운로드 버튼을 눌러 `원본을 내려받는 중…`에서 정상 버튼으로 돌아오고 오류 표시가 없음을 확인했다. **OS에 저장된 브라우저 다운로드 파일 경로·바이트는 도구 제한으로 미확인**이다. 앱 경유 원본 크기·SHA-256은 별도의 실제 HTTP 검사에서 검증했다. 이를 브라우저 저장 파일의 바이트 검증으로 바꿔 보고하지 않는다.
- Git 제외 화면 증거: `work/verification-desktop-aftercare-20261014.jpg`, `work/verification-mobile-save-20261014.jpg`, `work/verification-mobile-contract-20261015.jpg`. 키·비밀번호 화면은 캡처하지 않았다.
- 브라우저 관측과 범위 한계는 비밀값 없는 `work/supabase-browser-live-proof-20261015.json`에 기록했다. 앞선 HTTP 실행의 `browserMobileVerified=false`는 해당 실행기만의 범위이며 이 후속 브라우저 증거와 구분한다.
- 2슬롯 도구도 구문·formatter·lint와 실제 실행을 통과했다. 전체 일반 회귀·빌드는 변경 근거 없이 반복하지 않았다.

위 결과로 기존 V4의 실제 업무·권한·앱 경유 파일 전송·독립 DB 세션 동시 수정·모바일 확인 조건을 충족했다. **V4 완료, 전체 16/22개(73%)**이며 M2/M3/B2/B3/B4/O2 6개는 미완료다. 운영 배포·운영 인증·실제 고객 이관·외부 발송·유료 AI는 실행하지 않았다. 여러 Next 서버의 동시 HTTP 경합·실기기별 UI 전수검사·성능 부하 시험을 완료했다고 주장하지 않는다.

### 검증 후 정리 — 2026-10-15

관리자·파트너 브라우저 로그인은 각각 로그아웃했다. 모바일 viewport를 원상 복구하고 활성 검증 탭을 닫았다. 일회성 가상 로그인 전달 폴더 2개는 내용을 읽은 직후 삭제했으며 최종 보호 설정 ACL은 확대하지 않았다. 두 번째 미리보기는 표준 입력이 닫혀 `stop` 전달이 불가능했으므로 실행 명령과 부모 관계가 일치하는 이번 프로세스 트리만 종료했고 3443 포트의 LISTEN 부재를 확인했다. 기존 검증 DB·파일·증거는 보존했다.

임시 인증서는 공개 인증서 파일과 지문·주체를 대조했다. PowerShell 인증서 제공자의 제거는 사용자 Root 확인 UI 제한으로 실패했고, .NET 제거도 확인을 기다려 해당 호출만 종료했다. Windows 기본 `certutil -f -user -delstore Root <정확한 지문>`의 사용자 확인에서 대표가 `127.0.0.1` 인증서 삭제에 ‘예’를 눌렀다고 알렸다. **certutil exit 0과 해당 CurrentUser Root 지문의 부재를 실제 확인하여 임시 인증서 제거를 완료했다.** 3443 포트도 LISTEN이 없었다. 이 결과를 브라우저 증거에 반영했으며 인증서 등록·삭제 요청이나 전체 V4 검사를 반복할 이유는 없다. 도구 사용법은 [Microsoft certutil 문서](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/certutil#-delstore)를 확인했다.

기존 `partner-hub` 예약을 공식 도구로 갱신하여 ACTIVE·15분·같은 채팅을 유지했다. V4 완료와 도구 한계를 반영하고 남은 M2/M3/B2/B3/B4/O2만 새 근거에 따라 진행하도록 했다. 새 예약을 중복 생성하지 않았다.

## 이전 준비 이력

1. 대표가 Supabase 로그인 및 검증 프로젝트 생성·새 DB 비밀번호 입력을 직접 완료했다.
2. 대표가 비밀번호 입력 완료를 알렸으나 보호 설정은 `databaseConfigured=false`였다. 이후 대표가 보낸 실제 PowerShell 화면에서 **실행 정책 차단(`PSSecurityException / UnauthorizedAccess`)으로 스크립트가 비밀번호 입력 전에 중단된 것**을 확인했다. 해당 로컬 스크립트에는 인터넷 다운로드 표시(Zone.Identifier)가 없음을 확인했고, `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -NoExit -File <입력 도구 경로> -Config <보호 설정 경로>`로 이 PowerShell 프로세스에만 정책을 적용하도록 수정 안내했다. 실제 사용자 컨텍스트의 Windows PowerShell 하위 프로세스에서 `Process=RemoteSigned`, 다른 정책 범위는 Undefined임을 확인했다. 영구 실행 정책은 변경하지 않았다. 도구의 `Saved only in the private local verification folder. You can return to Codex.` 문구 및 실제 DB 설정 저장 확인 전까지 완료로 간주하지 않는다. 비밀번호는 채팅으로 요청하지 않는다.
3. 검증 서버 키를 읽는 도중 일부 문자열이 도구 기록에 표시되어 대표에게 알렸고 교체했다. 대표가 **`verification_runtime_20261014` 새 Secret 키 발급 및 기존 검증 Secret `default` 삭제를 직접 완료했다.** 실제 목록에서 새 키 존재·기존 Secret default 부재·Publishable default 보존을 확인했다. 운영 키는 변경하지 않았다.
4. 새 키 값을 OneDrive 밖 보호 설정에 저장하고 실제 사용자 컨텍스트에서 바이트 일치와 `keyReplacementRequired=false`를 확인했다. 도구 간 전달용 임시 폴더는 실제 사용자·SYSTEM·Codex 실행 계정만 접근하도록 새로 만들었고 저장 대조 직후 파일과 폴더를 제거했다. 최종 보호 설정의 ACL은 넓히지 않았다. 새 키로 검증 버킷을 한 번 읽어 **HTTP 200, 비공개·26,214,400 bytes·단일 허용 MIME 일치**를 확인했다. 새 키 값은 출력하지 않았다. 이 당시 남았던 DB 비밀번호 로컬 저장은 위 최신 실행에서 해소됐다.
5. AX와 DOM 텍스트는 전체를 출력하지 말고 메모리에서만 읽는다. 부분 마스킹도 접두·접미 문자열을 합치면 복원 가능하므로 금지한다. 기존 브라우저 탭의 Playwright 입력·이동이 반영되지 않는 문제가 있어 안전한 조직 목록으로 임시 탭을 만든 뒤 `cua` 기본 AX 제어와 `emit:false`로 새 키를 읽었다. 키가 공백으로 나뉘어 표시되므로 비밀값을 출력하며 파싱을 조사하지 않는다. 임시 키 확인 탭은 닫았고 기존 탭은 인계 상태로 보존했다.

현재 보호 설정 파일: `C:\Users\A\AppData\Local\Temp\partner-hub-verification-WxDlWT\config.json`. **이 경로는 비밀값이 아니다.** 실제 값은 Git·채팅·OneDrive에 기록하지 않는다. Windows 실제 사용자 `A`와 SYSTEM만 접근하도록 생성했다. 샌드박스 계정이 만든 최초 임시 설정은 이 폴더로 바이트 대조 후 옮겼고 원래 설정 파일은 제거했다. 임시 폴더 정리 시 사라질 수 있으므로 오래된 경로를 추측해 사용하지 말고 존재 여부만 먼저 확인한다.

샌드박스와 실제 사용자 계정이 다르므로 보호 설정을 사용하는 네트워크 명령은 실제 사용자 컨텍스트가 필요하다. 비밀값을 출력해서 이동하거나 작업 저장소로 복사하지 않는다. 보호 폴더의 ACL을 일반 사용자 그룹으로 넓히지 않는다.

## 추가한 실행 도구

- `scripts/supabase-verification-policy.mjs`: 운영 ref, 운영 origin, 비검증 버킷, 잘못된 HTTPS loopback origin, API와 DB의 ref 불일치 차단. 원래 애플리케이션 연결 검사를 재사용한다.
- `scripts/supabase-verification.mjs`: private JSON만 읽는다. `plan`은 무접속. `prepare`는 빈 스키마만 초기화하며 19개 원본 SQL·이력·환경 표시가 함께 커밋된다. 기존 스키마는 검증 표시와 정확한 이력이 일치할 때만 재사용한다. 다른 자료를 덮거나 인증 오류를 재시도하지 않는다.
- `scripts/set-supabase-verification-password.ps1`: 검증 DB의 **기존** 비밀번호를 숨김 입력받아 URL 인코딩한 뒤 지정된 보호 설정에만 저장. 네트워크·비밀번호 재설정 없음.
- `scripts/run-supabase-verification.mjs`: 검증 표시를 확인하고 별도 가상 관리자·파트너 자격증명과 실행 기록을 보호 폴더에 보존한다. 로컬 Next HTTPS를 직접 띄우고 정상 인증서 검증을 사용한다. 현재 `.env*`가 있으면 시작하지 않는다. 미확정 쓰기를 자동 재시도하지 않으며 실패 후 재실행에는 원인 검토와 `--retry-after-review`가 필요하다. 서버·DB 연결은 종료한다.
- `scripts/supabase-verification-flow.mjs`: 실제 HTTP 회원가입·관리자 승인·역할 제한·독립 로그인 쿠키·CSRF 차단·업무 저장·중복 방지·보고서 1~6·상담·전사·자료 요청/검수·가상 계약/입금/사후관리·5MB 이상 파일 직접 업로드·다운로드 해시·원장 대조·로그아웃을 수행하도록 작성했다. 브라우저/모바일 및 독립 서버 검증은 별도 미완료로 보고한다.
- `scripts/check-supabase-verification-concurrency.mjs`: 통과한 HTTP 실행 후 검증 DB의 가상 초안 1건으로 독립 세션 경합을 검사하고 보존한다. 이전 결과가 있으면 자동 재실행하지 않는다.
- `scripts/serve-supabase-verification.mjs`: 통과한 HTTP 상태와 보호 설정으로만 30분 제한 HTTPS 미리보기를 띄운다. 계정 생성·키 출력·배포 없이 기존 합성 결과의 브라우저 검증을 지원한다.
- `scripts/check-supabase-verification-two-slot.mjs`: 완료한 HTTP 실행의 가상 계정으로 새 상담을 실제 API에서 준비하여 문서·음성 2슬롯만 검증한다. 자체 결과 파일의 배타적 생성으로 중복 실행을 막고 불명확한 쓰기를 자동 재시도하지 않는다.

관리자 이메일은 앱의 기존 대표 관리자 식별자를 사용하지만 **검증 DB 전용 임의 비밀번호**를 만든다. 운영 계정이나 비밀번호를 복사·재설정하지 않는다.

## 검사 및 증거

- `tests/supabase-verification.test.ts`: 새 **8/8개 검사 통과**. 운영/불일치 대상 거부, 위험한 버킷 설정 거부, Storage 실패 시 재시도 금지, 19개 SQL 원자적 적용·정확한 재개·실패 롤백·기존 데이터 보존, 키 교체 대기 차단 확인.
- Windows에서 기존 보호 폴더의 ACL을 다시 쓰는 동작이 실패하는 현상을 추가 검사로 재현했다. 검증 설정을 읽을 때는 ACL을 변경하지 않고 현재 사용자 소유·상위 권한 상속 차단·현재 사용자와 SYSTEM 외 허용 규칙 없음만 읽기 전용 확인하도록 수정했다. 관련 재검사 8/8 통과. 기존 백업 도구는 변경하지 않았다.
- 이는 PGlite와 합성 HTTP 응답을 이용한 **새 준비 도구 검사**다. 별도로 실제 Supabase SQL Editor의 적용·RLS 및 실제 Storage API 결과를 위 표에 기록했다.
- 새 MJS 4개와 새 TS 검사 lint 통과, 전체 TypeScript 검사 통과, PowerShell 입력 도구 구문 검사 통과. 실제 업무 실행기 성공을 의미하지 않는다.
- Git 제외 증거: `work/supabase-verification-schema.sql`, `work/supabase-verification-schema-proof.png`, `work/supabase-verification-create.png`, `work/supabase-verification-key-replacement.png`. 키 값이 들어 있는 화면 캡처는 저장하지 않는다.
- 11:41 KST 이후 추가한 미리보기·독립 DB 경합 도구 2개는 Node 구문 검사·formatter·lint를 통과했다. 관련 실제 실행 결과는 최신 표를 따른다. 기존 일반 회귀·빌드는 변경 근거가 없어 반복하지 않았다.

## 다음 실행 순서

V4 실검증은 완료됐다. 자동 후속 작업은 기존 미완료 M2/M3/B2/B3/B4/O2 중 새 근거와 승인 범위가 있는 항목 하나를 선택한다. 이번 합성 DB·실제 객체는 후속 백업/복원 검증의 입력 근거로 활용할 수 있으나 백업·별도 복원 대상·필요 도구를 먼저 검토하고 운영 완료로 앞당겨 표시하지 않는다. 실고객 이관·운영 인증·외부 알림은 별도 승인 제한을 유지한다. 아래 미리보기 명령은 새 UI 실패 근거가 있을 때에만 사용하며 정기적으로 다시 실행하지 않는다.

```powershell
$partnerNode = 'C:\Users\A\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$verificationConfig = 'C:\Users\A\AppData\Local\Temp\partner-hub-verification-WxDlWT\config.json'
& $partnerNode scripts/serve-supabase-verification.mjs --config $verificationConfig
```

준비와 HTTP 전체 검증 명령은 이력에 남겨두되 완료 상태를 삭제하여 재실행하지 않는다. 운영 URL로 대체하거나 운영 인증을 시도하지 않는다. 실제 검증에서 새 실패가 나오면 안전한 단계 코드와 DB·원장 상태를 조사하여 관련 코드를 수정하고 필요한 범위만 검증한다. 자체 인증서 브라우저 경고는 사용자 인계 없이 우회하지 않는다.

**체크리스트는 16/22개(73%), 남은 6개다.** 운영 이관·백업·외부 알림 항목은 완료로 바꾸지 않는다.
