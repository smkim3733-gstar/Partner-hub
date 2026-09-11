import { createHash } from 'node:crypto';

export class SupabaseFingerprintError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SupabaseFingerprintError';
    this.code = code;
  }
}

const required = (condition, code) => {
  if (!condition) throw new SupabaseFingerprintError(code);
};
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const identifier = (value) => `"${value.replaceAll('"', '""')}"`;
const safeCount = (value) => {
  required(typeof value === 'string' && /^\d+$/.test(value), 'invalid-count');
  const integer = BigInt(value);
  required(integer <= BigInt(Number.MAX_SAFE_INTEGER), 'count-overflow');
  return Number(integer);
};

// Hash each complete row, sort fixed-length digests, then hash the multiset.
// This preserves duplicate rows without depending on collation, primary keys,
// result order, JavaScript JSON parsing, or JavaScript numeric precision.
function digestRecords(records, key, maxBytes) {
  let encodedBytes = 0;
  const digests = records.map((record) => {
    const text = record[key];
    required(typeof text === 'string', 'invalid-record-encoding');
    encodedBytes += Buffer.byteLength(text, 'utf8');
    required(encodedBytes <= maxBytes, 'fingerprint-byte-limit');
    return sha256(text);
  });
  digests.sort();
  const hash = createHash('sha256').update(`partner-hub-multiset-v1\n${digests.length}\n`);
  for (const digest of digests) hash.update(digest).update('\n');
  return { count: records.length, sha256: hash.digest('hex'), encodedBytes };
}

// Compare role names, including owners and ACL grantors, instead of local OIDs.
const grantee = (role) => `CASE WHEN ${role} = 0 THEN 'PUBLIC'
  ELSE pg_get_userbyid(${role}) END`;

