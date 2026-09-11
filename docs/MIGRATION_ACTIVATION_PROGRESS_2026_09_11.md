# 기존 Sites 기능과 자료의 Vercel 이전 진행

**배포 진행 정정:** 후속 사용자 요청으로 `main` 푸시와 Vercel 배포를 진행한다. Production 백엔드 활성값 `1`은 저장 완료다. 익명 사용자는 로그인 화면에 도달하며 관리자나 빈 포털 상태가 자동 생성되지 않는 것을 코드로 확인했다. 아래 활성화·재배포 미실행 기록은 이전 시점이다. 관리자 설정과 기존 자료 이관 미완료 상태는 유지된다.

**후속 사용자 정정:** 새 운영 구조는 오직 Next.js + Supabase이며 Vercel은 배포용입니다. 아래 Sites 로그인 차단과 Anthropic API 키 요청은 원본 수집·기존 외부 AI 기능에 관한 과거 진행 기록입니다. 두 항목을 새 기본 서비스 운영의 필수 조건으로 요구하지 않습니다. 차단된 원본 로그인은 재시도하지 않고 외부 AI는 비활성으로 유지합니다. 기존 자료 보존 요청은 유지되며 전체 이관이 완료된 것은 아닙니다.

2026-09-11. 사용자가 기존과 같은 DB·자료·기능으로 Vercel 서비스를 사용하도록 설정할 것을 요청했다. **기존 Sites 자료를 이관하는 방향은 확정됐다.** 신규 빈 서비스 선택을 다시 질문하지 않는다. 현재 서비스 활성화·이관·재배포 완료 상태는 아니다.

## 이번에 확인한 원본

- Sites 프로젝트 `appgprj_6a92514801988191b79eb9bd314e3fcd`, 운영 URL `https://keve-partner-hub.smkim3733.chatgpt.site`, 소유자 접근과 기존 public 설정을 확인했다. 원본 설정·자료를 수정하지 않았다.
- D1 `DB`의 30개 사용자 테이블을 조회했다. `portal_state`, `application_drafts`, `consulting_flows`, `portal_chatgpt_identity_bindings`에 각각 1행이 있고 나머지 26개 표는 이번 조회에서 0행이었다. 모든 호출의 `has_more=false`를 확인했다. 여러 호출에 걸친 읽기이며 동결된 일관 스냅샷이 아니다.
- `portal_state.payload`는 도구의 `truncated=true`, `truncated_values=1` 상태다. 페이지가 끝났어도 본문은 불완전하다. 잘린 값으로 백업 또는 Supabase 복원을 하지 않았다.
- 초안과 FLOW는 각각 revision 1이다. FLOW의 파일·보고서·회의·녹취·서류요청·입금 배열은 비어 있고 명령·감사 이력이 1개 있다. 기존 FLOW를 새 빈 FLOW로 덮어쓰지 않는다.
- 기업/FLOW 파일·예약·해시 원장에 등록된 행은 0건이다. R2의 전체 객체 목록과 미참조 객체를 확인한 것은 아니므로 전체 R2가 비었다고 판단하지 않는다.
- 기존 AI 설정은 `ANTHROPIC_EXTERNAL_PROCESSING_ENABLED=true`, 모델 `claude-opus-5`다. `ANTHROPIC_API_KEY`는 Secret으로 존재하지만 값 조회가 불가능하며 로컬에도 없다.

## 실제 Supabase 검사

실행 도구는 Git 제외 `work/check-supabase-live-20260911.mjs`다. 원본 자료·운영 버킷을 쓰지 않고, DB 검사는 롤백하며 Storage는 무작위 이름의 별도 비공개 검증 버킷을 생성해 수행했다.

