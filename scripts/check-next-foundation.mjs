import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire, register } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const remoteBuild = process.argv.includes('--remote');
const vercelBuild = process.argv.includes('--vercel');
const connectedBuild = remoteBuild || vercelBuild;
const secretKeys = vercelBuild
  ? ['TURSO_AUTH_TOKEN', 'BLOB_READ_WRITE_TOKEN']
  : [
      'PARTNER_HUB_D1_SECRET',
      'PARTNER_HUB_R2_SECRET',
      'PARTNER_HUB_FILE_SECRET',
    ];
if (vercelBuild)
  assert.equal(process.env.PARTNER_HUB_NEXT_BACKEND, 'vercel-storage-v1');
if (remoteBuild)
  assert.equal(process.env.PARTNER_HUB_NEXT_BACKEND, 'cloudflare-http-v1');
register('../tests/next-typescript-loader.mjs', import.meta.url);
const auth = await import('../lib/request-auth.ts');
const forgedHeaders = {
  'oai-authenticated-user-id': 'forged-owner',
  'oai-authenticated-user-email': 'owner@example.test',
  'oai-authenticated-user-full-name': encodeURIComponent('위조 관리자'),
  'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
  'cf-connecting-ip': '198.51.100.23',
  'x-forwarded-for': '198.51.100.24',
  'x-vercel-forwarded-for': '198.51.100.25',
};
const forgedRequest = new Request('http://127.0.0.1/', {
  headers: forgedHeaders,
});
assert.equal(auth.chatGPTIdentityFromRequest(forgedRequest), null);
assert.equal(
  auth.chatGPTDisplayNameFromRequest(forgedRequest, 'fallback'),
  'fallback',
);
assert.equal(auth.rateLimitClientKey(forgedRequest), 'shared-no-edge-ip');
console.log(
  'PASS Next auth ignores Sites identity and untrusted client IP headers.',
);

const outputRoot = join(root, '.next', 'server');
const outputFiles = await readdir(outputRoot, { recursive: true });
const traces = outputFiles.filter((file) => file.endsWith('.nft.json'));
assert.ok(traces.length > 0, 'Run build:next first.');
for (const file of traces) {
  const trace = JSON.parse(await readFile(join(outputRoot, file), 'utf8'));
  for (const dependency of trace.files)
    assert.doesNotMatch(
      dependency.replaceAll('\\', '/'),
      /(?:\/dev\/next-local\/|\/wrangler\/|\/miniflare\/|\/workerd\/)/,
      `Development runtime leaked into production trace: ${file}`,
    );
}
let remoteRuntimeFound = false;
for (const file of outputFiles.filter((file) => file.endsWith('.js'))) {
  const source = await readFile(join(outputRoot, file), 'utf8');
  assert.doesNotMatch(
    source,
    /standalone_admin_recovery_audit|ADMIN_RECOVERY_REUSED_PASSWORD/,
    `Operator-only recovery code reached the deployed server: ${file}`,
  );
  if (connectedBuild) {
    remoteRuntimeFound ||= source.includes('standalone_admin_accounts');
    assert.doesNotMatch(
      source,
      /createLocalFileHttpBridge|createLocalR2Bucket|createLocalR2HttpBridge/,
    );
    // Runtime secrets must not be compiled into either server or client output.
    if (vercelBuild)
      assert.doesNotMatch(
        source,
        /internal\/d1\/v1\/batch|internal\/r2\/v1\/object|createNextD1HttpDatabase|createNextR2HttpBucket/,
      );
    for (const key of secretKeys) {
      assert.ok((process.env[key] ?? '').length >= 16);
      assert.equal(
        source.includes(process.env[key]),
        false,
        `Compiled secret in ${file}`,
      );
    }
  } else {
    assert.doesNotMatch(
      source,
      /standalone_admin_accounts|standalone_admin_sessions|D1_BRIDGE_SECRET|internal\/d1\/v1\/batch|createLocalFileHttpBridge|createLocalR2Bucket|FILE_TRANSFER_SECRET|createLocalR2HttpBridge|R2_BRIDGE_SECRET|internal\/r2\/v1\/object/,
      `Unconfigured migration backend leaked into production bundle: ${file}`,
    );
  }
}
if (connectedBuild) {
  assert.ok(remoteRuntimeFound, 'Build remote mode before checking it.');
  const staticRoot = join(root, '.next', 'static');
  for (const file of await readdir(staticRoot, { recursive: true })) {
    if (!/\.(?:js|map|json)$/.test(file)) continue;
    const source = await readFile(join(staticRoot, file), 'utf8');
    assert.doesNotMatch(
      source,
      /PARTNER_HUB_(?:D1|R2|FILE)_SECRET|standalone_admin_accounts|internal\/d1\/v1\/batch|internal\/r2\/v1\/object/,
      `Server-only backend code reached public output: ${file}`,
    );
    for (const key of secretKeys)
      assert.equal(
        source.includes(process.env[key]),
        false,
        `Public secret in ${file}`,
      );
  }
  console.log(
    'PASS remote production traces exclude emulators; service secrets remain runtime-only and absent from public assets.',
  );
} else
  console.log(
    'PASS production excludes local emulators, local admin and unconfigured D1/R2 bridges.',
  );