const catalogQueries = {
  schemas: `SELECT json_build_array(n.nspname, pg_get_userbyid(n.nspowner))::text AS encoded_record
    FROM pg_namespace n WHERE n.nspname = $1`,
  tables: `SELECT json_build_array(c.relname, c.relkind, c.relpersistence,
      pg_get_userbyid(c.relowner), c.relrowsecurity, c.relforcerowsecurity, c.relreplident,
      (SELECT array_agg(option ORDER BY option) FROM unnest(c.reloptions) option),
      a.amname)::text AS encoded_record
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_am a ON a.oid = c.relam
    WHERE n.nspname = $1 AND c.relkind = 'r'`,
  columns: `SELECT json_build_array(c.relname,
      row_number() OVER (PARTITION BY c.oid ORDER BY a.attnum)::text,
      a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
      a.attidentity, a.attgenerated, pg_get_expr(d.adbin, d.adrelid, false),
      cn.nspname, coll.collname, a.attstorage, a.attcompression)::text AS encoded_record
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    LEFT JOIN pg_collation coll ON coll.oid = a.attcollation
    LEFT JOIN pg_namespace cn ON cn.oid = coll.collnamespace
    WHERE n.nspname = $1 AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped`,
  constraints: `SELECT json_build_array(c.relname, x.conname, x.contype,
      x.condeferrable, x.condeferred, x.convalidated, x.connoinherit,
      pg_get_constraintdef(x.oid, false))::text AS encoded_record
    FROM pg_constraint x JOIN pg_class c ON c.oid = x.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1`,
  indexes: `SELECT json_build_array(t.relname, c.relname, x.indisunique,
      x.indisprimary, x.indisvalid, x.indisready, x.indisreplident,
      pg_get_indexdef(c.oid, 0, false))::text AS encoded_record
    FROM pg_index x JOIN pg_class c ON c.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = $1`,
  functions: `SELECT json_build_array(p.proname,
      pg_get_userbyid(p.proowner), pg_get_function_identity_arguments(p.oid), pg_get_functiondef(p.oid),
      p.prosecdef, p.proleakproof, p.provolatile, p.proparallel,
      p.proisstrict, p.proretset)::text AS encoded_record
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = $1 AND p.prokind IN ('f', 'p')`,
  triggers: `SELECT json_build_array(c.relname, t.tgname, t.tgenabled,
      pg_get_triggerdef(t.oid, false))::text AS encoded_record
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND NOT t.tgisinternal`,
  internalTriggers: `SELECT json_build_array(c.relname, x.conname, t.tgtype,
      t.tgenabled, pn.nspname, p.proname)::text AS encoded_record
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_constraint x ON x.oid = t.tgconstraint
    JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace pn ON pn.oid = p.pronamespace
    WHERE n.nspname = $1 AND t.tgisinternal`,
  policies: `SELECT json_build_array(c.relname, p.polname, p.polcmd,
      p.polpermissive, (SELECT array_agg(role_name ORDER BY role_name)
        FROM (SELECT ${grantee('role_id', 'c.relowner')} AS role_name
          FROM unnest(p.polroles) role_id) roles),
      pg_get_expr(p.polqual, p.polrelid, false),
      pg_get_expr(p.polwithcheck, p.polrelid, false))::text AS encoded_record
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1`,
  acl: `SELECT json_build_array('schema', n.nspname,
      ${grantee('x.grantee')}, ${grantee('x.grantor')}, x.privilege_type, x.is_grantable)::text AS encoded_record
    FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) x
    WHERE n.nspname = $1
    UNION ALL SELECT json_build_array('table', c.relname,
      ${grantee('x.grantee')}, ${grantee('x.grantor')}, x.privilege_type, x.is_grantable)::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
    WHERE n.nspname = $1 AND c.relkind = 'r'
    UNION ALL SELECT json_build_array('column', c.relname, a.attname,
      ${grantee('x.grantee')}, ${grantee('x.grantor')}, x.privilege_type, x.is_grantable)::text
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(a.attacl) x
    WHERE n.nspname = $1 AND a.attnum > 0 AND NOT a.attisdropped
    UNION ALL SELECT json_build_array('function', p.proname,
      pg_get_function_identity_arguments(p.oid), ${grantee('x.grantee')},
      ${grantee('x.grantor')}, x.privilege_type, x.is_grantable)::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
    WHERE n.nspname = $1
    UNION ALL SELECT json_build_array('default', d.defaclobjtype,
      ${grantee('d.defaclrole')}, ${grantee('x.grantee')},
      ${grantee('x.grantor')}, x.privilege_type, x.is_grantable)::text
    FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) x WHERE n.nspname = $1`,
  effectivePrivileges: `SELECT json_build_array('schema', r.rolname,
      has_schema_privilege(r.oid, n.oid, 'USAGE'),
      has_schema_privilege(r.oid, n.oid, 'CREATE'), r.rolsuper, r.rolbypassrls)::text AS encoded_record
    FROM pg_roles r CROSS JOIN pg_namespace n
    WHERE n.nspname = $1 AND r.rolname IN ('anon', 'authenticated', 'service_role')
    UNION ALL SELECT json_build_array('table', c.relname, r.rolname,
      has_table_privilege(r.oid, c.oid, 'SELECT'), has_table_privilege(r.oid, c.oid, 'INSERT'),
      has_table_privilege(r.oid, c.oid, 'UPDATE'), has_table_privilege(r.oid, c.oid, 'DELETE'),
      has_table_privilege(r.oid, c.oid, 'TRUNCATE'), has_table_privilege(r.oid, c.oid, 'REFERENCES'),
      has_table_privilege(r.oid, c.oid, 'TRIGGER'))::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN pg_roles r
    WHERE n.nspname = $1 AND c.relkind = 'r' AND r.rolname IN ('anon', 'authenticated', 'service_role')
    UNION ALL SELECT json_build_array('function', p.proname,
      pg_get_function_identity_arguments(p.oid), r.rolname,
      has_function_privilege(r.oid, p.oid, 'EXECUTE'))::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace CROSS JOIN pg_roles r
    WHERE n.nspname = $1 AND r.rolname IN ('anon', 'authenticated', 'service_role')`,
};

/**
 * SELECT-only verification of an existing, caller-owned snapshot transaction.
 * Caller sets READ ONLY + REPEATABLE READ/SERIALIZABLE and canonical GUCs:
 * timezone=UTC, DateStyle=ISO, IntervalStyle=postgres, extra_float_digits=3,
 * bytea_output=hex, search_path=pg_catalog. No connection/credentials are kept.
 * This is a bounded verifier, not an exporter; unsupported schema objects or
 * limits fail closed. Real Storage object bytes need separate verification.
 */
