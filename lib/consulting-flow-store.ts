import { env } from 'cloudflare:workers';
import { consultingFlowsTableSql, portalStateId } from '@/db/schema';
import {
  FlowError,
  newConsultingFlow,
  type ConsultingFlow,
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
import {
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
export async function flowDatabase() {
  const db = flowEnvironment().DB;
  if (!db) throw new FlowError('진행 저장소가 연결되지 않았습니다.', 503);
  await db.prepare(consultingFlowsTableSql).run();
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
  const row = await (
    await flowDatabase()
  )
    .prepare(
      'SELECT case_id, partner_id, revision, updated_at, payload FROM consulting_flows WHERE case_id = ?1',
    )
    .bind(caseId)
    .first<StoredFlowRow>();
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
          COALESCE(json_type(receipt.value, '$.fingerprint'), '') <> 'text' OR length(json_extract(receipt.value, '$.fingerprint')) NOT BETWEEN 1 AND ${FLOW_FIELD_LIMITS.receiptFingerprint}) AND
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
  const rows = batch[1] as D1Result<StoredFlowRow>;
  if (semanticViolations.results.length > 0) throw storedFlowIntegrityError();
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
}
export async function commitFlow(
  before: ConsultingFlow,
  after: ConsultingFlow,
  statePayload?: string | null,
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
  const result =
    before.revision === 0
      ? await db
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
          .run()
      : await db
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
          )
          .run();
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
