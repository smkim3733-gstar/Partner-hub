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
import {
  flowBucket,
  flowDatabase,
  flowEnvironment,
  readFlow,
} from '../lib/consulting-flow-store';
import { readPortalState, writePortalState } from '../lib/portal-state';
import type { ConsultingFlow, FlowCommand } from '../lib/consulting-flow';
import type { IntakeSourcePreview } from '../lib/intake-source-policy';
import {
  readIntakeSourceListResponse,
  readIntakeSourcePreviewResponse,
} from '../lib/intake-source-response';
import { mutateCompanyFileObjectFixture } from './company-file-object-fixture';
import { objects } from './runtime-mock.mjs';

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

void test('intake files -> reviewed private copies -> R2 copy retry -> only explicitly approved mocked first report, original preserved', async () => {
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
        id: 'msg_intake_source',
        type: 'message',
        role: 'assistant',
        model: 'claude-synthetic-response-model',
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
    const reservationDeleteSourceId = await add(
      new File(
        [
          '예약 직전 원본 삭제 경쟁 검증용 신청자료입니다. 모든 내용은 가상 정보이며 추가 확인이 필요합니다.',
        ],
        'reservation-delete-source.txt',
      ),
    );
    const reservationDamageSourceId = await add(
      new File(
        [
          '예약 직전 원본 교체 경쟁 검증용 신청자료입니다. 모든 내용은 가상 정보이며 추가 확인이 필요합니다.',
        ],
        'reservation-damage-source.txt',
      ),
    );
    const postReservationDeleteSourceId = await add(
      new File(
        [
          '예약 완료 뒤 원본 삭제 경쟁 검증용 신청자료입니다. 모든 내용은 가상 정보이며 추가 확인이 필요합니다.',
        ],
        'post-reservation-delete-source.txt',
      ),
    );
    const postReservationDamageSourceId = await add(
      new File(
        [
          '예약 완료 뒤 원본 교체 경쟁 검증용 신청자료입니다. 모든 내용은 가상 정보이며 추가 확인이 필요합니다.',
        ],
        'post-reservation-damage-source.txt',
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
    const originalPortalState = (await readPortalState()) as {
      cases: Array<{
        id: string;
        trainee: string;
        partnerMemberId?: string;
      }>;
    };
    const deletedCaseState = structuredClone(originalPortalState);
    deletedCaseState.cases = deletedCaseState.cases.filter(
      ({ id }) => id !== caseId,
    );
    const reassignedCaseState = structuredClone(originalPortalState);
    const reassignedCase = reassignedCaseState.cases.find(
      ({ id }) => id === caseId,
    );
    assert.ok(reassignedCase);
    reassignedCase.trainee = '다른 담당자';
    reassignedCase.partnerMemberId = 'review-other';
    const sourceBucket = companyFileBucket();
    const sourceGet = sourceBucket.get.bind(sourceBucket);
    const docRow = await findCompanyFile(docId);
    assert.ok(docRow);

    sourceBucket.get = async (...args: Parameters<R2Bucket['get']>) => {
      const object = await sourceGet(...args);
      if (!object || args[0] !== docRow.storage_key) return object;
      const arrayBuffer = object.arrayBuffer.bind(object);
      object.arrayBuffer = async () => {
        const bytes = await arrayBuffer();
        await writePortalState(deletedCaseState);
        return bytes;
      };
      return object;
    };
    try {
      const revokedPreview = await intake(
        request(`${endpoint}/intake-files?fileId=${docId}`),
        context,
      );
      assert.equal(revokedPreview.status, 404);
      assert.deepEqual(await revokedPreview.json(), {
        error: '해당 컨설팅 진행을 찾을 수 없습니다.',
      });
    } finally {
      sourceBucket.get = sourceGet;
      await writePortalState(originalPortalState);
    }
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
      assert.equal(
        response.status,
        200,
        `${cmd.type}:${id ?? 'generated'}: ${await response.clone().text()}`,
      );
      flow = ((await response.json()) as { flow: ConsultingFlow }).flow;
    }
    const cmd = importCommand(docPreview, reviewedText);
    const flowDb = await flowDatabase();
    const previousFlowKeys = new Set(objects.keys());

    async function postAfterSourcePreparationMutation(
      source: IntakeSourcePreview,
      commandId: string,
      mutateSource: () => Promise<void>,
      expectedStatus: 404 | 409,
      expectedMessage: RegExp,
    ) {
      const prepare = flowDb.prepare.bind(flowDb);
      const batch = flowDb.batch.bind(flowDb);
      let portalStateReads = 0;
      let sourceMutations = 0;
      let reservationBatches = 0;
      const wrapPortalStateRead = (
        statement: D1PreparedStatement,
      ): D1PreparedStatement =>
        new Proxy(statement, {
          get(target, key) {
            if (key === 'bind')
              return (...values: unknown[]) =>
                wrapPortalStateRead(target.bind(...values));
            if (key === 'first')
              return async <T = Record<string, unknown>>() => {
                const result = await target.first<T>();
                portalStateReads++;
                if (portalStateReads === 5) {
                  sourceMutations++;
                  await mutateSource();
                }
                return result;
              };
            const value = Reflect.get(target, key);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      flowDb.prepare = (sql: string) =>
        sql === 'SELECT payload FROM portal_state WHERE id = ?1'
          ? wrapPortalStateRead(prepare(sql))
          : prepare(sql);
      flowDb.batch = async <T = unknown>(statements: D1PreparedStatement[]) => {
        if (
          statements.some((statement) =>
            (statement as unknown as { sql: string }).sql
              .trimStart()
              .startsWith('INSERT INTO consulting_flow_upload_requests'),
          )
        ) {
          reservationBatches++;
          throw new Error('synthetic reservation write must not begin');
        }
        return batch<T>(statements);
      };
      let response: Response;
      try {
        response = await post(importCommand(source, source.text!), commandId);
      } finally {
        flowDb.prepare = prepare;
        flowDb.batch = batch;
      }
      assert.equal(sourceMutations, 1);
      assert.ok(portalStateReads >= 5);
      assert.equal(
        response.status,
        expectedStatus,
        await response.clone().text(),
      );
      assert.match(
        ((await response.json()) as { error: string }).error,
        expectedMessage,
      );
      assert.equal(reservationBatches, 0);
      assert.equal(
        (
          await flowDb
            .prepare(
              `SELECT COUNT(*) AS count FROM consulting_flow_upload_requests
              WHERE case_id = ?1 AND command_id = ?2`,
            )
            .bind(caseId, commandId)
            .first<{ count: number }>()
        )?.count,
        0,
      );
      assert.deepEqual(
        [...objects.keys()].filter((key) => !previousFlowKeys.has(key)),
        [],
      );
      assert.equal(await readFlow(caseId), null);
    }

    const reservationDeletePreview = await preview(reservationDeleteSourceId);
    await postAfterSourcePreparationMutation(
      reservationDeletePreview,
      'intake-source-pre-reservation-delete-race',
      async () => {
        const existing = await flowDb
          .prepare(
            'SELECT file_id FROM company_file_upload_requests WHERE file_id = ?1',
          )
          .bind(reservationDeleteSourceId)
          .first();
        const result = existing
          ? await flowDb
              .prepare(
                "UPDATE company_file_upload_requests SET status = 'deleted' WHERE file_id = ?1",
              )
              .bind(reservationDeleteSourceId)
              .run()
          : await flowDb
              .prepare(`INSERT INTO company_file_upload_requests
                (owner_key, request_key, fingerprint, file_id, created_at, status)
                SELECT ?1, ?2, ?3, id, created_at, 'deleted'
                FROM company_file_objects WHERE id = ?4`)
              .bind(
                `race:${reservationDeleteSourceId}`,
                'pre-reservation-delete',
                'synthetic-pre-reservation-delete',
                reservationDeleteSourceId,
              )
              .run();
        assert.equal(result.meta.changes, 1);
      },
      404,
      /연결된 신청자료를 찾지 못했습니다/,
    );

    const reservationDamagePreview = await preview(reservationDamageSourceId);
    const reservationDamageRow = await findCompanyFile(
      reservationDamageSourceId,
    );
    assert.ok(reservationDamageRow);
    const reservationDamageObject = await sourceGet(
      reservationDamageRow.storage_key,
    );
    assert.ok(reservationDamageObject);
    const reservationDamageBytes = await reservationDamageObject.arrayBuffer();
    const reservationReplacement = new Uint8Array(
      reservationDamageBytes.slice(0),
    );
    reservationReplacement[reservationReplacement.byteLength - 1] ^= 1;
    try {
      await postAfterSourcePreparationMutation(
        reservationDamagePreview,
        'intake-source-pre-reservation-damage-race',
        async () => {
          await sourceBucket.put(
            reservationDamageRow.storage_key,
            reservationReplacement,
            {
              httpMetadata: {
                contentType: reservationDamageRow.content_type,
              },
            },
          );
        },
        409,
        /원본 보관 정보가 변경/,
      );
    } finally {
      await sourceBucket.put(
        reservationDamageRow.storage_key,
        reservationDamageBytes,
        {
          httpMetadata: { contentType: reservationDamageRow.content_type },
        },
      );
    }

    async function postAfterReservationMutation(
      source: IntakeSourcePreview,
      sourceStorageKey: string,
      commandId: string,
      mutateSource: () => Promise<void>,
      expectedStatus: 404 | 409,
      expectedMessage: RegExp,
    ) {
      const batch = flowDb.batch.bind(flowDb);
      const flowStorage = flowBucket();
      const put = flowStorage.put.bind(flowStorage);
      let sourceMutations = 0;
      let reservationBatches = 0;
      let destinationWrites = 0;
      flowDb.batch = async <T = unknown>(statements: D1PreparedStatement[]) => {
        const reservesUpload = statements.some((statement) =>
          (statement as unknown as { sql: string }).sql
            .trimStart()
            .startsWith('INSERT INTO consulting_flow_upload_requests'),
        );
        const result = await batch<T>(statements);
        if (reservesUpload) {
          reservationBatches++;
          sourceMutations++;
          await mutateSource();
        }
        return result;
      };
      flowStorage.put = async (...args: Parameters<R2Bucket['put']>) => {
        if (args[0] === sourceStorageKey) return put(...args);
        destinationWrites++;
        throw new Error('synthetic destination write must not begin');
      };
      let response: Response;
      try {
        response = await post(importCommand(source, source.text!), commandId);
      } finally {
        flowDb.batch = batch;
        flowStorage.put = put;
      }
      assert.equal(sourceMutations, 1);
      assert.equal(reservationBatches, 1);
      assert.equal(
        response.status,
        expectedStatus,
        await response.clone().text(),
      );
      assert.match(
        ((await response.json()) as { error: string }).error,
        expectedMessage,
      );
      assert.equal(destinationWrites, 0);
      const reservationRows = await flowDb
        .prepare(
          `SELECT status FROM consulting_flow_upload_requests
          WHERE case_id = ?1 AND command_id = ?2`,
        )
        .bind(caseId, commandId)
        .all<{ status: string }>();
      assert.deepEqual(
        reservationRows.results.map(({ status }) => status),
        ['pending'],
      );
      assert.deepEqual(
        [...objects.keys()].filter((key) => !previousFlowKeys.has(key)),
        [],
      );
      assert.equal(await readFlow(caseId), null);
    }

    const postReservationDeletePreview = await preview(
      postReservationDeleteSourceId,
    );
    const postReservationDeleteRow = await findCompanyFile(
      postReservationDeleteSourceId,
    );
    assert.ok(postReservationDeleteRow);
    await postAfterReservationMutation(
      postReservationDeletePreview,
      postReservationDeleteRow.storage_key,
      'intake-source-post-reservation-delete-race',
      async () => {
        const existing = await flowDb
          .prepare(
            'SELECT file_id FROM company_file_upload_requests WHERE file_id = ?1',
          )
          .bind(postReservationDeleteSourceId)
          .first();
        const result = existing
          ? await flowDb
              .prepare(
                "UPDATE company_file_upload_requests SET status = 'deleted' WHERE file_id = ?1",
              )
              .bind(postReservationDeleteSourceId)
              .run()
          : await flowDb
              .prepare(`INSERT INTO company_file_upload_requests
                (owner_key, request_key, fingerprint, file_id, created_at, status)
                SELECT ?1, ?2, ?3, id, created_at, 'deleted'
                FROM company_file_objects WHERE id = ?4`)
              .bind(
                `race:${postReservationDeleteSourceId}`,
                'post-reservation-delete',
                'synthetic-post-reservation-delete',
                postReservationDeleteSourceId,
              )
              .run();
        assert.equal(result.meta.changes, 1);
      },
      404,
      /연결된 신청자료를 찾지 못했습니다/,
    );

    const postReservationDamagePreview = await preview(
      postReservationDamageSourceId,
    );
    const postReservationDamageRow = await findCompanyFile(
      postReservationDamageSourceId,
    );
    assert.ok(postReservationDamageRow);
    const postReservationDamageObject = await sourceGet(
      postReservationDamageRow.storage_key,
    );
    assert.ok(postReservationDamageObject);
    const postReservationDamageBytes =
      await postReservationDamageObject.arrayBuffer();
    const postReservationReplacement = new Uint8Array(
      postReservationDamageBytes.slice(0),
    );
    postReservationReplacement[postReservationReplacement.byteLength - 1] ^= 1;
    try {
      await postAfterReservationMutation(
        postReservationDamagePreview,
        postReservationDamageRow.storage_key,
        'intake-source-post-reservation-damage-race',
        async () => {
          await sourceBucket.put(
            postReservationDamageRow.storage_key,
            postReservationReplacement,
            {
              httpMetadata: {
                contentType: postReservationDamageRow.content_type,
              },
            },
          );
        },
        409,
        /원본 보관 정보가 변경/,
      );
    } finally {
      await sourceBucket.put(
        postReservationDamageRow.storage_key,
        postReservationDamageBytes,
        {
          httpMetadata: { contentType: postReservationDamageRow.content_type },
        },
      );
    }

    sourceBucket.get = async (...args: Parameters<R2Bucket['get']>) => {
      const object = await sourceGet(...args);
      if (!object || args[0] !== docRow.storage_key) return object;
      const arrayBuffer = object.arrayBuffer.bind(object);
      object.arrayBuffer = async () => {
        const bytes = await arrayBuffer();
        await writePortalState(reassignedCaseState);
        return bytes;
      };
      return object;
    };
    const accessRaceCommandId = 'intake-source-read-assignment-race';
    try {
      const accessRace = await post(cmd, accessRaceCommandId);
      assert.equal(accessRace.status, 403, await accessRace.clone().text());
      assert.match(
        ((await accessRace.json()) as { error: string }).error,
        /담당 정보가 변경/,
      );
    } finally {
      sourceBucket.get = sourceGet;
      await writePortalState(originalPortalState);
    }
    assert.equal(
      (
        await flowDb
          .prepare(
            `SELECT COUNT(*) AS count FROM consulting_flow_upload_requests
            WHERE case_id = ?1 AND command_id = ?2`,
          )
          .bind(caseId, accessRaceCommandId)
          .first<{ count: number }>()
      )?.count,
      0,
    );
    assert.deepEqual(
      [...objects.keys()].filter((key) => !previousFlowKeys.has(key)),
      [],
    );

    const originalDocObject = await sourceGet(docRow.storage_key);
    assert.ok(originalDocObject);
    const originalDocBytes = await originalDocObject.arrayBuffer();
    const damagedDocBytes = new Uint8Array(originalDocBytes.slice(0));
    damagedDocBytes[damagedDocBytes.byteLength - 1] ^= 1;
    sourceBucket.get = async (...args: Parameters<R2Bucket['get']>) => {
      const object = await sourceGet(...args);
      if (!object || args[0] !== docRow.storage_key) return object;
      const arrayBuffer = object.arrayBuffer.bind(object);
      object.arrayBuffer = async () => {
        const bytes = await arrayBuffer();
        await sourceBucket.put(docRow.storage_key, damagedDocBytes, {
          httpMetadata: { contentType: docRow.content_type },
        });
        return bytes;
      };
      return object;
    };
    const damageRaceCommandId = 'intake-source-read-damage-race';
    try {
      const damageRace = await post(cmd, damageRaceCommandId);
      assert.equal(damageRace.status, 409, await damageRace.clone().text());
      assert.match(
        ((await damageRace.json()) as { error: string }).error,
        /원본 보관 정보가 변경/,
      );
    } finally {
      sourceBucket.get = sourceGet;
      await sourceBucket.put(docRow.storage_key, originalDocBytes, {
        httpMetadata: { contentType: docRow.content_type },
      });
    }
    assert.equal(
      (
        await flowDb
          .prepare(
            `SELECT COUNT(*) AS count FROM consulting_flow_upload_requests
            WHERE case_id = ?1 AND command_id = ?2`,
          )
          .bind(caseId, damageRaceCommandId)
          .first<{ count: number }>()
      )?.count,
      0,
    );
    assert.deepEqual(
      [...objects.keys()].filter((key) => !previousFlowKeys.has(key)),
      [],
    );

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

    const importCommandId = 'intake-fixed-command';
    const flowStorage = flowBucket();
    const put = flowStorage.put.bind(flowStorage);
    async function failImportCopy(afterCommit: boolean) {
      let injected = false;
      flowStorage.put = async (...args: Parameters<R2Bucket['put']>) => {
        if (injected) return put(...args);
        injected = true;
        if (afterCommit) await put(...args);
        await writePortalState(deletedCaseState);
        throw new Error(
          afterCommit
            ? 'synthetic lost intake copy response after storage'
            : 'synthetic intake copy failure before storage',
        );
      };
      try {
        return await post(cmd, importCommandId);
      } finally {
        flowStorage.put = put;
      }
    }

    const failedBeforeCommit = await failImportCopy(false);
    assert.equal(failedBeforeCommit.status, 404);
    assert.deepEqual(await failedBeforeCommit.json(), {
      error: '해당 컨설팅 진행을 찾을 수 없습니다.',
    });
    assert.equal(await readFlow(caseId), null);
    await writePortalState(originalPortalState);

    const reservation = await flowDb
      .prepare(
        `SELECT file_id, storage_key, status
        FROM consulting_flow_upload_requests
        WHERE case_id = ?1 AND command_id = ?2 AND slot = 'file'`,
      )
      .bind(caseId, importCommandId)
      .first<{ file_id: string; storage_key: string; status: string }>();
    assert.ok(reservation);
    assert.equal(reservation.status, 'pending');
    assert.deepEqual(
      [...objects.keys()].filter((key) => !previousFlowKeys.has(key)),
      [],
    );

    const failedAfterCommit = await failImportCopy(true);
    assert.equal(failedAfterCommit.status, 404);
    assert.deepEqual(await failedAfterCommit.json(), {
      error: '해당 컨설팅 진행을 찾을 수 없습니다.',
    });
    assert.equal(await readFlow(caseId), null);
    await writePortalState(originalPortalState);
    assert.deepEqual(
      [...objects.keys()].filter((key) => !previousFlowKeys.has(key)),
      [reservation.storage_key],
    );
    assert.deepEqual(
      await flowDb
        .prepare(
          `SELECT file_id, storage_key, status
          FROM consulting_flow_upload_requests
          WHERE case_id = ?1 AND command_id = ?2 AND slot = 'file'`,
        )
        .bind(caseId, importCommandId)
        .first<{ file_id: string; storage_key: string; status: string }>(),
      reservation,
    );

    await ok(cmd, importCommandId);
    assert.equal(flow.files.length, 1);
    assert.equal(flow.files[0].id, reservation.file_id);
    assert.equal(flow.files[0].intakeFileId, docId);
    assert.equal(flow.files[0].sourceReviewedBy, owner);
    assert.ok(flow.files[0].sourceReviewedAt);
    assert.equal(flow.files[0].key, '', 'Public flow must hide storage keys');
    assert.deepEqual(
      [...objects.keys()].filter((key) => !previousFlowKeys.has(key)),
      [reservation.storage_key],
    );
    assert.deepEqual(
      {
        ...(await flowDb
          .prepare(
            `SELECT reservation.status, completion.command_id
          FROM consulting_flow_upload_requests reservation
          LEFT JOIN consulting_flow_upload_completions completion
            ON completion.file_id = reservation.file_id
          WHERE reservation.file_id = ?1`,
          )
          .bind(reservation.file_id)
          .first<{ status: string; command_id: string | null }>()),
      },
      { status: 'ready', command_id: importCommandId },
    );
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
