export const PORTAL_STATE_LIMIT_BYTES = 900_000;
export const AI_DIAGNOSIS_RUN_FIELD_LIMITS = {
  requestId: 100,
  caseId: 120,
  company: 100,
  instructionVersion: 100,
  model: 200,
  actorId: 256,
} as const;
export const STEP_ZERO_PENDING_LIMIT_BYTES = 256;
export const STEP_ZERO_RESULT_LIMIT_BYTES = 320_000;
export const STEP_ZERO_MAX_OUTPUT_TOKENS = 4_000;
