import test from 'node:test';
import assert from 'node:assert/strict';
import { POST as upload } from '../app/api/files/route';
import { GET as download, DELETE as remove } from '../app/api/files/[id]/route';
import { readPortalState, writePortalState } from '../lib/portal-state';
import {
  companyFileBucket,
  companyFileDatabase,
  findCompanyFile,
} from '../lib/company-files';

const member = {
  id: 'race-partner',
  name: '가상 담당자',
  email: 'race@example.invalid',
  status: '활성',
  permissions: { ownCases: true, fileUpload: true, collaborationApply: true },
};
let sequence = 0;
async function seed() {
  await writePortalState({
    version: 1,
    consultationNumber: 0,
    members: [member],
    cases: [],
    tasks: [],
    timeline: [],
    schedule: [],
    companyDocuments: [],
  });
}
async function suspend() {
  const state = (await readPortalState()) as {
    members: Array<{ status: string }>;
  };
  state.members[0].status = '정지';
  await writePortalState(state);
}
function request(method = 'POST', key = `operation-race-${++sequence}`) {
  const form = new FormData();
  form.set(
    'file',
    new File(['SYNTHETIC_RACE_ORIGINAL'], 'race.txt', { type: 'text/plain' }),
  );
  form.set('company', '가상 경합기업');
  form.set('title', '가상 원본');
  form.set('category', '기타자료');
  form.set('consent', 'confirmed');
  return new Request('http://localhost/api/files', {
    method,
    headers: {
      origin: 'http://localhost',
      'idempotency-key': key,
      'oai-authenticated-user-id': member.email,
      'oai-authenticated-user-email': member.email,
    },
    ...(method === 'POST' ? { body: form } : {}),
  });
}
async function create() {
  const response = await upload(request());
  assert.equal(response.status, 201, await response.clone().text());
  return ((await response.json()) as { file: { id: string } }).file.id;
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });

