# 상담 FLOW 명령 상태 범위 무결성

기준일: 2026-09-06

## 확인한 문제

새 명령의 영수증·감사 action과 실제 핵심 상태 효과는 결속돼 있었지만, 그 정상 효과와 함께 다른 업무 영역을 바꾸는 저장까지 구분하지 못했다. 예를 들어 `set_ai_policy`가 AI 승인 상태를 바꾸면서 담당 표시명이나 사후관리 상태를 함께 변조해도 action 효과 검사만으로는 거절되지 않을 수 있었다.

## 적용한 경계

- 지원하는 21개 action마다 변경 가능한 최상위 상태 경로를 단일 등록표 `FLOW_COMMAND_STATE_SCOPE_PATHS`에 선언했다.
- 애플리케이션 커밋은 revision·수정시각·명령·영수증·감사 같은 저장 메타데이터를 제외한 이전/다음 상태를 비교한다. 새 명령 action들의 허용 경로 합집합을 제거한 뒤 값이 다르면 저장을 거절한다.
- 추가형 D1 트리거는 최초 FLOW 삽입과 후속 갱신에서 같은 범위를 독립적으로 검사한다. 담당 표시명과 회사명, 보고서·파일·분석·상담·녹취·서류요청·결정·계약·입금·수행·사후관리·AI·작업 상태를 추적한다.
- 영수증 누락은 기존 전용 증거 트리거가 판정하도록 범위 검사는 모든 새 명령에 영수증이 있을 때만 실행한다. 오류 책임이 섞이지 않아 기존 회귀 검사의 의미를 유지한다.
- 실제 D1/workerd의 SQLite compound SELECT 제한을 피하도록 변경 경로 집합을 `json_array`와 `json_each`로 계산한다.

## 검증

- 정상 효과가 있는 `set_ai_policy` 명령에 담당 표시명 변경을 섞으면 애플리케이션과 실제 D1 모두 거절한다.
- 최초 명령 삽입에 허용되지 않은 사후관리 상태를 미리 넣으면 애플리케이션과 실제 D1 모두 거절한다.
- 기존 AI 큐 회귀 fixture를 `save_source` → `set_ai_policy` → `queue_report1` 실제 명령 순서로 전환해 범위 검사를 우회하지 않는다.
- Node 회귀 검사 666/666 통과.
- 격리 workerd+D1+R2 검사 484/484 통과. 외부 쓰기·메일·유료 AI·외부 호출 0건.
- 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과.
- 로컬 운영 Worker의 `/`, `/account`, `/account/setup` HTTP 200과 CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `no-referrer` 확인.

## 배포 기록

- 기능 커밋: `eb509f64a7679e093cedfdcd397fea4d43b151e2` (`fix: restrict FLOW command state scope`)
- 추가형 마이그레이션: `drizzle/0059_consulting_flow_command_scope.sql`
- 릴리스 압축본: `partner-hub-v218.tar.gz`, 1,655,980바이트, 233개 항목, SQL 60개
- SHA-256: `846FFCE0E7AF0FA81215216BAEE5E3BC026EECF081BBC5C7073CA625A74B842E`
- Sites 저장 버전: 218 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_7abff33884c481919314ff6101a1b2de`)
- 공개 운영본: 버전 107. 버전 108–217은 버전 218로 대체해 공개하지 않는다.

## 남은 경계

이번 보완은 action별 허용 상태 영역을 제한한다. `requests`, `meetings`, `recordings`, `jobs` 같은 배열 내부에서는 명령 대상이 아닌 다른 항목이나 허용되지 않은 필드를 함께 바꾸는지 추가로 점검해야 한다.
