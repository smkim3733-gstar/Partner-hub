import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPortalCaseCsv, portalCaseCsvFileName, type PortalCaseCsvRow } from '../lib/portal-case-csv';

const row: PortalCaseCsvRow = {
  id: 'case-2026-00000001',
  company: '세림테크',
  service: '정책자금, 기업인증',
  assignee: '박지현',
  partnerType: '교육생',
  stage: '상담진행',
  nextAction: '대표 상담 "확정"',
  updatedAt: '2026. 9. 3.',
  consultationCount: 2,
  idleDays: 0,
  urgent: false,
  discontinued: false,
};

void test('case CSV is UTF-8 Excel compatible and quotes every field', () => {
  const csv = buildPortalCaseCsv([row]);
  assert.ok(csv.startsWith('\uFEFF"신청번호","기업명"'));
  assert.match(csv, /"정책자금, 기업인증"/u);
  assert.match(csv, /"대표 상담 ""확정"""/u);
  assert.ok(csv.endsWith('\r\n'));
});

void test('case CSV neutralizes spreadsheet formulas, including whitespace-prefixed input', () => {
  const csv = buildPortalCaseCsv([{ ...row, company: '=HYPERLINK("https://example.test")', nextAction: '  -1+2' }]);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.test""\)"/u);
  assert.match(csv, /"'  -1\+2"/u);
});

void test('case CSV emits only caller-provided rows in their filtered order', () => {
  const second = { ...row, id: 'case-2026-00000002', company: '한빛솔루션' };
  const csv = buildPortalCaseCsv([second]);
  assert.doesNotMatch(csv, /case-2026-00000001/u);
  assert.ok(csv.indexOf(second.id) < csv.indexOf(second.company));
});

void test('case CSV filename uses the Korean calendar date', () => {
  assert.equal(
    portalCaseCsvFileName(new Date('2026-09-03T15:30:00.000Z')),
    'partner-hub-cases-2026-09-04.csv',
  );
});
