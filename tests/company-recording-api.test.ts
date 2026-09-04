import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { POST as upload } from '../app/api/files/route';
import { GET as download } from '../app/api/files/[id]/route';
import { writePortalState } from '../lib/portal-state';
import { findCompanyFile } from '../lib/company-files';
import { readFlow } from '../lib/consulting-flow-store';
import { GET as stateGet, PUT as statePut } from './state-request';

const permissions = {
  fileUpload: true,
  ownCases: true,
  collaborationApply: true,
  sharedSchedule: true,
  quoteContract: true,
};
const partner = 'intake@example.invalid';
const owner = 'seedy@sites.test';
function syntheticSourceBody(name: string): string | Uint8Array<ArrayBuffer> {
  const extension = name.split('.').at(-1)?.toLowerCase();
  if (extension === 'pdf') return '%PDF-1.7\nLOCAL_SYNTHETIC_SOURCE';
  if (extension === 'docx')
    return zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8('<document/>'),
    }) as Uint8Array<ArrayBuffer>;
  if (extension === 'm4a')
    return new Uint8Array([
      0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0,
      0, 0x4d, 0x34, 0x41, 0x20,
    ]);
  return 'LOCAL_SYNTHETIC_SOURCE';
}
function request(
  path: string,
  form?: FormData,
  email = partner,
  origin = 'http://localhost',
) {
  return new Request(`http://localhost${path}`, {
    method: form ? 'POST' : 'GET',
    body: form,
    headers: {
      origin,
      'oai-authenticated-user-id': email,
      'oai-authenticated-user-email': email,
    },
  });
}
function payload(name: string, category = '상담녹취', consent = true) {
  const form = new FormData();
  form.set('company', '가상 신규기업');
  form.set(
    'title',
    category === '상담녹취' ? `신청 전 전화상담 녹취자료 · ${name}` : category,
  );
  form.set('category', category);
  form.set('assignedTrainee', '다른 담당자');
  form.set('consent', 'confirmed');
  if (consent) form.set('recordingConsent', 'confirmed');
  form.set('file', new File([syntheticSourceBody(name)], name));
  return form;
}

