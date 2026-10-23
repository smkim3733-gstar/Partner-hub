import { randomUUID, createHash } from 'node:crypto';
import { verificationError } from './supabase-verification-policy.mjs';

// Real HTTP only: no test-loader bindings, mocked database or provider bypass.
// All accounts, company names, documents, payments and contracts are synthetic.
export async function verifyLiveWorkflow(settings, accounts, record) {
  const { parseSupabaseTransferGrant } =
    await import('../lib/file-transfer-client.supabase.ts');
  const { describeFlowTransfer } =
    await import('../lib/file-transfer-contract.ts');
  const { defaultPartnerPermissions } =
    await import('../lib/partner-registration.ts');
  const origin = settings.target.appOrigin;
  let phase = 'authentication';
  let checks = 0;
  const check = (condition) => {
    if (!condition) throw verificationError(`FLOW_${phase.toUpperCase()}`);
    checks++;
  };
  const request = (endpoint, options = {}) => {
    const url = new URL(endpoint, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/api/'))
      throw verificationError('FLOW_DESTINATION');
    return fetch(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(120000),
    });
  };
  async function expect(response, status = 200) {
    // Error bodies may include provider details: do not log them.
    check(response.status === status);
    return response;
  }
  const send = (endpoint, body, cookie, extra = {}) =>
    request(endpoint, {
      method: 'POST',
      ...extra,
      headers: {
        'content-type': 'application/json',
        origin,
        ...(cookie ? { cookie } : {}),
        ...extra.headers,
      },
      body: JSON.stringify(body),
    });
  async function login(email, password) {
    const response = await expect(
      await send('/api/auth/login', { email, password }),
    );
    const header = response.headers.get('set-cookie');
    check(
      /^__Host-keve_session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict;/.test(
        header ?? '',
      ),
    );
    check(header.includes('Secure') && !/domain=/i.test(header));
    return header.split(';')[0];
  }
  const readState = async (cookie) =>
    (await expect(await request('/api/state', { headers: { cookie } }))).json();
  async function saveState(snapshot, state, cookie) {
    return expect(
      await send(
        '/api/state',
        { state, expectedUserId: snapshot.currentUser.id },
        cookie,
        {
          method: 'PUT',
          headers: { 'if-match': snapshot.stateRevision },
        },
      ),
    );
  }
  await expect(await request('/api/state'), 401);
  const adminCookie = await login(accounts.adminEmail, accounts.adminPassword);
  const secondAdminCookie = await login(
    accounts.adminEmail,
    accounts.adminPassword,
  );
  check(adminCookie !== secondAdminCookie);
  for (const partner of accounts.partners) {
    await expect(
      await send('/api/auth/register', {
        name: partner.name,
        phone: '010-0000-0000',
        affiliation: '합성 검증 전용',
        email: partner.email,
        password: partner.password,
        consent: true,
      }),
      201,
    );
  }
  let snapshot = await readState(adminCookie);
  check(snapshot.currentUser.role === 'admin');
  const member = snapshot.state.members.find(
    (item) => item.email === accounts.partners[0].email,
  );
  check(Boolean(member));
  const caseId = `verification-${accounts.runId}`;
  await saveState(
    snapshot,
    {
      ...snapshot.state,
      members: snapshot.state.members.map((item) =>
        accounts.partners.some((p) => p.email === item.email)
          ? {
              ...item,
              status: '활성',
              permissions: { ...defaultPartnerPermissions },
            }
          : item,
      ),
      cases: [
        ...snapshot.state.cases,
        {
          id: caseId,
          company: '합성 검증기업 - 실제 고객 아님',
          trainee: member.name,
          partnerMemberId: member.id,
          stage: '접수',
          consultationCount: 0,
        },
      ],
    },
    adminCookie,
  );
  const partnerCookie = await login(
    accounts.partners[0].email,
    accounts.partners[0].password,
  );
  const outsiderCookie = await login(
    accounts.partners[1].email,
    accounts.partners[1].password,
  );
  check((await readState(partnerCookie)).currentUser.memberId === member.id);
  await expect(
    await request('/api/admin/file-inventory', {
      headers: { cookie: partnerCookie },
    }),
    403,
  );
  await expect(
    await send(
      '/api/auth/login',
      { email: accounts.adminEmail, password: accounts.adminPassword },
      undefined,
      { headers: { origin: 'https://wrong.invalid' } },
    ),
    403,
  );
  await record({ phase, status: 'passed', checks });

  phase = 'flow';
  const endpoint = `/api/consulting-flow/${caseId}`;
  await expect(await request(endpoint), 401);
  check(
    [403, 404].includes(
      (await request(endpoint, { headers: { cookie: outsiderCookie } })).status,
    ),
  );
  let flow = (
    await (
      await expect(
        await request(endpoint, { headers: { cookie: adminCookie } }),
      )
    ).json()
  ).flow;
  check(flow.revision === 0);
  const accept = async (response) => {
    const value = await (await expect(response)).json();
    check(Boolean(value.flow));
    flow = value.flow;
    check(flow.files.every((file) => file.key === ''));
    return value;
  };
  // Keep response awaiting explicit so unknown writes are never automatically replayed.
  async function sendResponse(value, cookie) {
    return send(
      endpoint,
      { commandId: randomUUID(), revision: flow.revision, command: value },
      cookie,
    );
  }
  async function apply(value, cookie = adminCookie) {
    return accept(await sendResponse(value, cookie));
  }
  const body =
    '가상 기업의 업무 흐름 검증이며 실제 고객자료나 외부 AI를 사용하지 않습니다. '.repeat(
      20,
    );
  await expect(
    await send(
      endpoint,
      {
        commandId: randomUUID(),
        revision: flow.revision,
        command: { type: 'save_source', sourceText: body, privacyMasked: true },
      },
      partnerCookie,
    ),
    403,
  );
  const firstCommand = {
    commandId: randomUUID(),
    revision: flow.revision,
    command: { type: 'save_source', sourceText: body, privacyMasked: true },
  };
  await accept(await send(endpoint, firstCommand, adminCookie));
  const revision = flow.revision;
  check(
    (await accept(await send(endpoint, firstCommand, secondAdminCookie)))
      .duplicate === true,
  );
  check(flow.revision === revision);
  await expect(
    await send(
      endpoint,
      { ...firstCommand, commandId: randomUUID() },
      adminCookie,
    ),
    409,
  );

  const pdfBytes = new TextEncoder().encode(
    '%PDF-1.4\n' + 'Synthetic verification only. '.repeat(210000) + '\n%%EOF',
  );
  check(pdfBytes.length > 4.5 * 1024 * 1024);
  const pdf = new File([pdfBytes], 'synthetic-verification.pdf', {
    type: 'application/pdf',
  });
  async function upload(value, cookie = adminCookie, file = pdf) {
    const form = new FormData();
    form.set(
      'payload',
      JSON.stringify({
        commandId: randomUUID(),
        revision: flow.revision,
        command: { ...value, fileConsent: true },
      }),
    );
    form.set('file', file);
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
    const grant = parseSupabaseTransferGrant(await response.json(), ['file']);
    const destination = new URL(grant.uploads.file.url);
    check(destination.origin === settings.config.supabaseUrl);
    check(
      destination.pathname.startsWith(
        `/storage/v1/object/upload/sign/${settings.target.storageBucket}/`,
      ),
    );
    // Cookies and service keys never leave the local app origin.
    await expect(
      await fetch(destination, {
        method: 'PUT',
        body: file,
        headers: grant.uploads.file.headers,
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(120000),
      }),
    );
    await accept(
      await send(
        '/api/blob-transfers',
        { action: 'finish', id: grant.id },
        cookie,
      ),
    );
  }
  await upload({ type: 'save_report', stage: 1 });
  await apply({ type: 'confirm_analysis', reportId: flow.reports.at(-1).id });
  await apply(
    { type: 'confirm_analysis', reportId: flow.reports.at(-1).id },
    partnerCookie,
  );
  const date = new Date().toISOString().slice(0, 10);
  const meeting = {
    type: 'book_meeting',
    kind: 'first',
    attendance: 'both',
    startsAt: `${date}T00:00:00.000Z`,
    endsAt: `${date}T01:00:00.000Z`,
    location: '합성 검증 상담실',
  };
  await apply(meeting);
  const meetingId = flow.meetings.at(-1).id;
  await apply({ type: 'save_report', stage: 2, body });
  await upload({ type: 'save_report', stage: 3 });
  await apply({ type: 'complete_meeting', meetingId });
  await apply(
    {
      type: 'save_recording',
      meetingId,
      transcript: body,
      transcriptReviewed: true,
      recordingConsent: true,
      privacyMasked: true,
    },
    partnerCookie,
  );
  check(
    flow.jobs.every(
      (job) => job.status !== 'running' && job.status !== 'completed',
    ),
  );
  await apply(
    {
      type: 'save_transcript',
      recordingId: flow.recordings.at(-1).id,
      transcript: `${body} 확인 완료.`,
      transcriptReviewed: true,
      recordingConsent: true,
      privacyMasked: true,
    },
    partnerCookie,
  );
  await apply({ type: 'save_report', stage: 4, body });
  await apply({
    type: 'confirm_solutions',
    reportId: flow.reports.at(-1).id,
    solutions: ['합성 검증 솔루션'],
    documentsNeeded: true,
    reviewConfirmed: true,
    note: '실제 발송과 계약 없음',
  });
  await apply({
    type: 'request_document',
    title: '합성 확인자료',
    recipient: '합성담당',
    channel: '기타',
    required: true,
  });
  const requestId = flow.requests.at(-1).id;
  await apply(
    { type: 'mark_request_sent', requestId, sentConfirmed: true },
    partnerCookie,
  );
  await upload({ type: 'receive_document', requestId }, partnerCookie);
  await apply({ type: 'review_document', requestId, approved: true });
  await apply({ type: 'save_report', stage: 5, body });
  await apply({ type: 'save_report', stage: 6, body });
  await apply({
    ...meeting,
    kind: 'contract',
    startsAt: `${date}T02:00:00.000Z`,
    endsAt: `${date}T03:00:00.000Z`,
  });
  await upload({
    type: 'record_contract',
    meetingId: flow.meetings.at(-1).id,
    signedAt: date,
    expectedDepositWon: 1000000,
    signedConfirmed: true,
  });
  await apply({
    type: 'confirm_payment',
    amountWon: 400000,
    receivedAt: date,
    reference: '가상 입금 기록',
    paymentConfirmed: true,
  });
  await apply({
    type: 'confirm_payment',
    amountWon: 600000,
    receivedAt: date,
    reference: '가상 잔금 기록',
    paymentConfirmed: true,
  });
  await apply({
    type: 'start_aftercare',
    summary: '가상 수행 확인',
    owner: '합성 관리자',
    nextDate: date,
    deliveryConfirmed: true,
  });
  check(Boolean(flow.aftercare));
  await record({
    phase,
    status: 'passed',
    checks,
    caseId,
    revision: flow.revision,
  });

  phase = 'file_integrity';
  const fileId = flow.contract.signedFileId;
  const downloadPath = `${endpoint}/files/${fileId}`;
  const downloaded = await expect(
    await request(downloadPath, { headers: { cookie: partnerCookie } }),
  );
  const bytes = new Uint8Array(await downloaded.arrayBuffer());
  check(
    createHash('sha256').update(bytes).digest('hex') ===
      createHash('sha256').update(pdfBytes).digest('hex'),
  );
  check(
    [403, 404].includes(
      (await request(downloadPath, { headers: { cookie: outsiderCookie } }))
        .status,
    ),
  );
  const inventory = await (
    await expect(
      await request('/api/admin/file-inventory?status=all', {
        headers: { cookie: adminCookie },
      }),
    )
  ).json();
  const item = inventory.items.find(
    (item) => item.id === fileId || item.id === `flow:${fileId}`,
  );
  check(Boolean(item));
  const presence = await (
    await expect(
      await request(
        `/api/admin/file-inventory/${encodeURIComponent(item.id)}/presence`,
        { headers: { cookie: adminCookie } },
      ),
    )
  ).json();
  check(presence.exists && presence.sizeMatches && presence.integrityMatches);
  await record({ phase, status: 'passed', checks });

  phase = 'session_revocation';
  await expect(await send('/api/auth/logout', {}, secondAdminCookie));
  await expect(
    await request('/api/state', { headers: { cookie: secondAdminCookie } }),
    401,
  );
  check((await readState(adminCookie)).currentUser.role === 'admin');
  await record({ phase, status: 'passed', checks });
  return {
    checks,
    caseId,
    httpWorkflowVerified: true,
    browserMobileVerified: false,
    independentServerVerified: false,
  };
}
