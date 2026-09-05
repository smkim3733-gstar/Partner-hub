import { env } from 'cloudflare:workers';
import {
  consultingFlowFileMetadataLifecycleTriggerSql,
  consultingFlowFileMetadataNoDeleteTriggerSql,
  consultingFlowFileObjectIntegrityTableSql,
  consultingFlowFileObjectIntegrityNoDeleteTriggerSql,
  consultingFlowFileObjectIntegrityNoUpdateTriggerSql,
  consultingFlowFileMetadataTableSql,
  consultingFlowFileOwnersNoDeleteTriggerSql,
  consultingFlowFileOwnersNoUpdateTriggerSql,
  consultingFlowFileOwnersCaseIndexSql,
  consultingFlowFileOwnersTableSql,
  consultingFlowsAuditAppendOnlyTriggerSql,
  consultingFlowsCommandHistoryTriggerSql,
  consultingFlowsCommandInsertEvidenceTriggerSql,
  consultingFlowsCommandInsertEffectTriggerSql,
  consultingFlowsCommandInsertSemanticsTriggerSql,
  consultingFlowsCommandInsertReceiptIdentityTriggerSql,
  consultingFlowsCommandInsertScopeTriggerSql,
  consultingFlowsCommandInsertMemberActorTriggerSql,
  consultingFlowsCommandInsertAdminActorTriggerSql,
  consultingFlowsCommandInsertAdminDisplayTriggerSql,
  consultingFlowsCommandReceiptOriginTriggerSql,
  consultingFlowsCommandEffectTriggerSql,
  consultingFlowsCommandScopeTriggerSql,
  consultingFlowsCommandSemanticsTriggerSql,
  consultingFlowsFailureEvidenceTriggerSql,
  consultingFlowsFailureHistoryTriggerSql,
  consultingFlowsIdentityTriggerSql,
  consultingFlowsInsertEnvelopeTriggerSql,
  consultingFlowsJobsInsertTriggerSql,
  consultingFlowsJobsTransitionTriggerSql,
  consultingFlowsJobCreationAuditIdentityTriggerSql,
  consultingFlowsJobCreationCommandTriggerSql,
  consultingFlowsJobCreationOriginTriggerSql,
  consultingFlowsJobIdentityTriggerSql,
  consultingFlowsJobInsertAuditIdentityTriggerSql,
  consultingFlowsJobInsertCommandTriggerSql,
  consultingFlowsJobInsertOriginTriggerSql,
  consultingFlowsJobLifecycleTriggerSql,
  consultingFlowsJobStatusTriggerSql,
  consultingFlowsJobTransitionAuditTriggerSql,
  consultingFlowsJobTransitionTimestampTriggerSql,
  consultingFlowsNoDeleteTriggerSql,
  consultingFlowsNewCommandEvidenceTriggerSql,
  consultingFlowsNewCommandReceiptIdentityTriggerSql,
  consultingFlowsNewCommandMemberActorTriggerSql,
  consultingFlowsNewCommandAdminActorTriggerSql,
  consultingFlowsNewCommandAdminDisplayTriggerSql,
  consultingFlowsSuccessEvidenceTriggerSql,
  consultingFlowsTransitionTriggerSql,
  consultingFlowsTableSql,
  FLOW_COMMAND_EFFECT_PATHS,
  FLOW_COMMAND_STATE_SCOPE_PATHS,
  portalStateId,
} from '@/db/schema';
import {
  FlowError,
  latestRecording,
  latestReport,
  newConsultingFlow,
  type ConsultingFlow,
  type FlowFile,
} from '@/lib/consulting-flow';
import { resolveFlowAssignment } from '@/lib/consulting-flow-access';
import {
  hasPortalStateStructure,
  requirePortalUser,
  PortalAccessError,
  type PortalUser,
} from '@/lib/portal-auth';
import { readPortalStateSnapshot } from '@/lib/portal-state';
import { projectFlowState } from '@/lib/consulting-flow-projection';
import { isPipelineDiscontinued } from '@/lib/pipeline-dropoff-metrics';
import { isCrossSiteRequest } from '@/lib/request-origin';
import { QueryRequestError } from '@/lib/request-query';
import { readRouteParam, RouteParamError } from '@/lib/request-path';
import { privateJsonResponse } from '@/lib/private-response';
import { CompanyFileError } from '@/lib/company-files';
import {
  FLOW_FILE_STORAGE_PREFIX,
  storedFlowFileNameMatches,
} from '@/lib/consulting-flow-file-policy';
import {
  MAX_FLOW_UPLOAD_BYTES,
  storedFlowFileExtensionRules,
  storedFlowFilePurposes,
} from '@/lib/consulting-flow-upload-policy';
import { MAX_AI_SOURCE_BYTES } from '@/lib/intake-source-policy';
import { MAX_TRANSCRIPT_FILE_BYTES } from '@/lib/transcript-policy';
import { uploadFileFormat } from '@/lib/upload-file-formats';
import {
  FLOW_ADMIN_COMMAND_ACTOR_KEY,
  FLOW_ADMIN_COMMAND_ACTOR_NAME,
} from '@/lib/flow-command-receipt';
import {
  FLOW_AI_EVIDENCE_LIMITS,
  FLOW_COLLECTION_LIMITS,
  FLOW_FIELD_LIMITS,
  FLOW_OBJECT_KEYS,
  FLOW_TEXT_LIMITS,
  hasProjectedConsultingFlowStructure,
  hasStoredConsultingFlowStructure,
} from '@/lib/consulting-flow-shape';

export function flowEnvironment() {
  return env as unknown as {
    DB?: D1Database;
    AI_SOURCE_FILES?: R2Bucket;
    ANTHROPIC_API_KEY?: string;
    ANTHROPIC_MODEL?: string;
  };
}
let flowDatabaseInitialization: Promise<void> | undefined;
export async function flowDatabase() {
  const db = flowEnvironment().DB;
  if (!db) throw new FlowError('진행 저장소가 연결되지 않았습니다.', 503);
  if (!flowDatabaseInitialization) {
    const initialization = db
      .batch([
        db.prepare(consultingFlowsTableSql),
        db.prepare(consultingFlowsIdentityTriggerSql),
        db.prepare(consultingFlowsInsertEnvelopeTriggerSql),
        db.prepare(consultingFlowsJobsInsertTriggerSql),
        db.prepare(consultingFlowsTransitionTriggerSql),
        db.prepare(consultingFlowsAuditAppendOnlyTriggerSql),
        db.prepare(consultingFlowsJobsTransitionTriggerSql),
        db.prepare(consultingFlowsSuccessEvidenceTriggerSql),
        db.prepare(consultingFlowsFailureHistoryTriggerSql),
        db.prepare(consultingFlowsFailureEvidenceTriggerSql),
        db.prepare(consultingFlowsJobIdentityTriggerSql),
        db.prepare(consultingFlowsJobStatusTriggerSql),
        db.prepare(consultingFlowsJobLifecycleTriggerSql),
        db.prepare(consultingFlowsJobTransitionTimestampTriggerSql),
        db.prepare(consultingFlowsJobTransitionAuditTriggerSql),
        db.prepare(consultingFlowsJobInsertOriginTriggerSql),
        db.prepare(consultingFlowsJobCreationOriginTriggerSql),
        db.prepare(consultingFlowsJobInsertAuditIdentityTriggerSql),
        db.prepare(consultingFlowsJobCreationAuditIdentityTriggerSql),
        db.prepare(consultingFlowsCommandHistoryTriggerSql),
        db.prepare(consultingFlowsJobInsertCommandTriggerSql),
        db.prepare(consultingFlowsJobCreationCommandTriggerSql),
        db.prepare(consultingFlowsCommandInsertEvidenceTriggerSql),
        db.prepare(consultingFlowsNewCommandEvidenceTriggerSql),
        db.prepare(consultingFlowsCommandReceiptOriginTriggerSql),
        db.prepare(consultingFlowsCommandInsertSemanticsTriggerSql),
        db.prepare(consultingFlowsCommandSemanticsTriggerSql),
        db.prepare(consultingFlowsCommandInsertEffectTriggerSql),
        db.prepare(consultingFlowsCommandEffectTriggerSql),
        db.prepare(consultingFlowsCommandInsertScopeTriggerSql),
        db.prepare(consultingFlowsCommandScopeTriggerSql),
        db.prepare(consultingFlowsCommandInsertReceiptIdentityTriggerSql),
        db.prepare(consultingFlowsNewCommandReceiptIdentityTriggerSql),
        db.prepare(consultingFlowsCommandInsertMemberActorTriggerSql),
        db.prepare(consultingFlowsNewCommandMemberActorTriggerSql),
        db.prepare(consultingFlowsCommandInsertAdminActorTriggerSql),
        db.prepare(consultingFlowsNewCommandAdminActorTriggerSql),
        db.prepare(consultingFlowsCommandInsertAdminDisplayTriggerSql),
        db.prepare(consultingFlowsNewCommandAdminDisplayTriggerSql),
        db.prepare(consultingFlowsNoDeleteTriggerSql),
        db.prepare(consultingFlowFileOwnersTableSql),
        db.prepare(consultingFlowFileOwnersNoUpdateTriggerSql),
        db.prepare(consultingFlowFileOwnersNoDeleteTriggerSql),
        db.prepare(consultingFlowFileOwnersCaseIndexSql),
        db.prepare(consultingFlowFileMetadataTableSql),
        db.prepare(consultingFlowFileMetadataLifecycleTriggerSql),
        db.prepare(consultingFlowFileMetadataNoDeleteTriggerSql),
        db.prepare(consultingFlowFileObjectIntegrityTableSql),
        db.prepare(consultingFlowFileObjectIntegrityNoUpdateTriggerSql),
        db.prepare(consultingFlowFileObjectIntegrityNoDeleteTriggerSql),
      ])
      .then(() => undefined);
    flowDatabaseInitialization = initialization.catch((error) => {
      flowDatabaseInitialization = undefined;
      throw error;
    });
  }
  await flowDatabaseInitialization;
  return db;
}
export function flowBucket() {
  const bucket = flowEnvironment().AI_SOURCE_FILES;
  if (!bucket)
    throw new FlowError('보안 파일 저장소가 연결되지 않았습니다.', 503);
  return bucket;
}
type StoredFlowRow = {
  case_id: string;
  partner_id: string;
  revision: number;
  updated_at: string;
  payload: string | null;
};
type StoredFlowFileNamesRow = {
  case_id: string;
  names: string;
};
type StoredFlowFileObjectIntegrityRow = {
  validation_mode: string;
  r2_etag: string | null;
  r2_content_type: string;
};
export type FlowFileObjectBinding = {
  etag: string;
  contentType: string;
};
export type FlowFileObjectIntegrity = {
  validationMode: 'metadata' | 'etag';
  etag: string | null;
  contentType: string;
};
const storedFlowIntegrityError = () =>
  new FlowError(
    '저장된 상담 FLOW 무결성을 확인할 수 없습니다. 관리자 복구가 필요합니다.',
    503,
  );
const validFlowTimestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  Number.isFinite(Date.parse(value));
// Mirrors ECMAScript trim whitespace in one literal; repeated char() chains exceed D1's expression-depth limit.
const sqliteTrimCharacters = `'\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'`;
const blankSqlText = (expression: string) =>
  `length(trim(${expression}, ${sqliteTrimCharacters})) = 0`;
const invalidSqlTimestamp = (expression: string) =>
  `julianday(${expression}) IS NULL`;
const jsonExtractSql = (alias: string, field: string) =>
  `json_extract(${alias}.value, '$.${field}')`;
const blankJsonTextSql = (alias: string, field: string) =>
  blankSqlText(jsonExtractSql(alias, field));
const invalidJsonTimestampSql = (alias: string, field: string) =>
  invalidSqlTimestamp(jsonExtractSql(alias, field));
const invalidOptionalJsonTimestampSql = (alias: string, field: string) =>
  `(json_type(${alias}.value, '$.${field}') IS NOT NULL AND ${invalidJsonTimestampSql(alias, field)})`;
// JSON1 exposes an unpaired UTF-16 surrogate as its invalid UTF-8 byte form ED A0..BF 80..BF.
const malformedUnicodeSql = (expression: string) =>
  `hex(${expression}) GLOB '*ED[AB][0-9A-F][89AB][0-9A-F]*'`;
const unexpectedJsonKeysSql = (
  expression: string,
  allowed: readonly string[],
) =>
  `EXISTS (SELECT 1 FROM json_each(${expression}) unexpected_field WHERE
    typeof(unexpected_field.key) <> 'text' OR
    unexpected_field.key NOT IN (${allowed.map((key) => `'${key}'`).join(', ')}))`;
const unexpectedCollectionObjectKeysSql = (
  path: string,
  alias: string,
  allowed: readonly string[],
) =>
  `EXISTS (SELECT 1 FROM json_each(payload, '${path}') ${alias} WHERE
    ${unexpectedJsonKeysSql(
      `CASE WHEN ${alias}.type = 'object' THEN ${alias}.value ELSE '{}' END`,
      allowed,
    )})`;
const storedFlowFilePurposesSql = storedFlowFilePurposes
  .map((purpose) => `'${purpose}'`)
  .join(', ');
const storedFlowFileSizeLimitSql = `CASE
  WHEN json_extract(f.value, '$.purpose') IN ('source', 'source_archived') THEN ${MAX_AI_SOURCE_BYTES}
  WHEN json_extract(f.value, '$.purpose') = 'transcript' THEN ${MAX_TRANSCRIPT_FILE_BYTES}
  WHEN json_extract(f.value, '$.purpose') = 'recording' AND
    (substr(lower(json_extract(f.value, '$.name')), -5) = '.docx' OR
      substr(lower(json_extract(f.value, '$.name')), -4) = '.txt') THEN ${MAX_TRANSCRIPT_FILE_BYTES}
  ELSE ${MAX_FLOW_UPLOAD_BYTES} END`;
const sqlTextLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;
const storedFlowFileFormatRulesSql = sqlTextLiteral(
  JSON.stringify(
    storedFlowFileExtensionRules.map(({ purpose, extension }) => {
      const format = uploadFileFormat(extension);
      if (!format)
        throw new Error('FLOW 파일 형식 등록표가 올바르지 않습니다.');
      return { purpose, extension, contentType: format.contentType };
    }),
  ),
);
// Keep this separate from the large projection predicate so both stay below D1's depth ceiling.
const hiddenFlowSemanticViolationSql = `SELECT 1 AS invalid FROM consulting_flows
  WHERE CASE WHEN json_valid(payload) THEN
    ${unexpectedJsonKeysSql('payload', FLOW_OBJECT_KEYS.root)} OR
    ${unexpectedCollectionObjectKeysSql('$.reports', 'r', FLOW_OBJECT_KEYS.report)} OR
    ${unexpectedCollectionObjectKeysSql('$.files', 'f', FLOW_OBJECT_KEYS.file)} OR
    ${unexpectedCollectionObjectKeysSql('$.recordings', 'r', FLOW_OBJECT_KEYS.recording)} OR
    ${unexpectedCollectionObjectKeysSql('$.jobs', 'j', FLOW_OBJECT_KEYS.job)} OR
    ${unexpectedCollectionObjectKeysSql('$.audit', 'a', FLOW_OBJECT_KEYS.audit)} OR
    ${unexpectedCollectionObjectKeysSql('$.commandReceipts', 'receipt', FLOW_OBJECT_KEYS.receipt)} OR
    (instr(lower(payload), '\\ud') > 0 AND
      EXISTS (SELECT 1 FROM json_tree(payload) node WHERE
        (node.type = 'text' AND ${malformedUnicodeSql('node.value')}) OR
        (typeof(node.key) = 'text' AND ${malformedUnicodeSql('node.key')}))) OR
    EXISTS (SELECT 1 FROM json_each(payload, '$.reports') r WHERE
      ${blankJsonTextSql('r', 'title')} OR
      ${invalidJsonTimestampSql('r', 'createdAt')} OR
      ${blankJsonTextSql('r', 'createdBy')} OR
      ${blankJsonTextSql('r', 'fileId')}) OR
    EXISTS (SELECT 1 FROM json_each(payload, '$.files') f WHERE
      ${blankJsonTextSql('f', 'id')} OR ${blankJsonTextSql('f', 'name')} OR
      ${blankJsonTextSql('f', 'contentType')} OR ${blankJsonTextSql('f', 'key')} OR
      ${invalidJsonTimestampSql('f', 'createdAt')} OR ${blankJsonTextSql('f', 'purpose')} OR
      json_extract(f.value, '$.purpose') NOT IN (${storedFlowFilePurposesSql}) OR
      json_extract(f.value, '$.key') <> ${sqlTextLiteral(FLOW_FILE_STORAGE_PREFIX)} ||
        json_extract(f.value, '$.id') OR
      NOT EXISTS (SELECT 1 FROM json_each(${storedFlowFileFormatRulesSql}) file_format WHERE
        json_extract(file_format.value, '$.purpose') = json_extract(f.value, '$.purpose') AND
        substr(lower(json_extract(f.value, '$.name')),
          -(length(json_extract(file_format.value, '$.extension')) + 1)) =
          '.' || json_extract(file_format.value, '$.extension') AND
        json_extract(file_format.value, '$.contentType') = json_extract(f.value, '$.contentType')) OR
      json_extract(f.value, '$.size') NOT BETWEEN 1 AND ${storedFlowFileSizeLimitSql} OR
      ${blankJsonTextSql('f', 'intakeFileId')} OR ${blankJsonTextSql('f', 'intakeSourceHash')} OR
      ${blankJsonTextSql('f', 'sourceReviewedBy')} OR
      ${invalidOptionalJsonTimestampSql('f', 'sourceReviewedAt')}) OR
    EXISTS (SELECT 1 FROM json_each(payload, '$.recordings') r WHERE
      ${blankJsonTextSql('r', 'id')} OR ${blankJsonTextSql('r', 'meetingId')} OR
      ${blankJsonTextSql('r', 'fileId')} OR ${blankJsonTextSql('r', 'transcriptFileId')} OR
      ${blankJsonTextSql('r', 'audioFileId')} OR ${blankJsonTextSql('r', 'transcriptReviewedBy')} OR
      ${invalidJsonTimestampSql('r', 'consentAt')} OR ${invalidJsonTimestampSql('r', 'createdAt')} OR
      ${invalidOptionalJsonTimestampSql('r', 'transcriptReviewedAt')}) OR
    EXISTS (SELECT 1 FROM json_each(payload, '$.jobs') j WHERE
      ${blankJsonTextSql('j', 'id')} OR ${invalidJsonTimestampSql('j', 'createdAt')} OR
      ${blankJsonTextSql('j', 'sourceRecordingId')} OR ${blankJsonTextSql('j', 'sourceReportId')} OR
      ${blankJsonTextSql('j', 'reportId')} OR ${invalidOptionalJsonTimestampSql('j', 'startedAt')} OR
      ${invalidOptionalJsonTimestampSql('j', 'completedAt')} OR
      (json_type(j.value, '$.startedAt') IS NOT NULL AND
        julianday(json_extract(j.value, '$.startedAt')) < julianday(json_extract(j.value, '$.createdAt'))) OR
      (json_type(j.value, '$.completedAt') IS NOT NULL AND
        (json_type(j.value, '$.startedAt') IS NULL OR
          julianday(json_extract(j.value, '$.completedAt')) < julianday(json_extract(j.value, '$.startedAt'))))) OR
    EXISTS (SELECT 1 FROM json_each(payload, '$.audit') a WHERE
      ${blankJsonTextSql('a', 'id')} OR ${invalidJsonTimestampSql('a', 'at')} OR
      ${blankJsonTextSql('a', 'actor')} OR ${blankJsonTextSql('a', 'action')} OR
      ${blankJsonTextSql('a', 'detail')}) OR
    EXISTS (SELECT 1 FROM json_each(payload, '$.commandIds') command WHERE
      ${blankSqlText('command.value')}) OR
    EXISTS (SELECT 1 FROM json_each(payload, '$.commandReceipts') receipt WHERE
      ${blankSqlText('receipt.key')} OR ${blankJsonTextSql('receipt', 'actorKey')} OR
      ${blankJsonTextSql('receipt', 'fingerprint')})
  ELSE 0 END LIMIT 1`;
// Evidence checks stay isolated so the broad dashboard projection remains below D1's expression-depth limit.
const invalidFlowAiFailureEvidenceSql = (expression: string) =>
  `json_type(${expression}) <> 'object' OR
    ${unexpectedJsonKeysSql(expression, FLOW_OBJECT_KEYS.jobFailureEvidence)} OR
    COALESCE(json_type(${expression}, '$.auditId'), '') <> 'text' OR
    length(json_extract(${expression}, '$.auditId')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.id} OR
    json_extract(${expression}, '$.auditId') <> trim(json_extract(${expression}, '$.auditId')) OR
    COALESCE(json_type(${expression}, '$.instructionVersion'), '') <> 'text' OR
    length(json_extract(${expression}, '$.instructionVersion')) NOT BETWEEN 1 AND ${FLOW_AI_EVIDENCE_LIMITS.instructionVersion} OR
    json_extract(${expression}, '$.instructionVersion') <> trim(json_extract(${expression}, '$.instructionVersion')) OR
    COALESCE(json_type(${expression}, '$.requestedModel'), '') <> 'text' OR
    length(json_extract(${expression}, '$.requestedModel')) NOT BETWEEN 1 AND ${FLOW_AI_EVIDENCE_LIMITS.model} OR
    json_extract(${expression}, '$.requestedModel') <> trim(json_extract(${expression}, '$.requestedModel')) OR
    COALESCE(json_type(${expression}, '$.httpStatus'), '') <> 'integer' OR
    json_extract(${expression}, '$.httpStatus') NOT BETWEEN 400 AND 599 OR
    COALESCE(json_type(${expression}, '$.observedAt'), '') <> 'text' OR
    length(json_extract(${expression}, '$.observedAt')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.timestamp} OR
    julianday(json_extract(${expression}, '$.observedAt')) IS NULL OR
    (json_type(${expression}, '$.providerRequestId') IS NOT NULL AND
      (json_type(${expression}, '$.providerRequestId') <> 'text' OR
        length(json_extract(${expression}, '$.providerRequestId')) NOT BETWEEN 1 AND ${FLOW_AI_EVIDENCE_LIMITS.providerRequestId} OR
        json_extract(${expression}, '$.providerRequestId') <> trim(json_extract(${expression}, '$.providerRequestId'))))`;
