import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { GET as intake } from '../app/api/consulting-flow/[caseId]/intake-files/route';
import {
  GET as flowGet,
  POST as flowPost,
} from '../app/api/consulting-flow/[caseId]/route';
import { POST as run } from '../app/api/consulting-flow/[caseId]/run/route';
import { GET as download } from '../app/api/consulting-flow/[caseId]/files/[fileId]/route';
import { POST as upload } from '../app/api/files/route';
import {
  companyFileBucket,
  companyFileDatabase,
  findCompanyFile,
} from '../lib/company-files';
import { flowEnvironment, readFlow } from '../lib/consulting-flow-store';
import { writePortalState } from '../lib/portal-state';
import type { ConsultingFlow, FlowCommand } from '../lib/consulting-flow';
import type { IntakeSourcePreview } from '../lib/intake-source-policy';
import {
  readIntakeSourceListResponse,
  readIntakeSourcePreviewResponse,
} from '../lib/intake-source-response';
import { mutateCompanyFileObjectFixture } from './company-file-object-fixture';

const owner = 'seedy@sites.test';
const partner = 'review-partner@example.invalid';
const caseId = 'intake-review-case';
const endpoint = `/api/consulting-flow/${caseId}`;
const context = { params: Promise.resolve({ caseId }) };
const permissions = {
  ownCases: true,
  fileUpload: true,
  collaborationApply: true,
  sharedSchedule: true,
  quoteContract: true,
};
let sequence = 0;
function request(
  path: string,
  body?: unknown,
  email = owner,
  origin = 'http://localhost',
) {
  return new Request(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      origin,
      'oai-authenticated-user-id': email,
      'oai-authenticated-user-email': email,
      ...(body instanceof FormData
        ? {}
        : { 'content-type': 'application/json' }),
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
}
async function add(
  file: File,
  category = '상담녹취',
  company = '가상 신청기업',
  assignee = '가상 담당자',
) {
  const form = new FormData();
  form.set('company', company);
  form.set('title', file.name);
  form.set('category', category);
  form.set('assignedTrainee', assignee);
  form.set('consent', 'confirmed');
  form.set('recordingConsent', 'confirmed');
  form.set('file', file);
  const response = await upload(request('/api/files', form));
  assert.equal(response.status, 201, await response.clone().text());
  return ((await response.json()) as { file: { id: string } }).file.id;
}
async function preview(id: string) {
  const listResponse = await intake(
    request(`${endpoint}/intake-files`),
    context,
  );
  assert.equal(listResponse.status, 200, await listResponse.clone().text());
  const expected = (
    await readIntakeSourceListResponse(listResponse)
  ).files.find((file) => file.id === id);
  assert.ok(expected);
  const response = await intake(
    request(`${endpoint}/intake-files?fileId=${id}`),
    context,
  );
  assert.equal(response.status, 200, await response.clone().text());
  return readIntakeSourcePreviewResponse(response, expected);
}
function importCommand(p: IntakeSourcePreview, text: string): FlowCommand {
  return {
    type: 'import_intake_source',
    intakeFileId: p.file.id,
    sourceHash: p.sourceHash,
    reviewedText: text,
    contentReviewed: true,
    fileConsent: true,
    privacyMasked: true,
    recordingConsent: true,
  };
}

void test('intake files -> reviewed private copies -> only explicitly approved mocked first report, original preserved', async () => {
  await writePortalState({
    version: 1,
    consultationNumber: 0,
    timeline: [],
    tasks: [],
    schedule: [],
    companyDocuments: [],
    members: [
      {
        id: 'review-partner',
        name: '가상 담당자',
        email: partner,
        status: '활성',
        permissions,
      },
      {
        id: 'review-other',
        name: '다른 담당자',
        email: 'other@example.invalid',
        status: '활성',
        permissions,
      },
      {
        id: 'review-inactive',
        name: '정지 담당자',
        email: 'inactive@example.invalid',
        status: '정지',
        permissions,
      },
    ],
    cases: [
      {
        id: caseId,
        company: '가상 신청기업',
        trainee: '가상 담당자',
        partnerMemberId: 'review-partner',
        stage: '접수',
        consultationCount: 0,
      },
    ],
  });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let transmitted = '';
  let permitFakeAI = false;
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.ok(
      permitFakeAI,
      'No external AI calls allowed while reviewing/importing',
    );
    assert.equal(typeof options?.body, 'string');
    transmitted = options?.body as string;
    return Response.json(
      {
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text:
              '가상 기업의 자료를 검토한 내부 초안이며 실제 고객 판단이나 정책자금 승인을 의미하지 않습니다. '.repeat(
                8,
              ) + '[분석 끝]',
          },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
      },
      { headers: { 'request-id': 'req_intake_source' } },
    );
  };
  const environment = flowEnvironment();
  const previousKey = environment.ANTHROPIC_API_KEY;
  try {
    const originalText =
      '가상 대표의 초기 전화상담입니다. 연락처 010-1234-5678이며 현재자본금과 증자 목표는 증빙을 확인해야 합니다.';
    const reviewedText =
      '가상 대표의 초기 전화상담입니다. 연락처 [마스킹]이며 현재자본금과 증자 목표는 증빙을 확인해야 합니다.';
    const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${originalText}</w:t></w:r></w:p></w:body></w:document>`;
    const docId = await add(
      new File(
        [
          zipSync({
            '[Content_Types].xml': strToU8('<Types/>'),
            'word/document.xml': strToU8(xml),
          }),
        ],
        'notes.docx',
      ),
    );
    const txtId = await add(
      new File(
        [
          '전화상담 보완 내용입니다. 목표금액은 미확정이므로 서류와 대표 확인이 필요합니다.',
        ],
        'notes.txt',
      ),
    );
    const pdfId = await add(
      new File(['%PDF-1.7\nSYNTHETIC_CERTIFICATE_ONLY'], '사업자등록증.pdf'),
      '사업자등록증',
    );
    const audioId = await add(
      new File(
        [
          new Uint8Array([
            0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0,
            0, 0, 0x4d, 0x34, 0x41, 0x20,
          ]),
        ],
        'phone.m4a',
      ),
    );
    const otherCompany = await add(
      new File(['%PDF-1.7\nOTHER_COMPANY'], 'other.pdf'),
      '크레탑',
      '다른 기업',
    );
    const otherOwner = await add(
      new File(['%PDF-1.7\nOTHER_PARTNER'], 'other-owner.pdf'),
      '크레탑',
      '가상 신청기업',
      '다른 담당자',
    );
    const corrupt = await add(
      new File(
        [
          zipSync({
            '[Content_Types].xml': strToU8('<Types/>'),
            'word/document.xml': strToU8('<document/>'),
          }),
        ],
        'corrupt.docx',
      ),
    );
    const corruptRow = await findCompanyFile(corrupt);
    assert.ok(corruptRow);
    const corruptBytes = new TextEncoder().encode('not a zip archive');
    await companyFileBucket().put(corruptRow.storage_key, corruptBytes, {
      httpMetadata: { contentType: corruptRow.content_type },
    });
    await mutateCompanyFileObjectFixture(
      companyFileDatabase(),
      'UPDATE company_file_objects SET size_bytes = ?1 WHERE id = ?2',
      [corruptBytes.byteLength, corrupt],
    );
    const badPdf = await add(
      new File(['%PDF-1.7\nVALID_AT_UPLOAD'], 'wrong.pdf'),
      '크레탑',
    );
    const badPdfRow = await findCompanyFile(badPdf);
    assert.ok(badPdfRow);
    const badPdfBytes = new TextEncoder().encode('not a pdf');
    await companyFileBucket().put(badPdfRow.storage_key, badPdfBytes, {
      httpMetadata: { contentType: badPdfRow.content_type },
    });
    await mutateCompanyFileObjectFixture(
      companyFileDatabase(),
      'UPDATE company_file_objects SET size_bytes = ?1 WHERE id = ?2',
      [badPdfBytes.byteLength, badPdf],
    );
    const oversized = await add(
      new File(
        [
          zipSync(
            {
              '[Content_Types].xml': strToU8('<Types/>'),
              'word/document.xml': new Uint8Array(5 * 1024 * 1024 + 1),
            },
            { level: 0 },
          ),
        ],
        'large.docx',
      ),
    );
    const listResponse = await intake(
      request(`${endpoint}/intake-files`),
      context,
    );
    assert.equal(listResponse.status, 200);
    assert.match(
      listResponse.headers.get('cache-control') || '',
      /private, no-store/,
    );
    const listed = JSON.stringify(
      await readIntakeSourceListResponse(listResponse),
    );
    assert.ok(listed.includes(docId) && listed.includes(audioId));
    assert.ok(!listed.includes(otherCompany) && !listed.includes(otherOwner));
    assert.ok(
      !listed.includes('storage_key') &&
        !listed.includes('company-source/') &&
        !listed.includes(originalText),
    );
    for (const user of [
      partner,
      'other@example.invalid',
      'inactive@example.invalid',
    ]) {
      assert.equal(
        (
          await intake(
            request(`${endpoint}/intake-files`, undefined, user),
            context,
          )
        ).status,
        403,
      );
    }
    assert.equal(
      (
        await intake(
          new Request(`http://localhost${endpoint}/intake-files`),
          context,
        )
      ).status,
      401,
    );
    for (const query of [
      '?fileId=first&fileId=second',
      `?fileId=${'x'.repeat(121)}`,
    ])
      assert.equal(
        (await intake(request(`${endpoint}/intake-files${query}`), context))
          .status,
        400,
      );
    for (const id of [otherCompany, otherOwner, 'not-found'])
      assert.equal(
        (
          await intake(
            request(`${endpoint}/intake-files?fileId=${id}`),
            context,
          )
        ).status,
        404,
      );
    for (const [label, id, status] of [
      ['audioId', audioId, 400],
      ['corrupt', corrupt, 503],
      ['badPdf', badPdf, 503],
      ['oversized', oversized, 400],
    ] as const)
      assert.equal(
        (
          await intake(
            request(`${endpoint}/intake-files?fileId=${id}`),
            context,
          )
        ).status,
        status,
        `${label}:${id}`,
      );
    const docPreview = await preview(docId);
    assert.equal(docPreview.text, originalText);
    assert.equal(docPreview.file.kind, 'text');
    assert.match(docPreview.sourceHash, /^[a-f0-9]{64}$/);
    assert.equal(
      await readFlow(caseId),
      null,
      'Reading must not create a workflow record',
    );
    let flow = (
      (await (await flowGet(request(endpoint), context)).json()) as {
        flow: ConsultingFlow;
      }
    ).flow;
    const initial = structuredClone(flow);
    async function post(
      cmd: FlowCommand,
      id = `intake-review-${++sequence}`,
      email = owner,
      revision = flow.revision,
      origin = 'http://localhost',
    ) {
      return flowPost(
        request(
          endpoint,
          { command: cmd, commandId: id, revision },
          email,
          origin,
        ),
        context,
      );
    }
    async function ok(cmd: FlowCommand, id?: string) {
      const response = await post(cmd, id);
      assert.equal(response.status, 200, await response.clone().text());
      flow = ((await response.json()) as { flow: ConsultingFlow }).flow;
    }
    const cmd = importCommand(docPreview, reviewedText);
    for (const key of [
      'contentReviewed',
      'fileConsent',
      'privacyMasked',
      'recordingConsent',
    ])
      assert.equal((await post({ ...cmd, [key]: false })).status, 400);
    assert.equal(
      (await post({ ...cmd, reviewedText: originalText })).status,
      400,
    );
    assert.equal((await post({ ...cmd, reviewedText: '짧음' })).status, 400);
    assert.equal(
      (await post({ ...cmd, reviewedText: '가'.repeat(60001) })).status,
      400,
    );
    assert.equal((await post({ ...cmd, sourceHash: 'stale' })).status, 409);
    assert.equal((await post(cmd, undefined, partner)).status, 403);
    assert.equal(
      (await post(cmd, undefined, owner, 0, 'https://wrong.invalid')).status,
      403,
    );
    assert.equal(
      (await post({ ...cmd, intakeFileId: otherCompany })).status,
      404,
    );
    assert.equal(
      (await post({ ...cmd, intakeFileId: audioId })).status,
      400,
      'audio import',
    );
    assert.equal(await readFlow(caseId), null);
    await ok(cmd, 'intake-fixed-command');
    assert.equal(flow.files.length, 1);
    assert.equal(flow.files[0].intakeFileId, docId);
    assert.equal(flow.files[0].sourceReviewedBy, owner);
    assert.ok(flow.files[0].sourceReviewedAt);
    assert.equal(flow.files[0].key, '', 'Public flow must hide storage keys');
    assert.equal(flow.ai.enabled, false);
    assert.equal(flow.ai.sourceText, initial.ai.sourceText);
    assert.equal(
      flow.jobs.length +
        flow.reports.length +
        flow.meetings.length +
        flow.recordings.length,
      0,
    );
    const copyId = flow.files[0].id;
    const downloaded = await download(
      request(`${endpoint}/files/${copyId}`, undefined, partner),
      { params: Promise.resolve({ caseId, fileId: copyId }) },
    );
    assert.equal(downloaded.status, 200);
    assert.equal(await downloaded.text(), reviewedText);
    assert.equal(
      (
        await download(
          request(
            `${endpoint}/files/${copyId}`,
            undefined,
            'other@example.invalid',
          ),
          { params: Promise.resolve({ caseId, fileId: copyId }) },
        )
      ).status,
      403,
    );
    const replay = await post(cmd, 'intake-fixed-command', owner, 0);
    assert.equal(replay.status, 200);
    assert.equal(
      ((await replay.json()) as { duplicate: boolean }).duplicate,
      true,
    );
    assert.equal((await post(cmd)).status, 409);
    assert.equal(
      (
        await post(
          { ...cmd, type: 'import_intake_source' },
          undefined,
          owner,
          0,
        )
      ).status,
      409,
    );
    assert.equal(
      (await preview(docId)).text,
      originalText,
      'Unredacted original remains private and unchanged',
    );
    await ok({ type: 'exclude_source', fileId: copyId });
    await ok(cmd);
    assert.equal(flow.files[0].purpose, 'source_archived');
    assert.equal(flow.files.filter((f) => f.purpose === 'source').length, 1);
    const txtPreview = await preview(txtId);
    const row = await findCompanyFile(txtId);
    assert.ok(row);
    const bucket = companyFileBucket();
    const originalBytes = await (await bucket.get(
      row.storage_key,
    ))!.arrayBuffer();
    const changed = new Uint8Array(originalBytes.slice(0));
    changed[0] ^= 1;
    await bucket.put(row.storage_key, changed, {
      httpMetadata: { contentType: row.content_type },
    });
    assert.equal(
      (await post(importCommand(txtPreview, reviewedText))).status,
      409,
      'Changing bytes after review invalidates the review hash',
    );
    await bucket.put(row.storage_key, originalBytes, {
      httpMetadata: { contentType: row.content_type },
    });
    await ok(importCommand(txtPreview, txtPreview.text!));
    const pdfPreview = await preview(pdfId);
    assert.equal(pdfPreview.text, undefined);
    await ok(importCommand(pdfPreview, 'ignored-for-binary'));
    assert.equal(flow.files.at(-1)?.contentType, 'application/pdf');
    assert.equal(calls, 0, 'Review/import does not call the model');
    await ok({ type: 'queue_report1' });
    assert.equal(
      flow.jobs.at(-1)?.status,
      'blocked',
      'AI consent is still required',
    );
    await ok({
      type: 'set_ai_policy',
      enabled: true,
      thirdPartyConsent: true,
      privacyMasked: true,
      costConsent: true,
    });
    await ok({ type: 'queue_report1' });
    assert.equal(
      (await post(importCommand(txtPreview, txtPreview.text!))).status,
      409,
      'Sources cannot change while first report is queued',
    );
    permitFakeAI = true;
    environment.ANTHROPIC_API_KEY = 'synthetic-test-only';
    const generated = await run(request(`${endpoint}/run`, {}), context);
    assert.equal(generated.status, 200, await generated.clone().text());
    flow = ((await generated.json()) as { flow: ConsultingFlow }).flow;
    assert.equal(calls, 1);
    assert.ok(transmitted.includes(reviewedText));
    assert.ok(!transmitted.includes('010-1234-5678'));
    assert.ok(
      !transmitted.includes('notes.docx') && !transmitted.includes('phone.m4a'),
    );
    assert.equal(flow.reports.length, 1);
    assert.equal(flow.reports[0].stage, 1);
    assert.equal(flow.meetings.length + flow.recordings.length, 0);
    const partnerView = await flowGet(
      request(endpoint, undefined, partner),
      context,
    );
    assert.equal(
      ((await partnerView.json()) as { flow: ConsultingFlow }).flow.reports[0]
        .id,
      flow.reports[0].id,
    );
  } finally {
    globalThis.fetch = originalFetch;
    environment.ANTHROPIC_API_KEY = previousKey;
  }
});
