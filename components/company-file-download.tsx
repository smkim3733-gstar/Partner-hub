'use client';
/* oxlint-disable next/no-html-link-for-pages -- Sites downloads use authenticated native navigation. */
import { useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { directPrivateFiles } from '@/lib/platform-file-transfer-capabilities';
import { downloadPrivateFile } from '@/lib/file-transfer-client';
import {
  fileTransferBusinessPath,
  type FileTransferIntent,
} from '@/lib/file-transfer-contract';

type DownloadProps = {
  fileName: string;
  className?: string;
  children: ReactNode;
  target?: '_blank';
};
function PrivateFileDownload({
  intent,
  fileName,
  className,
  children,
  target,
}: DownloadProps & {
  intent: Extract<
    FileTransferIntent,
    { kind: 'company-download' | 'flow-download' }
  >;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  if (!directPrivateFiles)
    return (
      <a
        href={fileTransferBusinessPath(intent)}
        className={className}
        target={target}
        rel={target ? 'noopener noreferrer' : undefined}
      >
        {children}
      </a>
    );
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className={className}
        disabled={busy}
        aria-busy={busy}
        onClick={async () => {
          if (pending.current) return;
          pending.current = true;
          setBusy(true);
          setError('');
          try {
            await downloadPrivateFile(intent, fileName);
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : '원본을 내려받지 못했습니다.',
            );
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        {busy ? '원본을 내려받는 중…' : children}
      </Button>
      {error && (
        <span role="alert" className="block text-sm text-red-700">
          {error}
        </span>
      )}
    </>
  );
}
export function CompanyFileDownload({
  fileId,
  ...props
}: DownloadProps & { fileId: string }) {
  return (
    <PrivateFileDownload
      {...props}
      intent={{ kind: 'company-download', fileId }}
    />
  );
}
export function FlowFileDownload({
  caseId,
  fileId,
  ...props
}: DownloadProps & { caseId: string; fileId: string }) {
  return (
    <PrivateFileDownload
      {...props}
      intent={{ kind: 'flow-download', caseId, fileId }}
    />
  );
}
