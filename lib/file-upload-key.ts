import type { CompanyFileCategory } from './company-file-policy';

export async function fileDigest(value: ArrayBuffer | string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    typeof value === 'string' ? new TextEncoder().encode(value) : value,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export type CompanyUploadInput = {
  file: File;
  company: string;
  title: string;
  category: CompanyFileCategory;
  assignedTrainee: string;
  partnerMemberId?: string;
  caseId?: string;
  recordingConsent?: boolean;
  expectedUserId?: string;
};
const fileAttempts = new WeakMap<File, string>();

/** Draft-linked uploads can be recovered by reselecting the same file after reload.
 * Standalone uploads reuse a key only while the same File remains selected. */
export async function companyUploadKey(input: CompanyUploadInput) {
  const { file } = input;
  let scope = input.caseId;
  if (!scope) {
    scope = fileAttempts.get(file);
    if (!scope) {
      scope = crypto.randomUUID();
      fileAttempts.set(file, scope);
    }
  }
  return fileDigest(
    JSON.stringify([
      'company-upload-v1',
      scope,
      file.name,
      file.type,
      file.size,
      input.company.trim(),
      input.title.trim(),
      input.category,
      input.partnerMemberId ?? '',
      input.partnerMemberId ? '' : input.assignedTrainee.trim(),
      await fileDigest(await file.arrayBuffer()),
    ]),
  );
}
