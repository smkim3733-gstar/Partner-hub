import { open, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import {
  isWithin,
  privateDirectory,
  protectPrivateDirectory,
} from './supabase-backup-runtime.mjs';
import {
  cleanupError,
  cleanupHash,
  cleanupConfirmation,
  validateCleanupPlan,
  planStagingCleanup,
  applyStagingCleanup,
} from './supabase-staging-cleanup-policy.mjs';
import {
  cleanupSettings,
  cleanupDatabase,
  createCleanupStorage,
} from './supabase-staging-cleanup-runtime.mjs';

export function cleanupArguments(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === '--help'))
    return { command: 'help' };
  const [command, flag, location] = args;
  if (
    args.length !== 3 ||
    !['plan', 'apply', 'reconcile'].includes(command) ||
    flag !== (command === 'plan' ? '--output-dir' : '--plan') ||
    !path.isAbsolute(location)
  )
    throw cleanupError('INVALID_ARGUMENTS');
  return { command, location };
}

export function cleanupJournal(directory) {
  let handle;
  return {
    async start(hash) {
      if (handle) throw cleanupError('PLAN_ALREADY_USED');
      try {
        handle = await open(
          path.join(directory, 'execution.jsonl'),
          'wx',
          0o600,
        );
      } catch {
        throw cleanupError('PLAN_ALREADY_USED');
      }
      await handle.writeFile(`${JSON.stringify({ state: 'started', hash })}\n`);
      await handle.sync();
    },
    async record(event) {
      if (!handle) throw cleanupError('JOURNAL_UNAVAILABLE');
      await handle.writeFile(`${JSON.stringify(event)}\n`);
      await handle.sync();
    },
    async close() {
      await handle?.close();
      handle = undefined;
    },
  };
}

async function readPlan(file) {
  const stat = await lstat(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > 65536 ||
    path.basename(file) !== 'plan.json'
  )
    throw cleanupError('INVALID_PLAN_FILE');
  const resolved = await realpath(file),
    directory = path.dirname(resolved);
  if (
    !path.basename(directory).startsWith('partner-hub-cleanup-') ||
    isWithin(await realpath(process.cwd()), directory)
  )
    throw cleanupError('UNSAFE_PLAN_LOCATION');
  for (const root of [
    process.env.OneDrive,
    process.env.OneDriveCommercial,
    process.env.OneDriveConsumer,
  ].filter(Boolean)) {
    if (
      isWithin(await realpath(root).catch(() => path.resolve(root)), directory)
    )
      throw cleanupError('UNSAFE_PLAN_LOCATION');
  }
  await protectPrivateDirectory(directory);
  const handle = await open(resolved, 'r');
  try {
    const buffer = Buffer.alloc(65537);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 65536) throw cleanupError('INVALID_PLAN_FILE');
    return {
      directory,
      plan: validateCleanupPlan(
        JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')),
      ),
    };
  } finally {
    await handle.close();
  }
}

export async function reconcileStagingCleanup(input, storage, signal) {
  const plan = validateCleanupPlan(input);
  await storage.assertPrivate(signal);
  const result = { reviewed: plan.candidates.length, present: 0, absent: 0 };
  for (const candidate of plan.candidates) {
    if (signal?.aborted) throw cleanupError('INTERRUPTED');
    // No removal or retry, even for an expired or previously attempted plan.
    const object = await storage.info(
      candidate.path,
      candidate.versionId,
      signal,
    );
    if (object === null) result.absent++;
    else if (object.versionId === candidate.versionId) result.present++;
    else throw cleanupError('VERSION_API_UNCONFIRMED');
  }
  return result;
}

export async function cleanupMain(args, env = process.env) {
  const parsed = cleanupArguments(args);
  if (parsed.command === 'help') {
    console.log(
      'Supabase staging cleanup (operator only)\n' +
        'plan --output-dir <absolute private folder outside workspace/OneDrive>\n' +
        'reconcile --plan <absolute plan.json>  (metadata only)\n' +
        'apply --plan <absolute plan.json>  (irreversible; approval and TTY confirmation required)\n' +
        'No default action, automatic retry, scheduled deletion, or policy change.\n' +
        'Apply briefly locks new upload reservations (maximum 60-second request window).',
    );
    return;
  }
  if (
    parsed.command === 'apply' &&
    (!process.stdin.isTTY || !process.stdout.isTTY)
  )
    throw cleanupError('TTY_REQUIRED');
  const settings = cleanupSettings(env),
    storage = createCleanupStorage(settings);
  const prior =
    parsed.command === 'plan' ? null : await readPlan(parsed.location);
  if (prior && cleanupHash(prior.plan.target) !== cleanupHash(settings.target))
    throw cleanupError('TARGET_MISMATCH');
  let confirmation;
  if (parsed.command === 'apply') {
    const prompt = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      console.log(
        JSON.stringify({
          target: prior.plan.target,
          candidates: prior.plan.candidates.length,
          counts: prior.plan.counts,
        }),
      );
      confirmation = await prompt.question(
        `Irreversible deletion; review plan.json first. Type exactly:\n${cleanupConfirmation(prior.plan)}\n> `,
      );
    } finally {
      prompt.close();
    }
    if (confirmation !== cleanupConfirmation(prior.plan))
      throw cleanupError('CONFIRMATION_REQUIRED');
  }
  const abort = new AbortController(),
    stop = () => abort.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const timer = setTimeout(stop, 60000);
  let database, journal;
  try {
    if (parsed.command === 'reconcile') {
      console.log(
        JSON.stringify(
          await reconcileStagingCleanup(prior.plan, storage, abort.signal),
        ),
      );
      return;
    }
    database = cleanupDatabase(settings);
    if (parsed.command === 'plan') {
      const plan = await planStagingCleanup(
        await database.snapshot(),
        storage,
        abort.signal,
      );
      const directory = await privateDirectory(
        parsed.location,
        'partner-hub-cleanup-',
      );
      const file = path.join(directory, 'plan.json'),
        handle = await open(file, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(plan, null, 2)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      console.log(
        JSON.stringify({
          file,
          hash: plan.hash,
          candidates: plan.candidates.length,
          counts: plan.counts,
        }),
      );
    } else {
      journal = cleanupJournal(prior.directory);
      console.log(
        JSON.stringify(
          await applyStagingCleanup(
            prior.plan,
            {
              withLock: database.withLock,
              storage,
              journal,
            },
            { confirmation, signal: abort.signal },
          ),
        ),
      );
    }
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    try {
      await journal?.close();
    } finally {
      await database?.close();
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  cleanupMain(process.argv.slice(2)).catch((error) => {
    const code = /^CLEANUP_[A-Z_]+$/.test(error?.message)
      ? error.message
      : 'CLEANUP_FAILED';
    console.error(code);
    process.exitCode = 1;
  });
}
