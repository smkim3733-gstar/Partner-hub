# 상담 FLOW 근거자료 제외 효과 무결성

기준일: 2026-09-06

`exclude_source` 명령을 선택한 기존 근거파일 한 건의 `source → source_archived` 전이에 정확히 결속했다. 파일 배열 길이·ID·순서와 비대상 파일을 보존하고, 여러 파일 동시 제외와 파일 추가·삭제·재정렬을 애플리케이션 커밋 검사와 추가형 `0078` D1 트리거에서 독립 차단한다.

검증은 정상 단일 제외에 두 번째 파일 제외를 섞은 변조를 앱과 D1이 모두 거절하는지 확인했다. Node 683/683, 격리 workerd+D1+R2 505/505, 타입검사, lint, 포맷, 프로덕션 빌드, 로컬 Worker 홈 200·비로그인 API 401을 통과했다. 외부 쓰기·메일·유료 AI·외부 호출은 0건이다.

- 기능 커밋: `85c454eeda5a0e808a483d8608f8e4c604f3b6cc`
- 마이그레이션: `drizzle/0078_consulting_flow_exclude_source_effect.sql`
- 압축본: `partner-hub-v237.tar.gz`, 1,662,490바이트, 225항목, SQL 79개, SHA-256 `17D81C858557247BBACD2E8A5B7BF5BD06C817646FFD44663C51CC78DD38B09E`
- Sites 저장 버전 237: `appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_c64fda7c17d08191b79bef8fda765a46`
- 공개 운영본: 버전 107. 버전 108–236은 버전 237로 대체해 공개하지 않는다.

다음 감사는 `save_report` 명령의 새 보고서·선택 첨부·1차 분석 포인터 효과를 정확히 결속한다.
