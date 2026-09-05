# 개발 문서 목록

고객별 자료를 제외하고 이번 프로젝트의 기획과 구현 기준을 모았습니다. 날짜가 붙은 기획서는 당시의 설계 기록으로, 모든 항목이 구현 완료되었다는 뜻은 아닙니다.

| 문서                                                                                                             | 내용                                                                                     |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [다른 컴퓨터 개발 인수인계](CONTINUE_ON_ANOTHER_COMPUTER.md)                                                     | 현재 커밋·검증·Sites 배포 상태, 새 PC 시작 순서와 Git 제외 항목                          |
| [순차 점검 1: 회수 저장 잠금](RECOVERY_LOCK_REVIEW_2026_08_31.md)                                                | 응답 유실 후 편집 잠금 유지, 동일 요청 재시도, 최신 화면 확인                            |
| [현재 구현과 다음 확인 순서](CURRENT_STATUS.md)                                                                  | 현재 기능, 완료 범위, 연속 점검 목록과 사용자 결정 사항                                  |
| [기업자료 R2 객체 무결성 경계](COMPANY_FILE_R2_OBJECT_INTEGRITY_2026_09_05.md)                                   | 신규 원본 ETag·고정 MIME 결속, 다운로드·AI 입력·회수 전 객체 변조 차단                   |
| [상담 FLOW R2 객체 무결성 경계](FLOW_FILE_R2_OBJECT_INTEGRITY_2026_09_05.md)                                     | 신규 파일 ETag·고정 MIME 결속, 같은 크기 바이트·객체 MIME 교체 차단                      |
| [상담 FLOW 파일 메타데이터 원장 무결성 경계](FLOW_FILE_METADATA_LEDGER_INTEGRITY_2026_09_05.md)                  | 이름·MIME·크기·용도·유입 증빙 결속과 v159 호환 가산 마이그레이션                         |
| [상담 FLOW 파일 진행 소유권 무결성 경계](FLOW_FILE_CASE_OWNERSHIP_INTEGRITY_2026_09_05.md)                       | 파일 ID·R2 키의 전역 진행 결속, 충돌 안전 백필과 교차 진행 참조 격리                     |
| [상담 FLOW 파일명 무결성 경계](FLOW_FILE_NAME_INTEGRITY_2026_09_05.md)                                           | 업로드 공용 NFC·경로·제어문자·공백·180자 정규형과 축소 전 손상 이름 격리                 |
| [상담 FLOW 파일 저장 키 무결성 경계](FLOW_FILE_STORAGE_KEY_INTEGRITY_2026_09_05.md)                              | 파일 ID와 `consulting-flow/` R2 키 결속, 외부 비공개 객체 참조 격리                      |
| [상담 FLOW 파일 확장자·MIME·목적 무결성 경계](FLOW_FILE_FORMAT_INTEGRITY_2026_09_05.md)                          | 목적별 허용 확장자·고정 MIME 등록표와 SQLite 축소 전 손상 형식 격리                      |
| [상담 FLOW 파일 목적·크기 무결성 경계](FLOW_FILE_METADATA_SIZE_INTEGRITY_2026_09_05.md)                          | 저장 목적 허용 목록, 용도별 5MB·8MB·25MB 상한과 SQLite 축소 전 손상 격리                 |
| [상담 FLOW 정확 객체 구조·공개 투영 무결성 경계](FLOW_EXACT_OBJECT_SHAPE_INTEGRITY_2026_09_05.md)                | 미정의 추가 속성 저장 차단, 명시적 공개 필드 투영과 SQLite 숨김 객체 검사                |
| [상담 FLOW 잘못 구성된 Unicode 무결성 경계](FLOW_MALFORMED_UNICODE_INTEGRITY_2026_09_05.md)                      | 짝이 없는 UTF-16 surrogate의 저장·SQLite 변형·상세와 대시보드 불일치 차단                |
| [상담 FLOW Unicode 문자열 길이 무결성 경계](FLOW_UNICODE_TEXT_LENGTH_INTEGRITY_2026_09_05.md)                    | JavaScript·SQLite의 코드 포인트 길이 계약 통일과 UTF-8 전체 바이트 상한 유지             |
| [상담 FLOW 숨김 필드 의미 무결성 경계](FLOW_HIDDEN_SEMANTIC_INTEGRITY_2026_09_05.md)                             | 축소 전 Unicode 공백·잘못된 날짜·AI 작업 시간 역전 검사                                  |
| [상담 FLOW payload 최상위 구조 무결성 경계](FLOW_PAYLOAD_STRUCTURE_INTEGRITY_2026_09_05.md)                      | 필수 문자열·배열·객체를 저장 읽기·SQLite 축소·클라이언트에서 공통 검증                   |
| [상담 FLOW 저장 전이·수정시각 무결성 경계](FLOW_COMMIT_TRANSITION_INTEGRITY_2026_09_05.md)                       | 진행·담당 ID 불변, revision 1단계 증가와 D1·payload 수정시각 일치 강제                   |
| [상담 FLOW 저장 행·payload 무결성 경계](FLOW_STORAGE_ENVELOPE_INTEGRITY_2026_09_05.md)                           | D1 진행·담당·revision 열과 JSON payload 대조, 권한 판단 전 손상 상태 격리                |
| [상담 FLOW 첨부 다운로드 원본 크기 무결성 경계](FLOW_ATTACHMENT_DOWNLOAD_OBJECT_INTEGRITY_2026_09_05.md)         | FLOW 저장 크기와 R2 실제 크기 대조, 조회 중 변경·손상된 첨부 본문 반환 차단              |
| [기업자료 다운로드 원본 크기 무결성 경계](COMPANY_FILE_DOWNLOAD_OBJECT_INTEGRITY_2026_09_05.md)                  | D1 원장과 R2 실제 크기 대조, 조회 중 메타데이터 변경과 손상 본문 반환 차단               |
| [기업자료 연결 원본 삭제 무결성 경계](COMPANY_DOCUMENT_LINKED_ORIGINAL_DELETION_INTEGRITY_2026_09_05.md)         | 포털 카드가 참조하는 원본의 직접·경합 삭제 차단과 D1/R2 보존                             |
| [기업자료 원본 보관 원장 무결성 경계](COMPANY_DOCUMENT_FILE_PROVENANCE_INTEGRITY_2026_09_05.md)                  | 새 원본 연결의 D1 권위값·업로드 상태·R2 존재 대조와 저장 직전 경쟁 차단                  |
| [기업자료 원본 메타데이터 무결성 경계](COMPANY_DOCUMENT_FILE_METADATA_INTEGRITY_2026_09_05.md)                   | 원본 ID·파일명·크기 조합 검증과 기존 원본 사실 변경·삭제 차단                            |
| [업무·기업자료·일정 필드 무결성 경계](OPERATIONAL_RECORD_FIELD_INTEGRITY_2026_09_05.md)                          | 필수 표시값과 상태·분류·공개범위 허용값 검증, 손상 운영 상태 격리                        |
| [진행 타임라인 기록 무결성 경계](TIMELINE_RECORD_INTEGRITY_2026_09_05.md)                                        | 필수 표시값·안정 ID·진행 연결 검증과 진행 이동·중복 병합 차단                            |
| [업무·기업자료·일정 연결 무결성 경계](RELATED_RECORD_ASSIGNMENT_INTEGRITY_2026_09_05.md)                         | 미존재 진행·담당 계정과 서로 상충하는 직접·진행 담당 연결 차단                           |
| [진행 기록 필드·담당 연결 무결성 경계](CASE_RECORD_INTEGRITY_2026_09_05.md)                                      | 진행 기업명·담당자명과 명단 내 고유 담당 계정 연결 검증                                  |
| [진단평가 기록 무결성 경계](DIAGNOSIS_ASSESSMENT_INTEGRITY_2026_09_05.md)                                        | 평가 필드·허용값·등급 결과 일관성과 정확한 진행 연결 검증                                |
| [포털 상태 메타데이터 무결성 경계](PORTAL_STATE_METADATA_INTEGRITY_2026_09_05.md)                                | 상태 버전·상담번호·명단 revision·진단평가 배열과 고유 ID 검증                            |
| [포털 레코드 ID 무결성 경계](PORTAL_RECORD_ID_INTEGRITY_2026_09_05.md)                                           | 업무·기업자료·일정의 공백·중복 ID 저장과 모호한 병합 차단                                |
| [사건 ID 무결성 경계](CASE_ID_INTEGRITY_BOUNDARY_2026_09_05.md)                                                  | 공백·중복 진행 ID의 타임라인·연결 기록 권한 충돌 차단                                    |
| [포털 레코드 구조 무결성 경계](PORTAL_RECORD_STRUCTURE_INTEGRITY_2026_09_05.md)                                  | 여섯 상태 배열의 비객체 항목 저장 차단과 손상 상태 격리                                  |
| [파트너 식별정보 실행 무결성 경계](MEMBER_IDENTITY_RUNTIME_INTEGRITY_2026_09_05.md)                              | 비문자 이메일·손상 이름의 저장·인증 실패 폐쇄                                            |
| [파트너 권한 실행 무결성 경계](PARTNER_PERMISSION_RUNTIME_INTEGRITY_2026_09_05.md)                               | 레거시 비-boolean 권한의 인증·파트너 응답 최소권한 정규화                                |
| [파트너 계정 편집 무결성 경계](PARTNER_ACCOUNT_EDIT_INTEGRITY_2026_09_05.md)                                     | 회원 편집 허용목록·상태 전이·권한 구조 검증과 레거시 보존                                |
| [파트너 계정 삭제 무결성 경계](PARTNER_ACCOUNT_DELETION_INTEGRITY_2026_09_05.md)                                 | 활성·연결 계정 삭제 차단과 정지·미배정 계정의 안전한 삭제                                |
| [파트너 감사 필드 무결성 경계](MEMBER_AUDIT_FIELD_INTEGRITY_2026_09_05.md)                                       | 일반 상태 저장의 가입 출처·로그인 통계 위조 차단과 전용 서버 경로 보호                   |
| [파트너 안정 ID 생성 경계](STABLE_MEMBER_ID_CREATION_BOUNDARY_2026_09_05.md)                                     | 일반 상태 저장의 신규·교체 ID 차단과 전용 가입·직접등록 경로 강제                        |
| [파트너 안정 ID 무결성](DUPLICATE_MEMBER_ID_INTEGRITY_2026_09_05.md)                                             | 중복·빈 회원 ID의 계정 소유권 혼선과 인증·결속 우회 차단                                 |
| [변경 요청 Origin 필수 보안 경계](MUTATION_ORIGIN_REQUIRED_BOUNDARY_2026_09_05.md)                               | Origin 없는 인증 변경 요청 차단과 정확한 동일 출처 증명                                  |
| [ChatGPT 중복 이메일 결속 무결성](CHATGPT_AMBIGUOUS_EMAIL_BINDING_INTEGRITY_2026_09_05.md)                       | 레거시 중복 이메일의 임의 회원 선택·안정 ID 오결속 차단                                  |
| [ChatGPT 자가등록 중복 이메일 무결성](CHATGPT_REGISTRATION_AMBIGUOUS_EMAIL_INTEGRITY_2026_09_05.md)              | 레거시 중복 이메일의 첫 승인대기 계정 선택·자가등록 오결속 차단                          |
| [ChatGPT 가입 계정 상태 무결성 경계](CHATGPT_REGISTRATION_INTEGRITY_BOUNDARY_2026_09_05.md)                      | 정지 계정 보존, 동일 재시도 무기록과 사용자 ID 기반 반복 가입 제한                       |
| [계정 상태 변경 인증수단 폐기 무결성 경계](PASSWORD_ACCESS_REVOCATION_INTEGRITY_2026_09_05.md)                   | 정지·재활성화·이메일 변경·삭제와 세션·설정 링크의 원자적 폐기                            |
| [로그인 세션·설정 링크 발급 커밋 무결성 경계](PASSWORD_ISSUANCE_COMMIT_GUARD_2026_09_05.md)                      | 동시 상태·비밀번호 변경 뒤 늦은 세션·링크 재생성과 최신 링크 삭제 차단                   |
| [비밀번호 자격 생명주기 무결성 경계](PASSWORD_CREDENTIAL_LIFECYCLE_INTEGRITY_2026_09_05.md)                      | 이메일 변경·회원 삭제의 고아 비밀번호 자격 제거와 정지 계정 자격 보존                    |
| [비밀번호 자격 이메일 예약 무결성 경계](PASSWORD_CREDENTIAL_EMAIL_RESERVATION_INTEGRITY_2026_09_05.md)           | 분리된 자격 이메일의 대표 직접등록·회원 변경 차단과 동일 회원 복구 허용                  |
| [ChatGPT 등록 비밀번호 자격 소유자 결속 무결성](CHATGPT_CREDENTIAL_EMAIL_OWNERSHIP_INTEGRITY_2026_09_05.md)      | ChatGPT 등록 이메일의 회원 ID·비밀번호 자격 소유자 결속과 분리 자격 차단                 |
| [ChatGPT 안정 ID-회원 결속 무결성](CHATGPT_STABLE_IDENTITY_BINDING_INTEGRITY_2026_09_05.md)                      | 동일 이메일 재할당 접근 차단, 안정 ID 해시 결속과 회원 변경·삭제 원자적 해제             |
| [ChatGPT 관리자 안정 ID 결속 무결성](CHATGPT_OWNER_STABLE_IDENTITY_INTEGRITY_2026_09_05.md)                      | 대표 이메일 재할당 권한 승계 차단, 관리자·회원 통합 ID 결속과 수동 복구 경계             |
| [파트너 유형 명시 선택 안전성](PARTNER_TYPE_SELECTION_SAFETY_2026_09_03.md)                                      | 직접등록·승인대기 유형 자동선택 제거와 허용 유형 검증                                    |
| [대표 직접등록 응답 검증 안전성](PARTNER_REGISTRATION_RESPONSE_VALIDATION_SAFETY_2026_09_04.md)                  | 등록 입력·최소 권한·명단 일관성 검증과 손상 응답 재시도 보호                             |
| [원본 보관 현황 응답 검증 안전성](FILE_INVENTORY_RESPONSE_VALIDATION_SAFETY_2026_09_04.md)                       | 목록·필터·커서·파일 ID·원본 존재와 크기 관계 검증                                        |
| [신청자료 검토 응답 검증 안전성](INTAKE_SOURCE_RESPONSE_VALIDATION_SAFETY_2026_09_04.md)                         | 목록 메타데이터·선택 파일·원본 해시·본문 구조 검증                                       |
| [사이트 인증 응답 검증 안전성](PASSWORD_AUTH_RESPONSE_VALIDATION_SAFETY_2026_09_04.md)                           | 가입·로그인·설정·로그아웃별 성공 계약과 안전한 오류 검증                                 |
| [비밀번호 설정 링크 응답 검증 안전성](PASSWORD_LINK_RESPONSE_VALIDATION_SAFETY_2026_09_04.md)                    | 동일 출처 fragment 경로·토큰·만료시각 검증                                               |
| [원본 회수 미리보기 응답 검증 안전성](FILE_RECOVERY_PREVIEW_RESPONSE_VALIDATION_SAFETY_2026_09_04.md)            | 요청 원본·진행·담당·크기·revision 검증                                                   |
| [1차 보고서 사전점검 응답 검증 안전성](REPORT_PREFLIGHT_RESPONSE_VALIDATION_SAFETY_2026_09_04.md)                | 현재 진행·자료 합계·필수 검사·유료 생성 가능값 교차검증                                  |
| [클라이언트 API 응답 경계 최종 감사](CLIENT_API_RESPONSE_BOUNDARY_AUDIT_2026_09_04.md)                           | 전체 fetch 경로·전용 검증기·멱등 무시 응답과 재발 방지 검사                              |
| [서버 API 요청 경계 최종 감사](SERVER_API_REQUEST_BOUNDARY_AUDIT_2026_09_04.md)                                  | 스트림 크기·JSON 형식·객체 구조 검증과 직접 본문 파싱 재발 방지 검사                     |
| [서버 변경 요청 출처 경계 감사](SERVER_MUTATION_ORIGIN_BOUNDARY_2026_09_04.md)                                   | 교차 사이트 신호 통합 판별과 인증·저장소 접근 전 조기 차단                               |
| [서버 JSON 요청 파서 통합](SERVER_JSON_REQUEST_PARSER_CONSOLIDATION_2026_09_04.md)                               | 신청 임시저장·원본 회수·상담 FLOW·비밀번호 요청의 공용 형식·크기 경계                    |
| [서버 멀티파트 요청 경계 통합](SERVER_MULTIPART_REQUEST_BOUNDARY_2026_09_04.md)                                  | 기업자료·상담 FLOW 업로드의 미디어 유형·크기·framing·payload 검증                        |
| [서버 URL 쿼리 요청 경계 통합](SERVER_QUERY_REQUEST_BOUNDARY_2026_09_04.md)                                      | 목록·Step 0·신청자료·보고서 쿼리의 중복·길이·명시 플래그 검증                            |
| [서버 URL 경로 식별값 경계 통합](SERVER_PATH_REQUEST_BOUNDARY_2026_09_04.md)                                     | 진행·파일·원본·첨부·보고서 경로 ID의 문자·길이 검증                                      |
| [다운로드 파일명 Content-Disposition 보안 경계](CONTENT_DISPOSITION_DOWNLOAD_FILENAME_BOUNDARY_2026_09_04.md)    | 기업 원본·상담 첨부·보고서 다운로드 이름의 제어문자 제거와 RFC 5987 인코딩               |
| [다운로드 Content-Type 보안 경계](DOWNLOAD_CONTENT_TYPE_BOUNDARY_2026_09_04.md)                                  | 기업 원본·상담 첨부 응답 MIME의 허용 확장자별 고정과 안전한 기본값                       |
| [업로드 실제 파일 형식 보안 경계](UPLOAD_FILE_SIGNATURE_BOUNDARY_2026_09_04.md)                                  | 기업자료·상담 FLOW 첨부의 확장자와 실제 바이너리 형식 일치 검증                          |
| [업로드 실제 형식 미등록 기본 거절](UPLOAD_SIGNATURE_FAIL_CLOSED_2026_09_04.md)                                  | 새 확장자의 실제 형식 검사 누락을 막는 fail-closed 정책                                  |
| [업로드 텍스트 내용 보안 경계](UPLOAD_TEXT_CONTENT_BOUNDARY_2026_09_04.md)                                       | TXT·Markdown의 문자 인코딩 판독과 바이너리 제어문자 저장 전 차단                         |
| [업로드 파일 형식 공용 등록표](UPLOAD_FORMAT_REGISTRY_2026_09_04.md)                                             | 확장자·고정 MIME·실제 내용 판정·파일 선택값의 단일 정책 원천                             |
| [상담 FLOW 목적별 업로드 형식 정책](CONSULTING_FLOW_UPLOAD_POLICY_2026_09_04.md)                                 | 보고서 차수·AI 근거·녹취·추가서류·계약서의 화면·서버 허용 형식 일치                      |
| [상담 FLOW 목적별 업로드 크기 정책](CONSULTING_FLOW_UPLOAD_SIZE_POLICY_2026_09_04.md)                            | AI 근거·전사문·음성·일반 첨부의 화면·서버 크기 일치와 내용 판독 전 조기 거절             |
| [상담 FLOW 명령 영수증 Content-Type 정책](FLOW_COMMAND_RECEIPT_CONTENT_TYPE_POLICY_2026_09_04.md)                | 브라우저 MIME과 무관한 첨부 멱등 지문, 이전 영수증 호환과 변경 내용 충돌 유지            |
| [업로드 제한 안내 공용화](UPLOAD_LIMIT_LABEL_REGISTRY_2026_09_04.md)                                             | 기업자료·AI 근거·전사문·음성의 실제 크기·개수 정책과 화면·서버 안내 일치                 |
| [기업자료 업로드 Content-Type 저장 정책](COMPANY_UPLOAD_CONTENT_TYPE_POLICY_2026_09_04.md)                       | 브라우저 MIME 불신, 응답·D1·R2 고정 MIME과 배포 전후 재시도 호환                         |
| [신청 첨부 업로드 멱등키 Content-Type 정책](APPLICATION_UPLOAD_KEY_CONTENT_TYPE_POLICY_2026_09_04.md)            | 브라우저 MIME과 무관한 신청 첨부 키, 이전 원장 이동과 파일·삭제 상태 보존                |
| [업로드 멱등키·영수증 파일명 정규화 정책](UPLOAD_RECEIPT_FILENAME_NORMALIZATION_POLICY_2026_09_04.md)            | NFC/NFD 파일명과 무관한 신청 첨부 키·FLOW 영수증, 이전 기록 호환과 중복 원장 보존        |
| [상담 FLOW 화면 재시도 지문 정책](FLOW_CLIENT_RETRY_FINGERPRINT_POLICY_2026_09_04.md)                            | 첨부 실제 바이트·정규 파일명 기반 명령 ID 유지와 파일 수정시각 의존 제거                 |
| [협업신청 첨부 실제 내용 중복 판정 정책](APPLICATION_ATTACHMENT_CONTENT_DEDUPLICATION_POLICY_2026_09_04.md)      | 메타정보 충돌 파일 누락 방지, 정규 파일명·실제 바이트 기반 재선택 중복 판정              |
| [협업신청 첨부 내용 확인 중 제출 잠금 정책](APPLICATION_ATTACHMENT_HASHING_SUBMISSION_LOCK_POLICY_2026_09_04.md) | 바이트 지문 계산 중 제출·임시저장·화면이동 경합과 방금 고른 파일 누락 차단               |
| [브라우저 화면 보안 헤더 경계](BROWSER_PAGE_SECURITY_HEADERS_2026_09_04.md)                                      | Worker·정적 캐시 화면의 클릭재킹·기본 CSP·브라우저 권한 방어와 Sites 버전 105 운영 반영  |
| [빌드 스택 잔여 취약성 제거](BUILD_STACK_SECURITY_UPDATE_2026_09_04.md)                                          | image-size 제거, esbuild 패치, 공급망 예외 없는 Vite·Cloudflare 빌드 스택 갱신           |
| [서버 오류 로그 개인정보 경계](SERVER_ERROR_LOG_PRIVACY_BOUNDARY_2026_09_05.md)                                  | 원본 예외·상세 메시지 로그 제거와 오류 종류만 남기는 재발 방지 검사                      |
| [파트너 접속 통계 무결성·가용성 경계](PORTAL_LOGIN_ACTIVITY_INTEGRITY_2026_09_05.md)                             | 30분 비활동 기준 접속 세션 집계와 비핵심 통계 장애의 포털 조회 격리                      |
| [빌드 도구와 운영 의존성 경계](BUILD_TOOL_RUNTIME_DEPENDENCY_BOUNDARY_2026_09_04.md)                             | shadcn CLI의 빌드 전용 분류, qs 운영 감사 경로 제거와 Sites 버전 103 운영 반영           |
| [운영 의존성 보안 패치와 잔여 위험](DEPENDENCY_SECURITY_PATCH_AND_RESIDUAL_RISK_2026_09_04.md)                   | React/RSC·Vite 패치, 미배포 image-size 수정본과 실제 입력 경계, Sites 버전 102 운영 반영 |
| [업로드 파일명 정규화 보안 경계](UPLOAD_FILENAME_NORMALIZATION_BOUNDARY_2026_09_04.md)                           | 기업자료·상담 FLOW 저장 파일명의 공용 Unicode·제어문자·길이 경계                         |
| [파트너 계정 설정 저장 안전성](PARTNER_ACCOUNT_SETTINGS_DRAFT_SAFETY_2026_09_03.md)                              | 이메일·유형·상태·권한의 저장 전 초안 격리와 취소 폐기                                    |
| [진행 담당 계정 변경 확인 안전성](CASE_ASSIGNMENT_CONFIRMATION_SAFETY_2026_09_03.md)                             | 현재·변경 후 담당 대조, 취소 보존과 저장 직전 재검증                                     |
| [진행단계·중단 상태 변경 확인 안전성](PIPELINE_CHANGE_CONFIRMATION_SAFETY_2026_09_03.md)                         | 수동 단계·진행 중단·재개의 영향 확인과 stale 상태 차단                                   |
| [기업자료 상태 변경 확인 안전성](DOCUMENT_STATUS_CONFIRMATION_SAFETY_2026_09_03.md)                              | 현재·변경 후 상태 영향 확인, 취소 보존과 저장 직전 원본 연결 재검증                      |
| [기업자료 업로드 응답 멱등 반영 안전성](COMPANY_DOCUMENT_UPLOAD_IDEMPOTENCY_2026_09_03.md)                       | 서버 확정 원본 ID 기준 단일 카드 반영, 검토 상태 보존과 중복 저장 ID 병합                |
| [기업자료 업로드 응답 검증 안전성](COMPANY_FILE_UPLOAD_RESPONSE_VALIDATION_SAFETY_2026_09_03.md)                 | 파일·담당·진행 메타데이터 요청 일치 검증과 미확인 필드 제거                              |
| [업무·지원요청 상태 변경 확인 안전성](WORK_TASK_STATUS_CONFIRMATION_SAFETY_2026_09_03.md)                        | 완료·재개·처리 시작 확인과 담당·마감·지원 주기 재검증                                    |
| [가상 진단 검토대기 등록 확인 안전성](DIAGNOSIS_REVIEW_QUEUE_CONFIRMATION_SAFETY_2026_09_03.md)                  | 가상 A 판정 확인, 최신 근거 재검증과 파생 업무의 운영 알림·지표 제외                     |
| [Step 0 가상시험 입력 안전성](STEP_ZERO_PILOT_INPUT_SAFETY_2026_09_03.md)                                        | 빈 가상 입력, 변경 후 재동의, 초과·식별정보의 외부 호출 전 차단                          |
| [AI 진단 준비·Step 0 응답 검증 안전성](AI_DIAGNOSIS_RESPONSE_VALIDATION_SAFETY_2026_09_03.md)                    | 생성 준비 논리와 현재 진행·기업·요청별 결과 구조 검증                                    |
| [외부 AI 공급자 응답 검증 안전성](AI_PROVIDER_RESPONSE_VALIDATION_SAFETY_2026_09_03.md)                          | Anthropic 응답 블록·완료·토큰 구조 검증과 오류 원문 격리                                 |
| [원본 회수 응답 검증 안전성](FILE_RECOVERY_RESPONSE_VALIDATION_SAFETY_2026_09_03.md)                             | 회수 성공 구조 검증, 안전한 오류와 동일 요청 재시도 안내                                 |
| [서류요청 제출기한 알림 안전성](DOCUMENT_REQUEST_DEADLINE_ALERT_SAFETY_2026_09_03.md)                            | 한국시간 기준 기한 상태와 후속 업무 알림·우선순위 동기화                                 |
| [누락 요청서류 제출기한 변경 확인 안전성](DOCUMENT_REQUEST_DUE_DATE_CONFIRMATION_SAFETY_2026_09_03.md)           | 자료·연결 업무·타임라인 변경 전 영향 확인과 최신 상태 재검증                             |
| [서류요청 등록 입력 안전성](DOCUMENT_REQUEST_ENTRY_SAFETY_2026_09_03.md)                                         | 추천 서류 명시 추가, 실제 저장 계약 정리, 서류명·중복 검증                               |
| [새 서류요청 원자적 저장 안전성](DOCUMENT_REQUEST_COMMIT_SAFETY_2026_09_03.md)                                   | 요청별 고정 UUID, 중복 생성 차단과 자료·업무·타임라인·진행의 일괄 반영                   |
| [새 상담 원자적 저장 안전성](CONSULTATION_COMMIT_SAFETY_2026_09_03.md)                                           | 요청별 고정 UUID, 중복·단계 역행 차단과 타임라인·일정·업무·진행의 일괄 반영              |
| [상담 제목·일정 공개범위 입력 안전성](CONSULTATION_TITLE_SHARING_SAFETY_2026_09_03.md)                           | 빈 상담 제목, 일정 추가 시 공개범위 명시 선택과 내부 전용 정규화                         |
| [상담 등록 입력 안전성](CONSULTATION_ENTRY_SAFETY_2026_09_03.md)                                                 | 상담방식·상태·일정·후속조치 명시 선택과 저장 경계 검증                                   |
| [협업신청 핵심 입력 안전성](APPLICATION_ENTRY_SAFETY_2026_09_03.md)                                              | 요청서비스 명시 선택, 신청 핵심 필드 공통 검증과 동의 재확인                             |
| [협업신청 신청자 유형 안전성](APPLICATION_APPLICANT_TYPE_SAFETY_2026_09_03.md)                                   | 대표 대리접수의 빈 유형 시작, 공유 계정 유형 고정과 제출 전 재검증                       |
| [상담 FLOW 선택 입력 안전성](FLOW_EXPLICIT_ENTRY_SAFETY_2026_09_03.md)                                           | 검토·추가서류·전달·필수 여부의 빈 시작과 사후관리 담당자 직접 입력                       |
| [상담 FLOW 예약 입력 안전성](FLOW_MEETING_ENTRY_SAFETY_2026_09_03.md)                                            | 초회상담 고정 규칙 표시와 추가·계약상담 종류·참석 방식 명시 선택                         |
| [상담 FLOW 진행판 새로고침 안전성](FLOW_PROJECTION_REFRESH_SAFETY_2026_09_03.md)                                 | 비정상 응답 표시와 최신 요청만 적용하는 역순 응답 차단                                   |
| [상담 FLOW 응답 검증 안전성](FLOW_RESPONSE_VALIDATION_SAFETY_2026_09_03.md)                                      | 조회·저장·AI 실행 성공 응답 구조 검증과 안전한 복구 안내                                 |
| [상담 FLOW 상태 새로고침 순서 안전성](FLOW_STATE_REFRESH_ORDERING_SAFETY_2026_09_03.md)                          | 초기·수동·409 재조회 중 최신 검증 응답만 적용                                            |
| [협업신청 첨부 자료종류 확인 안전성](APPLICATION_ATTACHMENT_CATEGORY_CONFIRMATION_2026_09_03.md)                 | 파일명 분류 제안, 첨부별 종류 선택·명시 확인과 제출 차단                                 |
| [기업자료 종류 명시 선택 안전성](PORTAL_DOCUMENT_CATEGORY_SAFETY_2026_09_03.md)                                  | 단일 기업자료 등록의 빈 종류 시작, 파일명 자동확정 제거와 공용 검증                      |
| [기업자료 등록 입력 안전성](PORTAL_DOCUMENT_ENTRY_SAFETY_2026_09_03.md)                                          | 가상·이전 기본값 제거, 메타정보 검증, 변경 후 동의 재확인과 폼 초기화                    |
| [새 업무 분류 명시 선택 안전성](PORTAL_TASK_CLASSIFICATION_SAFETY_2026_09_03.md)                                 | 빈 업무유형·지원분류, 공용 허용 목록 검증과 검증 결과 저장                               |
| [새 업무 입력 안전성](PORTAL_TASK_ENTRY_SAFETY_2026_09_03.md)                                                    | 가상 기본값 제거, 필수 입력·길이 검증과 성공 후 초기화                                   |
| [직접 업무 원자적 등록 안전성](PORTAL_TASK_COMMIT_SAFETY_2026_09_03.md)                                          | 폼별 고정 UUID, 중복 차단과 현재 담당 계정 재검증                                        |
| [운영 업무 사이트 알림](PORTAL_TASK_NOTIFICATIONS_2026_09_03.md)                                                 | 운영 업무만 세는 알림 숫자와 데스크톱·모바일 메뉴 표시                                   |
| [연속 사이트 알림 표시 순서 안전성](TRANSIENT_NOTIFICATION_ORDERING_SAFETY_2026_09_03.md)                        | 이전 숨김 타이머가 최신 알림을 조기 삭제하지 않도록 차단                                 |
| [포털 최초 상태 응답 검증 안전성](PORTAL_STATE_RESPONSE_VALIDATION_SAFETY_2026_09_03.md)                         | 핵심 상태·사용자·저장 버전 검증과 손상된 부가 지표 격리                                  |
| [포털 자동저장 응답 검증 안전성](PORTAL_SAVE_RESPONSE_VALIDATION_SAFETY_2026_09_03.md)                           | 저장 확인·revision·저장용량 구조와 충돌 복구 영수증 검증                                 |
| [협업신청 임시저장 응답 검증 안전성](APPLICATION_DRAFT_RESPONSE_VALIDATION_SAFETY_2026_09_03.md)                 | 조회·저장·비우기 응답 구조와 초안·접수 식별 관계 검증                                    |
| [모바일 기업·신청번호 검색](MOBILE_CASE_SEARCH_2026_09_03.md)                                                    | 공용 검색 폼, 모바일 메뉴 검색과 고유 입력·자동완성 ID                                   |
| [진행현황 CSV 내보내기](PIPELINE_CSV_EXPORT_2026_09_03.md)                                                       | 대표용 필터 결과 CSV, 가상 예시·민감 필드 제외와 수식 주입 차단                          |
| [권한 내 기업·신청번호 검색](GLOBAL_CASE_SEARCH_2026_09_03.md)                                                   | 현재 계정 진행만 대상으로 하는 검색, 반복 신청 모호성 처리와 검증 경계                   |
| [모바일 메뉴 접근성 보완](MOBILE_NAVIGATION_ACCESSIBILITY_2026_09_03.md)                                         | 공통 Sheet 기반 모바일 메뉴, 초점·Escape·현재 화면 전달 경계                             |
| [진행 단계별 명시적 중단 지표](PIPELINE_DROPOFF_METRICS_2026_09_01.md)                                           | 신규 추적 신청의 명시적 중단·재개, FLOW/수동 단계 분리 집계와 보존 경계                  |
| [회수 확인 기록 보호](RECOVERY_PROOF_2026_08_31.md)                                                              | 일반 저장에서 증빙 위조·누락·중복 차단, 정상 검토 상태 변경 유지                         |
| [기존 신청으로 원본 회수](FILE_RECOVERY_2026_08_31.md)                                                           | 대표 확인, 동일 계정·기업·진행 대조, 원본 보존과 중복·충돌 차단                          |
| [대표 전용 원본 보관 현황](FILE_INVENTORY_2026_08_31.md)                                                         | 미연결·업로드 대기·삭제 기록과 원본 존재의 읽기 전용 확인                                |
| [첨부 업로드 재시도·원본 보존](UPLOAD_RETRY_2026_08_31.md)                                                       | 응답 유실 복구, 부분 실패 보존, 제외한 첨부의 검토 차단                                  |
| [신청서 임시저장·복구와 저장 충돌](DRAFT_RECOVERY_2026_08_31.md)                                                 | 계정별 텍스트 복구, 동시 저장 보호, 첨부·자동 병합 제한                                  |
| [초기 개발 현황 기록](DEVELOPMENT_STATUS_2026_08_31.md)                                                          | 인증·권한 정비 당시 기능과 운영 경계                                                     |
| [초기 검증 기록](VALIDATION_2026_08_31.md)                                                                       | 선행 테스트, 서버 검증과 미확인 사항                                                     |
| [운영 반영 준비](../RELEASE_READINESS.md)                                                                        | 권한 보완, 공개 사이트 반영 전 확인사항과 실사용 제한                                    |
| [현재 상담 FLOW](../CONSULTING_WORKFLOW.md)                                                                      | 실제 업무 순서, 자료 등록, 생성 전 확인, 진행 단계                                       |
| [화면별 초기 기획서](planning/MVP_SCREEN_SPEC_2026_08_29.md)                                                     | 관리자·파트너 화면과 MVP 구조                                                            |
| [Claude 프로젝트 지침 확인본](planning/CLAUDE_FLOW_INSTRUCTIONS_2026_08_30.md)                                   | 읽기 전용으로 확인했던 지침. 개인 프로젝트 URL은 공개본에서 제외                         |
| [Step 0–6 통합기준서](planning/CONSULTING_FLOW_STANDARD_2026_08_30.md)                                           | 산출물 흐름과 승인·수동 처리 기준                                                        |
| [AI 자동진단 입출력 명세](specs/AI_DIAGNOSIS_IO_SPEC_2026_08_30.md)                                              | 초기 요청·결과·자료 연결 설계                                                            |
| [1차 요청 JSON Schema](specs/partner-hub-step1-request.schema.v1.json)                                           | 설계 단계의 입력 데이터 계약                                                             |
| [1차 결과 JSON Schema](specs/partner-hub-step1-response.schema.v1.json)                                          | 설계 단계의 출력 데이터 계약                                                             |

개인 Claude 프로젝트 원본 주소를 제외한 기획 문서 사본이며, 로컬 원본 파일은 변경하지 않았습니다. 실제 고객 전사문·진단보고서·사업자등록증·크레탑·원음·회원 명단은 포함하지 않았습니다. 공개 저장소의 기능 코드와 운영 시스템의 개인정보는 별개입니다.
