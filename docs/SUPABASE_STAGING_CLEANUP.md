# Supabase 임시 업로드 정리

기준일: **2026-10-24**

[개발 점검](DEVELOPMENT_COMPLETION_AUDIT_2026_09_11.md) 5번 항목의 후속 구현이다. 브라우저 직접 업로드는 파일을 먼저 `partner-hub/staging/v1/<uuid>` 임시 경로에 올리고, 확정 시 서버가 바이트·해시·권한을 검사해 별도의 불변 원본 `partner-hub/objects/v1/`에 저장한다. 확정 뒤나 제출을 포기한 뒤에도 임시 객체가 남는다. 이 명령은 보존 기한이 지난 임시 객체만 정리한다.

`storage:check`·`storage:cleanup`은 이전 Turso/Vercel Blob용이다. Supabase에는 아래 `staging:*` 명령을 사용한다.

## 명령

```powershell
pnpm run staging:check
pnpm run staging:cleanup
```

- `staging:check`는 읽기 전용이다. 삭제하지 않고 분류 건수만 출력한다.
- `staging:cleanup`은 대화형 터미널에서만 실행된다. 대상 서비스 주소를 정확히 다시 입력해야 하며, 1회에 최대 100건을 삭제한다. 남은 건수는 다음 실행에서 정리한다.
- 두 명령 모두 Git 제외 `.env.local`의 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_DATABASE_URL`, `SUPABASE_STORAGE_BUCKET`, `PARTNER_HUB_APP_ORIGIN`을 읽는다. `PARTNER_HUB_BACKEND_ENABLED` 값은 바꾸지 않으며, 서비스가 운영 중이어도 실행할 수 있다.
- 오류는 고정 코드로만 출력한다. 경로·SQL·제공자 응답·비밀값은 출력하지 않는다.

## 삭제 조건

다음 조건을 모두 만족하는 객체만 삭제한다.

1. 버킷이 비공개이고, 객체가 `partner-hub/staging/v1/` 바로 아래의 UUID 이름이다.
2. `partner_hub.supabase_file_transfers`에 그 경로를 `file_path` 또는 `audio_path`로 가진 예약이 있다.
3. 현재 시각이 예약의 `retain_until`보다 15분 이상 지났다. `retain_until`은 이미 2시간 업로드 서명 수명, 서명 요청 제한시간, 시계 오차를 포함한다.
4. 객체의 마지막 기록 시각이 `retain_until` 이전이다.

삭제 직전에 예약과 객체를 다시 읽는다. 삭제 후에는 객체 정보를 다시 조회해 없어졌는지 확인한다. 확인하지 못하면 `staging-delete-unconfirmed`로 즉시 중단하고 자동 재시도하지 않는다.

## 보존하는 항목

| 분류 | 처리 |
| --- | --- |
| `retained` — 보존 기한 또는 유예 15분 이내 | 유지 |
| `unrecorded` — 예약 기록이 없는 임시 객체 | 유지하고 건수만 보고. 원인을 확인한 뒤 수동 판단 |
| `anomalous` — 보존 기한 이후 기록된 객체 | 유지하고 보고. 앱의 서명으로는 생길 수 없다 |
| `unrecognized` — UUID가 아닌 이름 | 유지하고 보고 |
| 하위 폴더 | 다른 용도의 쓰기로 보고 전체 작업을 중단(`staging-inventory-unexpected`) |
| 확정 원본 `partner-hub/objects/v1/` | 목록 조회 대상이 아님 |
| 예약 기록 행 | 변경 불가 원장이므로 삭제하지 않음. 사용자별 20개 한도는 `retain_until` 경과로 자동 해제됨 |

삭제한 임시 객체는 복구할 수 없다. 확정된 업무 파일과 영수증에는 영향이 없다. 일일 암호화 백업은 임시 객체도 포함하므로, 정리 직전 백업에는 정리 전 상태가 남는다.

## 출력 항목

`scanned`, `expired`, `retained`, `unrecorded`, `anomalous`, `unrecognized`, `truncated`, `deleted`, `alreadyAbsent`, `remaining`. 한 번에 최대 10,000건까지 조회하며 초과 시 `truncated: true`다.

## 검증 범위

- `tests/supabase-staging-cleanup.test.ts` 7건: 운영 마이그레이션을 적용한 PGlite와 합성 Storage API로 분류, 1회 삭제, 재실행 시 0건, 배치 한도, 삭제 미확인 시 중단, 조회와 삭제 사이에 사라진 객체, 공개 버킷·하위 폴더 차단, 오류 비노출, 한도 완화 거부를 확인한다.
- 실제 Supabase Storage에 대한 실행은 아직 하지 않았다. 처음 운영에 실행할 때는 `staging:check` 결과를 먼저 검토한다. Storage `DELETE` 응답 형식에 의존하지 않고 삭제 후 정보 조회로 결과를 확인하도록 구현했다.
- 정기 실행 예약은 만들지 않았다. 필요하면 백업 예약과 같은 PC·폴더 기준으로 별도 등록한다.
