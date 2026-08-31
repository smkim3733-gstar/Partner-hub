'use client';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
  applicationFields,
  applicationFieldKeys,
  type ApplicationField,
  type ApplicationDetails,
} from '@/lib/application-details';

export function ApplicationDetailFields({
  step,
  value,
  onChange,
  inputClass,
}: {
  step: number;
  value: ApplicationDetails;
  onChange: (field: ApplicationField, text: string) => void;
  inputClass: string;
}) {
  return (
    <>
      {applicationFieldKeys
        .filter((key) => applicationFields[key].step === step)
        .map((key) => {
          const field = applicationFields[key];
          const id = `application-${key}`;
          const hintId = `${id}-hint`;
          return (
            <div
              key={key}
              className={'multiline' in field ? 'md:col-span-2' : ''}
            >
              <label
                htmlFor={id}
                className="mb-2 block text-sm font-semibold text-slate-700"
              >
                {field.label}
                {'required' in field && (
                  <span className="ml-1 text-red-600">*</span>
                )}
              </label>
              {'options' in field ? (
                <select
                  id={id}
                  name={key}
                  className={inputClass}
                  value={value[key]}
                  onChange={(event) => onChange(key, event.target.value)}
                  required
                >
                  {field.options.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : 'multiline' in field ? (
                <Textarea
                  id={id}
                  name={key}
                  className={`${inputClass} min-h-28 py-3`}
                  value={value[key]}
                  maxLength={field.max}
                  required={'required' in field}
                  onChange={(event) => onChange(key, event.target.value)}
                />
              ) : (
                <Input
                  id={id}
                  name={key}
                  className={inputClass}
                  type={'type' in field ? field.type : 'text'}
                  value={value[key]}
                  maxLength={field.max}
                  required={'required' in field}
                  aria-describedby={'hint' in field ? hintId : undefined}
                  onChange={(event) => onChange(key, event.target.value)}
                />
              )}
              {'hint' in field && (
                <p
                  id={hintId}
                  className="mt-1 text-xs leading-5 text-slate-500"
                >
                  {field.hint}
                </p>
              )}
            </div>
          );
        })}
    </>
  );
}

export function ApplicationDetailsSummary({
  details,
}: {
  details?: ApplicationDetails;
}) {
  return (
    <Card className="my-6">
      <details>
        <summary className="cursor-pointer px-4 py-2 text-sm font-bold text-slate-800">
          접수한 신청 내용{' '}
          <span className="ml-2 font-normal text-slate-500">펼쳐서 확인</span>
        </summary>
        <CardContent className="mt-4">
          {details ? (
            <>
              <p className="mb-4 text-xs leading-5 text-slate-500">
                신청자가 제출한 내용입니다. 실등록 여부 확인·공동 협업자 권한
                부여·외부 전송은 수행하지 않습니다.
              </p>
              <dl className="grid gap-x-6 gap-y-4 md:grid-cols-2">
                {applicationFieldKeys.map((key) => {
                  const field = applicationFields[key];
                  return (
                    <div
                      key={key}
                      className={'multiline' in field ? 'md:col-span-2' : ''}
                    >
                      <dt className="text-xs font-semibold text-slate-500">
                        {field.label}
                      </dt>
                      <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">
                        {details[key] || '미입력'}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </>
          ) : (
            <p className="text-sm text-slate-500">
              이전 접수에는 저장된 신청 상세가 없습니다. 기존 진행 기록과
              첨부자료를 확인해 주세요.
            </p>
          )}
        </CardContent>
      </details>
    </Card>
  );
}
