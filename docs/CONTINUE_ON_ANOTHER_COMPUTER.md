# 다른 컴퓨터에서 이어서 개발하기

기준일: 2026-09-08

이 저장소의 `main` 브랜치가 개발 코드, 테스트, 마이그레이션, 기획·검증 문서의 기준본이다. 실제 회원·기업·원본 파일과 운영 D1/R2 데이터는 GitHub에 포함하지 않는다.

## 현재 인수인계 지점

- 최신 로컬 기능 커밋: `051f681` (`fix: bind flow document receipt target`)
- 최신 확인: `receive_document` 영수증의 대상 요청 ID·목적 `requested_document`·`file` 슬롯이 맞아도 실제 요청의 `fileId`가 완료 예약 파일을 가리키지 않으면 재고 증명이 유지되는 손상 상태
- 연속 확인: 영수증 대상 요청의 `fileId` 누락·변경과 영수증 대상 바꿔치기를 `inconsistent`·`unavailable`로 격리해 R2 `head` 전 503 차단
- 검증: Node 회귀 검사 785개, 파일 재고 집중 회귀 29개, 격리 workerd/D1/R2 검사 627개, 추가형 마이그레이션 99개 2회, 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드와 로컬 Worker 화면·인증 경계 통과
- GitHub: `https://github.com/smkim3733-gstar/Partner-hub`, 원격 `main`은 `ee40a91b5de4ef8fed06245ba2b636e623773b0c`; 로컬 버전 334 푸시는 명시 승인을 기다려 보류
- 기존 Sites 프로젝트: `appgprj_6a92514801988191b79eb9bd314e3fcd`
- 기존 공개 URL: `https://keve-partner-hub.smkim3733.chatgpt.site`
- 현재 공개 운영본: 버전 107
- 최신 Sites 저장 버전: 309, 소스 `66aa95462bf30470f15b8ba138682c6c62fed591`
- 운영 상태: 서버 오류 로그 개인정보 보완본 버전 107이 공개 운영 중이다. 버전 108–333은 더 완전한 로컬 후보인 버전 334로 대체한다.
- 자동 개발: 현재 Codex 작업에 30분 간격 반복 실행이 활성화돼 있다. 이 설정은 저장소가 아니라 현재 앱 작업에 속하므로 다른 컴퓨터나 새 작업에서는 다시 설정해야 한다.
- 연결 유지값: `.openai/hosting.json`의 D1 `DB`, R2 `AI_SOURCE_FILES`, 공개 접근 범위

## 새 컴퓨터 준비

Node.js 22.13 이상과 pnpm을 설치한 뒤 다음 순서로 시작한다.

