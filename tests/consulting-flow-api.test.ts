import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { env } from 'cloudflare:workers';
import { strToU8, zipSync } from 'fflate';
import { GET, POST } from '../app/api/consulting-flow/[caseId]/route';
import { GET as download } from '../app/api/consulting-flow/[caseId]/files/[fileId]/route';
import { GET as print } from '../app/api/consulting-flow/[caseId]/reports/[reportId]/route';
import { POST as run } from '../app/api/consulting-flow/[caseId]/run/route';
import { GET as stateGet, PUT as statePut } from './state-request';
import { readPortalState, writePortalState } from '../lib/portal-state';
import { commitFlow, readFlow } from '../lib/consulting-flow-store';
import {
  applyFlowCommand,
  newConsultingFlow,
  type ConsultingFlow,
} from '../lib/consulting-flow';

const permissions = {
  ownCases: true,
  fileUpload: true,
  sharedSchedule: true,
  quoteContract: true,
  collaborationApply: true,
};
const partnerEmail = 'flow-test@example.invalid';
function request(
  path: string,
  body?: unknown,
  email = 'seedy@sites.test',
  origin = 'http://localhost',
) {
  return new Request(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'oai-authenticated-user-id': email,
      'oai-authenticated-user-email': email,
      origin,
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
let counter = 0;
const context = (caseId: string) => ({ params: Promise.resolve({ caseId }) });
async function responseData(response: Response) {
  return (await response.json()) as {
    flow: ConsultingFlow;
    error?: string;
    state?: unknown;
  };
}
async function command(
  caseId: string,
  flow: ConsultingFlow,
  cmd: Record<string, unknown>,
  email = 'seedy@sites.test',
  file?: File,
  id?: string,
) {
  const payload = {
    revision: flow.revision,
    commandId: id || `api-command-${++counter}`,
    command: { transcriptReviewed: true, ...cmd },
  };
  if (file) {
    const form = new FormData();
    form.set('payload', JSON.stringify(payload));
    form.set('file', file);
    return POST(
      request(`/api/consulting-flow/${caseId}`, form, email),
      context(caseId),
    );
  }
  return POST(
    request(`/api/consulting-flow/${caseId}`, payload, email),
    context(caseId),
  );
}
void nodeTest(
  'private workflow HTTP + real SQLite: ACL, CAS, idempotency, upload, print, projection, no real AI calls',
  async () => {
    const source = {
      version: 1,
      consultationNumber: 0,
      timeline: [],
      tasks: [],
      schedule: [],
      companyDocuments: [],
      diagnosisAssessments: [],
      members: [
        {
          id: 'partner-one',
          name: '가상 파트너',
          email: partnerEmail,
          status: '활성',
          permissions,
        },
        {
          id: 'partner-other',
          name: '다른 파트너',
          email: 'other@example.invalid',
          status: '활성',
          permissions,
        },
      ],
      cases: [
        {
          id: 'api-case',
          company: '가상 API기업',
          trainee: '가상 파트너',
          stage: '접수',
          consultationCount: 0,
        },
      ],
    };
    await writePortalState(source);
    const initialResponse = await GET(
      request('/api/consulting-flow/api-case'),
      context('api-case'),
    );
    assert.equal(initialResponse.status, 200);
    assert.match(
      initialResponse.headers.get('cache-control') || '',
      /no-store/,
    );
    let flow = (await responseData(initialResponse)).flow;
    assert.equal(flow.revision, 0);
    for (const caseId of ['bad.case', 'x'.repeat(121)])
      assert.equal(
        (await GET(request(`/api/consulting-flow/${caseId}`), context(caseId)))
          .status,
        400,
      );
    assert.equal(
      (
        await GET(
          request(
            '/api/consulting-flow/api-case',
            undefined,
            'other@example.invalid',
          ),
          context('api-case'),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await GET(
          new Request('http://localhost/api/consulting-flow/api-case'),
          context('api-case'),
        )
      ).status,
      401,
    );
    const hostile = await POST(
      request(
        '/api/consulting-flow/api-case',
        {
          revision: 0,
          commandId: 'malicious-01',
          command: { type: 'save_report', stage: 1, body: 'bad' },
        },
        'seedy@sites.test',
        'https://other.invalid',
      ),
      context('api-case'),
    );
    assert.equal(hostile.status, 403);
    const reportBody =
      '가상 테스트 보고서입니다. 입력값은 사실이 아니라 시스템 점검용이며 외부로 전송하지 않습니다. '.repeat(
        5,
      ) + '<script>window.bad=true</script>';
    const saved = await command(
      'api-case',
      flow,
      { type: 'save_report', stage: 1, body: reportBody, fileConsent: true },
      'seedy@sites.test',
      new File(['%PDF-1.7\nmock'], '분석.pdf', { type: 'application/pdf' }),
      'api-idempotent-01',
    );
    assert.equal(saved.status, 200);
    flow = (await responseData(saved)).flow;
    assert.equal(flow.reports.length, 1);
    assert.equal(flow.files[0].key, '');
    const duplicate = await command(
      'api-case',
      flow,
      { type: 'save_report', stage: 1, body: reportBody, fileConsent: true },
      'seedy@sites.test',
      new File(['%PDF-1.7\nmock'], '분석.pdf', { type: 'application/pdf' }),
      'api-idempotent-01',
    );
    assert.equal(duplicate.status, 200);
    assert.equal((await responseData(duplicate)).flow.reports.length, 1);
    const partnerGet = await GET(
      request('/api/consulting-flow/api-case', undefined, partnerEmail),
      context('api-case'),
    );
    assert.equal(partnerGet.status, 200);
    assert.equal((await responseData(partnerGet)).flow.reports.length, 1);
    const fileId = flow.files[0].id;
    const fileContext = {
      params: Promise.resolve({ caseId: 'api-case', fileId }),
    };
    const responseFile = await download(
      request(
        `/api/consulting-flow/api-case/files/${fileId}`,
        undefined,
        partnerEmail,
      ),
      fileContext,
    );
    assert.equal(responseFile.status, 200);
    assert.equal(await responseFile.text(), '%PDF-1.7\nmock');
    assert.match(
      responseFile.headers.get('content-disposition') || '',
      /attachment/,
    );
    assert.equal(
      (
        await download(
          request(
            `/api/consulting-flow/api-case/files/${fileId}`,
            undefined,
            'other@example.invalid',
          ),
          fileContext,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await download(
          request('/api/consulting-flow/api-case/files/bad.file'),
          {
            params: Promise.resolve({
              caseId: 'api-case',
              fileId: 'bad.file',
            }),
          },
        )
      ).status,
      400,
    );
    const reportId = flow.reports[0].id;
    const reportContext = {
      params: Promise.resolve({ caseId: 'api-case', reportId }),
    };
    const printable = await print(
      request(
        `/api/consulting-flow/api-case/reports/${reportId}`,
        undefined,
        partnerEmail,
      ),
      reportContext,
    );
    assert.equal(printable.status, 200);
    assert.match(
      printable.headers.get('content-security-policy') || '',
      /frame-ancestors 'none'/,
    );
    const html = await printable.text();
    assert.ok(html.includes('&lt;script&gt;window.bad=true&lt;/script&gt;'));
    assert.ok(!html.includes('<script>window.bad=true'));
    const reportDownload = await print(
      request(
        `/api/consulting-flow/api-case/reports/${reportId}?download=1`,
        undefined,
        partnerEmail,
      ),
      reportContext,
    );
    assert.equal(reportDownload.status, 200);
    assert.match(
      reportDownload.headers.get('content-type') || '',
      /text\/markdown/,
    );
    for (const query of ['?download=false', '?download=1&download=1'])
      assert.equal(
        (
          await print(
            request(
              `/api/consulting-flow/api-case/reports/${reportId}${query}`,
              undefined,
              partnerEmail,
            ),
            reportContext,
          )
        ).status,
        400,
      );
    assert.equal(
      (
        await print(
          request(`/api/consulting-flow/api-case/reports/${'x'.repeat(121)}`),
          {
            params: Promise.resolve({
              caseId: 'api-case',
              reportId: 'x'.repeat(121),
            }),
          },
        )
      ).status,
      400,
    );
    const forbidden = await command(
      'api-case',
      flow,
      {
        type: 'set_ai_policy',
        enabled: true,
        privacyMasked: true,
        thirdPartyConsent: true,
        costConsent: true,
      },
      partnerEmail,
    );
    assert.equal(forbidden.status, 403);
    const analyses = await Promise.all([
      command('api-case', flow, { type: 'confirm_analysis', reportId }),
      command(
        'api-case',
        flow,
        { type: 'confirm_analysis', reportId },
        partnerEmail,
      ),
    ]);
    assert.deepEqual(
      analyses.map((r) => r.status).sort((a, b) => a - b),
      [200, 409],
    );
    flow = (
      await responseData(
        await GET(
          request('/api/consulting-flow/api-case'),
          context('api-case'),
        ),
      )
    ).flow;
    const absent = flow.analysis.adminAt ? partnerEmail : 'seedy@sites.test';
    flow = (
      await responseData(
        await command(
          'api-case',
          flow,
          { type: 'confirm_analysis', reportId },
          absent,
        ),
      )
    ).flow;
    assert.ok(flow.analysis.adminAt && flow.analysis.partnerAt);
    const old = newConsultingFlow(
      'cas-only',
      '가상',
      'partner-one',
      '가상 파트너',
    );
    const a = applyFlowCommand(
      old,
      { type: 'save_report', stage: 1, body: reportBody },
      { id: 'admin', role: 'admin', name: '대표' },
      { commandId: 'cas-insert-01', now: new Date().toISOString() },
    );
    await commitFlow(old, a);
    await assert.rejects(commitFlow(old, a));
    assert.equal((await readFlow('cas-only'))?.revision, 1);
    const stateResponse = await stateGet(request('/api/state'));
    assert.equal(stateResponse.status, 200);
    const state = (await responseData(stateResponse)).state as typeof source & {
      cases: Array<{ flowManaged: boolean; stage: string }>;
    };
    assert.equal(state.cases[0].flowManaged, true);
    state.cases[0].stage = '사후관리';
    const putRequest = new Request('http://localhost/api/state', {
      method: 'PUT',
      headers: {
        'oai-authenticated-user-id': 'owner',
        'oai-authenticated-user-email': 'seedy@sites.test',
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({ state }),
    });
    assert.equal((await statePut(putRequest)).status, 200);
    const reprojected = (
      await responseData(await stateGet(request('/api/state')))
    ).state as { cases: Array<{ stage: string }> };
    assert.equal(reprojected.cases[0].stage, '상담예약');
    // A run with no queued job must not use external network or alter the report.
    const ran = await run(
      request('/api/consulting-flow/api-case/run', {}),
      context('api-case'),
    );
    assert.equal(ran.status, 200);
    assert.equal((await responseData(ran)).flow.reports.length, 1);
    // Explicitly enabled, but the isolated runtime has no key: failure is saved, not fabricated success.
    flow = (
      await responseData(
        await command('api-case', flow, {
          type: 'set_ai_policy',
          enabled: true,
          privacyMasked: true,
          thirdPartyConsent: true,
          costConsent: true,
        }),
      )
    ).flow;
    flow = (
      await responseData(
        await command('api-case', flow, {
          type: 'save_source',
          sourceText: reportBody,
          privacyMasked: true,
        }),
      )
    ).flow;
    flow = (
      await responseData(
        await command('api-case', flow, { type: 'queue_report1' }),
      )
    ).flow;
    const failed = await run(
      request('/api/consulting-flow/api-case/run', {}),
      context('api-case'),
    );
    assert.equal(failed.status, 200);
    const final = (await responseData(failed)).flow;
    assert.equal(final.jobs.at(-1)?.status, 'failed');
    assert.equal(final.reports.length, 1);
    const runtime = env as unknown as { ANTHROPIC_API_KEY?: string };
    const originalFetch = globalThis.fetch;
    let calls = 0;
    let providerFailure = true;
    runtime.ANTHROPIC_API_KEY = 'test-only-not-a-real-key';
    globalThis.fetch = async (input, init) => {
      assert.equal(input, 'https://api.anthropic.com/v1/messages');
      assert.ok(typeof init?.body === 'string');
      const data = JSON.parse(init.body) as {
        model: string;
        messages: unknown[];
      };
      assert.equal(data.model, 'claude-opus-5');
      assert.ok(data.messages.length);
      calls++;
      if (providerFailure)
        return Response.json(
          { request_id: 'req_consulting_flow_failure' },
          {
            status: 429,
            headers: { 'request-id': 'req_consulting_flow_failure' },
          },
        );
      return Response.json(
        {
          id: 'msg_consulting_flow',
          type: 'message',
          role: 'assistant',
          model: 'claude-synthetic-response-model',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: reportBody + '\n[분석 끝]' }],
          usage: { input_tokens: 10, output_tokens: 20 },
        },
        { headers: { 'request-id': 'req_consulting_flow' } },
      );
    };
    try {
      flow = (
        await responseData(
          await command('api-case', final, {
            type: 'retry_job',
            jobId: final.jobs.at(-1)!.id,
            costConsent: true,
          }),
        )
      ).flow;
      const providerFailed = await run(
        request('/api/consulting-flow/api-case/run', {}),
        context('api-case'),
      );
      assert.equal(providerFailed.status, 200);
      flow = (await responseData(providerFailed)).flow;
      assert.equal(flow.jobs.at(-1)?.status, 'failed');
      const providerFailureEvidence = flow.jobs.at(-1)?.failureEvidence;
      assert.ok(
        typeof providerFailureEvidence?.observedAt === 'string' &&
          Number.isFinite(Date.parse(providerFailureEvidence.observedAt)),
      );
      const providerFailureAudit = flow.audit.find(
        (entry) => entry.id === providerFailureEvidence?.auditId,
      );
      assert.equal(providerFailureAudit?.action, 'ai_result');
      assert.equal(providerFailureAudit?.actor, '보고서 자동생성');
      assert.ok(
        Date.parse(providerFailureAudit!.at) >=
          Date.parse(providerFailureEvidence!.observedAt),
      );
      const {
        observedAt: _observedAt,
        auditId: _auditId,
        ...providerFailureFacts
      } = providerFailureEvidence!;
      assert.deepEqual(providerFailureFacts, {
        instructionVersion: 'v2.5-partner-workflow-2026-08-30',
        requestedModel: 'claude-opus-5',
        httpStatus: 429,
        providerRequestId: 'req_consulting_flow_failure',
      });
      assert.equal(calls, 1);
      providerFailure = false;
      flow = (
        await responseData(
          await command('api-case', flow, {
            type: 'retry_job',
            jobId: flow.jobs.at(-1)!.id,
            costConsent: true,
          }),
        )
      ).flow;
      assert.equal(flow.jobs.at(-1)?.failureEvidence, undefined);
      assert.deepEqual(flow.jobs.at(-1)?.failureEvidenceHistory, [
        providerFailureEvidence,
      ]);
      const runs = await Promise.all([
        run(
          request('/api/consulting-flow/api-case/run', {}),
          context('api-case'),
        ),
        run(
          request('/api/consulting-flow/api-case/run', {}),
          context('api-case'),
        ),
      ]);
      assert.ok(runs.every((r) => r.status === 200 || r.status === 409));
      assert.equal(calls, 2);
      flow = (
        await responseData(
          await GET(
            request('/api/consulting-flow/api-case'),
            context('api-case'),
          ),
        )
      ).flow;
      assert.equal(flow.reports.length, 2);
      assert.equal(flow.reports.at(-1)?.origin, 'ai');
      assert.deepEqual(flow.jobs.at(-1)?.evidence, {
        instructionVersion: 'v2.5-partner-workflow-2026-08-30',
        requestedModel: 'claude-opus-5',
        providerRequestId: 'req_consulting_flow',
        providerModel: 'claude-synthetic-response-model',
        providerMessageId: 'msg_consulting_flow',
        inputTokens: 10,
        outputTokens: 20,
      });
      assert.equal(flow.jobs.at(-1)?.failureEvidenceHistory?.length, 1);
      assert.equal(flow.analysis.adminAt, undefined);
      const newReportId = flow.reports.at(-1)!.id;
      flow = (
        await responseData(
          await command('api-case', flow, {
            type: 'confirm_analysis',
            reportId: newReportId,
          }),
        )
      ).flow;
      flow = (
        await responseData(
          await command(
            'api-case',
            flow,
            { type: 'confirm_analysis', reportId: newReportId },
            partnerEmail,
          ),
        )
      ).flow;
      flow = (
        await responseData(
          await command(
            'api-case',
            flow,
            {
              type: 'book_meeting',
              kind: 'first',
              attendance: 'both',
              startsAt: '2025-01-01T01:00:00Z',
              endsAt: '2025-01-01T02:00:00Z',
              location: '가상 테스트',
            },
            partnerEmail,
          ),
        )
      ).flow;
      flow = (
        await responseData(
          await command('api-case', flow, {
            type: 'save_report',
            stage: 2,
            body: reportBody,
          }),
        )
      ).flow;
      flow = (
        await responseData(
          await command(
            'api-case',
            flow,
            { type: 'save_report', stage: 3, fileConsent: true },
            'seedy@sites.test',
            new File(
              [
                zipSync({
                  '[Content_Types].xml': strToU8('<Types/>'),
                  'ppt/presentation.xml': strToU8('<presentation/>'),
                }) as Uint8Array<ArrayBuffer>,
              ],
              'test.pptx',
            ),
          ),
        )
      ).flow;
      flow = (
        await responseData(
          await command('api-case', flow, {
            type: 'complete_meeting',
            meetingId: flow.meetings[0].id,
          }),
        )
      ).flow;
      flow = (
        await responseData(
          await command(
            'api-case',
            flow,
            {
              type: 'save_recording',
              meetingId: flow.meetings[0].id,
              transcript: reportBody,
              recordingConsent: true,
              privacyMasked: true,
            },
            partnerEmail,
          ),
        )
      ).flow;
      assert.equal(flow.jobs.at(-1)?.status, 'queued');
      const deep = await run(
        request('/api/consulting-flow/api-case/run', {}, partnerEmail),
        context('api-case'),
      );
      assert.equal(deep.status, 200);
      const result = (await responseData(deep)).flow;
      assert.equal(result.reports.at(-1)?.stage, 4);
      assert.equal(
        result.reports.at(-1)?.sourceRecordingId,
        result.recordings.at(-1)?.id,
      );
      assert.equal(result.jobs.at(-1)?.status, 'complete');
      assert.deepEqual(result.jobs.at(-1)?.evidence, {
        instructionVersion: 'v2.5-partner-workflow-2026-08-30',
        requestedModel: 'claude-opus-5',
        providerRequestId: 'req_consulting_flow',
        providerModel: 'claude-synthetic-response-model',
        providerMessageId: 'msg_consulting_flow',
        inputTokens: 10,
        outputTokens: 20,
      });
      assert.equal(calls, 3);
    } finally {
      globalThis.fetch = originalFetch;
      delete runtime.ANTHROPIC_API_KEY;
    }
    const closedState = (await readPortalState()) as Omit<
      typeof source,
      'cases'
    > & {
      cases: Array<Record<string, unknown>>;
    };
    closedState.cases[0] = {
      ...closedState.cases[0],
      pipelineLifecycleVersion: 1,
      pipelineLifecycleStatus: 'discontinued',
      pipelineHighestStage: '상담진행',
      pipelineStageSource: 'flow_verified',
      pipelineDiscontinuedAt: '2026-09-01T00:00:00.000Z',
      pipelineDiscontinuedStage: '상담진행',
      pipelineReopenCount: 0,
    };
    await writePortalState(closedState);
    assert.equal(
      (
        await command('api-case', flow, {
          type: 'set_ai_policy',
          enabled: false,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await run(
          request('/api/consulting-flow/api-case/run', {}),
          context('api-case'),
        )
      ).status,
      409,
    );
    assert.equal(
      (await GET(request('/api/consulting-flow/api-case'), context('api-case')))
        .status,
      200,
    );
  },
);
