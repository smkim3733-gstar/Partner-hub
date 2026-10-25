'use client';

import { useEffect, useState } from 'react';
import {
  adminSessionNotice,
  readAdminSessionDeadline,
} from '@/lib/admin-session-notice';

// Warns the administrator before the one-hour login ends, and after it ends
// explains how to keep the work on screen: log in again in a new tab, come
// back, and save. Returning to this tab re-checks the login without reloading.
export function AdminSessionNotice({ deadline }: { deadline: number | null }) {
  const [renewedDeadline, setRenewedDeadline] = useState<number | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const effectiveDeadline =
    deadline === null
      ? renewedDeadline
      : Math.max(deadline, renewedDeadline ?? deadline);

  useEffect(() => {
    if (effectiveDeadline === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [effectiveDeadline]);

  const notice = signedOut
    ? ({ kind: 'expired' } as const)
    : adminSessionNotice(effectiveDeadline, now);

  useEffect(() => {
    if (notice.kind === 'none') return;
    let active = true;
    const recheck = () => {
      if (document.visibilityState !== 'visible') return;
      void readAdminSessionDeadline().then((next) => {
        if (!active || next === null) return;
        setNow(Date.now());
        if (next === 'signed-out') {
          setSignedOut(true);
          return;
        }
        setSignedOut(false);
        setRenewedDeadline(next);
      });
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      active = false;
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [notice.kind]);

  if (notice.kind === 'none') return null;
  const expired = notice.kind === 'expired';
  return (
    <div
      role={expired ? 'alert' : 'status'}
      className={`mb-6 rounded-xl border p-4 text-sm leading-6 ${
        expired
          ? 'border-red-200 bg-red-50 text-red-800'
          : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}
    >
      <p className="font-bold">
        {expired
          ? '관리자 로그인이 만료되었습니다'
          : `관리자 로그인이 약 ${notice.minutesLeft}분 뒤 만료됩니다`}
      </p>
      <p>
        {expired
          ? '이 화면을 새로고침하거나 닫지 마세요. 작성 중인 내용은 화면에 그대로 남아 있습니다. 새 탭에서 다시 로그인한 뒤 이 화면으로 돌아와 저장하면 됩니다.'
          : '보안을 위해 관리자 로그인은 1시간 뒤 자동으로 끝납니다. 작성 중인 내용이 있으면 지금 저장해 주세요. 새 탭에서 다시 로그인하면 1시간이 새로 시작되고, 이 화면의 입력은 그대로 남습니다.'}
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <a
          className="inline-flex min-h-11 items-center font-semibold underline"
          href="/account"
          target="_blank"
          rel="noopener noreferrer"
        >
          새 탭에서 다시 로그인
        </a>
      </div>
    </div>
  );
}
