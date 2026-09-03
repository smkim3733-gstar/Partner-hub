# 개발 문서 목록

고객별 자료를 제외하고 이번 프로젝트의 기획과 구현 기준을 모았습니다. 날짜가 붙은 기획서는 당시의 설계 기록으로, 모든 항목이 구현 완료되었다는 뜻은 아닙니다.

| 문서 | 내용 |
|---|---|
| [다른 컴퓨터 개발 인수인계](CONTINUE_ON_ANOTHER_COMPUTER.md) | 현재 커밋·검증·Sites 배포 상태, 새 PC 시작 순서와 Git 제외 항목 |
| [순차 점검 1: 회수 저장 잠금](RECOVERY_LOCK_REVIEW_2026_08_31.md) | 응답 유실 후 편집 잠금 유지, 동일 요청 재시도, 최신 화면 확인 |
| [현재 구현과 다음 확인 순서](CURRENT_STATUS.md) | 현재 기능, 완료 범위, 연속 점검 목록과 사용자 결정 사항 |
| [파트너 유형 명시 선택 안전성](PARTNER_TYPE_SELECTION_SAFETY_2026_09_03.md) | 직접등록·승인대기 유형 자동선택 제거와 허용 유형 검증 |
| [파트너 계정 설정 저장 안전성](PARTNER_ACCOUNT_SETTINGS_DRAFT_SAFETY_2026_09_03.md) | 이메일·유형·상태·권한의 저장 전 초안 격리와 취소 폐기 |
| [진행 담당 계정 변경 확인 안전성](CASE_ASSIGNMENT_CONFIRMATION_SAFETY_2026_09_03.md) | 현재·변경 후 담당 대조, 취소 보존과 저장 직전 재검증 |
| [진행단계·중단 상태 변경 확인 안전성](PIPELINE_CHANGE_CONFIRMATION_SAFETY_2026_09_03.md) | 수동 단계·진행 중단·재개의 영향 확인과 stale 상태 차단 |
| [기업자료 상태 변경 확인 안전성](DOCUMENT_STATUS_CONFIRMATION_SAFETY_2026_09_03.md) | 현재·변경 후 상태 영향 확인, 취소 보존과 저장 직전 원본 연결 재검증 |
| [Step 0 가상시험 입력 안전성](STEP_ZERO_PILOT_INPUT_SAFETY_2026_09_03.md) | 빈 가상 입력, 변경 후 재동의, 초과·식별정보의 외부 호출 전 차단 |
| [서류요청 제출기한 알림 안전성](DOCUMENT_REQUEST_DEADLINE_ALERT_SAFETY_2026_09_03.md) | 한국시간 기준 기한 상태와 후속 업무 알림·우선순위 동기화 |
| [서류요청 등록 입력 안전성](DOCUMENT_REQUEST_ENTRY_SAFETY_2026_09_03.md) | 추천 서류 명시 추가, 실제 저장 계약 정리, 서류명·중복 검증 |
| [상담 제목·일정 공개범위 입력 안전성](CONSULTATION_TITLE_SHARING_SAFETY_2026_09_03.md) | 빈 상담 제목, 일정 추가 시 공개범위 명시 선택과 내부 전용 정규화 |
| [상담 등록 입력 안전성](CONSULTATION_ENTRY_SAFETY_2026_09_03.md) | 상담방식·상태·일정·후속조치 명시 선택과 저장 경계 검증 |
| [협업신청 핵심 입력 안전성](APPLICATION_ENTRY_SAFETY_2026_09_03.md) | 요청서비스 명시 선택, 신청 핵심 필드 공통 검증과 동의 재확인 |
| [협업신청 신청자 유형 안전성](APPLICATION_APPLICANT_TYPE_SAFETY_2026_09_03.md) | 대표 대리접수의 빈 유형 시작, 공유 계정 유형 고정과 제출 전 재검증 |
| [상담 FLOW 선택 입력 안전성](FLOW_EXPLICIT_ENTRY_SAFETY_2026_09_03.md) | 검토·추가서류·전달·필수 여부의 빈 시작과 사후관리 담당자 직접 입력 |
| [상담 FLOW 예약 입력 안전성](FLOW_MEETING_ENTRY_SAFETY_2026_09_03.md) | 초회상담 고정 규칙 표시와 추가·계약상담 종류·참석 방식 명시 선택 |
| [협업신청 첨부 자료종류 확인 안전성](APPLICATION_ATTACHMENT_CATEGORY_CONFIRMATION_2026_09_03.md) | 파일명 분류 제안, 첨부별 종류 선택·명시 확인과 제출 차단 |
| [기업자료 종류 명시 선택 안전성](PORTAL_DOCUMENT_CATEGORY_SAFETY_2026_09_03.md) | 단일 기업자료 등록의 빈 종류 시작, 파일명 자동확정 제거와 공용 검증 |
| [기업자료 등록 입력 안전성](PORTAL_DOCUMENT_ENTRY_SAFETY_2026_09_03.md) | 가상·이전 기본값 제거, 메타정보 검증, 변경 후 동의 재확인과 폼 초기화 |
| [새 업무 분류 명시 선택 안전성](PORTAL_TASK_CLASSIFICATION_SAFETY_2026_09_03.md) | 빈 업무유형·지원분류, 공용 허용 목록 검증과 검증 결과 저장 |
| [새 업무 입력 안전성](PORTAL_TASK_ENTRY_SAFETY_2026_09_03.md) | 가상 기본값 제거, 필수 입력·길이 검증과 성공 후 초기화 |
| [운영 업무 사이트 알림](PORTAL_TASK_NOTIFICATIONS_2026_09_03.md) | 운영 업무만 세는 알림 숫자와 데스크톱·모바일 메뉴 표시 |
| [모바일 기업·신청번호 검색](MOBILE_CASE_SEARCH_2026_09_03.md) | 공용 검색 폼, 모바일 메뉴 검색과 고유 입력·자동완성 ID |
| [진행현황 CSV 내보내기](PIPELINE_CSV_EXPORT_2026_09_03.md) | 대표용 필터 결과 CSV, 가상 예시·민감 필드 제외와 수식 주입 차단 |
| [권한 내 기업·신청번호 검색](GLOBAL_CASE_SEARCH_2026_09_03.md) | 현재 계정 진행만 대상으로 하는 검색, 반복 신청 모호성 처리와 검증 경계 |
| [모바일 메뉴 접근성 보완](MOBILE_NAVIGATION_ACCESSIBILITY_2026_09_03.md) | 공통 Sheet 기반 모바일 메뉴, 초점·Escape·현재 화면 전달 경계 |
| [진행 단계별 명시적 중단 지표](PIPELINE_DROPOFF_METRICS_2026_09_01.md) | 신규 추적 신청의 명시적 중단·재개, FLOW/수동 단계 분리 집계와 보존 경계 |
| [회수 확인 기록 보호](RECOVERY_PROOF_2026_08_31.md) | 일반 저장에서 증빙 위조·누락·중복 차단, 정상 검토 상태 변경 유지 |
| [기존 신청으로 원본 회수](FILE_RECOVERY_2026_08_31.md) | 대표 확인, 동일 계정·기업·진행 대조, 원본 보존과 중복·충돌 차단 |
| [대표 전용 원본 보관 현황](FILE_INVENTORY_2026_08_31.md) | 미연결·업로드 대기·삭제 기록과 원본 존재의 읽기 전용 확인 |
| [첨부 업로드 재시도·원본 보존](UPLOAD_RETRY_2026_08_31.md) | 응답 유실 복구, 부분 실패 보존, 제외한 첨부의 검토 차단 |
| [신청서 임시저장·복구와 저장 충돌](DRAFT_RECOVERY_2026_08_31.md) | 계정별 텍스트 복구, 동시 저장 보호, 첨부·자동 병합 제한 |
| [초기 개발 현황 기록](DEVELOPMENT_STATUS_2026_08_31.md) | 인증·권한 정비 당시 기능과 운영 경계 |
| [초기 검증 기록](VALIDATION_2026_08_31.md) | 선행 테스트, 서버 검증과 미확인 사항 |
| [운영 반영 준비](../RELEASE_READINESS.md) | 권한 보완, 공개 사이트 반영 전 확인사항과 실사용 제한 |
| [현재 상담 FLOW](../CONSULTING_WORKFLOW.md) | 실제 업무 순서, 자료 등록, 생성 전 확인, 진행 단계 |
| [화면별 초기 기획서](planning/MVP_SCREEN_SPEC_2026_08_29.md) | 관리자·파트너 화면과 MVP 구조 |
| [Claude 프로젝트 지침 확인본](planning/CLAUDE_FLOW_INSTRUCTIONS_2026_08_30.md) | 읽기 전용으로 확인했던 지침. 개인 프로젝트 URL은 공개본에서 제외 |
| [Step 0–6 통합기준서](planning/CONSULTING_FLOW_STANDARD_2026_08_30.md) | 산출물 흐름과 승인·수동 처리 기준 |
| [AI 자동진단 입출력 명세](specs/AI_DIAGNOSIS_IO_SPEC_2026_08_30.md) | 초기 요청·결과·자료 연결 설계 |
| [1차 요청 JSON Schema](specs/partner-hub-step1-request.schema.v1.json) | 설계 단계의 입력 데이터 계약 |
| [1차 결과 JSON Schema](specs/partner-hub-step1-response.schema.v1.json) | 설계 단계의 출력 데이터 계약 |

개인 Claude 프로젝트 원본 주소를 제외한 기획 문서 사본이며, 로컬 원본 파일은 변경하지 않았습니다. 실제 고객 전사문·진단보고서·사업자등록증·크레탑·원음·회원 명단은 포함하지 않았습니다. 공개 저장소의 기능 코드와 운영 시스템의 개인정보는 별개입니다.
