'use client';
/* oxlint-disable next/no-html-link-for-pages -- Authenticated source downloads use native navigation. */
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { companyCategoryLabel } from '@/lib/company-file-policy';
import {
  firstMeeting,
  hasSensitiveIdentifier,
  type ConsultingFlow,
  type FlowCommand,
} from '@/lib/consulting-flow';
import type {
  IntakeSourceOption,
  IntakeSourcePreview,
} from '@/lib/intake-source-policy';
import {
  MAX_TRANSCRIPT_CHARS,
  transcriptProblem,
} from '@/lib/transcript-policy';

export function IntakeSourceReview({
  flow,
  busy,
  submit,
}: {
  flow: ConsultingFlow;
  busy: boolean;
  submit: (command: FlowCommand) => Promise<boolean>;
}) {
  const endpoint = `/api/consulting-flow/${encodeURIComponent(flow.caseId)}/intake-files`;
  const [files, setFiles] = useState<IntakeSourceOption[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [preview, setPreview] = useState<IntakeSourcePreview | null>(null);
  const [text, setText] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [permission, setPermission] = useState(false);
  const [recording, setRecording] = useState(false);
  const [masked, setMasked] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const readController = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const pendingRead = useRef(false);
  const locked = Boolean(
    flow.contract ||
    firstMeeting(flow)?.completedAt ||
    flow.jobs.some(
      (j) => j.stage === 1 && ['queued', 'processing'].includes(j.status),
    ),
  );
  const alreadyImported = (id: string) =>
    flow.files.some((f) => f.purpose === 'source' && f.intakeFileId === id);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as {
          files: IntakeSourceOption[];
          hasMore: boolean;
          error?: string;
        };
        if (!response.ok)
          throw new Error(data.error || '신청자료 목록을 불러오지 못했습니다.');
        if (!controller.signal.aborted) {
          setFiles(data.files);
          setHasMore(data.hasMore);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : '자료 목록 확인 필요',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      readController.current?.abort();
    };
  }, [endpoint, reload]);
  function resetChecks() {
    setConfirmed(false);
    setPermission(false);
    setRecording(false);
    setMasked(false);
  }
  async function review(file: IntakeSourceOption) {
    if (busy || saving.current || pendingRead.current || locked) return;
    pendingRead.current = true;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    setReading(true);
    setError('');
    setNotice('');
    setPreview(null);
    setText('');
    resetChecks();
    try {
      const response = await fetch(
        `${endpoint}?fileId=${encodeURIComponent(file.id)}`,
        { cache: 'no-store', signal: controller.signal },
      );
      const data = (await response.json()) as IntakeSourcePreview & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error || '자료를 읽지 못했습니다.');
      if (controller.signal.aborted) return;
      setPreview(data);
      setText(data.text || '');
      setNotice(
        data.file.kind === 'text'
          ? '본문을 불러왔습니다. 아직 저장하거나 AI로 전송하지 않았습니다.'
          : '원본을 내려받아 내용과 마스킹을 확인해 주세요. PDF·이미지는 자동 마스킹되지 않습니다.',
      );
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : '자료 읽기 실패');
    } finally {
      pendingRead.current = false;
      if (!controller.signal.aborted) setReading(false);
    }
  }
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || busy || reading || saving.current || locked) return;
    setError('');
    setNotice('');
    if (
      !confirmed ||
      !permission ||
      !masked ||
      (preview.file.category === '상담녹취' && !recording)
    ) {
      setError('자료 내용·이용 권한·마스킹 확인을 모두 선택해 주세요.');
      return;
    }
    if (preview.file.kind === 'text') {
      const problem = transcriptProblem(text);
      if (problem || hasSensitiveIdentifier(text)) {
        setError(
          problem || '본문의 식별번호·전화번호·이메일을 마스킹해 주세요.',
        );
        return;
      }
    }
    saving.current = true;
    try {
      if (
        await submit({
          type: 'import_intake_source',
          intakeFileId: preview.file.id,
          sourceHash: preview.sourceHash,
          reviewedText: preview.file.kind === 'text' ? text : undefined,
          contentReviewed: confirmed,
          fileConsent: permission,
          privacyMasked: masked,
          recordingConsent: recording,
        })
      ) {
        setPreview(null);
        setText('');
        resetChecks();
        setNotice(
          '검토본을 1차 근거자료에 반영했습니다. 원본은 보존되며 AI 생성은 별도로 승인해야 합니다.',
        );
      } else
        setError(
          '반영하지 못했습니다. 상단 오류를 확인해 주세요. 검토 내용은 유지했습니다.',
        );
    } finally {
      saving.current = false;
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>신청자료 불러오기 · 1차 진단 준비</CardTitle>
        <CardDescription className="leading-6">
          {flow.company} · 담당 {flow.partnerName}에게 연결된 기업자료입니다.
          자료를 선택하고 확인한 사본만 근거자료에 추가합니다. 자료 반영만으로
          상담 완료나 보고서 생성을 처리하지 않습니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {locked && (
          <p className="rounded-lg bg-muted p-3 text-sm">
            1차 생성 중이거나 초회상담·계약이 완료되어 새 근거자료 반영이 잠겨
            있습니다.
          </p>
        )}
        <Button
          variant="outline"
          className="min-h-11"
          disabled={busy || reading || loading}
          onClick={() => {
            setLoading(true);
            setError('');
            setReload((n) => n + 1);
          }}
        >
          신청자료 목록 새로고침
        </Button>
        {loading ? (
          <output className="block">신청자료 목록을 불러오는 중입니다…</output>
        ) : !files.length ? (
          <p className="text-sm text-muted-foreground">
            연결된 신청자료가 없습니다. 기업자료함에서 기업명과 담당 파트너를
            확인하거나 아래에서 사본을 직접 등록해 주세요.
          </p>
        ) : (
          <ul
            aria-label="신청 시 등록된 기업자료"
            className="max-h-80 space-y-3 overflow-y-auto"
          >
            {files.map((file) => (
              <li
                key={file.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1 basis-48 space-y-1">
                  <p className="break-all text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {companyCategoryLabel(file.category)} ·{' '}
                    {(file.size / 1024 / 1024).toFixed(2)}MB
                  </p>
                  {(file.blockedReason || alreadyImported(file.id)) && (
                    <p className="text-sm text-muted-foreground">
                      {alreadyImported(file.id)
                        ? '1차 근거자료에 반영됨 · 변경 시 기존 검토본을 AI 입력에서 제외한 뒤 다시 반영'
                        : file.blockedReason}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  className="min-h-11"
                  aria-label={`${file.name} 검토하기`}
                  disabled={
                    busy ||
                    reading ||
                    loading ||
                    locked ||
                    Boolean(file.blockedReason) ||
                    alreadyImported(file.id)
                  }
                  onClick={() => void review(file)}
                >
                  검토하기
                </Button>
              </li>
            ))}
          </ul>
        )}
        {hasMore && (
          <p className="text-sm text-muted-foreground">
            최근 100개를 표시합니다. 더 오래된 자료는 기업자료함에서 내려받아
            아래 근거자료로 등록해 주세요.
          </p>
        )}
        {reading && (
          <output className="block">
            자료를 읽고 있습니다. AI 분석은 실행하지 않습니다…
          </output>
        )}
        {preview && (
          <form
            onSubmit={(event) => void save(event)}
            className="space-y-4 rounded-lg border p-4"
          >
            <fieldset
              disabled={busy || reading || locked}
              className="space-y-4"
            >
              <legend className="mb-3 break-all text-sm font-bold">
                검토 대상: {preview.file.name}
              </legend>
              <a
                className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
                href={`/api/files/${encodeURIComponent(preview.file.id)}`}
              >
                선택한 원본 내려받기
              </a>
              {preview.file.kind === 'text' ? (
                <>
                  <label
                    htmlFor="intake-reviewed-text"
                    className="block text-sm font-medium"
                  >
                    검토·마스킹한 분석 본문
                  </label>
                  <Textarea
                    id="intake-reviewed-text"
                    value={text}
                    rows={10}
                    maxLength={MAX_TRANSCRIPT_CHARS}
                    onChange={(event) => {
                      setText(event.target.value);
                      resetChecks();
                      setNotice('');
                    }}
                    aria-describedby="intake-text-help"
                  />
                  <p
                    id="intake-text-help"
                    className="text-sm text-muted-foreground"
                  >
                    {text.length.toLocaleString()} / 60,000자 ·
                    회사·상담일·금액을 확인하고 실명과 불필요한 개인정보를
                    가명·마스킹하세요. 수정한 본문만 TXT 검토본으로 저장하며
                    원본은 변경하지 않습니다. Word의 이미지·머리글·주석은 읽지
                    않습니다.
                  </p>
                </>
              ) : (
                <p className="rounded-lg bg-muted p-3 text-sm leading-6">
                  PDF·이미지 원본을 직접 열어 확인해 주세요. 자동 OCR·마스킹은
                  하지 않습니다. 수정이 필요하면 기업자료함에 마스킹한 사본을
                  먼저 등록하세요. 반영 시 현재 파일의 사본이 AI 근거자료에
                  추가됩니다.
                </p>
              )}
              <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-primary"
                  required
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  기업·자료 내용·상담일과 주요 금액을 확인했습니다. 이는 외부
                  증빙 검증 완료를 의미하지 않습니다.
                </span>
              </label>
              <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-primary"
                  required
                  checked={permission}
                  onChange={(event) => setPermission(event.target.checked)}
                />
                <span>
                  검토 사본을 저장하고 담당 파트너와 공유할 권한을 확인했습니다.
                </span>
              </label>
              {preview.file.category === '상담녹취' && (
                <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-primary"
                    required
                    checked={recording}
                    onChange={(event) => setRecording(event.target.checked)}
                  />
                  <span>
                    통화 녹취자료를 기업진단 근거로 이용할 권한을 확인했습니다.
                  </span>
                </label>
              )}
              <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-primary"
                  required
                  checked={masked}
                  onChange={(event) => setMasked(event.target.checked)}
                />
                <span>
                  분석에 사용할 본문 또는 PDF·이미지 사본의 불필요한 식별정보를
                  제거했습니다. 자동 마스킹으로 보장되지 않습니다.
                </span>
              </label>
              <Button
                type="submit"
                className="min-h-11 whitespace-normal"
                disabled={alreadyImported(preview.file.id)}
              >
                {busy ? '검토본 저장 중…' : '확인한 자료를 1차 근거자료에 반영'}
              </Button>
            </fieldset>
          </form>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <output
          aria-live="polite"
          className="block text-sm leading-6 text-muted-foreground"
        >
          {notice ||
            '1차 분석은 근거파일 최대 8개·합계 8MB입니다. 본문 읽기는 Word·TXT 5MB 이하만 지원합니다.'}
        </output>
      </CardContent>
    </Card>
  );
}
