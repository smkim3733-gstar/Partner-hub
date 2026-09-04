import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { FlowError } from '../lib/consulting-flow';
import { describeUpload } from '../lib/consulting-flow-http';
import {
  flowUploadAccept,
  flowUploadExtensions,
  flowUploadPurpose,
} from '../lib/consulting-flow-upload-policy';

void test('consulting flow upload policy owns purpose and command-specific formats', () => {
  assert.equal(flowUploadPurpose({ type: 'save_source' }), 'source');
  assert.equal(flowUploadPurpose({ type: 'unknown' }), undefined);
  assert.equal(
    flowUploadAccept({ type: 'save_report', stage: 3 }),
    '.pptx,.pdf',
  );
  assert.equal(
    flowUploadAccept({ type: 'save_report', stage: 1 }),
    '.pdf,.docx,.txt,.md',
  );
  assert.equal(
    flowUploadAccept({ type: 'save_source' }),
    '.pdf,.jpg,.jpeg,.png,.txt',
  );
  assert.equal(
    flowUploadAccept({ type: 'save_recording' }, 'document'),
    '.docx,.txt',
  );
  assert.equal(
    flowUploadAccept({ type: 'save_recording' }, 'audio'),
    '.mp3,.m4a,.wav',
  );
  assert.equal(
    flowUploadExtensions({ type: 'record_contract' }, 'audio'),
    undefined,
  );
});

void test('server rejects files hidden by stage and AI-source controls', () => {
  const now = '2026-09-04T00:00:00.000Z';
  assert.throws(
    () =>
      describeUpload(
        new File(['docx'], 'presentation.docx'),
        { type: 'save_report', stage: 3, fileConsent: true },
        now,
      ),
    FlowError,
  );
  assert.throws(
    () =>
      describeUpload(
        new File(['pptx'], 'draft.pptx'),
        { type: 'save_report', stage: 2, fileConsent: true },
        now,
      ),
    FlowError,
  );
  assert.throws(
    () =>
      describeUpload(
        new File(['docx'], 'ai-source.docx'),
        { type: 'save_source', fileConsent: true },
        now,
      ),
    FlowError,
  );
});

void test('consulting upload inputs use shared policy instead of literal lists', async () => {
  const workflow = await readFile(
    join(process.cwd(), 'components/consulting-workflow.tsx'),
    'utf8',
  );
  const transcript = await readFile(
    join(process.cwd(), 'components/consultation-transcript-form.tsx'),
    'utf8',
  );
  assert.match(workflow, /accept=\{flowUploadAccept\(/);
  assert.match(transcript, /accept=\{flowUploadAccept\(/);
  assert.doesNotMatch(workflow, /accept="\.[a-z]+(?:,\.[a-z]+)+"/);
  assert.doesNotMatch(transcript, /accept="\.[a-z]+(?:,\.[a-z]+)+"/);
});
