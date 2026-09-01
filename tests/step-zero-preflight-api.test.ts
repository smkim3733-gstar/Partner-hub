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

function request() {
  return new Request('http://localhost/api/ai-diagnosis/step-zero', {
    method: 'POST',
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/json',
      'oai-authenticated-user-id': 'seedy@sites.test',
      'oai-authenticated-user-email': 'seedy@sites.test',
    },
    body: JSON.stringify({
      caseId,
      company,
      pilotMode: true,
      consentConfirmed: true,
      pilotContext:
        '업종: 가상 제조업\n요청사항: 가상 정책자금 가능성 확인\n모든 수치는 확인 필요',
    }),
  });
}

async function insertFile(
  id: string,
  category: string,
  linkedCaseId: string,
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
  await db.batch([
    db.prepare('DELETE FROM ai_diagnosis_runs'),
    db.prepare('DELETE FROM company_file_case_links'),
    db.prepare('DELETE FROM company_file_assignments'),
    db.prepare('DELETE FROM company_file_upload_requests'),
    db.prepare('DELETE FROM company_file_objects'),
  ]);

  const runtime = env as unknown as {
    ANTHROPIC_API_KEY?: string;
    ANTHROPIC_MODEL?: string;
  };
  const oldKey = runtime.ANTHROPIC_API_KEY;
  const oldModel = runtime.ANTHROPIC_MODEL;
  const oldFetch = globalThis.fetch;
  let externalCalls = 0;
  runtime.ANTHROPIC_API_KEY = 'synthetic-step-zero-key';
  runtime.ANTHROPIC_MODEL = 'synthetic-step-zero-model';
  globalThis.fetch = async () => {
    externalCalls++;
    return Response.json({
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
    });
  };

  try {
    assert.equal((await POST(request())).status, 403);
    assert.equal(externalCalls, 0, 'metadata-less cards must fail before fetch');

    await insertFile('step-zero-business', '사업자등록증', caseId);
    await insertFile('step-zero-finance', '재무제표', otherCaseId);
    await companyFileBucket().put(
      'company-source/step-zero-business',
      new Uint8Array([1, 2, 3, 4]),
    );
    await companyFileBucket().put(
      'company-source/step-zero-finance',
      new Uint8Array([1, 2, 3, 4]),
    );
    assert.equal((await POST(request())).status, 403);
    assert.equal(externalCalls, 0, 'another case file must fail before fetch');

    await db
      .prepare(
        'UPDATE company_file_case_links SET case_id = ?1 WHERE file_id = ?2',
      )
      .bind(caseId, 'step-zero-finance')
      .run();
    await companyFileBucket().delete('company-source/step-zero-finance');
    assert.equal((await POST(request())).status, 403);
    assert.equal(externalCalls, 0, 'missing R2 evidence must fail before fetch');

    await companyFileBucket().put(
      'company-source/step-zero-finance',
      new Uint8Array([1, 2, 3, 4]),
    );
    await writePortalState(
      state({
        diagnosisAssessments: [{ ...assessment, transcriptConsent: false }],
      }),
    );
    assert.equal((await POST(request())).status, 403);
    assert.equal(externalCalls, 0, 'revoked transcript consent must fail before fetch');

    await writePortalState(state());
    const generated = await POST(request());
    assert.equal(generated.status, 201, await generated.clone().text());
    assert.equal(externalCalls, 1);
  } finally {
    runtime.ANTHROPIC_API_KEY = oldKey;
    runtime.ANTHROPIC_MODEL = oldModel;
    globalThis.fetch = oldFetch;
  }
});
