import {
  firstMeeting,
  FlowError,
  latestReport,
  type ConsultingFlow,
} from './consulting-flow';
import { buildAnalysisSourceBlocks } from './consulting-flow-ai';
import { flowReadiness } from './consulting-flow-store';
import {
  MAX_AI_SOURCE_BYTES,
  MAX_AI_SOURCE_FILES,
} from './intake-source-policy';
import {
  reportPreflightCheckDefinitions,
  reportPreflightNotices,
  type ReportPreflight,
} from './report-preflight';

export async function inspectFirstReport(
  flow: ConsultingFlow,
): Promise<ReportPreflight> {
  const files = flow.files.filter((file) => file.purpose === 'source');
  const runtime = flowReadiness();
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const composition =
    (flow.ai.sourceText.trim().length >= 20 || files.length > 0) &&
    files.length <= MAX_AI_SOURCE_FILES &&
    totalBytes <= MAX_AI_SOURCE_BYTES;
  let sourceError = '';
  try {
    await buildAnalysisSourceBlocks(flow, { stage: 1 });
  } catch (error) {
    if (!(error instanceof FlowError)) throw error;
    sourceError = error.message;
  }
  const unlocked =
    !flow.contract &&
    !firstMeeting(flow)?.completedAt &&
    !flow.jobs.some(
      (job) => job.stage === 1 && ['queued', 'processing'].includes(job.status),
    );
  const checks: ReportPreflight['checks'] = [
    {
      id: 'composition',
      ...reportPreflightCheckDefinitions.composition,
      passed: composition,
      detail: composition
        ? `근거 요약 ${flow.ai.sourceText.length.toLocaleString()}자 · 파일 ${files.length}개 선택`
        : '20자 이상의 요약 또는 근거파일이 필요합니다. 파일은 최대 8개·합계 8MB입니다.',
    },
    {
      id: 'sources',
      ...reportPreflightCheckDefinitions.sources,
      passed: !sourceError,
      detail:
        sourceError ||
        '저장 파일·지원 형식·텍스트 읽기 및 식별정보 형식 검사를 통과했습니다. 내용 검증이나 완전한 개인정보 제거를 보장하지 않습니다.',
    },
    {
      id: 'policy',
      ...reportPreflightCheckDefinitions.policy,
      passed: flow.ai.enabled,
      detail: flow.ai.enabled
        ? '이 기업의 AI 사용이 허용되어 있습니다. 아래 최종 확인 후 생성을 요청하세요.'
        : '위의 기업별 AI 자동생성 설정에서 자료 처리 권한·마스킹·비용을 확인한 뒤 허용해 주세요.',
    },
    {
      id: 'key',
      ...reportPreflightCheckDefinitions.key,
      passed: runtime.aiConnected,
      detail: runtime.aiConnected
        ? '키가 설정되어 있습니다. 유효성·잔액·모델 이용 권한은 호출하지 않아 확인되지 않았습니다.'
        : 'API 키 설정이 필요합니다. 수동 보고서 등록은 계속 이용할 수 있습니다.',
    },
    {
      id: 'phase',
      ...reportPreflightCheckDefinitions.phase,
      passed: unlocked,
      detail: unlocked
        ? '1차 생성 대기·진행 작업이 없으며 초회상담 완료 전입니다.'
        : '이미 생성 대기·진행 중이거나 초회상담·계약이 완료되어 새 1차 생성이 잠겨 있습니다.',
    },
  ];
  return {
    caseId: flow.caseId,
    revision: flow.revision,
    checkedAt: new Date().toISOString(),
    canGenerate: checks.every((check) => check.passed),
    sourceTextChars: flow.ai.sourceText.length,
    fileCount: files.length,
    totalBytes,
    excludedCount: flow.files.filter(
      (file) => file.purpose === 'source_archived',
    ).length,
    model: runtime.model,
    hasExistingReport: Boolean(latestReport(flow, 1)),
    files: files.map((file) => ({
      id: file.id,
      name: file.name,
      size: file.size,
      type: file.contentType,
      imported: Boolean(file.intakeFileId),
    })),
    checks,
    notices: [...reportPreflightNotices],
  };
}
