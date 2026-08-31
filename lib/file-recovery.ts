export type RecoveryPreview = {
  fileId: string;
  fileName: string;
  company: string;
  category: string;
  title: string;
  caseId: string;
  service: string;
  partnerMemberId: string;
  partnerName: string;
  partnerEmail: string;
  sizeBytes: number;
  stateRevision: string;
  fileRevision: string;
};
export type RecoverySession = { expectedUserId: string; stateRevision: string };
export type RecoveryControls = {
  recoveryDisabled: boolean;
  recoveryBusy: boolean;
  beginRecovery: () => Promise<RecoverySession>;
  finishRecovery: (reload: boolean) => void;
};
