# AI 공급자 Message 신원 무결성 경계

기준일: 2026-09-06

## 문제·적용

Anthropic 성공 응답의 `type`, `role`, `id`를 검증하지 않아 Message가 아닌 envelope나 식별 증거가 없는 본문도 정상 결과로 저장될 수 있었다. 이제 성공 응답은 `type: "message"`, `role: "assistant"`, 512자 이하의 안전한 메시지 `id`를 모두 갖춰야 한다. Step 0는 이 ID를 `_providerMessageId`로 완료 원장에 보존한다.

`0042` 추가형 마이그레이션은 새 완료 결과를 정확한 12개 루트 키와 메시지 ID 경계에 결속한다. 기존 완료 행은 `providerMessageId: null`로 읽고 추정 증거를 추가하지 않는다. Anthropic 공식 Messages API는 성공 Message의 고유 `id`, `type`, `role`을 명시한다: https://platform.claude.com/docs/en/api/messages/create.

## 검증·저장

- Node 643/643, 격리 workerd/D1/R2 451/451, 타입, lint, 포맷, 프로덕션 빌드 통과
- 로컬 Worker 3개 화면 HTTP 200과 CSP·`DENY`·`nosniff`·`no-referrer` 통과
- 실제 운영 쓰기·이메일·유료 AI·외부 요청 0건
- 기능 커밋: `ab7a71ea7d969b5b45bc5f615fb6bec08a35a76b`
- 릴리스: `outputs/release/partner-hub-v193.tar.gz`
- SHA-256: `3e9f9484baec8d076cb739ba26adeeb0d48260ae335831a6c4232441fa3083fd`
- 크기·구성: 1,640,950바이트, 216개 항목, 43개 마이그레이션
- Sites 저장 버전: 193 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_de3ace62450881919d0503c58243264b`)
- 공개 운영본: 버전 107

버전 108–192는 버전 193으로 대체해 공개하지 않는다. 버전 193 공개 배포에는 정확히 `버전 193 운영 배포 승인`이 필요하다. 다음 감사는 성공 응답의 예상하지 않은 비텍스트 content block 처리를 확인한다.
