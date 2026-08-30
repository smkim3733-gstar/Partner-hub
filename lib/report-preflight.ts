export type ReportPreflight = {
  caseId: string;
  revision: number;
  checkedAt: string;
  canGenerate: boolean;
  sourceTextChars: number;
  fileCount: number;
  totalBytes: number;
  excludedCount: number;
  model: string;
  hasExistingReport: boolean;
  files: Array<{
    id: string;
    name: string;
    size: number;
    type: string;
    imported: boolean;
  }>;
  checks: Array<{
    id: string;
    label: string;
    passed: boolean;
    detail: string;
    target: 'sources' | 'policy' | 'workflow';
  }>;
  notices: string[];
};

export function currentPreflight(
  result: ReportPreflight | null,
  caseId: string,
  revision: number,
) {
  return Boolean(
    result?.canGenerate &&
    result.caseId === caseId &&
    result.revision === revision,
  );
}
