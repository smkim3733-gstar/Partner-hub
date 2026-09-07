# 파일 재고 FLOW 영수증 행위자·지문 결속

기준일: 2026-09-08

## 확인한 상태

완료 FLOW 첨부의 파일·명령 ID, 예약 상태와 전체 파일 메타데이터가 맞더라도 FLOW payload 명령 영수증의 안정 행위자 키 또는 요청 지문이 업로드 예약과 어긋날 수 있다.

- payload 영수증 `actorKey`만 예약 `actor_key`와 다른 상태
- payload 영수증 `fingerprint`만 예약 `fingerprint`와 다른 상태

버전 324에서 추가한 영수증 결속 쿼리가 두 손상도 목록·적용 현황·개별 확인에서 일관되게 닫는지 단위 회귀와 실제 workerd+D1/R2로 감사했다. 기존 구현이 이미 두 값을 정확히 비교하므로 운영 코드와 스키마는 바꾸지 않았다.

## 확인한 경계

- 두 파일은 손상 전 각각 `linked`와 SHA-256 저장 증명으로 표시된다.
- `actorKey` 또는 `fingerprint`가 어긋나면 각각 한 `inconsistent` 항목으로 유지한다.
- FLOW 연결 사실은 표시하되 저장 증명은 제거하고 전체 적용 현황의 `unavailable`에 포함한다.
- 개별 현재 R2 확인은 객체 `head` 호출 전에 503으로 닫는다.
- 명령 ID·행위자 키·지문·저장 키는 응답에 노출하지 않는다.
- 실제 격리 D1의 payload 영수증을 한 필드씩 변조한 뒤 같은 결과를 확인했다. 원래 값을 복구하면 SHA-256 증명이 다시 표시된다.
- 격리 시험은 기존 D1 트리거 오류 우선순위 검사를 끝낸 뒤 수행해 전체 트리거 재생성이 선행 검사의 오류문 판정을 바꾸지 않게 했다.
- 앞선 교차 출처 ID 충돌 fixture는 해당 검사를 마친 뒤 제거해 정상 결속 기준을 명시적으로 복구했다.
- 자동 복구·운영 데이터 접근·새 마이그레이션·외부 요청은 추가하지 않았다.

## 검증 결과

- 파일 재고 단위 회귀: 24/24
- 재고·응답·복구 관련 회귀: 53/53
- 전체 Node 회귀: 779/779
- 격리 workerd + 실제 D1/R2: 583개 검사
- 추가형 마이그레이션 98개를 빈 D1에 두 번 적용
- 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 Worker 공개 화면 `/`, `/account`, `/account/setup`: 200 및 `frame-ancestors 'none'`, `DENY`, `nosniff`, `no-referrer`
- 비인증 `/api/state`, `/api/admin/file-inventory`, `/api/consulting-flow/test-case`: 401 및 private/no-store 경계
- 실제 운영 쓰기, 메일 발송, 유료 AI 요청, 외부 네트워크 요청: 0건

로컬 감사 커밋은 `7eb0142` (`test: cover flow receipt identity drift`)이다. GitHub `main` 직접 푸시는 앱 자동 보안 검토가 이번 커밋의 명시 승인을 요구해 보류했다. 원격 기준 커밋은 `ee40a91b5de4ef8fed06245ba2b636e623773b0c`이다.

## 배포 후보

- 아카이브: `outputs/release/partner-hub-v327.tar.gz`
- 크기: 1,695,414바이트
- 항목: 243개
- 마이그레이션: 98개, 마지막 `0097_r2_sha256_integrity.sql`
- 금지 항목: `.git`, `node_modules`, `.wrangler`, `.env*` 0개
- SHA-256: `3A2F47E63B38711664D80885F61FB122C9FE289085C18DF76B1C512D5F3D06FB`

Sites 최신 저장 버전은 309이며 공개 운영본은 버전 107이다. 버전 327의 Sites 소스 전송·버전 저장·공개 배포에는 정확히 `버전 327 Sites 소스 전송 및 공개 운영 배포 승인`이 필요하다.

## 다음 감사

FLOW payload 명령 영수증의 `action` 또는 표시 행위자 `actor`가 실제 완료 명령 의미와 어긋난 손상 상태를 파일 재고가 정상 증명으로 오인하지 않는지 점검한다.
