# 운영·시험 도구

앱 코드가 아니라 운영자(대표님)와 개발 PC에서 쓰는 도구다. 비밀값은 모두 실행할 때 입력받아 Git 제외 파일(`.env.local` 등)에만 저장한다.

| 폴더 | 내용 |
| --- | --- |
| [windows/](windows/) | 더블클릭용 Windows 도구: 운영 열쇠 저장(`save-production-keys.cmd`), 관리자 비밀번호 재설정(`reset-admin-password.cmd`), 매일 백업 등록(`register-daily-backup.cmd`)과 백업 본체(`daily-backup.cmd`), 복구 키 USB 복사(`copy-keys-to-usb.cmd`) |
| [test-env/](test-env/) | 운영과 분리된 시험 Supabase 프로젝트 준비(열쇠 저장, 스키마·버킷, 시험 관리자). 운영 프로젝트 ID를 받으면 중단한다 |
| [business-flow/](business-flow/README.md) | 가입→승인→신청→상담 FLOW 15단계→권한 분리 전체 자동 시험 |

새 PC 순서는 [docs/CONTINUE_ON_ANOTHER_COMPUTER.md](../docs/CONTINUE_ON_ANOTHER_COMPUTER.md)를 따른다.

Windows 메모: 한글이 든 `.ps1`은 BOM 포함 UTF-8, `.cmd`는 ASCII로만 저장한다(PowerShell 5.1·cmd가 한글을 깨뜨림). 새 PowerShell 창에는 빈 Enter가 들어올 수 있어 입력 도구는 빈 입력을 다시 묻는다.
