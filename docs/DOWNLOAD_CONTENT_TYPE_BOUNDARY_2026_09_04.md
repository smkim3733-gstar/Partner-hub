# 다운로드 Content-Type 보안 경계

## 목적

기업 원본과 상담 FLOW 첨부 다운로드가 브라우저가 업로드 때 보낸 MIME 값이나 오래된 저장값을 응답 `Content-Type`으로 그대로 사용하지 않도록 한다.

## 적용 범위

- 다운로드 MIME은 파일명의 허용 확장자에 대응하는 공용 고정 목록에서 결정한다.
- PDF, PNG, JPEG, XLSX, XLS, DOCX, PPTX, TXT, Markdown, MP3, M4A, WAV를 고정 MIME으로 변환한다.
- 알 수 없거나 확장자가 없는 레거시 파일은 `application/octet-stream`으로 안전하게 내려보낸다.
- 기업 원본과 상담 FLOW 첨부 라우트가 같은 `downloadContentType` 경계를 사용한다.

## 유지한 경계

파일 내용·이름·확장자·R2 키, 저장된 과거 MIME 값, 인증·담당 계정·권한 재확인, 첨부 허용 형식과 D1 스키마는 변경하지 않았다. 다운로드 응답 MIME만 서버 허용 목록에서 다시 결정한다.

## 재발 방지

허용 확장자별 MIME과 알 수 없는 확장자의 안전한 기본값을 단위검사로 고정했다. 정적 회귀검사는 기업 원본·상담 첨부 라우트가 저장된 `content_type` 또는 FLOW의 `contentType`을 응답 헤더에 직접 사용하지 못하게 한다.

## 검증 결과

- 관련 다운로드 회귀검사 8개 통과
- 전체 자동 테스트 439개 통과
- 격리 workerd/D1/R2 검사 129개 통과
- TypeScript 타입검사, 전체 lint, 프로덕션 빌드 통과
- 격리검사 중 운영 쓰기, 메일, 유료 AI, 외부 요청 0건

2026-09-04 자동 운영 승인 원칙에 따라 커밋 `4a4e7aa`를 GitHub `main`과 공개 Sites 버전 86에 반영했다. 공개 범위와 D1 `DB`, R2 `AI_SOURCE_FILES` 연결을 유지했으며 운영 화면 3곳의 HTTP 200, 파일 다운로드 API 2곳의 익명 HTTP 401·비공개 보안 헤더를 확인했다. 성공 다운로드의 고정 MIME은 운영 고객자료 대신 격리 workerd/R2에서 확인했다. 배포 결과는 `outputs/release/download-content-type-boundary-deployment.json`을 기준으로 삼는다.
