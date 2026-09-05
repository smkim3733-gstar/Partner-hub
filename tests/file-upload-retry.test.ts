import test from 'node:test';
import assert from 'node:assert/strict';
import { POST as upload } from '../app/api/files/route';
import { GET as download, DELETE as remove } from '../app/api/files/[id]/route';
import { writePortalState } from '../lib/portal-state';
import {
  companyFileDatabase,
  companyFileBucket,
  ensureCompanyFileTables,
  findCompanyFile,
} from '../lib/company-files';
import { uploadCompanyFile } from '../lib/company-file-upload';
import {
  companyUploadKey,
  companyUploadKeyVariants,
  fileDigest,
  type CompanyUploadInput,
} from '../lib/file-upload-key';
import { ApplicationSubmission } from '../lib/application-submission';
import {
  listIntakeSources,
  previewIntakeSource,
} from '../lib/consulting-intake-sources';
import { newConsultingFlow } from '../lib/consulting-flow';
import { readDuplicateRequestSummary } from '../lib/duplicate-request-metrics';
import { flushWaitUntil } from './runtime-mock.mjs';

const member = {
  id: 'retry-member',
  name: '가상 담당자',
  email: 'upload-retry@example.invalid',
  status: '활성',
  permissions: { fileUpload: true, collaborationApply: true, ownCases: true },
};
const peer = {
  ...member,
  id: 'retry-peer',
  email: 'upload-peer@example.invalid',
};
async function seed() {
  await writePortalState({
    version: 1,
    consultationNumber: 0,
    members: [member, peer],
    cases: [],
    companyDocuments: [],
    timeline: [],
    schedule: [],
    tasks: [],
  });
}
function input(
  caseId = 'retry-application',
  text = 'SYNTHETIC_DOCUMENT',
): CompanyUploadInput {
  return {
    file: new File([text], 'synthetic.txt', { type: 'text/plain' }),
    company: '가상기업',
    title: '가상 근거자료',
    category: '기타자료',
    assignedTrainee: member.name,
    partnerMemberId: member.id,
    caseId,
  };
}
function form(text = 'SYNTHETIC_DOCUMENT', company = '가상기업') {
  const value = new FormData();
  value.set('file', new File([text], 'synthetic.txt', { type: 'text/plain' }));
  value.set('company', company);
  value.set('title', '가상 근거자료');
  value.set('category', '기타자료');
  value.set('consent', 'confirmed');
  return value;
}
function request(key: string, data = form(), user = member, method = 'POST') {
  return new Request('http://localhost/api/files', {
    method,
    ...(method === 'POST' ? { body: data } : {}),
    headers: {
      origin: 'http://localhost',
      'idempotency-key': key,
      'oai-authenticated-user-id': user.email,
      'oai-authenticated-user-email': user.email,
    },
  });
}
async function stored(response: Response) {
  assert.equal(response.status, 201, await response.clone().text());
  return (
    (await response.json()) as {
      file: { id: string; createdAt: string; partnerMemberId: string };
    }
  ).file;
}
async function rowFor(key: string) {
  return companyFileDatabase()
    .prepare(
      'SELECT file_id, status FROM company_file_upload_requests WHERE owner_key = ?1 AND request_key = ?2',
    )
    .bind(`member:${member.id}`, key)
    .first<{ file_id: string; status: string }>();
}

