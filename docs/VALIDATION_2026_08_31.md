# 검증 기록 — 2026-08-31

## 최근 인증 개발 검증

| 항목 | 결과 |
|---|---|
| `pnpm test` | 77개 통과, 실패 0 (기존 업무 회귀 검사 55개 포함) |
| `pnpm typecheck` | 통과 |
| `pnpm build` | 통과 |
| `node tests/password-worker-smoke.mjs` | workerd + 격리 D1에서 15개 검증 통과 |
| 인증 변경 파일 대상 lint | 통과 |
| 전체 `pnpm lint` | 수정하지 않은 기본 UI/hook 파일의 기존 19개 오류로 실패 |
| `git diff --check` | 통과 |
| 계정 화면 HTTP | `/account`, `/account/setup` 200 |
| 운영 데이터 변경/메일 전송/유료 AI | 검증에서 수행하지 않음 |

자동 검증은 가상 이름, 예시 이메일·전화번호, 테스트 전용 비밀번호를 사용한다. 테스트 문자열은 실제 서비스의 기본 비밀번호나 사용자 계정이 아니다.

## 인증 검증 범위

- ChatGPT 헤더 없는 가입과 승인대기 저장, 대표 승인 전 접근 차단
- 승인 후 이메일·비밀번호 및 쿠키만으로 접속, 최소 파트너 권한 유지
- 기존 이메일/정지 계정/대표 이메일 공개 가입 차단, 중복·동시 가입 보호
- 무작위 salt의 scrypt 해시, 세션·설정 토큰 해시 저장, 평문 비밀번호 미저장
- 서버의 현재 승인·이메일·회원 ID·자격정보 버전 확인
- 잘못된/만료 쿠키가 관리자 ChatGPT 헤더로 자동 승격되지 않는지 확인
- 비밀번호 재설정 시 이전 세션·비밀번호 차단, 일회용 토큰 만료/재사용/동시 사용 방지
- Origin/HTTPS/요청 크기/형식 검증과 로그인 시도 제한
- 신규 명단/자격정보의 원자적 D1 저장, 기존 자료와 동시 변경 보존
- 기존 파일·상담 FLOW 접근 및 다수 업무 회귀 시나리오

## 한계

정적 화면 렌더, HTTP 및 API/서버 자동 테스트다. 브라우저 클릭·스크린샷 시각 검증이나 서비스 전체 보안감사를 수행한 것은 아니다. 공개 호스팅 도메인의 실제 쿠키 왕복과 외부 파트너 실로그인은 운영 배포 후 별도 확인해야 한다. 이메일·휴대폰 소유권 자동 검증이 없으므로 대표 승인과 비밀번호 링크 발급 전 본인 확인을 유지해야 한다.

## 기술 근거

- [Cloudflare Node crypto 호환성](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)
- [OWASP 비밀번호 저장](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP 인증 지침](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)

이 자료를 참고해 scrypt의 16 MiB 설정과 긴 비밀번호/붙여넣기 허용, 비밀정보 분리 저장을 적용했다. 이 참고 사실 자체가 운영 보안 완성을 보증하지는 않는다.
