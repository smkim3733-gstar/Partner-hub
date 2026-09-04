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
import { readRouteParam, RouteParamError } from '../lib/request-path';
import {
  HeaderRequestError,
  readIdempotencyKey,
  readIfMatchRevision,
} from '../lib/request-header';
import { portalConflictReceiptFromRequest } from '../lib/portal-conflict-receipt';
import {
  chatGPTDisplayNameFromRequest,
  chatGPTIdentityFromRequest,
  rateLimitClientKey,
  readSessionCookieToken,
} from '../lib/request-auth';

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

void test('route parameter reader accepts bounded opaque IDs and rejects unsafe values', () => {
  assert.equal(readRouteParam('case_1-report'), 'case_1-report');
  for (const value of ['', '../private', '한글', 'x'.repeat(121), null])
    assert.throws(() => readRouteParam(value), RouteParamError);
});

void test('request header readers accept exact revisions and bounded idempotency keys', () => {
  const revision = 'a'.repeat(64);
  for (const value of [revision, `"${revision}"`])
    assert.equal(
      readIfMatchRevision(
        request('{}', 'application/json', { 'if-match': value }),
      ),
      revision,
    );
  assert.equal(readIfMatchRevision(request('{}')), null);
  for (const value of ['*', `W/"${revision}"`, 'A'.repeat(64), 'a'.repeat(65)])
    assert.throws(
      () =>
        readIfMatchRevision(
          request('{}', 'application/json', { 'if-match': value }),
        ),
      HeaderRequestError,
    );

  assert.equal(
    readIdempotencyKey(
      request('{}', 'application/json', {
        'idempotency-key': 'upload_request-01',
      }),
    ),
    'upload_request-01',
  );
  assert.equal(readIdempotencyKey(request('{}')), null);
  for (const value of ['short', 'invalid!', 'x'.repeat(129)])
    assert.throws(
      () =>
        readIdempotencyKey(
          request('{}', 'application/json', { 'idempotency-key': value }),
        ),
      HeaderRequestError,
    );
});

void test('conflict receipt request reader ignores malformed telemetry tokens', () => {
  const token = 'a'.repeat(43);
  assert.equal(
    portalConflictReceiptFromRequest(
      request('{}', 'application/json', {
        'x-portal-conflict-receipt': token,
      }),
    ),
    token,
  );
  assert.equal(portalConflictReceiptFromRequest(request('{}')), null);
  assert.equal(
    portalConflictReceiptFromRequest(
      request('{}', 'application/json', {
        'x-portal-conflict-receipt': 'invalid!',
      }),
    ),
    null,
  );
});

void test('platform identity and display name readers bound forwarded headers', () => {
  const authenticated = request('{}', 'application/json', {
    'oai-authenticated-user-id': 'user_01-test',
    'oai-authenticated-user-email': ' USER@EXAMPLE.INVALID ',
    'oai-authenticated-user-full-name': encodeURIComponent(' 가상 사용자 '),
    'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
  });
  assert.deepEqual(chatGPTIdentityFromRequest(authenticated), {
    id: 'user_01-test',
    email: 'user@example.invalid',
  });
  assert.equal(
    chatGPTDisplayNameFromRequest(authenticated, 'fallback'),
    '가상 사용자',
  );
  const invalidIdentities: Array<Record<string, string>> = [
    { 'oai-authenticated-user-id': 'user-only' },
    {
      'oai-authenticated-user-id': 'x'.repeat(257),
      'oai-authenticated-user-email': 'user@example.invalid',
    },
    {
      'oai-authenticated-user-id': 'user',
      'oai-authenticated-user-email': 'invalid',
    },
  ];
  for (const headers of invalidIdentities)
    assert.equal(
      chatGPTIdentityFromRequest(request('{}', 'application/json', headers)),
      null,
    );
  for (const headers of [
    {
      'oai-authenticated-user-full-name': '%E0%A4%A',
      'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
    },
    {
      'oai-authenticated-user-full-name': encodeURIComponent('x'.repeat(81)),
      'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8',
    },
    {
      'oai-authenticated-user-full-name': 'name',
      'oai-authenticated-user-full-name-encoding': 'plain',
    },
  ])
    assert.equal(
      chatGPTDisplayNameFromRequest(
        request('{}', 'application/json', headers),
        'fallback',
      ),
      'fallback',
    );
});

