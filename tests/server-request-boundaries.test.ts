import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { JsonRequestError, readBoundedJsonObject } from '../lib/request-json';

function request(
  body: BodyInit | null,
  contentType = 'application/json',
  headers: Record<string, string> = {},
) {
  return new Request('http://localhost/api/test', {
    method: 'POST',
    headers: { 'content-type': contentType, ...headers },
    body,
  });
}

async function rejectedStatus(promise: Promise<unknown>) {
  try {
    await promise;
    assert.fail('request should be rejected');
  } catch (error) {
    assert.ok(error instanceof JsonRequestError);
    return error.status;
  }
}

void test('bounded JSON reader accepts only a JSON object within the byte limit', async () => {
  assert.deepEqual(
    await readBoundedJsonObject(
      request('{"value":"가상"}', 'application/json; charset=utf-8'),
      100,
    ),
    { value: '가상' },
  );
  for (const body of ['', '{', 'null', '[]', '"text"'])
    assert.equal(
      await rejectedStatus(readBoundedJsonObject(request(body), 100)),
      400,
    );
  assert.equal(
    await rejectedStatus(
      readBoundedJsonObject(request('{}', 'text/plain'), 100),
    ),
    415,
  );
});

void test('bounded JSON reader enforces declared and streamed byte limits', async () => {
  assert.equal(
    await rejectedStatus(
      readBoundedJsonObject(
        request('{}', 'application/json', { 'content-length': '101' }),
        100,
      ),
    ),
    413,
  );
  assert.equal(
    await rejectedStatus(
      readBoundedJsonObject(
        request('{"value":"0123456789"}', 'application/json', {
          'content-length': '1',
        }),
        10,
      ),
    ),
    413,
  );
  assert.equal(
    await rejectedStatus(
      readBoundedJsonObject(
        request('{}', 'application/json', { 'content-length': 'invalid' }),
        100,
      ),
    ),
    400,
  );
});

async function routeFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const item = path.join(directory, entry.name);
      return entry.isDirectory()
        ? routeFiles(item)
        : Promise.resolve(entry.name === 'route.ts' ? [item] : []);
    }),
  );
  return nested.flat();
}

void test('API routes cannot parse unbounded request JSON or text directly', async () => {
  const apiRoot = path.resolve(process.cwd(), 'app/api');
  const offenders: string[] = [];
  for (const file of await routeFiles(apiRoot)) {
    const source = await readFile(file, 'utf8');
    if (/request\.(?:json|text)\s*\(/.test(source))
      offenders.push(path.relative(process.cwd(), file));
  }
  assert.deepEqual(offenders, []);
});
