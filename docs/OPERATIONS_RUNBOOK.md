# Partner Hub 운영 런북

기준일: 2026-09-08  
운영 주소: <https://keve-partner-hub.smkim3733.chatgpt.site>  
Sites 프로젝트: `appgprj_6a92514801988191b79eb9bd314e3fcd`

## 정상 운영 기준

- GitHub `main`과 Sites 저장 버전의 `commit_sha`가 같다.
- CI의 타입 검사, 린트, 788개 Node 검사, 격리 workerd 검사, 로그인 E2E, 접근성 검사, 빌드, 번들 한도가 모두 통과한다.
- `/`, `/account`, `/account/setup`은 익명 GET 200과 브라우저 보안 헤더를 반환한다.
- 인증 없는 비공개 API는 401과 `private, no-store`를 반환한다.
- 운영 점검은 익명 GET만 사용한다. 운영 로그인, 고객 데이터, 파일 본문, 이메일, 유료 AI 호출은 사용하지 않는다.

매일 06:23 KST에 GitHub Actions `Production health`가 `node scripts/check-production-health.mjs`를 실행한다. 수동 확인은 `pnpm run health:production`을 사용한다.

## 배포 절차

1. 기능 브랜치에서 `pnpm run verify`를 통과한다.
2. Duet 독립 diff-review의 blocking/major 지적을 해결한다.
3. 기능 브랜치를 `main`에 병합하고 GitHub에 푸시한다.
4. 운영 변수 `ANTHROPIC_EXTERNAL_PROCESSING_ENABLED`가 정확히 `true`인지 확인한다. 없거나 다른 값이면 같은 Sites 변수 개정에 `true`를 포함한다.
5. 정확한 `main` 커밋으로 Sites 소스와 배포 아카이브를 만든다.
6. Sites 저장 버전의 `commit_sha`와 아카이브 커밋을 대조한다.
7. 기존 공개 범위는 바꾸지 않고 저장된 버전만 배포한다.
8. 배포 완료 뒤 익명 헬스체크와 읽기 전용 브라우저 점검을 실행한다. 대표 계정의 준비상태 GET에서 `externalProcessingEnabled=true`를 확인하되 실제 생성은 실행하지 않는다.

## 외부 AI 비상 중지

`ANTHROPIC_EXTERNAL_PROCESSING_ENABLED`는 정확히 `true`일 때만 외부 전송을 허용한다. 키와 모델이 있어도 이 값이 없거나 다르면 Step 0과 상담 FLOW의 외부 AI 처리는 실패 폐쇄된다.

상담 FLOW는 정책·키·모델 설정을 작업 점유 전에 확인한다. 정책 중지 중에는 대기 작업을 `queued`로 보존하고 외부 요청과 실패 기록을 만들지 않는다.

장애·개인정보 의심·비용 이상 발생 시:

1. 운영 변수를 `false`로 바꿔 외부 전송을 중지한다.
2. 새 Sites 버전을 저장·배포해 변수 개정을 적용한다.
3. `/api/ai-diagnosis/readiness`와 상담 FLOW 사전점검에서 연결 상태와 외부 처리 정책이 분리 표시되는지 확인한다.
4. 원인 해결 뒤에만 `true`로 되돌린다.

## 소스·배포본 백업과 롤백

- GitHub `main`과 기록 커밋으로 peel되는 주석형 릴리스 태그가 소스 기준본이다.
- 각 Sites 저장 버전의 소스 아카이브와 `commit_sha`가 배포 기준본이다.
- 코드 회귀 시 직전 정상 Sites 저장 버전을 다시 배포한다. 접근 범위와 런타임 변수는 임의로 바꾸지 않는다.
- 코드 롤백은 D1 데이터나 R2 파일을 과거로 돌리지 않는다. 스키마 호환성을 먼저 확인한다.

## D1 데이터 복구

Cloudflare D1 Time Travel은 별도 활성화 없이 동작하며 플랜에 따라 최근 7일 또는 30일 내 시점 복구를 제공한다. 복구는 현재 DB를 덮어쓰고 진행 중 쿼리를 취소하는 파괴적 작업이다. 공식 절차: <https://developers.cloudflare.com/d1/reference/time-travel/>

따라서 실제 운영 복구는 자동 승인 대상이 아니다.

1. 외부 AI 처리를 중지하고 쓰기 영향을 받는 사용자에게 점검 시간을 공지한다.
2. 사고 직전 시각, 현재 bookmark, 복구 대상 bookmark를 기록한다.
3. Sites/Cloudflare 운영 권한자가 현재 bookmark를 별도 기록한다.
4. 책임자 승인 뒤 Time Travel 복구를 실행한다.
5. 반환된 `previous_bookmark`를 보관해 복구 취소 경로를 확보한다.
6. 익명 헬스체크 후 로그인 읽기 확인, 레코드 수·최근 변경·파일 원장 정합성을 순서대로 검사한다.

로컬 복구 훈련은 `pnpm run test:workerd`로 수행한다. 격리 D1/R2에서 전체 스키마·인증·저장·파일 원장·재시도 경계를 재구성하며 운영 데이터와 외부 네트워크를 사용하지 않는다. 이는 운영 Time Travel 실행을 대체하지 않는다.

## R2 원본 보전

R2 내구성은 하드웨어 손실 위험을 줄이지만 의도적·실수 삭제를 복구하지 않는다. 공식 안내: <https://developers.cloudflare.com/r2/reference/durability/>

- 앱은 D1의 크기·MIME·ETag·SHA-256 원장과 R2 메타데이터를 대조한다.
- 매일 헬스체크는 파일 본문을 읽지 않는다.
- 버킷 잠금은 삭제·덮어쓰기를 막는 별도 보존 정책이다: <https://developers.cloudflare.com/r2/buckets/bucket-locks/>
- 현재 Sites 도구에는 버킷 잠금·전체 R2 내보내기 기능이 없다. 잠금은 고객의 정당한 삭제 요청도 막을 수 있으므로 보존기간·법적 요구·삭제 정책을 확정한 뒤 별도 승인으로 설정한다.

## 장애 등급과 자동 처리 범위

- P1: 데이터 손실·권한 노출·비밀 유출·외부 AI 오전송 의심. 외부 AI 중지와 읽기 점검까지 자동, D1 복구·접근범위 변경·대량 삭제는 책임자 승인 필요.
- P2: 로그인·저장·핵심 화면 장애. 직전 정상 코드 버전 재배포와 헬스체크 자동 진행.
- P3: 일부 화면·성능·표시 오류. 기능 브랜치 수정, 전체 검증, Duet 검수, 정상 배포 자동 진행.

## 증거 기록

각 배포에서 다음 값을 남긴다: Git 커밋, CI 실행 URL, Duet run 경로와 판정, Sites 버전 번호, 배포 ID, 배포 완료 시각, 익명 헬스체크 결과. 비밀값·고객 식별정보·파일 본문은 기록하지 않는다.
