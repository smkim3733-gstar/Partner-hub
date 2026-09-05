import assert from 'node:assert/strict';
import test from 'node:test';
import { env } from 'cloudflare:workers';

import { POST } from '../app/api/ai-diagnosis/step-zero/route';
import {
  companyFileBucket,
  companyFileDatabase,
  ensureCompanyFileTables,
} from '../lib/company-files';
import { writePortalState } from '../lib/portal-state';
import { ensureAiDiagnosisTables } from '../lib/ai-diagnosis';

const caseId = 'step-zero-case';
const otherCaseId = 'step-zero-other-case';
const company = '사전검증(가상)';
const member = {
  id: 'step-zero-member',
  name: '가상 담당자',
  email: 'step-zero@example.invalid',
  status: '활성',
  permissions: { ownCases: true, fileUpload: true },
};
const assessment = {
  id: 'step-zero-assessment',
  caseId,
  company,
  identityStatus: '일치',
  hasConsultationEvidence: true,
  privacyMasked: true,
  personalDataConsent: true,
  thirdPartyAiConsent: true,
  transcriptConsent: true,
  level: 'A',
  decision: '1차 초안 생성 가능',
  status: '사전점검 완료',
  updatedAt: '가상 판정 완료',
};
const documents = [
  {
    id: 'step-zero-business-card',
    caseId,
    company,
    category: '사업자등록증',
    status: '검토완료',
    storageFileId: 'step-zero-business',
    assignedTrainee: member.name,
    partnerMemberId: member.id,
  },
  {
    id: 'step-zero-finance-card',
    caseId,
    company,
    category: '재무제표',
    status: '검토완료',
    storageFileId: 'step-zero-finance',
    assignedTrainee: member.name,
    partnerMemberId: member.id,
  },
];

function state(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    consultationNumber: 0,
    timeline: [],
    tasks: [],
    schedule: [],
    members: [member],
    cases: [
      {
        id: caseId,
        company,
        trainee: member.name,
        partnerMemberId: member.id,
      },
      {
        id: otherCaseId,
        company,
        trainee: member.name,
        partnerMemberId: member.id,
      },
    ],
    companyDocuments: documents,
    diagnosisAssessments: [assessment],
    ...overrides,
  };
}

function request(
  requestId = 'step-zero-request-0001',
  pilotContext = '업종: 가상 제조업\n요청사항: 가상 정책자금 가능성 확인\n모든 수치는 확인 필요',
  consentConfirmed = true,
  extraHeaders: Record<string, string> = {},
) {
  return new Request('http://localhost/api/ai-diagnosis/step-zero', {
    method: 'POST',
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/json',
      'oai-authenticated-user-id': 'seedy@sites.test',
      'oai-authenticated-user-email': 'seedy@sites.test',
      ...extraHeaders,
    },
    body: JSON.stringify({
      requestId,
      caseId,
      company,
      pilotMode: true,
      consentConfirmed,
      pilotContext,
    }),
  });
}

async function insertFile(
  id: string,
  category: string,
  linkedCaseId: string,
  r2Etag: string | null = null,
  includeObjectIntegrity = true,
) {
  const db = companyFileDatabase();
  await db
    .prepare(`INSERT INTO company_file_objects (id, storage_key, original_name, company, category, title,
      assigned_trainee, uploaded_by_user_id, uploaded_by_email, content_type, size_bytes, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?7, 'application/pdf', 4, ?8)`)
    .bind(
      id,
      `company-source/${id}`,
      `${id}.pdf`,
      company,
      category,
      member.name,
      member.email,
      '2026-09-01T00:00:00.000Z',
    )
    .run();
  await db
    .prepare(`INSERT INTO company_file_metadata
      (file_id, original_name, company, category, title, assigned_trainee,
       uploaded_by_user_id, uploaded_by_email, content_type, size_bytes, created_at)
      SELECT id, original_name, company, category, title, assigned_trainee,
        uploaded_by_user_id, uploaded_by_email, content_type, size_bytes, created_at
      FROM company_file_objects WHERE id = ?1`)
    .bind(id)
    .run();
  if (includeObjectIntegrity)
    await db
      .prepare(`INSERT INTO company_file_object_integrity
        (file_id, validation_mode, r2_etag, r2_content_type)
        VALUES (?1, ?2, ?3, 'application/pdf')`)
      .bind(id, r2Etag === null ? 'metadata' : 'etag', r2Etag)
      .run();
  await db
    .prepare(`INSERT INTO company_file_storage_keys (file_id, storage_key)
      VALUES (?1, ?2)`)
    .bind(id, `company-source/${id}`)
    .run();
  await db
    .prepare(
      'INSERT INTO company_file_assignments (file_id, partner_member_id) VALUES (?1, ?2)',
    )
    .bind(id, member.id)
    .run();
  await db
    .prepare(
      'INSERT INTO company_file_case_links (file_id, case_id) VALUES (?1, ?2)',
    )
    .bind(id, linkedCaseId)
    .run();
}

