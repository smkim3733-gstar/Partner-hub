import './register-local.mjs';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import postgres from 'postgres';
import {
  isWithin,
  captureProcess,
  processEnvironment,
} from './supabase-backup-runtime.mjs';
import {
  verificationError,
  verificationSettings,
  migrationBody,
  assertVerificationBucket,
} from './supabase-verification-policy.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const digest = (value) => createHash('sha256').update(value).digest('hex');

async function assertPrivatePermissions(file) {
  if (process.platform !== 'win32') {
    for (const entry of [file, path.dirname(file)]) {
      const stat = await lstat(entry);
      if ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid())
        throw verificationError('PRIVATE_PERMISSIONS_REQUIRED');
    }
    return;
  }
  const script = `$ErrorActionPreference = 'Stop'
$taskIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskFile = $env:PARTNER_HUB_VERIFICATION_FILE
$taskDirectory = Split-Path -Parent $taskFile
foreach ($taskEntry in @($taskDirectory, $taskFile)) {
  $taskAcl = Get-Acl -LiteralPath $taskEntry
  if ($taskEntry -eq $taskDirectory -and -not $taskAcl.AreAccessRulesProtected) { exit 2 }
  if ($taskAcl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $taskIdentity) { exit 2 }
  $taskRules = $taskAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
  foreach ($taskRule in $taskRules) {
    if ($taskRule.AccessControlType -eq 'Allow' -and $taskRule.IdentityReference.Value -notin @($taskIdentity, 'S-1-5-18')) { exit 2 }
  }
}`;
  try {
    await captureProcess(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        env: processEnvironment({ PARTNER_HUB_VERIFICATION_FILE: file }),
        limit: 4096,
      },
    );
  } catch {
    throw verificationError('PRIVATE_PERMISSIONS_REQUIRED');
  }
}

export async function readVerificationFile(file) {
  if (!path.isAbsolute(file)) throw verificationError('PRIVATE_FILE_REQUIRED');
  const stat = await lstat(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > 16384
  )
    throw verificationError('PRIVATE_FILE_REQUIRED');
  const resolved = await realpath(file);
  if (
    isWithin(await realpath(root), resolved) ||
    resolved.split(/[\\/]/).some((part) => /^onedrive(?:\s*-.*)?$/i.test(part))
  )
    throw verificationError('PRIVATE_FILE_REQUIRED');
  for (const synced of [
    process.env.OneDrive,
    process.env.OneDriveCommercial,
    process.env.OneDriveConsumer,
  ].filter(Boolean)) {
    if (
      isWithin(
        await realpath(synced).catch(() => path.resolve(synced)),
        resolved,
      )
    )
      throw verificationError('PRIVATE_FILE_REQUIRED');
  }
  // The folder must be dedicated to verification; never change a user's parent ACL.
  if (
    !path
      .basename(path.dirname(resolved))
      .startsWith('partner-hub-verification-')
  )
    throw verificationError('PRIVATE_DIRECTORY_REQUIRED');
  // Reading credentials must not rewrite an existing folder's ACL or owner.
  await assertPrivatePermissions(resolved);
  let input;
  try {
    input = JSON.parse(await readFile(resolved, 'utf8'));
  } catch {
    throw verificationError('INVALID_FILE');
  }
  if (input.keyReplacementRequired === true)
    throw verificationError('KEY_REPLACEMENT_REQUIRED');
  return {
    ...(await verificationSettings(input.target, input.environment ?? {})),
    directory: path.dirname(resolved),
  };
}

export async function verificationMigrations() {
  const directory = path.join(root, 'supabase', 'migrations');
  const names = (await readdir(directory))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  if (
    names.length !== 19 ||
    names.some((name, i) => Number(name.slice(0, 4)) !== i + 1)
  )
    throw verificationError('MIGRATION_SET_CHANGED');
  return Promise.all(
    names.map(async (name, i) => {
      const source = await readFile(path.join(directory, name), 'utf8');
      return {
        sequence: i + 1,
        name,
        sha256: digest(source),
        sql: migrationBody(source),
      };
    }),
  );
}

