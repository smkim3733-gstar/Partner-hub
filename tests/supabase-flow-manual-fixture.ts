import type { PGlite } from '@electric-sql/pglite';
import { applyFlowCommand, newConsultingFlow, type ConsultingFlow, type FlowActor, type FlowCommand, type FlowFile } from '../lib/consulting-flow';
import { flowFileStorageKey } from '../lib/consulting-flow-file-policy';

export type ManualFlowTransition = {
  previous: ConsultingFlow; proposed: ConsultingFlow; command: FlowCommand;
  commandId: string; actor: FlowActor; upload?: FlowFile;
};
const time = '2026-09-09T12:00:00.000Z';
export const manualFlowStamp = '2026-09-09T12:01:00.000Z';

export function manualFlowCommand(previous: ConsultingFlow, command: FlowCommand, actor: FlowActor,
  commandId: string, now = manualFlowStamp, upload?: FlowFile, audioUpload?: FlowFile, intakeCategory?: string): ManualFlowTransition {
  const proposed = applyFlowCommand(previous, { transcriptReviewed: true, ...command }, actor,
    { commandId, now, upload, audioUpload, intakeCategory });
  const targetId = command.meetingId ?? command.requestId ?? command.recordingId;
  proposed.commandReceipts = { ...previous.commandReceipts, [commandId]: {
    actorKey: actor.role === 'admin' ? 'admin:primary' : `member:${actor.id}`, fingerprint: 'a'.repeat(64),
    actor: actor.name, action: command.type,
    ...(['complete_meeting','cancel_meeting','mark_request_sent','receive_document','review_document','record_contract','save_transcript'].includes(command.type) ? { targetId: String(targetId) } : {}),
  } };
  return { previous, proposed, command, commandId, actor, upload };
}

