import {
  flowAiResultAuditDetail,
  FlowError,
  latestRecording,
  latestReport,
  reportLabels,
  type ConsultingFlow,
  type FlowAiFailureObservation,
  type FlowAiSuccessObservation,
  type FlowJob,
} from './consulting-flow';
import {
  FLOW_COLLECTION_LIMITS,
  FLOW_TEXT_LIMITS,
  flowTextLength,
  hasFlowAiFailureEvidenceStructure,
  hasFlowAiEvidenceStructure,
  isWellFormedFlowText,
} from './consulting-flow-shape';

const resultCapacityError = () =>
  new FlowError(
    '생성 결과를 저장할 진행 기록이 많습니다. 보관 범위 검토 후 계속해 주세요.',
    409,
  );

export function jobIsCurrent(flow: ConsultingFlow, job: FlowJob) {
  if (!flow.ai.enabled || flow.contract) return false;
  if (job.stage === 1)
    return !flow.meetings.some(
      (m) => m.kind === 'first' && m.status === 'completed',
    );
  return (
    job.sourceRecordingId === latestRecording(flow)?.id &&
    job.sourceReportId === latestReport(flow, 1)?.id
  );
}
export function claimFlowJob(flow: ConsultingFlow, jobId: string, now: string) {
  const next = structuredClone(flow);
  const job = next.jobs.find((j) => j.id === jobId);
  if (!job || job.status !== 'queued')
    throw new FlowError('이미 처리 중이거나 완료된 생성 작업입니다.', 409);
  if (
    jobIsCurrent(next, job) &&
    (next.reports.length >= FLOW_COLLECTION_LIMITS.reports ||
      next.audit.length >= FLOW_COLLECTION_LIMITS.audit)
  )
    throw resultCapacityError();
  if (!jobIsCurrent(next, job)) {
    job.status = 'blocked';
    job.reason = '자동생성이 중지되었거나 근거 버전이 변경되었습니다.';
  } else {
    job.status = 'processing';
    job.startedAt = now;
    job.reason = '';
  }
  next.revision++;
  next.updatedAt = now;
  return next;
}
export function finishFlowJob(
  flow: ConsultingFlow,
  jobId: string,
  lease: string,
  now: string,
  outcome: {
    body?: string;
    error?: string;
    evidence?: FlowAiSuccessObservation;
    failureEvidence?: FlowAiFailureObservation;
  },
) {
  const next = structuredClone(flow);
  const job = next.jobs.find((j) => j.id === jobId);
  if (!job || job.status !== 'processing' || job.startedAt !== lease)
    throw new FlowError(
      '생성 작업 상태가 변경되었습니다. 새로고침해 주세요.',
      409,
    );
  const current = jobIsCurrent(next, job);
  if (next.audit.length >= FLOW_COLLECTION_LIMITS.audit)
    throw resultCapacityError();
  if (
    current &&
    typeof outcome.error === 'string' &&
    (!isWellFormedFlowText(outcome.error) ||
      flowTextLength(outcome.error) > FLOW_TEXT_LIMITS.jobReason)
  )
    throw new FlowError('생성 실패 안내가 저장 한도를 초과했습니다.', 413);
  if (
    current &&
    typeof outcome.error === 'string' &&
    (outcome.evidence !== undefined ||
      (outcome.failureEvidence !== undefined &&
        (!hasFlowAiFailureEvidenceStructure({
          ...outcome.failureEvidence,
          auditId: `${job.id}-${now}`,
        }) ||
          Date.parse(outcome.failureEvidence.observedAt) < Date.parse(lease) ||
          Date.parse(outcome.failureEvidence.observedAt) > Date.parse(now))))
  )
    throw new FlowError('Claude 실패 응답 추적 증거 형식이 올바르지 않습니다.');
  if (current && !outcome.error) {
    if (next.reports.length >= FLOW_COLLECTION_LIMITS.reports)
      throw resultCapacityError();
    if (
      outcome.body &&
      (!isWellFormedFlowText(outcome.body) ||
        flowTextLength(outcome.body) > FLOW_TEXT_LIMITS.reportBody)
    )
      throw new FlowError('생성 보고서가 저장 한도를 초과했습니다.', 413);
    if (
      !outcome.evidence ||
      !hasFlowAiEvidenceStructure({
        ...outcome.evidence,
        auditId: `${job.id}-${now}`,
      }) ||
      Date.parse(outcome.evidence.observedAt) < Date.parse(lease) ||
      Date.parse(outcome.evidence.observedAt) > Date.parse(now)
    )
      throw new FlowError(
        'Claude 응답 추적 증거를 확인하지 못해 정식 보고서로 저장하지 않았습니다.',
      );
    if (outcome.failureEvidence !== undefined)
      throw new FlowError('완료 결과에 실패 응답 증거를 저장할 수 없습니다.');
  }
  if (!current) {
    job.status = 'blocked';
    job.reason =
      '생성 중 근거 또는 승인 상태가 바뀌었습니다. 최신 자료로 다시 확인해 주세요.';
  } else if (outcome.error) {
    job.status = 'failed';
    job.reason = outcome.error;
    job.failureEvidence = outcome.failureEvidence
      ? { ...outcome.failureEvidence, auditId: `${job.id}-${now}` }
      : undefined;
  } else {
    if (!outcome.body || flowTextLength(outcome.body) < 200)
      throw new FlowError('완성된 분석 결과가 없습니다.');
    const report = {
      id: `${job.id}-result`,
      stage: job.stage,
      version: next.reports.filter((r) => r.stage === job.stage).length + 1,
      title: reportLabels[job.stage],
      body: outcome.body,
      sourceReportId: job.stage === 4 ? job.sourceReportId : undefined,
      sourceRecordingId: job.sourceRecordingId,
      createdAt: now,
      createdBy: 'Claude · 대표 검토 전',
      origin: 'ai' as const,
    };
    next.reports.push(report);
    if (job.stage === 1) next.analysis = { reportId: report.id };
    job.status = 'complete';
    job.reportId = report.id;
    job.completedAt = now;
    job.evidence = {
      ...outcome.evidence!,
      auditId: `${job.id}-${now}`,
    };
  }
  next.revision++;
  next.updatedAt = now;
  next.audit.push({
    id: `${job.id}-${now}`,
    at: now,
    actor: '보고서 자동생성',
    action: 'ai_result',
    detail: flowAiResultAuditDetail(job),
  });
  if (flowTextLength(next.audit.at(-1)!.detail) > FLOW_TEXT_LIMITS.auditDetail)
    throw new FlowError('생성 결과 감사기록이 저장 한도를 초과했습니다.', 413);
  return next;
}
