# 개발 문서 목록

고객별 자료를 제외하고 이번 프로젝트의 기획과 구현 기준을 모았습니다. 날짜가 붙은 기획서는 당시의 설계 기록으로, 모든 항목이 구현 완료되었다는 뜻은 아닙니다.

| 문서 | 내용 |
|---|---|
| [신청서 임시저장·복구와 저장 충돌](DRAFT_RECOVERY_2026_08_31.md) | 계정별 텍스트 복구, 동시 저장 보호, 첨부·자동 병합 제한 |
| [최신 개발 현황](DEVELOPMENT_STATUS_2026_08_31.md) | 완료 기능, 수동 처리, 운영 반영 범위 |
| [최신 검증](VALIDATION_2026_08_31.md) | 테스트, 서버 검증, 확인 범위와 미확인 사항 |
| [운영 반영 준비](../RELEASE_READINESS.md) | 권한 보완, 공개 사이트 반영 전 확인사항과 실사용 제한 |
| [현재 상담 FLOW](../CONSULTING_WORKFLOW.md) | 실제 업무 순서, 자료 등록, 생성 전 확인, 진행 단계 |
| [화면별 초기 기획서](planning/MVP_SCREEN_SPEC_2026_08_29.md) | 관리자·파트너 화면과 MVP 구조 |
| [Claude 프로젝트 지침 확인본](planning/CLAUDE_FLOW_INSTRUCTIONS_2026_08_30.md) | 읽기 전용으로 확인했던 지침. 개인 프로젝트 URL은 공개본에서 제외 |
| [Step 0–6 통합기준서](planning/CONSULTING_FLOW_STANDARD_2026_08_30.md) | 산출물 흐름과 승인·수동 처리 기준 |
| [AI 자동진단 입출력 명세](specs/AI_DIAGNOSIS_IO_SPEC_2026_08_30.md) | 초기 요청·결과·자료 연결 설계 |
| [1차 요청 JSON Schema](specs/partner-hub-step1-request.schema.v1.json) | 설계 단계의 입력 데이터 계약 |
| [1차 결과 JSON Schema](specs/partner-hub-step1-response.schema.v1.json) | 설계 단계의 출력 데이터 계약 |

개인 Claude 프로젝트 원본 주소를 제외한 기획 문서 사본이며, 로컬 원본 파일은 변경하지 않았습니다. 실제 고객 전사문·진단보고서·사업자등록증·크레탑·원음·회원 명단은 포함하지 않았습니다. 공개 저장소의 기능 코드와 운영 시스템의 개인정보는 별개입니다.
