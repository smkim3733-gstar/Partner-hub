import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { FlowError } from '../lib/consulting-flow';
import { assertSameOrigin } from '../lib/consulting-flow-store';
import { PasswordError, assertPasswordOrigin } from '../lib/password-store';
import { isCrossSiteRequest } from '../lib/request-origin';

function request(headers: Record<string, string> = {}) {
  return new Request('https://partner.example/api/change', {
    method: 'POST',
    headers,
  });
}

void test('mutation detection requires an exact Origin and rejects cross-site fetch metadata independently', () => {
  assert.equal(isCrossSiteRequest(request()), true);
  assert.equal(
    isCrossSiteRequest(request({ 'sec-fetch-site': 'same-origin' })),
    true,
  );
  assert.equal(
    isCrossSiteRequest(request({ origin: 'https://partner.example' })),
    false,
  );
  assert.equal(
    isCrossSiteRequest(request({ origin: 'https://untrusted.example' })),
    true,
  );
  assert.equal(
    isCrossSiteRequest(request({ 'sec-fetch-site': 'Cross-Site' })),
    true,
  );
  assert.equal(
    isCrossSiteRequest(
      request({
        origin: 'https://partner.example',
        'sec-fetch-site': 'cross-site',
      }),
    ),
    true,
  );
});

void test('shared and password mutation guards reject cross-site browser requests', () => {
  assert.throws(
    () => assertSameOrigin(request()),
    (error) => error instanceof FlowError && error.status === 403,
  );
  assert.throws(
    () => assertSameOrigin(request({ 'sec-fetch-site': 'cross-site' })),
    (error) => error instanceof FlowError && error.status === 403,
  );
  assert.doesNotThrow(() =>
    assertPasswordOrigin(request({ origin: 'https://partner.example' })),
  );
  assert.throws(
    () =>
      assertPasswordOrigin(
        request({
          origin: 'https://partner.example',
          'sec-fetch-site': 'CROSS-SITE',
        }),
      ),
    (error) => error instanceof PasswordError && error.status === 403,
  );
});

const guardedRoutes = [
  {
    file: 'app/api/admin/partners/route.ts',
    handler: 'export async function POST',
    guard: 'assertSameOrigin(request);',
    sensitive: 'const actor = await requirePortalUser',
  },
  {
    file: 'app/api/register/route.ts',
    handler: 'export async function POST',
    guard: 'assertSameOrigin(request);',
    sensitive: 'const identity = chatGPTIdentityFromRequest(request);',
  },
  {
    file: 'app/api/state/route.ts',
    handler: 'export async function PUT',
    guard: 'assertSameOrigin(request);',
    sensitive: 'const currentUser = await requirePortalUser',
  },
  {
    file: 'app/api/application-draft/route.ts',
    handler: 'async function handle',
    guard: "if (request.method !== 'GET') assertSameOrigin(request);",
    sensitive: 'const state = await readPortalState();',
  },
  {
    file: 'app/api/admin/file-inventory/[id]/recovery/route.ts',
    handler: 'export async function POST',
    guard: 'assertSameOrigin(request);',
    sensitive: 'return json(await recoverFile',
  },
  {
    file: 'app/api/files/route.ts',
    handler: 'export async function POST',
    guard: 'checkSameOrigin(request);',
    sensitive: 'const state = await readPortalState();',
  },
  {
    file: 'app/api/files/[id]/route.ts',
    handler: 'export async function DELETE',
    guard: 'if (isCrossSiteRequest(request))',
    sensitive: 'const state = await readPortalState();',
  },
  {
    file: 'app/api/ai-diagnosis/step-zero/route.ts',
    handler: 'export async function POST',
    guard: 'if (isCrossSiteRequest(request))',
    sensitive: 'const state = await readPortalState();',
  },
  {
    file: 'app/api/consulting-flow/[caseId]/route.ts',
    handler: 'export async function POST',
    guard: 'assertSameOrigin(request);',
    sensitive: 'const initial = await loadFlowAccess',
  },
  {
    file: 'app/api/consulting-flow/[caseId]/run/route.ts',
    handler: 'export async function POST',
    guard: 'assertSameOrigin(request);',
    sensitive: 'const { flow, user, state } = await loadFlowAccess',
  },
] as const;

void test('direct mutation routes check origin before identity, storage, or external work', async () => {
  for (const entry of guardedRoutes) {
    const source = await readFile(
      path.resolve(process.cwd(), entry.file),
      'utf8',
    );
    const handlerStart = source.indexOf(entry.handler);
    assert.ok(handlerStart >= 0, `${entry.file}: missing mutation handler`);
    const handler = source.slice(handlerStart);
    const guard = handler.indexOf(entry.guard);
    const sensitive = handler.indexOf(entry.sensitive);
    assert.ok(guard >= 0, `${entry.file}: missing mutation origin guard`);
    assert.ok(
      sensitive >= 0,
      `${entry.file}: missing sensitive operation marker`,
    );
    assert.ok(
      guard < sensitive,
      `${entry.file}: mutation origin guard must run first`,
    );
  }
});

void test('API routes do not implement ad hoc Origin or Sec-Fetch-Site parsing', async () => {
  for (const entry of guardedRoutes) {
    const source = await readFile(
      path.resolve(process.cwd(), entry.file),
      'utf8',
    );
    assert.doesNotMatch(
      source,
      /headers\.get\(['"](?:origin|sec-fetch-site)['"]\)/,
      `${entry.file}: use the shared mutation origin boundary`,
    );
  }
});
