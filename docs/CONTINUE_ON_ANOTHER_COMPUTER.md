# 다른 컴퓨터에서 이어서 개발하기

기준일: 2026-09-03

이 저장소의 `main` 브랜치가 개발 코드, 테스트, 마이그레이션, 기획·검증 문서의 기준본이다. 실제 회원·기업·원본 파일과 운영 D1/R2 데이터는 GitHub에 포함하지 않는다.

## 현재 인수인계 지점

- 최신 기능 커밋: `90106e7` (`Improve mobile navigation accessibility`)
- 최신 기능: 공통 Sheet 기반 모바일 메뉴, 초점·Escape·초점 복원 경계, 현재 화면 `aria-current` 전달
- 검증: Node 회귀 검사 241개, 격리 workerd/D1/R2 검사 129개, 타입검사, lint, 프로덕션 빌드 통과
- GitHub: `https://github.com/smkim3733-gstar/Partner-hub`, `main`에 최신 기능 반영
- 기존 Sites 프로젝트: `appgprj_6a92514801988191b79eb9bd314e3fcd`
- 기존 공개 URL: `https://keve-partner-hub.smkim3733.chatgpt.site`
- Sites 저장 버전: 72 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_f8c757743f30819191e85cf1458d1d4f`), 소스 `90106e776191fccb3b8edbd2834850bd66b6940a`
- 운영 상태: 2026-09-03 사용자 승인 후 버전 72를 기존 공개 사이트에 배포했다. 주요 화면 3곳의 HTTP 200 응답을 확인했고 공개 범위와 D1/R2 연결은 변경하지 않았다.
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
3. [모바일 메뉴 접근성 보완](MOBILE_NAVIGATION_ACCESSIBILITY_2026_09_03.md)
4. [진행 단계별 명시적 중단 지표](PIPELINE_DROPOFF_METRICS_2026_09_01.md)
5. [문서 전체 목록](README.md)

## Git에 넣지 않는 것

- `.dev.vars`, `.env*`, API 키, 짧은 수명의 Sites 소스 인증정보
- 실제 회원·기업·계약·녹취·원본 파일, 운영 D1/R2 내용
- `node_modules`, `dist`, `.wrangler`, `.vinext`, 빌드 압축파일
- `work`와 `outputs`의 임시 Duet 실행물·검사 로그·배포 패키지

Duet의 실제 결정과 적용 경계는 정식 `docs` 문서에 옮겼다. 로컬 실행 디렉터리나 임시 로그가 없어도 구현과 검증을 이어갈 수 있다.

## 다음 작업 경계

Sites 버전 72의 공개 배포와 주요 화면 응답 확인을 완료했다. 현재 문서화된 비승인 개발 항목은 남아 있지 않다. 다음 개발은 실제 파일럿에서 확인된 문제나 사용자가 정한 기능 범위를 기준으로 시작한다. 실제 파트너 계정·고객 데이터·외부 발송·유료 AI·보관 및 삭제 정책은 별도 승인 없이 사용하거나 변경하지 않는다.
