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
async function linkToPortalDocument(id: string) {
  const row = await findCompanyFile(id);
  assert.ok(row);
  const state = (await readPortalState()) as {
    companyDocuments: Array<Record<string, unknown>>;
  };
  state.companyDocuments = [
    {
      id: `linked-${id}`,
      company: row.company,
      title: row.title,
      category: row.category,
      status: '제출완료',
      assignedTrainee: row.assigned_trainee,
      partnerMemberId: row.partner_member_id,
      submittedBy: row.assigned_trainee,
      updatedAt: '방금 전',
      version: 'V1',
      sensitive: true,
      storageFileId: row.id,
      fileName: row.original_name,
      fileSize: row.size_bytes,
    },
  ];
  await writePortalState(state);
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });

void test('an original linked to a portal document cannot be deleted behind the card', async () => {
  await seed();
  const id = await create();
  await linkToPortalDocument(id);
  const response = await remove(request('DELETE'), context(id));
  assert.equal(response.status, 409, await response.clone().text());
  assert.match(
    ((await response.json()) as { error: string }).error,
    /연결된 원본/,
  );
  assert.ok(await findCompanyFile(id));
  assert.ok(await companyFileBucket().get(`company-source/${id}`));
});

void test('a portal link committed immediately before deletion keeps the original', async () => {
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
              await linkToPortalDocument(id);
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
    assert.equal((await remove(request('DELETE'), context(id))).status, 409);
  } finally {
    db.prepare = prepare;
  }
  assert.ok(await findCompanyFile(id));
  assert.ok(await companyFileBucket().get(`company-source/${id}`));
  assert.equal(
    ((await readPortalState()) as { companyDocuments: unknown[] })
      .companyDocuments.length,
    1,
  );
});

void test('deletion rejects a cross-file R2 key before deleting that object', async () => {
  await seed();
  const id = await create(),
    originalKey = `company-source/${id}`,
    foreignKey = `company-source/foreign-delete-${id}`,
    db = companyFileDatabase(),
    bucket = companyFileBucket(),
    del = bucket.delete.bind(bucket);
  await bucket.put(foreignKey, 'SYNTHETIC_RACE_ORIGINAL', {
    httpMetadata: { contentType: 'text/plain' },
  });
  await db
    .prepare('UPDATE company_file_objects SET storage_key = ?2 WHERE id = ?1')
    .bind(id, foreignKey)
    .run();
  let deleteCalls = 0;
  bucket.delete = async (...args: Parameters<R2Bucket['delete']>) => {
    deleteCalls++;
    return del(...args);
  };
  try {
    const response = await remove(request('DELETE'), context(id));
    assert.equal(response.status, 503, await response.clone().text());
    assert.match(
      ((await response.json()) as { error: string }).error,
      /무결성/,
    );
    assert.equal(deleteCalls, 0);
  } finally {
    bucket.delete = del;
  }
  assert.ok(await bucket.get(originalKey));
  assert.ok(await bucket.get(foreignKey));
});

void test('a storage-key change before the durable deletion decision preserves both objects', async () => {
  await seed();
  const id = await create(),
    originalKey = `company-source/${id}`,
    foreignKey = `company-source/foreign-delete-race-${id}`,
    db = companyFileDatabase(),
    bucket = companyFileBucket(),
    prepare = db.prepare.bind(db),
    del = bucket.delete.bind(bucket);
  await bucket.put(foreignKey, 'SYNTHETIC_RACE_ORIGINAL', {
    httpMetadata: { contentType: 'text/plain' },
  });
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
              await prepare(
                'UPDATE company_file_objects SET storage_key = ?2 WHERE id = ?1',
              )
                .bind(id, foreignKey)
                .run();
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
  let deleteCalls = 0;
  bucket.delete = async (...args: Parameters<R2Bucket['delete']>) => {
    deleteCalls++;
    return del(...args);
  };
  try {
    assert.equal((await remove(request('DELETE'), context(id))).status, 409);
    assert.equal(deleteCalls, 0);
  } finally {
    db.prepare = prepare;
    bucket.delete = del;
  }
  assert.ok(await bucket.get(originalKey));
  assert.ok(await bucket.get(foreignKey));
});

