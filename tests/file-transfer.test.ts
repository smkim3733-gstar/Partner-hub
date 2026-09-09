import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  describeCompanyTransfer,
  describeFlowTransfer,
  fileTransferBusinessPath,
  fileTransferMethod,
  fileTransferPath,
  parseFlowTransferPayload,
  parseFileTransferIntent,
} from '../lib/file-transfer-contract';
import {
  assertTransferConfig,
  openTransferTicket,
  sealTransferTicket,
} from '../lib/file-transfer-ticket';
import { handleFileTransfer } from '../lib/file-transfer-gateway';
import { directFlowUpload } from '../lib/file-transfer-client';
import {
  ConsultingFlowResponseError,
  readConsultingFlowMutationResponse,
} from '../lib/consulting-flow-response';

const config = {
  appOrigin: 'https://app.example.test',
  transferOrigin: 'https://files.example.test',
  secret: Buffer.from(randomBytes(32)).toString('hex'),
};
const session = 'a'.repeat(64);
const intent = {
  kind: 'company-download' as const,
  fileId: 'synthetic-file-1234',
};
const identity = { intent, session, userId: 'password:member-synthetic' };

void test('FLOW issuance conflict preserves existing refresh status and sends no file bytes', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls++;
    assert.equal(input, '/api/file-transfers');
    return Response.json(
      { error: 'synthetic revision conflict' },
      { status: 409 },
    );
  };
  try {
    const response = await directFlowUpload('synthetic-case', flowForm());
    assert.equal(response.status, 409);
    await assert.rejects(
      readConsultingFlowMutationResponse(response),
      (error: unknown) =>
        error instanceof ConsultingFlowResponseError && error.status === 409,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

function flowForm(command = { type: 'save_recording', fileConsent: true }) {
  const form = new FormData();
  form.set(
    'payload',
    JSON.stringify({ commandId: 'synthetic-command', revision: 3, command }),
  );
  form.set(
    'file',
    new File(['Synthetic transcript fixture.'], '상담 전사문.txt'),
  );
  form.set(
    'audio',
    new File(['ID3-synthetic'], 'synthetic.mp3', { type: 'audio/mpeg' }),
  );
  return form;
}

void test('Sites FLOW route delegates unchanged requests and contexts to shared handlers', async () => {
  const route = await readFile(
    new URL('../app/api/consulting-flow/[caseId]/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(route, /return getConsultingFlow\(request, context\)/);
  assert.match(route, /return postConsultingFlow\(request, context\)/);
  assert.ok(!route.includes('validateTransfer'));
});

void test('FLOW scope binds command, revision, exact payload and both file slots without ticket text', async () => {
  const form = flowForm();
  const manifest = await describeFlowTransfer('synthetic-case', form);
  assert.deepEqual(parseFileTransferIntent(manifest), manifest);
  assert.equal(manifest.files.file?.type, 'application/octet-stream');
  assert.equal(manifest.revision, 3);
  assert.ok(manifest.files.file && manifest.files.audio);
  const ticket = await sealTransferTicket(config, {
    ...identity,
    intent: manifest,
  });
  const claims = await openTransferTicket(config, ticket.token);
  assert.ok(!JSON.stringify(claims).includes('Synthetic transcript fixture'));
  assert.ok(!Object.hasOwn(claims.intent, 'payload'));
  const payload = form.get('payload');
  assert.ok(typeof payload === 'string');
  form.set('payload', payload + ' ');
  assert.notEqual(
    (await describeFlowTransfer('synthetic-case', form)).payloadSha256,
    manifest.payloadSha256,
  );
  form.set(
    'audio',
    new File(['ID3-different'], 'synthetic.mp3', { type: 'audio/mpeg' }),
  );
  assert.notEqual(
    (await describeFlowTransfer('synthetic-case', form)).files.audio?.sha256,
    manifest.files.audio.sha256,
  );
});

void test('FLOW contract rejects ambiguous fields, unauthorized commands, slots, consent and excessive sizes', async () => {
  const good = await describeFlowTransfer('synthetic-case', flowForm());
  for (const value of [
    { ...good, commandId: 'short' },
    { ...good, commandType: 'queue_report1' },
    { ...good, commandType: 'import_intake_source' },
    { ...good, commandType: 'receive_document' },
    { ...good, revision: -1 },
    { ...good, payload: '{}' },
    { ...good, files: {} },
    { ...good, files: { ...good.files, extra: good.files.file } },
    {
      ...good,
      files: {
        file: { ...good.files.file, size: 25 * 1024 * 1024 },
        audio: { ...good.files.audio, size: 6 * 1024 * 1024 },
      },
    },
  ])
    assert.throws(() => parseFileTransferIntent(value));
  for (const key of ['payload', 'file', 'audio']) {
    const form = flowForm();
    form.append(key, 'duplicate');
    await assert.rejects(describeFlowTransfer('synthetic-case', form));
  }
  const form = flowForm();
  form.set('extra', 'not ignored');
  await assert.rejects(describeFlowTransfer('synthetic-case', form));
  for (const command of [
    { type: 'save_recording', fileConsent: false },
    { type: 'queue_report1', fileConsent: true },
  ])
    assert.throws(() =>
      parseFlowTransferPayload(flowForm(command).get('payload')),
    );
  assert.throws(() => parseFlowTransferPayload(' '.repeat(400001)));
});

void test('FLOW business paths encode identifiers and operations cannot widen transfer methods', () => {
  const intent = parseFileTransferIntent({
    kind: 'flow-download',
    caseId: 'case/../한글',
    fileId: 'file?token=#x',
  });
  assert.equal(fileTransferMethod(intent), 'GET');
  assert.equal(
    fileTransferBusinessPath(intent),
    '/api/consulting-flow/case%2F..%2F%ED%95%9C%EA%B8%80/files/file%3Ftoken%3D%23x',
  );
});

void test('FLOW upload grants dispatch POST only and retain exact command scope', async () => {
  const intent = await describeFlowTransfer('synthetic-case', flowForm());
  const { token } = await sealTransferTicket(config, { ...identity, intent });
  let calls = 0;
  const dispatch = async (_request: Request, claims: { intent: unknown }) => {
    calls++;
    assert.deepEqual(claims.intent, intent);
    return Response.json({ flow: { revision: 4 } });
  };
  for (const method of ['GET', 'POST']) {
    const response = await handleFileTransfer(
      new Request(config.transferOrigin + fileTransferPath, {
        method,
        headers: { origin: config.appOrigin, authorization: `Bearer ${token}` },
      }),
      config,
      dispatch,
    );
    assert.equal(response.status, method === 'GET' ? 403 : 200);
  }
  assert.equal(calls, 1);
});

void test('Sites upload route delegates unchanged request to the bounded shared handler', async () => {
  const route = await readFile(
    new URL('../app/api/files/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    route,
    /import \{ postCompanyFile \} from '@\/lib\/company-file-post'/,
  );
  assert.match(
    route,
    /export async function POST\(request: Request\) \{\s*return postCompanyFile\(request\);\s*\}/,
  );
});

void test('file tickets encrypt the session and bind audience, origin, identity and operation', async () => {
  const ticket = await sealTransferTicket(config, identity, 1000);
  assert.equal(ticket.expiresAt, 1120);
  assert.ok(!ticket.token.includes(session));
  const raw = Buffer.from(ticket.token.split('.')[2], 'base64url').toString();
  assert.ok(!raw.includes(session) && !raw.includes(identity.userId));
  assert.equal(
    (await openTransferTicket(config, ticket.token, 1001)).session,
    session,
  );
  for (const changed of [
    { ...config, secret: 'b'.repeat(64) },
    { ...config, transferOrigin: 'https://other.example.test' },
    { ...config, appOrigin: 'https://other.example.test' },
  ])
    await assert.rejects(
      openTransferTicket(changed, ticket.token, 1001),
      /Invalid or expired/,
    );
});
void test('file ticket expiry, future issuance, mutation, truncation and malformed token fail closed', async () => {
  const { token } = await sealTransferTicket(config, identity, 1000);
  for (const time of [999, 1120, 1121])
    await assert.rejects(openTransferTicket(config, token, time));
  for (const value of [
    token + '!',
    token.slice(0, -5),
    token.replace(/^v1/, 'v2'),
    token.slice(0, 25) + (token[25] === 'A' ? 'B' : 'A') + token.slice(26),
    '',
    'a'.repeat(20_001),
  ])
    await assert.rejects(openTransferTicket(config, value, 1001));
  assert.notEqual(
    (await sealTransferTicket(config, identity, 1000)).token,
    token,
  );
});
void test('file configuration rejects insecure, credential-bearing and request-derived paths', () => {
  for (const value of [
    'http://files.example.test',
    'https://files.example.test/path',
    'https://files.example.test/',
    'https://user:pass@files.example.test',
    'https://files.example.test?token=x',
    'null',
  ])
    assert.throws(() =>
      assertTransferConfig({ ...config, transferOrigin: value }),
    );
  assert.throws(() => assertTransferConfig({ ...config, secret: 'short' }));
  assert.throws(() =>
    assertTransferConfig({ ...config, transferOrigin: config.appOrigin }),
  );
  assert.doesNotThrow(() =>
    assertTransferConfig({
      ...config,
      transferOrigin: 'http://127.0.0.1:3002',
      allowLoopback: true,
    }),
  );
  assert.throws(() =>
    assertTransferConfig({
      ...config,
      transferOrigin: 'http://files.example.test',
      allowLoopback: true,
    }),
  );
});
void test('upload manifest binds all fields, file bytes, MIME, name and stable request key', async () => {
  const form = new FormData();
  form.set(
    'file',
    new File(['synthetic'], 'fixture.txt', { type: 'text/plain' }),
  );
  form.set('company', 'Synthetic company');
  form.set('consent', 'confirmed');
  const manifest = await describeCompanyTransfer(form, 'b'.repeat(64));
  assert.equal(manifest.file.size, 9);
  assert.match(manifest.file.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(parseFileTransferIntent(manifest), manifest);
  for (const value of [
    { ...manifest, extra: true },
    { ...manifest, requestKey: 'bad' },
    { ...manifest, fields: { token: session } },
    { ...manifest, file: { ...manifest.file, size: 26 * 1024 * 1024 } },
    { ...manifest, file: { ...manifest.file, type: 'text/plain\r\nx: y' } },
  ])
    assert.throws(() => parseFileTransferIntent(value));
  form.append('company', 'different');
  await assert.rejects(describeCompanyTransfer(form, 'b'.repeat(64)));
  form.delete('company');
  form.set('__proto__', 'never-silently-discard');
  await assert.rejects(describeCompanyTransfer(form, 'b'.repeat(64)));
});
void test('gateway permits exact CORS origin only, never cookie, URL token or arbitrary methods', async () => {
  let calls = 0;
  const dispatch = async () => {
    calls++;
    return new Response('synthetic', {
      headers: { 'set-cookie': 'never=expose', 'cache-control': 'public' },
    });
  };
  const { token } = await sealTransferTicket(config, identity);
  const headers = {
    origin: config.appOrigin,
    authorization: `Bearer ${token}`,
  };
  const url = config.transferOrigin + fileTransferPath;
  const success = await handleFileTransfer(
    new Request(url, { headers }),
    config,
    dispatch,
  );
  assert.equal(success.status, 200);
  assert.equal(
    success.headers.get('access-control-allow-origin'),
    config.appOrigin,
  );
  assert.equal(success.headers.get('set-cookie'), null);
  assert.match(success.headers.get('cache-control')!, /private, no-store/);
  assert.equal(success.headers.get('access-control-allow-credentials'), null);
  for (const request of [
    new Request(url, { headers: { ...headers, origin: 'null' } }),
    new Request(url, { headers: { authorization: headers.authorization } }),
    new Request(url, { headers: { ...headers, cookie: 'fake=1' } }),
    new Request(url + '?token=x', { headers }),
    new Request(url, { method: 'DELETE', headers }),
    new Request(url, { method: 'POST', headers }),
    new Request(url, { headers: { origin: config.appOrigin } }),
  ])
    assert.ok(
      (await handleFileTransfer(request, config, dispatch)).status >= 400,
    );
  assert.equal(calls, 1);
  assert.equal(
    (await handleFileTransfer(new Request(url, { headers }), null, dispatch))
      .status,
    503,
  );
});
void test('preflight authorizes only GET/POST and explicit transfer headers without dispatch', async () => {
  const dispatch = async () => {
    throw new Error('Must not dispatch');
  };
  const request = (names: string, origin = config.appOrigin) =>
    new Request(config.transferOrigin + fileTransferPath, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': names,
      },
    });
  assert.equal(
    (
      await handleFileTransfer(
        request('authorization, content-type'),
        config,
        dispatch,
      )
    ).status,
    204,
  );
  assert.equal(
    (
      await handleFileTransfer(
        request('authorization, x-admin'),
        config,
        dispatch,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleFileTransfer(
        request('authorization', 'https://evil.example.test'),
        config,
        dispatch,
      )
    ).headers.get('access-control-allow-origin'),
    null,
  );
});
void test('gateway never retries a possibly committed operation or returns private error text', async () => {
  const { token } = await sealTransferTicket(config, identity);
  let calls = 0;
  const response = await handleFileTransfer(
    new Request(config.transferOrigin + fileTransferPath, {
      headers: { origin: config.appOrigin, authorization: `Bearer ${token}` },
    }),
    config,
    async () => {
      calls++;
      throw new Error(session);
    },
  );
  assert.equal(response.status, 503);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    'FILE_TRANSFER_OUTCOME_UNKNOWN',
  );
  assert.equal(calls, 1);
});

void test('expiry after upload commit reports unknown outcome instead of claiming no write', async () => {
  const form = new FormData();
  form.set(
    'file',
    new File(['synthetic'], 'fixture.txt', { type: 'text/plain' }),
  );
  const intent = await describeCompanyTransfer(form, 'b'.repeat(64));
  const { token } = await sealTransferTicket(config, { ...identity, intent });
  const originalNow = Date.now;
  const now = originalNow();
  try {
    const response = await handleFileTransfer(
      new Request(config.transferOrigin + fileTransferPath, {
        method: 'POST',
        headers: { origin: config.appOrigin, authorization: `Bearer ${token}` },
      }),
      config,
      async () => {
        Date.now = () => now + 121_000;
        return Response.json(
          { file: { id: 'already-committed' } },
          { status: 201 },
        );
      },
    );
    assert.equal(response.status, 503);
    assert.equal(
      ((await response.json()) as { code: string }).code,
      'FILE_TRANSFER_OUTCOME_UNKNOWN',
    );
  } finally {
    Date.now = originalNow;
  }
});
