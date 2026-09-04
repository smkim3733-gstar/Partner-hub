# 다른 컴퓨터에서 이어서 개발하기

기준일: 2026-09-04

이 저장소의 `main` 브랜치가 개발 코드, 테스트, 마이그레이션, 기획·검증 문서의 기준본이다. 실제 회원·기업·원본 파일과 운영 D1/R2 데이터는 GitHub에 포함하지 않는다.

## 현재 인수인계 지점

- 최신 기능 커밋: `49d48ce` (`fix: bind flow retries to file bytes`)
- 최신 기능: 상담 FLOW 화면 재시도를 정규 파일명·고정 MIME·실제 첨부 바이트 지문에 연결하고 파일 수정시각 의존 제거
- 검증: Node 회귀 검사 460개, 격리 workerd/D1/R2 검사 135개, 타입검사, 전체 lint, 변경 파일 형식검사, 프로덕션 빌드 통과
- GitHub: `https://github.com/smkim3733-gstar/Partner-hub`, `main`에 최신 기능 반영
- 기존 Sites 프로젝트: `appgprj_6a92514801988191b79eb9bd314e3fcd`
- 기존 공개 URL: `https://keve-partner-hub.smkim3733.chatgpt.site`
- Sites 저장 버전: 99 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_0ad2f62e1888819184d37d7637f03394`), 소스 `49d48ceb8442dfa04f16bca9907188c8990ec3ea`
- 운영 상태: 2026-09-04 자동 운영 승인 원칙에 따라 버전 99를 기존 공개 사이트에 배포했다. 주요 화면 3곳의 HTTP 200, 보호 API 2곳의 익명 HTTP 401과 비공개 보안 헤더를 확인했고 공개 범위와 D1/R2 연결은 변경하지 않았다.
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
3. [상담 FLOW 화면 재시도 지문 정책](FLOW_CLIENT_RETRY_FINGERPRINT_POLICY_2026_09_04.md)
4. [업로드 멱등키·영수증 파일명 정규화 정책](UPLOAD_RECEIPT_FILENAME_NORMALIZATION_POLICY_2026_09_04.md)
5. [신청 첨부 업로드 멱등키 Content-Type 정책](APPLICATION_UPLOAD_KEY_CONTENT_TYPE_POLICY_2026_09_04.md)
6. [문서 전체 목록](README.md)

## Git에 넣지 않는 것

- `.dev.vars`, `.env*`, API 키, 짧은 수명의 Sites 소스 인증정보
- 실제 회원·기업·계약·녹취·원본 파일, 운영 D1/R2 내용
- `node_modules`, `dist`, `.wrangler`, `.vinext`, 빌드 압축파일
- `work`와 `outputs`의 임시 Duet 실행물·검사 로그·배포 패키지

Duet의 실제 결정과 적용 경계는 정식 `docs` 문서에 옮겼다. 로컬 실행 디렉터리나 임시 로그가 없어도 구현과 검증을 이어갈 수 있다.

## 다음 작업 경계

Sites 버전 99의 공개 배포와 주요 화면·보호 API 응답 확인을 완료했다. 사용자의 연속 개발·자동 운영 반영 요청에 따라 앱 내부의 비파괴적 보안·데이터 무결성 항목을 우선순위대로 이어간다. 실제 파트너 계정·고객 데이터·외부 발송·유료 AI·보관 및 삭제 정책은 별도 승인 없이 사용하거나 변경하지 않는다.