void test(
  'upload finishing between the delete lookup and ledger check cannot yield false deletion success',
  { timeout: 10_000 },
  async () => {
    await seed();
    const key = `operation-race-${++sequence}`,
      db = companyFileDatabase(),
      bucket = companyFileBucket();
    const put = bucket.put.bind(bucket),
      prepare = db.prepare.bind(db);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    bucket.put = async (...args: Parameters<R2Bucket['put']>) => {
      const result = await put(...args);
      entered();
      await gate;
      return result;
    };
    const uploading = upload(request('POST', key));
    try {
      await waiting;
      const ledger = await db
        .prepare(
          'SELECT file_id FROM company_file_upload_requests WHERE request_key = ?1',
        )
        .bind(key)
        .first<{ file_id: string }>();
      let once = true;
      const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
        new Proxy(statement, {
          get(target, property) {
            if (property === 'bind')
              return (...values: unknown[]) => wrap(target.bind(...values));
            if (property === 'first')
              return async () => {
                const row = await target.first();
                if (once) {
                  once = false;
                  assert.equal(row, null);
                  release();
                  assert.equal((await uploading).status, 201);
                }
                return row;
              };
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      db.prepare = (sql: string) =>
        sql.includes('SELECT f.id, storage_key')
          ? wrap(prepare(sql))
          : prepare(sql);
      assert.equal(
        (await remove(request('DELETE'), context(ledger!.file_id))).status,
        409,
      );
      assert.ok(await findCompanyFile(ledger!.file_id));
      assert.ok(await bucket.get(`company-source/${ledger!.file_id}`));
    } finally {
      release();
      await uploading;
      bucket.put = put;
      db.prepare = prepare;
    }
  },
);

void test('suspension just before the durable deletion decision cannot delete the original', async () => {
  await seed();
  const id = await create(),
    db = companyFileDatabase(),
    prepare = db.prepare.bind(db);
  let once = true;
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, property) {
        if (property === 'bind')
          return (...values: unknown[]) => wrap(target.bind(...values));
        if (property === 'run')
          return async () => {
            if (once) {
              once = false;
              await suspend();
            }
            return target.run();
          };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  db.prepare = (sql: string) =>
    sql.includes("'legacy-explicit-delete'")
      ? wrap(prepare(sql))
      : prepare(sql);
  try {
    assert.equal((await remove(request('DELETE'), context(id))).status, 403);
  } finally {
    db.prepare = prepare;
  }
  assert.ok(await findCompanyFile(id));
  assert.ok(await companyFileBucket().get(`company-source/${id}`));
  assert.equal(
    (
      await db
        .prepare(
          'SELECT status FROM company_file_upload_requests WHERE file_id = ?1',
        )
        .bind(id)
        .first<{ status: string }>()
    )?.status,
    'ready',
  );
});

void test('concurrent explicit deletes remain idempotent', async () => {
  await seed();
  const id = await create();
  const responses = await Promise.all([
    remove(request('DELETE'), context(id)),
    remove(request('DELETE'), context(id)),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status),
    [204, 204],
  );
  assert.equal(await findCompanyFile(id), null);
  assert.equal(await companyFileBucket().get(`company-source/${id}`), null);
});

void test('revoking only upload permission while R2 writes preserves a pending original', async () => {
  await seed();
  const key = `operation-race-${++sequence}`,
    bucket = companyFileBucket(),
    put = bucket.put.bind(bucket);
  bucket.put = async (...args: Parameters<R2Bucket['put']>) => {
    const result = await put(...args);
    const state = (await readPortalState()) as {
      members: Array<{ permissions: { fileUpload: boolean } }>;
    };
    state.members[0].permissions.fileUpload = false;
    await writePortalState(state);
    return result;
  };
  try {
    assert.equal((await upload(request('POST', key))).status, 403);
  } finally {
    bucket.put = put;
  }
  const ledger = await companyFileDatabase()
    .prepare(
      'SELECT file_id, status FROM company_file_upload_requests WHERE request_key = ?1',
    )
    .bind(key)
    .first<{ file_id: string; status: string }>();
  assert.equal(ledger?.status, 'pending');
  assert.equal(await findCompanyFile(ledger!.file_id), null);
  assert.ok(await bucket.get(`company-source/${ledger!.file_id}`));
});

void test('upload rechecks suspension after a slow request body before retaining any original', async () => {
  await seed();
  const key = `operation-race-${++sequence}`,
    req = request('POST', key);
  const stream = req.body!,
    getReader = stream.getReader.bind(stream);
  Object.defineProperty(stream, 'getReader', {
    value: () => {
      const reader = getReader(),
        read = reader.read.bind(reader);
      let once = true;
      reader.read = async () => {
        if (once) {
          once = false;
          await suspend();
        }
        return read();
      };
      return reader;
    },
  });
  assert.equal((await upload(req)).status, 403);
  assert.equal(
    await companyFileDatabase()
      .prepare(
        'SELECT file_id FROM company_file_upload_requests WHERE request_key = ?1',
      )
      .bind(key)
      .first(),
    null,
  );
});

void test('download denies a session suspended while R2 resolves and leaves the original intact', async () => {
  await seed();
  const id = await create(),
    bucket = companyFileBucket(),
    get = bucket.get.bind(bucket);
  bucket.get = async (...args: Parameters<R2Bucket['get']>) => {
    const object = await get(...args);
    await suspend();
    return object;
  };
  try {
    assert.equal((await download(request('GET'), context(id))).status, 403);
  } finally {
    bucket.get = get;
  }
  assert.ok(await bucket.get(`company-source/${id}`));
  assert.ok(await findCompanyFile(id));
});

void test('upload suspended while R2 stores bytes does not publish metadata and preserves the uncertain original', async () => {
  await seed();
  const key = `operation-race-${++sequence}`,
    bucket = companyFileBucket(),
    put = bucket.put.bind(bucket);
  bucket.put = async (...args: Parameters<R2Bucket['put']>) => {
    const result = await put(...args);
    await suspend();
    return result;
  };
  try {
    assert.equal((await upload(request('POST', key))).status, 403);
  } finally {
    bucket.put = put;
  }
  const ledger = await companyFileDatabase()
    .prepare(
      'SELECT file_id, status FROM company_file_upload_requests WHERE request_key = ?1',
    )
    .bind(key)
    .first<{ file_id: string; status: string }>();
  assert.equal(ledger?.status, 'pending');
  assert.equal(await findCompanyFile(ledger!.file_id), null);
  assert.ok(await bucket.get(`company-source/${ledger!.file_id}`));
  await seed();
  const retried = await upload(request('POST', key));
  assert.equal(retried.status, 201, await retried.clone().text());
  assert.equal(
    ((await retried.json()) as { file: { id: string } }).file.id,
    ledger!.file_id,
  );
});

void test('download does not return a body deleted while R2 resolves', async () => {
  await seed();
  const id = await create(),
    bucket = companyFileBucket(),
    get = bucket.get.bind(bucket);
  bucket.get = async (...args: Parameters<R2Bucket['get']>) => {
    const object = await get(...args);
    assert.equal((await remove(request('DELETE'), context(id))).status, 204);
    return object;
  };
  try {
    assert.equal((await download(request('GET'), context(id))).status, 404);
  } finally {
    bucket.get = get;
  }
});

void test('deletion rechecks a suspension after initial authentication and preserves the file', async () => {
  await seed();
  const id = await create();
  const delayedContext = {
    get params() {
      return suspend().then(() => ({ id }));
    },
  };
  assert.equal((await remove(request('DELETE'), delayedContext)).status, 403);
  assert.ok(await findCompanyFile(id));
  assert.ok(await companyFileBucket().get(`company-source/${id}`));
});

void test('a not-yet-committed upload returns a deletion conflict instead of a false success', async () => {
  await seed();
  const key = `operation-race-${++sequence}`,
    bucket = companyFileBucket(),
    put = bucket.put.bind(bucket);
  let deletionStatus = 0;
  bucket.put = async (...args: Parameters<R2Bucket['put']>) => {
    const ledger = await companyFileDatabase()
      .prepare(
        'SELECT file_id FROM company_file_upload_requests WHERE request_key = ?1',
      )
      .bind(key)
      .first<{ file_id: string }>();
    deletionStatus = (await remove(request('DELETE'), context(ledger!.file_id)))
      .status;
    return put(...args);
  };
  try {
    assert.equal((await upload(request('POST', key))).status, 201);
  } finally {
    bucket.put = put;
  }
  assert.equal(deletionStatus, 409);
});

void test('failed explicit deletion of a legacy file also blocks downloads until retried', async () => {
  await seed();
  const id = await create(),
    db = companyFileDatabase(),
    bucket = companyFileBucket(),
    del = bucket.delete.bind(bucket);
  // Synthetic legacy fixture: originals created before the upload request ledger.
  await db
    .prepare('DELETE FROM company_file_upload_requests WHERE file_id = ?1')
    .bind(id)
    .run();
  bucket.delete = async () => {
    throw new Error('Synthetic legacy R2 delete failure');
  };
  try {
    assert.equal((await remove(request('DELETE'), context(id))).status, 500);
  } finally {
    bucket.delete = del;
  }
  assert.equal((await download(request('GET'), context(id))).status, 404);
  assert.ok(await bucket.get(`company-source/${id}`));
  assert.equal((await remove(request('DELETE'), context(id))).status, 204);
  assert.equal(await bucket.get(`company-source/${id}`), null);
});

void test('suspension immediately before the metadata transaction cannot commit a stale upload', async () => {
  await seed();
  const key = `operation-race-${++sequence}`,
    db = companyFileDatabase(),
    batch = db.batch.bind(db);
  let once = true;
  db.batch = async <T = unknown>(statements: D1PreparedStatement[]) => {
    if (once && statements.length === 3) {
      once = false;
      await suspend();
    }
    return batch<T>(statements);
  };
  try {
    assert.ok([403, 409].includes((await upload(request('POST', key))).status));
  } finally {
    db.batch = batch;
  }
  const ledger = await db
    .prepare(
      'SELECT file_id, status FROM company_file_upload_requests WHERE request_key = ?1',
    )
    .bind(key)
    .first<{ file_id: string; status: string }>();
  assert.equal(ledger?.status, 'pending');
  assert.equal(await findCompanyFile(ledger!.file_id), null);
  assert.ok(await companyFileBucket().get(`company-source/${ledger!.file_id}`));
});
