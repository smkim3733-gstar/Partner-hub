'use client';
/* oxlint-disable next/no-html-link-for-pages -- Full navigation resets private portal state after authentication. */
import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, LockKeyhole, LogIn, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { passwordProblem } from '@/lib/password-policy';
import { isValidLoginEmail } from '@/lib/member-email';

export function PartnerAuthPanel({
  initialMode = 'login',
  message = '',
}: {
  initialMode?: 'login' | 'signup' | 'setup';
  message?: string;
}) {
  const [mode, setMode] = useState(initialMode);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [help, setHelp] = useState(false);
  const tokenRef = useRef('');
  const errorRef = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  useEffect(() => {
    if (initialMode === 'setup') {
      const token = new URLSearchParams(window.location.hash.slice(1)).get(
        'token',
      );
      if (token) tokenRef.current = token;
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [initialMode]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  function changeMode(next: 'login' | 'signup') {
    setMode(next);
    setError('');
    setSuccess('');
  }
  async function legacySignIn() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!response.ok)
        throw new Error(
          '기존 로그인을 정리하지 못했습니다. 다시 시도해 주세요.',
        );
      window.location.assign('/signin-with-chatgpt?return_to=/');
    } catch (error) {
      setError(
        error instanceof Error ? error.message : '연결을 확인해 주세요.',
      );
      lock.current = false;
      setBusy(false);
    }
  }
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    const email =
      typeof fields.email === 'string' ? fields.email.trim().toLowerCase() : '';
    const password = typeof fields.password === 'string' ? fields.password : '';
    setError('');
    setSuccess('');
    if (mode !== 'setup' && !isValidLoginEmail(email)) {
      setError('이메일 주소를 정확히 입력해 주세요.');
      return;
    }
    if (mode !== 'login' && passwordProblem(password)) {
      setError(passwordProblem(password));
      return;
    }
    if (!password) {
      setError('사이트 전용 비밀번호를 입력해 주세요.');
      return;
    }
    if (mode === 'signup' && fields.consent !== 'on') {
      setError('입력정보를 가입·승인·계정 관리에 사용하는 것에 동의해 주세요.');
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/auth/${mode === 'signup' ? 'register' : mode}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...fields,
            email,
            password,
            token: mode === 'setup' ? tokenRef.current : undefined,
            consent: fields.consent === 'on',
          }),
        },
      );
      const result = (await response.json()) as {
        error?: string;
        message?: string;
      };
      if (!response.ok)
        throw new Error(result.error || '요청을 처리하지 못했습니다.');
      form.reset();
      if (mode === 'login') window.location.assign('/');
      else
        setSuccess(
          result.message ||
            (mode === 'signup'
              ? '가입 신청이 접수되었습니다. 대표 승인 후 이메일과 비밀번호로 로그인해 주세요.'
              : '비밀번호가 설정되었습니다. 이메일과 새 비밀번호로 로그인해 주세요.'),
        );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : '연결을 확인한 후 다시 시도해 주세요.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,#edf7fd_0,#f8fafc_55%)] p-4 sm:p-6">
      <Card className="w-full max-w-xl border-0 shadow-xl ring-slate-200">
        <CardContent className="py-7 sm:px-8">
          <div className="mb-6 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-xl bg-sky-50 text-[#0877b8]">
              <LockKeyhole aria-hidden="true" />
            </span>
            <p className="mt-4 text-xs font-bold tracking-[0.15em] text-[#0877b8]">
              KEVE PARTNER HUB
            </p>
            <h1 className="mt-2 text-2xl font-bold text-[#15375b]">
              {mode === 'login'
                ? '파트너 로그인'
                : mode === 'signup'
                  ? '파트너 가입 신청'
                  : '사이트 비밀번호 설정'}
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              ChatGPT 계정 없이 이용할 수 있습니다.
              <br />
              이메일을 아이디로, 이 사이트 전용 비밀번호로 로그인하세요.
            </p>
          </div>
          {message && (
            <p className="mb-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              {message}
            </p>
          )}
          {mode !== 'setup' && (
            <div className="mb-5 grid grid-cols-2 gap-2" aria-label="계정 메뉴">
              <Button
                type="button"
                variant={mode === 'login' ? 'default' : 'outline'}
                aria-pressed={mode === 'login'}
                disabled={busy}
                onClick={() => changeMode('login')}
                className="h-11"
              >
                로그인
              </Button>
              <Button
                type="button"
                variant={mode === 'signup' ? 'default' : 'outline'}
                aria-pressed={mode === 'signup'}
                disabled={busy}
                onClick={() => changeMode('signup')}
                className="h-11"
              >
                가입 신청
              </Button>
            </div>
          )}
          {error && (
            <div
              ref={errorRef}
              role="alert"
              tabIndex={-1}
              className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800 outline-none focus:ring-2 focus:ring-red-400"
            >
              {error}
            </div>
          )}
          {success ? (
            <div>
              <output className="block rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
                {success}
              </output>
              <a
                href="/account"
                className="mt-4 flex min-h-11 items-center justify-center rounded-xl bg-[#0877b8] font-bold text-white"
              >
                로그인 화면으로
              </a>
            </div>
          ) : (
            <form key={mode} onSubmit={submit} aria-busy={busy}>
              <fieldset disabled={busy} className="min-w-0 space-y-4">
                <legend className="sr-only">
                  {mode === 'signup' ? '가입정보' : '로그인 정보'}
                </legend>
                {mode === 'signup' &&
                  [
                    ['name', '이름', 'text', 'name'],
                    ['phone', '핸드폰번호', 'tel', 'tel'],
                    ['affiliation', '소속', 'text', 'organization'],
                  ].map(([name, label, type, autoComplete]) => (
                    <div key={name}>
                      <label
                        htmlFor={`auth-${name}`}
                        className="mb-2 block text-sm font-semibold"
                      >
                        {label}
                      </label>
                      <Input
                        id={`auth-${name}`}
                        name={name}
                        type={type}
                        autoComplete={autoComplete}
                        required
                        maxLength={
                          name === 'affiliation'
                            ? 80
                            : name === 'phone'
                              ? 24
                              : 40
                        }
                        className="h-11 bg-white"
                      />
                    </div>
                  ))}
                {mode !== 'setup' && (
                  <div>
                    <label
                      htmlFor="auth-email"
                      className="mb-2 block text-sm font-semibold"
                    >
                      이메일 아이디
                    </label>
                    <Input
                      id="auth-email"
                      name="email"
                      type="email"
                      autoComplete="username"
                      maxLength={254}
                      required
                      className="h-11 bg-white"
                    />
                  </div>
                )}
                <div>
                  <label
                    htmlFor="auth-password"
                    className="mb-2 block text-sm font-semibold"
                  >
                    사이트 전용 비밀번호
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="auth-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={
                        mode === 'login' ? 'current-password' : 'new-password'
                      }
                      minLength={mode === 'login' ? 1 : 15}
                      maxLength={128}
                      required
                      className="h-11 bg-white"
                      aria-describedby="auth-password-help"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={
                        showPassword ? '비밀번호 숨기기' : '비밀번호 표시'
                      }
                      aria-pressed={showPassword}
                      className="h-11 w-11 shrink-0"
                    >
                      {showPassword ? (
                        <EyeOff aria-hidden="true" />
                      ) : (
                        <Eye aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                  <p
                    id="auth-password-help"
                    className="mt-2 text-xs leading-5 text-slate-600"
                  >
                    네이버·구글 메일 비밀번호가 아닙니다.
                    {mode !== 'login' &&
                      ' 15~128자의 긴 문장을 권장합니다. 붙여넣기와 비밀번호 관리자를 사용할 수 있습니다.'}
                  </p>
                </div>
                {mode === 'signup' && (
                  <label className="flex min-h-11 items-start gap-3 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                    <input
                      type="checkbox"
                      name="consent"
                      required
                      className="mt-1 size-4 shrink-0"
                    />
                    <span>
                      입력한 이름·핸드폰번호·소속·이메일을 파트너 가입, 대표
                      승인, 계정 관리 및 연락을 위해 사용하는 데 동의합니다.
                      승인 전에는 기업자료를 볼 수 없습니다.
                    </span>
                  </label>
                )}
                <Button
                  type="submit"
                  className="h-12 w-full gap-2 rounded-xl bg-[#0877b8] font-bold text-white hover:bg-[#06679f]"
                >
                  {mode === 'signup' ? (
                    <UserPlus aria-hidden="true" />
                  ) : (
                    <LogIn aria-hidden="true" />
                  )}
                  {busy
                    ? '처리 중…'
                    : mode === 'login'
                      ? '이메일로 로그인'
                      : mode === 'signup'
                        ? '가입 신청 · 대표 승인 요청'
                        : '비밀번호 설정'}
                </Button>
              </fieldset>
            </form>
          )}
          <button
            type="button"
            onClick={() => setHelp(!help)}
            className="mt-4 min-h-11 w-full text-sm text-[#0877b8] underline underline-offset-4"
          >
            기존 파트너이거나 비밀번호를 잊으셨나요?
          </button>
          {help && (
            <p className="rounded-xl bg-sky-50 p-4 text-sm leading-6 text-slate-700">
              대표님께 본인 확인을 요청해 주세요. 대표님이 발급한 30분 유효
              일회용 설정 링크로 비밀번호를 설정할 수 있습니다. 이메일만 입력해
              기존 계정의 비밀번호를 바꿀 수는 없습니다.
            </p>
          )}
          <div className="mt-5 border-t pt-4 text-center">
            <button
              type="button"
              disabled={busy}
              onClick={legacySignIn}
              className="inline-flex min-h-11 items-center px-3 text-xs text-slate-500 underline disabled:opacity-50"
            >
              대표 관리자 · 기존 ChatGPT 로그인
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
