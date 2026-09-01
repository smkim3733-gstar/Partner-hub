import { PortalStateConflict } from './portal-state';
import { portalRevision } from './portal-revision';

type RecordValue = Record<string, unknown>;
function records(state: unknown, key: string): RecordValue[] {
  const value = (state as RecordValue | null)?.[key];
  return Array.isArray(value)
    ? value.filter(
        (item): item is RecordValue =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
    : [];
}
function recoveryDocument(item: RecordValue) {
  return (
    item.recovery !== undefined ||
    (typeof item.id === 'string' && item.id.startsWith('file-recovery-'))
  );
}
function recoveryEvent(item: RecordValue) {
  return (
    item.recoveryFileId !== undefined ||
    (typeof item.id === 'string' && item.id.startsWith('timeline-recovery-'))
  );
}
function sortRecords(items: RecordValue[]) {
  return items
    .slice()
    .sort((a, b) =>
      (typeof a.id === 'string' ? a.id : '').localeCompare(
        typeof b.id === 'string' ? b.id : '',
      ),
    );
}
function documentProof(item: RecordValue) {
  return Object.fromEntries(
    [
      'id',
      'storageFileId',
      'caseId',
      'partnerMemberId',
      'company',
      'fileName',
      'fileSize',
      'recovery',
    ].map((key) => [key, item[key]]),
  );
}

/** Only the guarded recovery endpoint creates these server-owned facts.
 * Ordinary state saves may change review status, but not their provenance. */
export async function assertRecoveryProofUnchanged(
  current: unknown,
  next: unknown,
) {
  const documents = records(current, 'companyDocuments').filter(
    recoveryDocument,
  );
  const events = records(current, 'timeline').filter(recoveryEvent);
  const documentIds = new Set(documents.map((item) => item.id));
  const fileIds = new Set(
    documents.map((item) => item.storageFileId).filter(Boolean),
  );
  const eventIds = new Set(events.map((item) => item.id));
  const nextDocuments = records(next, 'companyDocuments').filter(
    (item) =>
      recoveryDocument(item) ||
      documentIds.has(item.id) ||
      fileIds.has(item.storageFileId),
  );
  const nextEvents = records(next, 'timeline').filter(
    (item) => recoveryEvent(item) || eventIds.has(item.id),
  );
  const before = {
    documents: sortRecords(documents.map(documentProof)),
    events: sortRecords(events),
  };
  const after = {
    documents: sortRecords(nextDocuments.map(documentProof)),
    events: sortRecords(nextEvents),
  };
  if ((await portalRevision(before)) !== (await portalRevision(after)))
    throw new PortalStateConflict(
      '원본 회수의 연결 정보·확인 사유·확인 이력은 일반 자료 저장으로 변경할 수 없습니다. 최신 운영 화면을 확인해 주세요.',
      'recovery_proof',
    );
}