void test('application upload keys survive file reselection; standalone keys keep intentional separate uploads distinct', async () => {
  assert.equal(
    await companyUploadKey(input()),
    await companyUploadKey(input()),
  );
  assert.notEqual(
    await companyUploadKey(input()),
    await companyUploadKey(input('another-application')),
  );
  assert.notEqual(
    await companyUploadKey(input()),
    await companyUploadKey(input('retry-application', 'CHANGED_BYTES')),
  );
  assert.notEqual(
    await companyUploadKey(input()),
    await companyUploadKey({ ...input(), partnerMemberId: peer.id }),
  );
  assert.equal(
    await companyUploadKey({
      ...input(),
      file: new File(['SYNTHETIC_DOCUMENT'], 'synthetic.txt', {
        type: 'text/html',
      }),
    }),
    await companyUploadKey(input()),
  );
  const nfcName = '한글자료.txt'.normalize('NFC');
  const nfdName = nfcName.normalize('NFD');
  assert.equal(
    await companyUploadKey({
      ...input(),
      file: new File(['SYNTHETIC_DOCUMENT'], nfcName, { type: 'text/plain' }),
    }),
    await companyUploadKey({
      ...input(),
      file: new File(['SYNTHETIC_DOCUMENT'], nfdName, { type: 'text/plain' }),
    }),
  );
  const standalone = { ...input(), caseId: undefined };
  assert.equal(
    await companyUploadKey(standalone),
    await companyUploadKey(standalone),
  );
  assert.notEqual(
    await companyUploadKey(standalone),
    await companyUploadKey({ ...input(), caseId: undefined }),
  );
});

void test('lost upload response recovers identical metadata and file ID without another R2 put', async () => {
  await readDuplicateRequestSummary();
  await companyFileDatabase()
    .prepare('DELETE FROM portal_duplicate_request_stats')
    .run();
  await seed();
  const key = 'lost-response-request';
  const first = await stored(await upload(request(key)));
  const bucket = companyFileBucket();
  const original = bucket.put.bind(bucket);
  bucket.put = async () => {
    throw new Error('Ready files must not be uploaded again');
  };
  try {
    assert.deepEqual(await stored(await upload(request(key))), first);
  } finally {
    bucket.put = original;
  }
  assert.equal((await rowFor(key))?.status, 'ready');
  assert.equal((await findCompanyFile(first.id))?.partner_member_id, member.id);
  await flushWaitUntil();
  assert.equal((await readDuplicateRequestSummary()).totalSafeRetries, 1);
});

void test('company upload stores registry MIME instead of browser MIME', async () => {
  await seed();
  const data = form();
  data.set(
    'file',
    new File(['SYNTHETIC_DOCUMENT'], 'synthetic.txt', { type: 'text/html' }),
  );
  const bucket = companyFileBucket();
  const originalPut = bucket.put.bind(bucket);
  let storedContentType: string | undefined;
  bucket.put = async (...args: Parameters<R2Bucket['put']>) => {
    const httpMetadata = args[2]?.httpMetadata;
    storedContentType =
      httpMetadata instanceof Headers
        ? (httpMetadata.get('content-type') ?? undefined)
        : httpMetadata?.contentType;
    return originalPut.apply(bucket, args);
  };
  try {
    const file = (
      (await (await upload(request('registry-mime-request', data))).json()) as {
        file: { id: string; contentType: string };
      }
    ).file;
    assert.equal(file.contentType, 'text/plain');
    assert.equal((await findCompanyFile(file.id))?.content_type, 'text/plain');
    assert.equal(storedContentType, 'text/plain');
  } finally {
    bucket.put = originalPut;
  }
});

