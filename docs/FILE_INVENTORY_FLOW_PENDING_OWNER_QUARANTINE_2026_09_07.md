# 파일 재고 FLOW 부분 완료 pending 격리

기준일: 2026-09-07

## 확인한 문제

정상 FLOW 업로드에서 `pending` 예약은 R2 및 D1 커밋 전 상태이고, 소유·payload·메타데이터·객체 무결성 원장이 함께 저장되면 같은 트랜잭션에서 완료 영수증과 `ready` 전이가 끝나야 한다. 하지만 손상이나 과거 부분 커밋으로 완료 원장들이 존재하면서 예약만 `pending`인 불가능 상태가 남을 수 있다.

버전 324는 이 상태의 증명을 무효화하고 개별 R2 확인을 차단했지만, 목록 상태 분류는 무결성 검사보다 `pending`을 먼저 적용했다. 그 결과 이미 FLOW에 연결된 손상 파일이 정상적인 업로드 대기처럼 표시됐다.

새 단위 회귀는 수정 전 22개 중 21개 통과·1개 실패했고, 손상 파일이 `pending` 목록에 없다는 기대와 달리 남은 `true !== false`를 기록했다.

## 적용한 경계

- FLOW 소유 원장이 존재하면서 같은 파일 ID의 예약 상태가 `pending`이면 `inconsistent`로 분류한다.
- 소유 원장과 payload가 아직 없는 정상 pending-only 예약은 기존 `pending` 표시와 안전한 크기 기반 R2 확인을 유지한다.
- 부분 완료 파일은 `flowLinked: true`, 증명 없음으로 표시하고 전체 적용 현황의 `unavailable`에 포함한다.
- 개별 현재 R2 확인은 `head` 호출 전에 503으로 닫는다.
- 명령 ID·행위자 키·지문·저장 키는 응답에 노출하지 않는다.
- 자동 복구·삭제·운영 D1/R2 읽기나 쓰기와 새 마이그레이션은 추가하지 않는다.

실제 D1의 compound SELECT 항 수와 후보 분기 수는 바꾸지 않고 기존 분류 순서에 소유 원장 존재 조건만 추가했다.

## 검증 결과

- 파일 재고 단위 회귀: 22/22
- 재고·응답·복구 관련 회귀: 51/51
- 전체 Node 회귀: 777/777
- 격리 workerd + 실제 D1/R2: 567개 검사
- 추가형 마이그레이션 98개를 빈 D1에 두 번 적용
- 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 Worker 공개 화면 `/`, `/account`, `/account/setup`: 200 및 `frame-ancestors 'none'`, `DENY`, `nosniff`, `no-referrer`
- 비인증 `/api/state`, `/api/admin/file-inventory`, `/api/consulting-flow/test-case`: 401 및 private/no-store 경계
- 실제 운영 쓰기, 메일 발송, 유료 AI 요청, 외부 네트워크 요청: 0건

기능 커밋은 `c91ee730da11d97e60e495f5103a03c484c63018`이다.

## 배포 후보

- 아카이브: `outputs/release/partner-hub-v325.tar.gz`
- 크기: 1,695,437바이트
- 항목: 243개
- 마이그레이션: 98개, 마지막 `0097_r2_sha256_integrity.sql`
- 금지 항목: `.git`, `node_modules`, `.wrangler`, `.env*` 0개
- SHA-256: `4695B4D18FFAB8C2A52CFBD6B7D877F86F1FDE2FB8483E8FCCD9C9638551BAEA`

Sites 최신 저장 버전은 309이며 공개 운영본은 버전 107이다. 버전 325의 Sites 소스 전송·버전 저장·공개 배포에는 정확히 `버전 325 Sites 소스 전송 및 공개 운영 배포 승인`이 필요하다.

## 다음 감사

소유·payload·증명 원장이 정상인 상태에서 `ready` 예약만 남거나 완료 영수증만 남은 한쪽 영수증 손상도 목록·적용 현황·개별 확인에서 일관되게 격리하는지 점검한다.
