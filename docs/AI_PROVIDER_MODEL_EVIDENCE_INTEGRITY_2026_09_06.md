# AI 공급자 응답 모델 증거 무결성 경계

기준일: 2026-09-06

## 문제

Step 0는 `ANTHROPIC_MODEL`을 요청과 실행 원장에 기록했지만 Anthropic 성공 응답의 `model` 필드는 읽지 않았다. 요청 모델 별칭이 고정 모델 ID로 해석되거나 응답 라우팅을 조사해야 할 때, 실제 응답 모델 증거가 사라졌다.

## 적용

- 성공 Anthropic Messages 응답은 200자 이하의 안전한 `model` 문자열을 필수로 제공해야 한다.
- 요청 모델은 기존 `ai_diagnosis_runs.model` 불변 열에, 실제 응답 모델은 결과 envelope의 `_providerModel`에 별도 보존한다.
- 모델 별칭은 고정 모델 ID로 해석될 수 있으므로 요청값과 응답값의 단순 문자열 불일치를 실패로 오탐하지 않는다. 두 증거를 함께 남겨 차이를 은폐하지 않는다.
- `0041` 추가형 마이그레이션은 새 완료 결과를 정확한 11개 루트 키와 `_providerModel` 문자열 경계에 결속한다.
- 기존 완료 행은 `providerModel: null`로 읽어 자료 은폐를 막고, 추정값으로 수정하지 않는다.

Anthropic 공식 Messages API 예시는 요청과 성공 Message 응답 모두에 `model` 필드를 명시한다: https://platform.claude.com/docs/en/api/messages/create. 공식 Models API는 모델 별칭을 고유 모델 ID로 해석할 수 있음을 안내한다: https://platform.claude.com/docs/en/api/models/retrieve.

## 검증

- 성공 응답의 누락·빈·공백·과대·제어문자 모델 거절
- 요청 모델과 응답 모델을 서로 다른 증거로 보존
- D1 완료 envelope의 누락·빈·과대 `_providerModel` 거절
- Node 회귀 검사 643/643, 격리 workerd/D1/R2 451/451 통과
- 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 Worker 주요 화면 3곳 HTTP 200과 CSP·`DENY`·`nosniff`·`no-referrer` 확인
- 실제 운영 쓰기·이메일·유료 AI·외부 요청 0건

## 저장·운영 경계

- 기능 커밋: `234cc6e470b9c825deff95c70dd02667e37286ad`
- 릴리스: `outputs/release/partner-hub-v192.tar.gz`
- SHA-256: `3b585985cd4c78adc1ea35e5e99e457ba8d60d4c5be1aea981e09d7656ee80f0`
- 크기·구성: 1,639,652바이트, 215개 항목, 42개 마이그레이션
- Sites 저장 버전: 192 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_766a0a3782908191beab2783a1b50986`)
- 공개 운영본: 버전 107

버전 108–191은 버전 192로 대체해 공개하지 않는다. 버전 192 공개 배포에는 정확히 `버전 192 운영 배포 승인`이 필요하다. 다음 감사는 Anthropic 성공 Message의 `type`, `role`, 메시지 ID envelope 신원을 확인한다.
