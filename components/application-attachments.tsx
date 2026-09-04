'use client';

import { useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  appendApplicationFiles,
  attachmentKey,
  companyFileAccept,
  recordingFileAccept,
  companyCategoryLabel,
  companyFileCategories,
  isAudioFile,
  MAX_APPLICATION_FILES,
  MAX_COMPANY_FILE_MEGABYTES,
  type ApplicationAttachment,
} from '@/lib/company-file-policy';

export function ApplicationAttachments({
  value,
  onChange,
  disabled,
}: {
  value: ApplicationAttachment[];
  onChange: (files: ApplicationAttachment[]) => void;
  disabled: boolean;
}) {
  const id = useId();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  function add(files: File[], recording: boolean) {
    if (!files.length || disabled) return;
    try {
      const result = appendApplicationFiles(value, files, recording);
      onChange(result.files);
      setError('');
      setNotice(
        result.duplicates
          ? `이미 선택한 파일 ${result.duplicates}개는 중복 추가하지 않았습니다.`
          : `${files.length}개 선택됨. 아직 서버에 저장하지 않았습니다.`,
      );
    } catch (issue) {
      setError(
        issue instanceof Error ? issue.message : '첨부파일을 확인해 주세요.',
      );
      setNotice('');
    }
  }
  return (
    <fieldset disabled={disabled} className="space-y-5">
      <legend className="mb-2 text-base font-bold">자료 첨부</legend>
      <p className="text-sm leading-6 text-muted-foreground">
        사업자등록증·크레탑과 대표 전화통화 녹취자료를 함께 제출할 수 있습니다.
        파일당 {MAX_COMPANY_FILE_MEGABYTES}MB 이하, 전체 {MAX_APPLICATION_FILES}
        개까지 선택합니다.
      </p>
      <div className="grid gap-2 rounded-xl border bg-muted/20 p-4">
        <label htmlFor={`${id}-company`} className="text-sm font-semibold">
          기업 기본자료
        </label>
        <Input
          id={`${id}-company`}
          type="file"
          multiple
          accept={companyFileAccept}
          className="min-h-11 py-2"
          aria-describedby={`${id}-company-help`}
          onChange={(event) => {
            add(Array.from(event.target.files || []), false);
            event.target.value = '';
          }}
        />
        <p
          id={`${id}-company-help`}
          className="text-sm leading-6 text-muted-foreground"
        >
          사업자등록증·크레탑·재무자료 등 · PDF, 이미지, 엑셀, Word, TXT
        </p>
      </div>
      <div className="grid gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
        <label htmlFor={`${id}-recording`} className="text-sm font-semibold">
          녹취자료 등록 (선택)
        </label>
        <Input
          id={`${id}-recording`}
          type="file"
          multiple
          accept={recordingFileAccept}
          className="min-h-11 py-2"
          aria-describedby={`${id}-recording-help`}
          onChange={(event) => {
            add(Array.from(event.target.files || []), true);
            event.target.value = '';
          }}
        />
        <p
          id={`${id}-recording-help`}
          className="text-sm leading-6 text-muted-foreground"
        >
          신청 전 대표와 나눈 전화통화·상담 내용입니다. 문서로 정리한
          Word(DOCX)·TXT·PDF를 우선 첨부하고, 원본 MP3·M4A·WAV는 보조 자료로
          함께 등록할 수 있습니다.
        </p>
        <p className="text-sm leading-6 text-muted-foreground">
          기업자료함의 ‘녹취자료’로 보관합니다. PDF는 저장용이며 본문 자동
          추출은 하지 않습니다. 음성 자동전사는 미연결입니다. 제출만으로 상담
          완료 처리나 AI 보고서 생성·외부 전송을 하지 않습니다.
        </p>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive p-3 text-sm text-destructive"
        >
          {error} 기존 선택은 유지됩니다.
        </p>
      )}
      <output
        aria-live="polite"
        className="block text-sm text-muted-foreground"
      >
        {notice}
      </output>
      {value.length > 0 && (
        <ul aria-label="신청에 첨부할 자료" className="space-y-2">
          {value.map((item) => (
            <li
              key={attachmentKey(item.file)}
              className="flex flex-wrap items-center gap-3 rounded-lg border bg-background p-3"
            >
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold [overflow-wrap:anywhere]">
                  {item.file.name}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {companyCategoryLabel(item.category)} ·{' '}
                  {(item.file.size / 1024 / 1024).toFixed(2)}MB
                  {isAudioFile(item.file.name)
                    ? ' · 원본 음성 보관 / 자동전사 안 함'
                    : item.category === '상담녹취'
                      ? ' · 전화상담 내용 문서 / 대표 검토 전'
                      : ''}
                </p>
                <label className="mt-3 grid gap-1.5 font-medium">
                  <span>자료종류</span>
                  <select
                    value={item.category}
                    onChange={(event) => {
                      onChange(value.map((other) => other === item
                        ? { ...other, category: event.target.value as ApplicationAttachment['category'], categoryConfirmed: false }
                        : other));
                      setError('');
                      setNotice('자료종류를 바꿨습니다. 현재 선택을 확인해 주세요.');
                    }}
                    className="min-h-11 rounded-md border bg-background px-3"
                    aria-label={`${item.file.name} 자료종류`}
                  >
                    {companyFileCategories.map((category) => (
                      <option key={category} value={category}>{companyCategoryLabel(category)}</option>
                    ))}
                  </select>
                </label>
                <label className="mt-3 flex min-h-11 items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    checked={item.categoryConfirmed}
                    onChange={(event) => {
                      onChange(value.map((other) => other === item
                        ? { ...other, categoryConfirmed: event.target.checked }
                        : other));
                      setError('');
                      setNotice(event.target.checked ? '자료종류를 확인했습니다.' : '자료종류 확인을 해제했습니다.');
                    }}
                    className="size-4 accent-primary"
                  />
                  현재 파일의 자료종류 확인
                </label>
                {!item.categoryConfirmed && (
                  <p className="mt-1 font-semibold text-amber-700">파일명 기준 제안입니다. 제출 전에 직접 확인해 주세요.</p>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                aria-label={`${item.file.name} 첨부 제외`}
                onClick={() => {
                  onChange(value.filter((other) => other !== item));
                  setError('');
                  setNotice('선택한 파일을 첨부 목록에서 제외했습니다.');
                }}
              >
                제외
              </Button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
