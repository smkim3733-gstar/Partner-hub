# AI 공급자 요청 추적 증거 무결성 경계

기준일: 2026-09-06

## 문제

Anthropic 성공 응답 본문의 `id`ub294 메시지 ID이며 공급자 요청 추적 ID가 아니다. 기존 파서와 완료 원장은 응답 헤더의 `request-id`ub97c 보존하지 않아, 비용 문의·장애 조사에서 실제 공급자 요청과 내부 실행을 안전하게 대조할 수 없었다.

## 적용

- 성공 Anthropic 응답은 `request-id` 헤더가 있고 200자 이하의 안전한 문자열일 때만 받아들인다.
- 오류 응답은 헤더 `request-id`uc640 본문 `request_id`uac00 둘 다 있으면 서로 일치해야 한다.
- 성공 본문의 메시지 `id`ub97c 요청 추적 ID로 대체하지 않는다.
- Step 0 완료 원장의 결과 envelope에 `_providerRequestId`ub97c 저장하고, 새 완료 기록은 이 필드가 없거나 비어 있으면 거절한다.
- `0040` 추가형 마이그레이션은 완료 결과를 정확한 10개 루트 키와 공급자 요청 ID 상한에 결속한다.
- 배포 이전 완료 행은 자료 은폐를 막기 위해 `providerRequestId: null`로 읽기만 허용한다. 기존 행을 추정값으로 수정하지 않는다.

Anthropic 공식 API 문서는 모든 API 응답의 `request-id` 헤더가 공급자 요청을 추적하는 고유값이며, 오류 본문에는 같은 값이 `request_id`로 들어갈 수 있음을 명시한다: https://docs.anthropic.com/en/api/errors

## 검증

- 성공 응답의 메시지 ID와 헤더 요청 ID를 별도 값으로 검증
- 성공 응답의 누락·빈·과대·제어문자 요청 ID 거절
- 오류 헤더와 본문의 요청 ID 불일치 거절
- D1 완료 결과의 누락·빈·과대 `_providerRequestId` 거절
- Node 회귀 검사 643/643 통과
- 격리 workerd/D1/R2 검사 451/451 통과
- 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 운영 Worker `/`, `/account`, `/account/setup` HTTP 200과 CSP, `X-Frame-Options: DENY`, `nosniff`, `no-referrer` 확인
- 실제 운영 쓰기, 이메일 발송, 유료 AI 요청, 외부 요청 0건

## 저장·운영 경계

- 기능 커밋: `9acddb54eb85ef68e26f5085ad3263669ea2b64b`
- 릴리스 보관본: `outputs/release/partner-hub-v191.tar.gz`
- 로컬 보관본 SHA-256: `867627f3138f2dac0fc3aeed6aa95ccf771ea8e8e56d3c98df61c5dac2a5a918`
- 로컬 보관본 크기·구성: 1,639,785바이트, 214개 항목, 41개 마이그레이션
- Sites 저장 버전: 191 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_e505f52387148191b35fd3cd58ab5856`)
- 공개 운영본: 버전 107
- 버전 108–190은 버전 191로 대체하며 공개 배포하지 않는다.

버전 191 공개 배포에는 정확히 `버전 191 운영 배포 승인`이 필요하다. 다음 감사는 성공 응답의 실제 모델 신원이 요청·저장 모델과 일치하는지 확인한다.
