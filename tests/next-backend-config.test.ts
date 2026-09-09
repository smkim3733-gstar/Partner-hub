import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nextRemoteBackendSelected } from '../lib/next-backend-policy.mjs';
import {
  readNextBackendConfig,
  nextBackendRequestAllowed,
  nextBackendRequiresDirectTransfer,
  NextBackendConfigError,
} from '../lib/next-backend-config';
import { serverRequestGate } from '../lib/platform-server-gate';

const environment: Record<string, string> = {
  PARTNER_HUB_NEXT_BACKEND: 'cloudflare-http-v1',
  PARTNER_HUB_BACKEND_ENABLED: '1',
  PARTNER_HUB_APP_ORIGIN: 'https://app.synthetic.invalid',
  PARTNER_HUB_D1_ORIGIN: 'https://d1.synthetic.invalid',
  PARTNER_HUB_D1_SECRET: Buffer.from(randomBytes(32)).toString('hex'),
  PARTNER_HUB_R2_ORIGIN: 'https://r2.synthetic.invalid',
  PARTNER_HUB_R2_SECRET: Buffer.from(randomBytes(32)).toString('hex'),
  PARTNER_HUB_FILE_ORIGIN: 'https://files.synthetic.invalid',
  PARTNER_HUB_FILE_SECRET: Buffer.from(randomBytes(32)).toString('hex'),
};
const invalid = (error: unknown) =>
  error instanceof NextBackendConfigError &&
  error.message === 'NEXT_BACKEND_NOT_CONFIGURED';
