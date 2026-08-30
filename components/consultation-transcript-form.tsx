'use client';

import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  hasSensitiveIdentifier,
  type FlowCommand,
  type FlowMeeting,
} from '@/lib/consulting-flow';
import {
  audioFileProblem,
  MAX_TRANSCRIPT_CHARS,
  transcriptProblem,
} from '@/lib/transcript-policy';

export type TranscriptSubmit = (
  command: FlowCommand,
  file?: File,
  audio?: File,
) => Promise<boolean>;

export function ConsultationTranscriptForm({
  meetings,
  busy,
  canUpload,
  submit,
  recordingId,
  aiEnabled,
}: {
  meetings: FlowMeeting[];
  busy: boolean;
  canUpload: boolean;
  submit: TranscriptSubmit;
  recordingId?: string;
  aiEnabled: boolean;
}) {
  const id = useId();
  const [meetingId, setMeetingId] = useState('');
  const [text, setText] = useState('');
  const [documentFile, setDocumentFile] = useState<File>();
  const [audio, setAudio] = useState<File>();
  const [reading, setReading] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [rights, setRights] = useState(false);
  const [masked, setMasked] = useState(false);
  const [error, setError] = useState('');
  const readVersion = useRef(0);
  const saving = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(
    () => () => {
      readVersion.current++;
    },
    [],
  );
  const completed = meetings.filter((m) => m.status === 'completed');
  const invalid = text
    ? transcriptProblem(text) ||
      (hasSensitiveIdentifier(text)
        ? '식별번호·전화번호·이메일을 가린 뒤 제출해 주세요.'
        : '')
    : '';
  const audioOnly =
    !recordingId && !text.trim() && !documentFile && Boolean(audio);
  const blocked = busy || reading;

  function reportError(message: string) {
    setError(message);
    requestAnimationFrame(() => errorRef.current?.focus());
  }
  async function selectDocument(file?: File) {
    if (!file) return;
    if (
      text &&
      !window.confirm(
        '현재 편집한 본문을 새 파일의 전사문으로 바꿀까요? 취소하면 현재 내용이 유지됩니다.',
      )
    )
      return;
    const version = ++readVersion.current;
    setReading(true);
    setError('');
    try {
      const { readTranscriptFile } = await import('@/lib/transcript-reader');
      const result = await readTranscriptFile(file);
      if (version !== readVersion.current) return;
      setText(result);
      setDocumentFile(file);
      setReviewed(false);
      setRights(false);
      setMasked(false);
    } catch (e) {
      if (version === readVersion.current)
        reportError(
          `${e instanceof Error ? e.message : '파일을 읽지 못했습니다.'} 기존 입력 내용은 유지됩니다.`,
        );
    } finally {
      if (version === readVersion.current) setReading(false);
    }
  }
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked || saving.current) return;
    if (!recordingId && !meetingId)
      return reportError('완료한 상담을 먼저 선택해 주세요.');
    if (!audioOnly && (invalid || !text.trim()))
      return reportError(
        invalid || '전사문 파일을 선택하거나 본문을 입력해 주세요.',
      );
    if (!audioOnly && !reviewed)
      return reportError(
        '기업명·상담일·주요 금액과 전사문 내용을 확인해 주세요.',
      );
    if (!rights || !masked)
      return reportError('자료 활용 권한과 개인정보 확인이 필요합니다.');
    saving.current = true;
    setError('');
    try {
      const success = await submit(
        {
          type: recordingId ? 'save_transcript' : 'save_recording',
          ...(recordingId ? { recordingId } : { meetingId }),
          transcript: text.trim(),
          transcriptReviewed: reviewed,
          recordingConsent: rights,
          fileConsent: rights,
          privacyMasked: masked,
        },
        documentFile,
        audio,
      );
      if (success) {
        setText('');
        setDocumentFile(undefined);
        setAudio(undefined);
        setReviewed(false);
        setRights(false);
        setMasked(false);
      }
    } finally {
      saving.current = false;
    }
  }
  const checkbox =
    'flex min-h-11 items-start gap-3 rounded-lg bg-muted/50 p-3 text-sm leading-6';
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => void save(event)}
      aria-busy={blocked}
    >
      {error && (
        <p
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="rounded-lg border border-destructive p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <fieldset disabled={blocked} className="space-y-4">
        {!recordingId && (
          <div className="grid gap-2">
            <label htmlFor={`${id}-meeting`} className="text-sm font-medium">
              완료한 상담 (필수)
            </label>
            <select
              id={`${id}-meeting`}
              value={meetingId}
              onChange={(e) => {
                setMeetingId(e.target.value);
                setReviewed(false);
              }}
              required
              className="min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              <option value="">상담을 선택하세요</option>
              {completed.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.kind === 'first'
                    ? '초회상담'
                    : m.kind === 'contract'
                      ? '계약상담'
                      : '추가상담'}{' '}
                  ·{' '}
                  {new Date(m.startsAt).toLocaleString('ko-KR', {
                    timeZone: 'Asia/Seoul',
                  })}
                </option>
              ))}
            </select>
            {!completed.length && (
              <p className="text-sm text-muted-foreground">
                상담 일정에서 실제 상담 완료를 기록한 뒤 등록할 수 있습니다.
              </p>
            )}
          </div>
        )}
        {canUpload && (
          <div className="space-y-2 rounded-lg border bg-muted/20 p-4">
            <label
              htmlFor={`${id}-document`}
              className="block text-sm font-semibold"
            >
              녹취자료 첨부 · Word / TXT (전사문)
            </label>
            <Input
              id={`${id}-document`}
              type="file"
              accept=".docx,.txt"
              className="min-h-11 py-2"
              aria-describedby={`${id}-document-help`}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                void selectDocument(file);
              }}
            />
            <p
              id={`${id}-document-help`}
              className="text-sm leading-6 text-muted-foreground"
            >
              5MB 이하 · 파일을 선택하면 이 기기에서 본문을 읽습니다. 아직
              저장·AI 전송하지 않습니다. Word 본문·표의 텍스트만 읽으며
              이미지·머리글·주석은 제외됩니다.
            </p>
            {documentFile && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="break-all">
                  선택한 전사문: {documentFile.name}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => {
                    readVersion.current++;
                    setDocumentFile(undefined);
                    setReviewed(false);
                  }}
                >
                  파일만 제외 · 본문 유지
                </Button>
              </div>
            )}
            <p className="text-xs leading-5 text-muted-foreground">
              PDF·HWP·구형 DOC는 Word/TXT로 변환하거나 아래에 본문을 붙여넣어
              주세요. 파일명에서 상담일을 자동 확정하지 않습니다.
            </p>
          </div>
        )}
        <div className="grid gap-2">
          <label htmlFor={`${id}-text`} className="text-sm font-semibold">
            전사문 본문 확인·수정 또는 직접 붙여넣기
          </label>
          <Textarea
            id={`${id}-text`}
            value={text}
            rows={10}
            className="max-h-96 min-h-52 overflow-y-auto leading-6"
            aria-describedby={`${id}-text-help ${invalid ? `${id}-invalid` : ''}`}
            aria-invalid={Boolean(invalid)}
            onChange={(e) => {
              setText(e.target.value);
              setReviewed(false);
              setMasked(false);
            }}
            placeholder="요약본보다 전체 전사문을 권장합니다. 발언자·시간 표시를 유지하고, 불명확한 숫자는 ‘확인 필요’로 남겨 주세요."
          />
          <p id={`${id}-text-help`} className="text-sm text-muted-foreground">
            {text.length.toLocaleString()} /{' '}
            {MAX_TRANSCRIPT_CHARS.toLocaleString()}자 · 20자 이상. 수정한 본문이
            분석에 사용되며, 첨부 원본 자체는 바뀌지 않습니다.
          </p>
          {invalid && (
            <p
              id={`${id}-invalid`}
              role="alert"
              className="text-sm text-destructive"
            >
              {invalid}
            </p>
          )}
        </div>
        {!recordingId && canUpload && (
          <details className="rounded-lg border p-3">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
              원본 음성 선택 첨부 · 보조 자료
            </summary>
            <label htmlFor={`${id}-audio`} className="mb-2 block text-sm">
              MP3·M4A·WAV / 25MB 이하
            </label>
            <Input
              id={`${id}-audio`}
              type="file"
              accept=".mp3,.m4a,.wav"
              className="min-h-11 py-2"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const issue = audioFileProblem(file);
                if (issue) return reportError(issue);
                setAudio(file);
                setRights(false);
                setError('');
              }}
            />
            {audio && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="break-all">{audio.name}</span>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setAudio(undefined)}
                >
                  음성 제외
                </Button>
              </div>
            )}
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              원음 확인용으로만 보관합니다. 음성 자동전사는 미연결이며 음성만
              제출하면 ‘전사문 대기’로 저장됩니다. 음성 파일은 Claude에 전송하지
              않습니다.
            </p>
          </details>
        )}
        <label className={checkbox}>
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
            disabled={audioOnly}
            className="mt-1 size-4 shrink-0 accent-primary"
          />
          <span>
            선택한 기업·상담일과 주요 금액을 확인했습니다. 불명확한 내용은 ‘확인
            필요’로 표시했습니다.{' '}
            {audioOnly ? '(음성 보관만 할 때는 제외)' : '(필수)'}
          </span>
        </label>
        <label className={checkbox}>
          <input
            type="checkbox"
            checked={rights}
            onChange={(e) => setRights(e.target.checked)}
            className="mt-1 size-4 shrink-0 accent-primary"
          />
          <span>
            자료 저장·분석·담당 파트너 공유에 필요한 활용 권한을 확인했습니다.
            (필수)
          </span>
        </label>
        <label className={checkbox}>
          <input
            type="checkbox"
            checked={masked}
            onChange={(e) => setMasked(e.target.checked)}
            className="mt-1 size-4 shrink-0 accent-primary"
          />
          <span>
            분석 본문과 첨부 사본의 불필요한 개인정보를 확인했습니다. 전사문은
            기업별 AI 허용 시 Claude로 전송됩니다. 자동 마스킹 기능은 아닙니다.
            (필수)
          </span>
        </label>
        <p className="text-sm leading-6 text-muted-foreground">
          {audioOnly
            ? '이번 제출은 음성 보관만 하며 보고서를 생성하지 않습니다.'
            : aiEnabled
              ? '제출하면 확인한 전사문과 기존 1차 보고서로 4차 초안을 요청합니다. 기업별 승인 범위의 API 이용요금이 발생합니다.'
              : 'AI 자동생성이 중지된 기업입니다. 전사문은 저장되며 대표의 AI 승인·생성 요청 전에는 외부로 전송하지 않습니다.'}
        </p>
        <Button
          type="submit"
          className="min-h-11 px-5"
          disabled={blocked || (!recordingId && !completed.length)}
        >
          {reading
            ? '문서 본문 읽는 중…'
            : busy
              ? '저장·처리 중…'
              : audioOnly
                ? '음성만 보관 · 전사문 대기'
                : '녹취자료 저장 · 4차 생성 요청'}
        </Button>
      </fieldset>
      <output
        aria-live="polite"
        className="block text-sm text-muted-foreground"
      >
        {reading
          ? '문서를 읽고 있습니다. 입력·저장 내용은 아직 변경되지 않았습니다.'
          : documentFile
            ? '본문을 읽었습니다. 내용 확인 후 제출해 주세요.'
            : ''}
      </output>
    </form>
  );
}