const flowAiSuccessEvidenceViolationSql = `SELECT 1 AS invalid FROM consulting_flows
  WHERE CASE WHEN json_valid(payload) AND json_type(payload, '$.jobs') = 'array' THEN
    EXISTS (SELECT 1 FROM json_each(payload, '$.jobs') j WHERE
      (json_type(j.value, '$.evidence') IS NOT NULL AND
        (json_type(j.value, '$.evidence') <> 'object' OR
          ${unexpectedJsonKeysSql(
            "json_extract(j.value, '$.evidence')",
            FLOW_OBJECT_KEYS.jobEvidence,
          )} OR
          COALESCE(json_type(j.value, '$.evidence.auditId'), '') <> 'text' OR
          length(json_extract(j.value, '$.evidence.auditId')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.id} OR
          json_extract(j.value, '$.evidence.auditId') <> trim(json_extract(j.value, '$.evidence.auditId')) OR
          COALESCE(json_type(j.value, '$.evidence.instructionVersion'), '') <> 'text' OR
          length(json_extract(j.value, '$.evidence.instructionVersion')) NOT BETWEEN 1 AND ${FLOW_AI_EVIDENCE_LIMITS.instructionVersion} OR
          json_extract(j.value, '$.evidence.instructionVersion') <> trim(json_extract(j.value, '$.evidence.instructionVersion')) OR
          COALESCE(json_type(j.value, '$.evidence.requestedModel'), '') <> 'text' OR
          length(json_extract(j.value, '$.evidence.requestedModel')) NOT BETWEEN 1 AND ${FLOW_AI_EVIDENCE_LIMITS.model} OR
          json_extract(j.value, '$.evidence.requestedModel') <> trim(json_extract(j.value, '$.evidence.requestedModel')) OR
          COALESCE(json_type(j.value, '$.evidence.providerRequestId'), '') <> 'text' OR
          length(json_extract(j.value, '$.evidence.providerRequestId')) NOT BETWEEN 1 AND ${FLOW_AI_EVIDENCE_LIMITS.providerRequestId} OR
          json_extract(j.value, '$.evidence.providerRequestId') <> trim(json_extract(j.value, '$.evidence.providerRequestId')) OR
          COALESCE(json_type(j.value, '$.evidence.providerModel'), '') <> 'text' OR
          length(json_extract(j.value, '$.evidence.providerModel')) NOT BETWEEN 1 AND ${FLOW_AI_EVIDENCE_LIMITS.model} OR
          json_extract(j.value, '$.evidence.providerModel') <> trim(json_extract(j.value, '$.evidence.providerModel')) OR
          COALESCE(json_type(j.value, '$.evidence.providerMessageId'), '') <> 'text' OR
          length(json_extract(j.value, '$.evidence.providerMessageId')) NOT BETWEEN 1 AND ${FLOW_AI_EVIDENCE_LIMITS.providerMessageId} OR
          json_extract(j.value, '$.evidence.providerMessageId') <> trim(json_extract(j.value, '$.evidence.providerMessageId')) OR
          COALESCE(json_type(j.value, '$.evidence.inputTokens'), '') <> 'integer' OR
          json_extract(j.value, '$.evidence.inputTokens') NOT BETWEEN 1 AND 9007199254740991 OR
          COALESCE(json_type(j.value, '$.evidence.outputTokens'), '') <> 'integer' OR
          json_extract(j.value, '$.evidence.outputTokens') NOT BETWEEN 1 AND 9007199254740991)) OR
      (json_extract(j.value, '$.status') <> 'complete' AND
        json_type(j.value, '$.evidence') IS NOT NULL) OR
      (json_type(j.value, '$.evidence') IS NOT NULL AND
        (COALESCE(json_type(j.value, '$.evidence.observedAt'), '') <> 'text' OR
          length(json_extract(j.value, '$.evidence.observedAt')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.timestamp} OR
          julianday(json_extract(j.value, '$.evidence.observedAt')) IS NULL OR
          julianday(json_extract(j.value, '$.evidence.observedAt')) <
            julianday(json_extract(j.value, '$.startedAt')) OR
          julianday(json_extract(j.value, '$.evidence.observedAt')) >
            julianday(json_extract(j.value, '$.completedAt')))))
  ELSE 0 END LIMIT 1`;
const flowAiFailureEvidenceViolationSql = `SELECT 1 AS invalid FROM consulting_flows
  WHERE CASE WHEN json_valid(payload) AND json_type(payload, '$.jobs') = 'array' THEN
    EXISTS (SELECT 1 FROM json_each(payload, '$.jobs') j WHERE
      (json_type(j.value, '$.failureEvidence') IS NOT NULL AND
        (${invalidFlowAiFailureEvidenceSql(
          "json_extract(j.value, '$.failureEvidence')",
        )})) OR
      (json_extract(j.value, '$.status') <> 'failed' AND
        json_type(j.value, '$.failureEvidence') IS NOT NULL) OR
      (json_type(j.value, '$.failureEvidence') IS NOT NULL AND
        julianday(json_extract(j.value, '$.failureEvidence.observedAt')) <
          julianday(json_extract(j.value, '$.startedAt'))) OR
      (json_type(j.value, '$.failureEvidence') IS NOT NULL AND
        julianday(json_extract(j.value, '$.failureEvidence.observedAt')) >
          julianday(json_extract(payload, '$.updatedAt'))) OR
      (json_type(j.value, '$.failureEvidenceHistory') IS NOT NULL AND
        (json_type(j.value, '$.failureEvidenceHistory') <> 'array' OR
          json_array_length(j.value, '$.failureEvidenceHistory') NOT BETWEEN 1 AND ${FLOW_COLLECTION_LIMITS.aiFailureEvidenceHistory} OR
          EXISTS (SELECT 1 FROM json_each(j.value, '$.failureEvidenceHistory') history WHERE
            ${invalidFlowAiFailureEvidenceSql('history.value')} OR
            julianday(json_extract(history.value, '$.observedAt')) <
              julianday(json_extract(j.value, '$.createdAt')) OR
            julianday(json_extract(history.value, '$.observedAt')) >
              julianday(json_extract(payload, '$.updatedAt'))) OR
          EXISTS (SELECT 1 FROM json_each(j.value, '$.failureEvidenceHistory') history
            JOIN json_each(j.value, '$.failureEvidenceHistory') previous
              ON previous.key = history.key - 1
            WHERE julianday(json_extract(history.value, '$.observedAt')) <
              julianday(json_extract(previous.value, '$.observedAt'))))))
  ELSE 0 END LIMIT 1`;
const flowAiSuccessAuditViolationSql = `SELECT 1 AS invalid FROM consulting_flows
  WHERE CASE WHEN json_valid(payload) AND json_type(payload, '$.jobs') = 'array' AND
    json_type(payload, '$.audit') = 'array' THEN
    EXISTS (SELECT 1 FROM json_each(payload, '$.jobs') j WHERE
      (json_type(j.value, '$.evidence') IS NOT NULL AND
        ((SELECT count(*) FROM json_each(payload, '$.audit') audit WHERE
          json_extract(audit.value, '$.id') = json_extract(j.value, '$.evidence.auditId') AND
          json_extract(audit.value, '$.id') = json_extract(j.value, '$.id') || '-' || json_extract(audit.value, '$.at') AND
          json_extract(audit.value, '$.actor') = '보고서 자동생성' AND
          json_extract(audit.value, '$.action') = 'ai_result' AND
          json_extract(audit.value, '$.at') = json_extract(j.value, '$.completedAt') AND
          julianday(json_extract(audit.value, '$.at')) >=
            julianday(json_extract(j.value, '$.evidence.observedAt')) AND
          julianday(json_extract(audit.value, '$.at')) <=
            julianday(json_extract(payload, '$.updatedAt'))) <> 1 OR
        EXISTS (SELECT 1 FROM json_each(j.value, '$.failureEvidenceHistory') history
          WHERE json_extract(history.value, '$.auditId') =
            json_extract(j.value, '$.evidence.auditId')))))
  ELSE 0 END LIMIT 1`;
const flowAiFailureAuditViolationSql = `SELECT 1 AS invalid FROM consulting_flows
  WHERE CASE WHEN json_valid(payload) AND json_type(payload, '$.jobs') = 'array' AND
    json_type(payload, '$.audit') = 'array' THEN
    EXISTS (SELECT 1 FROM json_each(payload, '$.jobs') j WHERE
      (json_type(j.value, '$.failureEvidence') IS NOT NULL AND
        ((SELECT count(*) FROM json_each(payload, '$.audit') audit WHERE
          json_extract(audit.value, '$.id') = json_extract(j.value, '$.failureEvidence.auditId') AND
          json_extract(audit.value, '$.id') = json_extract(j.value, '$.id') || '-' || json_extract(audit.value, '$.at') AND
          json_extract(audit.value, '$.actor') = '보고서 자동생성' AND
          json_extract(audit.value, '$.action') = 'ai_result' AND
          julianday(json_extract(audit.value, '$.at')) >=
            julianday(json_extract(j.value, '$.failureEvidence.observedAt')) AND
          julianday(json_extract(audit.value, '$.at')) <=
            julianday(json_extract(payload, '$.updatedAt'))) <> 1 OR
        EXISTS (SELECT 1 FROM json_each(j.value, '$.failureEvidenceHistory') history
          WHERE json_extract(history.value, '$.auditId') =
            json_extract(j.value, '$.failureEvidence.auditId')))) OR
      (json_type(j.value, '$.failureEvidenceHistory') = 'array' AND
        (EXISTS (SELECT 1 FROM json_each(j.value, '$.failureEvidenceHistory') history WHERE
          (SELECT count(*) FROM json_each(payload, '$.audit') audit WHERE
            json_extract(audit.value, '$.id') = json_extract(history.value, '$.auditId') AND
            json_extract(audit.value, '$.id') = json_extract(j.value, '$.id') || '-' || json_extract(audit.value, '$.at') AND
            json_extract(audit.value, '$.actor') = '보고서 자동생성' AND
            json_extract(audit.value, '$.action') = 'ai_result' AND
            julianday(json_extract(audit.value, '$.at')) >=
              julianday(json_extract(history.value, '$.observedAt')) AND
            julianday(json_extract(audit.value, '$.at')) <=
              julianday(json_extract(payload, '$.updatedAt'))) <> 1) OR
        EXISTS (SELECT 1 FROM json_each(j.value, '$.failureEvidenceHistory') history
          JOIN json_each(j.value, '$.failureEvidenceHistory') duplicate
            ON duplicate.key < history.key
          WHERE json_extract(duplicate.value, '$.auditId') =
            json_extract(history.value, '$.auditId')))))
  ELSE 0 END LIMIT 1`;
