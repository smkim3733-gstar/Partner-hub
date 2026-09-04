# 다른 컴퓨터에서 이어서 개발하기

기준일: 2026-09-04

이 저장소의 `main` 브랜치가 개발 코드, 테스트, 마이그레이션, 기획·검증 문서의 기준본이다. 실제 회원·기업·원본 파일과 운영 D1/R2 데이터는 GitHub에 포함하지 않는다.

## 현재 인수인계 지점

- 최신 기능 커밋: `8dfe838` (`fix: keep build tooling out of runtime deps`)
- 최신 기능: `shadcn` CLI를 빌드 전용 의존성으로 분류해 운영 감사의 `qs` 보통 위험 2건을 제거하고, Windows CRLF 체크아웃에서도 서버 경로 경계 검사가 동작하도록 보완
- 검증: Node 회귀 검사 463개, 격리 workerd/D1/R2 검사 135개, 타입검사, 전체 lint, 변경 파일 형식검사, 프로덕션 빌드 통과
- GitHub: `https://github.com/smkim3733-gstar/Partner-hub`, `main`에 최신 기능 반영
- 기존 Sites 프로젝트: `appgprj_6a92514801988191b79eb9bd314e3fcd`
- 기존 공개 URL: `https://keve-partner-hub.smkim3733.chatgpt.site`
- Sites 저장 버전: 103 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_06a652e1fb74819184a0db6151cbf295`), 소스 `8dfe8388dfaee4194d8087a51167ad73746655ab`
- 운영 상태: 버전 103을 기존 공개 사이트에 배포했다. 공개 화면 3곳의 HTTP 200, 보호 API 3곳의 익명 HTTP 401과 비공개 보안 헤더를 확인했으며 공개 범위와 D1/R2 연결은 변경하지 않았다.
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

1. [현재 구현과 다음 확인 순서](CURRENT_STATUS.md)
2. [제품 기획 검수](PRODUCT_PLANNING_REVIEW.md)
3. [빌드 도구와 운영 의존성 경계](BUILD_TOOL_RUNTIME_DEPENDENCY_BOUNDARY_2026_09_04.md)
4. [운영 의존성 보안 패치와 잔여 위험](DEPENDENCY_SECURITY_PATCH_AND_RESIDUAL_RISK_2026_09_04.md)
5. [협업신청 첨부 내용 확인 중 제출 잠금 정책](APPLICATION_ATTACHMENT_HASHING_SUBMISSION_LOCK_POLICY_2026_09_04.md)
6. [협업신청 첨부 실제 내용 중복 판정 정책](APPLICATION_ATTACHMENT_CONTENT_DEDUPLICATION_POLICY_2026_09_04.md)
7. [상담 FLOW 화면 재시도 지문 정책](FLOW_CLIENT_RETRY_FINGERPRINT_POLICY_2026_09_04.md)
8. [업로드 멱등키·영수증 파일명 정규화 정책](UPLOAD_RECEIPT_FILENAME_NORMALIZATION_POLICY_2026_09_04.md)
9. [신청 첨부 업로드 멱등키 Content-Type 정책](APPLICATION_UPLOAD_KEY_CONTENT_TYPE_POLICY_2026_09_04.md)
10. [문서 전체 목록](README.md)

## Git에 넣지 않는 것

- `.dev.vars`, `.env*`, API 키, 짧은 수명의 Sites 소스 인증정보
- 실제 회원·기업·계약·녹취·원본 파일, 운영 D1/R2 내용
- `node_modules`, `dist`, `.wrangler`, `.vinext`, 빌드 압축파일
- `work`와 `outputs`의 임시 Duet 실행물·검사 로그·배포 패키지

Duet의 실제 결정과 적용 경계는 정식 `docs` 문서에 옮겼다. 로컬 실행 디렉터리나 임시 로그가 없어도 구현과 검증을 이어갈 수 있다.

## 다음 작업 경계

Sites 버전 103의 공개 배포와 실서버 화면·보호 API 확인을 완료했다. 다음으로 남은 운영 의존성 위험과 서버·파일·인증 경계를 다시 감사해 실제 도달 가능한 높은 우선순위 문제만 수정한다. 실제 파트너 계정·고객 데이터·외부 발송·유료 AI·보관 및 삭제 정책은 별도 승인 없이 사용하거나 변경하지 않는다.