void test('normalized application key migrates previous pending, ready and deleted ledgers', async () => {
  await seed();
  const db = companyFileDatabase();
  await ensureCompanyFileTables(db);
  const data = form();
  const legacyFile = new File(['SYNTHETIC_DOCUMENT'], 'synthetic.txt', {
    type: 'text/html',
  });
  data.set('file', legacyFile);
  const keyInput = { ...input('legacy-mime-key-case'), file: legacyFile };
  data.set('caseId', keyInput.caseId!);
  data.set('partnerMemberId', member.id);
  const bytes = await legacyFile.arrayBuffer();
  const keys = await companyUploadKeyVariants(keyInput, bytes);
  assert.equal(keys.legacyKeys.length, 1);
  const legacyKey = keys.legacyKeys[0];
  const legacyMetadata = {
    originalName: legacyFile.name,
    company: '가상기업',
    title: '가상 근거자료',
    category: '기타자료',
    assignedTrainee: member.name,
    partnerMemberId: member.id,
    caseId: keyInput.caseId!,
    contentType: legacyFile.type,
    sizeBytes: legacyFile.size,
  };
  const legacyFingerprint = await fileDigest(
    JSON.stringify(legacyMetadata) + (await fileDigest(bytes)),
  );
  const id = 'legacy-mime-retry-file';
  await db
    .prepare(`INSERT INTO company_file_upload_requests
      (owner_key, request_key, fingerprint, file_id, created_at, status)
      VALUES (?1, ?2, ?3, ?4, ?5, 'pending')`)
    .bind(
      `member:${member.id}`,
      legacyKey,
      legacyFingerprint,
      id,
      '2026-09-04T00:00:00.000Z',
    )
    .run();

  const response = await upload(request(keys.current, data));
  assert.equal(response.status, 201, await response.clone().text());
  assert.equal(
    ((await response.json()) as { file: { contentType: string } }).file
      .contentType,
    'text/plain',
  );
  assert.equal((await findCompanyFile(id))?.content_type, 'text/plain');
  assert.equal(await rowFor(legacyKey), null);
  assert.equal((await rowFor(keys.current))?.status, 'ready');

  await db
    .prepare(`UPDATE company_file_upload_requests
      SET request_key = ?1, fingerprint = ?2
      WHERE owner_key = ?3 AND request_key = ?4`)
    .bind(legacyKey, legacyFingerprint, `member:${member.id}`, keys.current)
    .run();
  const bucket = companyFileBucket();
  const originalPut = bucket.put.bind(bucket);
  bucket.put = async () => {
    throw new Error('A ready legacy request must reuse its stored original');
  };
  try {
    assert.equal(
      (await stored(await upload(request(keys.current, data)))).id,
      id,
    );
  } finally {
    bucket.put = originalPut;
  }
  assert.equal(await rowFor(legacyKey), null);
  assert.equal((await rowFor(keys.current))?.status, 'ready');

  assert.equal(
    (
      await remove(request('normalized-key-delete', form(), member, 'DELETE'), {
        params: Promise.resolve({ id }),
      })
    ).status,
    204,
  );
  await db
    .prepare(`UPDATE company_file_upload_requests
      SET request_key = ?1, fingerprint = ?2
      WHERE owner_key = ?3 AND request_key = ?4`)
    .bind(legacyKey, legacyFingerprint, `member:${member.id}`, keys.current)
    .run();
  assert.equal((await upload(request(keys.current, data))).status, 409);
  assert.equal(await rowFor(legacyKey), null);
  assert.equal((await rowFor(keys.current))?.status, 'deleted');
  assert.equal(await bucket.get(`company-source/${id}`), null);
});

void test('normalized application filename key resumes a previous NFD-name ledger', async () => {
  await seed();
  const db = companyFileDatabase();
  await ensureCompanyFileTables(db);
  const nfcName = '한글자료.txt'.normalize('NFC');
  const legacyFile = new File(
    ['SYNTHETIC_FILENAME_NORMALIZATION'],
    nfcName.normalize('NFD'),
    { type: 'text/plain' },
  );
  const caseId = 'legacy-filename-key-case';
  const keyInput = { ...input(caseId), file: legacyFile };
  const bytes = await legacyFile.arrayBuffer();
  const keys = await companyUploadKeyVariants(keyInput, bytes);
  assert.equal(keys.legacyKeys.length, 1);
  const legacyKey = keys.legacyKeys[0];
  const fingerprint = await fileDigest(
    JSON.stringify({
      originalName: nfcName,
      company: '가상기업',
      title: '가상 근거자료',
      category: '기타자료',
      assignedTrainee: member.name,
      partnerMemberId: member.id,
      caseId,
      contentType: 'text/plain',
      sizeBytes: legacyFile.size,
    }) + (await fileDigest(bytes)),
  );
  const id = 'legacy-filename-retry-file';
  await db
    .prepare(`INSERT INTO company_file_upload_requests
      (owner_key, request_key, fingerprint, file_id, created_at, status)
      VALUES (?1, ?2, ?3, ?4, ?5, 'pending')`)
    .bind(
      `member:${member.id}`,
      legacyKey,
      fingerprint,
      id,
      '2026-09-04T00:01:00.000Z',
    )
    .run();
  const data = form();
  data.set('file', legacyFile);
  data.set('caseId', caseId);
  data.set('partnerMemberId', member.id);

  assert.equal(
    (await stored(await upload(request(keys.current, data)))).id,
    id,
  );
  assert.equal(await rowFor(legacyKey), null);
  assert.equal((await rowFor(keys.current))?.status, 'ready');
  assert.equal((await findCompanyFile(id))?.original_name, nfcName);
});