export async function fingerprintSupabaseDatabase(sql, options = {}) {
  const schema = options.schema ?? 'partner_hub';
  required(typeof schema === 'string' && /^[a-z_][a-z0-9_]{0,62}$/.test(schema), 'invalid-schema');
  required(sql && typeof sql.unsafe === 'function', 'invalid-executor');
  const limits = {
    expectedTableCount: options.expectedTableCount ?? 38,
    maxRowsPerTable: options.maxRowsPerTable ?? 100_000,
    maxTotalRows: options.maxTotalRows ?? 1_000_000,
    maxTotalBytes: options.maxTotalBytes ?? 64 * 1024 * 1024,
    maxRowBytes: options.maxRowBytes ?? 4 * 1024 * 1024,
    maxCatalogRows: options.maxCatalogRows ?? 20_000,
    maxCatalogBytes: options.maxCatalogBytes ?? 16 * 1024 * 1024,
  };
  for (const value of Object.values(limits)) {
    required(Number.isSafeInteger(value) && value > 0 && value <= 1024 ** 3, 'invalid-limit');
  }
  const query = async (statement, parameters = []) => {
    try {
      return await sql.unsafe(statement, parameters);
    } catch {
      // PostgreSQL diagnostics can contain SQL, row values, or connection data.
      throw new SupabaseFingerprintError('fingerprint-query-failed');
    }
  };
  const [settings] = await query(`SELECT current_setting('transaction_read_only') AS read_only,
    current_setting('transaction_isolation') AS isolation,
    current_setting('TimeZone') AS timezone, current_setting('DateStyle') AS date_style,
    current_setting('IntervalStyle') AS interval_style,
    current_setting('extra_float_digits') AS float_digits,
    current_setting('bytea_output') AS bytea_output,
    current_setting('search_path') AS search_path,
    current_setting('server_version_num') AS server_version`);
  required(settings?.read_only === 'on' && ['repeatable read', 'serializable'].includes(settings.isolation), 'snapshot-transaction-required');
  required(['UTC', 'Etc/UTC'].includes(settings.timezone)
    && /^ISO, (MDY|DMY|YMD)$/.test(settings.date_style)
    && settings.interval_style === 'postgres' && settings.float_digits === '3'
    && settings.bytea_output === 'hex' && settings.search_path === 'pg_catalog', 'canonical-settings-required');
  const postgresMajor = Math.floor(safeCount(settings.server_version) / 10_000);
  const [inventory] = await query(`SELECT
    (SELECT count(*) FROM pg_namespace WHERE nspname = $1)::text AS schemas,
    (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role'))::text AS roles,
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind NOT IN ('r', 'i'))::text AS unsupported_relations,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = $1 AND p.prokind NOT IN ('f', 'p'))::text AS unsupported_routines,
    (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = $1 AND NOT (t.typtype = 'c' AND t.typrelid <> 0)
        AND NOT (t.typelem <> 0 AND t.typlen = -1))::text AS unsupported_types`, [schema]);
  required(inventory?.schemas === '1' && inventory.roles === '3', 'required-schema-or-roles-missing');
  required(inventory.unsupported_relations === '0' && inventory.unsupported_routines === '0'
    && inventory.unsupported_types === '0', 'unsupported-schema-object');

  const columnRows = await query(`SELECT c.relname AS table_name, a.attname AS column_name,
      tn.nspname AS type_schema, t.typname AS type_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    JOIN pg_type t ON t.oid = a.atttypid JOIN pg_namespace tn ON tn.oid = t.typnamespace
    WHERE n.nspname = $1 AND c.relkind = 'r' ORDER BY c.relname COLLATE "C", a.attnum`, [schema]);
  const tableColumns = new Map();
  const allowedTypes = new Set(['bool', 'int2', 'int4', 'int8', 'text', 'varchar', 'bpchar',
    'uuid', 'json', 'jsonb', 'bytea', 'float4', 'float8', 'numeric', 'date', 'timestamp',
    'timestamptz', 'time', 'timetz', 'interval']);
  for (const column of columnRows) {
    required(column.type_schema === 'pg_catalog' && allowedTypes.has(column.type_name), 'unsupported-column-type');
    const columns = tableColumns.get(column.table_name) ?? [];
    columns.push(column.column_name);
    tableColumns.set(column.table_name, columns);
  }
  const [tableInventory] = await query(`SELECT count(*)::text AS table_count
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relkind = 'r'`, [schema]);
  required(safeCount(tableInventory.table_count) === limits.expectedTableCount
    && tableColumns.size === limits.expectedTableCount, 'unexpected-table-inventory');

  /** @type {Record<string, { count: number, sha256: string }>} */
  const categories = {};
  let catalogBytes = 0;
  for (const [name, statement] of Object.entries(catalogQueries)) {
    const records = await query(`${statement} LIMIT ${limits.maxCatalogRows + 1}`, [schema]);
    required(records.length <= limits.maxCatalogRows, 'catalog-row-limit');
    const digest = digestRecords(records, 'encoded_record', limits.maxCatalogBytes - catalogBytes);
    catalogBytes += digest.encodedBytes;
    categories[name] = { count: digest.count, sha256: digest.sha256 };
  }
  const tables = [];
  let totalRows = 0;
  let totalEncodedBytes = 0;
  for (const [name, columns] of tableColumns) {
    const table = `${identifier(schema)}.${identifier(name)}`;
    // PostgreSQL text encoding preserves bigint and the exact stored JSON/text
    // representation. NULL stays distinct from the text "null" and empty text.
    const expression = `json_build_array(${columns.map((column) => `${identifier(column)}::text`).join(',')})::text`;
    const [size] = await query(`SELECT count(*)::text AS row_count,
      coalesce(sum(octet_length(${expression})), 0)::text AS encoded_bytes,
      coalesce(max(octet_length(${expression})), 0)::text AS max_row_bytes FROM ${table}`);
    const rowCount = safeCount(size.row_count);
    const encodedBytes = safeCount(size.encoded_bytes);
    required(rowCount <= limits.maxRowsPerTable && totalRows + rowCount <= limits.maxTotalRows, 'data-row-limit');
    required(encodedBytes + totalEncodedBytes <= limits.maxTotalBytes
      && safeCount(size.max_row_bytes) <= limits.maxRowBytes, 'data-byte-limit');
    const records = await query(`SELECT ${expression} AS encoded_row FROM ${table} LIMIT ${limits.maxRowsPerTable + 1}`);
    required(records.length === rowCount, 'snapshot-row-count-mismatch');
    const digest = digestRecords(records, 'encoded_row', limits.maxTotalBytes - totalEncodedBytes);
    required(digest.encodedBytes === encodedBytes, 'snapshot-byte-count-mismatch');
    tables.push({ name, rowCount, encodedBytes, contentSha256: digest.sha256 });
    totalRows += rowCount;
    totalEncodedBytes += encodedBytes;
  }
  return {
    version: 1,
    schema,
    postgresMajor,
    tableCount: tables.length,
    totalRows,
    totalEncodedBytes,
    tables,
    categories,
    contentSha256: sha256(JSON.stringify(tables)),
    schemaSha256: sha256(JSON.stringify(categories)),
    ownershipNormalized: false,
  };
}

