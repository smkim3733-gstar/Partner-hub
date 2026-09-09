// Native Worker and ephemeral real D1/R2. Synthetic fixtures only; no deployment.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileTransferWorkerBundle } from '../scripts/file-transfer-worker-bundle.mjs';
import {
  describeCompanyTransfer,
  fileTransferPath,
} from '../lib/file-transfer-contract.ts';
import { sealTransferTicket } from '../lib/file-transfer-ticket.ts';
import { emptyPortalStateBaseline } from '../lib/pilot-readiness.ts';
import { defaultPartnerPermissions } from '../lib/partner-registration.ts';
import { portalStateId } from '../db/schema.ts';
import {
  provisionStandaloneAdmin,
  issueStandaloneAdminSession,
} from '../lib/standalone-admin-store.ts';
import { PORTAL_OWNER_EMAIL } from '../lib/member-email.ts';
import { runNativeFlowTransferChecks } from './native-flow-transfer-smoke.mjs';

const require = createRequire(import.meta.url);
const workerFileIndex = process.argv.indexOf('--worker-file');
const testedScript =
  workerFileIndex < 0
    ? await fileTransferWorkerBundle()
    : await readFile(process.argv[workerFileIndex + 1], 'utf8');
const wrangler = require.resolve('wrangler');
const { unstable_splitSqlQuery } = require('wrangler');
const { Miniflare, convertV4MiniflareOptions } = require(
  require.resolve('miniflare', { paths: [wrangler] }),
);
const config = {
  appOrigin: 'https://next.synthetic.invalid',
  transferOrigin: 'https://files.synthetic.invalid',
  secret: randomBytes(32).toString('hex'),
};
let outboundRequests = 0;
const mf = new Miniflare(
  convertV4MiniflareOptions({
    script: testedScript,
    modules: true,
    compatibilityDate: '2026-08-26',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'isolated-file-transfer-db' },
    r2Buckets: ['AI_SOURCE_FILES'],
    bindings: {
      FILE_TRANSFER_ENABLED: '1',
      FILE_TRANSFER_SECRET: config.secret,
      FILE_TRANSFER_APP_ORIGIN: config.appOrigin,
      FILE_TRANSFER_ORIGIN: config.transferOrigin,
    },
    outboundService: () => {
      outboundRequests++;
      throw new Error('External requests forbidden');
    },
  }),
);
let checks = 0;
const pass = (name) => {
  checks++;
  console.log(`PASS ${name}`);
};
try {
  const db = await mf.getD1Database('DB');
  const bucket = await mf.getR2Bucket('AI_SOURCE_FILES');
  for (const directory of ['drizzle', 'dev/next-local/migrations']) {
    for (const file of (
      await readdir(new URL(`../${directory}/`, import.meta.url))
    )
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort()) {
      const sql = await readFile(
        new URL(`../${directory}/${file}`, import.meta.url),
        'utf8',
      );
      await db.batch(
        unstable_splitSqlQuery(sql).map((statement) => db.prepare(statement)),
      );
    }
  }
  pass('99 production + 1 local auth migrations on ephemeral D1');
  const memberId = 'synthetic-transfer-member';
  const email = 'transfer@example.test';
  const session = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(session).digest('hex');
  const state = {
    ...emptyPortalStateBaseline(),
    members: [
      {
        id: memberId,
        name: '전송 테스트',
        email,
        memberType: '기타',
        status: '활성',
        permissions: { ...defaultPartnerPermissions },
      },
    ],
  };
  const saveState = () =>
    db
      .prepare(
        'INSERT INTO portal_state (id, payload, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at',
      )
      .bind(portalStateId, JSON.stringify(state), new Date().toISOString())
      .run();
  await saveState();
  const credentialVersion = randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      'INSERT INTO portal_password_accounts (member_id,email,password_hash,credential_version,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?5)',
    )
    .bind(memberId, email, 'unused-synthetic-hash', credentialVersion, now)
    .run();
  await db
    .prepare(
      'INSERT INTO portal_password_sessions (token_hash,member_id,email,credential_version,expires_at) VALUES (?1,?2,?3,?4,?5)',
    )
    .bind(tokenHash, memberId, email, credentialVersion, Date.now() + 3600_000)
    .run();
  const identity = { session, userId: `password:${memberId}` };
  const bytes = new TextEncoder().encode(
    '%PDF-1.4\n' + 'Synthetic fixture. '.repeat(340_000) + '\n%%EOF',
  );
  assert.ok(bytes.length > 4.5 * 1024 * 1024);
  const form = (
    data = bytes,
    title = '직접 전송 검사',
    mime = 'application/pdf',
  ) => {
    const result = new FormData();
    result.set('file', new File([data], 'synthetic-large.pdf', { type: mime }));
    result.set('company', '합성 검증기업');
    result.set('title', title);
    result.set('category', '기타자료');
    result.set('consent', 'confirmed');
    result.set('expectedUserId', identity.userId);
    return result;
  };
  const manifest = await describeCompanyTransfer(
    form(),
    randomBytes(32).toString('hex'),
  );
  const grant = async (intent, who = identity, time) =>
    sealTransferTicket(config, { intent, ...who }, time);
  const uploadTicket = await grant(manifest);
  const send = async (
    ticket,
    body,
    headers = {},
    method = body ? 'POST' : 'GET',
  ) => {
    const request = new Request(config.transferOrigin + fileTransferPath, {
      method,
      headers: {
        origin: config.appOrigin,
        authorization: `Bearer ${ticket.token}`,
        ...headers,
      },
      ...(body ? { body } : {}),
    });
    return mf.dispatchFetch(request.url, {
      method,
      headers: Object.fromEntries(request.headers),
      ...(body ? { body: await request.arrayBuffer() } : {}),
    });
  };
  async function expect(response, status, label) {
    assert.equal(
      response.status,
      status,
      `${label}: ${await response.clone().text()}`,
    );
    assert.match(response.headers.get('cache-control'), /private, no-store/);
    pass(label);
    return response;
  }
  const upload = await expect(
    await send(uploadTicket, form()),
    201,
    'large upload bypasses Next body transport with original metadata receipt',
  );
  const saved = (await upload.json()).file;
  assert.equal(saved.sizeBytes, bytes.length);
  const original = await bucket.head(`company-source/${saved.id}`);
  assert.ok(original);
  const replay = await expect(
    await send(uploadTicket, form()),
    201,
    'same ticket and content return the same durable file ID',
  );
  assert.equal((await replay.json()).file.id, saved.id);
  assert.equal((await bucket.head(original.key)).etag, original.etag);
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS n FROM company_file_objects').first())
      .n,
    1,
  );
  await expect(
    await send(uploadTicket, form(bytes, 'changed')),
    403,
    'changed title cannot reuse upload ticket',
  );
  const changedBytes = bytes.slice();
  changedBytes[bytes.length - 1] ^= 1;
  await expect(
    await send(uploadTicket, form(changedBytes)),
    403,
    'same-size changed bytes cannot reuse upload ticket',
  );
  await expect(
    await send(uploadTicket, form(bytes, '직접 전송 검사', 'text/plain')),
    403,
    'changed MIME cannot reuse upload ticket',
  );
  const duplicate = form();
  duplicate.append('company', 'other');
  await expect(
    await send(uploadTicket, duplicate),
    403,
    'duplicate multipart fields rejected before persistence',
  );
  const downloadTicket = await grant({
    kind: 'company-download',
    fileId: saved.id,
  });
  const download = await send(downloadTicket);
  assert.equal(download.status, 200);
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);
  assert.equal(
    download.headers.get('access-control-allow-origin'),
    config.appOrigin,
  );
  assert.ok(
    download.headers.get('content-disposition').startsWith('attachment;'),
  );
  pass('large private download bytes and attachment headers preserved');
  await expect(
    await send(downloadTicket, undefined, {}, 'POST'),
    403,
    'download ticket cannot authorize upload',
  );
  await expect(
    await send(downloadTicket, undefined, { origin: 'https://evil.invalid' }),
    403,
    'untrusted browser origin denied',
  );
  await expect(
    await send(downloadTicket, undefined, { cookie: 'fake=1' }),
    403,
    'caller cookies denied',
  );
  await expect(
    await send(
      await grant(
        { kind: 'company-download', fileId: saved.id },
        { ...identity, userId: 'password:other' },
      ),
    ),
    403,
    'ticket subject must match current session identity',
  );
  await expect(
    await send(
      await grant(
        { kind: 'company-download', fileId: saved.id },
        identity,
        Math.floor(Date.now() / 1000) - 121,
      ),
    ),
    401,
    'expired transfer rejected',
  );
  state.members[0].status = '정지';
  await saveState();
  assert.equal((await send(downloadTicket)).status, 403);
  assert.equal(
    (await send(uploadTicket, form(new TextEncoder().encode('%PDF-small'))))
      .status,
    403,
  );
  pass('account suspension revokes already-issued download and upload grants');
  state.members[0].status = '활성';
  await saveState();
  const badFile = form(new TextEncoder().encode('not a PDF'));
  const badManifest = await describeCompanyTransfer(
    badFile,
    randomBytes(32).toString('hex'),
  );
  await expect(
    await send(await grant(badManifest), badFile),
    400,
    'matching ticket cannot bypass actual file signature validation',
  );
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS n FROM company_file_objects').first())
      .n,
    1,
  );
  const maximumBytes = new Uint8Array(25 * 1024 * 1024);
  maximumBytes.set(
    new TextEncoder().encode('%PDF-1.4\nSynthetic maximum-size fixture\n'),
  );
  const maximumForm = form(maximumBytes);
  const maximumIntent = await describeCompanyTransfer(
    maximumForm,
    randomBytes(32).toString('hex'),
  );
  const maximumUpload = await expect(
    await send(await grant(maximumIntent), maximumForm),
    201,
    '25MiB maximum accepted by native Worker without Vercel body transport',
  );
  const maximumId = (await maximumUpload.json()).file.id;
  const maximumDownload = await send(
    await grant({ kind: 'company-download', fileId: maximumId }),
  );
  assert.equal(maximumDownload.status, 200);
  const maximumDownloaded = await maximumDownload.arrayBuffer();
  assert.equal(maximumDownloaded.byteLength, maximumBytes.byteLength);
  assert.equal(
    createHash('sha256')
      .update(new Uint8Array(maximumDownloaded))
      .digest('hex'),
    createHash('sha256').update(maximumBytes).digest('hex'),
  );
  pass('25MiB streamed download retains complete content checksum');
  const smallBytes = new TextEncoder().encode(
    '%PDF-1.4\nSynthetic resume fixture\n%%EOF',
  );
  const resumeIntent = await describeCompanyTransfer(
    form(smallBytes),
    randomBytes(32).toString('hex'),
  );
  const resumeTicket = await grant(resumeIntent);
  const raw = new Request(config.transferOrigin + fileTransferPath, {
    method: 'POST',
    body: form(smallBytes),
    headers: {
      origin: config.appOrigin,
      authorization: `Bearer ${resumeTicket.token}`,
    },
  });
  const multipartBytes = new Uint8Array(await raw.arrayBuffer());
  const beforeInterrupted = (
    await db
      .prepare('SELECT COUNT(*) AS n FROM company_file_upload_requests')
      .first()
  ).n;
  await expect(
    await mf.dispatchFetch(raw.url, {
      method: 'POST',
      headers: Object.fromEntries(raw.headers),
      body: multipartBytes.slice(0, -50),
    }),
    400,
    'interrupted multipart cannot reserve or publish an original',
  );
  assert.equal(
    (
      await db
        .prepare('SELECT COUNT(*) AS n FROM company_file_upload_requests')
        .first()
    ).n,
    beforeInterrupted,
  );
  const resumed = await expect(
    await send(resumeTicket, form(smallBytes)),
    201,
    'same grant can complete after interrupted pre-storage transfer',
  );
  const resumedId = (await resumed.json()).file.id;
  const duplicates = await Promise.all([
    send(resumeTicket, form(smallBytes)),
    send(resumeTicket, form(smallBytes)),
  ]);
  for (const response of duplicates) {
    assert.equal(response.status, 201);
    assert.equal((await response.json()).file.id, resumedId);
  }
  pass('concurrent duplicate grants retain one completed original');
  const emptyMimeForm = form(smallBytes);
  emptyMimeForm.set('file', new File([smallBytes], '합성 자료.pdf'));
  const emptyMimeIntent = await describeCompanyTransfer(
    emptyMimeForm,
    randomBytes(32).toString('hex'),
  );
  const emptyMimeUpload = await expect(
    await send(await grant(emptyMimeIntent), emptyMimeForm),
    201,
    'Korean filename and browser-empty MIME survive multipart normalization',
  );
  assert.equal((await emptyMimeUpload.json()).file.fileName, '합성 자료.pdf');
  await db
    .prepare('DELETE FROM portal_password_sessions WHERE token_hash=?1')
    .bind(tokenHash)
    .run();
  assert.ok((await send(downloadTicket)).status >= 400);
  pass('session logout revokes already-issued grant');
  const adminPassword = `Synthetic-admin-${randomUUID()}!`;
  await provisionStandaloneAdmin(db, {
    email: PORTAL_OWNER_EMAIL,
    password: adminPassword,
  });
  const adminSession = await issueStandaloneAdminSession(
    db,
    PORTAL_OWNER_EMAIL,
    adminPassword,
    null,
  );
  const adminTicket = await grant(
    { kind: 'company-download', fileId: saved.id },
    { session: adminSession, userId: 'standalone:primary-admin' },
  );
  const adminDownload = await send(adminTicket);
  assert.equal(adminDownload.status, 200);
  await adminDownload.body.cancel();
  pass('independent administrator verification works in native file Worker');
  const flowSession = randomBytes(32).toString('hex');
  await db
    .prepare(
      'INSERT INTO portal_password_sessions (token_hash,member_id,email,credential_version,expires_at) VALUES (?1,?2,?3,?4,?5)',
    )
    .bind(
      createHash('sha256').update(flowSession).digest('hex'),
      memberId,
      email,
      credentialVersion,
      Date.now() + 3600_000,
    )
    .run();
  await runNativeFlowTransferChecks({
    db,
    bucket,
    state,
    saveState,
    grant,
    send,
    expect,
    pass,
    partner: { session: flowSession, userId: identity.userId },
    admin: { session: adminSession, userId: 'standalone:primary-admin' },
  });
  await bucket.put(original.key, changedBytes, {
    httpMetadata: { contentType: 'application/pdf' },
  });
  await expect(
    await send(adminTicket),
    409,
    'changed original fails immutable R2 integrity checks',
  );
  assert.equal(outboundRequests, 0);
  console.log(
    JSON.stringify({
      runtime: 'native-file-transfer-worker',
      checksPassed: checks,
      liveWrites: 0,
      emailSends: 0,
      paidAIRequests: 0,
      outboundRequests,
    }),
  );
} finally {
  await mf.dispose();
}
