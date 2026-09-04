import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from 'cloudflare:workers';
import { zipSync, strToU8 } from 'fflate';
import { POST } from '../app/api/consulting-flow/[caseId]/route';
import { POST as run } from '../app/api/consulting-flow/[caseId]/run/route';
import { GET as download } from '../app/api/consulting-flow/[caseId]/files/[fileId]/route';
import { newConsultingFlow, type ConsultingFlow } from '../lib/consulting-flow';
import { writePortalState } from '../lib/portal-state';
import { commitFlow, readFlow } from '../lib/consulting-flow-store';
import { readTranscriptFile } from '../lib/transcript-reader';

const email = 'transcript@example.invalid';
const permission = {
  ownCases: true,
  fileUpload: true,
  sharedSchedule: true,
  quoteContract: true,
  collaborationApply: true,
};
function request(path: string, form?: FormData, user = email) {
  return new Request(`http://localhost${path}`, {
    method: form ? 'POST' : 'GET',
    body: form,
    headers: {
      origin: 'http://localhost',
      'oai-authenticated-user-id': user,
      'oai-authenticated-user-email': user,
    },
  });
}
let sequence = 0;
function payload(
  flow: ConsultingFlow,
  cmd: Record<string, unknown>,
  file?: File,
  audio?: File,
  id = `transcript-command-${++sequence}`,
) {
  const form = new FormData();
  form.set(
    'payload',
    JSON.stringify({ revision: flow.revision, commandId: id, command: cmd }),
  );
  if (file) form.set('file', file);
  if (audio) form.set('audio', audio);
  return form;
}
void test('DOCX review -> private files -> one mocked fourth report; audio-only waits, permissions and errors stay enforced', async () => {
  const caseId = 'transcript-case';
  const context = { params: Promise.resolve({ caseId }) };
  await writePortalState({
    version: 1,
    consultationNumber: 0,
    timeline: [],
    schedule: [],
    tasks: [],
    companyDocuments: [],
    diagnosisAssessments: [],
    members: [
      {
        id: 'transcript-partner',
        name: '가상 담당자',
        email,
        status: '활성',
        permissions: permission,
      },
      {
        id: 'another-partner',
        name: '가상 다른담당자',
        email: 'other@example.invalid',
        status: '활성',
        permissions: permission,
      },
      {
        id: 'no-upload',
        name: '가상 첨부제한',
        email: 'limited@example.invalid',
        status: '활성',
        permissions: { ...permission, fileUpload: false },
      },
    ],
    cases: [
      {
        id: caseId,
        company: '가상 문서테스트기업',
        trainee: '가상 담당자',
        stage: '상담',
        consultationCount: 1,
      },
    ],
  });
  const before = newConsultingFlow(
    caseId,
    '가상 문서테스트기업',
    'transcript-partner',
    '가상 담당자',
  );
  let flow: ConsultingFlow = {
    ...before,
    revision: 1,
    updatedAt: '2026-08-30T00:00:00Z',
    reports: [
      {
        id: 'first-report',
        stage: 1,
        version: 1,
        title: '가상 1차 보고서',
        body: '가상 재무자료를 추가로 확인해야 하는 내부 검토 초안입니다. '.repeat(
          8,
        ),
        createdAt: '2026-08-01T00:00:00Z',
        createdBy: 'test',
        origin: 'manual',
      },
    ],
    meetings: [
      {
        id: 'meeting',
        kind: 'first',
        startsAt: '2026-08-01T00:00:00Z',
        endsAt: '2026-08-01T01:00:00Z',
        location: '가상',
        attendance: 'both',
        status: 'completed',
        note: '',
        createdBy: 'test',
        completedAt: '2026-08-01T01:00:00Z',
      },
    ],
    ai: {
      enabled: true,
      sourceText: '',
      approvedBy: 'owner',
      approvedAt: '2026-08-30T00:00:00Z',
    },
  };
  await commitFlow(before, flow);
  const original =
    '화자 A: 가상 기업의 자본금 및 매출에 대한 내용을 상담하였습니다. 화자 B: 세부 금액은 추가 확인이 필요합니다.';
  const file = new File(
    [
      zipSync({
        '[Content_Types].xml': strToU8('<Types/>'),
        'word/document.xml': strToU8(
          `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${original}</w:t></w:r></w:p></w:body></w:document>`,
        ),
      }) as Uint8Array<ArrayBuffer>,
    ],
    'sample.docx',
  );
  const extracted = await readTranscriptFile(file);
  const reviewed = `${extracted}\n사용자 보완: 숫자는 증빙 확인 전 확정하지 않습니다.`;
  const audio = new File(
    [
      new Uint8Array([
        0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0,
        0, 0x4d, 0x34, 0x41, 0x20,
      ]),
    ],
    'original.m4a',
    { type: 'audio/mp4' },
  );
  const cmd = {
    type: 'save_recording',
    meetingId: 'meeting',
    transcript: reviewed,
    recordingConsent: true,
    privacyMasked: true,
    fileConsent: true,
    transcriptReviewed: true,
  };
  const post = (form: FormData, user = email) =>
    POST(request(`/api/consulting-flow/${caseId}`, form, user), context);
  const unreviewed = await post(
    payload(flow, { ...cmd, transcriptReviewed: false }, file, audio),
  );
  assert.equal(unreviewed.status, 400, await unreviewed.text());
  assert.equal(
    (await post(payload(flow, { ...cmd, transcript: '' }, file))).status,
    400,
  );
  assert.equal(
    (
      await post(
        payload(flow, { ...cmd, transcript: '가'.repeat(60001) }, file),
      )
    ).status,
    400,
  );
  assert.equal(
    (await post(payload(flow, cmd, file, audio), 'other@example.invalid'))
      .status,
    403,
  );
  assert.equal(
    (await post(payload(flow, cmd, file, new File(['x'], 'not-audio.pdf'))))
      .status,
    400,
  );
  assert.equal(
    (
      await post(
        payload(
          flow,
          { ...cmd, type: 'save_report', stage: 1 },
          undefined,
          audio,
        ),
      )
    ).status,
    400,
  );
  const duplicateFiles = payload(flow, cmd, file);
  duplicateFiles.append('file', file);
  assert.equal((await post(duplicateFiles)).status, 400);
  assert.equal((await readFlow(caseId))!.recordings.length, 0);

  const saved = await post(payload(flow, cmd, file, audio, 'same-request-id'));
  assert.equal(saved.status, 200);
  flow = ((await saved.json()) as { flow: ConsultingFlow }).flow;
  assert.equal(flow.files.length, 2);
  assert.ok(flow.files.every((f) => f.key === ''));
  assert.equal(flow.recordings[0].transcript, reviewed);
  assert.ok(flow.recordings[0].transcriptReviewedAt);
  const same = await post(payload(flow, cmd, file, audio, 'same-request-id'));
  assert.equal(same.status, 200);
  assert.equal(
    ((await same.json()) as { flow: ConsultingFlow }).flow.files.length,
    2,
  );
  assert.equal((await post(payload(flow, cmd, file, audio))).status, 409);
  for (const stored of flow.files) {
    const ctx = { params: Promise.resolve({ caseId, fileId: stored.id }) };
    assert.equal(
      (
        await download(
          request(`/api/consulting-flow/${caseId}/files/${stored.id}`),
          ctx,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await download(
          request(
            `/api/consulting-flow/${caseId}/files/${stored.id}`,
            undefined,
            'other@example.invalid',
          ),
          ctx,
        )
      ).status,
      403,
    );
  }
  const runtime = env as unknown as Record<string, unknown>;
  const previousKey = runtime.ANTHROPIC_API_KEY;
  const previousFetch = globalThis.fetch;
  let calls = 0;
  runtime.ANTHROPIC_API_KEY = 'local-mock-not-a-real-key';
  globalThis.fetch = async (input, options) => {
    calls++;
    assert.equal(input, 'https://api.anthropic.com/v1/messages');
    assert.ok(typeof options?.body === 'string');
    const body = JSON.parse(options.body);
    const content = JSON.stringify(body.messages[0].content);
    assert.ok(content.includes('사용자 보완'));
    assert.ok(!content.includes('FAKE_AUDIO_PRIVATE_BYTES'));
    assert.ok(!content.includes('base64'));
    return Response.json({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text:
            '가상 내부 심화보고서입니다. 확인할 사실과 미확인 수치를 분리합니다. '.repeat(
              15,
            ) + '[분석 끝]',
        },
      ],
    });
  };
  try {
    const response = await run(
      new Request(`http://localhost/api/consulting-flow/${caseId}/run`, {
        method: 'POST',
        headers: request('/').headers,
      }),
      context,
    );
    assert.equal(response.status, 200);
    flow = ((await response.json()) as { flow: ConsultingFlow }).flow;
    assert.equal(flow.reports.filter((r) => r.stage === 4).length, 1);
    await run(
      new Request(`http://localhost/api/consulting-flow/${caseId}/run`, {
        method: 'POST',
        headers: request('/').headers,
      }),
      context,
    );
    assert.equal(calls, 1);
    const waiting = await post(
      payload(
        flow,
        { ...cmd, transcript: '', transcriptReviewed: false },
        undefined,
        audio,
      ),
    );
    assert.equal(waiting.status, 200);
    flow = ((await waiting.json()) as { flow: ConsultingFlow }).flow;
    assert.equal(flow.jobs.at(-1)?.status, 'blocked');
    await run(
      new Request(`http://localhost/api/consulting-flow/${caseId}/run`, {
        method: 'POST',
        headers: request('/').headers,
      }),
      context,
    );
    assert.equal(calls, 1, 'Audio-only never calls a model');
    const supplement = await post(
      payload(
        flow,
        {
          ...cmd,
          type: 'save_transcript',
          recordingId: flow.recordings.at(-1)!.id,
          transcript: reviewed + ' 후속 확인.',
        },
        file,
      ),
    );
    assert.equal(supplement.status, 200);
    const updated = ((await supplement.json()) as { flow: ConsultingFlow })
      .flow;
    assert.ok(updated.recordings.at(-1)?.transcriptFileId);
    assert.ok(updated.recordings.at(-1)?.audioFileId);
    assert.equal(updated.jobs.at(-1)?.status, 'queued');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete runtime.ANTHROPIC_API_KEY;
    else runtime.ANTHROPIC_API_KEY = previousKey;
  }
});