void test('multiple matching legacy filename ledgers are preserved for review', async () => {
  await seed();
  const db = companyFileDatabase();
  await ensureCompanyFileTables(db);
  const nfcName = '중복자료.txt'.normalize('NFC');
  const legacyFile = new File(
    ['SYNTHETIC_AMBIGUOUS_FILENAME'],
    nfcName.normalize('NFD'),
    { type: 'text/html' },
  );
  const caseId = 'ambiguous-filename-key-case';
  const keyInput = { ...input(caseId), file: legacyFile };
  const bytes = await legacyFile.arrayBuffer();
  const keys = await companyUploadKeyVariants(keyInput, bytes);
  assert.ok(keys.legacyKeys.length >= 2);
  const bytesFingerprint = await fileDigest(bytes);
  const metadata = {
    originalName: nfcName,
    company: '가상기업',
    title: '가상 근거자료',
    category: '기타자료',
    assignedTrainee: member.name,
    partnerMemberId: member.id,
    caseId,
    contentType: 'text/plain',
    sizeBytes: legacyFile.size,
  };
  const fixedFingerprint = await fileDigest(
    JSON.stringify(metadata) + bytesFingerprint,
  );
  const browserFingerprint = await fileDigest(
    JSON.stringify({ ...metadata, contentType: 'text/html' }) +
      bytesFingerprint,
  );
  for (const [index, fingerprint] of [
    fixedFingerprint,
    browserFingerprint,
  ].entries())
    await db
      .prepare(`INSERT INTO company_file_upload_requests
        (owner_key, request_key, fingerprint, file_id, created_at, status)
        VALUES (?1, ?2, ?3, ?4, ?5, 'pending')`)
      .bind(
        `member:${member.id}`,
        keys.legacyKeys[index],
        fingerprint,
        `ambiguous-filename-file-${index}`,
        `2026-09-04T00:02:0${index}.000Z`,
      )
      .run();
  const data = form();
  data.set('file', legacyFile);
  data.set('caseId', caseId);
  data.set('partnerMemberId', member.id);

  assert.equal((await upload(request(keys.current, data))).status, 409);
  for (let index = 0; index < 2; index += 1) {
    assert.equal((await rowFor(keys.legacyKeys[index]))?.status, 'pending');
    assert.equal(
      await companyFileBucket().get(
        `company-source/ambiguous-filename-file-${index}`,
      ),
      null,
    );
  }
  assert.equal(await rowFor(keys.current), null);
});

void test('accepted upload without a request key records only the coverage warning', async () => {
  await readDuplicateRequestSummary();
  await companyFileDatabase()
    .prepare('DELETE FROM portal_duplicate_request_stats')
    .run();
  await seed();
  const unkeyed = request('unused-request-key');
  unkeyed.headers.delete('idempotency-key');
  assert.equal((await upload(unkeyed)).status, 201);
  await flushWaitUntil();
  const summary = await readDuplicateRequestSummary();
  assert.equal(summary.unkeyedUploadRequests, 1);
  assert.equal(summary.totalSafeRetries, 0);
  assert.equal(summary.totalRequestKeyConflicts, 0);
});

