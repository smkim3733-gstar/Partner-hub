# 다른 컴퓨터에서 이어서 개발하기

기준일: 2026-09-06

이 저장소의 `main` 브랜치가 개발 코드, 테스트, 마이그레이션, 기획·검증 문서의 기준본이다. 실제 회원·기업·원본 파일과 운영 D1/R2 데이터는 GitHub에 포함하지 않는다.

## 현재 인수인계 지점

- 최신 기능 커밋: `ea6cece0491bc62b35f37a54ae60449fc9a01357` (`fix: bind FLOW AI job transition audits`)
- 최신 기능: 상담 FLOW AI 작업의 처리 종료·명시적 재시도를 새 감사기록과 앱·D1에서 원자 결속하고 실패 전사문 보완 증거 보존
- 검증: Node 회귀 검사 652개, 격리 workerd/D1/R2 검사 466개, 타입검사, 전체 lint, 변경 파일 포맷 검사, 프로덕션 빌드와 로컬 운영 Worker 화면 3곳 HTTP 200·CSP·`DENY`·`nosniff`·`no-referrer` 통과
- GitHub: `https://github.com/smkim3733-gstar/Partner-hub`, `main`에 최신 기능 반영
- 기존 Sites 프로젝트: `appgprj_6a92514801988191b79eb9bd314e3fcd`
- 기존 공개 URL: `https://keve-partner-hub.smkim3733.chatgpt.site`
- 현재 공개 운영본: 버전 107
- 최신 Sites 저장 버전: 206 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_3aaf5c5f26548191bf2ca5c70fc709f9`), 소스 `ea6cece0491bc62b35f37a54ae60449fc9a01357`
- 운영 상태: 서버 오류 로그 개인정보 보완본 버전 107이 공개 운영 중이다. 버전 108–205는 버전 206으로 대체해 배포하지 않으며, FLOW AI 작업 상태 전이 감사 무결성본 버전 206이 정확한 버전 운영 배포 승인 대기 중이다.
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

먼저 [상담 FLOW AI 작업 상태 전이 감사 무결성](FLOW_AI_JOB_TRANSITION_AUDIT_INTEGRITY_2026_09_06.md)을 확인한다.

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

Sites 버전 206 저장·검증까지 완료했고 공개 운영본은 버전 107이다. 버전 108–205는 버전 206으로 대체해 배포하지 않는다. 버전 206 공개 배포에는 정확히 `버전 206 운영 배포 승인`이라는 사용자 명시 승인이 필요하다. 30분 간격 자동 개발은 활성 상태로 다음 고우선순위 감사를 이어간다. 다음 감사는 새 AI 작업의 생성시각, 단계별 근거 신원과 생성 명령 감사를 해당 FLOW revision에 결속한다. 관리자 안정 ID가 실제로 바뀌는 경우의 결속 초기화는 계정 소유권 확인·운영 D1 백업·감사가 필요한 수동 복구이며 자동화하지 않는다. 실제 파트너 계정·고객 데이터·외부 발송·유료 AI·보관 및 삭제 정책은 별도 승인 없이 사용하거나 변경하지 않는다.
