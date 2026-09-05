# 상담 FLOW AI 실패 증거 무결성 경계

기준일: 2026-09-06

## 문제·적용

상담 FLOW의 Anthropic 요청이 4xx·5xx로 실패하면 사용자용 안내와 실패 상태만 남고 공급자 요청 ID와 HTTP 상태가 사라졌다. 이제 공급자 오류 응답은 지침 버전, 요청 모델, HTTP 상태와 검증된 `request-id`를 실패 작업과 같은 FLOW revision에 원자 저장한다. 오류 본문이나 공급자 내부 내용은 저장·응답하지 않으며, 네트워크 중단처럼 실제 HTTP 응답이 없는 실패에는 공급자 증거를 만들지 않는다.

## 저장·검증 경계

- 실패 증거는 정확한 키, 안전한 Unicode, 제한 길이 문자열, HTTP 400–599 정수만 허용한다.
- 오류 헤더·본문 요청 ID가 함께 있으면 기존 공용 Anthropic 파서가 일치 여부를 먼저 검사한다. 형식이 손상되면 검증되지 않은 ID는 버리고 관측한 HTTP 상태만 보존한다.
- 성공 증거와 실패 증거를 같은 완료 결과로 주입할 수 없고 중첩 예상 밖 키는 상세·대시보드 응답 전에 차단한다.
- 파트너 응답도 각 중첩 객체의 허용 키만 다시 선택해 미래 내부 필드가 추가돼도 자동 노출되지 않는다.
- Anthropic 공식 오류 문서의 HTTP 상태와 `request-id` 추적 지침을 기준으로 했다: [API 오류](https://docs.anthropic.com/en/api/errors), [Messages API](https://platform.claude.com/docs/en/api/messages/create).

## 검증·저장

- Node 644/644, 격리 workerd/D1/R2 451/451, 타입, lint, 포맷, 프로덕션 빌드 통과
- 로컬 Worker 3개 화면 HTTP 200과 보안 헤더 통과
- 실제 운영 쓰기·이메일·유료 AI·외부 요청 0건
- 기능 커밋: `963ae8a8cb0116d0ded5ea84ffbc7b8b210bf9f5`
- 릴리스: `outputs/release/partner-hub-v196.tar.gz`
- SHA-256: `beec6d93db9251ef5ef7c514df9d4961afcc914ee8628fd27efbdb1c5d53c9cd`
- 크기·구성: 1,642,723바이트, 216개 항목, 43개 마이그레이션
- Sites 저장 버전: 196 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_5e508f4084148191a91e08eaf9342d4c`)
- 공개 운영본: 버전 107

버전 108–195는 버전 196으로 대체해 공개하지 않는다. 버전 196 공개 배포에는 정확히 `버전 196 운영 배포 승인`이 필요하다. 다음 감사는 수동 재시도 뒤에도 과거 공급자 실패 증거가 사라지지 않는지 확인한다.