void test('a storage-key change after R2 deletion preserves the conflicting D1 facts', async () => {
  await seed();
  const id = await create(),
    originalKey = `company-source/${id}`,
    foreignKey = `company-source/foreign-cleanup-race-${id}`,
    db = companyFileDatabase(),
    bucket = companyFileBucket(),
    del = bucket.delete.bind(bucket);
  await bucket.put(foreignKey, 'SYNTHETIC_RACE_ORIGINAL', {
    httpMetadata: { contentType: 'text/plain' },
  });
  bucket.delete = async (...args: Parameters<R2Bucket['delete']>) => {
    await del(...args);
    await db
      .prepare('UPDATE company_file_objects SET storage_key = ?2 WHERE id = ?1')
      .bind(id, foreignKey)
      .run();
  };
  try {
    assert.equal((await remove(request('DELETE'), context(id))).status, 409);
  } finally {
    bucket.delete = del;
  }
  assert.equal((await findCompanyFile(id))?.storage_key, foreignKey);
  assert.equal(await bucket.get(originalKey), null);
  assert.ok(await bucket.get(foreignKey));
  assert.deepEqual(
    {
      ...(await db
        .prepare(
          'SELECT storage_key FROM company_file_storage_keys WHERE file_id = ?1',
        )
        .bind(id)
        .first()),
    },
    { storage_key: originalKey },
  );
  assert.ok(
    await db
      .prepare(
        'SELECT file_id FROM company_file_object_integrity WHERE file_id = ?1',
      )
      .bind(id)
      .first(),
  );
  assert.ok(
    await db
      .prepare(
        'SELECT file_id FROM company_file_assignments WHERE file_id = ?1',
      )
      .bind(id)
      .first(),
  );

  await db
    .prepare('UPDATE company_file_objects SET storage_key = ?2 WHERE id = ?1')
    .bind(id, originalKey)
    .run();
  await bucket.put(originalKey, 'SYNTHETIC_RACE_ORIGINAL', {
    httpMetadata: { contentType: 'text/plain' },
  });
  assert.equal((await remove(request('DELETE'), context(id))).status, 204);
  await bucket.delete(foreignKey);
});

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

void test('download rejects an R2 original whose size no longer matches the D1 ledger', async () => {
  await seed();
  const id = await create(),
    bucket = companyFileBucket(),
    key = `company-source/${id}`;
  await bucket.put(key, 'BROKEN');
  const response = await download(request('GET'), context(id));
  assert.equal(response.status, 409, await response.clone().text());
  assert.match(
    ((await response.json()) as { error: string }).error,
    /보관 상태/,
  );
  assert.ok(await findCompanyFile(id));
  assert.equal((await bucket.head(key))?.size, 6);
});

void test('download rejects a same-size R2 byte replacement', async () => {
  await seed();
  const id = await create(),
    bucket = companyFileBucket(),
    key = `company-source/${id}`,
    replacement = new TextEncoder().encode('SYNTHETIC_RACE_ORIGINAL');
  replacement[replacement.byteLength - 1] ^= 1;
  await bucket.put(key, replacement, {
    httpMetadata: { contentType: 'text/plain' },
  });
  const response = await download(request('GET'), context(id));
  assert.equal(response.status, 409, await response.clone().text());
  assert.match(
    ((await response.json()) as { error: string }).error,
    /보관 상태/,
  );
});

void test('new uploads bind the native R2 ETag and MIME in D1', async () => {
  await seed();
  const id = await create(),
    head = await companyFileBucket().head(`company-source/${id}`),
    db = companyFileDatabase(),
    integrity = await db
      .prepare(`SELECT validation_mode, r2_etag, r2_content_type
        FROM company_file_object_integrity WHERE file_id = ?1`)
      .bind(id)
      .first(),
    storageKey = await db
      .prepare(
        'SELECT storage_key FROM company_file_storage_keys WHERE file_id = ?1',
      )
      .bind(id)
      .first();
  assert.ok(head);
  assert.deepEqual(
    { ...integrity },
    {
      validation_mode: 'etag',
      r2_etag: head.etag,
      r2_content_type: 'text/plain',
    },
  );
  assert.deepEqual({ ...storageKey }, { storage_key: `company-source/${id}` });
});

