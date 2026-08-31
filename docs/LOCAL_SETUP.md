# Windows 로컬 개발 환경

이 폴더는 `https://github.com/smkim3733-gstar/Partner-hub.git`의 `main` 브랜치에서 복제했다. 초기 기준 커밋은 `10996c3`이며, 기존 Sites 식별자와 DB/R2 연결명은 그대로 유지한다. 이 설정은 운영 배포나 운영 데이터 복원이 아니다.

## 실행

프로젝트 폴더의 PowerShell 터미널에서 다음 명령을 실행한다.

```powershell
.\partner-hub.cmd
```

`partner-hub.cmd`는 이 PC에 설치된 Codex 번들 Node.js와 pnpm을 해당 프로세스에서만 PATH에 추가한다. 번들이 없는 PC에서는 PATH에 설치된 Node.js와 pnpm을 사용한다. 시스템 PATH나 PowerShell 실행 정책은 변경하지 않는다. 검증에 사용하는 Node.js는 24 계열이며, 프로젝트의 최소 요구 버전은 22.13이다.

서버가 출력하는 `http://localhost:포트` 주소로 접속하고, 종료하려면 실행한 터미널에서 `Ctrl+C`를 누른다. 기본 실행은 `localhost`에만 바인딩한다. 로컬 대표 테스트 로그인은 호스트 이름 `localhost`를 전제로 하므로, 주소를 `127.0.0.1`로 바꾸지 않는다.

가입·로그인 화면은 `/account`, 비밀번호 설정 화면은 `/account/setup`이다. 로컬 Sites 테스트 로그인은 운영 계정 인증과 별개다. 로컬에서 표시되는 가상 자료는 실제 파트너·고객 데이터가 아니다.

대표 화면을 시험하려면 `http://localhost:3000/signin-with-chatgpt?return_to=/`를 연다. 개발 플러그인이 제공하는 모의 계정 `seedy@sites.test`로 로그인하며 실제 ChatGPT 비밀번호는 필요하지 않다. 서버가 다른 포트를 표시하면 주소의 포트도 변경한다. 로그아웃 경로는 `/signout-with-chatgpt?return_to=/`이다. 이 모의 로그인은 운영 빌드에 포함되지 않는다.

## 개발 명령

실행 파일 뒤에 pnpm 명령을 그대로 전달할 수 있다.

```powershell
.\partner-hub.cmd install --frozen-lockfile
.\partner-hub.cmd test
.\partner-hub.cmd typecheck
.\partner-hub.cmd build
.\partner-hub.cmd exec node tests/password-worker-smoke.mjs
```

`pnpm-lock.yaml`과 `pnpm-workspace.yaml`의 기존 버전·설치 정책을 유지한다. Worker 실행이 Windows 보안 환경에서 차단될 경우 필요한 실행 권한을 확인하고, 보안 정책을 해제하거나 인증 검사를 제거하지 않는다.

## 비밀값과 데이터

- `.dev.vars.example`을 복사한 로컬 `.dev.vars`를 준비했다. API 키는 비어 있으며 외부 AI 연결은 설정하지 않았다. 실제 키는 로컬 비밀값 파일 또는 호스팅 비밀값 관리에만 입력한다.
- `.dev.vars`, `.env*`, `.wrangler/`, `node_modules/`, `dist/`는 Git에서 제외된다. `.wrangler/`에는 로컬 DB/R2 상태가 저장되므로 고객 자료를 넣거나 공유하지 않는다.
- 로컬 DB는 애플리케이션의 기존 초기화 경로에서 필요한 테이블을 만든다. 운영 DB/R2는 다운로드·변경하지 않는다.
- 기존 `.openai/hosting.json`은 보존했다. 운영 배포, 원격 마이그레이션, 실제 파트너 계정 생성·알림 발송은 이 설정 범위에 포함하지 않는다.

## 이어서 개발할 때

현재 작업 상태는 `git status`로 확인한다. 이 로컬 설정 파일은 자동 커밋하거나 GitHub에 푸시하지 않는다. 운영 반영 범위와 남은 작업은 [개발 현황](DEVELOPMENT_STATUS_2026_08_31.md), 이전 검증의 한계는 [검증 기록](VALIDATION_2026_08_31.md)을 먼저 확인한다.

## 초기 설정에서 확인한 결과 — 2026-08-31

아래는 최초 환경 설정 당시 기록이다. 이어서 수행한 공통 UI 정비에서는 전체 lint와 테스트 81개를 포함한 검사가 통과했다. 현재 결과는 [최신 검증 기록](VALIDATION_2026_08_31.md)의 후속 공통 UI 정비 항목을 확인한다.

- Node.js `24.19.0`, pnpm `11.19.0`으로 고정 lockfile 설치 완료. 패키지 버전과 설치 정책은 변경하지 않았다.
- 기존 자동 테스트 77개, 타입 검사, 빌드 통과.
- 별도 workerd + 격리 D1 인증 테스트 15개 통과. 해당 테스트는 Windows 폴더 접근 제한으로 최초 실패한 후 실행 권한을 허용받아 재검증했다.
- `/`, `/account`, `/account/setup` HTTP 200 확인. 로그인 전 `/api/state` HTTP 401, 개발 플러그인의 모의 로그인 후 HTTP 200 및 대표 권한 확인. 초기 로컬 저장 상태는 비어 있다.
- 로컬 D1/R2 상태 디렉터리 생성 확인. 운영 데이터 변경, 메일 전송, 유료 AI 요청은 수행하지 않았다.
- 브라우저 클릭·시각 검증 및 전체 lint 재검사는 수행하지 않았다. 기존 문서의 공통 UI/hook lint 오류 19개는 이번 설정에서 수정하지 않았다.
- 개발 서버의 `Request.cf` 네트워크 조회는 제한된 환경에서 기본 대체값을 사용했다. 화면·타입·테스트·빌드 확인은 통과했지만 운영 Cloudflare 요청 정보 검증은 별개다.
