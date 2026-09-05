# 상담 FLOW 명령 배열 대상 무결성

기준일: 2026-09-06

## 확인한 문제

명령 action이 변경 가능한 상태 영역은 제한됐지만, `requests`, `meetings`, `recordings`, `reports`, `payments` 같은 허용 배열 안에서는 선택하지 않은 다른 항목이나 불변 필드를 함께 바꿀 수 있었다. 추가 명령도 정상 항목과 숨긴 추가 항목을 한 번에 넣을 수 있었다.

## 적용한 경계

- 배열 변경 규칙을 `FLOW_COMMAND_TARGET_RULES` 한 곳에 선언하고 애플리케이션 커밋과 D1 트리거가 같은 규칙을 사용한다.
- `save_report`, `book_meeting`, `save_recording`, `request_document`, `confirm_payment`는 기존 배열의 순서와 모든 항목을 그대로 보존한 뒤 `${commandId}-report`, `${commandId}-meeting`, `${commandId}-recording`, `${commandId}-request`, `${commandId}-payment` 한 건만 끝에 추가한다.
- `complete_meeting`, `cancel_meeting`, `save_transcript`, `mark_request_sent`, `receive_document`, `review_document`는 정확히 한 항목만 바꾸며, action별 허용 필드 외 값은 보존한다.
- `record_contract`는 계약 객체가 가리키는 상담 한 건만 완료 상태로 바꿀 수 있고 이미 완료된 상담이면 배열을 그대로 보존한다.
- 완료·취소·전사 검토·발송·수령·서류 검토의 필수 상태와 서버 수정시각 결속도 함께 검사한다.
- 배열 대상을 변경하는 명령 여러 건을 한 revision에 합치는 저장은 거절한다. 기존 AI 작업 무결성 검사용처럼 대상 배열을 바꾸지 않는 복수 명령 fixture는 허용한다.
- 파일과 AI 작업 배열은 기존 불변 원장·작업 생성 ID·수명주기·감사 결속 검사가 계속 담당한다.

## 검증

- 한 `request_document` 명령에 두 요청을 추가하면 애플리케이션과 D1 모두 거절한다.
- 한 요청의 발송시각을 기록하면서 다른 요청 제목을 바꾸면 애플리케이션과 D1 모두 거절한다.
- 최초 `save_report` 명령에 숨긴 두 번째 보고서를 미리 넣으면 애플리케이션과 D1 모두 거절한다.
- 실제 workerd D1에서 `save_report` action·영수증·감사·정상 보고서를 갖춘 채 숨긴 추가 보고서를 넣는 변조를 거절한다.
- Node 회귀 검사 669/669 통과.
- 격리 workerd+D1+R2 검사 485/485 통과. 외부 쓰기·메일·유료 AI·외부 호출 0건.
- 타입검사, 전체 lint, 변경 파일 포맷과 프로덕션 빌드 통과.
- 프로덕션 Worker가 로컬 8817 포트에서 정상 기동했다. 별도 화면 HTTP 조회는 Codex 실행 크레딧 제한으로 완료하지 못했다.

## 배포 기록

- 기능 커밋: `ee5399eabf2a9e0f68d83fab229a38a9a4c724ac` (`fix: bind FLOW commands to array targets`)
- 추가형 마이그레이션: `drizzle/0060_consulting_flow_command_target.sql`
- 릴리스 압축본: `partner-hub-v219.tar.gz`, 1,655,079바이트, 232개 항목, SQL 61개
- SHA-256: `9E00A13FAFAE53C80F1F097E548D722539AFAEB00949E093D269B3BCE737043A`
- Sites 저장 버전: 219 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_9958cd6bb57881919d192384ed8f0728`)
- 공개 운영본: 버전 107. 버전 108–218은 버전 219로 대체해 공개하지 않는다.

## 남은 경계

이번 보완은 새 명령이 있는 저장의 업무 배열 대상과 필드를 제한한다. 새 명령이 없는 AI 작업 처리 전이도 작업·보고서·감사 외 상담·서류요청·입금 같은 업무 상태를 함께 바꾸지 못하도록 별도 범위 결속이 필요하다.
