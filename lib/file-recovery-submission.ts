import type { RecoveryControls, RecoveryPreview } from './file-recovery';

type Input = {
  fileId: string;
  preview: RecoveryPreview;
  requestId: string;
  reason: string;
  confirmed: boolean;
};
type Controls = Pick<RecoveryControls, 'beginRecovery' | 'finishRecovery'>;

/** One confirmation owns the editor until the user reloads fresh server state. */
export class FileRecoverySubmission {
  private request: { fileId: string; url: string; body: string } | null = null;
  private flight: Promise<void> | null = null;
  private saved = false;

  hasAttempt() {
    return this.request !== null;
  }
  isSaved() {
    return this.saved;
  }

  submit(
    input: Input,
    controls: Controls,
    send: typeof fetch = fetch,
  ): Promise<void> {
    if (this.flight) return this.flight;
    if (this.saved) return Promise.resolve();
    this.flight = this.run(structuredClone(input), controls, send).finally(
      () => {
        this.flight = null;
      },
    );
    return this.flight;
  }

  private async run(input: Input, controls: Controls, send: typeof fetch) {
    let started = false;
    try {
      if (!this.request) {
        if (
          !input.confirmed ||
          input.reason.trim().length < 5 ||
          input.reason.length > 500
        )
          throw new Error('원본 대조와 확인 사유를 입력해 주세요.');
        const session = await controls.beginRecovery();
        started = true;
        if (session.stateRevision !== input.preview.stateRevision)
          throw new Error(
            '운영 화면과 확인한 버전이 다릅니다. 저장되지 않은 입력을 확인하고 새로고침해 주세요.',
          );
        this.request = {
          fileId: input.fileId,
          url: `/api/admin/file-inventory/${encodeURIComponent(input.fileId)}/recovery`,
          body: JSON.stringify({
            ...session,
            caseId: input.preview.caseId,
            requestId: input.requestId,
            reason: input.reason,
            confirmed: true,
            stateRevision: input.preview.stateRevision,
            fileRevision: input.preview.fileRevision,
          }),
        };
      }
      if (this.request.fileId !== input.fileId)
        throw new Error('확인 중인 원본의 결과를 먼저 확인해 주세요.');
      const response = await send(this.request.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: this.request.body,
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || result?.ok !== true)
        throw new Error(result?.error || '회수 저장을 확인하지 못했습니다.');
      this.saved = true;
    } catch (error) {
      // Once dispatched, even an error can hide a committed recovery. Preserve
      // the lock and exact request until retry or an explicit full reload.
      if (started && !this.request) controls.finishRecovery(false);
      throw error;
    }
  }
}