/** Return only changed table/category names, never row values or SQL text. */
export function compareSupabaseFingerprints(before, after) {
  required(before?.version === 1 && after?.version === 1
    && Array.isArray(before.tables) && Array.isArray(after.tables)
    && before.categories && after.categories, 'invalid-fingerprint');
  const differences = [];
  if (before.schema !== after.schema) differences.push({ kind: 'schema-name' });
  if (before.postgresMajor !== after.postgresMajor) differences.push({ kind: 'postgres-major' });
  for (const name of new Set([...before.tables.map((table) => table.name), ...after.tables.map((table) => table.name)])) {
    const original = before.tables.find((table) => table.name === name);
    const restored = after.tables.find((table) => table.name === name);
    if (!original || !restored) differences.push({ kind: 'table-inventory', table: name });
    else if (original.rowCount !== restored.rowCount || original.encodedBytes !== restored.encodedBytes
      || original.contentSha256 !== restored.contentSha256) differences.push({ kind: 'table-content', table: name });
  }
  for (const category of new Set([...Object.keys(before.categories), ...Object.keys(after.categories)])) {
    if (before.categories[category]?.count !== after.categories[category]?.count
      || before.categories[category]?.sha256 !== after.categories[category]?.sha256) {
      differences.push({ kind: 'schema-definition', category });
    }
  }
  return { equal: differences.length === 0, differences };
}
