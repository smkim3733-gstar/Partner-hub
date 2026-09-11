import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, realpath, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const BACKUP_LIMIT = 512 * 1024 * 1024;
export const backupAbort = new AbortController();
export function checkBackupAbort() {
  if (backupAbort.signal.aborted) throw failBackup('backup-interrupted');
}
export function failBackup(code) {
  const error = new Error(code);
  error.backupCode = code;
  return error;
}

/** @param {Record<string, string>} [extra] @returns {Record<string, string>} */
export function processEnvironment(extra = {}) {
  // Do not pass Supabase keys or unrelated operator environment to subprocesses.
  const value = {};
  for (const name of [
    'SystemRoot',
    'WINDIR',
    'COMSPEC',
    'PATH',
    'PATHEXT',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'HOME',
    'LANG',
  ]) {
    if (process.env[name]) value[name] = process.env[name];
  }
  return { ...value, ...extra };
}

/**
 * @param {string} executable
 * @param {string[]} args
 * @param {{env?: Record<string,string>, input?: Buffer, limit?:number, timeout?:number, signal?:AbortSignal|null, cwd?:string, quiet?:boolean}} [options]
 * @returns {Promise<Buffer>}
 */
export function captureProcess(
  executable,
  args,
  {
    env = processEnvironment(),
    input,
    limit = BACKUP_LIMIT,
    timeout = 180_000,
    signal = backupAbort.signal,
    cwd,
    quiet = false,
  } = {},
) {
  return new Promise((resolve, reject) => {
    if (quiet && input !== undefined) {
      reject(failBackup('backup-quiet-process-input-invalid'));
      return;
    }
    if (signal?.aborted) {
      reject(failBackup('backup-interrupted'));
      return;
    }
    const child = spawn(executable, args, {
      env,
      cwd,
      windowsHide: true,
      shell: false,
      stdio: quiet ? ['ignore', 'ignore', 'ignore'] : ['pipe', 'pipe', 'pipe'],
    });
    const chunks = [];
    let length = 0;
    let failure;
    const stop = (code) => {
      failure ??= failBackup(code);
      child.kill();
    };
    const abort = () => stop('backup-interrupted');
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop('backup-process-timeout'), timeout);
    child.on('error', () => {
      failure ??= failBackup('backup-process-unavailable');
    });
    child.stdout?.on('data', (chunk) => {
      length += chunk.length;
      if (length > limit) stop('backup-process-output-limit');
      else chunks.push(chunk);
    });
    // Driver and pg_restore errors can contain row values. Always discard them.
    child.stderr?.on('data', () => {});
    child.stdin?.on('error', () => {});
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure || code !== 0)
        reject(failure ?? failBackup('backup-process-failed'));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin?.end(input);
  });
}

export function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

export function assertSeparateRoots(backupRoot, keyRoot) {
  if (isWithin(backupRoot, keyRoot) || isWithin(keyRoot, backupRoot))
    throw failBackup('backup-key-location-not-separated');
}

export async function privateDirectory(
  root,
  prefix,
  { excludeWorkspace = true } = {},
) {
  if (!path.isAbsolute(root)) throw failBackup('backup-path-must-be-absolute');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const resolvedRoot = await realpath(root);
  if (excludeWorkspace && isWithin(await realpath(process.cwd()), resolvedRoot))
    throw failBackup('backup-path-inside-workspace');
  for (const value of [
    process.env.OneDrive,
    process.env.OneDriveCommercial,
    process.env.OneDriveConsumer,
  ].filter(Boolean)) {
    const resolved = await realpath(value).catch(() => path.resolve(value));
    if (isWithin(resolved, resolvedRoot))
      throw failBackup('backup-path-inside-synced-folder');
  }
  const directory = await mkdtemp(path.join(resolvedRoot, prefix));
  await protectPrivateDirectory(directory);
  return await realpath(directory);
}

export async function protectPrivateDirectory(directory) {
  if (process.platform === 'win32') {
    const script = `$ErrorActionPreference = 'Stop'
$taskIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$taskSystem = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$taskAcl = [System.Security.AccessControl.DirectorySecurity]::new()
$taskAcl.SetAccessRuleProtection($true, $false)
$taskAcl.SetOwner($taskIdentity)
foreach ($taskSid in @($taskIdentity, $taskSystem)) {
  $taskRule = [System.Security.AccessControl.FileSystemAccessRule]::new($taskSid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $taskAcl.AddAccessRule($taskRule)
}
Set-Acl -LiteralPath $env:PARTNER_HUB_BACKUP_PRIVATE_DIR -AclObject $taskAcl`;
    await captureProcess(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        env: processEnvironment({ PARTNER_HUB_BACKUP_PRIVATE_DIR: directory }),
        limit: 4096,
      },
    );
  } else await chmod(directory, 0o700);
}

export function defaultBackupRoots() {
  // Packaged desktop apps can redirect LOCALAPPDATA into disposable app caches.
  // Use the profile itself on Windows, avoiding all redirected AppData paths.
  const local =
    process.platform === 'win32'
      ? os.homedir()
      : process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share');
  return {
    backupRoot: path.join(local, 'PartnerHubBackups'),
    keyRoot: path.join(local, 'PartnerHubRecoveryKeys'),
  };
}

export async function removePrivateRestoreDirectory(directory) {
  const resolved = await realpath(directory);
  const tempRoot = await realpath(os.tmpdir());
  if (
    !isWithin(tempRoot, resolved) ||
    !path.basename(resolved).startsWith('partner-hub-restore-') ||
    resolved === tempRoot
  )
    throw failBackup('backup-local-cleanup-path-invalid');
  await rm(resolved, { recursive: true, force: false });
}

export async function prepareSnapshot(transaction) {
  await transaction.unsafe("SET LOCAL TIME ZONE 'UTC'");
  await transaction.unsafe("SET LOCAL DateStyle = 'ISO, MDY'");
  await transaction.unsafe("SET LOCAL IntervalStyle = 'postgres'");
  await transaction.unsafe('SET LOCAL extra_float_digits = 3');
  await transaction.unsafe("SET LOCAL bytea_output = 'hex'");
  await transaction.unsafe('SET LOCAL search_path = pg_catalog');
}

export function sourceConnection(config) {
  const url = new URL(config.databaseUrl);
  // The validated app uses transaction pooling at 6543. pg_dump/snapshot export
  // need a pinned session; Supabase documents the same pooler's 5432 endpoint.
  if (url.port !== '6543' || !url.hostname.endsWith('.pooler.supabase.com'))
    throw failBackup('backup-source-invalid');
  url.port = '5432';
  return {
    url: url.toString(),
    env: processEnvironment({
      PGHOST: url.hostname,
      PGPORT: '5432',
      PGDATABASE: 'postgres',
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGSSLMODE: 'require',
      PGCONNECT_TIMEOUT: '15',
      PGAPPNAME: 'partner-hub-readonly-backup',
      PGOPTIONS:
        '-c default_transaction_read_only=on -c statement_timeout=180000 -c lock_timeout=10000',
    }),
  };
}
