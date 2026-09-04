import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  applyBrowserSecurityHeaders,
  browserSecurityHeaders,
} from '../lib/browser-security-headers';

void test('all browser pages receive the security boundary from proxy', async () => {
  const responseHeaders = new Headers();
  applyBrowserSecurityHeaders(responseHeaders);

  const headers = new Map(
    browserSecurityHeaders.map(({ key, value }) => [key.toLowerCase(), value]),
  );
  for (const [key, value] of headers)
    assert.equal(responseHeaders.get(key), value);
  assert.match(
    headers.get('content-security-policy') ?? '',
    /frame-ancestors 'none'/,
  );
  assert.match(headers.get('content-security-policy') ?? '', /base-uri 'none'/);
  assert.match(
    headers.get('content-security-policy') ?? '',
    /object-src 'none'/,
  );
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.equal(
    headers.get('permissions-policy'),
    'camera=(), microphone=(), geolocation=(), payment=()',
  );
  assert.equal(headers.get('x-permitted-cross-domain-policies'), 'none');

  const proxySource = await readFile(join(process.cwd(), 'proxy.ts'), 'utf8');
  assert.match(proxySource, /applyBrowserSecurityHeaders\(response\.headers\)/);
  assert.match(proxySource, /matcher:\s*\['\/', '\/account\/:path\*'\]/);
});
