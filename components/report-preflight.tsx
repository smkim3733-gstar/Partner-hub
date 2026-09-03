'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { currentPreflight, type ReportPreflight } from '@/lib/report-preflight';
import { readReportPreflightResponse } from '@/lib/report-preflight-response';

export function FirstReportPreflight({
  caseId,
  revision,
  busy,
  generate,
  refresh,
  openReports,
}: {
  caseId: string;
  revision: number;
  busy: boolean;
  generate: () => Promise<boolean>;
  refresh: () => void;
  openReports: () => void;
}) {
  const [result, setResult] = useState<ReportPreflight | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const requestLock = useRef(false);
  const generationLock = useRef(false);
  const errorSummary = useRef<HTMLDivElement | null>(null);
  const ready = currentPreflight(result, caseId, revision);
  const stale = Boolean(
    result && (result.caseId !== caseId || result.revision !== revision),
  );
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (error || (result && !ready)) errorSummary.current?.focus();
  }, [error, result, ready]);

  async function check() {
    if (busy || requestLock.current) return;
    requestLock.current = true;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setChecking(true);
    setResult(null);
    setError('');
    setConfirmed(false);
    try {
      const response = await fetch(
        `/api/consulting-flow/${encodeURIComponent(caseId)}/preflight`,
        { cache: 'no-store', signal: request.signal },
      );
      const data = await readReportPreflightResponse(
        response,
        caseId,
        revision,
      );
      if (!request.signal.aborted) setResult(data);
    } catch (error) {
      if (!request.signal.aborted)
        setError(error instanceof Error ? error.message : '점검 연결 실패');
    } finally {
      requestLock.current = false;
      if (!request.signal.aborted) setChecking(false);
    }
  }
  async function start() {
    if (!ready || !confirmed || busy || checking || generationLock.current)
      return;
    if (
      !window.confirm(
        '선택된 근거 요약과 파일을 Claude API로 전송해 1차 내부 초안을 생성합니다. 이용요금이 발생합니다. 진행할까요?',
      )
    )
      return;
    generationLock.current = true;
    try {
      await generate();
    } finally {
      generationLock.current = false;
      setConfirmed(false);
    }
  }
  return (
    <section
      id="flow-report-preflight"
      aria-labelledby="preflight-title"
      className="space-y-4 border-t pt-5"
    >
      <h3 id="preflight-title" className="font-bold">
        1차 보고서 생성 전 점검
      </h3>
      <p className="text-sm leading-6 text-muted-foreground">
        저장된 분석 대상과 실행 조건을 먼저 확인합니다. 점검만으로 자료
        저장·상담 완료·유료 AI 호출을 하지 않습니다.
      </p>
      <Button
        variant="outline"
        className="min-h-11 whitespace-normal"
        disabled={busy || checking}
        onClick={() => void check()}
      >
        {checking
          ? '저장된 분석자료 점검 중…'
          : '생성 전 자료 점검 (AI 미전송)'}
      </Button>
      {(error || (result && (!ready || stale))) && (
        <div
          ref={errorSummary}
          role="alert"
          tabIndex={-1}
          className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <h4 className="font-semibold">생성 전에 확인할 사항이 있습니다</h4>
          {error && <p>{error}</p>}
          {stale ? (
            <>
              <p>
                다른 변경이 있습니다. 진행을 새로고침한 뒤 다시 점검해 주세요.
              </p>
              <Button variant="outline" className="min-h-11" onClick={refresh}>
                진행 새로고침
              </Button>
            </>
          ) : (
            result && (
              <ul className="list-disc space-y-1 pl-5">
                {result.checks
                  .filter((check) => !check.passed)
                  .map((check) => (
                    <li key={check.id}>
                      <a
                        className="underline underline-offset-4"
                        href={`#preflight-${check.id}`}
                      >
                        {check.label}: {check.detail}
                      </a>
                    </li>
                  ))}
              </ul>
            )
          )}
        </div>
      )}
      {result && (
        <>
          <div className="rounded-lg border p-3 text-sm leading-6">
            <p className="font-semibold">
              실제 분석 대상: 요약 {result.sourceTextChars.toLocaleString()}자 ·
              파일 {result.fileCount}개 / 8개 ·{' '}
              {(result.totalBytes / 1024 / 1024).toFixed(2)}MB / 8MB
            </p>
            <p className="text-muted-foreground">
              AI 입력에서 제외된 보존 자료 {result.excludedCount}개 · 설정된
              모델 {result.model}
            </p>
            {result.files.length > 0 && (
              <ul
                aria-label="1차 분석 대상 파일"
                className="mt-3 max-h-72 space-y-2 overflow-y-auto"
              >
                {result.files.map((file) => (
                  <li
                    key={file.id}
                    className="break-all rounded-md bg-muted/50 p-2"
                  >
                    {file.name} · {(file.size / 1024 / 1024).toFixed(2)}MB
                    {file.imported ? ' · 신청자료 검토본' : ''}
                  </li>
                ))}
              </ul>
            )}
            {!result.files.length && (
              <p>
                선택된 첨부파일이 없습니다. 요약만으로 진행할 경우 근거가
                충분한지 확인하세요.
              </p>
            )}
          </div>
          <ul className="space-y-3" aria-label="보고서 생성 점검 결과">
            {result.checks.map((check) => (
              <li
                id={`preflight-${check.id}`}
                key={check.id}
                className="space-y-1 rounded-lg border p-3 text-sm leading-6"
              >
                <p className="font-semibold">
                  {check.passed ? '통과' : '확인 필요'} · {check.label}
                </p>
                <p>{check.detail}</p>
                {!check.passed &&
                  (check.target === 'workflow' ? (
                    <Button
                      variant="link"
                      className="min-h-11 px-0"
                      onClick={openReports}
                    >
                      보고서·진행 상태 보기
                    </Button>
                  ) : (
                    <a
                      className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
                      href={
                        check.target === 'sources'
                          ? '#flow-ai-sources'
                          : '#flow-ai-policy'
                      }
                    >
                      {check.target === 'sources'
                        ? '근거자료 확인·수정으로 이동'
                        : 'AI 설정 확인으로 이동'}
                    </a>
                  ))}
              </li>
            ))}
          </ul>
          <details className="rounded-lg border p-3 text-sm leading-6" open>
            <summary className="cursor-pointer font-semibold">
              대표님이 직접 확인할 사항
            </summary>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              {result.notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
          </details>
          {result.hasExistingReport && (
            <p className="rounded-lg bg-muted p-3 text-sm leading-6">
              기존 1차 보고서가 있습니다. 새 버전이 생성되면 대표·파트너
              공동분석을 다시 확인해야 합니다. 이전 보고서는 보존됩니다.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            점검 시각:{' '}
            {new Date(result.checkedAt).toLocaleString('ko-KR', {
              timeZone: 'Asia/Seoul',
            })}{' '}
            · 자료·설정 변경 시 다시 점검해 주세요.
          </p>
        </>
      )}
      <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0 accent-primary"
          checked={confirmed}
          disabled={!ready || busy || checking}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>
          분석 대상·자료 내용·개인정보와 외부 전송 권한을 확인했으며, API
          이용요금이 발생하는 1차 초안 생성을 요청합니다.
        </span>
      </label>
      <Button
        className="min-h-11 whitespace-normal"
        disabled={!ready || !confirmed || busy || checking}
        onClick={() => void start()}
      >
        {busy ? '저장·생성 처리 중…' : '확인한 자료로 1차 보고서 생성 (유료)'}
      </Button>
      <output
        aria-live="polite"
        className="block text-sm text-muted-foreground"
      >
        {checking
          ? 'AI로 전송하지 않고 점검 중입니다.'
          : ready
            ? '기본 점검을 통과했습니다. 자료 내용과 개인정보를 최종 확인한 뒤 생성할 수 있습니다.'
            : '점검 통과와 최종 확인 전에는 생성 버튼이 활성화되지 않습니다.'}
      </output>
    </section>
  );
}
