import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  directFlowUpload,
  requestFileTransfer,
} from '../lib/file-transfer-client.ts';
import { describeFlowTransfer } from '../lib/file-transfer-contract.ts';

export const nextTransferCaseId = 'synthetic-next-transfer-flow';

// Exercise the shipped browser transport functions with actual Next issuance,
// independent password sessions and the separate local byte-owning gateway.
export async function runNextFlowTransferChecks({
  baseUrl,
  request,
  jsonPost,
  partnerCookie,
  adminCookie,
  inventoryOnly = false,
}) {
  const path = `/api/consulting-flow/${nextTransferCaseId}`;
  let flow = (
    await (await request(path, { headers: { cookie: adminCookie } })).json()
  ).flow;
  assert.equal(flow.revision, 0);
  const originalFetch = globalThis.fetch;
  const originalLocation = Object.getOwnPropertyDescriptor(
    globalThis,
    'location',
  );
  let metadataRequests = 0;
  let byteRequests = 0;
  let largestMetadata = 0;
  let verifiedMutations = 0;
  async function asBrowser(cookie, action) {
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: new URL(baseUrl),
    });
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input, baseUrl);
      const headers = new Headers(options.headers);
      headers.set('origin', baseUrl);
      if (url.origin === baseUrl) {
        headers.set('cookie', cookie);
        assert.equal(url.pathname, '/api/file-transfers');
        assert.equal(typeof options.body, 'string');
        largestMetadata = Math.max(
          largestMetadata,
          Buffer.byteLength(options.body),
        );
        assert.ok(Buffer.byteLength(options.body) < 1024 * 1024);
        metadataRequests++;
      } else {
        assert.equal(options.credentials, 'omit');
        assert.equal(options.redirect, 'error');
        assert.equal(url.hostname, '127.0.0.1');
        assert.equal(url.search, '');
        assert.equal(headers.has('cookie'), false);
        byteRequests++;
      }
      return originalFetch(url, { ...options, headers });
    };
    try {
      return await action();
    } finally {
      globalThis.fetch = originalFetch;
      if (originalLocation)
        Object.defineProperty(globalThis, 'location', originalLocation);
      else delete globalThis.location;
    }
  }
  function form(
    command,
    file,
    audio,
    revision = flow.revision,
    commandId = randomUUID(),
  ) {
    const body = new FormData();
    body.set(
      'payload',
      JSON.stringify({
        commandId,
        revision,
        command: { ...command, fileConsent: true },
      }),
    );
    if (file) body.set('file', file);
    if (audio) body.set('audio', audio);
    return body;
  }
  async function accept(response) {
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    assert.ok(result.flow);
    flow = result.flow;
    assert.ok(flow.files.every((file) => file.key === ''));
    verifiedMutations++;
    if (verifiedMutations % 4 === 0)
      console.log(
        `PASS Next FLOW progress: ${verifiedMutations} mutations/replays verified.`,
      );
    return result;
  }
  const upload = (body, cookie = adminCookie) =>
    asBrowser(cookie, () => directFlowUpload(nextTransferCaseId, body));
  const command = (value, cookie = adminCookie) =>
    jsonPost(
      path,
      { commandId: randomUUID(), revision: flow.revision, command: value },
      cookie,
    ).then(accept);
  const issue = async (body, cookie = adminCookie) =>
    jsonPost(
      '/api/file-transfers',
      {
        ...(await describeFlowTransfer(nextTransferCaseId, body)),
        payload: body.get('payload'),
      },
      cookie,
    );
  const pdfBytes = new TextEncoder().encode(
    '%PDF-1.4\n' + 'Synthetic FLOW fixture. '.repeat(240000) + '\n%%EOF',
  );
  assert.ok(pdfBytes.length > 4.5 * 1024 * 1024);
  const pdf = new File([pdfBytes], '합성 검증.pdf', {
    type: 'application/pdf',
  });
  const source = form({ type: 'save_source', privacyMasked: true }, pdf);
  assert.equal((await issue(source, partnerCookie)).status, 403);
  const sourcePayload = source.get('payload');
  assert.ok(typeof sourcePayload === 'string');
  const mismatched = {
    ...(await describeFlowTransfer(nextTransferCaseId, source)),
    payload: sourcePayload + ' ',
  };
  assert.equal(
    (await jsonPost('/api/file-transfers', mismatched, adminCookie)).status,
    400,
  );
  await accept(await upload(source));
  if (inventoryOnly) {
    await checkInventory();
    console.log(
      'PASS focused Next inventory run with completed company and FLOW originals.',
    );
    return;
  }
  const report = form({ type: 'save_report', stage: 1 }, pdf);
  await accept(await upload(report));
  const reportId = flow.reports.at(-1).id;
  await command({ type: 'confirm_analysis', reportId });
  await command({ type: 'confirm_analysis', reportId }, partnerCookie);
  await command({
    type: 'book_meeting',
    kind: 'first',
    attendance: 'both',
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2026-01-01T01:00:00.000Z',
    location: '합성 상담실',
  });
  const meetingId = flow.meetings.at(-1).id;
  await accept(await upload(form({ type: 'save_report', stage: 2 }, pdf)));
  assert.equal(
    (
      await issue(
        form(
          { type: 'save_report', stage: 3 },
          new File(['synthetic'], 'unsupported.txt', { type: 'text/plain' }),
        ),
      )
    ).status,
    400,
  );
  await accept(await upload(form({ type: 'save_report', stage: 3 }, pdf)));
  await command({ type: 'complete_meeting', meetingId });
  // Completed receipts must remain retryable when the stage/revision now forbids
  // a new stage-one report. The Worker, not issuance, decides exact-byte replay.
  const replay = await accept(await upload(report));
  assert.equal(replay.duplicate, true);
  const newStale = form(
    { type: 'save_source', privacyMasked: true },
    pdf,
    undefined,
    0,
  );
  assert.equal((await issue(newStale)).status, 409);
  const transcript =
    '합성 기업 상담 전사 내용이며 실제 고객 정보와 식별번호는 없습니다. '
      .repeat(1000)
      .trim();
  const audioBytes = new Uint8Array(6 * 1024 * 1024);
  audioBytes.set(new TextEncoder().encode('RIFF0000WAVE'));
  const recording = form(
    {
      type: 'save_recording',
      meetingId,
      recordingConsent: true,
      privacyMasked: true,
      transcriptReviewed: true,
      transcript,
    },
    new File([transcript], '합성 전사문.txt', { type: 'text/plain' }),
    new File([audioBytes], 'synthetic.wav', { type: 'audio/wav' }),
  );
  await accept(await upload(recording, partnerCookie));
  assert.equal(flow.recordings.at(-1).transcript, transcript);
  assert.equal(flow.jobs.at(-1).status, 'blocked');
  const recordingId = flow.recordings.at(-1).id;
  const audioId = flow.recordings.at(-1).audioFileId;
  const edited = transcript + '전사 확인 완료.';
  await accept(
    await upload(
      form(
        {
          type: 'save_transcript',
          recordingId,
          transcript: edited,
          recordingConsent: true,
          privacyMasked: true,
          transcriptReviewed: true,
        },
        new File([edited], 'updated.txt', { type: 'text/plain' }),
      ),
      partnerCookie,
    ),
  );
  await accept(await upload(form({ type: 'save_report', stage: 4 }, pdf)));
  await command({
    type: 'confirm_solutions',
    reportId: flow.reports.at(-1).id,
    reviewConfirmed: true,
    solutions: ['합성 검증 솔루션'],
    documentsNeeded: true,
    note: '합성 검증이며 실제 발송·계약 없음',
  });
  await command({
    type: 'request_document',
    title: '합성 증빙',
    required: true,
    channel: '기타',
    recipient: '합성 담당자',
  });
  const requestId = flow.requests.at(-1).id;
  await accept(
    await upload(
      form({ type: 'receive_document', requestId }, pdf),
      partnerCookie,
    ),
  );
  await command({ type: 'review_document', requestId, approved: true });
  await accept(await upload(form({ type: 'save_report', stage: 5 }, pdf)));
  await accept(await upload(form({ type: 'save_report', stage: 6 }, pdf)));
  await command({
    type: 'book_meeting',
    kind: 'contract',
    attendance: 'both',
    startsAt: '2026-01-02T00:00:00.000Z',
    endsAt: '2026-01-02T01:00:00.000Z',
    location: '합성 상담실',
  });
  await accept(
    await upload(
      form(
        {
          type: 'record_contract',
          meetingId: flow.meetings.at(-1).id,
          signedConfirmed: true,
          signedAt: '2026-01-02',
          expectedDepositWon: 1,
        },
        pdf,
      ),
      partnerCookie,
    ),
  );
  assert.ok(flow.contract.signedFileId);
  const download = await asBrowser(partnerCookie, () =>
    requestFileTransfer({
      kind: 'flow-download',
      caseId: nextTransferCaseId,
      fileId: audioId,
    }),
  );
  assert.ok(download.token.length < 2500);
  const downloaded = await originalFetch(download.url, {
    headers: { origin: baseUrl, authorization: `Bearer ${download.token}` },
  });
  assert.equal(downloaded.status, 200);
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), audioBytes);
  assert.ok(largestMetadata > 16_384 && largestMetadata < 400_000);
  assert.equal(metadataRequests, byteRequests + 1);
  console.log(
    `PASS real Next FLOW: all six upload commands, two-slot >6MiB recording, large transcript, preflight denials, late exact retry, private download; ${metadataRequests} metadata / ${byteRequests} direct uploads, no paid AI or external messages.`,
  );
  await checkInventory();
  async function checkInventory() {
    const inventoryResponse = await request(
      '/api/admin/file-inventory?status=all',
      {
        headers: { cookie: adminCookie },
      },
    );
    assert.equal(
      inventoryResponse.status,
      200,
      await inventoryResponse.clone().text(),
    );
    const inventory = await inventoryResponse.json();
    for (const source of ['company', 'flow']) {
      const item = inventory.items.find(
        (item) => item.source === source && item.integrityProof === 'sha256',
      );
      assert.ok(item, `Expected a completed ${source} original in inventory.`);
      const presencePath = `/api/admin/file-inventory/${encodeURIComponent(item.id)}/presence`;
      const response = await request(presencePath, {
        headers: { cookie: adminCookie },
      });
      assert.equal(response.status, 200, await response.clone().text());
      const presence = await response.json();
      assert.equal(presence.exists, true);
      assert.equal(presence.sizeMatches, true);
      assert.equal(presence.integrityMatches, true);
      assert.equal(presence.integrityProof, 'sha256');
      assert.equal(
        (await request(presencePath, { headers: { cookie: partnerCookie } }))
          .status,
        403,
      );
    }
    console.log(
      'PASS real Next server-side company/FLOW inventory checks preserve R2 metadata/SHA-256 and deny partner access.',
    );
  }
}
