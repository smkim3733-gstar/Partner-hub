# 상담 FLOW AI 공급자 증거 무결성 경계

기준일: 2026-09-06

## 문제·적용

상담 FLOW의 1차·4차 AI 초안은 Anthropic 성공 응답에서 요청 ID, 실제 응답 모델, Message ID와 토큰 사용량을 검증하면서도 보고서 본문만 저장해 비용·장애·모델 추적 증거가 사라졌다. 이제 새 완료 작업은 지침 버전, 요청 모델, 공급자 `request-id`, 응답 모델, Message ID, 입력·출력 토큰을 보고서·작업 상태와 같은 FLOW revision에 원자 저장한다. 기존 완료 작업의 증거 부재는 호환하되 새 완료는 증거 없이는 거절한다.

## 저장·검증 경계

- 공급자 증거는 정확한 7개 키, 안전한 Unicode, 앞뒤 공백 없는 제한 길이 문자열과 양의 안전 정수만 허용한다.
- 완료 작업 외 상태에는 증거를 둘 수 없고, 예상 밖 중첩 키와 손상 값은 상세 조회와 대시보드 투영 전에 실패 폐쇄한다.
- 요청 모델 환경값은 외부 호출 전에 정규화·길이 검증하고 요청값과 실제 응답 모델을 별도로 보존한다.
- D1 대시보드 검증은 독립 쿼리로 분리해 SQLite 표현식 깊이 제한을 넘지 않으면서 전체 저장 payload를 검사한다.
- Anthropic 공식 Messages 응답의 `id`, `model`, `role`, `type`, `usage` 계약과 오류 응답의 `request-id` 추적 지침을 기준으로 했다: [Messages API](https://platform.claude.com/docs/en/api/messages/create), [API 오류](https://docs.anthropic.com/en/api/errors).

## 검증·저장

- Node 644/644, 격리 workerd/D1/R2 451/451, 타입, lint, 포맷, 프로덕션 빌드 통과
- 로컬 Worker 3개 화면 HTTP 200과 보안 헤더 통과
- 실제 운영 쓰기·이메일·유료 AI·외부 요청 0건
- 기능 커밋: `4dfbae0698400226afbfd9d3b44b1af90e7a50df`
- 릴리스: `outputs/release/partner-hub-v195.tar.gz`
- SHA-256: `18eac0a6d0430a478eab6b1bcae960846d7e21a6995ccaa1cba54f94b4cf777`
- 크기·구성: 1,641,736바이트, 216개 항목, 43개 마이그레이션
- Sites 저장 버전: 195 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_79c6bace16248191a33d6a2d94205377`)
- 공개 운영본: 버전 107

버전 108–194는 버전 195로 대체해 공개하지 않는다. 버전 195 공개 배포에는 정확히 `버전 195 운영 배포 승인`이 필요하다. 다음 감사는 상담 FLOW AI 실패 결과의 공급자 오류 요청 ID와 HTTP 상태 증거 보존을 확인한다.
