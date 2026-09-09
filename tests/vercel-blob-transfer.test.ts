import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import { createClient } from '@libsql/client';
import { getPayloadFromClientToken } from '@vercel/blob/client';
import { env } from 'cloudflare:workers';
import { createTursoDatabase } from '../lib/turso-database';
import { createVercelBlobBucket } from '../lib/vercel-blob-bucket';
import {
  describeCompanyTransfer,
  describeFlowTransfer,
} from '../lib/file-transfer-contract';
import { applyVercelMigrations } from '../scripts/vercel-migrations.mjs';
import { blobFixture } from './blob-sdk-fixture';
import { tokenHash } from '../lib/password-crypto';
import { defaultPartnerPermissions } from '../lib/partner-registration';
import { flushWaitUntil } from './runtime-mock.mjs';

void test('native Vercel transfer: real libSQL + private Blob fixture, large company/FLOW upload, scoped tokens, retry, corruption and revocation', async () => {
  register('./vercel-admin-loader.mjs', import.meta.url);
  const { createBlobTransferHandler } =
    await import('../lib/vercel-blob-transfer');
  const { sessionCookie } = await import('../lib/password-store');
  const { GET: download } = await import('../app/api/files/[id]/route');
  const { GET: flowGet } =
    await import('../app/api/consulting-flow/[caseId]/route');
  const { GET: flowDownload } =
    await import('../app/api/consulting-flow/[caseId]/files/[fileId]/route');
  const { provisionStandaloneAdmin, issueStandaloneAdminSession } =
    await import('../lib/standalone-admin-store');
  const { PORTAL_OWNER_EMAIL } = await import('../lib/member-email');
  const client = createClient({ url: 'file::memory:' }),
    db = createTursoDatabase(client);
  const fixture = blobFixture();
  const bindings = env as unknown as {
    DB: D1Database;
    AI_SOURCE_FILES: R2Bucket;
  };
  const oldDb = bindings.DB,
    oldBucket = bindings.AI_SOURCE_FILES;
  const origin = 'https://app.example.test',
    session = 'a'.repeat(64);
  const cookie = sessionCookie(new Request(origin), session).split(';')[0];
  const config = {
    appOrigin: origin,
    blobToken: 'vercel_blob_rw_synthetic_secret',
  };
  const syntheticEnv = {
    PARTNER_HUB_NEXT_BACKEND: 'vercel-storage-v1',
    PARTNER_HUB_BACKEND_ENABLED: '1',
    PARTNER_HUB_APP_ORIGIN: origin,
    TURSO_DATABASE_URL: 'libsql://synthetic.turso.io',
    TURSO_AUTH_TOKEN: 'synthetic-auth-token',
    BLOB_READ_WRITE_TOKEN: config.blobToken,
  };
  const oldEnv = Object.fromEntries(
    Object.keys(syntheticEnv).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, syntheticEnv);
  const handler = createBlobTransferHandler(db, config, fixture.sdk);
  const request = (body: unknown, auth = cookie) =>
    new Request(origin + '/api/blob-transfers', {
      method: 'POST',
      headers: { origin, cookie: auth, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  async function response(response: Response, expected = 200) {
    const result = (await response.json()) as {
      id: string;
      paths: Record<string, string>;
      clientToken: string;
      file: { id: string };
      flow: { revision: number; files: { id: string }[] };
    };
    assert.equal(response.status, expected, JSON.stringify(result));
    return result;
  }
  try {
    await applyVercelMigrations(client);
    bindings.DB = db;
    bindings.AI_SOURCE_FILES = createVercelBlobBucket(
      config.blobToken,
      fixture.sdk,
    );
    const state = {
      version: 1,
      membersRevision: 0,
      consultationNumber: 0,
      timeline: [],
      schedule: [],
      tasks: [],
      companyDocuments: [],
      members: [
        {
          id: 'synthetic-member',
          name: '검증파트너',
          email: 'synthetic@example.test',
          status: '활성',
          permissions: defaultPartnerPermissions,
        },
      ],
      cases: [
        {
          id: 'synthetic-case',
          company: '검증기업',
          trainee: '검증파트너',
          stage: '접수',
          consultationCount: 0,
        },
      ],
    };
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare('INSERT INTO portal_state VALUES (?1,?2,?3)')
        .bind('keve-partner-hub', JSON.stringify(state), now),
      db
        .prepare(
          'INSERT INTO portal_password_accounts VALUES (?1,?2,?3,?4,?5,?6)',
        )
        .bind(
          'synthetic-member',
          'synthetic@example.test',
          'not-a-real-password-hash',
          'v1',
          now,
          now,
        ),
      db
        .prepare('INSERT INTO portal_password_sessions VALUES (?1,?2,?3,?4,?5)')
        .bind(
          tokenHash(session),
          'synthetic-member',
          'synthetic@example.test',
          'v1',
          Date.now() + 3600000,
        ),
    ]);
    const bytes = new TextEncoder().encode(
      'synthetic original\n'.repeat(300_000),
    );
    assert.ok(bytes.length > 4.5 * 1024 * 1024);
    const form = new FormData();
    form.set('file', new File([bytes], '검증.txt', { type: 'text/plain' }));
    for (const [key, value] of Object.entries({
      company: '검증기업',
      title: '합성 원본',
      category: '기타자료',
      consent: 'confirmed',
    }))
      form.set(key, value);
    const intent = await describeCompanyTransfer(form, 'b'.repeat(64));
    const grant = await response(
      await handler(request({ action: 'prepare', intent })),
    );
    assert.ok(!JSON.stringify(grant).includes(session));
    const tokenRequest = {
      type: 'blob.generate-client-token',
      payload: {
        pathname: grant.paths.file,
        multipart: false,
        clientPayload: grant.id,
      },
    };
    const token = await response(await handler(request(tokenRequest)));
    const payload = getPayloadFromClientToken(token.clientToken);
    assert.equal(payload.pathname, grant.paths.file);
    assert.equal(payload.maximumSizeInBytes, bytes.length);
    assert.equal(payload.allowOverwrite, false);
    assert.equal(payload.addRandomSuffix, false);
    assert.deepEqual(payload.allowedContentTypes, ['application/octet-stream']);
    assert.ok(!token.clientToken.includes(config.blobToken));
    await response(
      await handler(
        request({
          ...tokenRequest,
          payload: {
            ...tokenRequest.payload,
            pathname: 'partner-hub/v1/company-source/victim',
          },
        }),
      ),
      403,
    );
    await response(await handler(request(tokenRequest, '')), 401);
    await response(
      await handler(request({ action: 'finish', id: grant.id })),
      409,
    );
    fixture.objects.set(grant.paths.file, Uint8Array.from(bytes));
    fixture.objects.get(grant.paths.file)![0] ^= 1;
    await response(
      await handler(request({ action: 'finish', id: grant.id })),
      409,
    );
    assert.equal(
      await db
        .prepare('SELECT COUNT(*) AS n FROM company_file_objects')
        .first('n'),
      0,
    );
    fixture.objects.set(grant.paths.file, Uint8Array.from(bytes));
    const saved = await response(
      await handler(request({ action: 'finish', id: grant.id })),
      201,
    );
    const repeated = await response(
      await handler(request({ action: 'finish', id: grant.id })),
      201,
    );
    assert.equal(repeated.file.id, saved.file.id);
    const getRequest = new Request(origin + '/api/files/' + saved.file.id, {
      headers: { cookie },
    });
    const original = await download(getRequest, {
      params: Promise.resolve({ id: saved.file.id }),
    });
    assert.equal(original.status, 200);
    assert.equal(
      original.headers.get('cache-control'),
      'private, no-store, max-age=0',
    );
    assert.deepEqual(new Uint8Array(await original.arrayBuffer()), bytes);

    const password = 'Synthetic only admin passphrase!';
    await provisionStandaloneAdmin(db, {
      email: PORTAL_OWNER_EMAIL,
      password,
      deployment: 'remote',
    });
    const adminSession = await issueStandaloneAdminSession(
      db,
      PORTAL_OWNER_EMAIL,
      password,
      null,
    );
    assert.ok(adminSession);
    const adminCookie = sessionCookie(new Request(origin), adminSession).split(
      ';',
    )[0];
    const flowRequest = new Request(
      origin + '/api/consulting-flow/synthetic-case',
      { headers: { cookie: adminCookie } },
    );
    const initial = await response(
      await flowGet(flowRequest, {
        params: Promise.resolve({ caseId: 'synthetic-case' }),
      }),
    );
    const flowForm = new FormData();
    flowForm.set(
      'file',
      new File(['Synthetic FLOW source'], 'flow.txt', { type: 'text/plain' }),
    );
    flowForm.set(
      'payload',
      JSON.stringify({
        commandId: 'synthetic-blob-flow',
        revision: initial.flow.revision,
        command: {
          type: 'save_source',
          fileConsent: true,
          privacyMasked: true,
        },
      }),
    );
    const flowIntent = await describeFlowTransfer('synthetic-case', flowForm);
    const flowGrant = await response(
      await handler(
        request(
          {
            action: 'prepare',
            intent: { ...flowIntent, payload: flowForm.get('payload') },
          },
          adminCookie,
        ),
      ),
    );
    fixture.objects.set(
      flowGrant.paths.file,
      new TextEncoder().encode('Synthetic FLOW source'),
    );
    const flowResult = await response(
      await handler(
        request({ action: 'finish', id: flowGrant.id }, adminCookie),
      ),
    );
    const flowRepeat = await response(
      await handler(
        request({ action: 'finish', id: flowGrant.id }, adminCookie),
      ),
    );
    assert.equal(flowRepeat.flow.revision, flowResult.flow.revision);
    const flowFile = flowResult.flow.files[0];
    const flowBody = await flowDownload(
      new Request(
        origin + '/api/consulting-flow/synthetic-case/files/' + flowFile.id,
        { headers: { cookie } },
      ),
      {
        params: Promise.resolve({
          caseId: 'synthetic-case',
          fileId: flowFile.id,
        }),
      },
    );
    assert.equal(flowBody.status, 200);
    assert.equal(await flowBody.text(), 'Synthetic FLOW source');
    await response(
      await handler(
        request({
          type: 'blob.upload-completed',
          payload: { blob: { url: 'https://evil.test' } },
        }),
      ),
      400,
    );
    await db
      .prepare('DELETE FROM portal_password_sessions WHERE token_hash = ?1')
      .bind(tokenHash(session))
      .run();
    await response(await handler(request(tokenRequest)), 401);
    await response(
      await handler(request({ action: 'finish', id: grant.id })),
      401,
    );
    assert.equal(
      (
        await download(getRequest, {
          params: Promise.resolve({ id: saved.file.id }),
        })
      ).status,
      401,
    );
    assert.equal(
      (await client.execute('PRAGMA foreign_key_check')).rows.length,
      0,
    );
    await flushWaitUntil();
  } finally {
    bindings.DB = oldDb;
    bindings.AI_SOURCE_FILES = oldBucket;
    client.close();
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