- 실제 앱 DB 연결 경로로 `supabase-auth-rollback.sql`, `supabase-storage-rollback.sql` 통과. 인증/RLS·불변 감사·포털 제약·Storage CAS·외래 키·실패 원자성을 검사하고 대상 상태가 비어 있음을 확인했다.
- 실제 서명 업로드 CORS, 1KiB와 **25MiB** 합성 파일 업로드, 메타데이터 조회, 다운로드 길이·SHA-256 일치 통과.
- 비로그인 다운로드 거절 및 틀린 SHA-256 거절 통과.
- 25MiB+1바이트는 HTTP 400 안에 Storage 상태 413으로 거절됐다. 최초 검사 도구가 최상위 HTTP 413만 예상해 실패했으며, 실제 응답을 분리 확인해 용량 제한 작동과 객체 미생성을 검증했다. 앱 코드는 수정하지 않았다.
- 생성한 검증 객체의 정확한 경로와 해당 검증 버킷만 제거했다. 후속 SQL에서 검증 버킷 0개, 운영 객체 0개, 운영 관리자·포털 상태 각 0행을 확인했다.
- 로그: `work/supabase-live-check-20260911-initial.json`, `work/supabase-live-check-20260911.json`. 자격증명·서명 URL·업무 원문은 기록하지 않는다. 이 검사는 Vercel 런타임의 로그인·FLOW·전체 기능 검증을 대신하지 않는다.

Storage 관리 경로는 [공식 버킷 API 구현](https://github.com/supabase/storage-js/blob/master/src/packages/StorageBucketApi.ts)과 [공식 파일 API 구현](https://github.com/supabase/storage-js/blob/master/src/packages/StorageFileApi.ts)을 참고했다.

## 준비한 설정과 남은 입력

- 기존 모델 `claude-opus-5`를 로컬 및 `keve1/partner-hub` Production의 `ANTHROPIC_MODEL` Config로 저장했다. Vercel 저장 성공과 Config/Production 목록을 확인했다. 현재 변수는 **Config 7개 + Secret 2개, 총 9개**다. 외부 AI와 백엔드는 아직 비활성이고 재배포는 하지 않았다.
- 사용자가 입력한 관리자 비밀번호는 최소 15자 조건에 맞지 않아 저장하지 않았다. 값을 기록하거나 임의로 늘리지 않고 수정된 15~128자 비밀번호를 요청했다. DB 비밀번호는 다시 요청하지 않는다.
- 기존 Sites 관리자 로그인 버튼을 누르는 과정에서 자동 승인 검토가 `auth.openai.com` 접근을 차단했다. 구체적인 해당 로그인 승인이 없다는 사유였다. 사용자의 로그인 허용 또는 직접 진행 답변을 요청했고 우회·재시도하지 않았다.
- 기존 AI 기능 복원을 위해 Vercel Production에 저장할 Anthropic API 키를 요청했다. 기존 Sites Secret은 조회만으로 이전할 수 없다.

## 다음 작업

1. 유효한 관리자 비밀번호를 받으면 기존 TTY CLI의 서비스 주소 확인과 비밀번호 재입력을 유지해 초기 설정한다. 관리자 비밀번호·DB 비밀번호를 문서·로그에 기록하지 않는다.
2. 승인된 기존 Sites 로그인 또는 정식 내보내기 경로로 잘리지 않은 원본과 일관성 증거를 확보한다. 로그인 성공만으로 전체 백업 완료로 판정하지 않는다.
3. 원본을 검사해 역사 FLOW·초안·회원/관리자 소유권을 보존하는 별도 이관 경로를 검증한다. 현재 실제 import 구현은 없으며, 기존 FLOW INSERT는 revision 0의 빈 기준행만 허용하므로 역사 행을 일반 INSERT로 복사할 수 없다. 트리거 비활성화나 가짜 이력 재생으로 우회하지 않는다.
4. ChatGPT 로그인은 Supabase/Vercel 인증에서 지원하지 않는다. 기존 ChatGPT 결속을 새 로그인 권한으로 자동 신뢰하지 않고 독립 관리자 및 파트너 비밀번호 설정을 통해 권한을 연결한다. 기존 앱은 이메일 자동 발송 없이 설정 링크를 전달하는 구조다.
5. AI 키를 승인된 Production Secret에 저장하고 기존 동의·외부 처리 검사를 유지해 준비도를 확인한다. 실제 기업 자료를 무단 시험 전송하지 않는다.
6. 분리된 환경에서 실제 로그인·승인·권한 철회·FLOW·파일 기능과 이관 일치를 검증한 뒤 활성화·새 배포·운영 검증을 수행한다. 기존 Sites 원본은 보존한다.
