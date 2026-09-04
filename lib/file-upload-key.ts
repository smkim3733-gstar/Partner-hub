import { safeFileName, type CompanyFileCategory } from './company-file-policy';
import { downloadContentType } from './download-content-type';
import { fileDigest } from './file-digest';

export { fileDigest } from './file-digest';

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
  const keyFor = (fileName: string, contentType: string) =>
    fileDigest(
      JSON.stringify([
        'company-upload-v1',
        scope,
        fileName,
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
  if (!input.caseId) {
    return { current: await keyFor(file.name, file.type), legacyKeys: [] };
  }
  const normalizedName = safeFileName(file.name);
  const current = await keyFor(
    normalizedName,
    downloadContentType(normalizedName),
  );
  const legacyNames = new Set([
    file.name,
    normalizedName,
    normalizedName.normalize('NFD'),
  ]);
  const legacyKeys = new Set<string>();
  for (const name of legacyNames) {
    for (const contentType of [downloadContentType(name), file.type]) {
      const candidate = await keyFor(name, contentType);
      if (candidate !== current) legacyKeys.add(candidate);
    }
  }
  return { current, legacyKeys: [...legacyKeys] };
}

/** Draft-linked uploads can be recovered by reselecting the same file after reload.
 * Standalone uploads reuse a key only while the same File remains selected. */
export async function companyUploadKey(input: CompanyUploadInput) {
  return (await companyUploadKeyVariants(input)).current;
}
