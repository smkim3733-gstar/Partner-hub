'use client';
import { useState } from 'react';
import { readPasswordAuthResponse } from '@/lib/password-auth-response';
export function PartnerSignout({ disabled = false }: { disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function logout() {
    if (busy || disabled) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      await readPasswordAuthResponse(response, 'logout');
      window.location.assign('/account');
    } catch (error) {
      setError(
        error instanceof Error ? error.message : '연결을 확인해 주세요.',
      );
      setBusy(false);
    }
  }
  return (
    <div>
      <button
        type="button"
        disabled={busy || disabled}
        onClick={logout}
        className="mt-2 min-h-11 w-full rounded-lg border border-white/30 px-3 text-xs text-white disabled:opacity-50"
      >
        {busy
          ? '로그아웃 중…'
          : disabled
            ? '저장 완료 후 로그아웃'
            : '로그아웃'}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs leading-5 text-white">
          {error}
        </p>
      )}
    </div>
  );
}
