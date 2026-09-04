import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { attachmentContentDisposition } from '../lib/content-disposition';

void test('download filename uses RFC 5987 UTF-8 encoding', () => {
  assert.equal(
    attachmentContentDisposition('기업 분석 보고서.pdf'),
    "attachment; filename*=UTF-8''%EA%B8%B0%EC%97%85%20%EB%B6%84%EC%84%9D%20%EB%B3%B4%EA%B3%A0%EC%84%9C.pdf",
  );
});

void test('download filename neutralizes header and path control characters', () => {
  const header = attachmentContentDisposition(
    "../경로\\파일\r\nX-Test: injected'a(1)!.pdf",
  );
  assert.equal(
    header,
    "attachment; filename*=UTF-8''.._%EA%B2%BD%EB%A1%9C_%ED%8C%8C%EC%9D%BC__X-Test%3A%20injected%27a%281%29%21.pdf",
  );
  assert.ok(!header.includes('\r'));
  assert.ok(!header.includes('\n'));
});

void test('download filename repairs invalid Unicode and empty names', () => {
  assert.equal(
    attachmentContentDisposition('\ud800.pdf'),
    "attachment; filename*=UTF-8''_.pdf",
  );
  assert.equal(
    attachmentContentDisposition(' \r\n/\\ '),
    "attachment; filename*=UTF-8''____",
  );
  assert.equal(
    attachmentContentDisposition('   '),
    "attachment; filename*=UTF-8''download",
  );
});

void test('all download routes use shared content disposition boundary', async () => {
  const apiRoot = join(process.cwd(), 'app/api');
  const routes = (await readdir(apiRoot, { recursive: true })).filter((path) =>
    path.endsWith('route.ts'),
  );
  let downloadRouteCount = 0;
  for (const route of routes) {
    const source = await readFile(join(apiRoot, route), 'utf8');
    if (!/content-disposition/i.test(source)) continue;
    downloadRouteCount++;
    assert.match(source, /attachmentContentDisposition/);
    assert.doesNotMatch(
      source,
      /['"]content-disposition['"]\s*:\s*`/,
      `${route} must not interpolate a download filename directly`,
    );
  }
  assert.equal(downloadRouteCount, 3);
});