```sh
git clone https://github.com/smkim3733-gstar/Partner-hub.git
cd Partner-hub
git checkout main
git pull --ff-only origin main
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Windows의 기존 Codex 번들 런타임을 사용하는 경우 저장소의 `partner-hub.cmd`와 [로컬 설정 안내](LOCAL_SETUP.md)를 사용할 수 있다. 다른 환경에서는 위의 일반 pnpm 명령을 사용한다.

격리 Worker/D1/R2 회귀 검증은 다음 명령으로 실행한다. 운영 DB와 실제 고객 자료를 사용하지 않는다.

```sh
node tests/password-worker-smoke.mjs
```

## 이어서 읽을 문서

먼저 [파일 재고 FLOW 요청서류 영수증 대상 결속](FILE_INVENTORY_FLOW_DOCUMENT_RECEIPT_TARGET_BINDING_2026_09_08.md)을 확인한다.

1. [현재 구현과 다음 확인 순서](CURRENT_STATUS.md)
2. [기업자료 연결 원본 삭제 무결성 경계](COMPANY_DOCUMENT_LINKED_ORIGINAL_DELETION_INTEGRITY_2026_09_05.md)
3. [기업자료 원본 보관 원장 무결성 경계](COMPANY_DOCUMENT_FILE_PROVENANCE_INTEGRITY_2026_09_05.md)
4. [기업자료 원본 메타데이터 무결성 경계](COMPANY_DOCUMENT_FILE_METADATA_INTEGRITY_2026_09_05.md)
5. [업무·기업자료·일정 필드 무결성 경계](OPERATIONAL_RECORD_FIELD_INTEGRITY_2026_09_05.md)
6. [진행 타임라인 기록 무결성 경계](TIMELINE_RECORD_INTEGRITY_2026_09_05.md)
7. [업무·기업자료·일정 연결 무결성 경계](RELATED_RECORD_ASSIGNMENT_INTEGRITY_2026_09_05.md)
8. [진행 기록 필드·담당 연결 무결성 경계](CASE_RECORD_INTEGRITY_2026_09_05.md)
9. [진단평가 기록 무결성 경계](DIAGNOSIS_ASSESSMENT_INTEGRITY_2026_09_05.md)
10. [포털 상태 메타데이터 무결성 경계](PORTAL_STATE_METADATA_INTEGRITY_2026_09_05.md)
11. [포털 레코드 ID 무결성 경계](PORTAL_RECORD_ID_INTEGRITY_2026_09_05.md)
12. [사건 ID 무결성 경계](CASE_ID_INTEGRITY_BOUNDARY_2026_09_05.md)
13. [포털 레코드 구조 무결성 경계](PORTAL_RECORD_STRUCTURE_INTEGRITY_2026_09_05.md)
14. [파트너 식별정보 실행 무결성 경계](MEMBER_IDENTITY_RUNTIME_INTEGRITY_2026_09_05.md)
15. [파트너 권한 실행 무결성 경계](PARTNER_PERMISSION_RUNTIME_INTEGRITY_2026_09_05.md)
16. [파트너 계정 편집 무결성 경계](PARTNER_ACCOUNT_EDIT_INTEGRITY_2026_09_05.md)
17. [파트너 계정 삭제 무결성 경계](PARTNER_ACCOUNT_DELETION_INTEGRITY_2026_09_05.md)
18. [파트너 감사 필드 무결성 경계](MEMBER_AUDIT_FIELD_INTEGRITY_2026_09_05.md)
19. [파트너 안정 ID 생성 경계](STABLE_MEMBER_ID_CREATION_BOUNDARY_2026_09_05.md)
20. [파트너 안정 ID 무결성](DUPLICATE_MEMBER_ID_INTEGRITY_2026_09_05.md)
21. [ChatGPT 자가등록 중복 이메일 무결성](CHATGPT_REGISTRATION_AMBIGUOUS_EMAIL_INTEGRITY_2026_09_05.md)
22. [ChatGPT 중복 이메일 결속 무결성](CHATGPT_AMBIGUOUS_EMAIL_BINDING_INTEGRITY_2026_09_05.md)
23. [변경 요청 Origin 필수 보안 경계](MUTATION_ORIGIN_REQUIRED_BOUNDARY_2026_09_05.md)
24. [ChatGPT 관리자 안정 ID 결속 무결성](CHATGPT_OWNER_STABLE_IDENTITY_INTEGRITY_2026_09_05.md)
25. [제품 기획 검수](PRODUCT_PLANNING_REVIEW.md)
26. [브라우저 화면 보안 헤더 경계](BROWSER_PAGE_SECURITY_HEADERS_2026_09_04.md)
27. [빌드 도구와 운영 의존성 경계](BUILD_TOOL_RUNTIME_DEPENDENCY_BOUNDARY_2026_09_04.md)
28. [운영 의존성 보안 패치와 잔여 위험](DEPENDENCY_SECURITY_PATCH_AND_RESIDUAL_RISK_2026_09_04.md)
29. [협업신청 첨부 내용 확인 중 제출 잠금 정책](APPLICATION_ATTACHMENT_HASHING_SUBMISSION_LOCK_POLICY_2026_09_04.md)
30. [협업신청 첨부 실제 내용 중복 판정 정책](APPLICATION_ATTACHMENT_CONTENT_DEDUPLICATION_POLICY_2026_09_04.md)
31. [상담 FLOW 화면 재시도 지문 정책](FLOW_CLIENT_RETRY_FINGERPRINT_POLICY_2026_09_04.md)
32. [업로드 멱등키·영수증 파일명 정규화 정책](UPLOAD_RECEIPT_FILENAME_NORMALIZATION_POLICY_2026_09_04.md)
33. [신청 첨부 업로드 멱등키 Content-Type 정책](APPLICATION_UPLOAD_KEY_CONTENT_TYPE_POLICY_2026_09_04.md)
34. [문서 전체 목록](README.md)

## Git에 넣지 않는 것

- `.dev.vars`, `.env*`, API 키, 짧은 수명의 Sites 소스 인증정보
- 실제 회원·기업·계약·녹취·원본 파일, 운영 D1/R2 내용
- `node_modules`, `dist`, `.wrangler`, `.vinext`, 빌드 압축파일
- `work`와 `outputs`의 임시 Duet 실행물·검사 로그·배포 패키지

Duet의 실제 결정과 적용 경계는 정식 `docs` 문서에 옮겼다. 로컬 실행 디렉터리나 임시 로그가 없어도 구현과 검증을 이어갈 수 있다.

## 다음 작업 경계

Sites 최신 저장 버전은 309이고 공개 운영본은 버전 107이다. 버전 108–333은 버전 334로 대체해 배포하지 않는다. GitHub 반영에는 정확히 `버전 334 GitHub main 푸시 승인`, 버전 334의 Sites 소스 전송·버전 저장·공개 교체에는 정확히 `버전 334 Sites 소스 전송 및 공개 운영 배포 승인`이 필요하다. 30분 간격 자동 개발은 활성 상태로 `record_contract` 영수증의 선택 회의 ID와 실제 계약의 `meetingId`·`signedFileId`가 완료 예약 파일에 정확히 결속되는지 다음 순서로 감사한다. 실제 파트너 계정·고객 데이터·외부 발송·유료 AI는 별도 승인 없이 사용하지 않는다.
