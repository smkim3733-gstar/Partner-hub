import { transcriptProblem } from './transcript-policy';
import {
  MAX_AI_SOURCE_BYTES,
  MAX_AI_SOURCE_FILES,
  MAX_AI_SOURCE_MEGABYTES,
} from './intake-source-policy';
import { FLOW_COLLECTION_LIMITS } from './consulting-flow-shape';

/** Pure, server-enforced consulting workflow. No browser state is authoritative. */
export type FlowActor = { id: string; role: 'admin' | 'partner'; name: string };
export type FlowFile = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  key: string;
  createdAt: string;
  purpose: string;
  intakeFileId?: string;
  intakeSourceHash?: string;
  sourceReviewedAt?: string;
  sourceReviewedBy?: string;
};
export type ReportStage = 1 | 2 | 3 | 4 | 5 | 6;
export type FlowReport = {
  id: string;
  stage: ReportStage;
  version: number;
  title: string;
  body: string;
  fileId?: string;
  sourceReportId?: string;
  sourceRecordingId?: string;
  decisionId?: string;
  documentsKey?: string;
  createdAt: string;
  createdBy: string;
  origin: 'manual' | 'ai';
};
export type FlowMeeting = {
  id: string;
  kind: 'first' | 'followup' | 'contract';
  startsAt: string;
  endsAt: string;
  location: string;
  attendance: 'both' | 'partner' | 'admin';
  status: 'scheduled' | 'completed' | 'cancelled';
  note: string;
  createdBy: string;
  completedAt?: string;
};
export type FlowRecording = {
  id: string;
  meetingId: string;
  fileId?: string;
  transcriptFileId?: string;
  audioFileId?: string;
  transcript: string;
  transcriptReviewedAt?: string;
  transcriptReviewedBy?: string;
  consentAt: string;
  createdAt: string;
};
export type FlowRequest = {
  id: string;
  title: string;
  required: boolean;
  channel: '카카오톡' | '이메일' | '기타';
  recipient: string;
  dueDate: string;
  status: 'requested' | 'received' | 'verified' | 'needs_fix';
  fileId?: string;
  sentAt?: string;
  note: string;
  createdAt: string;
  receivedAt?: string;
  reviewedAt?: string;
  verifiedAt?: string;
};
export type FlowJob = {
  id: string;
  stage: 1 | 4;
  sourceRecordingId?: string;
  sourceReportId?: string;
  status: 'queued' | 'processing' | 'blocked' | 'failed' | 'complete';
  reason: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  reportId?: string;
};
export type ConsultingFlow = {
  schemaVersion: 1;
  caseId: string;
  company: string;
  partnerId: string;
  partnerName: string;
  revision: number;
  updatedAt: string;
  reports: FlowReport[];
  files: FlowFile[];
  analysis: { reportId: string; adminAt?: string; partnerAt?: string };
  meetings: FlowMeeting[];
  recordings: FlowRecording[];
  requests: FlowRequest[];
  decision?: {
    id: string;
    reportId: string;
    solutions: string[];
    note: string;
    documentsNeeded: boolean;
    at: string;
  };
  contract?: {
    meetingId: string;
    reportId: string;
    signedFileId: string;
    signedAt: string;
    expectedDepositWon: number;
    recordedBy: string;
  };
  payments: Array<{
    id: string;
    amountWon: number;
    receivedAt: string;
    reference: string;
    confirmedBy: string;
    recordedAt: string;
  }>;
  executionStartedAt?: string;
  aftercare?: { at: string; summary: string; nextDate: string; owner: string };
  ai: {
    enabled: boolean;
    approvedAt?: string;
    approvedBy?: string;
    sourceText: string;
  };
  jobs: FlowJob[];
  audit: Array<{
    id: string;
    at: string;
    actor: string;
    action: string;
    detail: string;
  }>;
  commandIds: string[];
  commandReceipts?: Record<string, { actorKey: string; fingerprint: string }>;
};
export type FlowCommand = { type: string; [key: string]: unknown };
export class FlowError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function explicitFlowBooleanChoice(value: unknown) {
  return value === 'yes' ? true : value === 'no' ? false : undefined;
}
export function flowBooleanChoiceDefault(value?: boolean) {
  return value === true ? 'yes' : value === false ? 'no' : '';
}
export const reportLabels: Record<ReportStage, string> = {
  1: '1차 정밀진단보고서',
  2: '2차 대표 상담보고서',
  3: '3차 초회상담 PPT',
  4: '4차 심화보고서',
  5: '5차 견적서',
  6: '6차 경영자문용역계약서',
};
export const flowPhases = [
  '1차 보고서',
  '공동분석',
  '초회상담 예약',
  '2차·3차 준비',
  '초회상담',
  '녹취자료 등록',
  '4차 심화분석',
  '진행솔루션 확정',
  '추가서류 확인',
  '5차·6차 준비',
  '계약 상담',
  '계약 체결',
  '계약금 확인',
  '컨설팅 수행',
  '사후관리',
] as const;
export type FlowPhase = (typeof flowPhases)[number];
export function newConsultingFlow(
  caseId: string,
  company: string,
  partnerId: string,
  partnerName: string,
): ConsultingFlow {
  return {
    schemaVersion: 1,
    caseId,
    company,
    partnerId,
    partnerName,
    revision: 0,
    updatedAt: '',
    reports: [],
    files: [],
    analysis: { reportId: '' },
    meetings: [],
    recordings: [],
    requests: [],
    payments: [],
    ai: { enabled: false, sourceText: '' },
    jobs: [],
    audit: [],
    commandIds: [],
  };
}
export function latestReport(s: ConsultingFlow, stage: ReportStage) {
  return s.reports.filter((r) => r.stage === stage).at(-1);
}
export function analysisDone(s: ConsultingFlow) {
  return Boolean(
    latestReport(s, 1)?.id === s.analysis.reportId &&
    s.analysis.adminAt &&
    s.analysis.partnerAt,
  );
}
export function firstMeeting(s: ConsultingFlow) {
  return s.meetings.find((m) => m.kind === 'first' && m.status !== 'cancelled');
}
export function latestRecording(s: ConsultingFlow) {
  return s.recordings.at(-1);
}
export function preparationDone(s: ConsultingFlow) {
  const source = latestReport(s, 1)?.id;
  return Boolean(
    source &&
    [2, 3].every(
      (stage) =>
        latestReport(s, stage as ReportStage)?.sourceReportId === source,
    ),
  );
}
export function deepReport(s: ConsultingFlow) {
  const recording = latestRecording(s);
  return recording
    ? s.reports
        .filter(
          (r) =>
            r.stage === 4 &&
            r.sourceRecordingId === recording.id &&
            r.sourceReportId === latestReport(s, 1)?.id,
        )
        .at(-1)
    : undefined;
}
export function documentsDone(s: ConsultingFlow) {
  if (!s.decision || s.decision.reportId !== deepReport(s)?.id) return false;
  const required = s.requests.filter((r) => r.required);
  return (
    (!s.decision.documentsNeeded || required.length > 0) &&
    required.every((r) => r.status === 'verified')
  );
}
export function signingPreparationDone(s: ConsultingFlow) {
  return (
    documentsDone(s) &&
    [5, 6].every((stage) => {
      const report = latestReport(s, stage as ReportStage);
      return (
        report?.decisionId === s.decision?.id &&
        report?.documentsKey === documentsKey(s)
      );
    })
  );
}
export function documentsKey(s: ConsultingFlow) {
  return JSON.stringify(
    s.requests
      .filter((r) => r.required)
      .map((r) => [r.id, r.fileId, r.verifiedAt]),
  );
}
export function depositReceived(s: ConsultingFlow) {
  return s.payments.reduce((sum, item) => sum + item.amountWon, 0);
}
export function depositComplete(s: ConsultingFlow) {
  return Boolean(
    s.contract && depositReceived(s) >= s.contract.expectedDepositWon,
  );
}
export function phaseOf(s: ConsultingFlow): FlowPhase {
  if (s.contract)
    return !depositComplete(s)
      ? '계약금 확인'
      : s.aftercare
        ? '사후관리'
        : '컨설팅 수행';
  if (!latestReport(s, 1)) return '1차 보고서';
  if (!analysisDone(s)) return '공동분석';
  const first = firstMeeting(s);
  if (!first) return '초회상담 예약';
  if (!preparationDone(s)) return '2차·3차 준비';
  if (first.status !== 'completed') return '초회상담';
  if (!latestRecording(s)?.transcript) return '녹취자료 등록';
  if (!deepReport(s)) return '4차 심화분석';
  if (!s.decision || s.decision.reportId !== deepReport(s)?.id)
    return '진행솔루션 확정';
  if (!documentsDone(s)) return '추가서류 확인';
  if (!signingPreparationDone(s)) return '5차·6차 준비';
  if (
    !s.meetings.some((m) => m.kind === 'contract' && m.status !== 'cancelled')
  )
    return '계약 상담';
  return '계약 체결';
}
export function nextFlowAction(s: ConsultingFlow): {
  phase: FlowPhase;
  owner: string;
  message: string;
} {
  const phase = phaseOf(s);
  const rows: Record<FlowPhase, [string, string]> = {
    '1차 보고서': [
      '김성민 대표',
      '1차 보고서를 등록하면 담당 파트너 자료함에 자동 공유됩니다.',
    ],
    공동분석: [
      '김성민 대표 · 담당 파트너',
      '각자 1차 보고서를 확인하고 분석 완료를 표시하세요.',
    ],
    '초회상담 예약': [
      '담당 파트너',
      '기업대표와 초회상담을 예약하세요. 참석자는 두 사람 동반입니다.',
    ],
    '2차·3차 준비': [
      '김성민 대표',
      '현재 1차 보고서에 맞춰 2차 보고서와 3차 PPT를 준비하세요.',
    ],
    초회상담: [
      '김성민 대표 · 담당 파트너',
      '동반 상담을 진행하고 실제 완료 후 기록하세요.',
    ],
    '녹취자료 등록': [
      '김성민 대표 · 담당 파트너',
      'Word·TXT 전사문을 첨부하거나 붙여넣고 내용을 확인하세요. 음성은 선택 첨부입니다.',
    ],
    '4차 심화분석': [
      '자동 생성 / 김성민 대표',
      '전사문과 AI 처리 승인이 갖춰지면 4차 초안이 자동 저장됩니다.',
    ],
    '진행솔루션 확정': [
      '김성민 대표',
      '4차 내용을 검토한 뒤 필요한 컨설팅과 추가서류 필요 여부를 확정하세요.',
    ],
    '추가서류 확인': [
      '파트너 수집 · 김성민 대표 확인',
      '필수 서류를 수령하고 검토 완료를 표시하세요.',
    ],
    '5차·6차 준비': [
      '김성민 대표',
      '검토한 서류와 확정 솔루션으로 견적서·계약서를 등록해 출력하세요.',
    ],
    '계약 상담': [
      '담당 파트너 · 김성민 대표',
      '동반·파트너 단독·김성민 대표 단독 중 참석 방식을 정하세요.',
    ],
    '계약 체결': [
      '계약 상담 참석자',
      '서명본과 실제 계약일, 약정 계약금을 기록하세요.',
    ],
    '계약금 확인': [
      '김성민 대표',
      '실제 입금 증빙을 확인하세요. 약정 계약금 충족 전에는 수행을 시작하지 않습니다.',
    ],
    '컨설팅 수행': [
      '김성민 대표 · 담당 파트너',
      '계약금 확인 완료. 컨설팅 수행 후 결과를 정리해 사후관리로 전환하세요.',
    ],
    사후관리: ['지정 담당자', '후속 점검일과 관리 내용을 확인하세요.'],
  };
  return { phase, owner: rows[phase][0], message: rows[phase][1] };
}
function demand(
  condition: unknown,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new FlowError(message, status);
}
function txt(c: FlowCommand, key: string, max = 1000, required = true) {
  const raw = c[key];
  demand(
    raw === undefined || typeof raw === 'string',
    `${key} 입력 형식이 올바르지 않습니다.`,
  );
  const value = typeof raw === 'string' ? raw.trim() : '';
  demand(
    value.length <= max && (!required || value.length > 0),
    `${key} 내용을 확인해 주세요.`,
  );
  return value;
}
function dateTime(c: FlowCommand, key: string) {
  const value = txt(c, key, 40);
  demand(
    /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)),
    '날짜와 시간을 확인해 주세요.',
  );
  return new Date(value).toISOString();
}
function dateOnly(c: FlowCommand, key: string, required = true) {
  const value = txt(c, key, 10, required);
  const parsed = Date.parse(`${value}T00:00:00Z`);
  demand(
    !value ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(parsed) &&
        new Date(parsed).toISOString().slice(0, 10) === value),
    '날짜를 확인해 주세요.',
  );
  return value;
}
function won(c: FlowCommand, key: string) {
  const value = c[key];
  demand(
    typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value > 0 &&
      value <= 1_000_000_000_000,
    '금액은 0보다 큰 원 단위 정수로 입력해 주세요.',
  );
  return value;
}
function admin(actor: FlowActor) {
  demand(actor.role === 'admin', '김성민 대표만 처리할 수 있습니다.', 403);
}
function actorCanAttend(actor: FlowActor, m: FlowMeeting) {
  return m.attendance === 'both' || m.attendance === actor.role;
}
function createJob(
  s: ConsultingFlow,
  stage: 1 | 4,
  now: string,
  id: string,
  recording?: FlowRecording,
) {
  const reason =
    stage === 4 && !recording?.transcript
      ? '전사문 대기: Word·TXT를 첨부하거나 본문을 입력해 주세요. 음성은 보관만 하며 자동전사는 미연결입니다.'
      : !s.ai.enabled
        ? '김성민 대표의 외부 AI 자동생성 승인이 필요합니다.'
        : '';
  s.jobs.push({
    id,
    stage,
    sourceRecordingId: recording?.id,
    sourceReportId: latestReport(s, 1)?.id,
    status: reason ? 'blocked' : 'queued',
    reason,
    createdAt: now,
  });
}
export function hasSensitiveIdentifier(value: string) {
  return (
    /\b\d{6}[- ]?\d{7}\b|\b\d{3}-\d{2}-\d{5}\b|\b01[016789][- ]?\d{3,4}[- ]?\d{4}\b/.test(
      value,
    ) || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)
  );
}
export function applyFlowCommand(
  current: ConsultingFlow,
  command: FlowCommand,
  actor: FlowActor,
  context: {
    commandId: string;
    now: string;
    upload?: FlowFile;
    audioUpload?: FlowFile;
    intakeCategory?: string;
  },
): ConsultingFlow {
  const { commandId, now, upload, audioUpload } = context;
  demand(
    /^[a-zA-Z0-9_-]{8,100}$/.test(commandId),
    '요청 식별값이 올바르지 않습니다.',
  );
  if (current.commandIds.includes(commandId)) return current;
  demand(
    current.commandIds.length < FLOW_COLLECTION_LIMITS.commandIds &&
      current.audit.length < FLOW_COLLECTION_LIMITS.audit,
    '진행 기록이 많습니다. 보관 범위 검토 후 계속해 주세요.',
    409,
  );
  const s = structuredClone(current);
  const id = (suffix: string) => `${commandId}-${suffix}`;
  const type = txt(command, 'type', 60);
  demand(
    !audioUpload || type === 'save_recording',
    '보조 음성은 새 상담 녹취자료 등록에만 첨부할 수 있습니다.',
  );
  const file = () => {
    const f =
      upload ?? s.files.find((f) => f.id === txt(command, 'fileId', 120));
    demand(f, '저장된 첨부파일이 필요합니다.');
    return f;
  };
  let detail = '';
  switch (type) {
    case 'import_intake_source': {
      admin(actor);
      demand(
        !s.contract &&
          !firstMeeting(s)?.completedAt &&
          !s.jobs.some(
            (j) => j.stage === 1 && ['queued', 'processing'].includes(j.status),
          ),
        '1차 생성 중·초회상담 완료 후·계약 후에는 신청자료를 새로 반영할 수 없습니다.',
        409,
      );
      demand(
        command.contentReviewed === true &&
          command.fileConsent === true &&
          command.privacyMasked === true,
        '자료 내용·저장 권한·마스킹 확인이 필요합니다.',
      );
      demand(
        upload?.purpose === 'source' &&
          upload.intakeFileId === command.intakeFileId &&
          Boolean(context.intakeCategory),
        '서버에서 확인한 신청자료가 필요합니다.',
      );
      if (context.intakeCategory === '상담녹취')
        demand(
          command.recordingConsent === true,
          '전화 녹취자료 이용 권한을 확인해 주세요.',
        );
      const sources = s.files.filter((f) => f.purpose === 'source');
      demand(
        !sources.some((f) => f.intakeFileId === command.intakeFileId),
        '이미 반영된 자료입니다. 수정하려면 기존 검토본을 AI 입력에서 제외한 뒤 다시 반영해 주세요.',
        409,
      );
      demand(
        sources.length < MAX_AI_SOURCE_FILES &&
          sources.reduce((sum, f) => sum + f.size, 0) + upload.size <=
            MAX_AI_SOURCE_BYTES,
        `AI 근거자료는 파일 ${MAX_AI_SOURCE_FILES}개·합계 ${MAX_AI_SOURCE_MEGABYTES}MB까지입니다. 불필요한 자료를 AI 입력에서 제외해 주세요.`,
        413,
      );
      detail = '신청자료 검토본을 1차 근거자료로 반영 · 원본 보존 · AI 미전송';
      break;
    }
    case 'save_source': {
      admin(actor);
      demand(
        command.privacyMasked === true,
        'AI 분석용 근거자료의 개인정보 마스킹을 확인해 주세요.',
      );
      demand(
        !s.contract &&
          !s.jobs.some(
            (j) => j.stage === 1 && ['queued', 'processing'].includes(j.status),
          ),
        '1차 생성 중 또는 계약 후에는 근거자료를 변경할 수 없습니다.',
        409,
      );
      s.ai.sourceText = txt(command, 'sourceText', 40000, false);
      demand(
        s.ai.sourceText.length >= 20 || upload,
        '기업 근거자료 또는 20자 이상 정리한 내용을 등록해 주세요.',
      );
      demand(
        !hasSensitiveIdentifier(s.ai.sourceText),
        '원문에 식별번호·전화번호·이메일이 포함되어 있습니다. 마스킹해 주세요.',
      );
      detail = '1차 분석용 근거자료 저장';
      break;
    }
    case 'exclude_source': {
      admin(actor);
      demand(
        !s.jobs.some(
          (j) => j.stage === 1 && ['queued', 'processing'].includes(j.status),
        ),
        '1차 생성 중에는 자료를 제외할 수 없습니다.',
        409,
      );
      const source = s.files.find(
        (f) => f.id === command.fileId && f.purpose === 'source',
      );
      demand(source, '분석용 근거파일을 선택해 주세요.');
      source.purpose = 'source_archived';
      detail = 'AI 입력에서 근거자료 제외 · 원본은 비공개 보존';
      break;
    }
    case 'set_ai_policy': {
      admin(actor);
      demand(
        typeof command.enabled === 'boolean',
        'AI 자동생성 여부를 확인해 주세요.',
      );
      if (command.enabled)
        demand(
          command.thirdPartyConsent === true &&
            command.privacyMasked === true &&
            command.costConsent === true,
          '제3자 AI 처리 권한·마스킹·이용요금 확인이 모두 필요합니다.',
        );
      s.ai = {
        ...s.ai,
        enabled: command.enabled,
        approvedAt: now,
        approvedBy: actor.id,
      };
      detail = command.enabled
        ? '이 기업의 Claude 자동생성 허용 / 자료 처리·비용 확인'
        : '이 기업의 Claude 자동생성 중지';
      if (!command.enabled)
        s.jobs
          .filter((j) => j.status === 'queued')
          .forEach((j) => {
            j.status = 'blocked';
            j.reason = '대표가 자동생성을 중지했습니다.';
          });
      break;
    }
    case 'queue_report1': {
      admin(actor);
      demand(
        !firstMeeting(s)?.completedAt && !s.contract,
        '초회상담 완료 후 1차 보고서는 변경하지 않습니다.',
        409,
      );
      demand(
        s.ai.sourceText.length >= 20 ||
          s.files.some((f) => f.purpose === 'source'),
        '1차 분석용 근거자료를 먼저 등록해 주세요.',
      );
      demand(
        !s.jobs.some(
          (j) =>
            j.stage === 1 &&
            (j.status === 'queued' || j.status === 'processing'),
        ),
        '1차 생성이 이미 진행 중입니다.',
        409,
      );
      createJob(s, 1, now, id('job'));
      detail = '1차 보고서 생성 요청';
      break;
    }
    case 'save_report': {
      admin(actor);
      const stage = Number(command.stage) as ReportStage;
      demand(
        [1, 2, 3, 4, 5, 6].includes(stage),
        '보고서 차수를 확인해 주세요.',
      );
      demand(
        !s.contract,
        '계약 체결 후 기존 계약 근거 문서는 변경하지 않습니다. 새 진행으로 관리해 주세요.',
        409,
      );
      if (stage === 1)
        demand(
          !firstMeeting(s)?.completedAt,
          '초회상담 완료 후에는 4차 심화보고서로 보완해 주세요.',
          409,
        );
      demand(
        !s.jobs.some(
          (j) =>
            j.stage === stage && ['queued', 'processing'].includes(j.status),
        ),
        '같은 차수의 AI 생성이 끝난 뒤 등록해 주세요.',
        409,
      );
      if (stage === 2 || stage === 3)
        demand(
          analysisDone(s) && firstMeeting(s),
          '공동분석과 초회상담 예약 후 준비할 수 있습니다.',
        );
      if (stage === 4)
        demand(
          latestRecording(s),
          '완료한 상담의 녹취·전사문을 먼저 등록해 주세요.',
        );
      if (stage >= 5)
        demand(
          documentsDone(s),
          '솔루션 확정과 필수 서류 검토를 먼저 완료해 주세요.',
        );
      const body = txt(command, 'body', 80000, false);
      const attachment = upload ?? (command.fileId ? file() : undefined);
      demand(
        body.length >= 80 || attachment,
        '보고서 본문 80자 이상 또는 완성 파일이 필요합니다.',
      );
      if (stage === 3)
        demand(
          attachment && /\.(pptx|pdf)$/i.test(attachment.name),
          '3차 자료는 실제 PPTX 또는 발표용 PDF를 등록해 주세요.',
        );
      if (stage === 1 && attachment && /\.docx$/i.test(attachment.name))
        demand(
          body.length >= 80,
          'DOCX 1차 보고서는 4차 AI 분석을 위해 본문을 함께 입력하거나 PDF로 변환해 등록해 주세요.',
        );
      const report: FlowReport = {
        id: id('report'),
        stage,
        version: s.reports.filter((r) => r.stage === stage).length + 1,
        title: reportLabels[stage],
        body,
        fileId: attachment?.id,
        sourceReportId: stage > 1 ? latestReport(s, 1)?.id : undefined,
        sourceRecordingId: stage === 4 ? latestRecording(s)?.id : undefined,
        decisionId: stage >= 5 ? s.decision?.id : undefined,
        documentsKey: stage >= 5 ? documentsKey(s) : undefined,
        createdAt: now,
        createdBy: actor.name,
        origin: 'manual',
      };
      s.reports.push(report);
      if (stage === 1) s.analysis = { reportId: report.id };
      detail = `${report.title} V${report.version} 저장 · 담당 파트너 공유`;
      break;
    }
    case 'confirm_analysis': {
      const r = latestReport(s, 1);
      demand(r, '1차 보고서가 아직 없습니다.');
      demand(
        command.reportId === r.id,
        '최신 1차 보고서를 확인한 후 완료해 주세요.',
        409,
      );
      if (s.analysis.reportId !== r.id) s.analysis = { reportId: r.id };
      if (actor.role === 'admin') s.analysis.adminAt = now;
      else s.analysis.partnerAt = now;
      detail = `${actor.role === 'admin' ? '김성민 대표' : '담당 파트너'} 1차 분석 완료`;
      break;
    }
    case 'book_meeting': {
      const kind = txt(command, 'kind', 20) as FlowMeeting['kind'];
      const attendance = txt(
        command,
        'attendance',
        20,
      ) as FlowMeeting['attendance'];
      demand(
        ['first', 'followup', 'contract'].includes(kind) &&
          ['both', 'partner', 'admin'].includes(attendance),
        '상담 종류와 참석 방식을 확인해 주세요.',
      );
      if (kind === 'first')
        demand(
          analysisDone(s) && !firstMeeting(s) && attendance === 'both',
          '공동분석 완료 후 동반 초회상담을 예약할 수 있습니다.',
        );
      if (kind === 'followup')
        demand(
          firstMeeting(s)?.status === 'completed',
          '초회상담 완료 후 추가상담을 등록해 주세요.',
        );
      if (kind === 'contract')
        demand(
          signingPreparationDone(s) && !s.contract,
          '서류 검토와 5차·6차 준비 후 계약 상담을 잡아 주세요.',
        );
      const startsAt = dateTime(command, 'startsAt');
      const endsAt = dateTime(command, 'endsAt');
      demand(endsAt > startsAt, '상담 종료는 시작 이후여야 합니다.');
      demand(
        !s.meetings.some(
          (m) =>
            m.status === 'scheduled' &&
            startsAt < m.endsAt &&
            endsAt > m.startsAt,
        ),
        '이 진행의 다른 상담 일정과 겹칩니다.',
        409,
      );
      s.meetings.push({
        id: id('meeting'),
        kind,
        startsAt,
        endsAt,
        attendance,
        location: txt(command, 'location', 200),
        status: 'scheduled',
        note: txt(command, 'note', 1000, false),
        createdBy: actor.id,
      });
      detail = `${kind === 'first' ? '초회' : kind === 'contract' ? '계약' : '추가'} 상담 예약 · ${attendance === 'both' ? '동반' : attendance === 'partner' ? '파트너 단독' : '김성민 대표 단독'}`;
      break;
    }
    case 'complete_meeting':
    case 'cancel_meeting': {
      const m = s.meetings.find((m) => m.id === command.meetingId);
      demand(
        m && m.status === 'scheduled',
        '예정 상태의 상담을 선택해 주세요.',
      );
      demand(
        actor.role === 'admin' || actorCanAttend(actor, m),
        '해당 상담 참석자만 완료할 수 있습니다.',
        403,
      );
      if (type === 'complete_meeting') {
        demand(m.startsAt <= now, '미래 상담을 완료로 표시할 수 없습니다.');
        if (m.kind === 'first')
          demand(
            analysisDone(s) &&
              preparationDone(s) &&
              !s.jobs.some(
                (j) =>
                  j.stage === 1 && ['queued', 'processing'].includes(j.status),
              ),
            '공동분석과 2차·3차 준비를 먼저 완료해 주세요.',
          );
        m.status = 'completed';
        m.completedAt = now;
      } else m.status = 'cancelled';
      m.note = txt(command, 'note', 1500, false) || m.note;
      detail =
        type === 'complete_meeting' ? '실제 상담 완료 기록' : '상담 일정 취소';
      break;
    }
    case 'save_recording': {
      const meeting = s.meetings.find((m) => m.id === command.meetingId);
      demand(
        meeting?.status === 'completed',
        '실제 상담 완료 후 전사문을 등록해 주세요.',
      );
      demand(
        command.recordingConsent === true && command.privacyMasked === true,
        '녹취 활용 권한과 불필요한 개인정보 마스킹을 확인해 주세요.',
      );
      const transcript = txt(command, 'transcript', 60000, false);
      const isDocument = upload && /\.(docx|txt)$/i.test(upload.name);
      demand(
        upload || audioUpload || transcript.length >= 20,
        '20자 이상의 전사문 또는 보관할 음성파일이 필요합니다.',
      );
      demand(
        !isDocument || transcript.length >= 20,
        '문서에서 읽은 전사문 본문을 확인한 뒤 등록해 주세요.',
      );
      if (transcript) {
        demand(!transcriptProblem(transcript), transcriptProblem(transcript));
        demand(
          command.transcriptReviewed === true,
          '기업명·상담일·주요 금액과 전사문 내용을 확인해 주세요.',
        );
        demand(
          !s.recordings.some(
            (r) => r.meetingId === meeting.id && r.transcript === transcript,
          ),
          '같은 상담에 동일한 전사문이 이미 등록되어 있습니다. 기존 보고서 생성 상태를 확인해 주세요.',
          409,
        );
      }
      demand(
        !hasSensitiveIdentifier(transcript),
        '전사문의 식별번호·전화번호·이메일을 마스킹해 주세요.',
      );
      demand(
        !s.contract,
        '계약 후 추가 분석은 새 진행에서 관리해 주세요.',
        409,
      );
      const recording: FlowRecording = {
        id: id('recording'),
        meetingId: meeting.id,
        fileId: upload?.id,
        transcriptFileId: isDocument ? upload.id : undefined,
        audioFileId:
          audioUpload?.id ??
          (upload && /\.(mp3|m4a|wav)$/i.test(upload.name)
            ? upload.id
            : undefined),
        transcript,
        transcriptReviewedAt: transcript ? now : undefined,
        transcriptReviewedBy: transcript ? actor.id : undefined,
        consentAt: now,
        createdAt: now,
      };
      s.recordings.push(recording);
      createJob(s, 4, now, id('job'), recording);
      detail = transcript
        ? '확인한 상담 전사문 저장 · 4차 심화보고서 생성 요청'
        : '보조 음성 보관 · 전사문 대기 (음성 자동전사 미실행)';
      break;
    }
    case 'save_transcript': {
      const recording = s.recordings.find((r) => r.id === command.recordingId);
      demand(!s.contract, '계약 후 준비자료 변경은 제한됩니다.', 409);
      demand(
        recording && recording.id === latestRecording(s)?.id,
        '최신 녹취를 선택해 주세요.',
      );
      demand(
        command.recordingConsent === true && command.privacyMasked === true,
        '전사문 처리 권한과 마스킹을 확인해 주세요.',
      );
      demand(
        !s.jobs.some(
          (j) =>
            j.sourceRecordingId === recording.id &&
            (j.status === 'processing' || j.status === 'complete'),
        ),
        '이미 생성된 전사문은 새 녹취 버전으로 등록해 주세요.',
        409,
      );
      const transcript = txt(command, 'transcript', 60000);
      demand(!transcriptProblem(transcript), transcriptProblem(transcript));
      demand(
        command.transcriptReviewed === true,
        '기업명·상담일·주요 금액과 전사문 내용을 확인해 주세요.',
      );
      demand(
        recording.transcript !== transcript,
        '이미 저장된 전사문입니다. 기존 생성 상태를 확인해 주세요.',
        409,
      );
      recording.transcript = transcript;
      recording.transcriptReviewedAt = now;
      recording.transcriptReviewedBy = actor.id;
      if (upload) recording.transcriptFileId = upload.id;
      demand(
        recording.transcript.length >= 20 &&
          !hasSensitiveIdentifier(recording.transcript),
        '20자 이상 마스킹한 전사문을 입력해 주세요.',
      );
      const job = s.jobs
        .filter((j) => j.sourceRecordingId === recording.id)
        .at(-1);
      if (job) {
        job.status = s.ai.enabled ? 'queued' : 'blocked';
        job.reason = s.ai.enabled
          ? ''
          : '대표의 AI 자동생성 승인이 필요합니다.';
      }
      detail = '전사문 보완 · 4차 생성 준비';
      break;
    }
    case 'retry_job': {
      admin(actor);
      const job = s.jobs.find((j) => j.id === command.jobId);
      demand(
        job && ['blocked', 'failed', 'processing'].includes(job.status),
        '재시도할 생성 작업을 선택해 주세요.',
      );
      demand(
        job.status !== 'processing' ||
          Date.parse(now) - Date.parse(job.startedAt ?? now) > 180000,
        '생성이 진행 중입니다. 잠시 기다려 주세요.',
        409,
      );
      demand(
        command.costConsent === true && s.ai.enabled,
        '재시도 비용과 AI 자동생성 승인을 확인해 주세요.',
      );
      demand(
        !s.contract && (job.stage !== 1 || !firstMeeting(s)?.completedAt),
        '이미 후속 단계가 진행되어 이 작업을 재시도할 수 없습니다.',
        409,
      );
      if (job.stage === 4)
        demand(
          job.sourceRecordingId === latestRecording(s)?.id &&
            job.sourceReportId === latestReport(s, 1)?.id,
          '최신 녹취 버전의 생성 작업을 이용해 주세요.',
          409,
        );
      if (job.stage === 4)
        demand(
          s.recordings.find((r) => r.id === job.sourceRecordingId)?.transcript,
          '녹취 전사문을 먼저 등록해 주세요.',
        );
      job.status = 'queued';
      job.reason = '';
      job.startedAt = undefined;
      detail = '대표 확인 후 AI 생성 재시도';
      break;
    }
    case 'confirm_solutions': {
      admin(actor);
      demand(
        !s.contract,
        '계약 후 솔루션은 이 진행에서 변경할 수 없습니다.',
        409,
      );
      const report = deepReport(s);
      demand(
        report && command.reportId === report.id,
        '최신 4차 심화보고서를 검토해 주세요.',
      );
      demand(
        command.reviewConfirmed === true,
        '4차 보고서 검토 확인이 필요합니다.',
      );
      demand(
        Array.isArray(command.solutions) &&
          command.solutions.length > 0 &&
          command.solutions.length <= 12 &&
          command.solutions.every(
            (x) =>
              typeof x === 'string' && x.trim().length > 0 && x.length <= 80,
          ),
        '진행솔루션을 1개 이상 입력해 주세요.',
      );
      demand(
        typeof command.documentsNeeded === 'boolean',
        '추가 서류 필요 여부를 선택해 주세요.',
      );
      s.decision = {
        id: id('decision'),
        reportId: report.id,
        solutions: [
          ...new Set((command.solutions as string[]).map((x) => x.trim())),
        ],
        documentsNeeded: command.documentsNeeded,
        note: txt(command, 'note', 2000),
        at: now,
      };
      detail = '김성민 대표 진행솔루션 확정';
      break;
    }
    case 'request_document': {
      admin(actor);
      demand(!s.contract, '계약 준비 서류는 계약 전 등록해 주세요.', 409);
      const channel = txt(command, 'channel', 20) as FlowRequest['channel'];
      demand(
        ['카카오톡', '이메일', '기타'].includes(channel) &&
          typeof command.required === 'boolean',
        '전달 경로와 필수 여부를 확인해 주세요.',
      );
      s.requests.push({
        id: id('request'),
        title: txt(command, 'title', 150),
        required: command.required,
        channel,
        recipient: txt(command, 'recipient', 100),
        dueDate: dateOnly(command, 'dueDate', false),
        status: 'requested',
        note: '',
        createdAt: now,
      });
      detail = '추가 서류 요청 등록 · 실제 발송 전';
      break;
    }
    case 'mark_request_sent': {
      const request = s.requests.find((r) => r.id === command.requestId);
      demand(request, '서류요청을 선택해 주세요.');
      demand(command.sentConfirmed === true, '실제 발송 후 확인해 주세요.');
      request.sentAt = now;
      detail = `${request.channel} 서류요청 실제 발송 기록`;
      break;
    }
    case 'receive_document': {
      const request = s.requests.find((r) => r.id === command.requestId);
      demand(request, '서류요청을 선택해 주세요.');
      demand(!s.contract, '계약 후 준비서류 변경은 제한됩니다.', 409);
      const receivedFile = file();
      const startsReviewCycle =
        request.fileId !== receivedFile.id || request.status !== 'received';
      request.fileId = receivedFile.id;
      request.status = 'received';
      if (startsReviewCycle) {
        request.receivedAt = now;
        request.reviewedAt = undefined;
        request.verifiedAt = undefined;
      }
      request.note = txt(command, 'note', 1000, false);
      detail = '요청 서류 수령 · 대표 검토 대기';
      break;
    }
    case 'review_document': {
      admin(actor);
      demand(!s.contract, '계약 후 준비서류 변경은 제한됩니다.', 409);
      const request = s.requests.find((r) => r.id === command.requestId);
      demand(request?.fileId, '실제 첨부파일을 수령한 뒤 검토할 수 있습니다.');
      demand(
        typeof command.approved === 'boolean',
        '검토 결과를 선택해 주세요.',
      );
      request.status = command.approved ? 'verified' : 'needs_fix';
      request.note = txt(command, 'note', 1000, !command.approved);
      request.reviewedAt = now;
      request.verifiedAt = command.approved ? now : undefined;
      detail = command.approved ? '필수 서류 검토 완료' : '서류 보완 요청';
      break;
    }
    case 'record_contract': {
      demand(
        !s.contract && signingPreparationDone(s),
        '5차·6차 문서와 필수 서류 검토를 먼저 완료해 주세요.',
      );
      const meeting = s.meetings.find(
        (m) =>
          m.id === command.meetingId &&
          m.kind === 'contract' &&
          m.status !== 'cancelled',
      );
      demand(
        meeting && meeting.startsAt <= now,
        '실제 계약 상담 일정과 날짜를 확인해 주세요.',
      );
      demand(
        actor.role === 'admin' || actorCanAttend(actor, meeting),
        '계약 상담 참석자만 체결을 기록할 수 있습니다.',
        403,
      );
      demand(command.signedConfirmed === true, '실제 서명을 확인해 주세요.');
      const signedAt = dateOnly(command, 'signedAt');
      demand(
        signedAt <=
          new Date(Date.parse(now) + 9 * 3600000).toISOString().slice(0, 10),
        '미래 계약일을 기록할 수 없습니다.',
      );
      demand(
        file().purpose === 'signed_contract',
        '서명한 계약서 파일을 새로 첨부해 주세요.',
      );
      s.contract = {
        meetingId: meeting.id,
        reportId: latestReport(s, 6)!.id,
        signedFileId: file().id,
        signedAt,
        expectedDepositWon: won(command, 'expectedDepositWon'),
        recordedBy: actor.name,
      };
      meeting.status = 'completed';
      meeting.completedAt ??= now;
      detail = '서명본과 약정 계약금 등록 · 입금 확인 대기';
      break;
    }
    case 'confirm_payment': {
      admin(actor);
      demand(s.contract, '서명본과 약정 계약금을 먼저 등록해 주세요.');
      demand(command.paymentConfirmed === true, '입금 증빙 확인이 필요합니다.');
      const receivedAt = dateOnly(command, 'receivedAt');
      demand(
        receivedAt <=
          new Date(Date.parse(now) + 9 * 3600000).toISOString().slice(0, 10),
        '미래 입금을 확인할 수 없습니다.',
      );
      s.payments.push({
        id: id('payment'),
        amountWon: won(command, 'amountWon'),
        receivedAt,
        reference: txt(command, 'reference', 200),
        confirmedBy: actor.name,
        recordedAt: now,
      });
      if (depositComplete(s)) s.executionStartedAt ??= now;
      detail = depositComplete(s)
        ? '약정 계약금 입금 확인 완료 · 컨설팅 수행 시작'
        : '계약금 일부 입금 확인 · 잔액 대기';
      break;
    }
    case 'start_aftercare': {
      admin(actor);
      demand(
        depositComplete(s),
        '계약 체결과 약정 계약금 입금 확인이 필요합니다.',
      );
      demand(
        command.deliveryConfirmed === true,
        '컨설팅 수행 결과 확인이 필요합니다.',
      );
      s.aftercare = {
        at: now,
        summary: txt(command, 'summary', 3000),
        nextDate: dateOnly(command, 'nextDate'),
        owner: txt(command, 'owner', 100),
      };
      detail = '컨설팅 수행 결과 확인 · 사후관리 일정 등록';
      break;
    }
    default:
      throw new FlowError('지원하지 않는 업무 요청입니다.');
  }
  if (upload && !s.files.some((f) => f.id === upload.id)) s.files.push(upload);
  if (audioUpload && !s.files.some((f) => f.id === audioUpload.id))
    s.files.push(audioUpload);
  s.revision++;
  s.updatedAt = now;
  s.commandIds.push(commandId);
  s.audit.push({
    id: commandId,
    at: now,
    actor: actor.name,
    action: type,
    detail,
  });
  return s;
}