// Bind only loopback, use an ephemeral port, and stop only our own child server.
const portProbe = createServer();
portProbe.listen(0, '127.0.0.1');
await once(portProbe, 'listening');
const port = portProbe.address().port;
await new Promise((resolve, reject) =>
  portProbe.close((error) => (error ? reject(error) : resolve())),
);
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    require.resolve('next/dist/bin/next'),
    'start',
    '--hostname',
    '127.0.0.1',
    '--port',
    String(port),
  ],
  {
    cwd: root,
    // Even a mistakenly carried local opt-in must not unlock production APIs.
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PARTNER_HUB_LOCAL_STORAGE: connectedBuild ? '0' : '1',
      PARTNER_HUB_LOCAL_D1_HTTP: '1',
      PARTNER_HUB_LOCAL_R2_HTTP: '1',
      PARTNER_HUB_LOCAL_FILE_HTTP: '1',
      ...(connectedBuild ? { PARTNER_HUB_BACKEND_ENABLED: '0' } : {}),
      NEXT_TELEMETRY_DISABLED: '1',
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let logs = '';
let spawnError;
server.on('error', (error) => {
  spawnError = error;
});
for (const stream of [server.stdout, server.stderr])
  stream.on('data', (chunk) => {
    logs = (logs + chunk.toString()).slice(-12_000);
  });
const stopped = new Promise((resolve) => {
  server.once('exit', resolve);
  server.once('error', resolve);
});
let checks = 0;

async function request(path, options = {}) {
  return fetch(new URL(path, baseUrl), {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
    ...options,
  });
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null) throw new Error(`Next exited early: ${logs}`);
    if (logs.includes('Ready in')) {
      ready = true;
      break;
    }
    await delay(250);
  }
  assert.ok(ready, `Next did not start. Run build:next first. ${logs}`);
  for (const path of ['/', '/account', '/account/setup']) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('x-powered-by'), null);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(
      response.headers.get('content-security-policy') ?? '',
      /frame-ancestors 'none'/,
    );
    const html = await response.text();
    assert.doesNotMatch(html, /대표 관리자 · 기존 ChatGPT 로그인/);
    if (path === '/account') {
      const css = html.match(/href="([^"]+\.css(?:\?[^"]*)?)"/);
      assert.ok(css, 'The account page must include the built stylesheet.');
      const stylesheet = await request(css[1].replaceAll('&amp;', '&'));
      assert.equal(stylesheet.status, 200);
      assert.ok((await stylesheet.text()).length > 100);
    }
    console.log(`PASS ${path}: HTML, security headers, no Sites sign-in.`);
    checks++;
  }

  const apiRoot = join(root, 'app', 'api');
  const routes = (await readdir(apiRoot, { recursive: true }))
    .filter((entry) => entry.endsWith('route.ts'))
    .map((entry) =>
      `/api/${relative(apiRoot, dirname(join(apiRoot, entry)))}`
        .replaceAll('\\', '/')
        .replace(/\[[^\]]+\]/g, 'migration-smoke-id'),
    );
  assert.ok(routes.length >= 22);
  for (const path of routes) {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      // Forged edge headers and a syntactically valid session cannot bypass the gate.
      const response = await request(path, {
        method,
        headers: {
          ...forgedHeaders,
          cookie: `keve_local_session=${'a'.repeat(64)}`,
        },
      });
      assert.equal(response.status, 503, `${method} ${path}`);
      assert.equal(
        response.headers.get('cache-control'),
        'private, no-store, max-age=0',
      );
      assert.equal(response.headers.get('set-cookie'), null);
      assert.deepEqual(Object.keys(await response.clone().json()).sort(), [
        'code',
        'error',
      ]);
      assert.equal(
        (await response.json()).code,
        'MIGRATION_BACKEND_NOT_CONFIGURED',
      );
      checks++;
    }
  }
  console.log(
    `PASS ${routes.length} API paths: all five methods fail closed before backend access.`,
  );
  console.log(
    `Next migration foundation verified: ${checks} production HTTP checks plus auth boundary checks.`,
  );
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    server.kill('SIGTERM');
    const timeout = delay(10_000, 'timeout', { ref: false });
    if ((await Promise.race([stopped, timeout])) === 'timeout') {
      server.kill('SIGKILL');
      await stopped;
    }
  }
}