void test('concurrent retries converge; different bytes or metadata cannot hijack a request, and keys are account-scoped', async () => {
  await seed();
  const key = 'concurrent-upload-request';
  const responses = await Promise.all([
    upload(request(key)),
    upload(request(key)),
  ]);
  assert.equal(
    (await stored(responses[0])).id,
    (await stored(responses[1])).id,
  );
  const first = await stored(await upload(request(key)));
  assert.equal((await upload(request(key, form('DIFFERENT')))).status, 409);
  assert.equal(
    (await upload(request(key, form('SYNTHETIC_DOCUMENT', '변경기업')))).status,
    409,
  );
  const ownPeer = await stored(await upload(request(key, form(), peer)));
  assert.notEqual(ownPeer.id, first.id);
  assert.equal(ownPeer.partnerMemberId, peer.id);
  assert.equal(
    (
      await download(request(key, form(), peer, 'GET'), {
        params: Promise.resolve({ id: first.id }),
      })
    ).status,
    403,
  );
  const racing = await Promise.all([
    upload(request('different-byte-race', form('AAA'))),
    upload(request('different-byte-race', form('BBB'))),
  ]);
  assert.deepEqual(
    racing.map((item) => item.status).sort((a, b) => a - b),
    [201, 409],
  );
});

void test('R2 response loss and D1 failures before or after commit remain recoverable without deleting originals', async () => {
  await seed();
  const bucket = companyFileBucket();
  const db = companyFileDatabase();
  const originalPut = bucket.put.bind(bucket),
    originalBatch = db.batch.bind(db),
    originalDelete = bucket.delete.bind(bucket);
  let deletes = 0;
  bucket.delete = async () => {
    deletes++;
    throw new Error('Failure cleanup may not delete originals');
  };
  try {
    let once = true;
    bucket.put = async (...args: Parameters<R2Bucket['put']>) => {
      const result = await originalPut.apply(bucket, args);
      if (once) {
        once = false;
        throw new Error('Synthetic R2 response loss after write');
      }
      return result;
    };
    assert.equal((await upload(request('r2-response-lost'))).status, 500);
    const pending = await rowFor('r2-response-lost');
    assert.equal(pending?.status, 'pending');
    assert.ok(await bucket.get(`company-source/${pending?.file_id}`));
    assert.equal(
      (await stored(await upload(request('r2-response-lost')))).id,
      pending?.file_id,
    );
    bucket.put = originalPut;
    for (const afterCommit of [false, true]) {
      const key = afterCommit ? 'd1-response-lost' : 'd1-write-failed';
      once = true;
      db.batch = async <T = unknown>(statements: D1PreparedStatement[]) => {
        // Upload commit: object, object integrity, storage key, assignment, ledger.
        if (once && statements.length === 5) {
          once = false;
          if (afterCommit) await originalBatch.call(db, statements);
          throw new Error('Synthetic D1 commit uncertainty');
        }
        return originalBatch<T>(statements);
      };
      assert.equal((await upload(request(key))).status, 500);
      const failed = await rowFor(key);
      assert.equal(failed?.status, afterCommit ? 'ready' : 'pending');
      assert.ok(await bucket.get(`company-source/${failed?.file_id}`));
      db.batch = originalBatch;
      assert.equal(
        (await stored(await upload(request(key)))).id,
        failed?.file_id,
      );
    }
    assert.equal(deletes, 0);
  } finally {
    bucket.put = originalPut;
    bucket.delete = originalDelete;
    db.batch = originalBatch;
  }
});

void test('explicit deletion tombstones retries; failed deletion can be retried and does not expose the original', async () => {
  await seed();
  const key = 'deleted-upload-request';
  const file = await stored(await upload(request(key)));
  const context = { params: Promise.resolve({ id: file.id }) };
  assert.equal(
    (await remove(request(key, form(), peer, 'DELETE'), context)).status,
    403,
  );
  const bucket = companyFileBucket(),
    original = bucket.delete.bind(bucket);
  bucket.delete = async () => {
    throw new Error('Synthetic deletion failure');
  };
  try {
    assert.equal(
      (await remove(request(key, form(), member, 'DELETE'), context)).status,
      500,
    );
  } finally {
    bucket.delete = original;
  }
  assert.equal(
    (await download(request(key, form(), member, 'GET'), context)).status,
    404,
  );
  assert.equal((await upload(request(key))).status, 409);
  assert.equal(
    (await remove(request(key, form(), member, 'DELETE'), context)).status,
    204,
  );
  assert.equal(await findCompanyFile(file.id), null);
  assert.equal(await bucket.get(`company-source/${file.id}`), null);
  await readDuplicateRequestSummary();
  await companyFileDatabase()
    .prepare('DELETE FROM portal_duplicate_request_stats')
    .run();
  assert.equal((await upload(request(key))).status, 409);
  assert.equal(
    (await upload(request(key, form('CHANGED_AFTER_DELETE')))).status,
    409,
  );
  await flushWaitUntil();
  const summary = await readDuplicateRequestSummary();
  assert.equal(summary.totalSafeRetries, 0);
  assert.equal(summary.totalRequestKeyConflicts, 0);
});

