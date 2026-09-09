import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { newConsultingFlow } from '../lib/consulting-flow.ts';
import { describeFlowTransfer } from '../lib/file-transfer-contract.ts';

// Only synthetic fixtures in the caller's ephemeral native D1/R2. No triggers
// are removed, no production data is read, and every tested upload uses Worker.
export async function runNativeFlowTransferChecks({
  db,
  bucket,
  state,
  saveState,
  grant,
  send,
  expect,
  pass,
  partner,
  admin,
}) {
  const member = state.members[0];
  const caseId = 'synthetic-native-transfer-flow';
  const reportCaseId = `${caseId}-report`;
  const now = new Date().toISOString();
  state.cases.push(
    ...[caseId, reportCaseId].map((id) => ({
      id,
      company: '합성 FLOW 기업',
      trainee: member.name,
      partnerMemberId: member.id,
    })),
  );
  await saveState();
  const seeded = newConsultingFlow(
    caseId,
    '합성 FLOW 기업',
    member.id,
    member.name,
  );
  seeded.updatedAt = now;
  seeded.reports.push({
    id: 'synthetic-prior-report',
    stage: 1,
    version: 1,
    title: '합성 1차 보고서',
    body: '합성 상담 준비용 보고서. '.repeat(10),
    createdAt: now,
    createdBy: '김성민 대표',
    origin: 'manual',
  });
  seeded.meetings.push({
    id: 'synthetic-completed-meeting',
    kind: 'first',
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2026-01-01T01:00:00.000Z',
    attendance: 'both',
    location: '합성 상담실',
    status: 'completed',
    note: '',
    createdBy: member.id,
    completedAt: '2026-01-01T01:00:00.000Z',
  });
  seeded.requests.push({
    id: 'synthetic-request',
    title: '합성 증빙',
    required: false,
    channel: '기타',
    recipient: '합성 담당자',
    dueDate: '',
    status: 'requested',
    note: '',
    createdAt: now,
  });
  await db
    .prepare(
      'INSERT INTO consulting_flows (case_id, partner_id, revision, payload, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)',
    )
    .bind(caseId, member.id, 0, JSON.stringify(seeded), now)
    .run();
  const read = async () =>
    JSON.parse(
      (
        await db
          .prepare('SELECT payload FROM consulting_flows WHERE case_id=?1')
          .bind(caseId)
          .first()
      ).payload,
    );
  const count = async () =>
    (
      await db
        .prepare(
          'SELECT COUNT(*) AS n FROM consulting_flow_upload_requests WHERE case_id=?1',
        )
        .bind(caseId)
        .first()
    ).n;
  const form = (
    command,
    file,
    audio,
    revision = 0,
    commandId = randomUUID(),
  ) => {
    const result = new FormData();
    result.set(
      'payload',
      JSON.stringify({
        commandId,
        revision,
        command: { ...command, fileConsent: true },
      }),
    );
    if (file) result.set('file', file);
    if (audio) result.set('audio', audio);
    return result;
  };
  const upload = async (body, who = partner, target = caseId) =>
    send(await grant(await describeFlowTransfer(target, body), who), body);
  const smallPdf = new File(
    ['%PDF-1.4\nSynthetic FLOW fixture\n%%EOF'],
    '합성 근거.pdf',
    { type: 'application/pdf' },
  );
  const source = form({ type: 'save_source', privacyMasked: true }, smallPdf);
  await expect(
    await upload(source),
    403,
    'FLOW native partner cannot upload administrator-only source',
  );
  assert.equal(await count(), 0);
  await expect(
    await upload(source, admin),
    200,
    'FLOW native independent admin source upload preserves business authority',
  );
  const report = form({ type: 'save_report', stage: 1 }, smallPdf);
  await expect(
    await upload(report, admin, reportCaseId),
    200,
    'FLOW native report attachment commits with original audit and receipt',
  );

  const textBytes = new Uint8Array(5 * 1024 * 1024).fill(83);
  const audioBytes = new Uint8Array(25 * 1024 * 1024);
  audioBytes.set(new TextEncoder().encode('RIFF0000WAVE'));
  const transcript =
    '합성 기업의 상담 기록이며 개인정보와 실제 고객 자료는 포함하지 않습니다. '
      .repeat(1000)
      .trim();
  const recording = form(
    {
      type: 'save_recording',
      meetingId: seeded.meetings[0].id,
      recordingConsent: true,
      privacyMasked: true,
      transcriptReviewed: true,
      transcript,
    },
    new File([textBytes], '합성 전사문.txt', { type: 'text/plain' }),
    new File([audioBytes], 'synthetic.wav', { type: 'audio/wav' }),
    (await read()).revision,
  );
  const recordingIntent = await describeFlowTransfer(caseId, recording);
  const ticket = await grant(recordingIntent, partner);
  assert.ok(ticket.token.length < 2500);
  const response = await expect(
    await send(ticket, recording),
    200,
    'FLOW native 5MiB transcript + 25MiB audio commit atomically with large text outside ticket',
  );
  const saved = (await response.json()).flow;
  assert.equal(saved.recordings.at(-1).transcript, transcript);
  assert.equal(saved.files.length, 3);
  assert.ok(saved.files.every((file) => file.key === ''));
  const canonical = await read();
  const recordingId = canonical.recordings.at(-1).id;
  assert.equal(canonical.jobs.at(-1).status, 'blocked');
  const before = await count();
  for (const [id, bytes] of [
    [canonical.recordings.at(-1).transcriptFileId, textBytes],
    [canonical.recordings.at(-1).audioFileId, audioBytes],
  ]) {
    const download = await send(
      await grant({ kind: 'flow-download', caseId, fileId: id }, partner),
    );
    assert.equal(download.status, 200);
    assert.ok(
      download.headers.get('content-disposition').startsWith('attachment;'),
    );
    assert.equal(
      createHash('sha256')
        .update(new Uint8Array(await download.arrayBuffer()))
        .digest('hex'),
      createHash('sha256').update(bytes).digest('hex'),
    );
  }
  pass('FLOW native both private originals download with complete checksums');
  const duplicate = await expect(
    await send(ticket, recording),
    200,
    'FLOW native exact two-slot replay retains both IDs and one receipt',
  );
  assert.equal((await duplicate.json()).duplicate, true);
  assert.equal(await count(), before);
  assert.equal((await read()).revision, canonical.revision);
  const recordingPayload = recording.get('payload');
  assert.ok(typeof recordingPayload === 'string');
  const changedPayload = recordingPayload.replace('합성 기업의', '변경 기업의');
  const changed = new FormData();
  for (const [key, value] of recording)
    changed.set(key, key === 'payload' ? changedPayload : value);
  await expect(
    await send(ticket, changed),
    403,
    'FLOW native altered transcript cannot reuse issued grant',
  );
  await expect(
    await upload(changed),
    409,
    'FLOW native newly-issued grant cannot overwrite durable command receipt',
  );
  const differentSlot = new FormData();
  for (const [key, value] of recording)
    differentSlot.set(
      key,
      key === 'audio'
        ? new File(['RIFF0000WAVEchanged'], 'synthetic.wav', {
            type: 'audio/wav',
          })
        : value,
    );
  await expect(
    await send(ticket, differentSlot),
    403,
    'FLOW native changed auxiliary audio denied before reservation',
  );
  assert.equal(await count(), before);

  const editedTranscript = transcript + '확인 완료.';
  const edit = form(
    {
      type: 'save_transcript',
      recordingId,
      transcript: editedTranscript,
      recordingConsent: true,
      privacyMasked: true,
      transcriptReviewed: true,
    },
    new File([editedTranscript], 'updated.txt', { type: 'text/plain' }),
    undefined,
    canonical.revision,
  );
  await expect(
    await upload(edit),
    200,
    'FLOW native transcript replacement binds latest recording and advances one revision',
  );
  const lateRetry = await expect(
    await send(ticket, recording),
    200,
    'FLOW native exact replay still works after later revisions',
  );
  assert.equal((await lateRetry.json()).duplicate, true);
  const receive = form(
    { type: 'receive_document', requestId: 'synthetic-request' },
    smallPdf,
    undefined,
    (await read()).revision,
  );
  const receiveTicket = await grant(
    await describeFlowTransfer(caseId, receive),
    partner,
  );
  member.permissions.fileUpload = false;
  await saveState();
  await expect(
    await send(receiveTicket, receive),
    403,
    'FLOW native upload permission revocation invalidates issued grant',
  );
  member.permissions.fileUpload = true;
  await saveState();
  await expect(
    await send(receiveTicket, receive),
    200,
    'FLOW native requested-document receipt succeeds after authorized retry',
  );
  const privateFile = (await read()).files.at(-1);
  const privateTicket = await grant(
    { kind: 'flow-download', caseId, fileId: privateFile.id },
    partner,
  );
  await expect(
    await send(
      await grant(
        { kind: 'flow-download', caseId: reportCaseId, fileId: privateFile.id },
        partner,
      ),
    ),
    404,
    'FLOW native file grant cannot cross case boundary',
  );
  member.status = '정지';
  await saveState();
  await expect(
    await send(privateTicket),
    403,
    'FLOW native account suspension invalidates private download',
  );
  member.status = '활성';
  await saveState();
  await bucket.put(privateFile.key, 'altered original', {
    httpMetadata: { contentType: privateFile.contentType },
  });
  await expect(
    await send(privateTicket),
    409,
    'FLOW native changed R2 original rejected by immutable ledger',
  );
}