void test('rate-limit and session readers bound edge and cookie headers', () => {
  assert.equal(
    rateLimitClientKey(
      request('{}', 'application/json', { 'cf-connecting-ip': '2001:DB8::1' }),
    ),
    '2001:db8::1',
  );
  for (const value of [undefined, 'not-an-ip', 'a'.repeat(65)])
    assert.equal(
      rateLimitClientKey(
        request(
          '{}',
          'application/json',
          value ? { 'cf-connecting-ip': value } : {},
        ),
      ),
      'shared-no-edge-ip',
    );

  const token = 'a'.repeat(64);
  assert.equal(
    readSessionCookieToken(
      request('{}', 'application/json', {
        cookie: `other=1; keve_session=${token}`,
      }),
      'keve_session',
    ),
    token,
  );
  assert.equal(readSessionCookieToken(request('{}'), 'keve_session'), null);
  for (const cookie of [
    'keve_session=invalid',
    `keve_session=${token}; keve_session=${token}`,
    `other=${'x'.repeat(8_193)}; keve_session=${token}`,
  ])
    assert.equal(
      readSessionCookieToken(
        request('{}', 'application/json', { cookie }),
        'keve_session',
      ),
      '',
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

void test('dynamic route IDs remain routed through the shared path boundary', async () => {
  const expected = [
    ['lib/consulting-flow-store.ts', 'readRouteParam(\n    caseId,'],
    ['lib/file-inventory-store.ts', 'readRouteParam(id, 120,'],
    ['lib/file-recovery-store.ts', 'readRouteParam(id, 120,'],
    ['app/api/files/[id]/route.ts', 'readRouteParam(rawId, 120,'],
    [
      'app/api/consulting-flow/[caseId]/files/[fileId]/route.ts',
      'readRouteParam(\n      rawFileId,',
    ],
    [
      'app/api/consulting-flow/[caseId]/reports/[reportId]/route.ts',
      'readRouteParam(\n      rawReportId,',
    ],
  ] as const;
  for (const [file, boundary] of expected) {
    const source = (
      await readFile(path.resolve(process.cwd(), file), 'utf8')
    ).replaceAll('\r\n', '\n');
    assert.ok(source.includes(boundary), `${file}: missing path boundary`);
  }
});

void test('business request headers remain routed through shared boundaries', async () => {
  const expected = [
    ['app/api/state/route.ts', 'readIfMatchRevision(request)'],
    ['app/api/files/route.ts', 'readIdempotencyKey(request)'],
    ['app/api/state/route.ts', 'portalConflictReceiptFromRequest(request)'],
    ['app/api/register/route.ts', 'portalConflictReceiptFromRequest(request)'],
    [
      'app/api/admin/partners/route.ts',
      'portalConflictReceiptFromRequest(request)',
    ],
  ] as const;
  for (const [file, boundary] of expected) {
    const source = await readFile(path.resolve(process.cwd(), file), 'utf8');
    assert.ok(source.includes(boundary), `${file}: missing header boundary`);
  }
});

void test('authentication inputs remain routed through shared boundaries', async () => {
  const expected = [
    ['lib/portal-auth.ts', 'chatGPTIdentityFromRequest(request)'],
    ['lib/portal-auth.ts', 'chatGPTDisplayNameFromRequest(request, email)'],
    ['app/api/register/route.ts', 'chatGPTIdentityFromRequest(request)'],
    ['app/api/state/route.ts', 'chatGPTIdentityFromRequest(request)?.email'],
    ['lib/password-store.ts', 'rateLimitClientKey(request)'],
    ['app/api/register/route.ts', 'limitAuthenticationAttempts('],
    [
      'lib/password-store.ts',
      'readSessionCookieToken(request, cookieName(request))',
    ],
  ] as const;
  for (const [file, boundary] of expected) {
    const source = await readFile(path.resolve(process.cwd(), file), 'utf8');
    assert.ok(source.includes(boundary), `${file}: missing auth boundary`);
    assert.doesNotMatch(
      source,
      /headers\.get\(\s*['"](?:oai-authenticated-user-(?:id|email|full-name)|cf-connecting-ip|cookie)['"]\s*\)/,
      `${file}: direct auth header read`,
    );
  }
});
