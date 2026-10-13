// Metadata-only reads; the sole remote mutation is explicit version-addressed
// Storage API deletion. Application/Storage SQL rows are never mutated.
import postgres from 'postgres';
import {
  cleanupError,
  cleanupHash,
  cleanupLimits,
  cleanupObject,
  cleanupTarget,
} from './supabase-staging-cleanup-policy.mjs';

const stagePath =
  /^partner-hub\/staging\/v1\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const objectVersion =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function demand(value, code = 'INVALID_CONFIG') {
  if (!value) throw cleanupError(code);
}

export function cleanupSettings(env) {
  demand(env.PARTNER_HUB_NEXT_BACKEND === 'supabase-v1');
  demand(
    typeof env.SUPABASE_URL === 'string' &&
      /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(env.SUPABASE_URL),
  );
  const projectRef = new URL(env.SUPABASE_URL).hostname.split('.')[0];
  const target = cleanupTarget({
    projectRef,
    bucket: env.SUPABASE_STORAGE_BUCKET,
  });
  demand(
    typeof env.SUPABASE_SECRET_KEY === 'string' &&
      /^sb_secret_[A-Za-z0-9_-]{16,512}$/.test(env.SUPABASE_SECRET_KEY),
  );
  let url;
  try {
    url = new URL(env.SUPABASE_DATABASE_URL);
  } catch {
    throw cleanupError('INVALID_CONFIG');
  }
  demand(
    url.protocol === 'postgresql:' &&
      /^aws-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
      url.port === '6543' &&
      decodeURIComponent(url.username) === `postgres.${projectRef}` &&
      url.password.length > 0 &&
      url.pathname === '/postgres' &&
      !url.hash &&
      [...url.searchParams].every(
        ([k, v]) => k === 'sslmode' && v === 'require',
      ),
  );
  // Session pooling preserves transaction/advisory/table locks for this tool.
  url.port = '5432';
  return {
    target,
    url: env.SUPABASE_URL,
    secret: env.SUPABASE_SECRET_KEY,
    databaseUrl: url.toString(),
  };
}

export function createCleanupStorage(settings, fetcher = fetch) {
  const target = cleanupTarget(settings.target);
  demand(
    settings.url === `https://${target.projectRef}.supabase.co` &&
      typeof settings.secret === 'string' &&
      /^sb_secret_[A-Za-z0-9_-]{16,512}$/.test(settings.secret),
  );
  const base = `${settings.url}/storage/v1`,
    bucket = target.bucket;
  async function request(path, init, signal) {
    try {
      const response = await fetcher(`${base}${path}`, {
        ...init,
        headers: {
          apikey: settings.secret,
          ...(init?.body ? { 'content-type': 'application/json' } : {}),
        },
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.any([
          AbortSignal.timeout(10_000),
          ...(signal ? [signal] : []),
        ]),
      });
      if (!response.body) throw cleanupError('PROVIDER_RESPONSE');
      const reader = response.body.getReader(),
        chunks = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 65536) throw cleanupError('PROVIDER_RESPONSE');
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      return {
        status: response.status,
        value: JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            Buffer.concat(chunks),
          ),
        ),
      };
    } catch {
      throw cleanupError('PROVIDER_RESPONSE');
    }
  }
  return {
    async assertPrivate(signal) {
      const { status, value } = await request(`/bucket/${bucket}`, {}, signal);
      demand(
        status === 200 &&
          value?.id === bucket &&
          value.public === false &&
          Number.isSafeInteger(value.file_size_limit) &&
          value.file_size_limit > 0 &&
          value.file_size_limit <= 25 * 1024 * 1024 &&
          Array.isArray(value.allowed_mime_types) &&
          value.allowed_mime_types.length === 1 &&
          value.allowed_mime_types[0] === 'application/octet-stream',
        'BUCKET_UNSAFE',
      );
    },
    /** @param {string} path @param {string|null} [versionId] @param {AbortSignal} [signal] */
    async info(path, versionId = null, signal) {
      demand(
        typeof path === 'string' &&
          stagePath.test(path) &&
          (versionId === null ||
            (typeof versionId === 'string' && objectVersion.test(versionId))),
        'INVALID_PATH',
      );
      const query = versionId
        ? `?versionId=${encodeURIComponent(versionId)}`
        : '';
      const { status, value } = await request(
        `/object/info/authenticated/${bucket}/${path}${query}`,
        {},
        signal,
      );
      if (
        [400, 404].includes(status) &&
        ['NoSuchKey', 'NoSuchVersion'].includes(value?.code)
      )
        return null;
      demand(
        status === 200 &&
          value?.name === path &&
          value.bucket_id === bucket &&
          value.content_type === 'application/octet-stream' &&
          typeof value.last_modified === 'string' &&
          value.is_delete_marker !== true,
        'PROVIDER_RESPONSE',
      );
      const object = cleanupObject(
        {
          path,
          versionId: value.version ?? null,
          etag: value.etag,
          size: value.size,
          modifiedAt: Date.parse(value.last_modified),
        },
        path,
      );
      demand(
        versionId === null || object.versionId === versionId,
        'VERSION_API_UNCONFIRMED',
      );
      return object;
    },
    async removeVersion(path, versionId, signal) {
      demand(
        typeof path === 'string' &&
          stagePath.test(path) &&
          typeof versionId === 'string' &&
          objectVersion.test(versionId),
        'INVALID_PATH',
      );
      // Never send a string prefix: that would delete whichever version is current.
      // https://supabase.com/docs/reference/javascript/file-buckets-remove
      const { status, value } = await request(
        `/object/${bucket}`,
        {
          method: 'DELETE',
          body: JSON.stringify({ prefixes: [{ path, versionId }] }),
        },
        signal,
      );
      demand(
        status === 200 &&
          Array.isArray(value) &&
          value.length === 1 &&
          value[0]?.name === path &&
          value[0]?.version === versionId,
        'OUTCOME_UNKNOWN',
      );
    },
  };
}