void test(
  'a pending concurrent upload cannot resurrect an explicitly deleted file',
  { timeout: 10_000 },
  async () => {
    await seed();
    const key = 'delete-during-upload';
    const bucket = companyFileBucket(),
      original = bucket.put.bind(bucket);
    let release!: () => void,
      entered!: () => void,
      calls = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let firstEntered!: () => void, permitFirst!: () => void;
    const firstWaiting = new Promise<void>((resolve) => {
      firstEntered = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      permitFirst = resolve;
    });
    bucket.put = async (...args: Parameters<R2Bucket['put']>) => {
      if (++calls === 1) {
        firstEntered();
        await firstGate;
      } else {
        entered();
        permitFirst();
        await gate;
      }
      return original.apply(bucket, args);
    };
    try {
      const first = upload(request(key));
      await firstWaiting;
      const second = upload(request(key));
      await waiting;
      const file = await stored(await first);
      assert.equal(
        (
          await remove(request(key, form(), member, 'DELETE'), {
            params: Promise.resolve({ id: file.id }),
          })
        ).status,
        204,
      );
      release();
      assert.equal((await second).status, 409);
      assert.equal(await findCompanyFile(file.id), null);
      assert.equal(await bucket.get(`company-source/${file.id}`), null);
    } finally {
      release();
      permitFirst();
      bucket.put = original;
    }
  },
);

