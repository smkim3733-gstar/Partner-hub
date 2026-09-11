import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  readBackupStorageLinks,
  verifyBackupStorageLinks,
} from '../scripts/supabase-backup-storage-links.mjs';

const rev = (index: number) =>
  `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const data = (index: number) => Buffer.from(`synthetic content ${index}`);
const version = (index: number, objectKey = 'company-source/test') => ({
  objectKey,
  revision: rev(index),
  path: `partner-hub/objects/v1/${rev(index)}`,
  size: data(index).length,
  sha256: hash(data(index)),
});
const object = (index: number) => ({
  path: version(index).path,
  size: data(index).length,
  sha256: hash(data(index)),
  bytesBase64: data(index).toString('base64'),
});
const error = { message: 'SUPABASE_BACKUP_STORAGE_LINKS_FAILED' };
function fixture(count = 2) {
  const versions = Array.from({ length: count }, (_, index) =>
    version(index + 1),
  );
  const heads = count
    ? [
        {
          objectKey: versions[0].objectKey,
          revision: rev(count),
          versionRevision: rev(count),
        },
      ]
    : [];
  const links = { version: 1, versions, heads };
  const objects = versions.map((_, index) => object(index + 1));
  const storage = {
    version: 1,
    objects,
    totalBytes: objects.reduce((sum, item) => sum + item.size, 0),
  };
  return { links, storage };
}

void test('empty manifest and empty storage verify explicit zero counts', () => {
  const fx = fixture(0);
  assert.deepEqual(verifyBackupStorageLinks(fx.links, fx.storage), {
    versionCount: 0,
    activeHeadCount: 0,
    tombstoneHeadCount: 0,
    matchedObjects: 0,
    extraObjects: 0,
    totalReferencedBytes: 0,
  });
});

void test('every retained version is checked while extra staging and originals remain backed up', () => {
  const fx = fixture();
  const extras = [
    { ...object(3), path: `partner-hub/staging/v1/${rev(3)}` },
    object(4),
  ];
  fx.storage.objects.push(...extras);
  fx.storage.totalBytes += extras.reduce((sum, item) => sum + item.size, 0);
  assert.deepEqual(verifyBackupStorageLinks(fx.links, fx.storage), {
    versionCount: 2,
    activeHeadCount: 1,
    tombstoneHeadCount: 0,
    matchedObjects: 2,
    extraObjects: 2,
    totalReferencedBytes: data(1).length + data(2).length,
  });
  // Removing the obsolete version must fail even though the active head exists.
  fx.storage.objects.shift();
  fx.storage.totalBytes -= data(1).length;
  assert.throws(() => verifyBackupStorageLinks(fx.links, fx.storage), error);
});

void test('tombstones allow null versions but preserve and verify historical bytes', () => {
  const fx = fixture();
  const links = {
    ...fx.links,
    heads: [
      {
        objectKey: 'company-source/test',
        revision: rev(9),
        versionRevision: null,
      },
    ],
  };
  const result = verifyBackupStorageLinks(links, fx.storage);
  assert.equal(result.activeHeadCount, 0);
  assert.equal(result.tombstoneHeadCount, 1);
  assert.equal(result.matchedObjects, 2);
});

void test('missing active head targets, revision mismatch and duplicate paths fail', () => {
  for (const mode of ['target', 'revision', 'path', 'head', 'version']) {
    const fx = fixture();
    if (mode === 'target')
      fx.links.heads[0] = {
        ...fx.links.heads[0],
        revision: rev(9),
        versionRevision: rev(9),
      };
    if (mode === 'revision') fx.links.heads[0].versionRevision = rev(1);
    if (mode === 'path')
      fx.storage.objects[1].path = fx.storage.objects[0].path;
    if (mode === 'head') fx.links.heads.push({ ...fx.links.heads[0] });
    if (mode === 'version') fx.links.versions.push({ ...fx.links.versions[0] });
    assert.throws(() => verifyBackupStorageLinks(fx.links, fx.storage), error);
  }
});

void test('DB size and digest must match actual bytes, not only archive claims', () => {
  for (const mode of ['db-size', 'db-sha', 'body', 'sha', 'base64', 'total']) {
    const fx = fixture();
    if (mode === 'db-size') fx.links.versions[0].size++;
    if (mode === 'db-sha') fx.links.versions[0].sha256 = '0'.repeat(64);
    if (mode === 'body')
      fx.storage.objects[0].bytesBase64 = data(9).toString('base64');
    if (mode === 'sha') fx.storage.objects[0].sha256 = '0'.repeat(64);
    if (mode === 'base64') fx.storage.objects[0].bytesBase64 += '\n';
    if (mode === 'total') fx.storage.totalBytes++;
    assert.throws(() => verifyBackupStorageLinks(fx.links, fx.storage), error);
  }
});

function databaseFixture(count = 2) {
  const fx = fixture(count);
  const calls: string[] = [];
  const unsafe = async (query: string, parameters: number[] = []) => {
    calls.push(query);
    assert.match(query.trim(), /^SELECT\s/);
    if (query.includes('current_setting'))
      return [{ read_only: 'on', isolation: 'repeatable read' }];
    if (query.includes('count(*)'))
      return [
        {
          versions: String(fx.links.versions.length),
          heads: String(fx.links.heads.length),
        },
      ];
    if (query.includes('FROM partner_hub.storage_object_versions'))
      return fx.links.versions
        .slice(parameters[0], parameters[0] + 100)
        .map((item) => ({
          object_key: item.objectKey,
          revision: item.revision,
          physical_path: item.path,
          wire: JSON.stringify({
            key: item.objectKey,
            version: item.revision,
            size: item.size,
            checksums: { sha256: item.sha256 },
          }),
        }));
    return fx.links.heads.map((item) => ({
      object_key: item.objectKey,
      revision: item.revision,
      version_revision: item.versionRevision,
    }));
  };
  return { ...fx, calls, sql: { unsafe } };
}

void test('read-only consistent transaction reads bounded pages and strictly parses wire links', async () => {
  const fx = databaseFixture(201);
  const result = await readBackupStorageLinks(fx.sql);
  assert.deepEqual(result, fx.links);
  assert.equal(
    fx.calls.filter((query) => query.includes('LIMIT 100 OFFSET')).length,
    3,
  );
  assert.equal(
    verifyBackupStorageLinks(result, fx.storage).matchedObjects,
    201,
  );
});

void test('unsafe transactions, count overflow, malformed wire and provider errors are rejected safely', async () => {
  for (const mode of ['write', 'isolation', 'count', 'wire', 'throw']) {
    const fx = databaseFixture();
    const sql = {
      unsafe: async (query: string, parameters?: number[]) => {
        if (mode === 'throw')
          throw new Error('postgresql://private-user:private-password@example');
        const rows = await fx.sql.unsafe(query, parameters);
        if (query.includes('current_setting') && mode === 'write')
          return [{ read_only: 'off', isolation: 'repeatable read' }];
        if (query.includes('current_setting') && mode === 'isolation')
          return [{ read_only: 'on', isolation: 'read committed' }];
        if (query.includes('count(*)') && mode === 'count')
          return [{ versions: '10001', heads: '1' }];
        if (query.includes('LIMIT 100 OFFSET') && mode === 'wire')
          return [{ ...rows[0], wire: '{private-invalid-json' }];
        return rows;
      },
    };
    await assert.rejects(readBackupStorageLinks(sql), (caught: Error) => {
      assert.equal(caught.message, error.message);
      assert.ok(!caught.stack?.includes('private-'));
      assert.equal(caught.cause, undefined);
      return true;
    });
  }
});
