# 다른 컴퓨터에서 이어서 개발하기

기준일: 2026-09-01

이 저장소의 `main` 브랜치가 개발 코드, 테스트, 마이그레이션, 기획·검증 문서의 기준본이다. 실제 회원·기업·원본 파일과 운영 D1/R2 데이터는 GitHub에 포함하지 않는다.

## 현재 인수인계 지점

- 최신 기능 커밋: `d964bb3` (`Add explicit pipeline dropoff metrics`)
- 최신 기능: 신규 협업신청의 서버 소유 생명주기, 대표 전용 명시적 진행 중단·재개, FLOW 확인/수동 보고 단계별 분리 집계, 중단된 FLOW 쓰기 차단
- 검증: Node 회귀 검사 240개, 격리 workerd/D1/R2 검사 129개, 타입검사, lint, 프로덕션 빌드 통과
- GitHub: `https://github.com/smkim3733-gstar/Partner-hub`, `main`에 최신 기능 반영
- 기존 Sites 프로젝트: `appgprj_6a92514801988191b79eb9bd314e3fcd`
- 기존 공개 URL: `https://keve-partner-hub.smkim3733.chatgpt.site`
- Sites 저장 버전: 71 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_e8e58fe88ff08191ad03917fee7176a3`), 소스 `d964bb39844ab1e6a295a6d2f87e76f2bfda3652`
- 운영 상태: 공개 사이트는 아직 버전 70이다. 버전 71의 공개 배포는 사용자의 구체적 승인 뒤 실행한다.
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
3. [진행 단계별 명시적 중단 지표](PIPELINE_DROPOFF_METRICS_2026_09_01.md)
4. [문서 전체 목록](README.md)

## Git에 넣지 않는 것

- `.dev.vars`, `.env*`, API 키, 짧은 수명의 Sites 소스 인증정보
- 실제 회원·기업·계약·녹취·원본 파일, 운영 D1/R2 내용
- `node_modules`, `dist`, `.wrangler`, `.vinext`, 빌드 압축파일
- `work`와 `outputs`의 임시 Duet 실행물·검사 로그·배포 패키지

Duet의 실제 결정과 적용 경계는 정식 `docs` 문서에 옮겼다. 로컬 실행 디렉터리나 임시 로그가 없어도 구현과 검증을 이어갈 수 있다.

## 다음 작업 경계

현재 남은 구체적 작업은 Sites 버전 71의 공개 배포 여부 결정이다. 배포 승인을 받으면 기존 프로젝트와 공개 범위, D1/R2 연결을 그대로 사용해 버전 71만 배포하고 상태를 확인한다. 새 사이트를 만들거나 실제 고객 데이터를 읽고·이관하고·삭제하지 않는다.