const flowFileOwnershipViolationSql = (
  caseIdOnly: boolean,
) => `SELECT 1 AS invalid
  FROM consulting_flows flow,
    json_each(CASE WHEN json_valid(flow.payload) THEN flow.payload ELSE '{"files":[]}' END, '$.files') file
  LEFT JOIN consulting_flow_file_owners owner
    ON owner.file_id = json_extract(file.value, '$.id')
  LEFT JOIN consulting_flow_file_metadata metadata
    ON metadata.file_id = json_extract(file.value, '$.id')
  LEFT JOIN consulting_flow_file_object_integrity object_integrity
    ON object_integrity.file_id = json_extract(file.value, '$.id')
  WHERE ${caseIdOnly ? 'flow.case_id = ?1 AND ' : ''}(
    owner.file_id IS NULL OR owner.case_id IS NOT flow.case_id OR
    owner.storage_key IS NOT json_extract(file.value, '$.key') OR
    owner.created_at IS NOT json_extract(file.value, '$.createdAt') OR
    metadata.file_id IS NULL OR
    metadata.original_name IS NOT json_extract(file.value, '$.name') OR
    metadata.content_type IS NOT json_extract(file.value, '$.contentType') OR
    metadata.size_bytes IS NOT json_extract(file.value, '$.size') OR
    metadata.purpose IS NOT json_extract(file.value, '$.purpose') OR
    metadata.intake_file_id IS NOT json_extract(file.value, '$.intakeFileId') OR
    metadata.intake_source_hash IS NOT json_extract(file.value, '$.intakeSourceHash') OR
    metadata.source_reviewed_at IS NOT json_extract(file.value, '$.sourceReviewedAt') OR
    metadata.source_reviewed_by IS NOT json_extract(file.value, '$.sourceReviewedBy') OR
    object_integrity.file_id IS NULL OR
    object_integrity.r2_content_type IS NOT metadata.content_type OR
    object_integrity.validation_mode NOT IN ('metadata', 'etag') OR
    (object_integrity.validation_mode = 'metadata' AND object_integrity.r2_etag IS NOT NULL) OR
    (object_integrity.validation_mode = 'etag' AND
      (typeof(object_integrity.r2_etag) <> 'text' OR
        length(object_integrity.r2_etag) NOT BETWEEN 1 AND 256)))
  LIMIT 1`;
const claimFlowFileOwnershipSql = `INSERT INTO consulting_flow_file_owners
    (file_id, case_id, storage_key, created_at)
  SELECT ?1, ?2, ?3, ?4
  WHERE EXISTS (SELECT 1 FROM consulting_flows
      WHERE case_id = ?2 AND revision = ?5 AND payload = ?6)
    AND NOT EXISTS (SELECT 1 FROM consulting_flow_file_owners
      WHERE file_id = ?1 OR storage_key = ?3)
  UNION ALL
  SELECT NULL, ?2, ?3, ?4
  WHERE NOT EXISTS (SELECT 1 FROM consulting_flows
      WHERE case_id = ?2 AND revision = ?5 AND payload = ?6)
    OR EXISTS (SELECT 1 FROM consulting_flow_file_owners
      WHERE (file_id = ?1 OR storage_key = ?3)
        AND NOT (file_id = ?1 AND case_id = ?2 AND storage_key = ?3 AND
          created_at = ?4))`;
const claimFlowFileMetadataSql = `INSERT INTO consulting_flow_file_metadata
    (file_id, original_name, content_type, size_bytes, purpose, intake_file_id,
      intake_source_hash, source_reviewed_at, source_reviewed_by)
  SELECT ?1, ?4, ?5, ?6, ?8, ?9, ?10, ?11, ?12
  WHERE EXISTS (SELECT 1 FROM consulting_flows
      WHERE case_id = ?2 AND revision = ?13 AND payload = ?14)
    AND EXISTS (SELECT 1 FROM consulting_flow_file_owners
      WHERE file_id = ?1 AND case_id = ?2 AND storage_key = ?3 AND created_at = ?7)
    AND NOT EXISTS (SELECT 1 FROM consulting_flow_file_metadata WHERE file_id = ?1)
  UNION ALL
  SELECT NULL, ?4, ?5, ?6, ?8, ?9, ?10, ?11, ?12
  WHERE NOT EXISTS (SELECT 1 FROM consulting_flows
      WHERE case_id = ?2 AND revision = ?13 AND payload = ?14)
    OR NOT EXISTS (SELECT 1 FROM consulting_flow_file_owners
      WHERE file_id = ?1 AND case_id = ?2 AND storage_key = ?3 AND created_at = ?7)
    OR EXISTS (SELECT 1 FROM consulting_flow_file_metadata WHERE file_id = ?1 AND
      NOT (original_name = ?4 AND content_type = ?5 AND size_bytes = ?6 AND
        purpose = ?8 AND intake_file_id IS ?9 AND intake_source_hash IS ?10 AND
        source_reviewed_at IS ?11 AND source_reviewed_by IS ?12))`;
const transitionFlowFilePurposeSql = `INSERT INTO consulting_flow_file_metadata
    (file_id, original_name, content_type, size_bytes, purpose, intake_file_id,
      intake_source_hash, source_reviewed_at, source_reviewed_by)
  SELECT CASE WHEN
    EXISTS (SELECT 1 FROM consulting_flows
      WHERE case_id = ?2 AND revision = ?14 AND payload = ?15) AND
    EXISTS (SELECT 1 FROM consulting_flow_file_owners WHERE file_id = ?1 AND
      case_id = ?2 AND storage_key = ?3 AND created_at = ?7) AND
    EXISTS (SELECT 1 FROM consulting_flow_file_metadata WHERE
      file_id = ?1 AND
      original_name = ?4 AND content_type = ?5 AND size_bytes = ?6 AND purpose = ?8 AND
      intake_file_id IS ?10 AND
      intake_source_hash IS ?11 AND source_reviewed_at IS ?12 AND
      source_reviewed_by IS ?13)
    THEN ?1 ELSE NULL END,
    ?4, ?5, ?6, ?9, ?10, ?11, ?12, ?13
  ON CONFLICT(file_id) DO UPDATE SET purpose = excluded.purpose`;
const claimFlowFileObjectIntegritySql = `INSERT INTO consulting_flow_file_object_integrity
    (file_id, validation_mode, r2_etag, r2_content_type)
  SELECT ?1, 'etag', ?15, ?5
  WHERE EXISTS (SELECT 1 FROM consulting_flows
      WHERE case_id = ?2 AND revision = ?13 AND payload = ?14)
    AND EXISTS (SELECT 1 FROM consulting_flow_file_owners
      WHERE file_id = ?1 AND case_id = ?2 AND storage_key = ?3 AND created_at = ?7)
    AND EXISTS (SELECT 1 FROM consulting_flow_file_metadata WHERE file_id = ?1 AND
      original_name = ?4 AND content_type = ?5 AND size_bytes = ?6 AND
      purpose = ?8 AND intake_file_id IS ?9 AND intake_source_hash IS ?10 AND
      source_reviewed_at IS ?11 AND source_reviewed_by IS ?12)
    AND NOT EXISTS (SELECT 1 FROM consulting_flow_file_object_integrity WHERE file_id = ?1)
  UNION ALL
  SELECT NULL, 'etag', ?15, ?5
  WHERE NOT EXISTS (SELECT 1 FROM consulting_flows
      WHERE case_id = ?2 AND revision = ?13 AND payload = ?14)
    OR NOT EXISTS (SELECT 1 FROM consulting_flow_file_owners
      WHERE file_id = ?1 AND case_id = ?2 AND storage_key = ?3 AND created_at = ?7)
    OR NOT EXISTS (SELECT 1 FROM consulting_flow_file_metadata WHERE file_id = ?1 AND
      original_name = ?4 AND content_type = ?5 AND size_bytes = ?6 AND
      purpose = ?8 AND intake_file_id IS ?9 AND intake_source_hash IS ?10 AND
      source_reviewed_at IS ?11 AND source_reviewed_by IS ?12)
    OR EXISTS (SELECT 1 FROM consulting_flow_file_object_integrity WHERE file_id = ?1)`;