void test('remote byte routes block GET and implicit HEAD without blocking metadata or JSON commands', () => {
  const origin = environment.PARTNER_HUB_APP_ORIGIN;
  for (const path of [
    '/api/files/test',
    '/api/files/test/',
    '/api/consulting-flow/case/files/test',
  ])
    for (const method of ['GET', 'HEAD'])
      assert.equal(
        nextBackendRequiresDirectTransfer(
          new Request(origin + path, { method }),
        ),
        true,
      );
  for (const path of [
    '/api/files',
    '/api/file-transfers',
    '/api/consulting-flow/case',
    '/api/admin/file-inventory/id/presence',
  ])
    assert.equal(
      nextBackendRequiresDirectTransfer(new Request(origin + path)),
      false,
    );
  assert.equal(
    nextBackendRequiresDirectTransfer(
      new Request(origin + '/api/file-transfers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    ),
    false,
  );
  assert.equal(
    nextBackendRequiresDirectTransfer(
      new Request(origin + '/api/files', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=synthetic' },
      }),
    ),
    true,
  );
});
void test('remote Next backend requires explicit build selection and separate runtime opt-in', () => {
  for (const value of [undefined, '', 'disabled'])
    assert.equal(
      nextRemoteBackendSelected({ PARTNER_HUB_NEXT_BACKEND: value }),
      false,
    );
  assert.throws(
    () => nextRemoteBackendSelected({ PARTNER_HUB_NEXT_BACKEND: 'typo' }),
    /Invalid Next backend mode/,
  );
  assert.throws(
    () =>
      nextRemoteBackendSelected({
        ...environment,
        PARTNER_HUB_LOCAL_STORAGE: '1',
      }),
    /cannot be combined/,
  );
  assert.equal(nextRemoteBackendSelected(environment), true);
  assert.throws(
    () =>
      readNextBackendConfig({
        ...environment,
        PARTNER_HUB_BACKEND_ENABLED: '0',
      }),
    invalid,
  );
  assert.throws(
    () =>
      readNextBackendConfig({ ...environment, PARTNER_HUB_LOCAL_STORAGE: '1' }),
    invalid,
  );
  assert.throws(() => readNextBackendConfig({}), invalid);
});
void test('remote Next config keeps D1, R2 and browser transfer credentials independent', () => {
  const config = readNextBackendConfig(environment);
  assert.equal(config.appOrigin, environment.PARTNER_HUB_APP_ORIGIN);
  assert.equal(config.d1.secret, environment.PARTNER_HUB_D1_SECRET);
  assert.equal(config.r2.secret, environment.PARTNER_HUB_R2_SECRET);
  assert.equal(config.transfer.secret, environment.PARTNER_HUB_FILE_SECRET);
  assert.equal(config.transfer.allowLoopback, undefined);
  assert.throws(
    () =>
      readNextBackendConfig({
        ...environment,
        PARTNER_HUB_R2_SECRET: environment.PARTNER_HUB_D1_SECRET,
      }),
    invalid,
  );
  assert.throws(
    () =>
      readNextBackendConfig({
        ...environment,
        PARTNER_HUB_FILE_SECRET: environment.PARTNER_HUB_R2_SECRET,
      }),
    invalid,
  );
});
void test('remote Next configuration rejects every missing or malformed field without leaking values', () => {
  for (const name of Object.keys(environment)) {
    const missing = { ...environment };
    delete missing[name];
    assert.throws(() => readNextBackendConfig(missing), invalid, name);
  }
  for (const name of [
    'PARTNER_HUB_D1_SECRET',
    'PARTNER_HUB_R2_SECRET',
    'PARTNER_HUB_FILE_SECRET',
  ])
    for (const value of [
      '',
      'private-short-value',
      'f'.repeat(63),
      'g'.repeat(64),
      'F'.repeat(64),
    ])
      assert.throws(
        () => readNextBackendConfig({ ...environment, [name]: value }),
        invalid,
      );
});
void test('remote Next origins must be exact HTTPS origins and isolated service hosts', () => {
  const names = [
    'PARTNER_HUB_APP_ORIGIN',
    'PARTNER_HUB_D1_ORIGIN',
    'PARTNER_HUB_R2_ORIGIN',
    'PARTNER_HUB_FILE_ORIGIN',
  ];
  for (const name of names) {
    for (const value of [
      'http://127.0.0.1:3001',
      'http://insecure.example.test',
      'https://example.test/',
      'https://example.test/path',
      'https://user:password@example.test',
      'https://example.test?secret=private',
      'https://example.test#private',
      ' https://example.test',
      'javascript:alert(1)',
    ])
      assert.throws(
        () => readNextBackendConfig({ ...environment, [name]: value }),
        invalid,
      );
    for (const other of names.filter((other) => other !== name))
      assert.throws(
        () =>
          readNextBackendConfig({ ...environment, [name]: environment[other] }),
        invalid,
      );
  }
});
void test('remote request boundary uses the configured origin, never forged forwarding or Sites headers', () => {
  const config = readNextBackendConfig(environment);
  assert.equal(
    nextBackendRequestAllowed(
      new Request(config.appOrigin + '/api/state'),
      config,
    ),
    true,
  );
  const forged = {
    origin: config.appOrigin,
    host: new URL(config.appOrigin).host,
    'x-forwarded-host': new URL(config.appOrigin).host,
    'x-forwarded-proto': 'https',
    'oai-authenticated-user-id': 'synthetic-owner',
  };
  assert.equal(
    nextBackendRequestAllowed(
      new Request('https://attacker.synthetic.invalid/api/state', {
        headers: forged,
      }),
      config,
    ),
    false,
  );
  assert.equal(
    nextBackendRequestAllowed(
      new Request('http://app.synthetic.invalid/api/state', {
        headers: forged,
      }),
      config,
    ),
    false,
  );
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(
      nextBackendRequestAllowed(
        new Request(config.appOrigin + '/api/state', { method }),
        config,
      ),
      false,
    );
    assert.equal(
      nextBackendRequestAllowed(
        new Request(config.appOrigin + '/api/state', {
          method,
          headers: { origin: config.appOrigin },
        }),
        config,
      ),
      true,
    );
    assert.equal(
      nextBackendRequestAllowed(
        new Request(config.appOrigin + '/api/state', {
          method,
          headers: {
            origin: config.appOrigin,
            'sec-fetch-site': ' Cross-Site ',
          },
        }),
        config,
      ),
      false,
    );
  }
  assert.equal(
    nextBackendRequestAllowed(
      new Request(config.appOrigin + '/api/state', {
        headers: { origin: 'null' },
      }),
      config,
    ),
    false,
  );
  assert.equal(
    nextBackendRequestAllowed(
      new Request(config.appOrigin + '/api/state', {
        headers: { origin: 'https://attacker.synthetic.invalid' },
      }),
      config,
    ),
    false,
  );
});
void test('default Sites gate never reads remote credentials or alters original request handling', () => {
  assert.equal(
    serverRequestGate(
      new Request('https://original.synthetic.invalid/api/state'),
    ),
    null,
  );
});
void test('remote admin CLI rejects non-interactive provisioning and password arguments before connecting', () => {
  const script = new URL('../scripts/admin-next-remote.mjs', import.meta.url);
  for (const args of [[], ['synthetic-password-not-a-real-secret']]) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(script), ...args],
      {
        encoding: 'utf8',
        env: { ...process.env, PARTNER_HUB_NEXT_BACKEND: 'disabled' },
        timeout: 10000,
        windowsHide: true,
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /대화형 터미널/);
    assert.doesNotMatch(result.stderr, /synthetic-password-not-a-real-secret/);
  }
});
