import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nextLocalStorageEnabled,
  nextLocalStorageName,
} from '../lib/next-local-storage-policy.mjs';

void test('local Next storage needs explicit development opt-in and refuses Vercel', () => {
  const enabled = { NODE_ENV: 'development', PARTNER_HUB_LOCAL_STORAGE: '1' };
  assert.equal(nextLocalStorageEnabled(enabled), true);
  for (const NODE_ENV of [undefined, '', 'production', 'test'])
    assert.equal(nextLocalStorageEnabled({ ...enabled, NODE_ENV }), false);
  for (const PARTNER_HUB_LOCAL_STORAGE of [undefined, '', '0', 'true'])
    assert.equal(
      nextLocalStorageEnabled({ ...enabled, PARTNER_HUB_LOCAL_STORAGE }),
      false,
    );
  for (const key of ['VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_PROJECT_ID'])
    for (const value of ['', '0', '1', 'preview', 'production'])
      assert.equal(
        nextLocalStorageEnabled({ ...enabled, [key]: value }),
        false,
      );
});

void test('local data remains in a dedicated named directory without path traversal', () => {
  assert.equal(nextLocalStorageName(undefined), 'development');
  assert.equal(nextLocalStorageName('test-20260908'), 'test-20260908');
  for (const name of [
    '',
    '.',
    '..',
    '../data',
    'C:\\data',
    '/tmp',
    'A',
    'a'.repeat(81),
  ])
    assert.throws(() => nextLocalStorageName(name));
});