void test('initial call files store privately beside business files without meetings or any AI call', async () => {
  await writePortalState({
    version: 1,
    consultationNumber: 0,
    cases: [],
    timeline: [],
    tasks: [],
    schedule: [],
    companyDocuments: [],
    members: [
      {
        id: 'intake-member',
        name: '가상 담당자',
        email: partner,
        status: '활성',
        permissions,
      },
      {
        id: 'other-member',
        name: '다른 담당자',
        email: 'other@example.invalid',
        status: '활성',
        permissions,
      },
      {
        id: 'limited-member',
        name: '첨부제한',
        email: 'limited@example.invalid',
        status: '활성',
        permissions: { ...permissions, fileUpload: false },
      },
      {
        id: 'inactive-member',
        name: '정지계정',
        email: 'inactive@example.invalid',
        status: '정지',
        permissions,
      },
    ],
  });
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => {
    externalCalls++;
    throw new Error('External calls are forbidden in this intake test');
  };
  try {
    for (const id of ['bad.id', 'x'.repeat(121)])
      assert.equal(
        (
          await download(request(`/api/files/${id}`), {
            params: Promise.resolve({ id }),
          })
        ).status,
        400,
      );
    const lookalike = request('/api/files', payload('call.docx'));
    lookalike.headers.set(
      'content-type',
      'multipart/form-datax; boundary=not-valid',
    );
    assert.equal((await upload(lookalike)).status, 400);
    const missingBoundary = request('/api/files', payload('call.docx'));
    missingBoundary.headers.set('content-type', 'multipart/form-data');
    assert.equal((await upload(missingBoundary)).status, 400);
    const invalidLength = request('/api/files', payload('call.docx'));
    invalidLength.headers.set('content-length', 'invalid');
    assert.equal((await upload(invalidLength)).status, 400);
    assert.equal(
      (
        await upload(
          request('/api/files', payload('call.docx', '상담녹취', false)),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await upload(
          request('/api/files', payload('voice.m4a', '사업자등록증')),
        )
      ).status,
      400,
    );
    assert.equal(
      (await upload(request('/api/files', payload('call.exe')))).status,
      400,
    );
    assert.equal(
      (
        await upload(
          request(
            '/api/files',
            payload('call.docx'),
            'limited@example.invalid',
          ),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await upload(
          request(
            '/api/files',
            payload('call.docx'),
            'inactive@example.invalid',
          ),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await upload(
          request(
            '/api/files',
            payload('call.docx'),
            partner,
            'https://wrong.invalid',
          ),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await upload(
          new Request('http://localhost/api/files', {
            method: 'POST',
            headers: { origin: 'http://localhost' },
            body: payload('call.docx'),
          }),
        )
      ).status,
      401,
    );
    const duplicate = payload('call.docx');
    duplicate.append('file', new File(['x'], 'two.docx'));
    assert.equal((await upload(request('/api/files', duplicate))).status, 400);
    const tooBig = request('/api/files', payload('large.m4a'));
    tooBig.headers.set('content-length', String(27 * 1024 * 1024));
    assert.equal((await upload(tooBig)).status, 413);
    const longCompany = payload('company.docx');
    longCompany.set('company', '가'.repeat(101));
    assert.equal(
      (await upload(request('/api/files', longCompany))).status,
      400,
    );
    const longTitle = payload('title.docx');
    longTitle.set('title', '가'.repeat(151));
    assert.equal((await upload(request('/api/files', longTitle))).status, 400);
    const disguisedPdf = payload('renamed.pdf', '크레탑');
    disguisedPdf.set(
      'file',
      new File(['<html>not a PDF</html>'], 'renamed.pdf'),
    );
    const disguisedResponse = await upload(
      request('/api/files', disguisedPdf),
    );
    assert.equal(disguisedResponse.status, 400);
    assert.match(await disguisedResponse.text(), /실제 파일 형식/);

    const ids: string[] = [];
    const documents: Record<string, unknown>[] = [];
    for (const [name, category] of [
      ['사업자등록증.pdf', '사업자등록증'],
      ['크레탑.pdf', '크레탑'],
      ['notes.docx', '상담녹취'],
      ['call.txt', '상담녹취'],
      ['call.pdf', '상담녹취'],
      ['voice.m4a', '상담녹취'],
    ]) {
      const response = await upload(
        request('/api/files', payload(name, category)),
      );
      assert.equal(response.status, 201, await response.clone().text());
      const { file } = (await response.json()) as {
        file: {
          id: string;
          assignedTrainee: string;
          title: string;
          category: string;
          storageKey?: string;
        };
      };
      ids.push(file.id);
      documents.push({
        id: `document-${file.id}`,
        company: '가상 신규기업',
        category,
        title: file.title,
        storageFileId: file.id,
        status: '제출완료',
        assignedTrainee: file.assignedTrainee,
        submittedBy: '가상 담당자',
      });
      assert.equal(
        file.assignedTrainee,
        '가상 담당자',
        'partner cannot reassign uploads with forged client field',
      );
      assert.equal(file.category, category);
      assert.equal(file.storageKey, undefined);
      if (category === '상담녹취') assert.match(file.title, /신청 전 전화상담/);
      const row = await findCompanyFile(file.id);
      assert.ok(row);
      assert.ok(row.storage_key.startsWith('company-source/'));
      assert.equal(row.category, category);
      const context = { params: Promise.resolve({ id: file.id }) };
      for (const user of [partner, owner]) {
        const result = await download(
          request(`/api/files/${file.id}`, undefined, user),
          context,
        );
        assert.equal(result.status, 200);
        assert.match(
          result.headers.get('content-disposition') || '',
          /attachment/,
        );
        assert.match(result.headers.get('cache-control') || '', /no-store/);
        assert.deepEqual(
          new Uint8Array(await result.arrayBuffer()),
          new Uint8Array(
            await new File([syntheticSourceBody(name)], name).arrayBuffer(),
          ),
        );
      }
      assert.equal(
        (
          await download(
            request(
              `/api/files/${file.id}`,
              undefined,
              'other@example.invalid',
            ),
            context,
          )
        ).status,
        403,
      );
    }
    assert.equal(new Set(ids).size, 6);
    const current = (await (await stateGet(request('/api/state'))).json()) as {
      state: Record<string, unknown>;
    };
    const newState = {
      ...current.state,
      cases: [
        {
          id: 'new-case',
          company: '가상 신규기업',
          trainee: '가상 담당자',
          stage: '접수',
          consultationCount: 0,
        },
      ],
      companyDocuments: documents,
    };
    const savedState = await statePut(
      new Request('http://localhost/api/state', {
        method: 'PUT',
        headers: {
          ...Object.fromEntries(request('/api/state').headers),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ state: newState }),
      }),
    );
    assert.equal(savedState.status, 200, await savedState.clone().text());
    const reopened = (await (await stateGet(request('/api/state'))).json()) as {
      state: {
        companyDocuments: Record<string, unknown>[];
        cases: Record<string, unknown>[];
      };
    };
    assert.equal(reopened.state.companyDocuments.length, 6);
    assert.equal(
      reopened.state.companyDocuments.filter(
        (document) => document.category === '상담녹취',
      ).length,
      4,
    );
    assert.equal(reopened.state.cases[0].stage, '접수');
    assert.equal(reopened.state.cases[0].consultationCount, 0);
    const other = (await (
      await stateGet(request('/api/state', undefined, 'other@example.invalid'))
    ).json()) as { state: { companyDocuments: unknown[] } };
    assert.equal(other.state.companyDocuments.length, 0);
    assert.equal(externalCalls, 0);
    assert.equal(
      await readFlow('new-case'),
      null,
      'source uploads never fabricate a completed consultation or report workflow',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
