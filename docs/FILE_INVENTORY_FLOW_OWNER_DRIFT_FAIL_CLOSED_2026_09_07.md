# 완료 FLOW 소유 원장 키 손상 시 닫힌 실패

## 결과

완료 FLOW 첨부의 D1 소유 원장 저장 키가 실제 FLOW payload의 정규 키와 어긋나면 파일 재고는 해당 항목을 `inconsistent`·증명 없음으로 격리한다. 개별 현재 R2 확인은 객체 조회 전에 503으로 실패한다. 손상된 저장 키와 내부 원장 값은 API 응답에 노출하지 않는다.

감사 커밋은 `d63aa4abf8cfae1a08ffc1f80f3f8abb1078d7d4`이다. 기존 런타임 방어가 요구사항을 충족해 제품 코드 변경은 없다.

## 감사 시나리오

- 유효한 사건과 FLOW payload에 `consulting-flow/{fileId}` 정규 키의 완료 첨부를 만든다.
- 같은 파일 ID의 D1 소유 원장만 `consulting-flow/wrong-owner-key`를 가리키도록 합성 손상 상태를 만든다.
- `status=inconsistent` 목록에서 출처는 FLOW, 상태는 `inconsistent`, 증명은 없음으로 반환되는지 확인한다.
- 목록 응답에 `storage_key` 또는 손상된 내부 키 문자열이 포함되지 않는지 확인한다.
- R2 `head` 호출을 계수한 뒤 개별 존재 확인이 503으로 끝나고 호출 수가 0인지 확인한다.
- 실제 격리 workerd·D1·R2에서도 같은 목록 격리와 503 차단을 확인한다.

## 검증

- 집중 파일 재고 회귀 14/14
- 전체 Node 회귀 769/769
- 격리 workerd·D1·R2 533개 검사와 98개 추가형 마이그레이션 2회 적용 통과
- 타입검사, 전체 lint, 변경 파일 포맷, 프로덕션 빌드 통과
- 로컬 Worker 공개 화면 3곳 200, 비인증 보호 API 3곳 401, CSP·프레임 차단·`nosniff`·`no-referrer`·API `private, no-store` 확인
- 운영 데이터 쓰기, 메일 발송, 유료 AI 요청, 외부 업무 요청 0건

## 배포 후보와 운영 경계

배포 후보 `outputs/release/partner-hub-v318.tar.gz`는 1,692,123바이트, 243개 항목과 98개 마이그레이션을 포함한다. `.git`·`node_modules`·`.wrangler` 항목은 없다. SHA-256은 `E20C2C282B5678EFD70A5D09FB381CAFD3377B1135188D3027E32B92EBE46836`이다.

GitHub `main`에는 반영했다. Sites 최신 저장 버전은 309, 공개 운영본은 버전 107이다. Sites 소스 전송·버전 저장·공개 운영 배포에는 정확한 `버전 318 Sites 소스 전송 및 공개 운영 배포 승인`이 필요하다.

## 다음 감사

완료 FLOW 소유 원장의 사건 귀속 또는 payload 파일 항목이 누락·불일치할 때 같은 격리와 R2 접근 전 차단이 유지되는지 보강한다. 기업자료와 FLOW의 합성 ID가 충돌할 때 전체 재고 응답이 안전하게 유지되는지도 점검한다.
