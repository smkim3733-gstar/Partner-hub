'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  LoaderCircle,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  partnerTypes,
  registrationFieldUpdate,
  validatePartnerRegistration,
  type PartnerRegistration,
  type PartnerRegistrationResult,
  type RegistrationErrors,
} from '@/lib/partner-registration';
import {
  PartnerRegistrationResponseError,
  readPartnerRegistrationResponse,
} from '@/lib/partner-registration-response';
import { portalConflictReceiptHeaders } from '@/lib/portal-conflict-receipt';

const emptyForm: PartnerRegistration = {
  name: '',
  phone: '',
  affiliation: '',
  email: '',
  memberType: '',
};
const fields = [
  {
    key: 'name',
    label: '이름',
    type: 'text',
    autoComplete: 'off',
    maxLength: 40,
  },
  {
    key: 'phone',
    label: '연락처',
    type: 'tel',
    autoComplete: 'off',
    maxLength: 24,
  },
  {
    key: 'affiliation',
    label: '소속',
    type: 'text',
    autoComplete: 'off',
    maxLength: 80,
  },
  {
    key: 'email',
    label: '이메일',
    type: 'email',
    autoComplete: 'off',
    maxLength: 254,
  },
] as const;

export function AdminPartnerRegistration({
  disabled,
  onRegistered,
  onBusyChange,
}: {
  disabled: boolean;
  onRegistered: (result: PartnerRegistrationResult) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [form, setForm] = useState<PartnerRegistration>(emptyForm);
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const requestRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const recoveryReceiptRef = useRef('');

  useEffect(() => {
    if (error || Object.keys(errors).length) errorRef.current?.focus();
  }, [error, errors]);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || sendingRef.current) return;
    setSuccess('');
    setError('');
    const checked = validatePartnerRegistration({ ...form, confirmed });
    setErrors(checked.errors);
    if (Object.keys(checked.errors).length) return;
    const fingerprint = JSON.stringify(checked.value);
    if (requestRef.current?.fingerprint !== fingerprint)
      requestRef.current = { fingerprint, id: crypto.randomUUID() };
    sendingRef.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      const response = await fetch('/api/admin/partners', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...portalConflictReceiptHeaders(
            recoveryReceiptRef.current || undefined,
          ),
        },
        body: JSON.stringify({
          ...checked.value,
          confirmed: true,
          requestId: requestRef.current.id,
        }),
        signal: AbortSignal.timeout(25_000),
      });
      const result = await readPartnerRegistrationResponse(response, {
        registration: checked.value,
        requestId: requestRef.current.id,
      });
      onRegistered(result);
      recoveryReceiptRef.current = '';
      setSuccess(
        `${result.member.name}님 · ${result.member.memberType} · ${result.member.status}${result.replayed ? ' (기존 등록 확인)' : ' 등록 완료'}`,
      );
      setForm(emptyForm);
      setConfirmed(false);
      requestRef.current = null;
    } catch (cause) {
      if (cause instanceof PartnerRegistrationResponseError) {
        setErrors(cause.errors);
        if (cause.recoveryReceipt)
          recoveryReceiptRef.current = cause.recoveryReceipt;
      }
      setError(
        cause instanceof Error &&
          !['TimeoutError', 'AbortError', 'TypeError'].includes(cause.name)
          ? cause.message
          : '연결이 끊겨 등록 여부를 확인하지 못했습니다. 명단을 먼저 확인하거나 같은 내용으로 다시 시도해 주세요. 중복 등록은 차단됩니다.',
      );
    } finally {
      sendingRef.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <Card className="mb-6 border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-sky-200">
      <CardHeader className="border-b border-sky-100 bg-sky-50/50">
        <CardTitle className="flex items-center gap-2 text-lg font-bold text-[#15375b]">
          <UserPlus className="size-5 text-[#0877b8]" aria-hidden="true" />{' '}
          관리자 파트너 직접등록
        </CardTitle>
        <CardDescription className="leading-6">
          대표님이 4개 항목과 파트너 유형을 확인하면 별도 신청·승인 대기 없이
          활성 계정으로 등록됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {success && (
          <output className="mb-5 block rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <span className="flex items-center gap-2 font-bold">
              <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
              {success}
            </span>
            <span className="mt-2 block leading-6">
              초대 이메일은 발송하지 않았습니다. 계정·권한 설정에서 본인 확인 후
              비밀번호 설정 링크를 발급해 전달해 주세요. ChatGPT 없이 이용할 수
              있습니다.
            </span>
          </output>
        )}
        <form onSubmit={submit} noValidate aria-busy={busy}>
          {(error || Object.keys(errors).length > 0) && (
            <div
              ref={errorRef}
              role="alert"
              tabIndex={-1}
              className="mb-5 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 outline-none focus:ring-2 focus:ring-red-400"
            >
              <p className="font-bold">
                {error || '입력 항목을 확인해 주세요.'}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {Object.entries(errors).map(([key, message]) => (
                  <li key={key}>
                    <a
                      href={`#partner-register-${key}`}
                      className="underline underline-offset-2"
                    >
                      {message}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <fieldset disabled={busy} className="min-w-0">
            <legend className="sr-only">새 파트너 정보</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map(({ key, label, ...props }) => (
                <div key={key} className="space-y-2">
                  <label
                    htmlFor={`partner-register-${key}`}
                    className="block text-sm font-semibold text-slate-800"
                  >
                    {label} <span className="text-red-600">*</span>
                  </label>
                  <Input
                    {...props}
                    id={`partner-register-${key}`}
                    name={key}
                    required
                    value={form[key]}
                    onChange={(event) => {
                      setForm(
                        registrationFieldUpdate(key, event.currentTarget.value),
                      );
                      setConfirmed(false);
                    }}
                    className="h-11 bg-white"
                    aria-invalid={Boolean(errors[key])}
                    aria-describedby={
                      `${key === 'email' ? 'partner-register-email-help ' : ''}${errors[key] ? `partner-register-${key}-error` : ''}`.trim() ||
                      undefined
                    }
                  />
                  {key === 'email' && (
                    <p
                      id="partner-register-email-help"
                      className="text-xs leading-5 text-slate-600"
                    >
                      파트너 본인이 사이트 로그인 아이디로 사용할 이메일을
                      입력해 주세요.
                    </p>
                  )}
                  {errors[key] && (
                    <p
                      id={`partner-register-${key}-error`}
                      className="text-sm text-red-700"
                    >
                      {errors[key]}
                    </p>
                  )}
                </div>
              ))}
              <div className="space-y-2">
                <label
                  htmlFor="partner-register-memberType"
                  className="block text-sm font-semibold text-slate-800"
                >
                  파트너 유형 <span className="text-red-600">*</span>
                </label>
                <NativeSelect
                  id="partner-register-memberType"
                  name="memberType"
                  required
                  value={form.memberType}
                  onChange={(event) => {
                    setForm(
                      registrationFieldUpdate(
                        'memberType',
                        event.currentTarget
                          .value as PartnerRegistration['memberType'],
                      ),
                    );
                    setConfirmed(false);
                  }}
                  className="w-full bg-white [&_select]:h-11"
                  aria-invalid={Boolean(errors.memberType)}
                  aria-describedby={
                    errors.memberType
                      ? 'partner-register-memberType-error'
                      : undefined
                  }
                >
                  <option value="">파트너 유형 선택</option>
                  {partnerTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </NativeSelect>
                {errors.memberType && (
                  <p
                    id="partner-register-memberType-error"
                    className="text-sm text-red-700"
                  >
                    {errors.memberType}
                  </p>
                )}
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-600">
                <p className="flex items-center gap-2 font-bold text-slate-800">
                  <ShieldCheck className="size-4" aria-hidden="true" /> 기본
                  파트너 권한
                </p>
                <p>대표 공유일정 · 협업신청 · 본인 담당 진행 · 자료 등록</p>
                <p>관리자 권한과 견적·계약 열람 권한은 부여하지 않습니다.</p>
              </div>
            </div>
            <div className="mt-5 rounded-xl border border-slate-200 p-3">
              <label
                htmlFor="partner-register-confirmed"
                className="flex min-h-11 cursor-pointer items-center gap-3 text-sm leading-6 text-slate-700"
              >
                <input
                  id="partner-register-confirmed"
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="size-5 shrink-0 accent-[#0877b8]"
                  aria-invalid={Boolean(errors.confirmed)}
                  aria-describedby={
                    errors.confirmed
                      ? 'partner-register-confirmed-error'
                      : undefined
                  }
                />
                <span>
                  입력정보와 이메일을 확인했으며, 위 기본 권한으로 즉시
                  등록·활성화합니다.
                </span>
              </label>
              {errors.confirmed && (
                <p
                  id="partner-register-confirmed-error"
                  className="mt-2 text-sm text-red-700"
                >
                  {errors.confirmed}
                </p>
              )}
            </div>
          </fieldset>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-slate-500">
              {disabled && !busy
                ? '기존 변경사항 저장이 완료되어야 등록할 수 있습니다. 저장 오류가 있으면 상단 안내를 확인해 주세요.'
                : '이미 등록된 이메일은 새로 만들지 않습니다. 기존 계정은 아래 목록에서 관리해 주세요.'}
            </p>
            <Button
              type="submit"
              disabled={disabled || busy}
              className="h-11 shrink-0 gap-2 rounded-xl bg-[#0877b8] px-5 font-bold text-white hover:bg-[#065f95]"
            >
              {busy ? (
                <LoaderCircle
                  className="size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <UserPlus className="size-4" aria-hidden="true" />
              )}
              {busy ? '등록 확인 중' : '파트너 등록·활성화'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
