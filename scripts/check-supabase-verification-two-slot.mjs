import './register-local.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, open } from 'node:fs/promises';
import path from 'node:path';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { readVerificationFile } from './supabase-verification.mjs';
import { verificationError } from './supabase-verification-policy.mjs';

// Targeted live follow-up: one new synthetic consultation, text + audio slots.
// Requires the bounded preview; never reruns the completed contract workflow.
async function main(args) {
  if (args.length !== 2 || args[0] !== '--config')
    throw verificationError('ARGUMENTS');
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0')
    throw verificationError('TLS_DISABLED');
  const settings = await readVerificationFile(args[1]);
  const completed = JSON.parse(
    await readFile(path.join(settings.directory, 'status.json'), 'utf8'),
  );
  if (completed.status !== 'passed' || !completed.httpWorkflowVerified)
    throw verificationError('HTTP_WORKFLOW_REQUIRED');
  const accounts = JSON.parse(
    await readFile(
      path.join(settings.directory, `accounts-${completed.runId}.json`),
      'utf8',
    ),
  );
  if (accounts.projectRef !== settings.target.projectRef)
    throw verificationError('ACCOUNT_TARGET_MISMATCH');
  const resultFile = path.join(settings.directory, 'two-slot-status.json');
  const claim = await open(resultFile, 'wx', 0o600);
  await claim.close();
  const originalTrust = getCACertificates('default');
  const origin = settings.target.appOrigin;
  const caseId = `verification-two-slot-${randomUUID()}`;
  let phase = 'authentication',
    checks = 0;
  const save = (value) =>
    writeFile(
      resultFile,
      JSON.stringify({
        at: new Date().toISOString(),
        caseId,
        phase,
        checks,
        ...value,
      }) + '\n',
      { mode: 0o600 },
    );
  const check = (value) => {
    if (!value) throw verificationError(`TWO_SLOT_${phase.toUpperCase()}`);
    checks++;
  };
  const request = (endpoint, options = {}) => {
    const url = new URL(endpoint, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/api/'))
      throw verificationError('DESTINATION');
    return fetch(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(120000),
    });
  };
  const expect = async (response, status = 200) => {
    check(response.status === status);
    return response;
  };
  const send = (endpoint, value, cookie, extra = {}) =>
    request(endpoint, {
      method: 'POST',
      ...extra,
      headers: {
        origin,
        cookie,
        'content-type': 'application/json',
        ...extra.headers,
      },
      body: JSON.stringify(value),
    });
  const progress = async (next) => {
    phase = next;
    await save({ status: 'running', syntheticOnly: true });
    console.log(JSON.stringify({ phase, checks }));
  };
  try {
    await save({ status: 'running', syntheticOnly: true });
    const cert = await readFile(
      path.join(settings.directory, 'localhost-cert.pem'),
      'utf8',
    );
    setDefaultCACertificates([...originalTrust, cert]);
    const { describeFlowTransfer } =
      await import('../lib/file-transfer-contract.ts');
    const { parseSupabaseTransferGrant } =
      await import('../lib/file-transfer-client.supabase.ts');
    const login = async (email, password) => {
      const response = await expect(
        await send('/api/auth/login', { email, password }, ''),
      );
      const header = response.headers.get('set-cookie');
      check(
        /^__Host-keve_session=[a-f0-9]{64};/.test(header ?? '') &&
          header.includes('Secure'),
      );
      return header.split(';')[0];
    };
    const admin = await login(accounts.adminEmail, accounts.adminPassword);
    const partner = await login(
      accounts.partners[0].email,
      accounts.partners[0].password,
    );
    const snapshot = await (
      await expect(await request('/api/state', { headers: { cookie: admin } }))
    ).json();
    const member = snapshot.state.members.find(
      (m) => m.email === accounts.partners[0].email,
    );
    check(Boolean(member) && snapshot.currentUser.role === 'admin');
    await expect(
      await send(
        '/api/state',
        {
          expectedUserId: snapshot.currentUser.id,
          state: {
            ...snapshot.state,
            cases: [
              ...snapshot.state.cases,
              {
                id: caseId,
                company: '합성 2슬롯 파일 검증 - 실제 고객 아님',
                trainee: member.name,
                partnerMemberId: member.id,
                stage: '접수',
                consultationCount: 0,
              },
            ],
          },
        },
        admin,
        { method: 'PUT', headers: { 'if-match': snapshot.stateRevision } },
      ),
    );
    const endpoint = `/api/consulting-flow/${caseId}`;
    const readFlow = async () =>
      (
        await (
          await expect(
            await request(endpoint, { headers: { cookie: partner } }),
          )
        ).json()
      ).flow;
    let flow = await readFlow();
    const accept = async (response) => {
      const value = await (await expect(response)).json();
      check(
        Boolean(value.flow) &&
          value.flow.files.every((file) => file.key === ''),
      );
      flow = value.flow;
      return value;
    };
    // Await the response explicitly; unknown writes are never replayed.
    async function command(value, cookie = admin) {
      return accept(
        await send(
          endpoint,
          { commandId: randomUUID(), revision: flow.revision, command: value },
          cookie,
        ),
      );
    }
    const prepare = async (value, files, cookie) => {
      const form = new FormData();
      form.set(
        'payload',
        JSON.stringify({
          commandId: randomUUID(),
          revision: flow.revision,
          command: { ...value, fileConsent: true },
        }),
      );
      for (const [slot, file] of Object.entries(files)) form.set(slot, file);
      const intent = await describeFlowTransfer(caseId, form);
      const response = await expect(
        await send(
          '/api/blob-transfers',
          {
            action: 'prepare',
            intent: { ...intent, payload: form.get('payload') },
          },
          cookie,
        ),
      );
      const grant = parseSupabaseTransferGrant(
        await response.json(),
        Object.keys(files),
      );
      for (const slot of Object.keys(files)) {
        const url = new URL(grant.uploads[slot].url);
        check(
          url.origin === settings.config.supabaseUrl &&
            url.pathname.startsWith(
              `/storage/v1/object/upload/sign/${settings.target.storageBucket}/`,
            ),
        );
      }
      return grant;
    };
    const stage = async (grant, slot, file) =>
      expect(
        await fetch(grant.uploads[slot].url, {
          method: 'PUT',
          body: file,
          headers: grant.uploads[slot].headers,
          credentials: 'omit',
          redirect: 'error',
          signal: AbortSignal.timeout(120000),
        }),
      );
    const finish = (grant, cookie) =>
      send('/api/blob-transfers', { action: 'finish', id: grant.id }, cookie);
    await progress('consultation');
    const text =
      '가상 2슬롯 전송 검사입니다. 실제 고객 정보 없이 상담 문서와 무음 음성의 보관을 확인합니다. '.repeat(
        20,
      );
    await command({
      type: 'save_source',
      sourceText: text,
      privacyMasked: true,
    });
    await command({ type: 'save_report', stage: 1, body: text });
    await command({
      type: 'confirm_analysis',
      reportId: flow.reports.at(-1).id,
    });
    await command(
      { type: 'confirm_analysis', reportId: flow.reports.at(-1).id },
      partner,
    );
    const date = new Date().toISOString().slice(0, 10);
    await command({
      type: 'book_meeting',
      kind: 'first',
      attendance: 'both',
      startsAt: `${date}T00:00:00.000Z`,
      endsAt: `${date}T01:00:00.000Z`,
      location: '합성 검증 상담실',
    });
    await command({ type: 'save_report', stage: 2, body: text });
    const pdf = new File(
      ['%PDF-1.4\nSynthetic verification only.\n%%EOF'],
      'synthetic.pdf',
      { type: 'application/pdf' },
    );
    const reportGrant = await prepare(
      { type: 'save_report', stage: 3 },
      { file: pdf },
      admin,
    );
    await stage(reportGrant, 'file', pdf);
    await accept(await finish(reportGrant, admin));
    await command({
      type: 'complete_meeting',
      meetingId: flow.meetings.at(-1).id,
    });
    await progress('two_slot');
    const fileBytes = new Uint8Array(5 * 1024 * 1024).fill(83);
    const audioBytes = new Uint8Array(25 * 1024 * 1024);
    const wave = new DataView(audioBytes.buffer);
    audioBytes.set(new TextEncoder().encode('RIFF'), 0);
    wave.setUint32(4, audioBytes.length - 8, true);
    audioBytes.set(new TextEncoder().encode('WAVEfmt '), 8);
    wave.setUint32(16, 16, true);
    wave.setUint16(20, 1, true);
    wave.setUint16(22, 1, true);
    wave.setUint32(24, 16000, true);
    wave.setUint32(28, 32000, true);
    wave.setUint16(32, 2, true);
    wave.setUint16(34, 16, true);
    audioBytes.set(new TextEncoder().encode('data'), 36);
    wave.setUint32(40, audioBytes.length - 44, true);
    const files = {
      file: new File([fileBytes], 'synthetic-transcript.txt', {
        type: 'text/plain',
      }),
      audio: new File([audioBytes], 'synthetic-silence.wav', {
        type: 'audio/wav',
      }),
    };
    const grant = await prepare(
      {
        type: 'save_recording',
        meetingId: flow.meetings.at(-1).id,
        recordingConsent: true,
        privacyMasked: true,
        transcriptReviewed: true,
        transcript: text,
      },
      files,
      partner,
    );
    check(grant.uploads.file.path !== grant.uploads.audio.path);
    const beforeRevision = flow.revision,
      beforeFiles = flow.files.length;
    await stage(grant, 'file', files.file);
    await expect(await finish(grant, partner), 409);
    const partial = await readFlow();
    check(
      partial.revision === beforeRevision &&
        partial.files.length === beforeFiles,
    );
    await stage(grant, 'audio', files.audio);
    await accept(await finish(grant, partner));
    check(
      flow.revision === beforeRevision + 1 &&
        flow.files.length === beforeFiles + 2,
    );
    const savedRevision = flow.revision;
    const duplicate = await accept(await finish(grant, partner));
    check(duplicate.duplicate === true && flow.revision === savedRevision);
    await progress('download_hashes');
    const recording = flow.recordings.at(-1);
    for (const [id, original] of [
      [recording.transcriptFileId, fileBytes],
      [recording.audioFileId, audioBytes],
    ]) {
      check(typeof id === 'string');
      const response = await expect(
        await request(`${endpoint}/files/${id}`, {
          headers: { cookie: partner },
        }),
      );
      const downloaded = new Uint8Array(await response.arrayBuffer());
      check(
        downloaded.length === original.length &&
          createHash('sha256').update(downloaded).digest('hex') ===
            createHash('sha256').update(original).digest('hex'),
      );
    }
    check(
      flow.jobs.every(
        (job) => !['processing', 'completed', 'running'].includes(job.status),
      ),
    );
    await expect(await send('/api/auth/logout', {}, partner));
    await expect(await send('/api/auth/logout', {}, admin));
    const result = {
      status: 'passed',
      checks,
      caseId,
      textBytes: fileBytes.length,
      audioBytes: audioBytes.length,
      partialCommitBlocked: true,
      duplicateCommitBlocked: true,
      bothDownloadHashesMatch: true,
      syntheticOnly: true,
    };
    await save(result);
    console.log(JSON.stringify(result));
  } catch (error) {
    const code =
      error.verificationCode ?? 'OPERATION_FAILED_OR_OUTCOME_UNKNOWN';
    await save({ status: 'failed', code });
    throw verificationError(code);
  } finally {
    setDefaultCACertificates(originalTrust);
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(
    `Two-slot verification stopped: ${error.verificationCode ?? 'PREVIOUS_RUN_OR_OPERATION_FAILED'}`,
  );
  process.exitCode = 1;
});