function flowFileOwnershipValues(file: FlowFile) {
  return [
    file.id,
    file.key,
    file.name,
    file.contentType,
    file.size,
    file.createdAt,
    file.purpose,
    file.intakeFileId ?? null,
    file.intakeSourceHash ?? null,
    file.sourceReviewedAt ?? null,
    file.sourceReviewedBy ?? null,
  ] as const;
}
function validFlowFileObjectBinding(
  file: FlowFile,
  binding: FlowFileObjectBinding | undefined,
): binding is FlowFileObjectBinding {
  return (
    binding !== undefined &&
    typeof binding.etag === 'string' &&
    binding.etag.trim().length > 0 &&
    binding.etag.length <= 256 &&
    binding.contentType === file.contentType
  );
}
export function flowFileObjectBinding(
  file: FlowFile,
  object: R2Object,
): FlowFileObjectBinding {
  if (
    object.key !== file.key ||
    object.size !== file.size ||
    object.httpMetadata?.contentType !== file.contentType ||
    typeof object.etag !== 'string' ||
    !object.etag.trim() ||
    object.etag.length > 256
  )
    throw new FlowError(
      '첨부파일을 보안 저장소에 안전하게 기록하지 못했습니다.',
      503,
    );
  return { etag: object.etag, contentType: file.contentType };
}
export function flowFileObjectMatchesIntegrity(
  file: FlowFile,
  object: R2Object,
  integrity: FlowFileObjectIntegrity,
) {
  return (
    object.key === file.key &&
    object.size === file.size &&
    object.httpMetadata?.contentType === integrity.contentType &&
    integrity.contentType === file.contentType &&
    (integrity.validationMode === 'metadata' || object.etag === integrity.etag)
  );
}
export async function readFlowFileObjectIntegrity(
  caseId: string,
  file: FlowFile,
): Promise<FlowFileObjectIntegrity> {
  const row = await (
    await flowDatabase()
  )
    .prepare(
      `SELECT object_integrity.validation_mode, object_integrity.r2_etag,
        object_integrity.r2_content_type
      FROM consulting_flow_file_owners owner
      JOIN consulting_flow_file_metadata metadata ON metadata.file_id = owner.file_id
      JOIN consulting_flow_file_object_integrity object_integrity
        ON object_integrity.file_id = owner.file_id
      WHERE owner.file_id = ?1 AND owner.case_id = ?2 AND owner.storage_key = ?3 AND
        owner.created_at = ?4 AND metadata.original_name = ?5 AND
        metadata.content_type = ?6 AND metadata.size_bytes = ?7 AND
        metadata.purpose = ?8 AND metadata.intake_file_id IS ?9 AND
        metadata.intake_source_hash IS ?10 AND metadata.source_reviewed_at IS ?11 AND
        metadata.source_reviewed_by IS ?12`,
    )
    .bind(
      file.id,
      caseId,
      file.key,
      file.createdAt,
      file.name,
      file.contentType,
      file.size,
      file.purpose,
      file.intakeFileId ?? null,
      file.intakeSourceHash ?? null,
      file.sourceReviewedAt ?? null,
      file.sourceReviewedBy ?? null,
    )
    .first<StoredFlowFileObjectIntegrityRow>();
  if (
    !row ||
    row.r2_content_type !== file.contentType ||
    (row.validation_mode !== 'metadata' && row.validation_mode !== 'etag') ||
    (row.validation_mode === 'metadata'
      ? row.r2_etag !== null
      : typeof row.r2_etag !== 'string' ||
        !row.r2_etag.trim() ||
        row.r2_etag.length > 256)
  )
    throw storedFlowIntegrityError();
  return {
    validationMode: row.validation_mode,
    etag: row.r2_etag,
    contentType: row.r2_content_type,
  };
}
function storedFlowFromRow(
  row: StoredFlowRow,
  expectedCaseId?: string,
  projected = false,
): ConsultingFlow {
  let value: unknown;
  try {
    value = typeof row.payload === 'string' ? JSON.parse(row.payload) : null;
  } catch {
    throw storedFlowIntegrityError();
  }
  if (
    !(projected
      ? hasProjectedConsultingFlowStructure(value)
      : hasStoredConsultingFlowStructure(value))
  )
    throw storedFlowIntegrityError();
  const flow = value as ConsultingFlow;
  if (
    flow.schemaVersion !== 1 ||
    typeof row.case_id !== 'string' ||
    !row.case_id ||
    typeof row.partner_id !== 'string' ||
    !row.partner_id ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 0 ||
    flow.caseId !== row.case_id ||
    (expectedCaseId !== undefined && flow.caseId !== expectedCaseId) ||
    flow.partnerId !== row.partner_id ||
    !Number.isSafeInteger(flow.revision) ||
    flow.revision !== row.revision ||
    !validFlowTimestamp(row.updated_at) ||
    !validFlowTimestamp(flow.updatedAt) ||
    flow.updatedAt !== row.updated_at
  )
    throw storedFlowIntegrityError();
  return flow;
}
export async function readFlow(caseId: string): Promise<ConsultingFlow | null> {
  const database = await flowDatabase();
  const batch = await database.batch([
    database
      .prepare(
        'SELECT case_id, partner_id, revision, updated_at, payload FROM consulting_flows WHERE case_id = ?1',
      )
      .bind(caseId),
    database.prepare(flowFileOwnershipViolationSql(true)).bind(caseId),
  ]);
  const row = (batch[0] as D1Result<StoredFlowRow>).results[0];
  if ((batch[1] as D1Result<{ invalid: number }>).results.length > 0)
    throw storedFlowIntegrityError();
  return row ? storedFlowFromRow(row, caseId) : null;
}
export async function stateWithConsultingFlows(raw: unknown) {
  if (raw !== null && !hasPortalStateStructure(raw))
    throw new FlowError(
      '저장된 운영 데이터 구조를 확인할 수 없습니다. 관리자 복구가 필요합니다.',
      503,
    );
  const database = await flowDatabase();
  const batch = await database.batch([
    database.prepare(hiddenFlowSemanticViolationSql),
    database.prepare(flowAiSuccessEvidenceViolationSql),
    database.prepare(flowAiFailureEvidenceViolationSql),
    database.prepare(flowAiSuccessAuditViolationSql),
    database.prepare(flowAiFailureAuditViolationSql),
    database.prepare(flowFileOwnershipViolationSql(false)),
    database.prepare(`SELECT case_id,
      (SELECT json_group_array(json_extract(f.value, '$.name'))
        FROM json_each(payload, '$.files') f) AS names
      FROM consulting_flows
      WHERE json_valid(payload) AND json_type(payload, '$.files') = 'array'`),
    // Project inside SQLite: a dashboard refresh must not load every firm's report or transcript.
    database.prepare(`SELECT case_id, partner_id, revision, updated_at,
      CASE WHEN json_valid(payload) THEN CASE WHEN
        json_type(payload, '$.schemaVersion') = 'integer' AND
        json_type(payload, '$.caseId') = 'text' AND json_type(payload, '$.company') = 'text' AND
        json_type(payload, '$.partnerId') = 'text' AND json_type(payload, '$.partnerName') = 'text' AND
        json_type(payload, '$.revision') = 'integer' AND json_type(payload, '$.updatedAt') = 'text' AND
        json_type(payload, '$.reports') = 'array' AND json_type(payload, '$.files') = 'array' AND
        json_type(payload, '$.meetings') = 'array' AND json_type(payload, '$.recordings') = 'array' AND
        json_type(payload, '$.requests') = 'array' AND json_type(payload, '$.payments') = 'array' AND
        json_type(payload, '$.jobs') = 'array' AND json_type(payload, '$.audit') = 'array' AND
        json_type(payload, '$.commandIds') = 'array' AND json_type(payload, '$.analysis') = 'object' AND
        json_array_length(payload, '$.reports') <= ${FLOW_COLLECTION_LIMITS.reports} AND
        json_array_length(payload, '$.files') <= ${FLOW_COLLECTION_LIMITS.files} AND
        json_array_length(payload, '$.meetings') <= ${FLOW_COLLECTION_LIMITS.meetings} AND
        json_array_length(payload, '$.recordings') <= ${FLOW_COLLECTION_LIMITS.recordings} AND
        json_array_length(payload, '$.requests') <= ${FLOW_COLLECTION_LIMITS.requests} AND
        json_array_length(payload, '$.payments') <= ${FLOW_COLLECTION_LIMITS.payments} AND
        json_array_length(payload, '$.jobs') <= ${FLOW_COLLECTION_LIMITS.jobs} AND
        json_array_length(payload, '$.audit') <= ${FLOW_COLLECTION_LIMITS.audit} AND
        json_array_length(payload, '$.commandIds') <= ${FLOW_COLLECTION_LIMITS.commandIds} AND
        (SELECT COUNT(*) FROM json_each(payload, '$.commandReceipts')) <= ${FLOW_COLLECTION_LIMITS.commandReceipts} AND
        COALESCE(json_type(payload, '$.ai.sourceText'), '') = 'text' AND
        length(json_extract(payload, '$.ai.sourceText')) <= ${FLOW_TEXT_LIMITS.aiSourceText} AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.reports') e WHERE e.type <> 'object') AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.files') e WHERE e.type <> 'object') AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.meetings') e WHERE e.type <> 'object') AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.recordings') e WHERE e.type <> 'object') AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.requests') e WHERE e.type <> 'object') AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.payments') e WHERE e.type <> 'object') AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.jobs') e WHERE e.type <> 'object') AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.audit') e WHERE e.type <> 'object') AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.commandIds') e WHERE e.type <> 'text') AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.reports') r WHERE
          COALESCE(json_type(r.value, '$.version'), '') <> 'integer' OR json_extract(r.value, '$.version') NOT BETWEEN 1 AND 9007199254740991 OR
          COALESCE(json_type(r.value, '$.title'), '') <> 'text' OR length(json_extract(r.value, '$.title')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.reportTitle} OR
          COALESCE(json_type(r.value, '$.body'), '') <> 'text' OR length(json_extract(r.value, '$.body')) > ${FLOW_TEXT_LIMITS.reportBody} OR
          COALESCE(json_type(r.value, '$.createdAt'), '') <> 'text' OR length(json_extract(r.value, '$.createdAt')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.timestamp} OR
          COALESCE(json_type(r.value, '$.createdBy'), '') <> 'text' OR length(json_extract(r.value, '$.createdBy')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.actor} OR
          COALESCE(json_type(r.value, '$.origin'), '') <> 'text' OR json_extract(r.value, '$.origin') NOT IN ('manual', 'ai') OR
          (json_type(r.value, '$.fileId') IS NOT NULL AND
            (json_type(r.value, '$.fileId') <> 'text' OR length(json_extract(r.value, '$.fileId')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.id}))) AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.files') f WHERE
          COALESCE(json_type(f.value, '$.id'), '') <> 'text' OR length(json_extract(f.value, '$.id')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.id} OR
          COALESCE(json_type(f.value, '$.name'), '') <> 'text' OR length(json_extract(f.value, '$.name')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.fileName} OR
          COALESCE(json_type(f.value, '$.contentType'), '') <> 'text' OR length(json_extract(f.value, '$.contentType')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.fileContentType} OR
          COALESCE(json_type(f.value, '$.size'), '') <> 'integer' OR json_extract(f.value, '$.size') NOT BETWEEN 0 AND 9007199254740991 OR
          COALESCE(json_type(f.value, '$.key'), '') <> 'text' OR length(json_extract(f.value, '$.key')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.fileKey} OR
          COALESCE(json_type(f.value, '$.createdAt'), '') <> 'text' OR length(json_extract(f.value, '$.createdAt')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.timestamp} OR
          COALESCE(json_type(f.value, '$.purpose'), '') <> 'text' OR length(json_extract(f.value, '$.purpose')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.filePurpose} OR
          EXISTS (SELECT 1 FROM json_each(json_array('intakeFileId', 'intakeSourceHash', 'sourceReviewedBy')) key WHERE
            json_type(f.value, '$.' || key.value) IS NOT NULL AND
            (json_type(f.value, '$.' || key.value) <> 'text' OR length(json_extract(f.value, '$.' || key.value)) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.fileMetadata})) OR
          (json_type(f.value, '$.sourceReviewedAt') IS NOT NULL AND
            (json_type(f.value, '$.sourceReviewedAt') <> 'text' OR length(json_extract(f.value, '$.sourceReviewedAt')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.timestamp}))) AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.recordings') r WHERE
          COALESCE(json_type(r.value, '$.id'), '') <> 'text' OR length(json_extract(r.value, '$.id')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.id} OR
          COALESCE(json_type(r.value, '$.meetingId'), '') <> 'text' OR length(json_extract(r.value, '$.meetingId')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.id} OR
          EXISTS (SELECT 1 FROM json_each(json_array('fileId', 'transcriptFileId', 'audioFileId', 'transcriptReviewedBy')) key WHERE
            json_type(r.value, '$.' || key.value) IS NOT NULL AND
            (json_type(r.value, '$.' || key.value) <> 'text' OR length(json_extract(r.value, '$.' || key.value)) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.id})) OR
          COALESCE(json_type(r.value, '$.transcript'), '') <> 'text' OR length(json_extract(r.value, '$.transcript')) > ${FLOW_TEXT_LIMITS.transcript} OR
          COALESCE(json_type(r.value, '$.consentAt'), '') <> 'text' OR length(json_extract(r.value, '$.consentAt')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.timestamp} OR
          COALESCE(json_type(r.value, '$.createdAt'), '') <> 'text' OR length(json_extract(r.value, '$.createdAt')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.timestamp} OR
          (json_type(r.value, '$.transcriptReviewedAt') IS NOT NULL AND
            (json_type(r.value, '$.transcriptReviewedAt') <> 'text' OR length(json_extract(r.value, '$.transcriptReviewedAt')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.timestamp}))) AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.jobs') j WHERE
          COALESCE(json_type(j.value, '$.id'), '') <> 'text' OR length(json_extract(j.value, '$.id')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.id} OR
          COALESCE(json_type(j.value, '$.stage'), '') <> 'integer' OR json_extract(j.value, '$.stage') NOT IN (1, 4) OR
          COALESCE(json_type(j.value, '$.reason'), '') <> 'text' OR length(json_extract(j.value, '$.reason')) > ${FLOW_TEXT_LIMITS.jobReason} OR
          COALESCE(json_type(j.value, '$.createdAt'), '') <> 'text' OR length(json_extract(j.value, '$.createdAt')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.timestamp} OR
          EXISTS (SELECT 1 FROM json_each(json_array('sourceRecordingId', 'sourceReportId', 'reportId')) key WHERE
            json_type(j.value, '$.' || key.value) IS NOT NULL AND
            (json_type(j.value, '$.' || key.value) <> 'text' OR length(json_extract(j.value, '$.' || key.value)) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.id})) OR
          EXISTS (SELECT 1 FROM json_each(json_array('startedAt', 'completedAt')) key WHERE
            json_type(j.value, '$.' || key.value) IS NOT NULL AND
            (json_type(j.value, '$.' || key.value) <> 'text' OR length(json_extract(j.value, '$.' || key.value)) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.timestamp}))) AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.audit') a WHERE
          COALESCE(json_type(a.value, '$.id'), '') <> 'text' OR length(json_extract(a.value, '$.id')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.id} OR
          COALESCE(json_type(a.value, '$.at'), '') <> 'text' OR length(json_extract(a.value, '$.at')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.timestamp} OR
          COALESCE(json_type(a.value, '$.actor'), '') <> 'text' OR length(json_extract(a.value, '$.actor')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.actor} OR
          COALESCE(json_type(a.value, '$.action'), '') <> 'text' OR length(json_extract(a.value, '$.action')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.auditAction} OR
          COALESCE(json_type(a.value, '$.detail'), '') <> 'text' OR length(json_extract(a.value, '$.detail')) NOT BETWEEN 1 AND ${FLOW_TEXT_LIMITS.auditDetail}) AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.commandIds') command WHERE
          length(command.value) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.id}) AND
        (SELECT COUNT(*) FROM json_each(payload, '$.files')) =
          (SELECT COUNT(DISTINCT json_extract(value, '$.id')) FROM json_each(payload, '$.files')) AND
        (SELECT COUNT(*) FROM json_each(payload, '$.jobs')) =
          (SELECT COUNT(DISTINCT json_extract(value, '$.id')) FROM json_each(payload, '$.jobs')) AND
        (SELECT COUNT(*) FROM json_each(payload, '$.audit')) =
          (SELECT COUNT(DISTINCT json_extract(value, '$.id')) FROM json_each(payload, '$.audit')) AND
        (SELECT COUNT(*) FROM json_each(payload, '$.commandIds')) =
          (SELECT COUNT(DISTINCT value) FROM json_each(payload, '$.commandIds')) AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.commandReceipts') receipt WHERE
          receipt.type <> 'object' OR length(receipt.key) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.id} OR
          COALESCE(json_type(receipt.value, '$.actorKey'), '') <> 'text' OR length(json_extract(receipt.value, '$.actorKey')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.receiptActorKey} OR
          COALESCE(json_type(receipt.value, '$.fingerprint'), '') <> 'text' OR length(json_extract(receipt.value, '$.fingerprint')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.receiptFingerprint} OR
          (json_type(receipt.value, '$.actor') IS NOT NULL AND (json_type(receipt.value, '$.actor') <> 'text' OR length(json_extract(receipt.value, '$.actor')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.actor})) OR
          (json_type(receipt.value, '$.action') IS NOT NULL AND (json_type(receipt.value, '$.action') <> 'text' OR length(json_extract(receipt.value, '$.action')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.auditAction}))) AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.reports') r WHERE
          json_type(r.value, '$.fileId') IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM json_each(payload, '$.files') f
            WHERE json_extract(f.value, '$.id') = json_extract(r.value, '$.fileId')
          )) AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.recordings') r WHERE
          NOT EXISTS (SELECT 1 FROM json_each(payload, '$.meetings') m
            WHERE json_extract(m.value, '$.id') = json_extract(r.value, '$.meetingId')) OR
          (json_type(r.value, '$.fileId') IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM json_each(payload, '$.files') f
            WHERE json_extract(f.value, '$.id') = json_extract(r.value, '$.fileId'))) OR
          (json_type(r.value, '$.transcriptFileId') IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM json_each(payload, '$.files') f
            WHERE json_extract(f.value, '$.id') = json_extract(r.value, '$.transcriptFileId'))) OR
          (json_type(r.value, '$.audioFileId') IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM json_each(payload, '$.files') f
            WHERE json_extract(f.value, '$.id') = json_extract(r.value, '$.audioFileId')))) AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.requests') r WHERE
          json_type(r.value, '$.fileId') IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM json_each(payload, '$.files') f
            WHERE json_extract(f.value, '$.id') = json_extract(r.value, '$.fileId')
          )) AND
        (json_type(payload, '$.contract') IS NULL OR EXISTS (
          SELECT 1 FROM json_each(payload, '$.files') f
          WHERE json_extract(f.value, '$.id') = json_extract(payload, '$.contract.signedFileId')
            AND json_extract(f.value, '$.purpose') = 'signed_contract'
        )) AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.jobs') j WHERE
          (json_type(j.value, '$.sourceRecordingId') IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM json_each(payload, '$.recordings') r
            WHERE json_extract(r.value, '$.id') = json_extract(j.value, '$.sourceRecordingId'))) OR
          (json_type(j.value, '$.sourceReportId') IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM json_each(payload, '$.reports') r
            WHERE json_extract(r.value, '$.id') = json_extract(j.value, '$.sourceReportId'))) OR
          (json_type(j.value, '$.reportId') IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM json_each(payload, '$.reports') r
            WHERE json_extract(r.value, '$.id') = json_extract(j.value, '$.reportId')))) AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.jobs') j WHERE
          CASE json_extract(j.value, '$.status')
            WHEN 'queued' THEN json_type(j.value, '$.startedAt') IS NOT NULL OR
              json_type(j.value, '$.completedAt') IS NOT NULL OR json_type(j.value, '$.reportId') IS NOT NULL
            WHEN 'processing' THEN COALESCE(json_type(j.value, '$.startedAt'), '') <> 'text' OR
              json_type(j.value, '$.completedAt') IS NOT NULL OR json_type(j.value, '$.reportId') IS NOT NULL
            WHEN 'blocked' THEN json_type(j.value, '$.completedAt') IS NOT NULL OR
              json_type(j.value, '$.reportId') IS NOT NULL
            WHEN 'failed' THEN COALESCE(json_type(j.value, '$.startedAt'), '') <> 'text' OR
              json_type(j.value, '$.completedAt') IS NOT NULL OR json_type(j.value, '$.reportId') IS NOT NULL
            WHEN 'complete' THEN COALESCE(json_type(j.value, '$.startedAt'), '') <> 'text' OR
              COALESCE(json_type(j.value, '$.completedAt'), '') <> 'text' OR
              COALESCE(json_type(j.value, '$.reportId'), '') <> 'text'
            ELSE 1
          END) AND
        NOT EXISTS (SELECT 1 FROM json_each(payload, '$.commandReceipts') receipt WHERE
          NOT EXISTS (SELECT 1 FROM json_each(payload, '$.commandIds') command
            WHERE command.value = receipt.key)) AND
        json_type(payload, '$.analysis.reportId') = 'text' AND json_type(payload, '$.ai') = 'object' AND
        json_type(payload, '$.ai.enabled') IN ('true', 'false') AND json_type(payload, '$.ai.sourceText') = 'text' AND
        (json_type(payload, '$.decision') IS NULL OR json_type(payload, '$.decision') = 'object') AND
        (json_type(payload, '$.contract') IS NULL OR json_type(payload, '$.contract') = 'object') AND
        (json_type(payload, '$.aftercare') IS NULL OR json_type(payload, '$.aftercare') = 'object') AND
        (json_type(payload, '$.executionStartedAt') IS NULL OR json_type(payload, '$.executionStartedAt') = 'text') AND
        (json_type(payload, '$.commandReceipts') IS NULL OR json_type(payload, '$.commandReceipts') = 'object')
      THEN json_set(
          json_remove(payload, '$.files', '$.ai.sourceText', '$.audit', '$.commandIds', '$.commandReceipts', '$.jobs'),
          '$.reports', json((SELECT json_group_array(json_object(
            'id', json_extract(r.value, '$.id'), 'stage', json_extract(r.value, '$.stage'),
            'sourceReportId', json_extract(r.value, '$.sourceReportId'), 'sourceRecordingId', json_extract(r.value, '$.sourceRecordingId'),
            'decisionId', json_extract(r.value, '$.decisionId'), 'documentsKey', json_extract(r.value, '$.documentsKey')
          )) FROM json_each(payload, '$.reports') r)),
          '$.recordings', json((SELECT json_group_array(json_object('id', json_extract(v.value, '$.id'))) FROM json_each(payload, '$.recordings') v))
        ) ELSE NULL END ELSE NULL END AS payload FROM consulting_flows`),
  ]);
  const semanticViolations = batch[0] as D1Result<{ invalid: number }>;
  const successEvidenceViolations = batch[1] as D1Result<{ invalid: number }>;
  const failureEvidenceViolations = batch[2] as D1Result<{ invalid: number }>;
  const successAuditViolations = batch[3] as D1Result<{ invalid: number }>;
  const failureAuditViolations = batch[4] as D1Result<{ invalid: number }>;
  const ownershipViolations = batch[5] as D1Result<{ invalid: number }>;
  const fileNameRows = batch[6] as D1Result<StoredFlowFileNamesRow>;
  const rows = batch[7] as D1Result<StoredFlowRow>;
  if (
    semanticViolations.results.length > 0 ||
    successEvidenceViolations.results.length > 0 ||
    failureEvidenceViolations.results.length > 0 ||
    successAuditViolations.results.length > 0 ||
    failureAuditViolations.results.length > 0 ||
    ownershipViolations.results.length > 0
  )
    throw storedFlowIntegrityError();
  for (const row of fileNameRows.results) {
    let names: unknown;
    try {
      names = JSON.parse(row.names);
    } catch {
      throw storedFlowIntegrityError();
    }
    if (
      !Array.isArray(names) ||
      !names.every((name) => storedFlowFileNameMatches(name))
    )
      throw storedFlowIntegrityError();
  }
  const projected = projectFlowState(
    raw,
    rows.results.map((row) => storedFlowFromRow(row, undefined, true)),
  );
  if (projected !== null && !hasPortalStateStructure(projected))
    throw new FlowError(
      '저장된 운영 데이터 구조를 확인할 수 없습니다. 관리자 복구가 필요합니다.',
      503,
    );
  return projected;
}
function assertFlowCommitTransition(
  before: ConsultingFlow,
  after: ConsultingFlow,
) {
  if (
    before.schemaVersion !== 1 ||
    after.schemaVersion !== 1 ||
    !hasStoredConsultingFlowStructure(after) ||
    typeof before.caseId !== 'string' ||
    !before.caseId ||
    after.caseId !== before.caseId ||
    typeof before.partnerId !== 'string' ||
    !before.partnerId ||
    after.partnerId !== before.partnerId ||
    !Number.isSafeInteger(before.revision) ||
    before.revision < 0 ||
    !Number.isSafeInteger(after.revision) ||
    after.revision !== before.revision + 1 ||
    (before.revision > 0 && !validFlowTimestamp(before.updatedAt)) ||
    !validFlowTimestamp(after.updatedAt)
  )
    throw storedFlowIntegrityError();
  const sameValue = (left: unknown, right: unknown) =>
    JSON.stringify(left) === JSON.stringify(right);
  const beforeReceipts = before.commandReceipts ?? {};
  const afterReceipts = after.commandReceipts ?? {};
  if (
    before.commandIds.length > after.commandIds.length ||
    before.commandIds.some((id, index) => after.commandIds[index] !== id) ||
    Object.entries(beforeReceipts).some(
      ([id, receipt]) => !sameValue(receipt, afterReceipts[id]),
    ) ||
    before.audit.length > after.audit.length ||
    before.audit.some((entry, index) => !sameValue(entry, after.audit[index]))
  )
    throw storedFlowIntegrityError();
  const newAudit = after.audit.slice(before.audit.length);
  const newCommandIds = after.commandIds.slice(before.commandIds.length);
  if (
    Object.keys(afterReceipts).some(
      (id) => !Object.hasOwn(beforeReceipts, id) && !newCommandIds.includes(id),
    ) ||
    newCommandIds.some((id) => {
      const receipt = afterReceipts[id];
      const matchingAudit = newAudit.filter(
        (entry) =>
          entry.id === id &&
          entry.at === after.updatedAt &&
          entry.action !== 'ai_result',
      );
      return (
        !receipt ||
        !/^[0-9a-f]{64}$/.test(receipt.fingerprint) ||
        !/^(?:admin|member):[^ \t\r\n]+$/.test(receipt.actorKey) ||
        (receipt.actorKey.startsWith('member:') &&
          (receipt.actorKey !== `member:${after.partnerId}` ||
            receipt.actor !== after.partnerName)) ||
        (receipt.actorKey.startsWith('admin:') &&
          (receipt.actorKey !== FLOW_ADMIN_COMMAND_ACTOR_KEY ||
            receipt.actor !== FLOW_ADMIN_COMMAND_ACTOR_NAME)) ||
        matchingAudit.length !== 1 ||
        receipt.actor !== matchingAudit[0].actor ||
        receipt.action !== matchingAudit[0].action
      );
    })
  )
    throw storedFlowIntegrityError();
  for (const commandId of newCommandIds) {
    const action = afterReceipts[commandId]?.action;
    const effectPaths =
      FLOW_COMMAND_EFFECT_PATHS[
        action as keyof typeof FLOW_COMMAND_EFFECT_PATHS
      ];
    if (
      !effectPaths ||
      !effectPaths.some((path) => {
        const key = path.slice(2).split('.')[0] as keyof ConsultingFlow;
        const nestedKey = path.slice(2).split('.')[1];
        const previous = before[key];
        const next = after[key];
        if (!nestedKey) return !sameValue(previous, next);
        return !sameValue(
          (previous as Record<string, unknown> | undefined)?.[nestedKey],
          (next as Record<string, unknown> | undefined)?.[nestedKey],
        );
      })
    )
      throw storedFlowIntegrityError();
  }
  if (newCommandIds.length > 0) {
    const allowedPaths = new Set(
      newCommandIds.flatMap((commandId) => {
        const action = afterReceipts[commandId]?.action;
        return (
          FLOW_COMMAND_STATE_SCOPE_PATHS[
            action as keyof typeof FLOW_COMMAND_STATE_SCOPE_PATHS
          ] ?? []
        );
      }),
    );
    const withoutCommandChanges = (flow: ConsultingFlow) => {
      const value = structuredClone(flow) as unknown as Record<string, unknown>;
      for (const path of [
        '$.revision',
        '$.updatedAt',
        '$.audit',
        '$.commandIds',
        '$.commandReceipts',
        ...allowedPaths,
      ]) {
        const keys = path.slice(2).split('.');
        let parent: Record<string, unknown> | undefined = value;
        for (const key of keys.slice(0, -1)) {
          const child: unknown = parent?.[key];
          parent =
            child && typeof child === 'object' && !Array.isArray(child)
              ? (child as Record<string, unknown>)
              : undefined;
        }
        if (parent) delete parent[keys.at(-1)!];
      }
      return value;
    };
    if (!sameValue(withoutCommandChanges(before), withoutCommandChanges(after)))
      throw storedFlowIntegrityError();
  }
  const previousJobIds = new Set(before.jobs.map((job) => job.id));
  const newJobs = after.jobs.filter((job) => !previousJobIds.has(job.id));
  if (
    newJobs.some(
      (job) =>
        (job.status !== 'queued' && job.status !== 'blocked') ||
        job.startedAt !== undefined ||
        job.completedAt !== undefined ||
        job.reportId !== undefined ||
        job.evidence !== undefined ||
        job.failureEvidence !== undefined ||
        job.failureEvidenceHistory !== undefined ||
        job.createdAt !== after.updatedAt ||
        (job.stage === 1 &&
          (job.sourceRecordingId !== undefined ||
            job.sourceReportId !== undefined)) ||
        (job.stage === 4 &&
          (job.sourceRecordingId !== latestRecording(after)?.id ||
            job.sourceReportId !== latestReport(after, 1)?.id)),
    )
  )
    throw storedFlowIntegrityError();
  for (const stage of [1, 4] as const) {
    const expectedAction = stage === 1 ? 'queue_report1' : 'save_recording';
    if (
      newJobs.filter((job) => job.stage === stage).length !==
      newAudit.filter(
        (entry) =>
          entry.at === after.updatedAt && entry.action === expectedAction,
      ).length
    )
      throw storedFlowIntegrityError();
  }
  for (const job of newJobs) {
    const expectedAction = job.stage === 1 ? 'queue_report1' : 'save_recording';
    if (
      newAudit.filter(
        (entry) =>
          `${entry.id}-job` === job.id &&
          entry.at === after.updatedAt &&
          entry.action === expectedAction,
      ).length !== 1
    )
      throw storedFlowIntegrityError();
    if (newCommandIds.filter((id) => `${id}-job` === job.id).length !== 1)
      throw storedFlowIntegrityError();
  }
  const nextJobs = new Map(after.jobs.map((job) => [job.id, job]));
  const retryTransitionCount = before.jobs.filter(
    (job) =>
      ['blocked', 'failed', 'processing'].includes(job.status) &&
      nextJobs.get(job.id)?.status === 'queued',
  ).length;
  if (
    retryTransitionCount > 0 &&
    newAudit.filter(
      (entry) =>
        entry.at === after.updatedAt &&
        (entry.action === 'retry_job' || entry.action === 'save_transcript'),
    ).length !== retryTransitionCount
  )
    throw storedFlowIntegrityError();
  for (const job of before.jobs) {
    const next = nextJobs.get(job.id);
    if (!next) throw storedFlowIntegrityError();
    if (
      next.stage !== job.stage ||
      next.sourceRecordingId !== job.sourceRecordingId ||
      next.sourceReportId !== job.sourceReportId ||
      next.createdAt !== job.createdAt
    )
      throw storedFlowIntegrityError();
    const transition = `${job.status}:${next.status}`;
    const emptyResult =
      next.completedAt === undefined &&
      next.reportId === undefined &&
      next.evidence === undefined;
    const emptyAttempt =
      next.startedAt === undefined &&
      emptyResult &&
      next.failureEvidence === undefined;
    const unchangedAttempt =
      next.reason === job.reason &&
      next.startedAt === job.startedAt &&
      next.completedAt === job.completedAt &&
      next.reportId === job.reportId &&
      sameValue(next.evidence, job.evidence) &&
      sameValue(next.failureEvidence, job.failureEvidence);
    const validLifecycle =
      (job.status === next.status &&
        (job.status === 'blocked'
          ? (next.startedAt === job.startedAt ||
              next.startedAt === undefined) &&
            emptyResult &&
            next.failureEvidence === undefined
          : unchangedAttempt)) ||
      (transition === 'queued:processing' &&
        next.reason === '' &&
        next.startedAt === after.updatedAt &&
        emptyResult &&
        next.failureEvidence === undefined) ||
      (transition === 'queued:blocked' && next.reason !== '' && emptyAttempt) ||
      ((transition === 'blocked:queued' ||
        transition === 'failed:queued' ||
        transition === 'processing:queued') &&
        next.reason === '' &&
        emptyAttempt) ||
      (transition === 'processing:blocked' &&
        next.reason !== '' &&
        next.startedAt === job.startedAt &&
        emptyResult &&
        next.failureEvidence === undefined) ||
      (transition === 'processing:failed' &&
        next.reason !== '' &&
        next.startedAt === job.startedAt &&
        emptyResult) ||
      (transition === 'processing:complete' &&
        next.reason === '' &&
        next.startedAt === job.startedAt &&
        next.completedAt === after.updatedAt &&
        next.reportId !== undefined &&
        next.evidence !== undefined &&
        next.failureEvidence === undefined);
    if (!validLifecycle) throw storedFlowIntegrityError();
    if (
      job.status === 'processing' &&
      ['blocked', 'failed', 'complete'].includes(next.status) &&
      newAudit.filter(
        (entry) =>
          entry.id === `${job.id}-${after.updatedAt}` &&
          entry.at === after.updatedAt &&
          entry.actor === '보고서 자동생성' &&
          entry.action === 'ai_result',
      ).length !== 1
    )
      throw storedFlowIntegrityError();
    const previousHistory = job.failureEvidenceHistory ?? [];
    const nextHistory = next.failureEvidenceHistory ?? [];
    if (
      nextHistory.length < previousHistory.length ||
      previousHistory.some(
        (entry, index) => !sameValue(entry, nextHistory[index]),
      ) ||
      (job.evidence && !sameValue(job.evidence, next.evidence)) ||
      (!job.evidence &&
        next.evidence &&
        !(job.status === 'processing' && next.status === 'complete')) ||
      (!job.failureEvidence &&
        next.failureEvidence &&
        !(job.status === 'processing' && next.status === 'failed'))
    )
      throw storedFlowIntegrityError();
    if (job.failureEvidence) {
      const preserved = sameValue(job.failureEvidence, next.failureEvidence);
      const movedToHistory =
        next.failureEvidence === undefined &&
        nextHistory.length === previousHistory.length + 1 &&
        sameValue(job.failureEvidence, nextHistory.at(-1));
      if (
        (!preserved && !movedToHistory) ||
        (preserved && nextHistory.length !== previousHistory.length)
      )
        throw storedFlowIntegrityError();
    } else if (nextHistory.length !== previousHistory.length)
      throw storedFlowIntegrityError();
  }
  const nextFiles = new Map(after.files.map((file) => [file.id, file]));
  for (const file of before.files) {
    const next = nextFiles.get(file.id);
    if (
      !next ||
      next.key !== file.key ||
      next.name !== file.name ||
      next.contentType !== file.contentType ||
      next.size !== file.size ||
      next.createdAt !== file.createdAt ||
      next.intakeFileId !== file.intakeFileId ||
      next.intakeSourceHash !== file.intakeSourceHash ||
      next.sourceReviewedAt !== file.sourceReviewedAt ||
      next.sourceReviewedBy !== file.sourceReviewedBy ||
      (next.purpose !== file.purpose &&
        !(file.purpose === 'source' && next.purpose === 'source_archived'))
    )
      throw storedFlowIntegrityError();
  }
}
export async function commitFlow(
  before: ConsultingFlow,
  after: ConsultingFlow,
  statePayload?: string | null,
  fileObjectBindings?: ReadonlyMap<string, FlowFileObjectBinding>,
) {
  if (after === before) return;
  assertFlowCommitTransition(before, after);
  const payload = JSON.stringify(after);
  if (new TextEncoder().encode(payload).length > 1_800_000)
    throw new FlowError(
      '이 진행의 저장 한도에 가까워졌습니다. 관리자 검토가 필요합니다.',
      413,
    );
  const db = await flowDatabase();
  const flowWrite =
    before.revision === 0
      ? db
          .prepare(
            `INSERT INTO consulting_flows (case_id, partner_id, revision, payload, updated_at)
            SELECT ?1, ?2, ?3, ?4, ?5 WHERE (?6 = 0 OR (SELECT payload FROM portal_state WHERE id = '${portalStateId}') IS ?7)
            ON CONFLICT(case_id) DO NOTHING`,
          )
          .bind(
            after.caseId,
            after.partnerId,
            after.revision,
            payload,
            after.updatedAt,
            statePayload === undefined ? 0 : 1,
            statePayload ?? null,
          )
      : db
          .prepare(
            `UPDATE consulting_flows SET revision = ?1, payload = ?2, updated_at = ?3 WHERE case_id = ?4 AND revision = ?5
            AND (?6 = 0 OR (SELECT payload FROM portal_state WHERE id = '${portalStateId}') IS ?7)`,
          )
          .bind(
            after.revision,
            payload,
            after.updatedAt,
            before.caseId,
            before.revision,
            statePayload === undefined ? 0 : 1,
            statePayload ?? null,
          );
  const previousFileIds = new Set(before.files.map((file) => file.id));
  const newFiles = after.files.filter((file) => !previousFileIds.has(file.id));
  if (
    (newFiles.length > 0 &&
      (fileObjectBindings?.size !== newFiles.length ||
        newFiles.some(
          (file) =>
            !validFlowFileObjectBinding(file, fileObjectBindings.get(file.id)),
        ))) ||
    (newFiles.length === 0 && (fileObjectBindings?.size ?? 0) > 0)
  )
    throw new FlowError(
      '첨부파일 보관 증빙을 확인할 수 없습니다. 자료를 다시 등록해 주세요.',
      503,
    );
  const nextFiles = new Map(after.files.map((file) => [file.id, file]));
  const purposeChanges = before.files.flatMap((file) => {
    const next = nextFiles.get(file.id);
    return next && next.purpose !== file.purpose ? [[file, next] as const] : [];
  });
  let result: D1Result;
  if (!newFiles.length && !purposeChanges.length)
    result = await flowWrite.run();
  else {
    let results: D1Result[];
    try {
      results = await db.batch([
        flowWrite,
        ...purposeChanges.map(([file, next]) => {
          const [
            id,
            key,
            name,
            contentType,
            size,
            createdAt,
            purpose,
            intakeFileId,
            intakeSourceHash,
            sourceReviewedAt,
            sourceReviewedBy,
          ] = flowFileOwnershipValues(file);
          return db
            .prepare(transitionFlowFilePurposeSql)
            .bind(
              id,
              after.caseId,
              key,
              name,
              contentType,
              size,
              createdAt,
              purpose,
              next.purpose,
              intakeFileId,
              intakeSourceHash,
              sourceReviewedAt,
              sourceReviewedBy,
              after.revision,
              payload,
            );
        }),
        ...newFiles.flatMap((file) => [
          db
            .prepare(claimFlowFileOwnershipSql)
            .bind(
              file.id,
              after.caseId,
              file.key,
              file.createdAt,
              after.revision,
              payload,
            ),
          db
            .prepare(claimFlowFileMetadataSql)
            .bind(
              file.id,
              after.caseId,
              file.key,
              file.name,
              file.contentType,
              file.size,
              file.createdAt,
              file.purpose,
              file.intakeFileId ?? null,
              file.intakeSourceHash ?? null,
              file.sourceReviewedAt ?? null,
              file.sourceReviewedBy ?? null,
              after.revision,
              payload,
            ),
          db
            .prepare(claimFlowFileObjectIntegritySql)
            .bind(
              file.id,
              after.caseId,
              file.key,
              file.name,
              file.contentType,
              file.size,
              file.createdAt,
              file.purpose,
              file.intakeFileId ?? null,
              file.intakeSourceHash ?? null,
              file.sourceReviewedAt ?? null,
              file.sourceReviewedBy ?? null,
              after.revision,
              payload,
              fileObjectBindings!.get(file.id)!.etag,
            ),
        ]),
      ]);
    } catch {
      throw new FlowError(
        '첨부파일 소유권을 안전하게 저장하지 못했습니다. 새로고침 후 다시 확인해 주세요.',
        503,
      );
    }
    result = results[0];
  }
  if (result.meta.changes !== 1)
    throw new FlowError(
      '다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 확인해 주세요.',
      409,
    );
}
export async function loadFlowAccess(request: Request, caseId: string) {
  const validatedCaseId = readRouteParam(
    caseId,
    120,
    '진행번호를 확인해 주세요.',
  );
  const initial = await readPortalStateSnapshot();
  await requirePortalUser(request, initial.state);
  const stored = await readFlow(validatedCaseId);
  const { state, payload } = await readPortalStateSnapshot();
  const user = await requirePortalUser(request, state);
  const assignment = resolveFlowAssignment(
    state,
    validatedCaseId,
    user,
    stored,
  );
  return {
    user,
    state,
    statePayload: payload,
    flow:
      stored ??
      newConsultingFlow(
        validatedCaseId,
        assignment.company,
        assignment.partnerId,
        assignment.partnerName,
      ),
  };
}