void test('Step 0 rechecks exact stored evidence and all consents before external AI', async () => {
  const db = companyFileDatabase();
  await ensureCompanyFileTables(db);
  await writePortalState(state());
  await db
    .prepare('DROP TRIGGER IF EXISTS company_file_upload_requests_no_delete')
    .run();
  await db.prepare('DROP TRIGGER IF EXISTS ai_diagnosis_runs_no_delete').run();
  try {
    await db.batch([
      db.prepare('DELETE FROM ai_diagnosis_runs'),
      db.prepare('DELETE FROM company_file_upload_requests'),
      db.prepare('DELETE FROM company_file_objects'),
    ]);
  } finally {
    await ensureCompanyFileTables(db);
    await ensureAiDiagnosisTables(db);
  }

  const runtime = env as unknown as {
    ANTHROPIC_API_KEY?: string;
    ANTHROPIC_MODEL?: string;
  };
  const oldKey = runtime.ANTHROPIC_API_KEY;
  const oldModel = runtime.ANTHROPIC_MODEL;
  const oldFetch = globalThis.fetch;
  let externalCalls = 0;
  const modelResponse = () =>
    Response.json(
      {
        id: 'msg_step_zero',
        type: 'message',
        role: 'assistant',
        model: 'synthetic-step-zero-provider-model',
        stop_reason: 'end_turn',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              companyOverview: '가상 기업 현황은 추가 확인이 필요합니다.',
              confirmedStrengths: [],
              mainRisks: ['확인 필요'],
              solutionCandidates: [],
              verificationQuestions: ['가상 현황을 확인했습니까?'],
              missingDocuments: [],
              complianceNotes: ['대표 검토 전 내부 초안'],
              nextAction: '가상 입력을 검토합니다.',
            }),
          },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
      },
      { headers: { 'request-id': 'req_step_zero' } },
    );
  runtime.ANTHROPIC_API_KEY = 'synthetic-step-zero-key';
  runtime.ANTHROPIC_MODEL = 'synthetic-step-zero-model';
  globalThis.fetch = async (_input, init) => {
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(init.signal.aborted, false);
    externalCalls++;
    return modelResponse();
  };

  try {
    assert.equal(
      (await POST(request('step-zero-short-input', '짧은 설명'))).status,
      400,
    );
    assert.equal(
      (await POST(request('step-zero-long-input', '가'.repeat(8_001)))).status,
      400,
    );
    assert.equal(
      (await POST(request('step-zero-oversized-input', '가'.repeat(14_000))))
        .status,
      413,
    );
    assert.equal(
      (
        await POST(
          request('step-zero-wrong-media', undefined, true, {
            'content-type': 'text/plain',
          }),
        )
      ).status,
      415,
    );
    assert.equal((await POST(request('x'.repeat(101)))).status, 400);
    assert.equal(
      (
        await POST(
          request(
            'step-zero-identifier-input',
            '가상기업 설명에 test@example.com 식별정보 포함',
          ),
        )
      ).status,
      400,
    );
    assert.equal(
      (await POST(request('step-zero-no-consent', undefined, false))).status,
      400,
    );
    assert.equal(
      externalCalls,
      0,
      'invalid or unconfirmed input must fail before fetch',
    );

    assert.equal((await POST(request())).status, 403);
    assert.equal(
      externalCalls,
      0,
      'metadata-less cards must fail before fetch',
    );

    const businessObject = await companyFileBucket().put(
      'company-source/step-zero-business',
      new Uint8Array([1, 2, 3, 4]),
      { httpMetadata: { contentType: 'application/pdf' } },
    );
    const financeObject = await companyFileBucket().put(
      'company-source/step-zero-finance',
      new Uint8Array([1, 2, 3, 4]),
      { httpMetadata: { contentType: 'application/pdf' } },
    );
    await insertFile(
      'step-zero-business',
      '사업자등록증',
      caseId,
      businessObject.etag,
    );
    await insertFile(
      'step-zero-finance',
      '재무제표',
      otherCaseId,
      financeObject.etag,
    );
    assert.equal((await POST(request())).status, 403);
    assert.equal(externalCalls, 0, 'another case file must fail before fetch');

    await db
      .prepare('DELETE FROM company_file_objects WHERE id = ?1')
      .bind('step-zero-finance')
      .run();
    await insertFile(
      'step-zero-finance',
      '재무제표',
      caseId,
      financeObject.etag,
    );
    await companyFileBucket().delete('company-source/step-zero-finance');
    assert.equal((await POST(request())).status, 403);
    assert.equal(
      externalCalls,
      0,
      'missing R2 evidence must fail before fetch',
    );

    await companyFileBucket().put(
      'company-source/step-zero-finance',
      new Uint8Array([1, 2, 3, 4]),
      { httpMetadata: { contentType: 'application/pdf' } },
    );
    await companyFileBucket().put(
      'company-source/step-zero-finance',
      new Uint8Array([4, 3, 2, 1]),
      { httpMetadata: { contentType: 'application/pdf' } },
    );
    assert.equal((await POST(request())).status, 403);
    assert.equal(
      externalCalls,
      0,
      'same-size R2 replacement must fail before fetch',
    );
    await companyFileBucket().put(
      'company-source/step-zero-finance',
      new Uint8Array([1, 2, 3, 4]),
      { httpMetadata: { contentType: 'application/pdf' } },
    );
    await db
      .prepare('DELETE FROM company_file_objects WHERE id = ?1')
      .bind('step-zero-finance')
      .run();
    await insertFile('step-zero-finance', '재무제표', caseId, null, false);
    assert.equal((await POST(request())).status, 503);
    assert.equal(
      externalCalls,
      0,
      'missing object-integrity ledger must fail before fetch',
    );
    await db
      .prepare(`INSERT INTO company_file_object_integrity
        (file_id, validation_mode, r2_etag, r2_content_type)
        VALUES (?1, 'etag', ?2, 'application/pdf')`)
      .bind(
        'step-zero-finance',
        (await companyFileBucket().head('company-source/step-zero-finance'))
          ?.etag,
      )
      .run();
    await writePortalState(
      state({
        diagnosisAssessments: [{ ...assessment, transcriptConsent: false }],
      }),
    );
    assert.equal((await POST(request())).status, 403);
    assert.equal(
      externalCalls,
      0,
      'revoked transcript consent must fail before fetch',
    );

    await writePortalState(state());
    for (const [requestId, invalidModel] of [
      ['step-zero-oversized-model', 'm'.repeat(201)],
      ['step-zero-unsafe-model', 'model\u0001name'],
    ]) {
      runtime.ANTHROPIC_MODEL = invalidModel;
      assert.equal((await POST(request(requestId))).status, 503);
    }
    assert.equal(externalCalls, 0, 'invalid model must fail before fetch');
    runtime.ANTHROPIC_MODEL = 'synthetic-step-zero-model';
    const generated = await POST(request());
    assert.equal(generated.status, 201, await generated.clone().text());
    assert.equal(externalCalls, 1);

    const reused = await POST(request());
    assert.equal(reused.status, 200);
    assert.equal(((await reused.json()) as { reused?: boolean }).reused, true);
    assert.equal(
      externalCalls,
      1,
      'lost response retry must reuse the saved run',
    );
    assert.equal(
      (
        await POST(
          request(
            'step-zero-request-0001',
            '업종: 다른 가상 제조업\n요청사항: 변경된 시험 내용을 검토합니다.',
          ),
        )
      ).status,
      409,
    );
    assert.equal(externalCalls, 1, 'changed content cannot reuse a request ID');

    let releaseFetch!: () => void;
    let notifyFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      notifyFetchStarted = resolve;
    });
    const fetchRelease = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    globalThis.fetch = async () => {
      externalCalls++;
      notifyFetchStarted();
      await fetchRelease;
      return modelResponse();
    };
    const concurrentContext =
      '업종: 동시 요청 가상기업\n요청사항: 같은 생성 요청의 중복 호출을 검증합니다.';
    const first = POST(request('step-zero-concurrent-0001', concurrentContext));
    await fetchStarted;
    const duplicate = await POST(
      request('step-zero-concurrent-0001', concurrentContext),
    );
    assert.equal(duplicate.status, 409);
    const otherRequestWhilePending = await POST(
      request('step-zero-concurrent-0002', concurrentContext),
    );
    assert.equal(otherRequestWhilePending.status, 409);
    assert.equal(
      externalCalls,
      2,
      'concurrent duplicate must not call the model',
    );
    releaseFetch();
    assert.equal((await first).status, 201);
    const counts = await db
      .prepare(`SELECT status, COUNT(*) count FROM ai_diagnosis_runs
        WHERE case_id = ?1 GROUP BY status ORDER BY status`)
      .bind(caseId)
      .all<{ status: string; count: number }>();
    assert.equal(counts.results.length, 1);
    assert.equal(counts.results[0].status, '대표 검토 대기');
    assert.equal(counts.results[0].count, 2);

    globalThis.fetch = async () => {
      externalCalls++;
      return Response.json(
        { error: { message: 'synthetic provider failure' } },
        { status: 503 },
      );
    };
    const failedId = 'step-zero-failed-request-0001';
    const providerFailure = await POST(request(failedId, concurrentContext));
    assert.equal(providerFailure.status, 502);
    assert.doesNotMatch(
      await providerFailure.text(),
      /synthetic provider failure/,
    );
    assert.equal(externalCalls, 3);
    assert.equal(
      (await POST(request(failedId, concurrentContext))).status,
      409,
    );
    assert.equal(
      externalCalls,
      3,
      'an uncertain failed request is not replayed',
    );
    globalThis.fetch = async () => {
      externalCalls++;
      return modelResponse();
    };
    assert.equal(
      (await POST(request('step-zero-after-failure-0001', concurrentContext)))
        .status,
      201,
    );
    assert.equal(externalCalls, 4, 'a distinct deliberate retry can proceed');

    globalThis.fetch = async () => {
      externalCalls++;
      await writePortalState(
        state({
          diagnosisAssessments: [{ ...assessment, transcriptConsent: false }],
        }),
      );
      return modelResponse();
    };
    const revokedDuringRunId = 'step-zero-revoked-during-run-0001';
    const revokedDuringRun = await POST(
      request(revokedDuringRunId, concurrentContext),
    );
    assert.equal(revokedDuringRun.status, 409);
    assert.equal(externalCalls, 5);
    const revokedRow = await db
      .prepare('SELECT status FROM ai_diagnosis_runs WHERE id = ?1')
      .bind(revokedDuringRunId)
      .first<{ status: string }>();
    assert.equal(revokedRow?.status, '생성실패');
    await writePortalState(state());
    assert.equal(
      (await POST(request(revokedDuringRunId, concurrentContext))).status,
      409,
    );
    assert.equal(
      externalCalls,
      5,
      'a response received after consent revocation is not saved or replayed',
    );

    globalThis.fetch = async () => {
      externalCalls++;
      await companyFileBucket().delete('company-source/step-zero-finance');
      return modelResponse();
    };
    const removedDuringRunId = 'step-zero-file-removed-during-run-0001';
    assert.equal(
      (await POST(request(removedDuringRunId, concurrentContext))).status,
      409,
    );
    assert.equal(externalCalls, 6);
    assert.equal(
      (
        await db
          .prepare('SELECT status FROM ai_diagnosis_runs WHERE id = ?1')
          .bind(removedDuringRunId)
          .first<{ status: string }>()
      )?.status,
      '생성실패',
    );
    await companyFileBucket().put(
      'company-source/step-zero-finance',
      new Uint8Array([1, 2, 3, 4]),
      { httpMetadata: { contentType: 'application/pdf' } },
    );
  } finally {
    runtime.ANTHROPIC_API_KEY = oldKey;
    runtime.ANTHROPIC_MODEL = oldModel;
    globalThis.fetch = oldFetch;
  }
});