export async function prepareVerificationSchema(sql, target, migrations) {
  return sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL statement_timeout = '120s'");
    await tx.unsafe("SET LOCAL lock_timeout = '5s'");
    await tx.unsafe('SELECT pg_advisory_xact_lock(1836016689, 20261014)');
    const existing = await tx.unsafe(
      "SELECT to_regnamespace('partner_hub') IS NOT NULL AS present",
    );
    if (existing[0].present) {
      const marker = await tx.unsafe(
        "SELECT to_regclass('partner_hub.verification_environment') IS NOT NULL AS present",
      );
      if (!marker[0].present)
        throw verificationError('EXISTING_SCHEMA_REJECTED');
      const rows = await tx.unsafe(
        'SELECT project_ref, purpose FROM partner_hub.verification_environment',
      );
      const installed = await tx.unsafe(
        'SELECT sequence, name, sha256 FROM partner_hub.schema_migrations ORDER BY sequence',
      );
      if (
        rows.length !== 1 ||
        rows[0].project_ref !== target.projectRef ||
        rows[0].purpose !== target.purpose ||
        installed.length !== migrations.length ||
        installed.some(
          (row, i) =>
            row.sequence !== migrations[i].sequence ||
            row.name !== migrations[i].name ||
            row.sha256 !== migrations[i].sha256,
        )
      )
        throw verificationError('EXISTING_SCHEMA_REJECTED');
      return 'already-prepared';
    }
    // All 19 migration bodies and the environment marker commit atomically.
    // No DROP, destructive reset, production import or password reset is used.
    for (const migration of migrations) {
      await tx.unsafe(migration.sql);
      await tx.unsafe(
        'INSERT INTO partner_hub.schema_migrations(sequence,name,sha256) VALUES ($1,$2,$3)',
        [migration.sequence, migration.name, migration.sha256],
      );
    }
    await tx.unsafe(`CREATE TABLE partner_hub.verification_environment (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      project_ref text NOT NULL, purpose text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now());
      ALTER TABLE partner_hub.verification_environment ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON partner_hub.verification_environment FROM public, anon, authenticated, service_role;`);
    await tx.unsafe(
      'INSERT INTO partner_hub.verification_environment(project_ref,purpose) VALUES ($1,$2)',
      [target.projectRef, target.purpose],
    );
    return 'prepared';
  });
}

export async function prepareVerificationBucket(config, fetcher = fetch) {
  const request = (endpoint, init = {}) =>
    fetcher(`${config.supabaseUrl}/storage/v1${endpoint}`, {
      ...init,
      headers: { apikey: config.secretKey, 'content-type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
  // Listing distinguishes a genuinely absent bucket from missing permissions.
  const response = await request('/bucket');
  if (!response.ok) throw verificationError('BUCKET_READ_FAILED');
  const buckets = await response.json();
  if (!Array.isArray(buckets)) throw verificationError('BUCKET_READ_FAILED');
  const current = buckets.find((bucket) => bucket.id === config.storageBucket);
  if (current) {
    assertVerificationBucket(current, config.storageBucket);
    return 'already-prepared';
  }
  const created = await request('/bucket', {
    method: 'POST',
    body: JSON.stringify({
      id: config.storageBucket,
      name: config.storageBucket,
      public: false,
      file_size_limit: 26214400,
      allowed_mime_types: ['application/octet-stream'],
    }),
  });
  if (!created.ok) throw verificationError('BUCKET_CREATE_OUTCOME_UNKNOWN');
  const verified = await request(`/bucket/${config.storageBucket}`);
  if (!verified.ok) throw verificationError('BUCKET_READ_FAILED');
  assertVerificationBucket(await verified.json(), config.storageBucket);
  return 'prepared';
}

export async function verificationMain(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
    console.log(
      'Supabase verification only: plan|prepare --config <absolute private JSON outside OneDrive>.\nplan is offline. prepare applies schema/private bucket only to an explicitly isolated project. No production targets, paid resources, data imports, credential resets or retries.',
    );
    return;
  }
  if (
    args.length !== 3 ||
    !['plan', 'prepare'].includes(args[0]) ||
    args[1] !== '--config'
  )
    throw verificationError('ARGUMENTS');
  const settings = await readVerificationFile(args[2]);
  const migrations = await verificationMigrations();
  const summary = {
    target: settings.target,
    migrations: migrations.map(({ sequence, name, sha256 }) => ({
      sequence,
      name,
      sha256,
    })),
    liveVerification: false,
  };
  if (args[0] === 'plan') {
    console.log(JSON.stringify({ ...summary, networkRequests: 0 }));
    return;
  }
  const { supabasePostgresClientOptions } =
    await import('../lib/supabase-postgres-client.ts');
  const sql = postgres(
    settings.config.databaseUrl,
    supabasePostgresClientOptions,
  );
  try {
    const schema = await prepareVerificationSchema(
      sql,
      settings.target,
      migrations,
    );
    const bucket = await prepareVerificationBucket(settings.config);
    console.log(
      JSON.stringify({ ...summary, schema, bucket, workflowVerified: false }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  verificationMain(process.argv.slice(2)).catch((error) => {
    // Never print provider errors, SQL, parameters, URLs or credentials.
    console.error(
      `Verification stopped: ${error.verificationCode ?? 'OPERATION_FAILED_OR_OUTCOME_UNKNOWN'}`,
    );
    process.exitCode = 1;
  });
}