// Pure application transitions plus synthetic private source ledgers. No root,
// authentication HTTP, real business records, Storage bytes or AI network.
export async function manualFlowScenario(engine: PGlite) {
  const stamp = manualFlowStamp;
  let flow: ConsultingFlow = { ...newConsultingFlow('synthetic-case', '가상기업', 'synthetic-partner', '가상담당'), updatedAt: time };
  const admin: FlowActor = { id: 'synthetic-admin', role: 'admin', name: '김성민 대표' };
  const partner: FlowActor = { id: 'synthetic-partner', role: 'partner', name: '가상담당' };
  const body = '가상 기업에 대한 합성 검사입니다. 실제 기업 자료나 AI 제공자 호출 없이 검증합니다. '.repeat(8);
  let sequence = 0;
  const transitions: ManualFlowTransition[] = [];
  function file(purpose: string, name = 'synthetic.pdf'): FlowFile {
    const fileId = `synthetic-file-${++sequence}`;
    const contentType = name.endsWith('.pptx') ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : 'application/pdf';
    return { id: fileId, key: flowFileStorageKey(fileId), purpose, name, contentType, size: 100, createdAt: stamp };
  }
  async function apply(command: FlowCommand, actor = admin, upload?: FlowFile, intakeCategory?: string) {
    const commandId = `synthetic-app-command-${++sequence}`;
    const transition = manualFlowCommand(flow, command, actor, commandId, stamp, upload, undefined, intakeCategory);
    transitions.push(transition);
    flow = transition.proposed;
  }
  await apply({ type: 'save_source', sourceText: body, privacyMasked: true });
  const source = { ...file('source'), intakeFileId: 'synthetic-intake-file', intakeSourceHash: 'b'.repeat(64), sourceReviewedAt: stamp, sourceReviewedBy: admin.id };
  // Real PostgreSQL source ledgers, synthetic metadata only. No Storage bytes.
  await engine.query(`INSERT INTO partner_hub.company_file_objects VALUES ($1,'synthetic/intake-source','가상.pdf','가상기업','재무자료','가상자료','가상담당','synthetic-user','synthetic@example.invalid','application/pdf',100,$2)`,[source.intakeFileId,stamp]);
  await engine.query('INSERT INTO partner_hub.company_file_storage_keys SELECT id,storage_key FROM partner_hub.company_file_objects WHERE id=$1',[source.intakeFileId]);
  await engine.query('INSERT INTO partner_hub.company_file_metadata SELECT id,original_name,company,category,title,assigned_trainee,uploaded_by_user_id,uploaded_by_email,content_type,size_bytes,created_at FROM partner_hub.company_file_objects WHERE id=$1',[source.intakeFileId]);
  await engine.query("INSERT INTO partner_hub.company_file_object_integrity VALUES ($1,'metadata',NULL,'application/pdf')",[source.intakeFileId]);
  await apply({ type: 'import_intake_source', intakeFileId: source.intakeFileId, contentReviewed: true, fileConsent: true, privacyMasked: true }, admin, source, '재무자료');
  await apply({ type: 'exclude_source', fileId: source.id });
  await apply({ type: 'queue_report1' }); // blocked while AI is disabled; no provider call.
  await apply({ type: 'set_ai_policy', enabled: true, thirdPartyConsent: true, privacyMasked: true, costConsent: true });
  await apply({ type: 'retry_job', jobId: flow.jobs[0].id, costConsent: true });
  await apply({ type: 'set_ai_policy', enabled: false });
  await apply({ type: 'save_report', stage: 1, body });
  await apply({ type: 'confirm_analysis', reportId: flow.reports[0].id });
  await apply({ type: 'confirm_analysis', reportId: flow.reports[0].id }, partner);
  const meeting = { type: 'book_meeting', kind: 'first', attendance: 'both', startsAt: '2026-09-09T01:00:00Z', endsAt: '2026-09-09T02:00:00Z', location: '가상 상담실' };
  await apply(meeting);
  await apply({ type: 'cancel_meeting', meetingId: flow.meetings[0].id, note: '가상 취소' });
  await apply(meeting);
  await apply({ type: 'save_report', stage: 2, body });
  await apply({ type: 'save_report', stage: 3 }, admin, file('report', 'synthetic.pptx'));
  await apply({ type: 'complete_meeting', meetingId: flow.meetings.at(-1)!.id });
  await apply({ type: 'save_recording', meetingId: flow.meetings.at(-1)!.id, transcript: body, recordingConsent: true, privacyMasked: true }, partner);
  await apply({ type: 'save_transcript', recordingId: flow.recordings[0].id, transcript: `${body} 가상 보완`, recordingConsent: true, privacyMasked: true }, partner);
  await apply({ type: 'save_report', stage: 4, body });
  await apply({ type: 'confirm_solutions', reportId: flow.reports.at(-1)!.id, solutions: ['정책자금 사전진단'], documentsNeeded: true, reviewConfirmed: true, note: '가상 추가 확인' });
  await apply({ type: 'request_document', title: '가상 확인자료', recipient: '가상담당', channel: '이메일', required: true, dueDate: '2026-09-10' });
  await apply({ type: 'mark_request_sent', requestId: flow.requests[0].id, sentConfirmed: true }, partner);
  await apply({ type: 'receive_document', requestId: flow.requests[0].id }, partner, file('requested_document'));
  await apply({ type: 'review_document', requestId: flow.requests[0].id, approved: true });
  await apply({ type: 'save_report', stage: 5, body });
  await apply({ type: 'save_report', stage: 6, body });
  await apply({ ...meeting, kind: 'contract', startsAt: '2026-09-09T03:00:00Z', endsAt: '2026-09-09T04:00:00Z' });
  await apply({ type: 'record_contract', meetingId: flow.meetings.at(-1)!.id, signedAt: '2026-09-09', expectedDepositWon: 1000000, signedConfirmed: true }, admin, file('signed_contract'));
  await apply({ type: 'confirm_payment', amountWon: 400000, receivedAt: '2026-09-09', reference: '가상 부분입금', paymentConfirmed: true });
  await apply({ type: 'confirm_payment', amountWon: 600000, receivedAt: '2026-09-09', reference: '가상 잔금', paymentConfirmed: true });
  await apply({ type: 'start_aftercare', summary: '가상 수행 확인', owner: '가상관리자', nextDate: '2026-10-01', deliveryConfirmed: true });
  return { transitions, flow };
}
