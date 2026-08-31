'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { RecoveryControls, RecoveryPreview } from '@/lib/file-recovery';

export function RecoverOriginal({
  fileId,
  recoveryDisabled,
  beginRecovery,
  finishRecovery,
}: RecoveryControls & { fileId: string }) {
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const requestId = useRef('');
  const lock = useRef(false);
  const [attempted, setAttempted] = useState(false);
  async function review() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `/api/admin/file-inventory/${encodeURIComponent(fileId)}/recovery`,
        { cache: 'no-store' },
      );
      const result = (await response.json()) as RecoveryPreview & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || '회수 조건을 확인하지 못했습니다.');
      setPreview(result);
      setConfirmed(false);
      requestId.current = crypto.randomUUID();
      setAttempted(false);
    } catch (issue) {
      setError((issue as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function recover() {
    if (!preview || lock.current || !confirmed || reason.trim().length < 5)
      return;
    lock.current = true;
    setBusy(true);
    setError('');
    let started = false;
    try {
      const session = await beginRecovery();
      started = true;
      if (!attempted && session.stateRevision !== preview.stateRevision)
        throw new Error(
          '운영 화면과 확인한 버전이 다릅니다. 저장되지 않은 입력을 확인하고 새로고침해 주세요.',
        );
      setAttempted(true);
      const response = await fetch(
        `/api/admin/file-inventory/${encodeURIComponent(fileId)}/recovery`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...session,
            caseId: preview.caseId,
            requestId: requestId.current,
            reason,
            confirmed,
            stateRevision: preview.stateRevision,
            fileRevision: preview.fileRevision,
          }),
        },
      );
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || result.ok !== true)
        throw new Error(result.error || '회수 저장을 확인하지 못했습니다.');
      setSaved(true); // Keep the parent editor locked until its fresh server state is loaded.
    } catch (issue) {
      if (started) finishRecovery(false);
      setError((issue as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 rounded-lg border border-sky-100 bg-sky-50/40 p-3">
      {saved ? (
        <>
          <output className="block text-sm font-semibold text-emerald-800">
            원본 연결을 저장했습니다. 원본 파일과 담당 계정은 유지했습니다.
          </output>
          <Button onClick={() => finishRecovery(true)}>
            최신 운영 화면 불러오기
          </Button>
        </>
      ) : (
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || recoveryDisabled || attempted}
            onClick={() => void review()}
          >
            기존 신청 회수 조건 확인
          </Button>
          {preview && (
            <div className="space-y-3 text-xs leading-5">
              <p>
                <strong>
                  {preview.company} · {preview.service}
                </strong>
                <br />
                담당: {preview.partnerName} · {preview.partnerEmail}
                <br />
                <span className="break-all">진행: {preview.caseId}</span>
                <br />
                원본: {preview.fileName} ·{' '}
                {preview.sizeBytes.toLocaleString('ko-KR')} bytes
              </p>
              <p>
                기존 진행번호에 자료 목록과 회수 이력만 추가합니다. 다른
                신청으로 이동하거나 AI 분석을 실행하지 않습니다.
              </p>
              <a
                href={`/api/files/${encodeURIComponent(fileId)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-10 items-center font-semibold text-sky-800 underline"
              >
                권한 확인 후 원본 내려받기
              </a>
              <label className="grid gap-1 font-semibold">
                확인 사유 (5~500자)
                <textarea
                  value={reason}
                  maxLength={500}
                  disabled={busy || attempted}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setConfirmed(false);
                  }}
                  className="min-h-20 rounded-md border bg-white p-2 font-normal"
                  placeholder="원본과 신청 내용을 대조한 내용을 적어 주세요."
                />
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy || attempted}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="mt-1"
                />
                <span>
                  원본 내용과 기업·담당 계정·신청을 대조했으며, 이 원본을 해당
                  신청 자료로 회수하여 기존 담당 파트너에게 공유하는 것을
                  확인합니다.
                </span>
              </label>
              <Button
                size="sm"
                disabled={
                  busy ||
                  recoveryDisabled ||
                  !confirmed ||
                  reason.trim().length < 5
                }
                onClick={() => void recover()}
              >
                {busy
                  ? '저장 확인 중…'
                  : attempted
                    ? '같은 회수 요청 다시 확인'
                    : '확인한 원본 연결 회수'}
              </Button>
              {attempted && (
                <p>
                  응답이 불확실하면 같은 요청을 다시 확인하세요. 최신 화면에서
                  이미 연결됐는지도 확인할 수 있습니다.
                </p>
              )}
            </div>
          )}
          {error && (
            <p role="alert" className="text-xs leading-5 text-red-700">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