export async function readCleanupSnapshot(transaction, target) {
  const time = await transaction.unsafe(
    'SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms',
  );
  const rows =
    await transaction.unsafe(`SELECT id,file_path,audio_path,created_at,expires_at,retain_until
    FROM partner_hub.supabase_file_transfers ORDER BY id LIMIT ${cleanupLimits.rows + 1}`);
  demand(rows.length <= cleanupLimits.rows, 'INVENTORY_LIMIT');
  const unsafe = await transaction.unsafe(`SELECT EXISTS (
    SELECT 1 FROM partner_hub.storage_object_versions WHERE physical_path LIKE 'partner-hub/staging/%'
  ) AS referenced`);
  demand(
    unsafe.length === 1 && unsafe[0].referenced === false,
    'BUSINESS_REFERENCE',
  );
  const number = (n) => {
    demand(
      typeof n === 'number' || (typeof n === 'string' && /^[0-9]+$/.test(n)),
      'INVALID_RESERVATION',
    );
    const value = Number(n);
    demand(Number.isSafeInteger(value), 'INVALID_RESERVATION');
    return value;
  };
  demand(time.length === 1, 'INVALID_CLOCK');
  return {
    target,
    now: number(time[0].now_ms),
    rows: rows.map((r) => ({
      id: r.id,
      file_path: r.file_path,
      audio_path: r.audio_path,
      created_at: number(r.created_at),
      expires_at: number(r.expires_at),
      retain_until: number(r.retain_until),
    })),
  };
}

export function cleanupDatabase(settings, connect = postgres) {
  cleanupTarget(settings.target);
  const sql = connect(settings.databaseUrl, {
    ssl: 'require',
    max: 1,
    prepare: false,
    fetch_types: false,
    onnotice: () => {},
    connect_timeout: 15,
    idle_timeout: 10,
    max_lifetime: 0,
  });
  const lockHash = cleanupHash(settings.target);
  const keys = [0, 8].map(
    (start) => parseInt(lockHash.slice(start, start + 8), 16) | 0,
  );
  async function configure(tx) {
    await tx.unsafe("SET LOCAL statement_timeout = '10000'");
    await tx.unsafe("SET LOCAL lock_timeout = '2000'");
    await tx.unsafe("SET LOCAL idle_in_transaction_session_timeout = '70000'");
  }
  return {
    snapshot: () =>
      sql.begin('isolation level repeatable read read only', async (tx) => {
        await configure(tx);
        return readCleanupSnapshot(tx, settings.target);
      }),
    // READ COMMITTED avoids an old snapshot established by the advisory SELECT
    // before SHARE is acquired. Once SHARE is held, both inventories are stable.
    withLock: (run) =>
      sql.begin('isolation level read committed', async (tx) => {
        await configure(tx);
        const locked = await tx.unsafe(
          'SELECT pg_try_advisory_xact_lock($1::int,$2::int) AS locked',
          keys,
        );
        demand(locked.length === 1 && locked[0].locked === true, 'BUSY');
        // SHARE blocks new reservations while checking all cross-slot references.
        // Existing finish/download reads are not blocked. No rows are changed.
        await tx.unsafe(
          'LOCK TABLE partner_hub.supabase_file_transfers, partner_hub.storage_object_versions IN SHARE MODE NOWAIT',
        );
        return run(() => readCleanupSnapshot(tx, settings.target));
      }),
    close: () => sql.end({ timeout: 1 }),
  };
}