void test('download rejects an R2 MIME replacement', async () => {
  await seed();
  const id = await create(),
    bucket = companyFileBucket(),
    key = `company-source/${id}`;
  await bucket.put(key, 'SYNTHETIC_RACE_ORIGINAL', {
    httpMetadata: { contentType: 'application/pdf' },
  });
  assert.equal((await download(request('GET'), context(id))).status, 409);
});

void test('download fails closed when the object-integrity ledger row is missing', async () => {
  await seed();
  const id = await create();
  await companyFileDatabase()
    .prepare('DELETE FROM company_file_object_integrity WHERE file_id = ?1')
    .bind(id)
    .run();
  const response = await download(request('GET'), context(id));
  assert.equal(response.status, 503, await response.clone().text());
  assert.match(((await response.json()) as { error: string }).error, /무결성/);
});

void test('download rejects a cross-file R2 key before reading that object', async () => {
  await seed();
  const id = await create();
  const foreignKey = 'company-source/foreign-private-object';
  const db = companyFileDatabase();
  const bucket = companyFileBucket();
  await bucket.put(foreignKey, 'SYNTHETIC_RACE_ORIGINAL', {
    httpMetadata: { contentType: 'text/plain' },
  });
  await db.batch([
    db
      .prepare(`UPDATE company_file_objects
        SET storage_key = ?2 WHERE id = ?1`)
      .bind(id, foreignKey),
    db
      .prepare(`UPDATE company_file_object_integrity
        SET validation_mode = 'metadata', r2_etag = NULL WHERE file_id = ?1`)
      .bind(id),
  ]);
  const originalGet = bucket.get.bind(bucket);
  let getCalls = 0;
  bucket.get = async (...args: Parameters<R2Bucket['get']>) => {
    getCalls++;
    return originalGet(...args);
  };
  try {
    const response = await download(request('GET'), context(id));
    assert.equal(response.status, 503, await response.clone().text());
    assert.match(
      ((await response.json()) as { error: string }).error,
      /무결성/,
    );
    assert.equal(getCalls, 0);
  } finally {
    bucket.get = originalGet;
  }
  assert.ok(await originalGet(`company-source/${id}`));
  assert.ok(await originalGet(foreignKey));
});

void test('ready upload retry rejects a same-size R2 replacement', async () => {
  await seed();
  const requestKey = `operation-race-${++sequence}`,
    first = await upload(request('POST', requestKey));
  assert.equal(first.status, 201, await first.clone().text());
  const id = ((await first.json()) as { file: { id: string } }).file.id,
    replacement = new TextEncoder().encode('SYNTHETIC_RACE_ORIGINAL');
  replacement[0] ^= 1;
  await companyFileBucket().put(`company-source/${id}`, replacement, {
    httpMetadata: { contentType: 'text/plain' },
  });
  assert.equal((await upload(request('POST', requestKey))).status, 409);
});

void test('download rejects a D1 size change committed while R2 resolves', async () => {
  await seed();
  const id = await create(),
    db = companyFileDatabase(),
    bucket = companyFileBucket(),
    get = bucket.get.bind(bucket);
  bucket.get = async (...args: Parameters<R2Bucket['get']>) => {
    const object = await get(...args);
    await db
      .prepare(
        'UPDATE company_file_objects SET size_bytes = size_bytes + 1 WHERE id = ?1',
      )
      .bind(id)
      .run();
    return object;
  };
  try {
    const response = await download(request('GET'), context(id));
    assert.equal(response.status, 409, await response.clone().text());
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
    if (once && statements.length === 5) {
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
