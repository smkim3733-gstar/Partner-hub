import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { JsonRequestError, readBoundedJsonObject } from '../lib/request-json';
import {
  MultipartRequestError,
  readBoundedMultipartFormData,
} from '../lib/request-multipart';
import {
  QueryRequestError,
  readExactQueryFlag,
  readSingleQueryParam,
} from '../lib/request-query';

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

async function rejectedMultipartStatus(promise: Promise<unknown>) {
  try {
    await promise;
    assert.fail('multipart request should be rejected');
  } catch (error) {
    assert.ok(error instanceof MultipartRequestError);
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
  for (const contentType of [
    'application/jsonx',
    'text/plain; profile=application/json',
    'multipart/form-data',
  ])
    assert.equal(
      await rejectedStatus(
        readBoundedJsonObject(request('{}', contentType), 100),
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

void test('bounded multipart reader validates media type, framing and byte limits', async () => {
  const form = new FormData();
  form.set('value', '가상');
  const parsed = await readBoundedMultipartFormData(
    new Request('http://localhost/api/test', { method: 'POST', body: form }),
    10_000,
  );
  assert.equal(parsed.get('value'), '가상');

  for (const contentType of [
    'multipart/form-datax; boundary=test',
    'text/plain; profile=multipart/form-data',
  ])
    assert.equal(
      await rejectedMultipartStatus(
        readBoundedMultipartFormData(request('--test--', contentType), 10_000),
      ),
      415,
    );

  assert.equal(
    await rejectedMultipartStatus(
      readBoundedMultipartFormData(
        request('--test--', 'multipart/form-data'),
        10_000,
      ),
    ),
    400,
  );
  const invalidLength = new Request('http://localhost/api/test', {
    method: 'POST',
    body: new FormData(),
  });
  invalidLength.headers.set('content-length', 'invalid');
  assert.equal(
    await rejectedMultipartStatus(
      readBoundedMultipartFormData(invalidLength, 10_000),
    ),
    400,
  );
  assert.equal(
    await rejectedMultipartStatus(
      readBoundedMultipartFormData(
        new Request('http://localhost/api/test', {
          method: 'POST',
          body: new FormData(),
        }),
        10,
      ),
    ),
    413,
  );
});

void test('query reader accepts one bounded value and rejects ambiguous flags', () => {
  assert.equal(
    readSingleQueryParam(new URL('http://localhost/api/test'), 'caseId', 10),
    null,
  );
  assert.equal(
    readSingleQueryParam(
      new URL('http://localhost/api/test?caseId=case-1'),
      'caseId',
      10,
    ),
    'case-1',
  );
  for (const url of [
    new URL('http://localhost/api/test?caseId=first&caseId=second'),
    new URL('http://localhost/api/test?caseId=too-long-value'),
  ])
    assert.throws(
      () => readSingleQueryParam(url, 'caseId', 10),
      QueryRequestError,
    );
  assert.equal(
    readExactQueryFlag(new URL('http://localhost/api/test'), 'download'),
    false,
  );
  assert.equal(
    readExactQueryFlag(
      new URL('http://localhost/api/test?download=1'),
      'download',
    ),
    true,
  );
  for (const url of [
    new URL('http://localhost/api/test?download=false'),
    new URL('http://localhost/api/test?download=1&download=1'),
  ])
    assert.throws(() => readExactQueryFlag(url, 'download'), QueryRequestError);
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

void test('legacy JSON consumers remain routed through the shared bounded reader', async () => {
  const expected = [
    [
      'app/api/application-draft/route.ts',
      'readFlowJsonObject(request, 40_000)',
    ],
    ['lib/file-recovery-store.ts', 'readFlowJsonObject(request, 5000)'],
    ['lib/consulting-flow-http.ts', 'readFlowJsonObject(request, 400_000)'],
    ['lib/password-store.ts', 'readBoundedJsonObject(request, 12_000)'],
  ] as const;
  for (const [file, boundary] of expected) {
    const source = await readFile(path.resolve(process.cwd(), file), 'utf8');
    assert.ok(
      source.includes(boundary),
      `${file}: missing shared JSON boundary`,
    );
  }
});

void test('multipart consumers remain routed through the shared bounded reader', async () => {
  const expected = [
    ['app/api/files/route.ts', 'readFlowMultipartFormData('],
    ['lib/consulting-flow-http.ts', 'readFlowMultipartFormData(request,'],
  ] as const;
  for (const [file, boundary] of expected) {
    const source = await readFile(path.resolve(process.cwd(), file), 'utf8');
    assert.ok(source.includes(boundary), `${file}: missing multipart boundary`);
    if (file.startsWith('app/api/'))
      assert.doesNotMatch(source, /\.formData\(/);
  }
});

void test('API query consumers remain routed through the shared bounded reader', async () => {
  const expected = [
    ['lib/file-inventory-store.ts', "readSingleQueryParam(url, 'status', 20)"],
    [
      'app/api/ai-diagnosis/step-zero/route.ts',
      "readSingleQueryParam(new URL(request.url), 'caseId', 120)",
    ],
    [
      'app/api/consulting-flow/[caseId]/intake-files/route.ts',
      "readSingleQueryParam(new URL(request.url), 'fileId', 120)",
    ],
    [
      'app/api/consulting-flow/[caseId]/reports/[reportId]/route.ts',
      "readExactQueryFlag(new URL(request.url), 'download')",
    ],
  ] as const;
  for (const [file, boundary] of expected) {
    const source = await readFile(path.resolve(process.cwd(), file), 'utf8');
    assert.ok(source.includes(boundary), `${file}: missing query boundary`);
  }
  for (const file of await routeFiles(path.resolve(process.cwd(), 'app/api'))) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /searchParams\.(?:get|has|getAll)\s*\(/);
  }
});
