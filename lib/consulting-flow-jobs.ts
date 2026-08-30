import {
  FlowError,
  latestRecording,
  latestReport,
  reportLabels,
  type ConsultingFlow,
  type FlowFile,
  type FlowJob,
} from './consulting-flow';

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
  outcome: { body?: string; file?: FlowFile; error?: string },
) {
  const next = structuredClone(flow);
  const job = next.jobs.find((j) => j.id === jobId);
  if (!job || job.status !== 'processing' || job.startedAt !== lease)
    throw new FlowError(
      '생성 작업 상태가 변경되었습니다. 새로고침해 주세요.',
      409,
    );
  if (!jobIsCurrent(next, job)) {
    job.status = 'blocked';
    job.reason =
      '생성 중 근거 또는 승인 상태가 바뀌었습니다. 최신 자료로 다시 확인해 주세요.';
  } else if (outcome.error) {
    job.status = 'failed';
    job.reason = outcome.error;
  } else {
    if (!outcome.body || outcome.body.length < 200)
      throw new FlowError('완성된 분석 결과가 없습니다.');
    const report = {
      id: `${job.id}-result`,
      stage: job.stage,
      version: next.reports.filter((r) => r.stage === job.stage).length + 1,
      title: reportLabels[job.stage],
      body: outcome.body,
      fileId: outcome.file?.id,
      sourceReportId: job.stage === 4 ? job.sourceReportId : undefined,
      sourceRecordingId: job.sourceRecordingId,
      createdAt: now,
      createdBy: 'Claude · 대표 검토 전',
      origin: 'ai' as const,
    };
    next.reports.push(report);
    if (outcome.file) next.files.push(outcome.file);
    if (job.stage === 1) next.analysis = { reportId: report.id };
    job.status = 'complete';
    job.reportId = report.id;
    job.completedAt = now;
  }
  next.revision++;
  next.updatedAt = now;
  next.audit.push({
    id: `${job.id}-${now}`,
    at: now,
    actor: '보고서 자동생성',
    action: 'ai_result',
    detail:
      job.status === 'complete'
        ? `${reportLabels[job.stage]} 자동 저장 · 담당 파트너 공유`
        : `${reportLabels[job.stage]} ${job.status === 'blocked' ? '보류' : '실패'} · ${job.reason}`,
  });
  return next;
}
