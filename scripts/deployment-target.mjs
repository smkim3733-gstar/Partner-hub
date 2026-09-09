// Offline configuration only. Never calls provider APIs or accepts secret values.
export class DeploymentTargetError extends Error {
  constructor(field) {
    super(`DEPLOYMENT_TARGET_INVALID: ${field}`);
  }
}
const invalid = (field) => {
  throw new DeploymentTargetError(field);
};
function object(value, fields, field) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !==
      [...fields].sort((a, b) => a.localeCompare(b)).join(',')
  )
    invalid(field);
  return value;
}
function match(value, pattern, field) {
  if (typeof value !== 'string' || !pattern.test(value)) invalid(field);
  return value;
}
const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
function httpsOrigin(value, field) {
  if (typeof value !== 'string') invalid(field);
  let url;
  try {
    url = new URL(value);
  } catch {
    invalid(field);
  }
  if (
    url.protocol !== 'https:' ||
    url.origin !== value ||
    url.username ||
    url.password ||
    url.hostname.endsWith('.chatgpt.site') ||
    url.hostname === 'chatgpt.site' ||
    url.port ||
    !url.hostname.includes('.') ||
    !/^[a-z0-9.-]+$/.test(url.hostname) ||
    url.hostname.split('.').some((label) => !dnsLabel.test(label)) ||
    /^[0-9.]+$/.test(url.hostname) ||
    url.hostname.endsWith('.localhost')
  )
    invalid(field);
  return value;
}
export function validateDeploymentTarget(value) {
  object(value, ['version', 'environment', 'vercel', 'cloudflare'], 'root');
  if (value.version !== 1) invalid('version');
  if (!['preview', 'production'].includes(value.environment))
    invalid('environment');
  const v = object(value.vercel, ['projectId', 'orgId', 'appOrigin'], 'vercel');
  const c = object(
    value.cloudflare,
    [
      'accountId',
      'workersSubdomain',
      'databaseId',
      'databaseName',
      'bucketName',
      'workers',
    ],
    'cloudflare',
  );
  const w = object(c.workers, ['d1', 'r2', 'files'], 'cloudflare.workers');
  const workers = Object.fromEntries(
    ['d1', 'r2', 'files'].map((key) => [
      key,
      match(w[key], dnsLabel, `cloudflare.workers.${key}`),
    ]),
  );
  if (new Set(Object.values(workers)).size !== 3) invalid('cloudflare.workers');
  const accountId = match(
    c.accountId,
    /^[a-f0-9]{32}$/,
    'cloudflare.accountId',
  );
  if (/^0+$/.test(accountId)) invalid('cloudflare.accountId');
  const databaseId = match(
    c.databaseId,
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,
    'cloudflare.databaseId',
  );
  if (/^[0-]+$/.test(databaseId)) invalid('cloudflare.databaseId');
  const bucketName = match(
    c.bucketName,
    /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/,
    'cloudflare.bucketName',
  );
  const workersSubdomain = match(
    c.workersSubdomain,
    dnsLabel,
    'cloudflare.workersSubdomain',
  );
  const appOrigin = httpsOrigin(v.appOrigin, 'vercel.appOrigin');
  const origins = Object.fromEntries(
    Object.entries(workers).map(([key, name]) => [
      key,
      `https://${name}.${workersSubdomain}.workers.dev`,
    ]),
  );
  if (Object.values(origins).includes(appOrigin)) invalid('vercel.appOrigin');
  return {
    version: 1,
    environment: value.environment,
    vercel: {
      projectId: match(
        v.projectId,
        /^prj_[A-Za-z0-9]{8,80}$/,
        'vercel.projectId',
      ),
      orgId: match(
        v.orgId,
        /^(?:team_|user_)[A-Za-z0-9]{8,80}$/,
        'vercel.orgId',
      ),
      appOrigin,
    },
    cloudflare: {
      accountId,
      workersSubdomain,
      databaseId,
      databaseName: match(
        c.databaseName,
        /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/,
        'cloudflare.databaseName',
      ),
      bucketName,
      workers,
    },
  };
}
export function assertDeploymentIsolation(candidate, other) {
  const a = validateDeploymentTarget(candidate);
  const b = validateDeploymentTarget(other);
  if (a.environment === b.environment) invalid('comparison.environment');
  if (a.vercel.appOrigin === b.vercel.appOrigin)
    invalid('comparison.appOrigin');
  if (a.cloudflare.accountId === b.cloudflare.accountId) {
    if (a.cloudflare.databaseId === b.cloudflare.databaseId)
      invalid('comparison.databaseId');
    if (a.cloudflare.bucketName === b.cloudflare.bucketName)
      invalid('comparison.bucketName');
    if (
      Object.values(a.cloudflare.workers).some((name) =>
        Object.values(b.cloudflare.workers).includes(name),
      )
    )
      invalid('comparison.workers');
  }
}
export function deploymentArtifacts(value) {
  const target = validateDeploymentTarget(value);
  const c = target.cloudflare;
  const origin = (role) =>
    `https://${c.workers[role]}.${c.workersSubdomain}.workers.dev`;
  const configFor = (role) => {
    return {
      name: c.workers[role],
      account_id: c.accountId,
      main: './worker.mjs',
      compatibility_date: '2026-08-26',
      compatibility_flags: ['nodejs_compat'],
      no_bundle: true,
      find_additional_modules: false,
      workers_dev: true,
      preview_urls: false,
      send_metrics: false,
      dependencies_instrumentation: { enabled: false },
      logpush: false,
      observability: { enabled: false },
      keep_vars: false,
      vars:
        role === 'd1'
          ? { D1_BRIDGE_ENABLED: '0' }
          : role === 'r2'
            ? { R2_BRIDGE_ENABLED: '0' }
            : {
                FILE_TRANSFER_ENABLED: '0',
                FILE_TRANSFER_APP_ORIGIN: target.vercel.appOrigin,
                FILE_TRANSFER_ORIGIN: origin('files'),
              },
      secrets: {
        required: [
          role === 'd1'
            ? 'D1_BRIDGE_SECRET'
            : role === 'r2'
              ? 'R2_BRIDGE_SECRET'
              : 'FILE_TRANSFER_SECRET',
        ],
      },
      ...(role !== 'r2'
        ? {
            d1_databases: [
              {
                binding: 'DB',
                database_id: c.databaseId,
                database_name: c.databaseName,
              },
            ],
          }
        : {}),
      ...(role !== 'd1'
        ? {
            r2_buckets: [
              { binding: 'AI_SOURCE_FILES', bucket_name: c.bucketName },
            ],
          }
        : {}),
    };
  };
  const configs = {
    d1: configFor('d1'),
    r2: configFor('r2'),
    files: configFor('files'),
  };
  return {
    target,
    configs,
    // Names/addresses only. Secret values must be registered separately.
    nextEnvironment: {
      PARTNER_HUB_NEXT_BACKEND: 'cloudflare-http-v1',
      PARTNER_HUB_BACKEND_ENABLED: '0',
      PARTNER_HUB_APP_ORIGIN: target.vercel.appOrigin,
      PARTNER_HUB_D1_ORIGIN: origin('d1'),
      PARTNER_HUB_R2_ORIGIN: origin('r2'),
      PARTNER_HUB_FILE_ORIGIN: origin('files'),
      ANTHROPIC_EXTERNAL_PROCESSING_ENABLED: 'false',
    },
    requiredNextSecrets: [
      'PARTNER_HUB_D1_SECRET',
      'PARTNER_HUB_R2_SECRET',
      'PARTNER_HUB_FILE_SECRET',
    ],
  };
}
