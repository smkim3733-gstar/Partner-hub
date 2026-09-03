'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KeyRound } from 'lucide-react';
import { readPasswordLinkResponse } from '@/lib/password-link-response';

export function PartnerPasswordLink({
  memberId,
  email,
  disabled,
}: {
  memberId: string;
  email: string;
  disabled: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const [expiresAt, setExpiresAt] = useState(0);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  async function issue() {
    if (disabled || !confirmed || lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    setLink('');
    try {
      const response = await fetch('/api/admin/partners/password-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memberId, confirmed }),
      });
      const result = await readPasswordLinkResponse(response);
      setLink(`${window.location.origin}${result.path}`);
      setExpiresAt(result.expiresAt);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '연결 상태를 확인해 주세요.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setMessage('복사했습니다. 본인 확인된 파트너에게만 직접 전달해 주세요.');
    } catch {
      setMessage('아래 링크를 직접 선택해 복사해 주세요.');
    }
  }
  return (
    <section
      className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4"
      aria-label="파트너 비밀번호 설정"
    >
      <h3 className="flex items-center gap-2 text-sm font-bold text-[#15375b]">
        <KeyRound className="size-4" aria-hidden="true" /> 사이트 비밀번호
        설정·재설정
      </h3>
      <p className="mt-2 break-all text-xs leading-5 text-slate-600">
        {email} 아이디로 ChatGPT 없이 로그인합니다. 비밀번호를 받거나 대신
        입력하지 말고, 본인이 직접 설정하도록 링크를 전달하세요.
      </p>
      <label className="mt-3 flex min-h-11 items-start gap-2 text-xs leading-5 text-slate-700">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          disabled={busy || disabled}
          className="mt-1 size-4 shrink-0"
        />{' '}
        기존에 알고 있는 연락처로 본인임을 확인했습니다. 새 링크 발급 시 이전
        미사용 링크는 만료되고, 비밀번호를 설정하면 기존 사이트 로그인이
        해제됩니다.
      </label>
      <Button
        type="button"
        variant="outline"
        className="mt-2 min-h-11 whitespace-normal"
        onClick={issue}
        disabled={busy || disabled || !confirmed}
      >
        {busy ? '발급 중…' : '30분 유효 일회용 링크 발급'}
      </Button>
      {disabled && (
        <p className="mt-2 text-xs text-amber-800">
          이메일·계정 정보를 먼저 저장하고, 정지 상태라면 본인 확인 후 활성화해
          주세요.
        </p>
      )}
      {link && (
        <div className="mt-3 space-y-2">
          <label
            htmlFor={`password-link-${memberId}`}
            className="block text-xs font-semibold"
          >
            비밀번호 설정 링크 ·{' '}
            {new Date(expiresAt).toLocaleTimeString('ko-KR', {
              hour: '2-digit',
              minute: '2-digit',
            })}
            까지
          </label>
          <Input
            id={`password-link-${memberId}`}
            value={link}
            readOnly
            className="h-11 bg-white"
            onFocus={(event) => event.target.select()}
          />
          <Button
            type="button"
            onClick={copy}
            variant="outline"
            className="min-h-11"
          >
            링크 복사
          </Button>
          <p className="text-xs leading-5 text-slate-600">
            자동 이메일은 발송되지 않습니다. 확인된 개인 연락처로만 보내세요.
            링크는 이 창에서만 표시됩니다.
          </p>
        </div>
      )}
      {message && (
        <output className="mt-3 block text-sm leading-5 text-slate-700">
          {message}
        </output>
      )}
    </section>
  );
}