export function assertFlowLifecycleActive(state: unknown, caseId: string) {
  if (isPipelineDiscontinued(state, caseId))
    throw new FlowError(
      '대표가 진행을 중단한 상태입니다. 진행판에서 다시 연 뒤 이용해 주세요.',
      409,
    );
}
export async function recheckFlowAccess(
  request: Request,
  flow: ConsultingFlow,
  expected: PortalUser,
  uploads = false,
) {
  const access = await loadFlowAccess(request, flow.caseId);
  if (
    access.user.id !== expected.id ||
    access.user.memberId !== expected.memberId ||
    access.user.role !== expected.role ||
    access.flow.partnerId !== flow.partnerId
  )
    throw new FlowError(
      '계정 또는 담당 정보가 변경되었습니다. 다시 확인해 주세요.',
      403,
    );
  if (
    uploads &&
    access.user.role !== 'admin' &&
    !access.user.permissions?.fileUpload
  )
    throw new FlowError('자료 업로드 권한이 필요합니다.', 403);
  return access;
}
export function assertSameOrigin(request: Request) {
  if (isCrossSiteRequest(request))
    throw new FlowError(
      '다른 사이트에서 보낸 변경 요청은 허용하지 않습니다.',
      403,
    );
}
export function flowErrorResponse(error: unknown) {
  if (
    error instanceof FlowError ||
    error instanceof CompanyFileError ||
    error instanceof PortalAccessError ||
    error instanceof QueryRequestError ||
    error instanceof RouteParamError
  )
    return privateJsonResponse(
      { error: error.message },
      { status: error.status },
    );
  if (error instanceof SyntaxError)
    return privateJsonResponse(
      { error: '요청 형식을 확인해 주세요.' },
      { status: 400 },
    );
  console.error(
    'Consulting workflow operation failed',
    error instanceof Error ? error.name : 'unknown',
  );
  return privateJsonResponse(
    {
      error:
        '저장 여부를 새로고침으로 확인해 주세요. 해결되지 않으면 관리자에게 문의해 주세요.',
    },
    { status: 500 },
  );
}
export function flowReadiness() {
  const e = flowEnvironment();
  return {
    aiConnected: Boolean(e.ANTHROPIC_API_KEY),
    model: e.ANTHROPIC_MODEL || 'claude-opus-5',
    transcriptionConnected: false,
  };
}
