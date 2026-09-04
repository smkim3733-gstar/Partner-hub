import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  PRIVATE_RESPONSE_CACHE_CONTROL,
  privateJsonResponse,
  privateResponseHeaders,
} from '../lib/private-response';

function assertPrivateHeaders(headers: Headers) {
  assert.equal(headers.get('cache-control'), PRIVATE_RESPONSE_CACHE_CONTROL);
  assert.equal(headers.get('expires'), '0');
  assert.equal(headers.get('pragma'), 'no-cache');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const location = path.join(directory, entry.name);
      return entry.isDirectory()
        ? sourceFiles(location)
        : Promise.resolve(entry.name.endsWith('.ts') ? [location] : []);
    }),
  );
  return files.flat();
}

void test('private response headers cannot be weakened by a caller', () => {
  const headers = privateResponseHeaders({
    'cache-control': 'public, max-age=86400',
    expires: 'Wed, 01 Jan 2031 00:00:00 GMT',
    'referrer-policy': 'unsafe-url',
    'x-content-type-options': 'invalid',
    'x-operation-id': 'preserved',
  });
  assertPrivateHeaders(headers);
  assert.equal(headers.get('x-operation-id'), 'preserved');
});

void test('private JSON responses preserve status and required operation headers', async () => {
  const response = privateJsonResponse(
    { error: '요청이 많습니다.' },
    {
      status: 429,
      headers: {
        'retry-after': '900',
        'set-cookie': '__Host-example=; Path=/; Secure; HttpOnly; Max-Age=0',
      },
    },
  );
  assert.equal(response.status, 429);
  assertPrivateHeaders(response.headers);
  assert.equal(response.headers.get('retry-after'), '900');
  assert.match(response.headers.get('set-cookie') || '', /Secure; HttpOnly/);
  assert.deepEqual(await response.json(), { error: '요청이 많습니다.' });
});

void test('API JSON routes stay behind the shared private response boundary', async () => {
  const root = process.cwd();
  for (const file of await sourceFiles(path.resolve(root, 'app/api'))) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(
      source,
      /Response\.json\s*\(/,
      `${path.relative(root, file)}: direct JSON response`,
    );
  }
  for (const file of [
    'lib/consulting-flow-store.ts',
    'lib/file-inventory-store.ts',
    'lib/file-recovery-store.ts',
    'lib/password-store.ts',
  ]) {
    const source = await readFile(path.resolve(root, file), 'utf8');
    assert.doesNotMatch(
      source,
      /Response\.json\s*\(/,
      `${file}: direct JSON response`,
    );
    assert.match(source, /privateJsonResponse/);
  }
});
