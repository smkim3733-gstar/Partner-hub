import type { CompanyFileCategory } from './company-file-policy';
import { downloadContentType } from './download-content-type';

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

export async function companyUploadKeyVariants(
  input: CompanyUploadInput,
  availableBytes?: ArrayBuffer,
) {
  const { file } = input;
  let scope = input.caseId;
  if (!scope) {
    scope = fileAttempts.get(file);
    if (!scope) {
      scope = crypto.randomUUID();
      fileAttempts.set(file, scope);
    }
  }
  const bytesDigest = await fileDigest(
    availableBytes ?? (await file.arrayBuffer()),
  );
  const keyFor = (contentType: string) =>
    fileDigest(
      JSON.stringify([
        'company-upload-v1',
        scope,
        file.name,
        contentType,
        file.size,
        input.company.trim(),
        input.title.trim(),
        input.category,
        input.partnerMemberId ?? '',
        input.partnerMemberId ? '' : input.assignedTrainee.trim(),
        bytesDigest,
      ]),
    );
  const legacy = await keyFor(file.type);
  const current = input.caseId
    ? await keyFor(downloadContentType(file.name))
    : legacy;
  return { current, legacy };
}

/** Draft-linked uploads can be recovered by reselecting the same file after reload.
 * Standalone uploads reuse a key only while the same File remains selected. */
export async function companyUploadKey(input: CompanyUploadInput) {
  return (await companyUploadKeyVariants(input)).current;
}
