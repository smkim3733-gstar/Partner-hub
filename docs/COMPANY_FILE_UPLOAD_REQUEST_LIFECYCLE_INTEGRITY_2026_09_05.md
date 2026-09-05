# 기업자료 업로드 요청 수명주기·tombstone 무결성 경계

기준일: 2026-09-05

## 문제

`company_file_upload_requests`는 같은 요청의 중복 저장을 막고 삭제된 파일을 지연 재시도가 다시 만들지 못하게 하는 내구성 영수증이다. 상태 허용값은 `pending`, `ready`, `deleted`로 제한돼 있었지만 행의 식별값 변경, 상태 역행, 삭제 tombstone 재작성과 직접 행 삭제를 저장소 자체가 막지 않았다. 잘못된 SQL이 삭제 증거를 없애거나 `deleted → ready`로 되돌리면 같은 멱등키의 지연 요청이 원본을 부활시킬 수 있는 계약 공백이었다.

## 적용

- 업로드 요청의 `owner_key`, `file_id`, `created_at`은 생성 뒤 변경할 수 없게 했다.
- 상태 전이는 `pending → ready`, `pending → deleted`, `ready → deleted`만 허용하고 같은 상태의 멱등 갱신 외 모든 역행을 거절한다.
- 요청 키 정규화 호환은 `pending`·`ready`에서 상태를 바꾸지 않을 때만 허용한다. 지문만 단독으로 바꾸거나 정규화와 상태 전이를 한 번에 수행할 수 없다.
- `deleted` tombstone은 요청 키와 지문까지 변경할 수 없으며 모든 업로드 요청 행의 직접 `DELETE`를 거절한다.
- 과거 형식의 삭제된 요청 키를 현재 정규형으로 재시도하면 기존 tombstone을 다시 쓰지 않고 호환 키 조회로 찾아 즉시 거절한다.
- `0023_company_file_upload_request_lifecycle.sql`과 런타임 테이블 준비에 동일한 수명주기·삭제 방지 트리거를 적용했다.
- 정적 회귀검사가 애플리케이션 코드에 업로드 요청 원장 직접 삭제가 들어오면 실패한다.

## 검증

- 담당자·파일 ID·생성시각·단독 지문 변경이 저장소 트리거에서 거절된다.
- 정상 키 정규화, `pending → ready`, `ready → deleted`는 허용되고 `ready → pending`, `deleted → ready`는 거절된다.
- 삭제 tombstone의 키 변경과 직접 삭제가 거절되고 원래 `deleted` 상태가 유지된다.
- 정상 업로드와 명시적 삭제가 실제 라우트에서 통과하며, 과거 키 형식의 삭제 tombstone 재시도도 파일을 만들지 않는다.
- 24개 추가형 마이그레이션을 기존 행이 있는 격리 D1에서 두 번 적용해도 영수증 값을 교체하지 않는다.
- Node 회귀 검사 623/623 통과
- 격리 workerd/D1/R2 검사 435/435 통과
- 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 운영 Worker `/`, `/account`, `/account/setup` HTTP 200과 CSP, `X-Frame-Options: DENY`, `nosniff`, `no-referrer` 확인
- 실제 운영 쓰기, 이메일 발송, 유료 AI 요청, 외부 요청 0건

## 저장·운영 경계

- 기능 커밋: `10c5a546e3d3e5f3c7dc6bf42aeb6163be519639`
- 릴리스 보관본: `outputs/release/partner-hub-v173.tar.gz`
- 로컬 보관본 SHA-256: `11f568dfbf02acea13e0f6aca4d2dcd0e9ca3fdde3ccfac34e19a7b41ef9fe90`
- 로컬 보관본 크기·구성: 1,628,497바이트, 197개 항목, 24개 마이그레이션
- Sites 저장 버전: 173 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_652d424ecab081918283239cd5d433cb`)
- 공개 운영본: 버전 107
- 버전 108~172는 버전 173으로 대체하며 공개 배포하지 않는다.

버전 173 공개 배포에는 정확히 `버전 173 운영 배포 승인`이 필요하다. 다음 감사는 `company_file_objects` 기본행이 운영 코드에서 생성 뒤 변경되는지 전수 확인하고, 정상 부모 삭제를 유지하면서 원본 사실의 직접 `UPDATE`를 저장소에서 차단한다.
