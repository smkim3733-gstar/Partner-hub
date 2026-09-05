import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { FlowError } from '../lib/consulting-flow';
import { describeUpload } from '../lib/consulting-flow-http';
import {
  flowUploadAccept,
  flowUploadExtensions,
  flowUploadMaxMegabytes,
  flowUploadPurpose,
  isStoredFlowFilePurpose,
  MAX_FLOW_UPLOAD_BYTES,
  storedFlowFileMaxBytes,
} from '../lib/consulting-flow-upload-policy';
import { MAX_AI_SOURCE_BYTES } from '../lib/intake-source-policy';
import { MAX_TRANSCRIPT_FILE_BYTES } from '../lib/transcript-policy';

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
  assert.equal(flowUploadMaxMegabytes({ type: 'save_source' }), 8);
  assert.equal(
    flowUploadMaxMegabytes({ type: 'save_recording' }, 'document'),
    5,
  );
  assert.equal(flowUploadMaxMegabytes({ type: 'save_recording' }, 'audio'), 25);
  assert.equal(flowUploadMaxMegabytes({ type: 'save_report', stage: 2 }), 25);
  assert.equal(
    storedFlowFileMaxBytes('source_archived', 'source.pdf'),
    MAX_AI_SOURCE_BYTES,
  );
  assert.equal(
    storedFlowFileMaxBytes('recording', 'recording.docx'),
    MAX_TRANSCRIPT_FILE_BYTES,
  );
  assert.equal(
    storedFlowFileMaxBytes('recording', 'recording.wav'),
    MAX_FLOW_UPLOAD_BYTES,
  );
  assert.equal(storedFlowFileMaxBytes('unknown', 'file.pdf'), undefined);
  assert.equal(isStoredFlowFilePurpose('signed_contract'), true);
  assert.equal(isStoredFlowFilePurpose('unknown'), false);
});

void test('server rejects files hidden by stage and AI-source controls', () => {
  const now = '2026-09-04T00:00:00.000Z';
  assert.throws(
    () =>
      describeUpload(
        new File([], 'empty.pdf'),
        { type: 'save_report', stage: 2, fileConsent: true },
        now,
      ),
    /비어/,
  );
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
        new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'ai-source.pdf'),
        { type: 'save_source', fileConsent: true },
        now,
      ),
    /8MB/,
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
  assert.match(workflow, /accept=\{flowUploadAccept\(command\)\}/);
  assert.match(transcript, /accept=\{flowUploadAccept\(/);
  assert.match(workflow, /await flowCommandRetryKey\(command, file, audio\)/);
  assert.doesNotMatch(workflow, /(?:file|audio)\.lastModified/);
  assert.doesNotMatch(workflow, /accept="\.[a-z]+(?:,\.[a-z]+)+"/);
  assert.doesNotMatch(transcript, /accept="\.[a-z]+(?:,\.[a-z]+)+"/);
});

void test('flow route checks purpose and size before reading file content', async () => {
  const route = await readFile(
    join(process.cwd(), 'app/api/consulting-flow/[caseId]/route.ts'),
    'utf8',
  );
  const sizePolicy = route.indexOf('const describedUpload = input.file');
  const contentRead = route.indexOf(
    'const contentProblem = await uploadFileContentProblem(file)',
  );
  assert.ok(sizePolicy > 0);
  assert.ok(contentRead > sizePolicy);
});