void test('multi-file application retry reuses both acknowledged and uncertain uploads without duplicate objects', async () => {
  await seed();
  const originalFetch = globalThis.fetch;
  let failSecond = true;
  const inputs = [
    input('batch-application'),
    input('batch-application', 'SECOND_DOCUMENT'),
  ];
  const secondKey = await companyUploadKey(inputs[1]);
  globalThis.fetch = async (_url, init) => {
    const key = new Headers(init?.headers).get('idempotency-key')!;
    const response = await upload(request(key, init?.body as FormData));
    if (key === secondKey && failSecond) {
      failSecond = false;
      throw new Error('Synthetic lost second response');
    }
    return response;
  };
  const submission = new ApplicationSubmission<string[]>();
  const prepare = async () => {
    const files = [];
    for (const item of inputs) files.push((await uploadCompanyFile(item)).id);
    return files;
  };
  try {
    await assert.rejects(
      submission.submit(prepare, async () => {}),
      /자동 삭제하지 않습니다/,
    );
    const first = await rowFor(await companyUploadKey(inputs[0]));
    const second = await rowFor(secondKey);
    assert.ok(await findCompanyFile(first!.file_id));
    assert.ok(await findCompanyFile(second!.file_id));
    const ids = await submission.submit(prepare, async () => {});
    assert.deepEqual(ids, [first!.file_id, second!.file_id]);
    // Reselecting the original files after a reload also recovers the same IDs.
    assert.equal(
      (await uploadCompanyFile(input('batch-application'))).id,
      first!.file_id,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test('upload client rejects unreadable or mismatched file acknowledgements', async () => {
  const originalFetch = globalThis.fetch;
  const requestInput = input('client-response-case');
  const validFile = {
    id: 'client-file-1',
    fileName: requestInput.file.name,
    sizeBytes: requestInput.file.size,
    contentType: requestInput.file.type,
    createdAt: '2026-09-03T00:00:00.000Z',
    assignedTrainee: requestInput.assignedTrainee,
    partnerMemberId: requestInput.partnerMemberId,
    caseId: requestInput.caseId,
    category: requestInput.category,
    title: requestInput.title,
  };
  try {
    globalThis.fetch = async () =>
      new Response('<html>unavailable</html>', { status: 502 });
    await assert.rejects(
      uploadCompanyFile(requestInput),
      /응답을 읽지 못했습니다.*자동 삭제하지 않습니다/,
    );
    for (const file of [
      { ...validFile, id: 'short' },
      { ...validFile, fileName: 'another.txt' },
      { ...validFile, sizeBytes: validFile.sizeBytes + 1 },
      { ...validFile, contentType: 'image/png' },
      { ...validFile, caseId: 'another-case' },
      { ...validFile, category: 'unknown' },
      { ...validFile, partnerMemberId: 'another-member' },
    ]) {
      globalThis.fetch = async () => Response.json({ file });
      await assert.rejects(
        uploadCompanyFile(requestInput),
        /완료 응답 형식이 올바르지 않습니다.*자동 삭제하지 않습니다/,
      );
    }
    globalThis.fetch = async () =>
      Response.json({ file: { ...validFile, storageKey: 'must-not-escape' } });
    const stored = await uploadCompanyFile(requestInput);
    assert.equal(stored.id, validFile.id);
    assert.equal(Object.hasOwn(stored, 'storageKey'), false);

    const spoofedInput = {
      ...requestInput,
      file: new File(['SYNTHETIC_DOCUMENT'], requestInput.file.name, {
        type: 'text/html',
      }),
    };
    for (const acknowledgedContentType of ['text/plain', 'text/html']) {
      globalThis.fetch = async () =>
        Response.json({
          file: { ...validFile, contentType: acknowledgedContentType },
        });
      assert.equal(
        (await uploadCompanyFile(spoofedInput)).contentType,
        'text/plain',
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void test('invalid request keys, changed login identity and cross-origin retries cannot write', async () => {
  await seed();
  for (const key of ['short', 'invalid!', 'x'.repeat(129)])
    assert.equal((await upload(request(key))).status, 400);
  const wrong = form();
  wrong.set('expectedUserId', 'another-account');
  assert.equal(
    (await upload(request('identity-retry-key', wrong))).status,
    403,
  );
  const cross = request('cross-origin-retry');
  cross.headers.set('origin', 'https://untrusted.invalid');
  assert.equal((await upload(cross)).status, 403);
  assert.equal(await rowFor('identity-retry-key'), null);
});

void test('abandoned draft attachments stay out of intake review; only explicitly submitted documents become selectable', async () => {
  await seed();
  const caseId = 'case-draft-staged-application';
  const selectedForm = form('SYNTHETIC_DOCUMENT_FOR_INTAKE_REVIEW'),
    abandonedForm = form('ABANDONED_SYNTHETIC');
  selectedForm.set('caseId', caseId);
  abandonedForm.set('caseId', caseId);
  const selected = await stored(
    await upload(request('staged-selected-request', selectedForm)),
  );
  const abandoned = await stored(
    await upload(request('staged-abandoned-request', abandonedForm)),
  );
  const flow = newConsultingFlow(caseId, '가상기업', member.id, member.name);
  assert.deepEqual(
    (await listIntakeSources(flow)).files.filter((f) =>
      [selected.id, abandoned.id].includes(f.id),
    ),
    [],
  );
  await writePortalState({
    version: 1,
    members: [member, peer],
    cases: [{ id: caseId, company: '가상기업', partnerMemberId: member.id }],
    companyDocuments: [
      { id: `doc-${selected.id}`, storageFileId: selected.id, caseId },
    ],
  });
  const files = (await listIntakeSources(flow)).files;
  assert.ok(files.some((f) => f.id === selected.id));
  assert.ok(!files.some((f) => f.id === abandoned.id));
  assert.equal(
    (await previewIntakeSource(flow, selected.id)).text,
    'SYNTHETIC_DOCUMENT_FOR_INTAKE_REVIEW',
  );
  await assert.rejects(
    previewIntakeSource(flow, abandoned.id),
    /찾지 못했습니다/,
  );
  assert.ok(
    await findCompanyFile(abandoned.id),
    'Keep original for an explicit later recovery; never auto-delete it',
  );
});
