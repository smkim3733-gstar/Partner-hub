# 운영 의존성 보안 패치와 잔여 위험 기록

기준일: 2026-09-04

## 반영한 변경

- `react`, `react-dom`, `react-server-dom-webpack`을 `19.2.6`에서 `19.2.8`로 맞췄다.
- `vite`를 `8.0.13`에서 `8.0.16`으로 올렸다.
- lockfile을 새 해석 결과로 갱신했다. Vite가 사용하는 Rolldown도 `1.0.3`으로 갱신됐다.
- ICNS·JXL·HEIF·HEIC 파일이 향후 사용자 업로드 허용 목록에 실수로 들어가더라도 실제 내용 검사 경계에서 거절되는 회귀 사례를 추가했다.

이 변경으로 감사 당시 확인된 React Server Components 서비스 거부 취약점과 Windows Vite 개발 서버 파일 접근 취약점은 패치 버전으로 이동했다. 애플리케이션 기능, D1/R2 스키마, 인증·권한, 파일 보관·삭제 정책은 변경하지 않았다.

## 검증 결과

- `pnpm install --frozen-lockfile --offline`: 통과
- Node 자동 검사: 462개 통과
- 격리 `workerd`/D1/R2 검사: 135개 통과
- 타입검사, 전체 lint, 변경 파일 형식검사, 프로덕션 빌드: 통과
- 격리 검사 중 운영 쓰기·메일·유료 AI·외부 요청: 0건
- 패치 후 `pnpm audit --prod`: 중요도 높은 항목이 4건에서 2건으로 감소. 전체 잔여는 높음 2건, 보통 2건, 낮음 1건이다.

## 잔여 항목과 실제 노출 경계

### `image-size@2.0.2`

[`GHSA-w3rx-r6r6-pgpr`](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr)와 [`GHSA-5p2g-fcmc-qvqq`](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)가 ICNS·JXL·HEIF 파서의 무한 반복을 보고한다. 감사 도구는 `2.0.3` 이상을 수정본으로 표시하지만 2026-09-04 현재 npm에 `2.0.3`이 배포되지 않아 존재하지 않는 버전을 강제하지 않았다.

이 패키지는 `vinext`의 정적 메타데이터 이미지 빌드 경로에서만 불린다. 현재 `app` 아래에는 해당 정적 메타데이터 이미지 파일이 없고, 사용자 업로드는 ICNS·JXL·HEIF·HEIC를 등록하거나 처리하지 않는다. 서버의 공용 실제 내용 검사도 이 확장자를 저장 전에 거절한다. 따라서 현재 운영 입력에서 취약 파서로 연결되는 경로는 확인되지 않았다. `vinext` 또는 `image-size`의 공식 수정 배포를 계속 추적한다.

### `qs@6.15.3`

보통 위험 2건은 `shadcn` CLI가 포함한 MCP/Express 경로에서 나온다. 애플리케이션 런타임 소스는 이 CLI·MCP 경로를 import하지 않으며 Sites 배포 아카이브에도 `node_modules`, `shadcn`, MCP SDK, `qs`가 들어가지 않는다. 다만 `app/globals.css`의 `shadcn/tailwind.css`를 빌드할 때 `shadcn` 패키지가 필요하므로, 다음 개발에서는 런타임 의존성이 아닌 빌드 의존성으로 분류한 뒤 전체 빌드를 재검증한다.

### `esbuild@0.27.3`

낮은 위험 1건은 Windows 개발 서버 실행 중 임의 파일 접근에 관한 항목이다. 공개 Sites에는 개발 서버를 노출하지 않는다. 상위 패키지가 호환되는 패치 버전을 채택할 때 갱신하되, 검증되지 않은 강제 override는 사용하지 않는다.

## 저장소와 Sites 상태

- 기능 커밋: `6dccafa584394873592e92981b4aa9d7afc141bd` (`fix: patch React and Vite advisories`)
- GitHub `main`: 기능 커밋 반영 완료
- Sites 저장 버전: 102 (`appgprj_6a92514801988191b79eb9bd314e3fcd~appgver_2bf9f54343488191b8890117033162ac`)
- Sites 소스: 기능 커밋과 동일한 SHA
- 배포 상태: 사용자의 명시적 승인 후 2026-09-04 공개 운영 배포 완료
- 운영 배포 ID: `appgdep_6a9ac77c42288191b96c2264f7c29e04`
- 현재 공개 운영본: 버전 102

운영 `/`, `/account`, `/account/setup`은 HTTP 200을 반환했다. `/api/state`, `/api/admin/file-inventory`, `/api/consulting-flow/test-case`는 익명 요청에 HTTP 401을 반환하고 `Cache-Control: no-store, max-age=0, private`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`를 유지했다. 공개 범위와 D1 `DB`, R2 `AI_SOURCE_FILES` 연결은 변경하지 않았다. 다음 개발은 `shadcn` 의존성 분류 정비부터 이어간다.
