'use client';
import { PartnerAuthPanel } from '@/components/partner-auth-panel';
import { PartnerPasswordLink } from '@/components/partner-password-link';
import { PartnerSignout } from '@/components/partner-signout';
import { assignmentMemberId, assignmentDisplayName, newTaskAssignment } from '@/lib/assignment-display';
import { prependApplicationCase, recordBelongsToCase } from '@/lib/application-case-links';
import { PortalSaveQueue, putPortalSnapshot } from '@/lib/portal-save-queue';
import { ApplicationSubmission } from '@/lib/application-submission';
import { uploadCompanyFile, type StoredCompanyFile } from '@/lib/company-file-upload';
import { draftCaseId, type ApplicationDraft, type DraftEnvelope } from '@/lib/application-draft';
import { ApplicationDetailFields, ApplicationDetailsSummary } from '@/components/application-details';
import { applicationServices, applicationCompanyMaxLength, emptyApplicationDetails, parseApplicationDetails, ApplicationDetailsError, type ApplicationDetails, type ApplicationField } from '@/lib/application-details';
/* oxlint-disable next/no-html-link-for-pages -- Sites authentication routes require native top-level navigation. */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bell,
  BrainCircuit,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  ExternalLink,
  FileCheck2,
  FilePlus2,
  FileText,
  FolderOpen,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  MessageSquarePlus,
  Plus,
  RefreshCw,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Trash2,
  Upload,
  UserCog,
  UserPlus,
  UserRoundCheck,
  Users,
  X,
} from 'lucide-react';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { hasDuplicateLoginEmail, isValidLoginEmail, normalizeLoginEmail } from '@/lib/member-email';
import { ConsultingWorkflow } from '@/components/consulting-workflow';
import { ApplicationAttachments } from '@/components/application-attachments';
import { AdminPartnerRegistration } from '@/components/admin-partner-registration';
import { AdminFileInventory } from '@/components/admin-file-inventory';
import { FileRecoveryNote } from '@/components/file-recovery-note';
import type { RecoveryControls } from '@/lib/file-recovery';
import { partnerTypes, type PartnerType, type PartnerAccount as TraineeMember, type PartnerRegistrationResult } from '@/lib/partner-registration';
import { companyCategoryLabel, companyFileProblem, documentCategoryFromFileName, applicationAttachmentTitle, MAX_APPLICATION_FILES, type ApplicationAttachment } from '@/lib/company-file-policy';

type View =
  | 'admin'
  | 'pipeline'
  | 'schedule'
  | 'tasks'
  | 'files'
  | 'ai-diagnosis'
  | 'trainee'
  | 'access'
  | 'application'
  | 'case'
  | 'workflow'
  | 'consultation'
  | 'documents';

type IconType = typeof LayoutDashboard;

const navItems: Array<{ view: View; label: string; icon: IconType }> = [
  { view: 'admin', label: '대표 대시보드', icon: LayoutDashboard },
  { view: 'pipeline', label: '전체 진행현황', icon: ClipboardList },
  { view: 'workflow', label: '상담 FLOW · 보고서', icon: BriefcaseBusiness },
  { view: 'schedule', label: '대표 상담일정', icon: CalendarDays },
  { view: 'tasks', label: '업무·알림', icon: ClipboardCheck },
  { view: 'files', label: '기업자료함', icon: FolderOpen },
  { view: 'ai-diagnosis', label: 'AI 진단 사전점검', icon: BrainCircuit },
  { view: 'trainee', label: '파트너 화면', icon: Users },
  { view: 'access', label: '파트너 계정관리', icon: UserCog },
  { view: 'application', label: '새 협업신청', icon: FilePlus2 },
  { view: 'case', label: '컨설팅 진행 현황', icon: BriefcaseBusiness },
  { view: 'consultation', label: '상담 등록', icon: MessageSquarePlus },
  { view: 'documents', label: '서류요청 등록', icon: FileCheck2 },
];

type ScheduleItem = {
  id: string;
  isoDate?: string;
  endIsoDate?: string;
  date: string;
  weekday: string;
  time: string;
  end: string;
  company: string;
  service: string;
  method: string;
  status: string;
  tone: string;
  source: 'partner' | 'google';
  private?: boolean;
  assignedTrainee?: string;
  shareMode: 'all_with_assignee' | 'all_busy' | 'private';
};

type ConsultationPayload = {
  followUps: string[];
  calendarSync: boolean;
  title: string;
  startsAt: string;
  method: string;
  status: string;
  shareMode: 'all_with_assignee' | 'all_busy' | 'private';
};

type WorkTask = {
  id: string;
  company: string;
  title: string;
  kind: '서류요청' | '상담' | '견적서' | '계약서' | '사후관리' | '내부업무';
  assignee: string;
  partnerMemberId?: string;
  caseId?: string;
  due: string;
  dueState: 'overdue' | 'today' | 'upcoming';
  status: '대기' | '진행' | '완료';
  priority: '긴급' | '보통';
  related: string;
};

type CompanyDocument = {
  recovery?: unknown;
  id: string;
  company: string;
  title: string;
  category: '사업자등록증' | '크레탑' | '재무제표' | '상담녹취' | '인증·특허' | '계약자료' | '요청서류' | '기타자료';
  fileName?: string;
  storageFileId?: string;
  fileSize?: number;
  status: '요청중' | '제출완료' | '보완필요' | '검토완료';
  assignedTrainee: string;
  partnerMemberId?: string;
  caseId?: string;
  submittedBy: string;
  updatedAt: string;
  dueDate?: string;
  version: string;
  sensitive: boolean;
};

type DocumentRequestPayload = {
  items: Array<{ name: string; required: boolean }>;
  dueDate: string;
};

function formatKoreanDate(dateValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number);
  if (!year || !month || !day) return dateValue;
  return `${year}. ${month}. ${day}.`;
}

type PipelineStage = '접수' | '기업진단' | '상담예약' | '상담진행' | '계약' | '컨설팅수행' | '사후관리';

type CollaborationCase = {
  id: string;
  company: string;
  service: string;
  trainee: string;
  applicantType?: PartnerType;
  applicationDetails?: ApplicationDetails;
  applicationDraftRevision?: number;
  partnerMemberId?: string;
  flowManaged?: boolean;
  flowPhase?: string;
  stage: PipelineStage;
  consultationCount: number;
  nextAction: string;
  updatedAt: string;
  idleDays: number;
  urgent: boolean;
};

type DiagnosisLevel = 'A' | 'B' | 'C';
type DiagnosisDecision = '1차 초안 생성 가능' | 'Step 0·보완요청' | 'AI 처리 중단';
type DiagnosisStatus = '사전점검 완료' | '대표 검토 대기' | '보완자료 대기' | '처리 중단';
type DiagnosisCheckStatus = '통과' | '확인필요' | '차단';

type DiagnosisAssessment = {
  id: string;
  caseId: string;
  company: string;
  identityStatus: '일치' | '확인필요' | '불일치';
  hasConsultationEvidence: boolean;
  privacyMasked: boolean;
  personalDataConsent: boolean;
  thirdPartyAiConsent: boolean;
  transcriptConsent: boolean;
  level: DiagnosisLevel;
  decision: DiagnosisDecision;
  status: DiagnosisStatus;
  updatedAt: string;
};

type DiagnosisCheck = {
  id: string;
  label: string;
  status: DiagnosisCheckStatus;
  detail: string;
};

type AiIntegrationReadiness = {
  provider: string;
  directProjectConnection: boolean;
  instructionImported: boolean;
  instructionVersion: string;
  apiKeyConfigured: boolean;
  modelConfigured: boolean;
  model?: string | null;
  sourceStorageConfigured: boolean;
  generationEnabled: boolean;
  nextAction: string;
};

type StepZeroReport = {
  companyOverview: string;
  confirmedStrengths: string[];
  mainRisks: string[];
  solutionCandidates: Array<{ solution: string; basis: string; condition: string }>;
  verificationQuestions: string[];
  missingDocuments: string[];
  complianceNotes: string[];
  nextAction: string;
};

type StepZeroRun = {
  id: string;
  caseId: string;
  company: string;
  stage: 'Step 0';
  status: '대표 검토 대기';
  instructionVersion: string;
  model: string;
  result: StepZeroReport;
  usage: { inputTokens: number; outputTokens: number };
  createdAt: string;
};

function partnerTypeOf(member: TraineeMember): PartnerType {
  const rawType = (member as { memberType?: string }).memberType;
  if (rawType === '타사 컨설턴트' || rawType === '보험설계사' || rawType === '기타' || rawType === '한기평 컨설턴트') return rawType;
  if (rawType === '타사 보험사 대표' || rawType === '타사 보험설계사') return '보험설계사';
  return '한기평 컨설턴트';
}

function partnerDetail(member: TraineeMember) {
  return member.affiliation ? `${partnerTypeOf(member)} · ${member.affiliation}` : partnerTypeOf(member);
}

function casePartnerType(item: CollaborationCase, members: TraineeMember[]): PartnerType {
  if (item.applicantType) return item.applicantType;
  const memberId = assignmentMemberId(item, item.trainee, members);
  const member = members.find(candidate => candidate.id === memberId);
  return member ? partnerTypeOf(member) : '한기평 컨설턴트';
}

type TimelineItem = {
  caseId?: string;
  date: string;
  title: string;
  detail: string;
  type: string;
  tone: string;
};

type PortalState = {
  version: 1;
  consultationNumber: number;
  timeline: TimelineItem[];
  schedule: ScheduleItem[];
  tasks: WorkTask[];
  companyDocuments: CompanyDocument[];
  cases: CollaborationCase[];
  members: TraineeMember[];
  membersRevision?: number;
  diagnosisAssessments?: DiagnosisAssessment[];
};

type PortalUser = {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'trainee';
  memberId: string | null;
  memberName: string | null;
  permissions: TraineeMember['permissions'] | null;
  authMethod?: 'password' | 'chatgpt';
};

function isPortalState(value: unknown): value is PortalState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Partial<PortalState>;
  return state.version === 1
    && typeof state.consultationNumber === 'number'
    && Array.isArray(state.timeline)
    && Array.isArray(state.schedule)
    && Array.isArray(state.tasks)
    && Array.isArray(state.companyDocuments)
    && Array.isArray(state.cases)
    && Array.isArray(state.members);
}

const sampleTrainees: TraineeMember[] = [
  {
    id: 'trainee-1',
    name: '박지현(가상)',
    email: 'jihyun.park@example.com',
    cohort: '12기',
    memberType: '한기평 컨설턴트',
    role: '교육생',
    status: '활성',
    companies: 6,
    permissions: { sharedSchedule: true, collaborationApply: true, ownCases: true, fileUpload: true, quoteContract: false },
  },
  {
    id: 'trainee-2',
    name: '이준호(가상)',
    email: 'junho.lee@example.com',
    cohort: '',
    memberType: '타사 컨설턴트',
    role: '리더 파트너',
    status: '활성',
    companies: 9,
    permissions: { sharedSchedule: true, collaborationApply: true, ownCases: true, fileUpload: true, quoteContract: true },
  },
  {
    id: 'trainee-3',
    name: '최서윤(가상)',
    email: 'seoyun.choi@example.com',
    cohort: '',
    memberType: '보험설계사',
    role: '일반 파트너',
    status: '승인대기',
    companies: 0,
    permissions: { sharedSchedule: true, collaborationApply: true, ownCases: true, fileUpload: true, quoteContract: false },
  },
  {
    id: 'trainee-4',
    name: '정민수(가상)',
    email: 'minsu.jung@example.com',
    cohort: '',
    memberType: '기타',
    role: '일반 파트너',
    status: '정지',
    companies: 2,
    permissions: { sharedSchedule: false, collaborationApply: false, ownCases: true, fileUpload: false, quoteContract: false },
  },
];

const sampleTasks: WorkTask[] = [
  { id: 'task-1', company: '세림테크(가상)', title: '최근 재무제표 제출 여부 확인', kind: '서류요청', assignee: '박지현', due: '오늘 16:00', dueState: 'today', status: '진행', priority: '긴급', related: '서류요청 #1' },
  { id: 'task-2', company: '미래에코(가상)', title: '대표 상담 가능시간 3개 전달', kind: '상담', assignee: '박지현', due: '09.01', dueState: 'upcoming', status: '대기', priority: '보통', related: '상담 일정 요청' },
  { id: 'task-3', company: '가온푸드(가상)', title: '기업인증 보완서류 2건 검토', kind: '서류요청', assignee: '이준호', due: '오늘 18:00', dueState: 'today', status: '대기', priority: '긴급', related: '서류요청 #2' },
  { id: 'task-4', company: '세림테크(가상)', title: '견적서 V1 범위·금액 승인', kind: '견적서', assignee: '김성민 대표', due: '오늘', dueState: 'today', status: '대기', priority: '긴급', related: '상담 #3' },
  { id: 'task-5', company: '더원로지스(가상)', title: '법인전환 추가상담 일정 확정', kind: '상담', assignee: '이준호', due: '09.02', dueState: 'upcoming', status: '진행', priority: '보통', related: '상담 #2' },
  { id: 'task-6', company: '한빛솔루션(가상)', title: '계약서 내부 검토 의견 반영', kind: '계약서', assignee: '김성민 대표', due: '08.28', dueState: 'overdue', status: '대기', priority: '긴급', related: '계약서 V1' },
  { id: 'task-7', company: '세림테크(가상)', title: '상담 후 요청자료 목록 발송', kind: '서류요청', assignee: '박지현', due: '08.29', dueState: 'today', status: '완료', priority: '보통', related: '상담 #2' },
];

const sampleDocuments: CompanyDocument[] = [
  { id: 'file-1', company: '세림테크(가상)', title: '사업자등록증', category: '사업자등록증', fileName: '세림테크_사업자등록증.pdf', status: '검토완료', assignedTrainee: '박지현', submittedBy: '박지현', updatedAt: '08.29 09:30', version: 'V1', sensitive: true },
  { id: 'file-2', company: '세림테크(가상)', title: '크레탑 기업정보', category: '크레탑', fileName: '세림테크_Cretop_2026.pdf', status: '제출완료', assignedTrainee: '박지현', submittedBy: '박지현', updatedAt: '08.29 10:15', version: 'V1', sensitive: true },
  { id: 'file-3', company: '세림테크(가상)', title: '최근 3개년 재무제표', category: '재무제표', status: '요청중', assignedTrainee: '박지현', submittedBy: '기업대표 요청', updatedAt: '08.30 제출기한', version: '-', sensitive: true },
  { id: 'file-4', company: '미래에코(가상)', title: '기업부설연구소 인정서', category: '인증·특허', fileName: '연구소_인정서.pdf', status: '보완필요', assignedTrainee: '박지현', submittedBy: '박지현', updatedAt: '08.28 17:40', version: 'V1', sensitive: false },
  { id: 'file-5', company: '가온푸드(가상)', title: '사업자등록증', category: '사업자등록증', fileName: '가온푸드_사업자등록증.jpg', status: '제출완료', assignedTrainee: '이준호', submittedBy: '이준호', updatedAt: '08.29 11:20', version: 'V1', sensitive: true },
  { id: 'file-6', company: '더원로지스(가상)', title: '법인전환 검토자료', category: '계약자료', status: '요청중', assignedTrainee: '이준호', submittedBy: '기업대표 요청', updatedAt: '09.02 제출기한', version: '-', sensitive: true },
];

const pipelineStages: PipelineStage[] = ['접수', '기업진단', '상담예약', '상담진행', '계약', '컨설팅수행', '사후관리'];

const stageNextActions: Record<PipelineStage, string> = {
  접수: '담당자 배정 및 기본자료 확인',
  기업진단: '기업진단보고서 준비',
  상담예약: '김성민 대표 상담일 확정',
  상담진행: '다음 상담·서류·견적 판단',
  계약: '경영자문용역계약 조건 확정',
  컨설팅수행: '확정 솔루션 수행 및 결과 확인',
  사후관리: '정기점검 및 추가 제안',
};

const sampleCases: CollaborationCase[] = [
  { id: 'case-1', company: '세림테크(가상)', service: '정책자금 · 특허', trainee: '박지현', stage: '상담진행', consultationCount: 3, nextAction: '견적서 V1 대표 승인', updatedAt: '오늘', idleDays: 2, urgent: true },
  { id: 'case-2', company: '미래에코(가상)', service: '기업인증', trainee: '박지현', stage: '기업진단', consultationCount: 0, nextAction: '진단보고서 초안 확인', updatedAt: '어제', idleDays: 6, urgent: false },
  { id: 'case-3', company: '한빛솔루션(가상)', service: '부동산 프로젝트', trainee: '박지현', stage: '접수', consultationCount: 0, nextAction: '기본자료 수신 확인', updatedAt: '오늘', idleDays: 1, urgent: false },
  { id: 'case-4', company: '가온푸드(가상)', service: '기업인증', trainee: '이준호', stage: '상담예약', consultationCount: 0, nextAction: '대표 일정 3개 전달', updatedAt: '08.20', idleDays: 9, urgent: true },
  { id: 'case-5', company: '더원로지스(가상)', service: '영업권·법인전환', trainee: '이준호', stage: '상담진행', consultationCount: 2, nextAction: '추가상담 일정 확정', updatedAt: '08.27', idleDays: 3, urgent: false },
  { id: 'case-6', company: '네오바이오(가상)', service: '특허·지식재산', trainee: '이준호', stage: '계약', consultationCount: 4, nextAction: '계약조건 최종 확인', updatedAt: '08.17', idleDays: 12, urgent: true },
  { id: 'case-7', company: '씨앤에프(가상)', service: 'CEO 자산관리', trainee: '박지현', stage: '사후관리', consultationCount: 2, nextAction: '분기 점검일 등록', updatedAt: '08.24', idleDays: 5, urgent: false },
  { id: 'case-8', company: '진성산업(가상)', service: '정책자금', trainee: '이준호', stage: '기업진단', consultationCount: 0, nextAction: '부채현황 보완자료 요청', updatedAt: '08.19', idleDays: 10, urgent: true },
  { id: 'case-9', company: '스마트랩(가상)', service: '기업부설연구소', trainee: '박지현', stage: '상담진행', consultationCount: 1, nextAction: '연구전담요원 요건 확인', updatedAt: '08.21', idleDays: 8, urgent: true },
  { id: 'case-10', company: '온유테크(가상)', service: '보험 법인영업', trainee: '이준호', stage: '접수', consultationCount: 0, nextAction: '기업대표 연락처 확인', updatedAt: '어제', idleDays: 2, urgent: false },
];

const sampleDiagnosisAssessments: DiagnosisAssessment[] = [
  {
    id: 'diagnosis-1',
    caseId: 'case-1',
    company: '세림테크(가상)',
    identityStatus: '일치',
    hasConsultationEvidence: true,
    privacyMasked: true,
    personalDataConsent: true,
    thirdPartyAiConsent: true,
    transcriptConsent: true,
    level: 'A',
    decision: '1차 초안 생성 가능',
    status: '사전점검 완료',
    updatedAt: '가상 판정 완료',
  },
  {
    id: 'diagnosis-2',
    caseId: 'case-4',
    company: '가온푸드(가상)',
    identityStatus: '일치',
    hasConsultationEvidence: true,
    privacyMasked: true,
    personalDataConsent: true,
    thirdPartyAiConsent: true,
    transcriptConsent: true,
    level: 'B',
    decision: 'Step 0·보완요청',
    status: '보완자료 대기',
    updatedAt: '가상 판정 완료',
  },
  {
    id: 'diagnosis-3',
    caseId: 'case-3',
    company: '한빛솔루션(가상)',
    identityStatus: '불일치',
    hasConsultationEvidence: true,
    privacyMasked: false,
    personalDataConsent: true,
    thirdPartyAiConsent: false,
    transcriptConsent: false,
    level: 'C',
    decision: 'AI 처리 중단',
    status: '처리 중단',
    updatedAt: '가상 판정 완료',
  },
];

function diagnosisChecks(
  assessment: DiagnosisAssessment,
  documents: CompanyDocument[],
): DiagnosisCheck[] {
  const usableDocuments = documents.filter((document) =>
    document.company === assessment.company
    && (document.caseId == null || document.caseId === assessment.caseId)
    && (document.status === '제출완료' || document.status === '검토완료'),
  );
  const hasBusinessCertificate = usableDocuments.some((document) => document.category === '사업자등록증');
  const hasFinancialBasis = usableDocuments.some((document) => document.category === '크레탑' || document.category === '재무제표');

  return [
    {
      id: 'business-certificate',
      label: '사업자등록증',
      status: hasBusinessCertificate ? '통과' : '확인필요',
      detail: hasBusinessCertificate ? '제출·검토 가능한 파일이 있습니다.' : '기업 기본정보 확인용 파일이 필요합니다.',
    },
    {
      id: 'financial-basis',
      label: '재무·신용 근거',
      status: hasFinancialBasis ? '통과' : '확인필요',
      detail: hasFinancialBasis ? '크레탑 또는 재무제표가 확인됩니다.' : '크레탑 또는 최근 재무자료 보완이 필요합니다.',
    },
    {
      id: 'consultation-evidence',
      label: '대표 통화·상담 맥락',
      status: assessment.hasConsultationEvidence ? '통과' : '확인필요',
      detail: assessment.hasConsultationEvidence ? '가상 상담요약 또는 녹취 근거가 있습니다.' : '대표 요청사항을 확인할 상담요약이 필요합니다.',
    },
    {
      id: 'identity',
      label: '기업 식별정보 일치',
      status: assessment.identityStatus === '일치' ? '통과' : assessment.identityStatus === '불일치' ? '차단' : '확인필요',
      detail: assessment.identityStatus === '일치' ? '기업명·대표자 등 핵심 식별정보가 일치합니다.' : assessment.identityStatus === '불일치' ? '자료 간 식별정보 충돌을 해소해야 합니다.' : '식별정보 대조 확인이 필요합니다.',
    },
    {
      id: 'privacy-masking',
      label: '민감정보 마스킹',
      status: assessment.privacyMasked ? '통과' : '차단',
      detail: assessment.privacyMasked ? '가상 자료의 불필요한 민감정보가 제거된 상태입니다.' : '주민번호·계좌·신용정보 등 불필요한 정보 제거가 필요합니다.',
    },
    {
      id: 'personal-data-consent',
      label: '개인정보 처리 동의',
      status: assessment.personalDataConsent ? '통과' : '차단',
      detail: assessment.personalDataConsent ? '개인정보 처리 동의가 확인되었습니다.' : '동의 전에는 AI 진단을 진행할 수 없습니다.',
    },
    {
      id: 'ai-consent',
      label: '제3자 AI 처리 동의',
      status: assessment.thirdPartyAiConsent ? '통과' : '차단',
      detail: assessment.thirdPartyAiConsent ? '외부 AI 처리 동의가 확인되었습니다.' : '외부 AI 전송 전 별도 동의가 필요합니다.',
    },
    {
      id: 'transcript-consent',
      label: '녹취자료 활용 동의',
      status: !assessment.hasConsultationEvidence ? '확인필요' : assessment.transcriptConsent ? '통과' : '차단',
      detail: !assessment.hasConsultationEvidence ? '녹취자료가 등록되면 동의 여부를 확인합니다.' : assessment.transcriptConsent ? '가상 녹취 활용 동의가 확인되었습니다.' : '녹취 전송·분석 동의 확인이 필요합니다.',
    },
  ];
}

function evaluateDiagnosis(
  assessment: DiagnosisAssessment,
  documents: CompanyDocument[],
): DiagnosisAssessment {
  const checks = diagnosisChecks(assessment, documents);
  const hasBlocked = checks.some((check) => check.status === '차단');
  const hasNeedsReview = checks.some((check) => check.status === '확인필요');
  const level: DiagnosisLevel = hasBlocked ? 'C' : hasNeedsReview ? 'B' : 'A';

  return {
    ...assessment,
    level,
    decision: level === 'A' ? '1차 초안 생성 가능' : level === 'B' ? 'Step 0·보완요청' : 'AI 처리 중단',
    status: level === 'A' ? '사전점검 완료' : level === 'B' ? '보완자료 대기' : '처리 중단',
    updatedAt: '방금 전 · 가상 판정',
  };
}

function readableFileSize(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

const sampleSchedule: ScheduleItem[] = [
  {
    id: 'schedule-1',
    date: '09.02',
    weekday: '수',
    time: '10:00',
    end: '11:00',
    company: '세림테크(가상)',
    service: '정책자금 1차 상담',
    method: '화상',
    status: '확정',
    tone: 'green',
    source: 'partner',
    assignedTrainee: '박지현',
    shareMode: 'all_with_assignee',
  },
  {
    id: 'schedule-2',
    date: '09.02',
    weekday: '수',
    time: '14:30',
    end: '15:30',
    company: '가온푸드(가상)',
    service: '기업인증 상담',
    method: '전화',
    status: '확정',
    tone: 'blue',
    source: 'partner',
    assignedTrainee: '이준호',
    shareMode: 'all_with_assignee',
  },
  {
    id: 'schedule-3',
    date: '09.03',
    weekday: '목',
    time: '16:30',
    end: '17:30',
    company: '개인 일정',
    service: '내용 비공개',
    method: 'Google 일정',
    status: '바쁨',
    tone: 'slate',
    source: 'google',
    private: true,
    shareMode: 'all_busy',
  },
  {
    id: 'schedule-4',
    date: '09.04',
    weekday: '금',
    time: '11:00',
    end: '12:00',
    company: '더원로지스(가상)',
    service: '영업권·법인전환 상담',
    method: '방문',
    status: '일정요청',
    tone: 'amber',
    source: 'partner',
    assignedTrainee: '박지현',
    shareMode: 'all_with_assignee',
  },
  {
    id: 'schedule-5',
    date: '09.07',
    weekday: '월',
    time: '21:30',
    end: '23:00',
    company: '개인 일정',
    service: '내용 비공개',
    method: 'Google 일정',
    status: '바쁨',
    tone: 'slate',
    source: 'google',
    private: true,
    shareMode: 'all_busy',
  },
];

const baseTimeline: TimelineItem[] = [
  {
    date: '08.29 09:20',
    title: '협업신청 접수',
    detail: '정책자금 · 특허 요청 / 주관 파트너 박지현',
    type: '접수',
    tone: 'navy',
  },
  {
    date: '08.30 14:10',
    title: '서류요청 #1',
    detail: '최근 재무제표 외 2건 / 2건 미제출',
    type: '서류',
    tone: 'amber',
  },
  {
    date: '09.02 11:00',
    title: '상담 #1 완료',
    detail: '정책자금 신청방향 확인 / 후속: 견적서 작성',
    type: '상담',
    tone: 'blue',
  },
  {
    date: '09.03 16:40',
    title: '견적서 V1 내부검토',
    detail: '정책자금 사전진단 및 신청지원 / 대표 승인 대기',
    type: '견적',
    tone: 'violet',
  },
];

const services = applicationServices;

const metricData = [
  { label: '신규 접수', value: '12', hint: '어제보다 3건 증가', icon: ClipboardList },
  { label: '서류 보완 필요', value: '8', hint: '오늘 3건 마감', icon: FileCheck2 },
  { label: '이번 주 상담', value: '15', hint: '오늘 4건 예정', icon: CalendarDays },
  { label: '계약 검토', value: '4', hint: '대표 승인 2건', icon: FileText },
];

function BrandMark() {
  return (
    <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-[#15375b] shadow-sm">
      <Building2 className="size-5" aria-hidden="true" />
    </div>
  );
}

function PrimaryButton({
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0877b8] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#06679f] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-200 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-100 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function Pill({ children, tone = 'slate' }: { children: React.ReactNode; tone?: string }) {
  const colors: Record<string, string> = {
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
    navy: 'border-blue-200 bg-blue-50 text-[#15375b]',
    blue: 'border-sky-200 bg-sky-50 text-sky-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    violet: 'border-violet-200 bg-violet-50 text-violet-800',
    red: 'border-red-200 bg-red-50 text-red-700',
  };

  return (
    <span className={`inline-flex min-h-6 w-fit items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${colors[tone] ?? colors.slate}`}>
      {children}
    </span>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-800">
        {label}
        {required ? <span className="ml-1 text-red-600">*</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1.5 block text-xs leading-5 text-slate-500">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#0877b8] focus:ring-4 focus:ring-sky-100';

function PageIntro({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="text-sm font-semibold text-[#0877b8]">{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
      </div>
      {action}
    </div>
  );
}

function DiagnosisPreflight({
  assessments,
  setAssessments,
  cases,
  documents,
  onOpenFiles,
  onRequestDocuments,
  onQueueDraft,
  notify,
}: {
  assessments: DiagnosisAssessment[];
  setAssessments: React.Dispatch<React.SetStateAction<DiagnosisAssessment[]>>;
  cases: CollaborationCase[];
  documents: CompanyDocument[];
  onOpenFiles: () => void;
  onRequestDocuments: (caseId: string) => void;
  onQueueDraft: (assessment: DiagnosisAssessment) => void;
  notify: (message: string) => void;
}) {
  const [selectedId, setSelectedId] = useState(assessments[0]?.id ?? '');
  const [integrationReadiness, setIntegrationReadiness] = useState<AiIntegrationReadiness | null>(null);
  const [integrationStatus, setIntegrationStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pilotContext, setPilotContext] = useState('업종: 산업용 센서 제조\n업력: 4년\n요청사항: 정책자금과 기업부설연구소 가능성 검토\n매출·신용·부채·인력 현황: 확인 필요');
  const [pilotConsent, setPilotConsent] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<'idle' | 'loading' | 'success'>('idle');
  const [generationError, setGenerationError] = useState('');
  const [stepZeroRun, setStepZeroRun] = useState<StepZeroRun | null>(null);
  const selected = assessments.find((assessment) => assessment.id === selectedId) ?? assessments[0];
  const levelMeta: Record<DiagnosisLevel, { label: string; tone: string; panel: string; guidance: string }> = {
    A: {
      label: 'A · 초안 생성 가능',
      tone: 'green',
      panel: 'border-emerald-200 bg-emerald-50/70',
      guidance: '필수 자료와 동의 항목이 통과되어 Step 0 사전가설과 1차 정밀진단 초안 생성 대기열에 등록할 수 있습니다.',
    },
    B: {
      label: 'B · 보완 후 진행',
      tone: 'amber',
      panel: 'border-amber-200 bg-amber-50/70',
      guidance: '차단 사유는 없지만 핵심 근거가 부족합니다. Step 0까지만 정리하고 부족한 자료를 요청합니다.',
    },
    C: {
      label: 'C · AI 처리 중단',
      tone: 'red',
      panel: 'border-red-200 bg-red-50/70',
      guidance: '동의·마스킹·기업 식별정보 중 차단 항목이 있습니다. 해소 전에는 외부 AI로 자료를 전송하지 않습니다.',
    },
  };

  useEffect(() => {
    let active = true;

    async function loadIntegrationReadiness() {
      try {
        const response = await fetch('/api/ai-diagnosis/readiness', { cache: 'no-store' });
        const payload = await response.json() as AiIntegrationReadiness & { error?: string };
        if (!response.ok) throw new Error(payload.error || 'AI 연동 준비상태를 확인하지 못했습니다.');
        if (!active) return;
        setIntegrationReadiness(payload);
        setIntegrationStatus('ready');
      } catch {
        if (active) setIntegrationStatus('error');
      }
    }

    void loadIntegrationReadiness();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selected?.caseId) return;
    let active = true;
    async function loadLatestRun() {
      try {
        const response = await fetch(`/api/ai-diagnosis/step-zero?caseId=${encodeURIComponent(selected.caseId)}`, { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json() as { run?: StepZeroRun | null };
        if (active) setStepZeroRun(payload.run ?? null);
      } catch {
        if (active) setStepZeroRun(null);
      }
    }
    void loadLatestRun();
    return () => {
      active = false;
    };
  }, [selected?.caseId]);

  if (!selected) {
    return <Card><CardContent className="py-12 text-center text-sm text-slate-500">등록된 가상 사전점검이 없습니다.</CardContent></Card>;
  }

  const checks = diagnosisChecks(selected, documents);
  const blockers = checks.filter((check) => check.status === '차단');
  const needsReview = checks.filter((check) => check.status === '확인필요');
  const selectedCaseExists = cases.some((item) => item.id === selected.caseId);

  function selectAssessment(assessment: DiagnosisAssessment) {
    const service = cases.find((item) => item.id === assessment.caseId)?.service ?? '기업컨설팅';
    setSelectedId(assessment.id);
    setPilotContext(`업종: 테스트용 제조·서비스 기업\n업력: 확인 필요\n요청사항: ${service} 가능성 검토\n매출·신용·부채·인력 현황: 확인 필요\n주의: 모든 정보는 기능 검증을 위한 가상정보`);
    setPilotConsent(false);
    setGenerationError('');
    setGenerationStatus('idle');
  }

  function runAssessment(assessmentId: string) {
    setAssessments((current) => current.map((assessment) =>
      assessment.id === assessmentId ? evaluateDiagnosis(assessment, documents) : assessment,
    ));
    notify(`${selected.company} A·B·C 가상 판정을 다시 실행했습니다.`);
  }

  function runAllAssessments() {
    setAssessments((current) => current.map((assessment) => evaluateDiagnosis(assessment, documents)));
    notify('가상 기업 3건의 AI 진단 사전점검을 다시 실행했습니다.');
  }

  async function generatePilotStepZero() {
    if (!integrationReadiness?.generationEnabled) {
      setGenerationError('Anthropic API 키와 Claude 모델 연결이 필요합니다.');
      return;
    }
    if (selected.level !== 'A' || !selected.company.includes('(가상)')) {
      setGenerationError('A 판정의 가상기업만 Step 0 시험을 실행할 수 있습니다.');
      return;
    }
    if (!pilotConsent) {
      setGenerationError('가상자료 확인과 외부 AI 시험 동의가 필요합니다.');
      return;
    }
    setGenerationStatus('loading');
    setGenerationError('');
    try {
      const response = await fetch('/api/ai-diagnosis/step-zero', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          caseId: selected.caseId,
          company: selected.company,
          pilotContext,
          pilotMode: true,
          consentConfirmed: true,
        }),
      });
      const payload = await response.json() as { run?: StepZeroRun; error?: string };
      if (!response.ok || !payload.run) throw new Error(payload.error || 'Step 0 생성에 실패했습니다.');
      setStepZeroRun(payload.run);
      setGenerationStatus('success');
      notify(`${selected.company} Step 0 가상 초안을 생성해 대표 검토대기에 저장했습니다.`);
    } catch (error) {
      setGenerationStatus('idle');
      setGenerationError(error instanceof Error ? error.message : 'Step 0 생성에 실패했습니다.');
    }
  }

  return (
    <div>
      <PageIntro
        eyebrow="AI DIAGNOSIS GATE"
        title="AI 진단 사전점검"
        description="사업자등록증·크레탑·재무자료·대표 상담 맥락과 동의 상태를 먼저 확인한 뒤, 1차 정밀진단보고서 초안 생성 가능 여부를 A·B·C로 분류합니다."
        action={<SecondaryButton onClick={runAllAssessments}><RefreshCw className="size-4" aria-hidden="true" /> 전체 가상 판정</SecondaryButton>}
      />

      <div role="note" className="mb-5 flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-950">
        <BrainCircuit className="mt-0.5 size-5 shrink-0 text-[#0877b8]" aria-hidden="true" />
        <div><strong>현재 자동생성 범위는 가상기업 Step 0 시험까지입니다.</strong> 실제 고객 원본파일은 외부 AI로 전송하지 않습니다. A 판정·마스킹·제3자 AI 동의·김성민 대표 실행을 모두 통과한 가상 텍스트만 Claude 시험 대상으로 사용합니다.</div>
      </div>

      <Card className="mb-5 border-0 shadow-sm ring-1 ring-slate-200">
        <CardHeader className="border-b border-slate-100">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div><CardTitle>Claude 상담 FLOW 연동 준비</CardTitle><CardDescription className="mt-1">Claude 웹 프로젝트를 직접 호출하지 않고, 확인된 지침을 서버 프롬프트로 이식해 Anthropic API로 연결합니다.</CardDescription></div>
            <Pill tone={integrationReadiness?.generationEnabled ? 'green' : integrationStatus === 'error' ? 'red' : 'amber'}>{integrationReadiness?.generationEnabled ? '생성 준비완료' : integrationStatus === 'error' ? '상태 확인 오류' : integrationStatus === 'loading' ? '확인 중' : '연결 준비중'}</Pill>
          </div>
        </CardHeader>
        <CardContent className="py-5">
          {integrationStatus === 'error' ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">연동 준비상태를 불러오지 못했습니다. 로그인 권한과 서버 연결을 확인해 주세요.</div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  { label: '상담 FLOW 지침', ready: Boolean(integrationReadiness?.instructionImported), readyText: '서버 이식 완료', waitText: '이식 대기' },
                  { label: 'Anthropic API 키', ready: Boolean(integrationReadiness?.apiKeyConfigured), readyText: '보안 연결됨', waitText: '연결 필요' },
                  { label: '사용 모델', ready: Boolean(integrationReadiness?.modelConfigured), readyText: integrationReadiness?.model ?? '모델 지정됨', waitText: '모델 지정 필요' },
                  { label: '기업 원본파일 저장소', ready: Boolean(integrationReadiness?.sourceStorageConfigured), readyText: '격리 저장소 연결됨', waitText: '저장소 연결 필요' },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex items-center justify-between gap-2"><p className="text-xs font-bold text-slate-500">{item.label}</p><span className={`grid size-7 place-items-center rounded-full ${item.ready ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{item.ready ? <Check className="size-4" aria-hidden="true" /> : <Clock3 className="size-4" aria-hidden="true" />}</span></div>
                    <p className="mt-3 text-sm font-bold text-slate-900">{item.ready ? item.readyText : item.waitText}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-col justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 sm:flex-row sm:items-center">
                <div><p className="text-sm font-bold text-[#15375b]">다음 연결 작업</p><p className="mt-1 text-xs leading-5 text-slate-600">{integrationReadiness?.nextAction ?? '서버 설정을 확인하고 있습니다.'} · 웹 프로젝트 직접호출은 지원되지 않아 지침 이식 방식으로 진행합니다.</p></div>
                {integrationReadiness?.instructionVersion ? <Pill tone="blue">지침 {integrationReadiness.instructionVersion}</Pill> : null}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <section aria-label="가상 판정 요약" className="mb-5 grid gap-3 md:grid-cols-3">
        {(['A', 'B', 'C'] as DiagnosisLevel[]).map((level) => {
          const count = assessments.filter((assessment) => assessment.level === level).length;
          return (
            <Card key={level} className={`border ${levelMeta[level].panel} shadow-none`}>
              <CardContent className="flex items-center justify-between py-5">
                <div><p className="text-xs font-bold text-slate-500">판정 {level}</p><p className="mt-1 text-lg font-bold text-slate-950">{levelMeta[level].label.split(' · ')[1]}</p></div>
                <span className="text-3xl font-black text-slate-950">{count}</span>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.65fr)]">
        <Card className="h-fit border-0 shadow-sm ring-1 ring-slate-200">
          <CardHeader>
            <CardTitle>가상 점검 대상</CardTitle>
            <CardDescription>서로 다른 준비상태 3건을 선택해 판정 근거를 확인합니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {assessments.map((assessment) => {
              const active = assessment.id === selected.id;
              return (
                <button
                  key={assessment.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => selectAssessment(assessment)}
                  className={`min-h-24 w-full rounded-2xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-100 ${active ? 'border-[#0877b8] bg-sky-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                >
                  <div className="flex items-start justify-between gap-3"><div><p className="font-bold text-slate-950">{assessment.company}</p><p className="mt-1 text-xs text-slate-500">{cases.find((item) => item.id === assessment.caseId)?.service ?? '가상 기업진단'}</p></div><Pill tone={levelMeta[assessment.level].tone}>{assessment.level}</Pill></div>
                  <p className="mt-3 text-xs font-semibold text-slate-600">{assessment.decision}</p>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <div className="space-y-5" aria-live="polite">
          <Card className={`border shadow-none ${levelMeta[selected.level].panel}`}>
            <CardContent className="py-5">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div><div className="flex flex-wrap items-center gap-2"><Pill tone={levelMeta[selected.level].tone}>{levelMeta[selected.level].label}</Pill><Pill>{selected.status}</Pill><Pill tone="blue">가상 데이터</Pill></div><h2 className="mt-3 text-xl font-bold text-slate-950">{selected.company}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">{levelMeta[selected.level].guidance}</p></div>
                <SecondaryButton onClick={() => runAssessment(selected.id)} className="shrink-0"><RefreshCw className="size-4" aria-hidden="true" /> 판정 다시 실행</SecondaryButton>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-white/80 bg-white/75 p-3"><p className="text-xs font-semibold text-slate-500">통과</p><p className="mt-1 text-2xl font-bold text-emerald-700">{checks.filter((check) => check.status === '통과').length}</p></div>
                <div className="rounded-xl border border-white/80 bg-white/75 p-3"><p className="text-xs font-semibold text-slate-500">확인필요</p><p className="mt-1 text-2xl font-bold text-amber-700">{needsReview.length}</p></div>
                <div className="rounded-xl border border-white/80 bg-white/75 p-3"><p className="text-xs font-semibold text-slate-500">차단</p><p className="mt-1 text-2xl font-bold text-red-700">{blockers.length}</p></div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm ring-1 ring-slate-200">
            <CardHeader>
              <CardTitle>판정 근거 체크리스트</CardTitle>
              <CardDescription>파일 등록상태와 가상 동의·보안조건을 함께 확인합니다.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-3 md:grid-cols-2">
                {checks.map((check) => (
                  <li key={check.id} className="flex min-h-24 items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                    <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${check.status === '통과' ? 'bg-emerald-100 text-emerald-700' : check.status === '차단' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                      {check.status === '통과' ? <Check className="size-4" aria-hidden="true" /> : <AlertCircle className="size-4" aria-hidden="true" />}
                    </span>
                    <div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-bold text-slate-900">{check.label}</p><Pill tone={check.status === '통과' ? 'green' : check.status === '차단' ? 'red' : 'amber'}>{check.status}</Pill></div><p className="mt-1 text-xs leading-5 text-slate-600">{check.detail}</p></div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm ring-1 ring-slate-200">
            <CardHeader>
              <CardTitle>다음 처리</CardTitle>
              <CardDescription>{selected.updatedAt} · 최종 보고서 생성 전에는 김성민 대표 검토가 필요합니다.</CardDescription>
            </CardHeader>
            <CardContent>
              {selected.level === 'A' ? (
                <div className="flex flex-col gap-3 sm:flex-row"><PrimaryButton onClick={() => onQueueDraft(selected)}><BrainCircuit className="size-4" aria-hidden="true" /> 1차 초안 검토대기 등록</PrimaryButton><SecondaryButton onClick={onOpenFiles}><FolderOpen className="size-4" aria-hidden="true" /> 관련 서류 확인</SecondaryButton></div>
              ) : selected.level === 'B' ? (
                <div className="flex flex-col gap-3 sm:flex-row"><PrimaryButton onClick={() => onRequestDocuments(selected.caseId)} disabled={!selectedCaseExists}><FilePlus2 className="size-4" aria-hidden="true" /> 보완서류 요청 준비</PrimaryButton><SecondaryButton onClick={() => runAssessment(selected.id)}><RefreshCw className="size-4" aria-hidden="true" /> 자료 반영 후 재판정</SecondaryButton></div>
              ) : (
                <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900"><LockKeyhole className="mt-0.5 size-5 shrink-0" aria-hidden="true" /><div><strong>AI 처리가 차단되었습니다.</strong> {blockers.map((check) => check.label).join(' · ')} 항목을 해소한 뒤 다시 판정해야 합니다.</div></div>
              )}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm ring-1 ring-slate-200">
            <CardHeader className="border-b border-slate-100">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div><CardTitle>가상기업 Step 0 사전가설 시험</CardTitle><CardDescription className="mt-1">실제 고객자료를 사용하지 않고 Claude 상담 FLOW의 첫 단계만 생성합니다.</CardDescription></div>
                <Pill tone={stepZeroRun?.caseId === selected.caseId ? 'green' : integrationReadiness?.generationEnabled ? 'blue' : 'amber'}>{stepZeroRun?.caseId === selected.caseId ? '저장된 초안 있음' : integrationReadiness?.generationEnabled ? '실행 가능' : 'API 연결 대기'}</Pill>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 py-5">
              <Field label="가상기업 입력" required hint="실제 전화번호·이메일·사업자번호·주민번호는 입력할 수 없습니다.">
                <textarea value={pilotContext} onChange={(event) => { setPilotContext(event.target.value); setGenerationError(''); }} className={`${inputClass} min-h-36 py-3`} maxLength={8000} />
              </Field>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={pilotConsent} onChange={(event) => { setPilotConsent(event.target.checked); setGenerationError(''); }} className="mt-1 size-4 accent-[#0877b8]" />
                <span>위 내용은 테스트용 가상정보이며 실제 고객 식별정보가 없음을 확인하고, 이 가상 입력을 Anthropic Claude API 시험에 사용하는 데 동의합니다.</span>
              </label>
              {generationError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{generationError}</p> : null}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <PrimaryButton onClick={generatePilotStepZero} disabled={generationStatus === 'loading' || selected.level !== 'A' || !selected.company.includes('(가상)')}>
                  {generationStatus === 'loading' ? <RefreshCw className="size-4 animate-spin" aria-hidden="true" /> : <BrainCircuit className="size-4" aria-hidden="true" />}
                  {generationStatus === 'loading' ? 'Step 0 생성 중' : '가상 Step 0 생성'}
                </PrimaryButton>
                <p className="text-xs leading-5 text-slate-500">실행할 때만 API 사용량이 발생하며 결과는 대표 검토대기로 저장됩니다.</p>
              </div>

              {stepZeroRun?.caseId === selected.caseId ? (
                <section aria-labelledby="step-zero-result-title" className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><h3 id="step-zero-result-title" className="font-bold text-slate-950">Step 0 내부 초안</h3><p className="mt-1 text-xs text-slate-500">{new Date(stepZeroRun.createdAt).toLocaleString('ko-KR')} · {stepZeroRun.model} · 입력 {stepZeroRun.usage.inputTokens.toLocaleString()} / 출력 {stepZeroRun.usage.outputTokens.toLocaleString()} 토큰</p></div><Pill tone="amber">{stepZeroRun.status}</Pill></div>
                  <div className="rounded-xl bg-white p-4"><p className="text-xs font-bold text-slate-500">기업 현황 가설</p><p className="mt-2 text-sm leading-6 text-slate-800">{stepZeroRun.result.companyOverview}</p></div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {[['확인된 강점', stepZeroRun.result.confirmedStrengths], ['주요 위험·불확실성', stepZeroRun.result.mainRisks]].map(([title, items]) => <div key={title as string} className="rounded-xl bg-white p-4"><p className="text-xs font-bold text-slate-500">{title as string}</p><ul className="mt-2 space-y-2 text-sm leading-6 text-slate-700">{(items as string[]).map((item) => <li key={item} className="flex gap-2"><span className="text-[#0877b8]">•</span><span>{item}</span></li>)}</ul></div>)}
                  </div>
                  <div className="rounded-xl bg-white p-4"><p className="text-xs font-bold text-slate-500">솔루션 후보</p><div className="mt-3 grid gap-3">{stepZeroRun.result.solutionCandidates.map((item) => <div key={`${item.solution}-${item.basis}`} className="rounded-xl border border-slate-100 p-3"><p className="text-sm font-bold text-slate-900">{item.solution}</p><p className="mt-1 text-xs leading-5 text-slate-600">근거: {item.basis}</p><p className="mt-1 text-xs leading-5 text-amber-800">조건: {item.condition || '추가 확인 필요'}</p></div>)}</div></div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {[['대표 확인질문', stepZeroRun.result.verificationQuestions], ['보완자료', stepZeroRun.result.missingDocuments]].map(([title, items]) => <div key={title as string} className="rounded-xl bg-white p-4"><p className="text-xs font-bold text-slate-500">{title as string}</p><ol className="mt-2 space-y-2 text-sm leading-6 text-slate-700">{(items as string[]).map((item, index) => <li key={item}>{index + 1}. {item}</li>)}</ol></div>)}
                  </div>
                  <div className="rounded-xl border border-blue-100 bg-blue-50 p-4"><p className="text-xs font-bold text-[#15375b]">대표 다음 행동</p><p className="mt-2 text-sm font-semibold leading-6 text-slate-800">{stepZeroRun.result.nextAction}</p></div>
                  <p className="text-xs leading-5 text-slate-500">AI 생성 내부 초안 · 김성민 대표 검토 전 · 외부 제공 금지</p>
                </section>
              ) : null}
            </CardContent>
          </Card>

          <section aria-labelledby="automation-flow-title" className="rounded-2xl bg-[#112f50] p-5 text-white shadow-sm">
            <h2 id="automation-flow-title" className="font-bold">자동연결 예정 흐름</h2>
            <ol className="mt-4 grid gap-3 md:grid-cols-4">
              {['자료 접수·마스킹', 'A·B·C 사전판정', '대표 실행', 'Step 0 가상 초안'].map((step, index) => (
                <li key={step} className="rounded-xl border border-white/10 bg-white/5 p-3"><span className="text-xs font-bold text-sky-300">0{index + 1}</span><p className="mt-1 text-sm font-semibold">{step}</p></li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}

function googleCalendarUrl(item: ScheduleItem) {
  const date = item.isoDate?.replaceAll('-', '') ?? `2026${item.date.replace('.', '')}`;
  const start = `${date}T${item.time.replace(':', '')}00`;
  const end = `${item.endIsoDate?.replaceAll('-', '') ?? date}T${item.end.replace(':', '')}00`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `[한기평 상담] ${item.company} - ${item.service}`,
    dates: `${start}/${end}`,
    details: `한기평 파트너 허브 상담일정\n상담방식: ${item.method}`,
    ctz: 'Asia/Seoul',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function scheduleForTrainee(item: ScheduleItem, trainee = '박지현'): ScheduleItem | null {
  if (item.shareMode === 'private') return null;
  const canSeeDetails = item.shareMode === 'all_with_assignee' && item.assignedTrainee === trainee && !item.private;
  if (canSeeDetails) return item;

  return {
    ...item,
    company: item.source === 'google' ? '대표 일정 예약됨' : '협업 상담 예약됨',
    service: item.source === 'google' ? '상세 내용 비공개' : '담당 파트너만 상세 확인',
    method: '시간만 공유',
    status: '예약됨',
    tone: 'slate',
  };
}

function ScheduleRow({ item, compact = false, traineeView = false }: { item: ScheduleItem; compact?: boolean; traineeView?: boolean }) {
  return (
    <div className={`grid items-center gap-3 ${compact ? 'grid-cols-[72px_minmax(0,1fr)] py-3' : 'grid-cols-[76px_minmax(0,1fr)_auto] rounded-2xl border border-slate-100 bg-white p-4'}`}>
      <div className="text-center">
        <p className="text-sm font-bold tabular-nums text-[#15375b]">{item.time}</p>
        <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">~ {item.end}</p>
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-bold text-slate-900">{item.company}</p>
          <Pill tone={item.tone}>{item.status}</Pill>
        </div>
        <p className="mt-1 truncate text-xs text-slate-500">{item.service} · {item.method}</p>
      </div>
      {!compact && item.source === 'partner' && !traineeView ? (
        <a
          href={googleCalendarUrl(item)}
          target="_blank"
          rel="noreferrer"
          className="hidden min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-100 sm:inline-flex"
        >
          <CalendarDays className="size-4 text-[#0877b8]" aria-hidden="true" /> 캘린더에 추가
        </a>
      ) : null}
    </div>
  );
}

function AdminDashboard({
  onOpenCase,
  onOpenSchedule,
  schedule,
}: {
  onOpenCase: () => void;
  onOpenSchedule: () => void;
  schedule: ScheduleItem[];
}) {
  return (
    <>
      <PageIntro
        eyebrow="2026년 8월 29일 토요일"
        title="오늘의 협업 진행현황"
        description="지금 확인하거나 처리해야 할 업무를 우선순위에 따라 모았습니다."
        action={<Pill tone="amber">대표 확인 필요 4건</Pill>}
      />

      <section aria-label="업무 요약" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metricData.map(({ label, value, hint, icon: Icon }) => (
          <Card key={label} className="border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-slate-600">{label}</CardTitle>
              <CardAction className="grid size-10 place-items-center rounded-xl bg-sky-50 text-[#0877b8]">
                <Icon className="size-5" aria-hidden="true" />
              </CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tracking-tight text-[#15375b]">{value}</p>
              <p className="mt-2 text-xs text-slate-500">{hint}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="mt-6 border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
        <CardHeader className="border-b border-slate-100">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg font-bold">
                <CalendarDays className="size-5 text-[#0877b8]" aria-hidden="true" />
                김성민 대표 다음 상담일정
              </CardTitle>
              <CardDescription className="mt-1">파트너 허브 상담과 Google Calendar의 바쁜 시간을 함께 확인합니다.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="green">Google 계정 연결 확인</Pill>
              <SecondaryButton onClick={onOpenSchedule}>전체 일정 보기 <ChevronRight className="size-4" aria-hidden="true" /></SecondaryButton>
            </div>
          </div>
        </CardHeader>
        <CardContent className="divide-y pt-1">
          {schedule.slice(0, 3).map((item) => (
            <div key={item.id} className="grid gap-2 py-1 sm:grid-cols-[84px_minmax(0,1fr)] sm:items-center">
              <p className="px-1 text-xs font-bold text-slate-500">{item.date}({item.weekday})</p>
              <ScheduleRow item={item} compact />
            </div>
          ))}
        </CardContent>
      </Card>

      <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,0.85fr)]">
        <Card className="border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="flex items-center gap-2 text-lg font-bold">
              <BriefcaseBusiness className="size-5 text-[#0877b8]" aria-hidden="true" />
              대표 확인이 필요한 진행
            </CardTitle>
            <CardDescription>다음 행동이 멈춰 있거나 승인 대기 중인 진행입니다.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {[
              ['세림테크(가상)', '정책자금 · 특허', '견적 승인 대기', '오늘'],
              ['가온푸드(가상)', '기업인증', '서류 보완 2건', '09.01'],
              ['더원로지스(가상)', '영업권·법인전환', '상담 일정 확정 필요', '09.02'],
            ].map(([company, service, status, due]) => (
              <button
                key={company}
                type="button"
                onClick={onOpenCase}
                className="grid min-h-[84px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 text-left transition-colors hover:bg-slate-50 focus-visible:bg-sky-50 focus-visible:outline-none sm:px-5"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-slate-900">{company}</span>
                  <span className="mt-1 block truncate text-xs text-slate-500">{service}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="hidden min-h-6 items-center rounded-full bg-[#eaf1f7] px-2.5 text-xs font-semibold text-[#15375b] sm:inline-flex">{status}</span>
                  <span className="w-12 text-right text-xs font-semibold text-slate-500">{due}</span>
                  <ChevronRight className="size-4 text-slate-400" aria-hidden="true" />
                </span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="flex items-center gap-2 text-lg font-bold">
              <Clock3 className="size-5 text-[#0877b8]" aria-hidden="true" />
              단계별 장기 미진행
            </CardTitle>
            <CardDescription>7일 이상 다음 행동이 없는 진행입니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-1">
            {[
              ['기업진단·사전검토', 5, '10일'],
              ['상담·협의 진행', 7, '8일'],
              ['계약 진행', 2, '12일'],
            ].map(([label, count, days]) => (
              <div key={String(label)} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm font-semibold text-slate-800">{label}</p>
                  <Pill tone="red">{count}건</Pill>
                </div>
                <p className="mt-2 text-xs text-slate-500">최장 체류 {days}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </>
  );
}

function SchedulePage({
  schedule,
  onNewConsultation,
  notify,
  audience,
  onAudienceChange,
  canPreviewAdmin,
  traineeName,
}: {
  schedule: ScheduleItem[];
  onNewConsultation: () => void;
  notify: (message: string) => void;
  audience: 'admin' | 'trainee';
  onAudienceChange: (audience: 'admin' | 'trainee') => void;
  canPreviewAdmin: boolean;
  traineeName: string;
}) {
  const [filter, setFilter] = useState<'all' | 'partner' | 'google'>('all');
  const audienceSchedule = audience === 'admin' ? schedule : schedule.map((item) => scheduleForTrainee(item, traineeName)).filter((item): item is ScheduleItem => item !== null);
  const visibleSchedule = audienceSchedule.filter((item) => filter === 'all' || item.source === filter);
  const days = ['09.01|화', '09.02|수', '09.03|목', '09.04|금', '09.05|토', '09.06|일', '09.07|월'];

  return (
    <>
      <PageIntro
        eyebrow={audience === 'admin' ? '대표 일정관리' : '파트너 공유일정'}
        title="김성민 대표 상담일정"
        description={audience === 'admin' ? '기업상담 일정과 Google Calendar의 바쁜 시간을 한 화면에서 확인하고 중복 예약을 예방합니다.' : '파트너는 대표님의 상담 가능시간을 확인하고, 본인이 담당하는 기업의 상담만 상세하게 볼 수 있습니다.'}
        action={
          audience === 'admin' ? (
            <PrimaryButton onClick={onNewConsultation}>
              <Plus className="size-4" aria-hidden="true" /> 새 상담 예약
            </PrimaryButton>
          ) : <Pill tone="green">파트너 공유 ON</Pill>
        }
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.72fr)]">
        <Card className="border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
          <CardHeader className="border-b border-slate-100">
            <div className="mb-4 flex flex-col justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-[#0877b8] shadow-sm"><Share2 className="size-5" aria-hidden="true" /></span>
                <div><p className="text-sm font-bold text-[#15375b]">공개화면 미리보기</p><p className="mt-1 text-xs text-slate-600">역할별로 보이는 정보가 다릅니다.</p></div>
              </div>
              {canPreviewAdmin ? (
                <div className="flex gap-2" aria-label="일정 공개화면 선택">
                  {[
                    ['admin', '대표 상세'],
                    ['trainee', '파트너 공유'],
                  ].map(([value, label]) => (
                    <button key={value} type="button" aria-pressed={audience === value} onClick={() => onAudienceChange(value as 'admin' | 'trainee')} className={`min-h-11 rounded-xl border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-100 ${audience === value ? 'border-[#0877b8] bg-white text-[#075f93] shadow-sm' : 'border-transparent bg-transparent text-slate-600 hover:bg-white/70'}`}>{label}</button>
                  ))}
                </div>
              ) : <Pill tone="green">{traineeName} 공유화면</Pill>}
            </div>
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
              <div>
                <CardTitle className="text-lg font-bold">2026년 9월 1주</CardTitle>
                <CardDescription className="mt-1">상담 제목이 아닌 시간만 공유할 수 있도록 개인 일정은 비공개 처리합니다.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2" aria-label="일정 필터">
                {[
                  ['all', '전체 일정'],
                  ['partner', '상담 일정'],
                  ['google', 'Google 일정'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value as 'all' | 'partner' | 'google')}
                    className={`min-h-11 rounded-xl border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-100 ${filter === value ? 'border-[#0877b8] bg-sky-50 text-[#075f93]' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-1">
            <div className="space-y-4 lg:hidden">
              {visibleSchedule.length ? visibleSchedule.map((item) => (
                <div key={item.id}>
                  <p className="mb-2 text-xs font-bold text-slate-500">{item.date}({item.weekday})</p>
                  <ScheduleRow item={item} traineeView={audience === 'trainee'} />
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">선택한 조건의 일정이 없습니다.</div>
              )}
            </div>

            <div className="hidden grid-cols-7 gap-2 lg:grid">
              {days.map((day) => {
                const [date, weekday] = day.split('|');
                const events = visibleSchedule.filter((item) => item.date === date);
                return (
                  <section key={day} aria-label={`${date} ${weekday}요일 일정`} className="min-h-[430px] rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
                    <div className="border-b border-slate-200 pb-3 text-center">
                      <p className="text-xs font-semibold text-slate-500">{weekday}요일</p>
                      <p className="mt-1 text-lg font-bold tabular-nums text-[#15375b]">{date.split('.')[1]}</p>
                    </div>
                    <div className="mt-3 space-y-3">
                      {events.map((item) => (
                        <article key={item.id} className={`rounded-xl border p-3 ${item.source === 'google' ? 'border-slate-200 bg-white' : 'border-sky-100 bg-sky-50'}`}>
                          <p className="text-xs font-bold tabular-nums text-[#15375b]">{item.time}–{item.end}</p>
                          <p className="mt-2 text-xs font-bold leading-5 text-slate-800">{item.company}</p>
                          <p className="mt-1 text-[11px] leading-4 text-slate-500">{item.service}</p>
                          <div className="mt-2"><Pill tone={item.tone}>{item.status}</Pill></div>
                        </article>
                      ))}
                      {!events.length ? <p className="pt-8 text-center text-xs text-slate-400">예약 가능</p> : null}
                    </div>
                  </section>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {audience === 'admin' ? <Card className="border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
            <CardHeader className="border-b border-slate-100">
              <CardTitle className="flex items-center gap-2 text-lg font-bold">
                <RefreshCw className="size-5 text-[#0877b8]" aria-hidden="true" /> Google Calendar
              </CardTitle>
              <CardDescription>김성민 대표 계정 연결을 확인했습니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-1">
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-emerald-900">계정 연결 확인</p>
                    <p className="mt-1 text-xs leading-5 text-emerald-800">사이트 자동 동기화는 Google OAuth 승인 후 활성화됩니다.</p>
                  </div>
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-emerald-700"><Check className="size-5" aria-hidden="true" /></span>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <a href="https://calendar.google.com/calendar/u/0/r" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-100">
                  <ExternalLink className="size-4 text-[#0877b8]" aria-hidden="true" /> Google Calendar 열기
                </a>
                <SecondaryButton onClick={() => notify('시안에서는 연동 상태만 확인합니다. 실제 양방향 동기화는 OAuth 설정 후 활성화됩니다.')}>
                  <RefreshCw className="size-4 text-[#0877b8]" aria-hidden="true" /> 지금 동기화
                </SecondaryButton>
              </div>
            </CardContent>
          </Card> : (
            <Card className="border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
              <CardHeader className="border-b border-slate-100">
                <CardTitle className="flex items-center gap-2 text-lg font-bold"><UserRoundCheck className="size-5 text-[#0877b8]" aria-hidden="true" /> 파트너 공개범위</CardTitle>
                <CardDescription>{traineeName} 파트너 화면 기준입니다.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-1">
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4"><p className="text-sm font-bold text-emerald-900">김성민 대표 일정 공유 중</p><p className="mt-1 text-xs leading-5 text-emerald-800">예약 가능·불가 시간은 전체 파트너에게 표시됩니다.</p></div>
                <div className="space-y-3 text-sm">
                  <div className="flex items-start gap-3"><Check className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-hidden="true" /><p className="text-slate-700"><strong>내 담당기업:</strong> 기업명·상담목적·방식 확인</p></div>
                  <div className="flex items-start gap-3"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden="true" /><p className="text-slate-700"><strong>다른 상담·개인일정:</strong> 시간만 ‘예약됨’으로 표시</p></div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
            <CardHeader><CardTitle className="text-lg font-bold">연동 운영 원칙</CardTitle></CardHeader>
            <CardContent className="space-y-4 pt-1">
              {[
                ['상담 확정 시 자동 등록', '상담명·기업·방식·준비사항을 대표 일정에 생성'],
                ['변경·취소 양방향 반영', '사이트와 Google Calendar 중 한쪽 변경을 동기화'],
                ['개인 일정은 시간만 공유', '파트너에게 제목·상세내용을 공개하지 않음'],
                ['중복 예약 방지', '예약 전 대표 일정의 바쁜 시간을 먼저 확인'],
              ].map(([title, detail], index) => (
                <div key={title} className="flex gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#eaf1f7] text-xs font-bold text-[#15375b]">{index + 1}</span>
                  <div><p className="text-sm font-bold text-slate-800">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p></div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
}

function TraineeDashboard({
  onOpenCase,
  onNew,
  onOpenSchedule,
  schedule,
  member,
}: {
  onOpenCase: () => void;
  onNew: () => void;
  onOpenSchedule: () => void;
  schedule: ScheduleItem[];
  member: TraineeMember;
}) {
  const displayName = member.name.replace('(가상)', '');
  const traineeSchedule = schedule.map((item) => scheduleForTrainee(item, displayName)).filter((item): item is ScheduleItem => item !== null).slice(0, 3);
  return (
    <>
      <PageIntro
        eyebrow="파트너 협업공간"
        title={`${displayName}님, 진행상황을 확인하세요`}
        description="본인이 주관하거나 공동 협업자로 참여한 기업만 표시됩니다."
        action={
          member.permissions.collaborationApply ? <PrimaryButton onClick={onNew}>
            <Plus className="size-4" aria-hidden="true" /> 새 협업신청
          </PrimaryButton> : <Pill tone="slate">신청 권한 없음</Pill>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['진행기업', String(member.companies), BriefcaseBusiness, '전체 협업 진행'],
          ['추가서류 필요', '3', FileCheck2, '오늘 1건 마감'],
          ['예정 상담', '2', CalendarDays, '가장 가까운 일정 09.04'],
          ['확인 필요', '1', AlertCircle, '견적서 확인 요청'],
        ].map(([label, value, Icon, hint]) => {
          const MetricIcon = Icon as IconType;
          return (
            <Card key={String(label)} className="border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-slate-600">{String(label)}</CardTitle>
                <CardAction className="grid size-10 place-items-center rounded-xl bg-sky-50 text-[#0877b8]">
                  <MetricIcon className="size-5" aria-hidden="true" />
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-[#15375b]">{String(value)}</p>
                <p className="mt-2 text-xs text-slate-500">{String(hint)}</p>
              </CardContent>
            </Card>
          );
        })}
      </section>

      {member.permissions.sharedSchedule ? <Card className="mt-6 border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
        <CardHeader className="border-b border-slate-100">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg font-bold"><Share2 className="size-5 text-[#0877b8]" aria-hidden="true" /> 김성민 대표 공유일정</CardTitle>
              <CardDescription className="mt-1">상담 가능시간을 확인하세요. 내 담당기업 일정만 상세하게 표시됩니다.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2"><Pill tone="green">파트너 공유 ON</Pill><SecondaryButton onClick={onOpenSchedule}>전체 일정 보기 <ChevronRight className="size-4" aria-hidden="true" /></SecondaryButton></div>
          </div>
        </CardHeader>
        <CardContent className="divide-y pt-1">
          {traineeSchedule.map((item) => (
            <div key={item.id} className="grid gap-2 py-1 sm:grid-cols-[84px_minmax(0,1fr)] sm:items-center">
              <p className="px-1 text-xs font-bold text-slate-500">{item.date}({item.weekday})</p>
              <ScheduleRow item={item} compact traineeView />
            </div>
          ))}
        </CardContent>
      </Card> : <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5"><p className="text-sm font-bold text-amber-900">대표 공유일정 열람 권한이 없습니다.</p><p className="mt-1 text-xs leading-5 text-amber-800">대표 관리자에게 일정 공유 권한을 요청해 주세요.</p></div>}

      <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.7fr)]">
        <Card className="border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="text-lg font-bold">내 진행기업</CardTitle>
            <CardDescription>최근 변경된 진행을 우선 표시합니다.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold">기업</th>
                    <th className="px-5 py-3 font-semibold">서비스</th>
                    <th className="px-5 py-3 font-semibold">현재상태</th>
                    <th className="px-5 py-3 font-semibold">다음 행동</th>
                    <th className="px-5 py-3 font-semibold">업데이트</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {[
                    ['세림테크(가상)', '정책자금 · 특허', '상담·협의', '추가서류 제출', '오늘'],
                    ['미래에코(가상)', '기업인증', '기업진단', '상담일 선택', '어제'],
                    ['한빛솔루션(가상)', '부동산', '접수', '담당자 배정 대기', '08.27'],
                  ].map((row) => (
                    <tr key={row[0]} onClick={onOpenCase} className="cursor-pointer hover:bg-slate-50">
                      <td className="px-5 py-4 font-semibold text-slate-900">{row[0]}</td>
                      <td className="px-5 py-4 text-slate-600">{row[1]}</td>
                      <td className="px-5 py-4"><Pill tone="blue">{row[2]}</Pill></td>
                      <td className="px-5 py-4 text-slate-600">{row[3]}</td>
                      <td className="px-5 py-4 text-slate-500">{row[4]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="text-lg font-bold">내가 할 일</CardTitle>
            <CardDescription>기한이 가까운 순서입니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-1">
            {[
              ['세림테크 재무제표 제출', '오늘', 'amber'],
              ['미래에코 상담일 선택', '09.01', 'blue'],
              ['견적서 수신 확인', '09.02', 'violet'],
            ].map(([task, due, tone]) => (
              <button key={task} type="button" onClick={onOpenCase} className="flex min-h-[68px] w-full items-center justify-between gap-3 rounded-xl border border-slate-100 px-4 text-left hover:bg-slate-50">
                <span className="text-sm font-semibold text-slate-800">{task}</span>
                <Pill tone={tone}>{due}</Pill>
              </button>
            ))}
          </CardContent>
        </Card>
      </section>
    </>
  );
}

function PipelineBoard({
  cases,
  setCases,
  members,
  isAdmin,
  currentName,
  notify,
  onOpenCase,
}: {
  cases: CollaborationCase[];
  setCases: React.Dispatch<React.SetStateAction<CollaborationCase[]>>;
  members: TraineeMember[];
  isAdmin: boolean;
  currentName: string;
  notify: (message: string) => void;
  onOpenCase: (item: CollaborationCase) => void;
}) {
  const [query, setQuery] = useState('');
  const [traineeFilter, setTraineeFilter] = useState('all');
  const [serviceFilter, setServiceFilter] = useState('전체 서비스');
  const [staleOnly, setStaleOnly] = useState(false);

  // Partner state has already been filtered by the server using account IDs.
  const accountCases = cases;
  const serviceOptions = ['전체 서비스', ...Array.from(new Set(accountCases.map((item) => item.service)))];
  const visibleCases = accountCases.filter((item) => {
    const keywordMatch = `${item.company} ${item.service} ${assignmentDisplayName(item, item.trainee, members)} ${casePartnerType(item, members)} ${item.nextAction}`.toLowerCase().includes(query.toLowerCase());
    const ownerId = assignmentMemberId(item, item.trainee, members);
    const traineeMatch = traineeFilter === 'all' || (traineeFilter === 'unresolved' ? ownerId === null : traineeFilter === 'admin' ? ownerId === '' : ownerId === traineeFilter);
    const serviceMatch = serviceFilter === '전체 서비스' || item.service === serviceFilter;
    const staleMatch = !staleOnly || item.idleDays >= 7;
    return keywordMatch && traineeMatch && serviceMatch && staleMatch;
  });
  const staleCount = accountCases.filter((item) => item.idleDays >= 7).length;
  const consultationCount = accountCases.filter((item) => item.stage === '상담예약' || item.stage === '상담진행').length;
  const contractCount = accountCases.filter((item) => item.stage === '계약').length;

  function moveCase(item: CollaborationCase, stage: PipelineStage) {
    if (item.flowManaged) { notify('이 진행은 상담 FLOW의 완료 조건에 따라 자동 변경됩니다.'); return; }
    setCases((current) => current.map((record) => record.id === item.id ? { ...record, stage, nextAction: stageNextActions[stage], updatedAt: '방금 전', idleDays: 0, urgent: false } : record));
    notify(`${item.company} 진행단계를 ${stage}(으)로 변경했습니다.`);
  }

  function assignPartner(item: CollaborationCase, memberId: string) {
    if (!isAdmin || item.flowManaged) return;
    const member = members.find(m => m.id === memberId && m.status === '활성');
    if (!member) return;
    setCases(current => current.map(c => c.id === item.id ? { ...c, trainee: member.name.replace('(가상)','').trim(), partnerMemberId: member.id } : c));
    notify('담당 계정을 지정했습니다. 상단 DB 저장 완료 후 상담 FLOW를 열어 주세요.');
  }

  return (
    <>
      <PageIntro
        eyebrow={isAdmin ? '전체 협업 통제판' : '담당기업 진행판'}
        title="전체 협업 진행현황"
        description={isAdmin ? '파트너 유형별 협업기업을 단계별로 확인하고 장기 미진행 건의 다음 행동을 바로 결정합니다.' : '본인이 담당하는 기업만 표시되며 드래그 없이 단계 선택으로 진행상태를 변경할 수 있습니다.'}
        action={<Pill tone={staleCount ? 'red' : 'green'}>7일 이상 정체 {staleCount}건</Pill>}
      />

      <section aria-label="협업 파이프라인 요약" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['전체 진행기업', accountCases.length, BriefcaseBusiness, '현재 계정 조회범위'],
          ['상담 전·진행', consultationCount, MessageSquarePlus, '예약과 반복상담 포함'],
          ['계약 진행', contractCount, FileText, '조건협의·계약작성'],
          ['장기 미진행', staleCount, AlertCircle, '7일 이상 정체'],
        ].map(([label, value, Icon, hint]) => {
          const MetricIcon = Icon as IconType;
          return <Card key={String(label)} className="border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80"><CardHeader><CardTitle className="text-sm font-semibold text-slate-600">{String(label)}</CardTitle><CardAction className="grid size-10 place-items-center rounded-xl bg-sky-50 text-[#0877b8]"><MetricIcon className="size-5" aria-hidden="true" /></CardAction></CardHeader><CardContent><p className="text-3xl font-bold tabular-nums text-[#15375b]">{String(value)}</p><p className="mt-2 text-xs text-slate-500">{String(hint)}</p></CardContent></Card>;
        })}
      </section>

      <Card className="mt-6 border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
        <CardHeader className="border-b border-slate-100">
          <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_200px_240px_auto]">
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-slate-500"><Search className="size-4" aria-hidden="true" /><span className="sr-only">협업기업 검색</span><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none" placeholder="기업·서비스·다음행동 검색" /></label>
            {isAdmin ? <label><span className="sr-only">담당자 필터</span><select value={traineeFilter} onChange={(event) => setTraineeFilter(event.target.value)} className={inputClass}><option value="all">전체 담당자</option><option value="admin">대표 전용</option><option value="unresolved">담당 계정 확인 필요</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name.replace('(가상)', '').trim()} · {member.email}{member.status === '활성' ? '' : ` · ${member.status}`}</option>)}</select></label> : <div className="flex min-h-11 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">담당자 {currentName}</div>}
            <label><span className="sr-only">서비스 필터</span><select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)} className={inputClass}>{serviceOptions.map((service) => <option key={service}>{service}</option>)}</select></label>
            <button type="button" aria-pressed={staleOnly} onClick={() => setStaleOnly((value) => !value)} className={`min-h-11 rounded-xl border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-100 ${staleOnly ? 'border-red-300 bg-red-50 text-red-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>7일 이상만 보기</button>
          </div>
        </CardHeader>
      </Card>

      <section aria-label="단계별 협업 진행" className="mt-6 grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
        {pipelineStages.map((stage, stageIndex) => {
          const stageCases = visibleCases.filter((item) => item.stage === stage);
          return <section key={stage} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70">
            <header className="flex min-h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4"><div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-full bg-[#15375b] text-xs font-bold text-white">{stageIndex + 1}</span><h2 className="font-bold text-slate-900">{stage}</h2></div><Pill tone={stageCases.length ? 'blue' : 'slate'}>{stageCases.length}건</Pill></header>
            <div className="min-h-32 space-y-3 p-3">
              {stageCases.length ? stageCases.map((item) => <article key={item.id} className={`rounded-xl border bg-white p-4 shadow-sm ${item.idleDays >= 7 ? 'border-red-200' : 'border-slate-200'}`}>
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-bold text-slate-950">{item.company}</p><p className="mt-1 text-xs leading-5 text-slate-500">{item.service}</p><p className="mt-1 text-[11px] text-slate-400" title={item.id}>진행번호 {item.id.slice(-8)}</p></div>{item.idleDays >= 7 ? <Pill tone="red">{item.idleDays}일 정체</Pill> : <Pill tone={item.urgent ? 'amber' : 'slate'}>{item.updatedAt}</Pill>}</div>
                <div className="mt-3 rounded-lg bg-slate-50 p-3"><p className="text-[11px] font-semibold text-slate-500">다음 행동</p><p className="mt-1 text-sm font-bold leading-5 text-slate-800">{item.nextAction}</p></div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-semibold text-slate-600">담당 {assignmentDisplayName(item, item.trainee, members)}</span><div className="flex flex-wrap gap-2"><Pill tone="navy">{casePartnerType(item, members)}</Pill>{item.consultationCount ? <Pill tone="violet">상담 {item.consultationCount}회</Pill> : null}</div></div>
                <label className="mt-4 block"><span className="mb-2 block text-xs font-semibold text-slate-600">{item.flowManaged ? `상담 FLOW 자동 반영 · ${item.flowPhase}` : '진행단계 변경'}</span><select disabled={item.flowManaged} value={item.stage} onChange={(event) => moveCase(item, event.target.value as PipelineStage)} className={inputClass}>{pipelineStages.map((option) => <option key={option}>{option}</option>)}</select></label>
                {isAdmin && !item.flowManaged && <label className="mt-3 grid gap-2 text-xs font-semibold text-slate-600">상담 FLOW 담당 계정<select className={inputClass} value={item.partnerMemberId ?? ''} onChange={event => assignPartner(item,event.target.value)}><option value="">이름 일치 계정 자동 연결 / 직접 지정</option>{members.filter(m => m.status === '활성').map(m => <option key={m.id} value={m.id}>{m.name} · {m.email}</option>)}</select></label>}
                <SecondaryButton className="mt-3 w-full" onClick={() => onOpenCase(item)}>컨설팅 진행 현황 <ChevronRight className="size-4" aria-hidden="true" /></SecondaryButton>
              </article>) : <div className="grid min-h-28 place-items-center rounded-xl border border-dashed border-slate-200 bg-white/60 p-4 text-center text-xs text-slate-400">현재 조건의 진행이 없습니다.</div>}
            </div>
          </section>;
        })}
      </section>

      <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50/70 p-5"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#0877b8]" aria-hidden="true" /><div><p className="text-sm font-bold text-[#15375b]">진행단계 운영원칙</p><p className="mt-1 text-xs leading-5 text-slate-600">상담은 횟수 제한 없이 해당 진행 안에 누적하고, 서류요청·견적·계약은 어느 단계에서도 별도로 생성합니다. 단계변경은 드래그가 아닌 선택메뉴로도 가능해 키보드와 모바일에서 동일하게 사용할 수 있습니다.</p></div></div></div>
    </>
  );
}

function WorkManagement({
  tasks,
  setTasks,
  members,
  isAdmin,
  currentName,
  currentMemberId,
  notify,
}: {
  tasks: WorkTask[];
  setTasks: React.Dispatch<React.SetStateAction<WorkTask[]>>;
  members: TraineeMember[];
  isAdmin: boolean;
  currentName: string;
  currentMemberId: string | null;
  notify: (message: string) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'urgent' | 'today' | 'progress' | 'complete'>('all');
  const [query, setQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCompany, setNewCompany] = useState('세림테크(가상)');
  const [newKind, setNewKind] = useState<WorkTask['kind']>('내부업무');
  const [newMemberId, setNewMemberId] = useState(isAdmin ? '' : currentMemberId ?? '');
  const [newDue, setNewDue] = useState('09.05');
  const [newDueState, setNewDueState] = useState<WorkTask['dueState']>('upcoming');

  // Do not re-filter server-authorized tasks by a mutable display name.
  const accountTasks = tasks;
  const visibleTasks = accountTasks.filter((task) => {
    const keywordMatch = `${task.company} ${task.title} ${task.kind} ${assignmentDisplayName(task, task.assignee, members)}`.toLowerCase().includes(query.toLowerCase());
    const filterMatch = filter === 'all'
      || (filter === 'urgent' && task.priority === '긴급' && task.status !== '완료')
      || (filter === 'today' && task.dueState === 'today' && task.status !== '완료')
      || (filter === 'progress' && task.status === '진행')
      || (filter === 'complete' && task.status === '완료');
    return keywordMatch && filterMatch;
  });

  const counts = {
    pending: accountTasks.filter((task) => task.status !== '완료').length,
    overdue: accountTasks.filter((task) => task.status !== '완료' && task.dueState === 'overdue').length,
    today: accountTasks.filter((task) => task.status !== '완료' && task.dueState === 'today').length,
    complete: accountTasks.filter((task) => task.status === '완료').length,
  };

  function toggleComplete(task: WorkTask) {
    const nextStatus: WorkTask['status'] = task.status === '완료' ? '진행' : '완료';
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: nextStatus } : item));
    notify(nextStatus === '완료' ? `${task.title} 업무를 완료 처리했습니다.` : `${task.title} 업무를 다시 진행 상태로 변경했습니다.`);
  }

  function addTask() {
    if (!newTitle.trim()) {
      notify('업무명을 입력해 주세요.');
      return;
    }
    let assignment: ReturnType<typeof newTaskAssignment>;
    try { assignment = newTaskAssignment(isAdmin ? newMemberId : currentMemberId ?? '', members, isAdmin); }
    catch (error) { notify(error instanceof Error ? error.message : '담당 계정을 확인해 주세요.'); return; }
    setTasks((current) => [
      {
        id: `task-${crypto.randomUUID()}`,
        company: newCompany.trim() || '내부업무',
        title: newTitle.trim(),
        kind: newKind,
        ...assignment,
        due: newDue.trim() || '미정',
        dueState: newDueState,
        status: '대기',
        priority: newDueState === 'today' || newDueState === 'overdue' ? '긴급' : '보통',
        related: '직접 등록',
      },
      ...current,
    ]);
    setNewTitle('');
    setAddOpen(false);
    notify('새 업무를 등록했습니다. 담당자 업무·알림에 즉시 표시됩니다.');
  }

  return (
    <>
      <PageIntro
        eyebrow={isAdmin ? '누락 방지 통합관리' : '내 담당업무'}
        title={isAdmin ? '업무·알림 관리' : `${currentName} 파트너 업무·알림`}
        description={isAdmin ? '상담 뒤 생성되는 후속조치와 직접 등록한 업무를 담당자·마감일 기준으로 추적합니다.' : '본인에게 배정된 기업 업무만 표시되며 완료 여부가 대표 화면에도 함께 반영됩니다.'}
        action={<PrimaryButton onClick={() => setAddOpen(true)}><Plus className="size-4" aria-hidden="true" /> 업무 추가</PrimaryButton>}
      />

      <section aria-label="업무 현황 요약" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['미완료 업무', counts.pending, ClipboardCheck, '대기·진행 전체', 'navy'],
          ['기한 지연', counts.overdue, AlertCircle, '즉시 확인 필요', 'red'],
          ['오늘 마감', counts.today, Clock3, '오늘 처리 대상', 'amber'],
          ['완료 업무', counts.complete, Check, '현재 화면 기준', 'green'],
        ].map(([label, value, Icon, hint, tone]) => {
          const MetricIcon = Icon as IconType;
          return (
            <Card key={String(label)} className="border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
              <CardHeader><CardTitle className="text-sm font-semibold text-slate-600">{String(label)}</CardTitle><CardAction className="grid size-10 place-items-center rounded-xl bg-sky-50 text-[#0877b8]"><MetricIcon className="size-5" aria-hidden="true" /></CardAction></CardHeader>
              <CardContent><div className="flex items-end justify-between gap-3"><p className="text-3xl font-bold tabular-nums text-[#15375b]">{String(value)}</p><Pill tone={String(tone)}>{String(hint)}</Pill></div></CardContent>
            </Card>
          );
        })}
      </section>

      <Card className="mt-6 border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
        <CardHeader className="border-b border-slate-100">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div><CardTitle className="text-lg font-bold">업무 목록</CardTitle><CardDescription className="mt-1">긴급도와 마감일을 먼저 확인한 뒤 완료 처리하세요.</CardDescription></div>
            <label className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-slate-500 lg:max-w-xs"><Search className="size-4" aria-hidden="true" /><span className="sr-only">업무 검색</span><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none" placeholder="기업·업무·담당자 검색" /></label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2" aria-label="업무 상태 필터">
            {[
              ['all', '전체'],
              ['urgent', '긴급'],
              ['today', '오늘 마감'],
              ['progress', '진행 중'],
              ['complete', '완료'],
            ].map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value as typeof filter)} className={`min-h-11 rounded-xl border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-100 ${filter === value ? 'border-[#0877b8] bg-sky-50 text-[#075f93]' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>{label}</button>)}
          </div>
        </CardHeader>
        <CardContent className="pt-1">
          {visibleTasks.length ? <div className="grid gap-4 xl:grid-cols-2">
            {visibleTasks.map((task) => {
              const completed = task.status === '완료';
              const dueTone = task.dueState === 'overdue' ? 'red' : task.dueState === 'today' ? 'amber' : 'blue';
              return (
                <article key={task.id} className={`rounded-2xl border p-5 ${completed ? 'border-slate-200 bg-slate-50/70' : task.dueState === 'overdue' ? 'border-red-200 bg-red-50/40' : 'border-slate-200 bg-white'}`}>
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Pill tone={task.priority === '긴급' ? 'red' : 'slate'}>{task.priority}</Pill><Pill tone="blue">{task.kind}</Pill></div><p className="mt-3 text-xs font-semibold text-slate-500">{task.company}</p><h2 className={`mt-1 text-base font-bold leading-6 ${completed ? 'text-slate-500 line-through' : 'text-slate-950'}`}>{task.title}</h2></div><button type="button" aria-pressed={completed} aria-label={`${task.title} ${completed ? '다시 진행' : '완료 처리'}`} onClick={() => toggleComplete(task)} className={`grid size-11 shrink-0 place-items-center rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-100 ${completed ? 'border-emerald-200 bg-emerald-100 text-emerald-800' : 'border-slate-200 bg-white text-slate-400 hover:border-emerald-300 hover:text-emerald-700'}`}><Check className="size-5" aria-hidden="true" /></button></div>
                  <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-white/80 p-3 text-xs sm:grid-cols-3"><div><p className="text-slate-500">담당자</p><p className="mt-1 font-bold text-slate-800">{assignmentDisplayName(task, task.assignee, members)}</p></div><div><p className="text-slate-500">마감</p><div className="mt-1"><Pill tone={dueTone}>{task.due}</Pill></div></div><div className="col-span-2 sm:col-span-1"><p className="text-slate-500">관련 업무</p><p className="mt-1 font-bold text-slate-800">{task.related}</p></div></div>
                </article>
              );
            })}
          </div> : <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center"><ClipboardCheck className="mx-auto size-9 text-slate-300" aria-hidden="true" /><p className="mt-3 text-sm font-bold text-slate-700">조건에 맞는 업무가 없습니다.</p><button type="button" onClick={() => { setFilter('all'); setQuery(''); }} className="mt-3 min-h-11 rounded-xl px-4 text-sm font-semibold text-[#0877b8] hover:bg-sky-50">필터 초기화</button></div>}
        </CardContent>
      </Card>

      <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50/70 p-5"><div className="flex items-start gap-3"><Bell className="mt-0.5 size-5 shrink-0 text-[#0877b8]" aria-hidden="true" /><div><p className="text-sm font-bold text-[#15375b]">가상 알림 작동방식</p><p className="mt-1 text-xs leading-5 text-slate-600">오늘 마감·기한 지연 업무는 상단 알림 숫자에 포함됩니다. 상담 저장 시 선택한 후속조치도 자동으로 이 목록에 추가됩니다.</p></div></div></div>

      {addOpen ? <dialog open className="fixed inset-0 z-50 m-0 grid h-screen max-h-none w-screen max-w-none place-items-center border-0 bg-slate-950/45 p-4 backdrop-blur-sm" aria-labelledby="task-modal-title">
        <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b p-5"><div><p className="text-xs font-semibold text-[#0877b8]">독립 업무 등록</p><h2 id="task-modal-title" className="mt-1 text-xl font-bold">새 업무 추가</h2><p className="mt-1 text-sm text-slate-500">상담 단계와 무관하게 필요한 업무를 즉시 만들 수 있습니다.</p></div><button type="button" onClick={() => setAddOpen(false)} className="grid size-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label="업무 추가 닫기"><X className="size-5" aria-hidden="true" /></button></div>
          <div className="grid max-h-[65vh] gap-5 overflow-y-auto p-5 md:grid-cols-2">
            <div className="md:col-span-2"><Field label="업무명" required><input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} className={inputClass} placeholder="예: 추가서류 제출 여부 확인" /></Field></div>
            <Field label="기업명" required><input value={newCompany} onChange={(event) => setNewCompany(event.target.value)} className={inputClass} /></Field>
            <Field label="업무유형" required><select value={newKind} onChange={(event) => setNewKind(event.target.value as WorkTask['kind'])} className={inputClass}><option>서류요청</option><option>상담</option><option>견적서</option><option>계약서</option><option>사후관리</option><option>내부업무</option></select></Field>
            <Field label="담당 계정" required hint="이메일로 동명이인을 구별합니다."><select value={newMemberId} onChange={(event) => setNewMemberId(event.target.value)} className={inputClass} disabled={!isAdmin}>{isAdmin ? <option value="">김성민 대표 · 대표 전용</option> : null}{members.filter((member) => member.status === '활성').map((member) => <option key={member.id} value={member.id}>{member.name.replace('(가상)', '').trim()} · {member.email}</option>)}</select></Field>
            <Field label="마감일" required><input value={newDue} onChange={(event) => setNewDue(event.target.value)} className={inputClass} placeholder="예: 09.05 또는 오늘 16:00" /></Field>
            <div className="md:col-span-2"><Field label="마감 구분" required><div className="grid gap-2 sm:grid-cols-3">{[['upcoming', '예정'], ['today', '오늘 마감'], ['overdue', '기한 지연']].map(([value, label]) => <button key={value} type="button" aria-pressed={newDueState === value} onClick={() => setNewDueState(value as WorkTask['dueState'])} className={`min-h-11 rounded-xl border px-4 text-sm font-semibold ${newDueState === value ? 'border-[#0877b8] bg-sky-50 text-[#075f93]' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{label}</button>)}</div></Field></div>
          </div>
          <div className="flex flex-col-reverse gap-3 border-t bg-slate-50 p-4 sm:flex-row sm:justify-end sm:px-5"><SecondaryButton onClick={() => setAddOpen(false)}>취소</SecondaryButton><PrimaryButton onClick={addTask}><Check className="size-4" aria-hidden="true" /> 업무 등록</PrimaryButton></div>
        </div>
      </dialog> : null}
    </>
  );
}

function DocumentCenter({
  documents,
  setDocuments,
  members,
  isAdmin,
  currentName,
  currentMemberId,
  currentUserId,
  recoveryControls,
  notify,
}: {
  documents: CompanyDocument[];
  setDocuments: React.Dispatch<React.SetStateAction<CompanyDocument[]>>;
  members: TraineeMember[];
  isAdmin: boolean;
  currentName: string;
  currentMemberId: string | null;
  currentUserId: string;
  recoveryControls: RecoveryControls;
  notify: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'전체' | CompanyDocument['status']>('전체');
  const [companyFilter, setCompanyFilter] = useState('전체 기업');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadCompany, setUploadCompany] = useState('세림테크(가상)');
  const [uploadTitle, setUploadTitle] = useState('사업자등록증');
  const [uploadCategory, setUploadCategory] = useState<CompanyDocument['category']>('사업자등록증');
  const [uploadMemberId, setUploadMemberId] = useState(isAdmin ? '' : currentMemberId ?? '');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadConsent, setUploadConsent] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const accountDocuments = isAdmin ? documents : documents.filter((document) => document.partnerMemberId != null ? document.partnerMemberId === currentMemberId : document.assignedTrainee === currentName);
  const companies = ['전체 기업', ...Array.from(new Set(accountDocuments.map((document) => document.company)))];
  const visibleDocuments = accountDocuments.filter((document) => {
    const keywordMatch = `${document.company} ${document.title} ${document.category} ${document.fileName ?? ''}`.toLowerCase().includes(query.toLowerCase());
    const statusMatch = statusFilter === '전체' || document.status === statusFilter;
    const companyMatch = companyFilter === '전체 기업' || document.company === companyFilter;
    return keywordMatch && statusMatch && companyMatch;
  });
  const counts = {
    total: accountDocuments.length,
    requested: accountDocuments.filter((document) => document.status === '요청중').length,
    revision: accountDocuments.filter((document) => document.status === '보완필요').length,
    reviewed: accountDocuments.filter((document) => document.status === '검토완료').length,
  };

  function changeStatus(document: CompanyDocument, status: CompanyDocument['status']) {
    setDocuments((current) => current.map((item) => item.id === document.id ? { ...item, status, updatedAt: '방금 전' } : item));
    notify(`${document.title} 상태를 ${status}(으)로 변경했습니다.`);
  }

  async function addDocument() {
    if (!uploadFile) {
      setUploadError('등록할 실제 파일을 선택해 주세요.');
      return;
    }
    if (!uploadConsent) {
      setUploadError('자료 제출 권한과 개인정보 마스킹 여부를 확인해 주세요.');
      return;
    }
    setUploading(true);
    setUploadError('');
    try {
      const stored = await uploadCompanyFile({
        expectedUserId: currentUserId,
        file: uploadFile,
        company: uploadCompany,
        title: uploadTitle.trim() || uploadCategory,
        category: uploadCategory,
        assignedTrainee: isAdmin ? members.find(member => member.id === uploadMemberId)?.name ?? '김성민 대표' : currentName,
        partnerMemberId: isAdmin ? uploadMemberId : currentMemberId ?? undefined,
        recordingConsent: uploadCategory === '상담녹취' && uploadConsent,
      });
      setDocuments((current) => [
        {
        id: `file-${stored.id}`,
        company: uploadCompany,
        title: uploadTitle.trim() || uploadCategory,
        category: uploadCategory,
        fileName: stored.fileName,
        storageFileId: stored.id,
        fileSize: stored.sizeBytes,
        status: '제출완료',
        assignedTrainee: stored.assignedTrainee,
        partnerMemberId: stored.partnerMemberId,
        submittedBy: isAdmin ? '김성민 대표' : currentName,
        updatedAt: '방금 전',
        version: 'V1',
        sensitive: ['사업자등록증', '크레탑', '재무제표', '상담녹취', '계약자료'].includes(uploadCategory),
      },
      ...current,
      ]);
      setUploadFile(null);
      setUploadConsent(false);
      setUploadOpen(false);
      notify('기업 원본파일을 보안 저장소에 등록했습니다.');
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : '기업자료 업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <PageIntro
        eyebrow={isAdmin ? '기업자료 통합관리' : '담당기업 자료관리'}
        title="기업별 자료함"
        description={isAdmin ? '사업자등록증·크레탑·재무제표와 상담 중 요청한 서류를 기업별로 모아 제출·보완·검토 상태를 관리합니다.' : '본인이 담당하는 기업의 자료만 확인하고 제출상태와 보완 여부를 변경할 수 있습니다.'}
        action={<PrimaryButton disabled={recoveryControls.recoveryBusy} onClick={() => setUploadOpen(true)}><Upload className="size-4" aria-hidden="true" /> 자료 등록</PrimaryButton>}
      />

      {isAdmin && <AdminFileInventory {...recoveryControls} recoveryDisabled={recoveryControls.recoveryDisabled || uploading} />}
      <fieldset disabled={recoveryControls.recoveryBusy} className="min-w-0"><legend className="sr-only">기업자료 관리</legend>
      <section aria-label="자료 제출현황 요약" className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['전체 자료', counts.total, FolderOpen, '담당기업 기준'],
          ['제출 요청중', counts.requested, Clock3, '기업대표 회신 대기'],
          ['보완 필요', counts.revision, AlertCircle, '재제출 확인 필요'],
          ['검토 완료', counts.reviewed, FileCheck2, '사용 가능 자료'],
        ].map(([label, value, Icon, hint]) => {
          const MetricIcon = Icon as IconType;
          return <Card key={String(label)} className="border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80"><CardHeader><CardTitle className="text-sm font-semibold text-slate-600">{String(label)}</CardTitle><CardAction className="grid size-10 place-items-center rounded-xl bg-sky-50 text-[#0877b8]"><MetricIcon className="size-5" aria-hidden="true" /></CardAction></CardHeader><CardContent><p className="text-3xl font-bold tabular-nums text-[#15375b]">{String(value)}</p><p className="mt-2 text-xs text-slate-500">{String(hint)}</p></CardContent></Card>;
        })}
      </section>

      <Card className="mt-6 border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
        <CardHeader className="border-b border-slate-100">
          <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
            <div><CardTitle className="text-lg font-bold">기업자료 목록</CardTitle><CardDescription className="mt-1">파일명보다 자료종류와 검토상태를 우선 확인하세요.</CardDescription></div>
            <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[720px]">
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-slate-500"><Search className="size-4" aria-hidden="true" /><span className="sr-only">기업자료 검색</span><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none" placeholder="기업·자료명 검색" /></label>
              <label><span className="sr-only">기업 필터</span><select value={companyFilter} onChange={(event) => setCompanyFilter(event.target.value)} className={inputClass}>{companies.map((company) => <option key={company}>{company}</option>)}</select></label>
              <label><span className="sr-only">자료상태 필터</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as '전체' | CompanyDocument['status'])} className={inputClass}><option>전체</option><option>요청중</option><option>제출완료</option><option>보완필요</option><option>검토완료</option></select></label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-1">
          {visibleDocuments.length ? <div className="grid gap-4 lg:grid-cols-2">
            {visibleDocuments.map((document) => {
              const statusTone = document.status === '검토완료' ? 'green' : document.status === '보완필요' ? 'red' : document.status === '제출완료' ? 'blue' : 'amber';
              return <article key={document.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Pill tone="navy">{companyCategoryLabel(document.category)}</Pill><Pill tone={statusTone}>{document.status}</Pill>{document.sensitive ? <Pill tone="slate"><LockKeyhole className="mr-1 size-3" aria-hidden="true" />민감자료</Pill> : null}{document.storageFileId ? <Pill tone="green">보안저장 완료</Pill> : null}</div><p className="mt-3 text-xs font-semibold text-slate-500">{document.company}</p>{document.caseId && <p className="mt-1 text-[11px] text-slate-400" title={document.caseId}>연결 진행 {document.caseId.slice(-8)}</p>}<h2 className="mt-1 text-base font-bold text-slate-950">{document.title}</h2>{document.fileName ? <p className="mt-2 [overflow-wrap:anywhere] text-xs leading-5 text-slate-500">{document.fileName}{document.fileSize ? ` · ${readableFileSize(document.fileSize)}` : ''}</p> : <p className="mt-2 text-xs leading-5 text-amber-700">아직 제출된 파일이 없습니다.</p>}{document.storageFileId ? <a href={`/api/files/${document.storageFileId}`} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-sky-100 bg-sky-50 px-3 text-xs font-bold text-[#075f93] hover:bg-sky-100"><LockKeyhole className="size-3.5" aria-hidden="true" /> 권한 확인 후 원본 내려받기</a> : null}</div><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-slate-50 text-[#0877b8]"><FileText className="size-5" aria-hidden="true" /></span></div>
                <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-3 text-xs"><div><p className="text-slate-500">담당</p><p className="mt-1 font-bold text-slate-800">{document.assignedTrainee}</p></div><div><p className="text-slate-500">버전</p><p className="mt-1 font-bold text-slate-800">{document.version}</p></div><div><p className="text-slate-500">변경</p><p className="mt-1 font-bold text-slate-800">{document.updatedAt}</p></div></div>
                <FileRecoveryNote recovery={document.recovery} />
                <label className="mt-4 block"><span className="mb-2 block text-xs font-semibold text-slate-600">상태 변경</span><select value={document.status} onChange={(event) => changeStatus(document, event.target.value as CompanyDocument['status'])} className={inputClass}><option>요청중</option><option>제출완료</option><option>보완필요</option><option>검토완료</option></select></label>
              </article>;
            })}
          </div> : <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center"><FolderOpen className="mx-auto size-9 text-slate-300" aria-hidden="true" /><p className="mt-3 text-sm font-bold text-slate-700">조건에 맞는 자료가 없습니다.</p><button type="button" onClick={() => { setQuery(''); setStatusFilter('전체'); setCompanyFilter('전체 기업'); }} className="mt-3 min-h-11 rounded-xl px-4 text-sm font-semibold text-[#0877b8] hover:bg-sky-50">필터 초기화</button></div>}
        </CardContent>
      </Card>

      <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50/70 p-5"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#0877b8]" aria-hidden="true" /><div><p className="text-sm font-bold text-[#15375b]">자료보안 운영원칙</p><p className="mt-1 text-xs leading-5 text-slate-600">주민번호·계좌번호는 마스킹하고 목적에 필요한 최소 자료만 등록합니다. 원본은 공개주소가 없는 전용 저장소에 보관하며, 서버가 관리자 또는 담당 파트너 권한을 확인한 뒤에만 내려받을 수 있습니다.</p></div></div></div>

      {uploadOpen ? <dialog open className="fixed inset-0 z-50 m-0 grid h-screen max-h-none w-screen max-w-none place-items-center border-0 bg-slate-950/45 p-4 backdrop-blur-sm" aria-labelledby="upload-modal-title">
        <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b p-5"><div><p className="text-xs font-semibold text-[#0877b8]">보안 원본파일 등록</p><h2 id="upload-modal-title" className="mt-1 text-xl font-bold">기업자료 등록</h2><p className="mt-1 text-sm text-slate-500">파일은 공개주소가 없는 기업자료 전용 저장소에 등록됩니다.</p></div><button type="button" onClick={() => setUploadOpen(false)} className="grid size-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label="자료등록 닫기"><X className="size-5" aria-hidden="true" /></button></div>
          <div className="grid max-h-[65vh] gap-5 overflow-y-auto p-5 md:grid-cols-2">
            <Field label="기업명" required><input value={uploadCompany} onChange={(event) => setUploadCompany(event.target.value)} className={inputClass} /></Field>
            <Field label="담당 계정" required hint="이메일을 확인해 동명이인을 구별하세요."><select value={uploadMemberId} onChange={(event) => setUploadMemberId(event.target.value)} className={inputClass} disabled={!isAdmin}>{isAdmin && <option value="">대표 전용 보관 · 파트너 공유 없음</option>}{members.filter((member) => member.status === '활성').map((member) => <option key={member.id} value={member.id}>{member.name.replace('(가상)', '').trim()} · {member.email}</option>)}</select></Field>
            <Field label="자료종류" required><select value={uploadCategory} onChange={(event) => { setUploadCategory(event.target.value as CompanyDocument['category']); setUploadConsent(false); }} className={inputClass}><option>사업자등록증</option><option>크레탑</option><option>재무제표</option><option value="상담녹취">녹취자료</option><option>인증·특허</option><option>계약자료</option><option>요청서류</option><option>기타자료</option></select></Field>
            <Field label="자료명" required><input value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value)} className={inputClass} /></Field>
            <div className="md:col-span-2"><label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 text-center hover:border-sky-300 hover:bg-sky-50"><Upload className="size-7 text-[#0877b8]" aria-hidden="true" /><span className="mt-3 text-sm font-semibold text-slate-800">{uploadFile?.name || 'PDF·이미지·엑셀·워드·녹취 파일 선택'}</span><span className="mt-1 text-xs text-slate-500">파일당 25MB 이하 · MP3, M4A, WAV 녹취 포함</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.docx,.txt,.mp3,.m4a,.wav" className="sr-only" onChange={(event) => { const file = event.target.files?.[0] ?? null; setUploadFile(file); if (file && documentCategoryFromFileName(file.name) === '상담녹취') setUploadCategory('상담녹취'); setUploadConsent(false); setUploadError(''); }} /></label></div>
            <label className="md:col-span-2 flex cursor-pointer items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm font-semibold text-slate-700"><input type="checkbox" checked={uploadConsent} onChange={(event) => { setUploadConsent(event.target.checked); setUploadError(''); }} className="mt-1 size-4 accent-[#0877b8]" /><span>기업으로부터 자료 제출 권한을 확인했고 불필요한 개인정보를 마스킹했습니다. 녹취자료는 저장·내부 검토·담당 파트너 공유 권한도 확인했습니다.</span></label>
            {uploadError ? <p role="alert" className="md:col-span-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{uploadError}</p> : null}
          </div>
          <div className="flex flex-col-reverse gap-3 border-t bg-slate-50 p-4 sm:flex-row sm:justify-end sm:px-5"><SecondaryButton onClick={() => setUploadOpen(false)} disabled={uploading}>취소</SecondaryButton><PrimaryButton onClick={addDocument} disabled={uploading}>{uploading ? <RefreshCw className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />} {uploading ? '보안 저장 중' : '자료 등록'}</PrimaryButton></div>
        </div>
      </dialog> : null}
      </fieldset>
    </>
  );
}

const permissionLabels: Array<{ key: keyof TraineeMember['permissions']; label: string; detail: string }> = [
  { key: 'sharedSchedule', label: '대표 공유일정', detail: '대표의 예약 가능·불가 시간과 담당기업 상담 확인' },
  { key: 'collaborationApply', label: '협업신청 등록', detail: '새 기업 협업신청 작성 및 임시저장' },
  { key: 'ownCases', label: '담당 진행 열람', detail: '본인이 주관·공동담당인 기업만 확인' },
  { key: 'fileUpload', label: '서류 업로드', detail: '담당기업의 요청서류 등록 및 제출상태 확인' },
  { key: 'quoteContract', label: '견적·계약 확인', detail: '담당기업의 승인된 견적·계약 상태 확인' },
];

function loginActivityLabel(member: TraineeMember) {
  if (!member.lastLoginAt) return '아직 로그인 기록 없음';
  const date = new Date(member.lastLoginAt);
  if (Number.isNaN(date.getTime())) return '접속시간 확인 필요';
  const formatted = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `최근접속 ${formatted} · 누적 ${member.loginCount ?? 1}회`;
}

function AccessManagement({
  notify,
  members,
  setMembers,
  registrationDisabled,
  onRegistered,
}: {
  notify: (message: string) => void;
  members: TraineeMember[];
  setMembers: React.Dispatch<React.SetStateAction<TraineeMember[]>>;
  registrationDisabled: boolean;
  onRegistered: (result: PartnerRegistrationResult) => void;
}) {
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'전체' | TraineeMember['status']>('전체');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState('');
  const [selectedEmailError, setSelectedEmailError] = useState('');
  const [selectedMemberType, setSelectedMemberType] = useState<PartnerType>('한기평 컨설턴트');
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const selectedEmailRef = useRef<HTMLInputElement>(null);

  const filteredMembers = members.filter((member) => {
    const keywordMatch = `${member.name} ${member.email} ${member.phone ?? ''} ${member.affiliation ?? ''} ${partnerTypeOf(member)}`.toLowerCase().includes(query.toLowerCase());
    const statusMatch = statusFilter === '전체'
      || (statusFilter === '승인대기' ? ['승인대기', '초대대기'].includes(member.status) : member.status === statusFilter);
    return keywordMatch && statusMatch;
  });
  const selectedMember = members.find((member) => member.id === selectedId) ?? null;

  function validateEmail(email: string, excludedMemberId?: string) {
    if (!isValidLoginEmail(email)) return '올바른 이메일 형식으로 입력해 주세요.';
    if (hasDuplicateLoginEmail(members, email, excludedMemberId)) return '이미 등록된 로그인 이메일입니다.';
    return '';
  }

  function openMemberSettings(member: TraineeMember) {
    setSelectedId(member.id);
    setSelectedEmail(member.email);
    setSelectedEmailError('');
    setSelectedMemberType(partnerTypeOf(member));
    setDeleteConfirming(false);
  }

  function closeMemberSettings() {
    setSelectedId(null);
    setSelectedEmail('');
    setSelectedEmailError('');
    setSelectedMemberType('한기평 컨설턴트');
    setDeleteConfirming(false);
  }

  function togglePermission(key: keyof TraineeMember['permissions']) {
    if (!selectedId) return;
    setMembers((current) => current.map((member) => member.id === selectedId ? { ...member, permissions: { ...member.permissions, [key]: !member.permissions[key] } } : member));
  }

  function updateSelectedMember(patch: Partial<Pick<TraineeMember, 'status'>>) {
    if (!selectedId) return;
    setMembers((current) => current.map((member) => member.id === selectedId ? { ...member, ...patch } : member));
  }

  function saveSelectedMember() {
    if (!selectedMember) return;
    const emailError = validateEmail(selectedEmail, selectedMember.id);
    if (emailError) {
      setSelectedEmailError(emailError);
      selectedEmailRef.current?.focus();
      return;
    }
    const nextEmail = selectedEmail.trim().toLowerCase();
    setMembers((current) => current.map((member) =>
      member.id === selectedMember.id ? {
        ...member,
        email: nextEmail,
        memberType: selectedMemberType,
        role: member.role === '리더 파트너' ? member.role : '일반 파트너',
      } : member,
    ));
    closeMemberSettings();
    notify(`${selectedMember.name} 계정 정보를 저장했습니다.`);
  }

  function approveSelectedMember() {
    if (!selectedMember || !['승인대기', '초대대기'].includes(selectedMember.status)) return;
    const emailError = validateEmail(selectedEmail, selectedMember.id);
    if (emailError) {
      setSelectedEmailError(emailError);
      selectedEmailRef.current?.focus();
      return;
    }
    setMembers((current) => current.map((member) => member.id === selectedMember.id ? {
      ...member,
      email: selectedEmail.trim().toLowerCase(),
      memberType: selectedMemberType,
      role: '일반 파트너',
      status: '활성',
    } : member));
    closeMemberSettings();
    notify(`${selectedMember.name}님을 ${selectedMemberType}(으)로 승인했습니다. 지금부터 로그인할 수 있습니다.`);
  }

  function deleteSelectedMember() {
    if (!selectedMember || selectedMember.status === '활성' || selectedMember.companies > 0) return;
    setMembers((current) => current.filter((member) => member.id !== selectedMember.id));
    closeMemberSettings();
    notify(`${selectedMember.name} 계정을 삭제했습니다.`);
  }

  return (
    <>
      <PageIntro
        eyebrow="관리자 전용"
        title="파트너 계정·권한관리"
        description="대표님이 파트너를 직접 등록하거나, 접수된 신청의 유형을 지정해 승인합니다."
        action={<div className="flex flex-wrap items-center gap-2"><Pill tone={members.some((member) => ['승인대기', '초대대기'].includes(member.status)) ? 'amber' : 'green'}>승인대기 {members.filter((member) => ['승인대기', '초대대기'].includes(member.status)).length}명</Pill><SecondaryButton disabled={registrationBusy} onClick={() => window.location.reload()}><RefreshCw className="size-4" aria-hidden="true" /> 신청목록 새로고침</SecondaryButton></div>}
      />

      <AdminPartnerRegistration disabled={registrationDisabled} onBusyChange={setRegistrationBusy} onRegistered={result => { onRegistered(result); setQuery(result.member.email); setStatusFilter('전체'); }} />
      <fieldset disabled={registrationBusy} className="min-w-0">
      <legend className="sr-only">기존 파트너 관리</legend>
      <section aria-label="파트너 계정 요약" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['등록 파트너', members.length, Users, '전체 이메일 계정'],
          ['활성 계정', members.filter((member) => member.status === '활성').length, UserRoundCheck, '이메일·사이트 비밀번호로 접속'],
          ['승인대기', members.filter((member) => ['승인대기', '초대대기'].includes(member.status)).length, UserPlus, '대표 유형 지정 필요'],
          ['접속 확인', members.filter((member) => member.lastLoginAt).length, Clock3, '실제 로그인 기록 있음'],
        ].map(([label, value, Icon, hint]) => {
          const MetricIcon = Icon as IconType;
          return (
            <Card key={String(label)} className="border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
              <CardHeader><CardTitle className="text-sm font-semibold text-slate-600">{String(label)}</CardTitle><CardAction className="grid size-10 place-items-center rounded-xl bg-sky-50 text-[#0877b8]"><MetricIcon className="size-5" aria-hidden="true" /></CardAction></CardHeader>
              <CardContent><p className="text-3xl font-bold tabular-nums text-[#15375b]">{String(value)}</p><p className="mt-2 text-xs text-slate-500">{String(hint)}</p></CardContent>
            </Card>
          );
        })}
      </section>

      <section aria-label="파트너 등록 승인 순서" className="mt-6 rounded-2xl border border-sky-100 bg-gradient-to-r from-[#edf7fd] to-white p-5 shadow-[0_8px_30px_rgb(15_23_42/4%)]">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div>
            <div className="flex items-center gap-2"><ShieldCheck className="size-5 text-[#0877b8]" aria-hidden="true" /><h2 className="text-base font-bold text-[#15375b]">신청 후 대표 승인으로 즉시 등록</h2></div>
            <p className="mt-2 text-xs leading-5 text-slate-600">신청자는 4개 항목만 제출하고, 대표님은 파트너 유형만 선택해 승인합니다.</p>
          </div>
          <div className="grid gap-2 text-sm sm:grid-cols-3 lg:min-w-[620px]">
            {[
              ['1', '등록 신청', '이름·연락처·소속·이메일'],
              ['2', '대표 승인', '파트너 유형 1개 선택'],
              ['3', '즉시 등록', '같은 이메일로 바로 접속'],
            ].map(([step, label, detail]) => <div key={step} className="rounded-xl border border-white bg-white/90 p-3 shadow-sm"><div className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-full bg-[#0877b8] text-xs font-bold text-white">{step}</span><p className="font-bold text-slate-800">{label}</p></div><p className="mt-2 pl-8 text-xs text-slate-500">{detail}</p></div>)}
          </div>
        </div>
      </section>

      <Card className="mt-6 border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
        <CardHeader className="border-b border-slate-100">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div><CardTitle className="text-lg font-bold">파트너 신청·계정 목록</CardTitle><CardDescription className="mt-1">한기평 컨설턴트·타사 컨설턴트·보험설계사·기타로 구분합니다.</CardDescription></div>
            <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_150px]">
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-slate-500"><Search className="size-4" aria-hidden="true" /><span className="sr-only">파트너 검색</span><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none" placeholder="이름·연락처·소속·이메일" /></label>
              <label><span className="sr-only">계정상태 필터</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as '전체' | TraineeMember['status'])} className={inputClass}><option>전체</option><option>승인대기</option><option>활성</option><option>정지</option></select></label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-1">
          {filteredMembers.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredMembers.map((member) => {
                const statusTone = member.status === '활성' ? 'green' : ['승인대기', '초대대기'].includes(member.status) ? 'amber' : 'red';
                const granted = Object.values(member.permissions).filter(Boolean).length;
                return (
                  <article key={member.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#eaf1f7] text-sm font-bold text-[#15375b]">{member.name.slice(0, 1)}</span><div className="min-w-0"><h2 className="truncate text-sm font-bold text-slate-900">{member.name}</h2><p className="mt-1 truncate text-xs text-slate-500">{member.email}</p></div></div>
                      <Pill tone={statusTone}>{member.status === '초대대기' ? '승인대기' : member.status}</Pill>
                    </div>
                    <div className="mt-4 rounded-xl bg-slate-50 p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-slate-500">소속</p><p className="mt-1 text-sm font-bold text-slate-800">{member.affiliation || '기존 계정'}</p></div><div className="text-right"><p className="text-xs text-slate-500">연락처</p><p className="mt-1 text-sm font-semibold text-slate-700">{member.phone || '미등록'}</p></div></div></div>
                    <div className="mt-4 flex flex-wrap gap-2"><Pill tone="navy">{['승인대기', '초대대기'].includes(member.status) ? '유형 선택 필요' : partnerTypeOf(member)}</Pill>{member.permissions.sharedSchedule ? <Pill tone="blue">대표 일정 공유</Pill> : <Pill tone="slate">일정 미공개</Pill>}<Pill tone="slate">권한 {granted}/5</Pill></div>
                    <div className={`mt-3 flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold ${member.lastLoginAt ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-500'}`}><Clock3 className="size-4 shrink-0" aria-hidden="true" /><span>{loginActivityLabel(member)}</span></div>
                    <SecondaryButton className="mt-4 w-full" onClick={() => openMemberSettings(member)}><UserCog className="size-4 text-[#0877b8]" aria-hidden="true" /> {['승인대기', '초대대기'].includes(member.status) ? '신청 검토·승인' : '계정·권한 설정'}</SecondaryButton>
                  </article>
                );
              })}
            </div>
          ) : <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center"><p className="text-sm font-semibold text-slate-700">조건에 맞는 파트너가 없습니다.</p><button type="button" onClick={() => { setQuery(''); setStatusFilter('전체'); }} className="mt-3 min-h-11 rounded-xl px-4 text-sm font-semibold text-[#0877b8] hover:bg-sky-50">필터 초기화</button></div>}
        </CardContent>
      </Card>

      <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50/70 p-5">
        <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#0877b8]" aria-hidden="true" /><div><p className="text-sm font-bold text-[#15375b]">로그인·자료 접근 보안원칙</p><p className="mt-1 text-xs leading-5 text-slate-600">로그인 이메일을 서버 등록명단과 대조하고, 파트너 유형과 관계없이 본인에게 배정된 기업 데이터만 조회·저장하도록 검사합니다.</p></div></div>
      </div>

      {selectedMember ? (
        <dialog open className="fixed inset-0 z-50 m-0 grid h-screen max-h-none w-screen max-w-none place-items-center border-0 bg-slate-950/40 p-4 backdrop-blur-sm" aria-labelledby="permission-modal-title">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b p-5"><div><p className="text-xs font-semibold text-[#0877b8]">{['승인대기', '초대대기'].includes(selectedMember.status) ? '신규 파트너 신청' : partnerDetail(selectedMember)}</p><h2 id="permission-modal-title" className="mt-1 text-xl font-bold">{selectedMember.name} {['승인대기', '초대대기'].includes(selectedMember.status) ? '신청 검토' : '계정·권한 설정'}</h2><p className="mt-1 text-sm text-slate-500">파트너 유형을 선택해 승인하면 바로 활성 계정으로 등록됩니다.</p></div><button type="button" onClick={closeMemberSettings} className="grid size-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label="계정·권한 설정 닫기"><X className="size-5" /></button></div>
            <div className="max-h-[65vh] space-y-3 overflow-y-auto p-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <Field label="로그인 이메일" required hint="파트너 본인이 사용하는 이메일입니다. 변경 후에는 새 비밀번호 설정 링크를 발급해 주세요.">
                  <input
                    ref={selectedEmailRef}
                    type="email"
                    value={selectedEmail}
                    onChange={(event) => { setSelectedEmail(event.target.value); setSelectedEmailError(''); }}
                    onBlur={() => setSelectedEmailError(validateEmail(selectedEmail, selectedMember.id))}
                    className={`${inputClass} ${selectedEmailError ? 'border-red-400 focus:border-red-500 focus:ring-red-100' : ''}`}
                    aria-invalid={Boolean(selectedEmailError)}
                    aria-describedby={selectedEmailError ? 'selected-email-error' : undefined}
                  />
                </Field>
                {selectedEmailError ? <p id="selected-email-error" role="alert" className="mt-2 text-sm font-semibold text-red-700">{selectedEmailError}</p> : null}
              </div>
              <div className="grid gap-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-4 sm:grid-cols-2">
                <Field label="파트너 유형" required><select value={selectedMemberType} onChange={(event) => setSelectedMemberType(event.target.value as PartnerType)} className={inputClass}>{partnerTypes.map((type) => <option key={type}>{type}</option>)}</select></Field>
                {['승인대기', '초대대기'].includes(selectedMember.status) ? <Field label="신청상태"><input value="대표 승인대기" readOnly className={`${inputClass} bg-amber-50 text-amber-800`} /></Field> : <Field label="로그인 상태"><select value={selectedMember.status} onChange={(event) => updateSelectedMember({ status: event.target.value as TraineeMember['status'] })} className={inputClass}><option>활성</option><option>정지</option></select></Field>}
              </div>
              <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2"><div><p className="text-xs text-slate-500">연락처</p><p className="mt-1 text-sm font-bold text-slate-800">{selectedMember.phone || '미등록'}</p></div><div><p className="text-xs text-slate-500">소속</p><p className="mt-1 text-sm font-bold text-slate-800">{selectedMember.affiliation || '기존 계정'}</p></div></div>
              <PartnerPasswordLink key={`${selectedMember.id}:${selectedMember.email}:${selectedMember.status}`} memberId={selectedMember.id} email={selectedMember.email} disabled={registrationDisabled || selectedMember.status === '정지' || normalizeLoginEmail(selectedEmail) !== normalizeLoginEmail(selectedMember.email)} />
              <div className={`rounded-2xl border p-4 ${selectedMember.status === '활성' ? 'border-emerald-200 bg-emerald-50/70' : ['승인대기', '초대대기'].includes(selectedMember.status) ? 'border-amber-200 bg-amber-50/70' : 'border-slate-200 bg-slate-50'}`}><div className="flex items-start gap-3"><ShieldCheck className={`mt-0.5 size-5 shrink-0 ${selectedMember.status === '활성' ? 'text-emerald-700' : ['승인대기', '초대대기'].includes(selectedMember.status) ? 'text-amber-700' : 'text-slate-500'}`} aria-hidden="true" /><div><p className="text-sm font-bold text-slate-800">{selectedMember.status === '활성' ? '이메일 계정 활성 상태' : ['승인대기', '초대대기'].includes(selectedMember.status) ? '대표 승인 후 즉시 등록' : '이메일 계정 정지 상태'}</p><p className="mt-1 text-xs leading-5 text-slate-600">{['승인대기', '초대대기'].includes(selectedMember.status) ? '기존 연락처로 본인을 확인하고 파트너 유형을 선택한 뒤 승인해 주세요.' : '등록된 이메일과 사이트 전용 비밀번호로 로그인하면 서버가 승인 상태와 담당 권한을 확인합니다.'}</p>{selectedMember.status === '활성' ? <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-slate-700"><Clock3 className="size-3.5" aria-hidden="true" /> {loginActivityLabel(selectedMember)}</p> : null}</div></div></div>
              {permissionLabels.map(({ key, label, detail }) => {
                const enabled = selectedMember.permissions[key];
                return (
                  <div key={key} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 p-4"><div><p className="text-sm font-bold text-slate-800">{label}</p><p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p></div><button type="button" role="switch" aria-checked={enabled} aria-label={`${label} 권한`} onClick={() => togglePermission(key)} className={`relative h-11 w-[68px] shrink-0 rounded-full p-1 transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-200 ${enabled ? 'bg-[#0877b8]' : 'bg-slate-300'}`}><span className={`block size-9 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} /></button></div>
                );
              })}
              <div className="rounded-2xl border border-red-200 bg-red-50/70 p-4">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div><p className="text-sm font-bold text-red-800">계정 삭제</p><p className="mt-1 text-xs leading-5 text-red-700">활성 계정이나 담당기업이 있는 계정은 먼저 정리한 뒤 삭제할 수 있습니다.</p></div>
                  {!deleteConfirming ? (
                    <button type="button" onClick={() => setDeleteConfirming(true)} disabled={selectedMember.status === '활성' || selectedMember.companies > 0} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-red-300 bg-white px-4 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-100 disabled:cursor-not-allowed disabled:opacity-50"><Trash2 className="size-4" aria-hidden="true" /> 계정 삭제</button>
                  ) : (
                    <div role="alert" className="flex flex-col gap-2 sm:items-end"><p className="text-sm font-bold text-red-800">정말 삭제하시겠습니까?</p><div className="flex gap-2"><button type="button" onClick={() => setDeleteConfirming(false)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200">취소</button><button type="button" onClick={deleteSelectedMember} className="min-h-11 rounded-xl bg-red-700 px-3 text-sm font-semibold text-white hover:bg-red-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-200">이 계정 삭제</button></div></div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-col-reverse gap-3 border-t bg-slate-50 p-4 sm:flex-row sm:justify-end sm:px-5"><SecondaryButton onClick={closeMemberSettings}>취소</SecondaryButton>{['승인대기', '초대대기'].includes(selectedMember.status) ? <PrimaryButton onClick={approveSelectedMember}><UserRoundCheck className="size-4" aria-hidden="true" /> 유형 선택 후 승인·등록</PrimaryButton> : <PrimaryButton onClick={saveSelectedMember}><Check className="size-4" aria-hidden="true" /> 계정·권한 저장</PrimaryButton>}</div>
          </div>
        </dialog>
      ) : null}

      </fieldset>
    </>
  );
}

function ApplicationForm({
  onDone,
  onCancel,
  applicant,
  canUpload,
  members,
  awaitingSave,
  onDirty,
  currentUserId,
  onDraftSaved,
  onSubmissionBusy,
}: {
  onSubmissionBusy: (busy: boolean) => void;
  currentUserId: string;
  onDraftSaved: (hasFiles: boolean) => void;
  awaitingSave: boolean;
  onDirty: () => void;
  onDone: (files: ApplicationAttachment[], companyName: string, selectedServices: string[], applicantType: PartnerType, applicantName: string, recordingConsent: boolean, partnerMemberId: string, details: ApplicationDetails, draftId: string, draftRevision: number) => Promise<void>;
  onCancel: () => void;
  applicant: { name: string; email: string; memberType: PartnerType; detail: string; editable: boolean };
  members: TraineeMember[];
  canUpload: boolean;
}) {
  const [step, setStep] = useState(1);
  const [selectedServices, setSelectedServices] = useState<string[]>(['정책자금']);
  const [selectedFiles, setSelectedFiles] = useState<ApplicationAttachment[]>([]);
  const [recordingConsent, setRecordingConsent] = useState(false);
  const submitLock = useRef(false);
  const [companyName, setCompanyName] = useState('');
  const [details, setDetails] = useState(emptyApplicationDetails);
  const [applicantType, setApplicantType] = useState<PartnerType>(applicant.memberType);
  const [applicantName, setApplicantName] = useState(applicant.name);
  const [applicantMemberId, setApplicantMemberId] = useState('');
  const [uploadConsent, setUploadConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const stepLabels = ['신청자', '기업정보', '요청서비스', '자료·동의'];
  const draftRef = useRef({ revision: 0, draftId: '' });
  const draftLock = useRef(false);
  const [draftReady, setDraftReady] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftMessage, setDraftMessage] = useState('임시저장을 확인하고 있습니다.');
  const [draftSubmitted, setDraftSubmitted] = useState<string | null>(null);
  const [missingAttachments, setMissingAttachments] = useState(false);

  useEffect(() => {
    let active = true;
    async function restore() {
      try {
        const response = await fetch('/api/application-draft', { cache: 'no-store' });
        const data = await response.json() as DraftEnvelope & { error?: string };
        if (!response.ok) throw new Error(data.error || '임시저장을 불러오지 못했습니다.');
        if (!active) return;
        draftRef.current = { revision: data.revision, draftId: data.draftId ?? crypto.randomUUID() };
        setDraftSubmitted(data.submittedCaseId);
        if (data.draft && !data.submittedCaseId) {
          setCompanyName(data.draft.companyName); setApplicantType(data.draft.applicantType as PartnerType);
          setApplicantName(data.draft.applicantName); setApplicantMemberId(data.draft.partnerMemberId);
          setSelectedServices(data.draft.selectedServices); setDetails(data.draft.details); setStep(data.draft.step);
          setMissingAttachments(data.draft.hasLocalAttachments);
          setDraftMessage('서버 임시저장을 복구했습니다. 제출 동의는 다시 확인해 주세요.');
        } else setDraftMessage(data.submittedCaseId ? '이 신청은 이미 접수됐습니다. 기존 접수를 남기고 새 신청을 작성할 수 있습니다.' : '임시저장하면 입력 문구가 본인 계정에 보관됩니다. 첨부파일은 제출 시 업로드됩니다.');
        setDraftReady(true);
      } catch (error) { if (active) setDraftMessage(error instanceof Error ? error.message : '임시저장을 확인하지 못했습니다.'); }
    }
    void restore();
    return () => { active = false; };
  }, [currentUserId]);

  async function saveDraft() {
    if (!draftReady || draftLock.current) throw new Error('임시저장 확인이 끝난 후 다시 시도해 주세요.');
    draftLock.current = true; setDraftBusy(true);
    try {
      const draft: ApplicationDraft = { companyName, applicantName, applicantType, partnerMemberId: applicantMemberId, selectedServices, details, step, hasLocalAttachments: selectedFiles.length > 0 || missingAttachments };
      const response = await fetch('/api/application-draft', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...draftRef.current, expectedUserId: currentUserId, draft }) });
      const data = await response.json() as DraftEnvelope & { error?: string };
      if (!response.ok || !data.draftId) throw new Error(data.error || '임시저장을 확인하지 못했습니다.');
      draftRef.current = { revision: data.revision, draftId: data.draftId };
      setDraftMessage('입력 문구를 서버에 임시저장했습니다. 첨부파일은 새로고침 후 다시 선택해야 합니다. 제출 중 실패했다면 같은 파일·자료정보로 재시도하면 기존 업로드를 재사용합니다.');
      onDraftSaved(selectedFiles.length > 0);
      return data.draftId;
    } finally { draftLock.current = false; setDraftBusy(false); }
  }

  async function discardDraft() {
    if (!draftReady || draftLock.current || !window.confirm('현재 임시저장과 화면 입력만 비우고 새 신청을 작성할까요? 접수된 진행과 원본파일은 삭제하지 않습니다.')) return;
    draftLock.current = true; setDraftBusy(true);
    try {
      const response = await fetch('/api/application-draft', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...draftRef.current, expectedUserId: currentUserId }) });
      const data = await response.json() as DraftEnvelope & { error?: string };
      if (!response.ok) throw new Error(data.error || '임시저장을 비우지 못했습니다.');
      draftRef.current = { revision: data.revision, draftId: crypto.randomUUID() };
      setCompanyName(''); setDetails(emptyApplicationDetails()); setApplicantName(applicant.name); setApplicantType(applicant.memberType); setApplicantMemberId(''); setSelectedServices(['정책자금']); setSelectedFiles([]); setMissingAttachments(false); setStep(1); setUploadConsent(false); setRecordingConsent(false); setDraftSubmitted(null); setSubmitError('');
      setDraftMessage('새 신청을 작성할 수 있습니다. 접수된 진행은 그대로 보존했습니다.'); onDraftSaved(false);
    } catch (error) { setSubmitError((error as Error).message); }
    finally { draftLock.current = false; setDraftBusy(false); }
  }


  function toggleService(service: string) {
    onDirty();
    setUploadConsent(false);
    setSelectedServices((current) =>
      current.includes(service) ? current.filter((item) => item !== service) : [...current, service],
    );
  }

  function changeDetail(field: ApplicationField, text: string) {
    setDetails(current => ({ ...current, [field]: text }));
    setSubmitError('');
    setUploadConsent(false);
    onDirty();
  }

  function validateStep(throughStep: number) {
    try {
      if (!applicantName.trim()) throw new ApplicationDetailsError('신청자 이름을 입력해 주세요.', 1);
      if (throughStep >= 2 && (!companyName.trim() || companyName.trim().length > applicationCompanyMaxLength)) throw new ApplicationDetailsError('기업명은 1~100자로 입력해 주세요.', 2);
      if (throughStep >= 3 && !selectedServices.length) throw new ApplicationDetailsError('요청서비스를 한 개 이상 선택해 주세요.', 3);
      parseApplicationDetails(details, throughStep);
      setSubmitError('');
      return true;
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '신청 내용을 확인해 주세요.');
      if (error instanceof ApplicationDetailsError) setStep(error.step);
      return false;
    }
  }

  async function submitApplication() {
    if (submitLock.current || draftBusy || !draftReady || draftSubmitted) return;
    if (missingAttachments) { setSubmitError('이전 첨부파일을 다시 선택하거나 첨부 없이 진행 여부를 확인해 주세요.'); return; }
    if (!awaitingSave && !validateStep(3)) return;
    if (!uploadConsent) {
      setSubmitError('자료 제출 권한과 개인정보 마스킹 여부를 확인해 주세요.');
      return;
    }
    if (selectedFiles.length && !canUpload) { setSubmitError('현재 계정에는 자료 업로드 권한이 없습니다.'); return; }
    if (selectedFiles.some(item => item.category === '상담녹취') && !recordingConsent) { setSubmitError('녹취자료의 저장·내부 검토·담당 파트너 공유 권한을 확인해 주세요.'); return; }
    const invalidFile = selectedFiles.map(item => companyFileProblem(item.file, item.category)).find(Boolean);
    if (invalidFile || selectedFiles.length > MAX_APPLICATION_FILES) { setSubmitError(invalidFile || `첨부는 ${MAX_APPLICATION_FILES}개까지 가능합니다.`); return; }
    submitLock.current = true;
    setSubmitting(true);
    onSubmissionBusy(true);
    setSubmitError('');
    let handedOff = false;
    try {
      const draftId = awaitingSave ? draftRef.current.draftId : await saveDraft();
      handedOff = true;
      await onDone(selectedFiles, companyName, selectedServices, applicantType, applicantName.trim() || applicant.name, recordingConsent, applicantMemberId, parseApplicationDetails(details), draftId, draftRef.current.revision);
      // A lost cleanup response is safe: the next restore recognizes the submitted case ID.
      await fetch('/api/application-draft', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...draftRef.current, expectedUserId: currentUserId }) }).catch(() => {});
    } catch (error) {
      if (!handedOff) onSubmissionBusy(false);
      setSubmitError(error instanceof Error ? error.message : '협업신청을 제출하지 못했습니다.');
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageIntro
        eyebrow="협업신청"
        title="새 기업 협업신청"
        description="기업과 요청서비스를 등록하면 관리자 검토 후 담당자와 진행방향이 배정됩니다."
        action={<Pill tone="navy">서버 저장 확인 후 접수</Pill>}
      />

      <Card className="mx-auto max-w-5xl border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
        <CardHeader className="border-b border-slate-100">
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-lg font-bold">{step}. {stepLabels[step - 1]}</CardTitle>
              <CardDescription>4단계 중 {step}단계</CardDescription>
            </div>
            <span className="text-sm font-bold text-[#0877b8]">{step * 25}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" aria-label={`신청 진행률 ${step * 25}%`}>
            <div className="h-full rounded-full bg-[#0877b8] transition-[width] duration-200" style={{ width: `${step * 25}%` }} />
          </div>
          <ol className="mt-3 hidden grid-cols-4 gap-2 text-xs sm:grid">
            {stepLabels.map((label, index) => (
              <li key={label} className={index + 1 <= step ? 'font-semibold text-[#0877b8]' : 'text-slate-400'}>
                {index + 1}. {label}
              </li>
            ))}
          </ol>
        </CardHeader>

        <CardContent className="py-2" onChangeCapture={onDirty}>
          <div className="mb-4 rounded-xl border border-sky-100 bg-sky-50 p-4 text-sm leading-6"><output className="block">{draftMessage}</output><p className="mt-1 text-xs text-slate-600">계정별 임시저장 1건 · 첨부파일·제출 동의는 복구 대상이 아닙니다. 임시저장 버튼을 누르지 않은 변경은 새로고침하면 사라집니다.</p>{!draftReady && <button type="button" className="mt-2 underline" onClick={() => window.location.reload()}>다시 불러오기</button>}{draftSubmitted && <SecondaryButton className="mt-3" onClick={discardDraft} disabled={draftBusy}>기존 접수를 남기고 새 신청 작성</SecondaryButton>}</div>
          {missingAttachments && <div role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><p>이전 첨부파일은 다시 선택해야 합니다.</p><button type="button" className="mt-2 underline" onClick={() => { setStep(4); setMissingAttachments(false); setUploadConsent(false); onDirty(); }}>첨부 없이 진행하겠습니다</button></div>}
          <fieldset disabled={submitting || awaitingSave || draftBusy || !draftReady || Boolean(draftSubmitted)} className="min-w-0">
          {step === 1 ? (
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="신청자 유형" required hint={applicant.editable ? '대표님은 대리 접수할 신청자 유형을 선택할 수 있습니다.' : '등록된 파트너 유형이 자동 적용됩니다.'}><select className={inputClass} value={applicantType} onChange={(event) => setApplicantType(event.target.value as PartnerType)} disabled={!applicant.editable}>{partnerTypes.map((type) => <option key={type}>{type}</option>)}</select></Field>
              <Field label="신청자 이름" required><input className={inputClass} value={applicantName} onChange={(event) => { setApplicantName(event.target.value); setApplicantMemberId(''); setUploadConsent(false); setRecordingConsent(false); }} readOnly={!applicant.editable} /></Field>
              {applicant.editable && <Field label="자료 공유 계정" hint="선택한 계정에 신청 진행과 첨부자료를 연결합니다. 이름을 직접 바꾸면 대표 전용으로 돌아갑니다."><select className={inputClass} value={applicantMemberId} onChange={(event) => { const member = members.find(item => item.id === event.target.value); setApplicantMemberId(event.target.value); setApplicantName(member?.name.replace('(가상)', '').trim() ?? applicant.name); if (member) setApplicantType(partnerTypeOf(member)); setUploadConsent(false); setRecordingConsent(false); }}><option value="">대표 전용 접수 · 파트너 공유 없음</option>{members.filter(member => member.status === '활성').map(member => <option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}</select></Field>}
              <Field label="로그인 이메일"><input className={inputClass} value={members.find(member => member.id === applicantMemberId)?.email ?? applicant.email} readOnly /></Field>
              <Field label="소속·구분"><input className={inputClass} value={applicant.editable ? '관리자 대리접수' : applicant.detail} readOnly /></Field>
              <ApplicationDetailFields step={1} value={details} onChange={changeDetail} inputClass={inputClass} />
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="기업명" required><input className={inputClass} value={companyName} onChange={(event) => { setCompanyName(event.target.value); setUploadConsent(false); setRecordingConsent(false); }} /></Field>
              <ApplicationDetailFields step={2} value={details} onChange={changeDetail} inputClass={inputClass} />
            </div>
          ) : null}

          {step === 3 ? (
            <div>
              <p className="text-sm font-semibold text-slate-800">요청서비스 <span className="text-red-600">*</span></p>
              <p className="mt-1 text-xs text-slate-500">복수 선택할 수 있습니다. 요청한 서비스는 신청 내용에 함께 저장됩니다.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {services.map((service) => {
                  const selected = selectedServices.includes(service);
                  return (
                    <button
                      key={service}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleService(service)}
                      className={`flex min-h-[64px] items-center justify-between gap-3 rounded-xl border px-4 text-left text-sm font-semibold transition-colors ${
                        selected ? 'border-[#0877b8] bg-sky-50 text-[#075f93]' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {service}
                      {selected ? <Check className="size-4" aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </div>
              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <ApplicationDetailFields step={3} value={details} onChange={changeDetail} inputClass={inputClass} />
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-6">
              {canUpload ? <ApplicationAttachments value={selectedFiles} disabled={submitting} onChange={files => { setSelectedFiles(files); if (files.length) setMissingAttachments(false); setUploadConsent(false); setRecordingConsent(false); setSubmitError(''); }} /> : <p className="rounded-xl border p-4 text-sm">현재 계정에는 파일 업로드 권한이 없습니다. 자료 없이 협업신청을 접수하거나 대표님에게 권한을 요청해 주세요.</p>}
              {selectedFiles.some(item => item.category === '상담녹취') && <label className="flex min-h-11 items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm leading-6"><input type="checkbox" checked={recordingConsent} disabled={submitting} onChange={event => { setRecordingConsent(event.target.checked); setSubmitError(''); }} className="mt-1 size-4 shrink-0 accent-primary" /><span>녹취자료의 저장·내부 검토·담당 파트너 공유에 필요한 권한을 확인했습니다. 외부 AI 분석은 별도 동의·대표 검토 후 진행합니다. (녹취자료 첨부 시 필수)</span></label>}

              <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-5">
                <div className="flex gap-3">
                  <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#0877b8]" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-bold text-[#15375b]">자료제출 권한 확인</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">기업으로부터 협업 검토에 필요한 자료를 제출할 권한을 확인했으며, 목적에 필요한 최소한의 자료만 제출합니다.</p>
                    <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm font-semibold text-slate-700">
                      <input type="checkbox" checked={uploadConsent} disabled={submitting} onChange={(event) => { setUploadConsent(event.target.checked); setSubmitError(''); }} className="mt-1 size-4 accent-[#0877b8]" /> 위 내용을 확인하고, 첨부 사본의 불필요한 개인정보를 가렸습니다.
                    </label>
                  </div>
                </div>
              </div>

            </div>
          ) : null}
          </fieldset>
          {submitError ? <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{submitError}</p> : null}
          {awaitingSave && <p className="mt-3 text-sm leading-6 text-amber-800">이 신청의 저장 완료를 확인하고 있습니다. 실패하면 아래 버튼으로 같은 신청을 다시 저장하세요. 첨부파일은 다시 올리지 않습니다.</p>}
        </CardContent>

        <div className="flex flex-col-reverse gap-3 border-t bg-slate-50 p-4 sm:flex-row sm:justify-between sm:px-6">
          <SecondaryButton onClick={step === 1 ? onCancel : () => setStep((value) => Math.max(1, value - 1))} disabled={submitting || awaitingSave || draftBusy || !draftReady || Boolean(draftSubmitted)}>
            <ChevronLeft className="size-4" aria-hidden="true" /> {step === 1 ? '취소' : '이전'}
          </SecondaryButton>
          <div className="flex flex-wrap gap-3">
            <SecondaryButton disabled={submitting || awaitingSave || draftBusy || !draftReady || Boolean(draftSubmitted)} onClick={() => { void saveDraft().catch(error => setSubmitError((error as Error).message)); }}>신청서 임시저장</SecondaryButton>
            <PrimaryButton className="flex-1 sm:flex-none" disabled={submitting || draftBusy || !draftReady || Boolean(draftSubmitted)} onClick={step === 4 ? submitApplication : () => { if (validateStep(step)) setStep(value => Math.min(4, value + 1)); }}>
              {submitting ? '저장 완료 확인 중' : awaitingSave ? '같은 신청 다시 저장' : step === 4 ? '협업신청 제출' : '다음'}
              {submitting ? <RefreshCw className="size-4 animate-spin" aria-hidden="true" /> : step < 4 ? <ChevronRight className="size-4" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
            </PrimaryButton>
          </div>
        </div>
      </Card>
    </>
  );
}

function CaseDetail({
  caseItem,
  timeline,
  documents,
  allCases,
  members,
  onConsult,
  onDocuments,
  onSetDocumentDueDates,
  onDocumentModal,
  onWorkflow,
  canFileUpload,
  canQuoteContract,
}: {
  caseItem: CollaborationCase;
  timeline: typeof baseTimeline;
  documents: CompanyDocument[];
  allCases: CollaborationCase[];
  members: TraineeMember[];
  onConsult: () => void;
  onDocuments: () => void;
  onSetDocumentDueDates: (documentIds: string[], dueDate: string) => void;
  onDocumentModal: (type: 'quote' | 'contract') => void;
  onWorkflow: () => void;
  canFileUpload: boolean;
  canQuoteContract: boolean;
}) {
  const [tab, setTab] = useState('timeline');
  const bulkDueDateRef = useRef<HTMLInputElement>(null);
  const consultationEvents = timeline.filter((item) => item.type === '상담');
  const documentEvents = timeline.filter((item) => item.type === '서류');
  const quoteEvents = timeline.filter((item) => item.type === '견적');
  const contractEvents = timeline.filter((item) => item.type === '계약');
  const caseDocuments = documents.filter(document => recordBelongsToCase(document, document.assignedTrainee, caseItem, allCases, members));
  const requestedDocuments = caseDocuments.filter((document) => document.status === '요청중' || document.status === '보완필요');
  const missingDueDateDocuments = requestedDocuments.filter((document) => !document.dueDate);
  const services = caseItem.service.split(' · ').filter(Boolean);
  const tabs = [
    ['timeline', '전체 타임라인'],
    ['services', '진행솔루션'],
    ['consultations', '상담'],
    ...(canFileUpload ? [['documents', '서류요청']] : []),
    ...(canQuoteContract ? [['quotes', '견적서'], ['contracts', '계약서']] : []),
  ];

  return (
    <>
      <PageIntro
        eyebrow="컨설팅 진행 현황"
        title={caseItem.company}
        description={`진행번호 ${caseItem.id} · 주관 파트너 ${caseItem.trainee} · ${caseItem.service}`}
        action={<Pill tone="blue">{caseItem.stage}</Pill>}
      />

      <Card className="mb-6 border-sky-100 bg-sky-50"><CardContent className="flex flex-wrap items-center justify-between gap-4"><div><p className="font-bold text-[#15375b]">보고서부터 계약금·사후관리까지</p><p className="mt-1 text-sm text-slate-600">공동분석, 상담 예약, 1–6차 자료와 실제 계약·입금은 상담 FLOW에서 처리하세요. 아래 기존 기록은 보존됩니다.</p></div><PrimaryButton onClick={onWorkflow}>상담 FLOW 열기 <ChevronRight className="size-4" /></PrimaryButton></CardContent></Card>
      <ApplicationDetailsSummary details={caseItem.applicationDetails} />
      <section aria-label="진행 요약" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['상담', `${Math.max(caseItem.consultationCount, consultationEvents.length)}회`, '필요 횟수만큼 반복등록'],
          ['미제출 서류', `${requestedDocuments.length}건`, requestedDocuments.length ? '제출 확인 필요' : '현재 요청 없음'],
          ...(canQuoteContract ? [['견적서', quoteEvents.length ? quoteEvents.at(-1)?.title ?? '등록됨' : '미작성', quoteEvents.length ? '진행상태 확인' : '필요 시 생성'], ['계약서', contractEvents.length ? contractEvents.at(-1)?.title ?? '등록됨' : '미작성', contractEvents.length ? '진행상태 확인' : '필요 시 생성']] : []),
        ].map(([label, value, hint]) => (
          <Card key={label} className="border-0 shadow-[0_8px_24px_rgb(15_23_42/5%)] ring-slate-200/80">
            <CardContent>
              <p className="text-xs font-semibold text-slate-500">{label}</p>
              <p className="mt-2 text-lg font-bold text-[#15375b]">{value}</p>
              <p className="mt-1 text-xs text-slate-500">{hint}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
          <div className="overflow-x-auto border-b px-3 pt-3">
            <div role="tablist" aria-label="진행 상세 탭" className="flex min-w-max gap-1">
              {tabs.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => setTab(value)}
                  className={`min-h-11 rounded-t-xl px-4 text-sm font-semibold ${tab === value ? 'bg-[#15375b] text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <CardContent className="py-2">
            {tab === 'timeline' ? (
              <ol className="relative ml-2 border-l border-slate-200">
                {timeline.map((item, index) => (
                  <li key={`${item.date}-${item.title}-${index}`} className="relative py-4 pl-7">
                    <span className={`absolute -left-1.5 top-6 size-3 rounded-full border-2 border-white ${item.tone === 'amber' ? 'bg-amber-500' : item.tone === 'violet' ? 'bg-violet-500' : item.tone === 'blue' ? 'bg-sky-500' : item.tone === 'green' ? 'bg-emerald-500' : 'bg-[#15375b]'}`} />
                    <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold text-slate-900">{item.title}</p>
                          <Pill tone={item.tone}>{item.type}</Pill>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{item.detail}</p>
                      </div>
                      <time className="shrink-0 text-xs font-medium text-slate-400">{item.date}</time>
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}

            {tab === 'services' ? (
              <div className="grid gap-4 py-3 md:grid-cols-2">
                {services.map((service) => (
                  <div key={service} className="rounded-2xl border border-slate-200 p-5">
                    <div className="flex items-center justify-between gap-3"><p className="font-bold">{service}</p><Pill tone="blue">{caseItem.stage}</Pill></div>
                    <p className="mt-4 text-xs font-semibold text-slate-500">다음 행동</p>
                    <p className="mt-1 text-sm leading-6 text-slate-700">{caseItem.nextAction}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {tab === 'consultations' ? (
              <div className="py-4">
                <div className="flex items-center justify-between gap-4"><div><p className="font-bold">등록된 상담 {Math.max(caseItem.consultationCount, consultationEvents.length)}회</p><p className="mt-1 text-sm text-slate-500">필요 횟수만큼 계속 추가할 수 있습니다.</p></div><PrimaryButton onClick={onConsult}><Plus className="size-4" /> 상담 추가</PrimaryButton></div>
                {consultationEvents.length ? <div className="mt-5 space-y-3">{consultationEvents.map((item, index) => <div key={`${item.date}-${item.title}-${index}`} className="rounded-xl border p-4"><p className="text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{item.detail}</p></div>)}</div> : <div className="mt-5 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">아직 등록된 상담이 없습니다.</div>}
              </div>
            ) : null}

            {tab === 'documents' ? (
              <div className="py-4">
                <div className="flex items-center justify-between gap-4">
                  <div><p className="font-bold">서류요청 {documentEvents.length}회</p><p className="mt-1 text-sm text-slate-500">요청중·보완필요 {requestedDocuments.length}건</p><p className="mt-1 text-xs text-slate-500">이 진행에 연결된 서류만 표시합니다. 연결이 불명확한 과거 자료는 기업별 자료함에서 확인해 주세요.</p></div>
                  <PrimaryButton onClick={onDocuments}><Plus className="size-4" /> 새 요청</PrimaryButton>
                </div>
                {missingDueDateDocuments.length ? (
                  <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                    <p className="text-sm font-bold text-amber-900">제출기한이 누락된 요청서류 {missingDueDateDocuments.length}건</p>
                    <p className="mt-1 text-xs leading-5 text-amber-800">기존 요청에 날짜가 저장되지 않은 경우 한 번에 보정할 수 있습니다.</p>
                    <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); const dueDate = bulkDueDateRef.current?.value ?? ''; if (!dueDate) return; onSetDocumentDueDates(missingDueDateDocuments.map((document) => document.id), dueDate); event.currentTarget.reset(); }}>
                      <label className="min-w-0 flex-1"><span className="sr-only">미등록 요청서류 제출기한</span><input ref={bulkDueDateRef} name="bulkDueDate" type="date" required className={inputClass} /></label>
                      <PrimaryButton type="submit"><Check className="size-4" /> 기한 일괄 저장</PrimaryButton>
                    </form>
                  </div>
                ) : null}
                {caseDocuments.length ? (
                  <div className="mt-5 space-y-3">
                    {caseDocuments.map((document) => (
                      <div key={document.id} className="flex items-center justify-between gap-3 rounded-xl border p-4">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{document.title}</p>
                          <p className="mt-1 text-xs text-slate-500">{document.dueDate ? `제출기한 ${formatKoreanDate(document.dueDate)}` : document.updatedAt}</p>
                        </div>
                        <Pill tone={document.status === '검토완료' ? 'green' : document.status === '보완필요' ? 'red' : document.status === '제출완료' ? 'blue' : 'amber'}>{document.status}</Pill>
                      </div>
                    ))}
                  </div>
                ) : <div className="mt-5 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">아직 등록된 서류요청이 없습니다.</div>}
              </div>
            ) : null}

            {tab === 'quotes' ? (
              <div className="py-4">{quoteEvents.length ? <div className="space-y-3">{quoteEvents.map((item, index) => <div key={`${item.date}-${item.title}-${index}`} className="rounded-2xl border p-5"><div className="flex items-center justify-between gap-3"><p className="font-bold">{item.title}</p><Pill tone="violet">견적</Pill></div><p className="mt-2 text-sm text-slate-600">{item.detail}</p></div>)}</div> : <div className="py-8 text-center"><FilePlus2 className="mx-auto size-9 text-slate-300" /><p className="mt-3 font-bold">등록된 견적서가 없습니다.</p><PrimaryButton className="mt-4" onClick={() => onDocumentModal('quote')}><Plus className="size-4" /> 견적서 작성</PrimaryButton></div>}</div>
            ) : null}

            {tab === 'contracts' ? (
              contractEvents.length ? <div className="space-y-3 py-4">{contractEvents.map((item, index) => <div key={`${item.date}-${item.title}-${index}`} className="rounded-2xl border p-5"><div className="flex items-center justify-between gap-3"><p className="font-bold">{item.title}</p><Pill tone="violet">계약</Pill></div><p className="mt-2 text-sm text-slate-600">{item.detail}</p></div>)}</div> : <div className="py-10 text-center"><FileText className="mx-auto size-9 text-slate-300" /><p className="mt-3 font-bold">등록된 계약서가 없습니다.</p><p className="mt-1 text-sm text-slate-500">필요한 상담 뒤에 계약서 초안을 생성하세요.</p><PrimaryButton className="mt-4" onClick={() => onDocumentModal('contract')}><Plus className="size-4" /> 계약서 작성</PrimaryButton></div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card className="border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
            <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-bold">빠른 업무 등록</CardTitle><CardDescription>현재 단계와 무관하게 생성됩니다.</CardDescription></CardHeader>
            <CardContent className="grid gap-3 pt-1 sm:grid-cols-2 xl:grid-cols-1">
              <SecondaryButton onClick={onConsult} className="justify-start"><MessageSquarePlus className="size-4 text-[#0877b8]" /> 상담 등록</SecondaryButton>
              {canFileUpload ? <SecondaryButton onClick={onDocuments} className="justify-start"><FileCheck2 className="size-4 text-[#0877b8]" /> 서류요청</SecondaryButton> : null}
              {canQuoteContract ? <SecondaryButton onClick={() => onDocumentModal('quote')} className="justify-start"><FilePlus2 className="size-4 text-[#0877b8]" /> 견적서 작성</SecondaryButton> : null}
              {canQuoteContract ? <SecondaryButton onClick={() => onDocumentModal('contract')} className="justify-start"><FileText className="size-4 text-[#0877b8]" /> 계약서 작성</SecondaryButton> : null}
              {!canQuoteContract ? <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600 sm:col-span-2 xl:col-span-1"><LockKeyhole className="mr-1 inline size-4 align-text-bottom" aria-hidden="true" />견적·계약 기능은 별도 승인 또는 대표 권한이 필요합니다.</div> : null}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
            <CardHeader><CardTitle className="text-lg font-bold">다음 행동</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm font-semibold text-slate-800">{caseItem.nextAction}</p>
              <div className="mt-3 flex items-center justify-between gap-3"><Pill tone={caseItem.urgent ? 'red' : 'amber'}>{caseItem.updatedAt}</Pill><span className="text-xs text-slate-500">담당 {caseItem.trainee}</span></div>
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
}

function ConsultationForm({
  number,
  caseItem,
  onSave,
  onCancel,
}: {
  number: number;
  caseItem: CollaborationCase;
  onSave: (payload: ConsultationPayload) => void;
  onCancel: () => void;
}) {
  const options = ['다음 상담 등록', '서류요청', '견적서 작성', '계약서 작성', '내부업무 등록'];
  const [followUps, setFollowUps] = useState<string[]>(['서류요청']);
  const [calendarSync, setCalendarSync] = useState(true);
  const [title, setTitle] = useState(`${caseItem.service} 진행방향 및 보완사항 협의`);
  const [startsAt, setStartsAt] = useState('2026-09-04T11:00');
  const [method, setMethod] = useState('화상');
  const [status, setStatus] = useState('일정 확정');
  const [shareMode, setShareMode] = useState<'all_with_assignee' | 'all_busy' | 'private'>('all_with_assignee');

  function toggle(item: string) {
    setFollowUps((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item]);
  }

  return (
    <>
      <PageIntro
        eyebrow="상담 반복등록"
        title={`상담 #${number} 등록`}
        description="상담 횟수에 제한이 없습니다. 상담완료 후 필요한 후속조치를 여러 개 동시에 만들 수 있습니다."
        action={<Pill tone="blue">{caseItem.company}</Pill>}
      />

      <Card className="mx-auto max-w-5xl border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
        <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-bold">상담 기본정보</CardTitle><CardDescription>상담번호는 시스템이 자동으로 부여합니다.</CardDescription></CardHeader>
        <CardContent className="space-y-7 py-2">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="상담 제목·목적" required><input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 정책자금 신청방향 및 보완사항 협의" /></Field>
            <Field label="관련 서비스" required><select className={inputClass}>{caseItem.service.split(' · ').filter(Boolean).map((service) => <option key={service}>{service}</option>)}<option>전체</option></select></Field>
            <Field label="상담 일시" required><input className={inputClass} type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></Field>
            <Field label="상담방식"><select className={inputClass} value={method} onChange={(event) => setMethod(event.target.value)}><option>전화</option><option>방문</option><option>화상</option><option>기타</option></select></Field>
            <Field label="참석자"><input className={inputClass} placeholder="기업대표, 파트너, 내부 담당자" /></Field>
            <Field label="상담상태"><select className={inputClass} value={status} onChange={(event) => setStatus(event.target.value)}><option>상담 완료</option><option>일정 요청</option><option>일정 확정</option><option>고객 회신 대기</option><option>취소</option></select></Field>
          </div>

          <section aria-labelledby="calendar-sync-title" className={`rounded-2xl border p-5 ${calendarSync ? 'border-sky-200 bg-sky-50/70' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-[#0877b8] shadow-sm"><CalendarDays className="size-5" aria-hidden="true" /></span>
                <div>
                  <h2 id="calendar-sync-title" className="text-sm font-bold text-[#15375b]">김성민 대표 Google Calendar 연동</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-600">상담이 일정 확정 상태이면 대표 캘린더 등록 대상으로 함께 저장합니다.</p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={calendarSync}
                onClick={() => setCalendarSync((value) => !value)}
                className={`relative h-11 w-[68px] shrink-0 rounded-full p-1 transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-200 ${calendarSync ? 'bg-[#0877b8]' : 'bg-slate-300'}`}
                aria-label="김성민 대표 Google Calendar 등록"
              >
                <span className={`block size-9 rounded-full bg-white shadow-sm transition-transform ${calendarSync ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
            <p className="mt-4 rounded-xl bg-white/80 px-4 py-3 text-xs leading-5 text-slate-600">
              {calendarSync ? '저장 후 대표 일정에 상담 제목·시간·상담방식이 등록되고, 파트너 화면에는 가능/불가 시간만 표시됩니다.' : '캘린더 연동 없이 상담기록만 저장합니다.'}
            </p>
          </section>

          <section aria-labelledby="trainee-share-title" className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-emerald-700 shadow-sm"><Share2 className="size-5" aria-hidden="true" /></span>
              <div className="min-w-0 flex-1">
                <h2 id="trainee-share-title" className="text-sm font-bold text-emerald-950">파트너 일정 공개범위</h2>
                <p className="mt-1 text-xs leading-5 text-emerald-900/80">전체 파트너에게는 예약시간을, 담당 파트너에게는 기업명과 상담목적까지 공유할 수 있습니다.</p>
                <select value={shareMode} onChange={(event) => setShareMode(event.target.value as 'all_with_assignee' | 'all_busy' | 'private')} className={`${inputClass} mt-4 border-emerald-200`} aria-label="파트너 일정 공개범위">
                  <option value="all_with_assignee">전체 파트너 시간 공유 · 담당 파트너 상세공개</option>
                  <option value="all_busy">전체 파트너에게 예약시간만 공개</option>
                  <option value="private">대표·내부 담당자만 공개</option>
                </select>
              </div>
            </div>
          </section>

          <div className="grid gap-5 md:grid-cols-2">
            <Field label="주요 상담내용" required><textarea className={`${inputClass} min-h-36 py-3`} placeholder="상담에서 확인한 핵심 내용을 적어주세요." /></Field>
            <Field label="상담 결과·다음 행동" required><textarea className={`${inputClass} min-h-36 py-3`} placeholder="결정사항, 담당자, 기한을 적어주세요." /></Field>
          </div>

          <div>
            <p className="text-sm font-bold text-slate-800">상담완료 후 후속조치</p>
            <p className="mt-1 text-xs text-slate-500">여러 항목을 동시에 선택할 수 있습니다.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {options.map((option) => {
                const selected = followUps.includes(option);
                return (
                  <button key={option} type="button" aria-pressed={selected} onClick={() => toggle(option)} className={`flex min-h-12 items-center justify-between rounded-xl border px-4 text-left text-sm font-semibold ${selected ? 'border-[#0877b8] bg-sky-50 text-[#075f93]' : 'border-slate-200 hover:bg-slate-50'}`}>
                    {option} {selected ? <Check className="size-4" /> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <Field label="공유 메모" hint="파트너에게 보이는 내용입니다."><textarea className={`${inputClass} min-h-28 py-3`} placeholder="파트너와 공유할 준비사항" /></Field>
            <Field label="내부 전용 메모" hint="대표와 내부 담당자만 볼 수 있습니다."><textarea className={`${inputClass} min-h-28 py-3`} placeholder="내부 판단과 유의사항" /></Field>
          </div>
        </CardContent>
        <div className="flex flex-col-reverse gap-3 border-t bg-slate-50 p-4 sm:flex-row sm:justify-end sm:px-6">
          <SecondaryButton onClick={onCancel}>취소</SecondaryButton>
          <PrimaryButton onClick={() => onSave({ followUps, calendarSync, title, startsAt, method, status, shareMode })}><Check className="size-4" /> 상담 #{number} 저장</PrimaryButton>
        </div>
      </Card>
    </>
  );
}

function DocumentRequest({ caseItem, onSave, onCancel }: { caseItem: CollaborationCase; onSave: (payload: DocumentRequestPayload) => void; onCancel: () => void }) {
  const [items, setItems] = useState([
    { name: '사업자등록증', required: true },
    { name: '크레탑 기업정보', required: true },
    { name: '최근 3개년 재무제표', required: true },
    { name: '부가가치세 과세표준증명', required: false },
  ]);
  const [newItem, setNewItem] = useState('');
  const dueDateRef = useRef<HTMLInputElement>(null);
  const [formError, setFormError] = useState('');

  function addItem() {
    if (!newItem.trim()) return;
    setItems((current) => [...current, { name: newItem.trim(), required: true }]);
    setNewItem('');
  }

  function saveRequest() {
    const dueDate = dueDateRef.current?.value ?? '';
    if (!dueDate) {
      setFormError('제출기한을 선택해 주세요.');
      return;
    }
    if (!items.length) {
      setFormError('요청할 서류를 한 건 이상 추가해 주세요.');
      return;
    }
    setFormError('');
    onSave({ items, dueDate });
  }

  return (
    <>
      <PageIntro
        eyebrow="독립 업무 등록"
        title="새 서류요청"
        description="접수·상담·계약·사후관리 어느 단계에서든 요청할 수 있으며 관련 상담 연결은 선택사항입니다."
        action={<Pill tone="amber">{caseItem.company}</Pill>}
      />

      <Card className="mx-auto max-w-5xl border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
        <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-bold">서류요청 #2</CardTitle><CardDescription>요청대상과 전달 담당자를 분리해 기록합니다.</CardDescription></CardHeader>
        <CardContent className="space-y-7 py-2">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="요청대상" required><select className={inputClass}><option>기업대표</option><option>담당 파트너</option><option>내부 담당자</option><option>외부 전문가</option></select></Field>
            <Field label="전달 담당자" required><select className={inputClass}><option>{caseItem.trainee} 파트너</option><option>김성민 대표</option></select></Field>
            <Field label="관련 서비스"><select className={inputClass}>{caseItem.service.split(' · ').filter(Boolean).map((service) => <option key={service}>{service}</option>)}<option>전체</option></select></Field>
            <Field label="관련 상담" hint="상담과 무관한 요청이면 선택하지 않아도 됩니다."><select className={inputClass}><option>연결하지 않음</option><option>상담 #1</option><option>상담 #2</option><option>상담 #3</option></select></Field>
            <Field label="제출기한" required><input ref={dueDateRef} type="date" onChange={() => setFormError('')} aria-describedby={formError ? 'document-request-error' : undefined} className={inputClass} /></Field>
            <Field label="공유범위"><select className={inputClass}><option>담당 파트너와 내부 담당자</option><option>내부 담당자만</option></select></Field>
          </div>

          <div>
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div><p className="text-sm font-bold text-slate-800">요청서류 목록</p><p className="mt-1 text-xs text-slate-500">서류별로 제출·검토·재요청 상태를 관리합니다.</p></div>
              <div className="flex gap-2"><input value={newItem} onChange={(event) => setNewItem(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addItem(); } }} className={`${inputClass} sm:w-64`} placeholder="추가 서류명" /><SecondaryButton onClick={addItem}><Plus className="size-4" /> 추가</SecondaryButton></div>
            </div>
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
              {items.map((item, index) => (
                <div key={`${item.name}-${index}`} className="flex min-h-[64px] items-center justify-between gap-4 border-b border-slate-100 px-4 last:border-b-0">
                  <div className="flex items-center gap-3"><ClipboardCheck className="size-4 text-[#0877b8]" /><span className="text-sm font-semibold text-slate-800">{item.name}</span></div>
                  <div className="flex items-center gap-2"><Pill tone={item.required ? 'amber' : 'slate'}>{item.required ? '필수' : '선택'}</Pill><button type="button" aria-label={`${item.name} 삭제`} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="grid size-11 place-items-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-600"><X className="size-4" /></button></div>
                </div>
              ))}
            </div>
          </div>

          <Field label="요청사유·안내문"><textarea className={`${inputClass} min-h-28 py-3`} placeholder="기업대표와 담당 파트너에게 전달할 요청사유와 제출방법" /></Field>

          {formError ? <p id="document-request-error" role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{formError}</p> : null}

          <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-5 text-sm leading-6 text-slate-700">
            <p className="font-bold text-[#15375b]">MVP 전달 방식</p>
            <p className="mt-1">기업대표에게 별도 계정은 제공하지 않습니다. 전달 담당자가 요청내용을 안내하고 받은 파일을 사이트에 등록합니다.</p>
          </div>
        </CardContent>
        <div className="flex flex-col-reverse gap-3 border-t bg-slate-50 p-4 sm:flex-row sm:justify-end sm:px-6">
          <SecondaryButton onClick={onCancel}>취소</SecondaryButton>
          <PrimaryButton onClick={saveRequest}><Send className="size-4" /> 서류요청 등록</PrimaryButton>
        </div>
      </Card>
    </>
  );
}

function DocumentModal({ type, onClose, onSave }: { type: 'quote' | 'contract'; onClose: () => void; onSave: () => void }) {
  const quote = type === 'quote';
  return (
    <dialog open className="fixed inset-0 z-50 m-0 grid h-screen max-h-none w-screen max-w-none place-items-center border-0 bg-slate-950/40 p-4 backdrop-blur-sm" aria-labelledby="document-modal-title">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b p-5">
          <div><p className="text-xs font-semibold text-[#0877b8]">{quote ? '견적서 독립 생성' : '경영자문용역계약서 독립 생성'}</p><h2 id="document-modal-title" className="mt-1 text-xl font-bold">{quote ? '견적서 V2 초안' : '계약서 V1 초안'}</h2><p className="mt-1 text-sm text-slate-500">관련 상담 연결은 선택사항이며 기존 버전을 덮어쓰지 않습니다.</p></div>
          <button type="button" onClick={onClose} className="grid size-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label="닫기"><X className="size-5" /></button>
        </div>
        <div className="grid max-h-[65vh] gap-5 overflow-y-auto p-5 md:grid-cols-2">
          <Field label="관련 서비스" required><select className={inputClass}><option>정책자금</option><option>특허·지식재산</option></select></Field>
          <Field label="관련 상담"><select className={inputClass}><option>연결하지 않음</option><option>상담 #1</option><option>상담 #2</option><option>상담 #3</option></select></Field>
          <Field label={quote ? '서비스 범위' : '계약 목적'} required><input className={inputClass} defaultValue="정책자금 사전진단 및 신청지원" /></Field>
          <Field label={quote ? '견적금액' : '계약금액'} required><input className={inputClass} placeholder="금액 입력" /></Field>
          <div className="md:col-span-2"><Field label="업무 범위·산출물" required><textarea className={`${inputClass} min-h-28 py-3`} placeholder="업무 범위, 산출물, 제외사항을 작성하세요." /></Field></div>
          <Field label={quote ? '유효기간' : '계약기간'}><input className={inputClass} type="date" /></Field>
          <Field label="현재 상태"><select className={inputClass}><option>초안</option><option>내부검토</option><option>{quote ? '발송승인' : '조건협의'}</option></select></Field>
        </div>
        <div className="flex flex-col-reverse gap-3 border-t bg-slate-50 p-4 sm:flex-row sm:justify-end sm:px-5"><SecondaryButton onClick={onClose}>취소</SecondaryButton><PrimaryButton onClick={onSave}><Check className="size-4" /> 초안 저장</PrimaryButton></div>
      </div>
    </dialog>
  );
}

export default function Home() {
  const [view, setView] = useState<View>('admin');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [consultationNumber, setConsultationNumber] = useState(4);
  const [timeline, setTimeline] = useState(baseTimeline);
  const [schedule, setSchedule] = useState<ScheduleItem[]>(sampleSchedule);
  const [tasks, setTasks] = useState<WorkTask[]>(sampleTasks);
  const [companyDocuments, setCompanyDocuments] = useState<CompanyDocument[]>(sampleDocuments);
  const [cases, setCases] = useState<CollaborationCase[]>(sampleCases);
  const [diagnosisAssessments, setDiagnosisAssessments] = useState<DiagnosisAssessment[]>(sampleDiagnosisAssessments);
  const [selectedCaseId, setSelectedCaseId] = useState('case-1');
  const [members, setMembers] = useState<TraineeMember[]>(sampleTrainees);
  const [membersRevision, setMembersRevision] = useState(0);
  const [scheduleAudience, setScheduleAudience] = useState<'admin' | 'trainee'>('admin');
  const [modal, setModal] = useState<'quote' | 'contract' | null>(null);
  const [toast, setToast] = useState('');
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [dataStatus, setDataStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [saveError, setSaveError] = useState('');
  const [currentUser, setCurrentUser] = useState<PortalUser | null>(null);
  const [accessError, setAccessError] = useState('');
  const [accessStatus, setAccessStatus] = useState<number | null>(null);
  const saveIdentityRef = useRef('');
  const saveStateRevisionRef = useRef('');
  const [applicationPending, setApplicationPending] = useState(false);
  const fileRecoveryLock = useRef(false);
  const [fileRecoveryBusy, setFileRecoveryBusy] = useState(false);
  const [applicationAwaitingSave, setApplicationAwaitingSave] = useState(false);
  const [applicationDirty, setApplicationDirty] = useState(false);
  const [applicationSubmission] = useState(() => new ApplicationSubmission<{ state: PortalState; caseId: string; fileCount: number; applicantType: PartnerType }>());
  const [saveQueue] = useState(() => new PortalSaveQueue<PortalState>(
    async state => {
      const result = await putPortalSnapshot(state, saveIdentityRef.current, saveStateRevisionRef.current);
      if (typeof result.stateRevision !== 'string') throw new Error('저장 버전을 확인하지 못했습니다. 화면을 유지하고 다시 시도해 주세요.');
      saveStateRevisionRef.current = result.stateRevision;
      return result;
    },
    (status, error) => { setDataStatus(status); setSaveError(error ?? ''); },
    revision => setMembersRevision(current => Math.max(current, revision)),
  ));

  useEffect(() => {
    saveQueue.activate();
    return () => saveQueue.dispose();
  }, [saveQueue]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!saveQueue.hasUnsavedChanges() && !applicationPending && !applicationDirty && !fileRecoveryLock.current) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveQueue, applicationPending, applicationDirty]);

  useEffect(() => {
    // Re-check authentication if Back restores a private page from the browser's page cache after logout.
    const recheck = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener('pageshow', recheck);
    return () => window.removeEventListener('pageshow', recheck);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadState() {
      try {
        const response = await fetch('/api/state', { cache: 'no-store' });
        const payload = await response.json() as { state?: unknown; currentUser?: PortalUser; stateRevision?: string; error?: string; authenticatedEmail?: string };
        if (!response.ok) {
          if (active) {
            setAccessStatus(response.status);
          }
          throw new Error(payload.error || '로그인 정보를 확인하지 못했습니다.');
        }
        if (!payload.currentUser) throw new Error('로그인 사용자 정보가 없습니다.');
        if (typeof payload.stateRevision !== 'string') throw new Error('운영 데이터 버전을 확인하지 못했습니다.');
        if (!active) return;

        if (payload.state !== null && payload.state !== undefined) {
          if (!isPortalState(payload.state)) throw new Error('Invalid portal state');
          saveQueue.initialize(payload.state);
          setConsultationNumber(payload.state.consultationNumber);
          setTimeline(payload.state.timeline);
          setSchedule(payload.state.schedule);
          setTasks(payload.state.tasks);
          setCompanyDocuments(payload.state.companyDocuments);
          setCases(payload.state.cases);
          setMembers(payload.state.members);
          setMembersRevision(payload.state.membersRevision ?? 0);
          setDiagnosisAssessments(payload.state.diagnosisAssessments ?? sampleDiagnosisAssessments);
        }

        saveIdentityRef.current = payload.currentUser.id;
        saveStateRevisionRef.current = payload.stateRevision;
        setCurrentUser(payload.currentUser);
        setAccessStatus(null);
        if (payload.currentUser.role === 'trainee') {
          setView('trainee');
          setScheduleAudience('trainee');
        }
        setPersistenceReady(true);
        setDataStatus(payload.state === null ? 'saving' : 'saved');
      } catch (error) {
        if (active) {
          setDataStatus('error');
          setAccessError(error instanceof Error ? error.message : '사이트 접근 권한을 확인하지 못했습니다.');
        }
      }
    }

    void loadState();
    return () => {
      active = false;
    };
  }, [saveQueue]);

  useEffect(() => {
    if (!persistenceReady || !currentUser) return;
    const state: PortalState = {
      version: 1,
      consultationNumber,
      timeline,
      schedule,
      tasks,
      companyDocuments,
      cases,
      members,
      membersRevision,
      diagnosisAssessments,
    };

    saveQueue.update(state);
  }, [saveQueue, persistenceReady, currentUser, consultationNumber, timeline, schedule, tasks, companyDocuments, cases, members, membersRevision, diagnosisAssessments]);

  const currentMember = currentUser?.role === 'trainee' ? members.find((member) => member.id === currentUser.memberId) ?? null : null;
  const selectedCase = cases.find((item) => item.id === selectedCaseId) ?? cases[0] ?? sampleCases[0];
  const storedSelectedCaseTimeline = timeline.filter((item) => (item.caseId ?? 'case-1') === selectedCase.id);
  const selectedCaseTimeline: TimelineItem[] = storedSelectedCaseTimeline.length ? storedSelectedCaseTimeline : [{
    caseId: selectedCase.id,
    date: selectedCase.updatedAt,
    title: '협업신청 접수',
    detail: `${selectedCase.service} 요청 / 주관 파트너 ${selectedCase.trainee}`,
    type: '접수',
    tone: 'navy',
  }];
  const isAdmin = currentUser?.role === 'admin';
  const previewMember = currentMember ?? members.find((member) => member.status === '활성') ?? sampleTrainees[0];
  const traineeName = currentUser?.memberName ?? previewMember.name.replace('(가상)', '');
  const accountDisplayName = isAdmin ? '김성민 대표' : currentMember?.name ?? currentUser?.displayName ?? '';
  const collaborationApplicant = {
    name: accountDisplayName,
    email: currentUser?.email ?? '',
    memberType: currentMember ? partnerTypeOf(currentMember) : '한기평 컨설턴트' as PartnerType,
    detail: currentMember ? partnerDetail(currentMember) : '관리자 대리접수',
    editable: Boolean(isAdmin),
  };
  const availableNavItems = useMemo(() => {
    if (!currentUser) return [];
    if (isAdmin) return navItems;
    if (!currentMember || currentMember.status !== '활성') return [];
    return navItems.filter((item) => {
      if (item.view === 'trainee') return true;
      if (item.view === 'tasks') return true;
      if (item.view === 'pipeline') return currentMember.permissions.ownCases;
      if (item.view === 'files') return currentMember.permissions.fileUpload;
      if (item.view === 'schedule') return currentMember.permissions.sharedSchedule;
      if (item.view === 'application') return currentMember.permissions.collaborationApply;
      if (item.view === 'case' || item.view === 'consultation' || item.view === 'workflow') return currentMember.permissions.ownCases;
      if (item.view === 'documents') return currentMember.permissions.fileUpload;
      return false;
    });
  }, [currentMember, currentUser, isAdmin]);
  const allowedViews = useMemo(() => new Set(availableNavItems.map((item) => item.view)), [availableNavItems]);
  const activeLabel = useMemo(() => navItems.find((item) => item.view === view)?.label ?? '파트너 허브', [view]);

  if (accessError) {
    if (accessStatus === 401 || accessStatus === 403) return <PartnerAuthPanel message={accessError} />;
    return <div className="grid min-h-screen place-items-center bg-slate-50 p-5"><Card className="w-full max-w-xl"><CardContent className="py-8"><h1 className="text-xl font-bold">연결을 확인해 주세요</h1><p role="alert" className="mt-3 text-sm text-slate-600">{accessError}</p><button type="button" onClick={() => window.location.reload()} className="mt-5 min-h-11 w-full rounded-xl bg-[#15375b] px-4 font-bold text-white">다시 확인</button></CardContent></Card></div>;
  }


  if (!currentUser) {
    return <div className="grid min-h-screen place-items-center bg-slate-50 p-5"><div className="text-center"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-sky-50 text-[#0877b8]"><RefreshCw className="size-7 animate-spin" aria-hidden="true" /></span><p className="mt-4 text-sm font-semibold text-slate-700">로그인 정보와 담당 권한을 확인하고 있습니다.</p></div></div>;
  }

  const accountTasks = tasks; // Server-authorized tasks, including assignments made before a name change.
  const notificationCount = accountTasks.filter((task) => task.status !== '완료' && (task.dueState === 'today' || task.dueState === 'overdue')).length;
  const dataStatusLabel = {
    loading: '데이터 불러오는 중',
    saving: '자동저장 중',
    saved: 'DB 저장됨',
    error: '저장 연결 오류',
  }[dataStatus];
  const dataStatusTone = dataStatus === 'saved' ? 'green' : dataStatus === 'error' ? 'red' : 'blue';

  async function beginFileRecovery() {
    if (fileRecoveryLock.current) throw new Error('다른 원본 회수를 확인 중입니다.');
    fileRecoveryLock.current = true; setFileRecoveryBusy(true);
    try {
      const state: PortalState = { version: 1, consultationNumber, timeline, schedule, tasks, companyDocuments, cases, members, membersRevision, diagnosisAssessments };
      saveQueue.update(state);
      await saveQueue.flush();
      return { expectedUserId: saveIdentityRef.current, stateRevision: saveStateRevisionRef.current };
    } catch (error) { fileRecoveryLock.current = false; setFileRecoveryBusy(false); throw error; }
  }
  function finishFileRecovery(reload: boolean) {
    fileRecoveryLock.current = false; setFileRecoveryBusy(false);
    if (reload) window.location.reload();
  }
  function navigate(next: View) {
    if (fileRecoveryLock.current) { notify('원본 회수 결과를 확인하고 최신 운영 화면을 불러온 뒤 이동해 주세요.'); return; }
    if (applicationPending && next !== 'application') { notify('신청 저장을 확인 중입니다. 같은 신청 저장을 완료한 뒤 이동해 주세요.'); return; }
    if (applicationDirty && next !== 'application') {
      if (!window.confirm('제출 전 입력은 저장되지 않습니다. 신청 화면을 나갈까요?')) return;
      setApplicationDirty(false);
    }
    if (!allowedViews.has(next)) {
      notify('현재 로그인 계정에는 이 메뉴 권한이 없습니다.');
      return;
    }
    setView(selectedCase.flowManaged && (next === 'consultation' || next === 'documents') ? 'workflow' : next);
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openSchedule(audience: 'admin' | 'trainee') {
    setScheduleAudience(isAdmin ? audience : 'trainee');
    navigate('schedule');
  }

  function openCase(item: CollaborationCase) {
    setSelectedCaseId(item.id);
    navigate(item.flowManaged ? 'workflow' : 'case');
  }

  async function refreshFlowProjection() {
    try {
      const response = await fetch('/api/state', { cache:'no-store' });
      const payload = await response.json() as { state?: PortalState };
      if (response.ok && payload.state) {
        setCases(current => current.map(item => { const remote = payload.state?.cases.find(c => c.id === item.id); return remote?.flowManaged ? { ...item, ...remote } : item; }));
        setSchedule(current => [...current.filter(item => !item.id.startsWith('flow-meeting:')), ...payload.state!.schedule.filter(item => item.id.startsWith('flow-meeting:'))]);
      }
    } catch { notify('업무는 저장되었습니다. 전체 진행판은 새로고침으로 확인해 주세요.'); }
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  }

  function queueDiagnosisDraft(assessment: DiagnosisAssessment) {
    if (assessment.level !== 'A') {
      notify('A 판정 건만 1차 초안 검토대기에 등록할 수 있습니다.');
      return;
    }
    setDiagnosisAssessments((current) => current.map((item) =>
      item.id === assessment.id ? { ...item, status: '대표 검토 대기', updatedAt: '방금 전 · 대기열 등록' } : item,
    ));
    setTimeline((current) => current.some((item) => item.caseId === assessment.caseId && item.title === 'AI 1차 진단 초안 검토대기')
      ? current
      : [...current, {
        caseId: assessment.caseId,
        date: '방금 전',
        title: 'AI 1차 진단 초안 검토대기',
        detail: '가상 사전점검 A 통과 / 실제 AI 전송 없음 / 김성민 대표 승인 대기',
        type: '기업진단',
        tone: 'blue',
      }]);
    setTasks((current) => current.some((task) => task.company === assessment.company && task.related === 'AI 진단 사전점검' && task.status !== '완료')
      ? current
      : [{
        id: `task-ai-${Date.now()}`,
        company: assessment.company,
        title: '1차 정밀진단 초안 생성 전 근거·동의 검토',
        kind: '내부업무',
        assignee: '김성민 대표',
        due: '오늘',
        dueState: 'today',
        status: '대기',
        priority: '보통',
        related: 'AI 진단 사전점검',
      }, ...current]);
    notify(`${assessment.company}을 1차 초안 대표 검토대기에 등록했습니다. 실제 AI 전송은 하지 않았습니다.`);
  }

  function saveConsultation(payload: ConsultationPayload) {
    const number = consultationNumber;
    setTimeline((current) => [
      ...current,
      {
        caseId: selectedCase.id,
        date: '방금 전',
        title: `상담 #${number} 저장`,
        detail: `후속조치: ${payload.followUps.length ? payload.followUps.join(' · ') : '없음'}${payload.calendarSync ? ' / Google Calendar 등록대상' : ''}${payload.shareMode !== 'private' ? ' / 파트너 일정 공유' : ''}`,
        type: '상담',
        tone: 'green',
      },
    ]);
    if (payload.status !== '취소') {
      const nextStage: PipelineStage = payload.status === '일정 요청' || payload.status === '일정 확정' ? '상담예약' : '상담진행';
      setCases((current) => current.map((item) => item.id === selectedCase.id ? { ...item, stage: nextStage, consultationCount: payload.status === '상담 완료' ? item.consultationCount + 1 : item.consultationCount, nextAction: payload.followUps.length ? payload.followUps.join(' · ') : stageNextActions[nextStage], updatedAt: '방금 전', idleDays: 0 } : item));
    }
    if (payload.calendarSync && payload.status === '일정 확정' && payload.startsAt) {
      const start = new Date(payload.startsAt);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const weekdayFormatter = new Intl.DateTimeFormat('ko-KR', { weekday: 'short' });
      const timeFormatter = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
      setSchedule((current) => [
        ...current,
        {
          id: `schedule-${Date.now()}`,
          date: `${String(start.getMonth() + 1).padStart(2, '0')}.${String(start.getDate()).padStart(2, '0')}`,
          weekday: weekdayFormatter.format(start).replace('요일', ''),
          time: timeFormatter.format(start),
          end: timeFormatter.format(end),
          company: selectedCase.company,
          service: payload.title || `상담 #${number}`,
          method: payload.method,
          status: '확정',
          tone: 'green',
          source: 'partner',
          assignedTrainee: selectedCase.trainee,
          shareMode: payload.shareMode,
        },
      ]);
    }
    if (payload.followUps.length) {
      const taskAssignee = selectedCase.trainee;
      const kindMap: Record<string, WorkTask['kind']> = {
        '다음 상담 등록': '상담',
        '서류요청': '서류요청',
        '견적서 작성': '견적서',
        '계약서 작성': '계약서',
        '내부업무 등록': '내부업무',
      };
      setTasks((current) => [
        ...payload.followUps.map((followUp, index): WorkTask => ({
          id: `task-${Date.now()}-${index}`,
          company: selectedCase.company,
          title: `상담 후 ${followUp}`,
          kind: kindMap[followUp] ?? '내부업무',
          assignee: taskAssignee,
          partnerMemberId: selectedCase.partnerMemberId,
          caseId: selectedCase.id,
          due: '09.05',
          dueState: 'upcoming',
          status: '대기',
          priority: '보통',
          related: `상담 #${number}`,
        })),
        ...current,
      ]);
    }
    setConsultationNumber((value) => value + 1);
    notify(payload.calendarSync && payload.status === '일정 확정' ? `상담 #${number}이 대표 일정과 Google Calendar 등록대상으로 저장되었습니다.` : `상담 #${number}과 후속조치가 저장되었습니다.`);
    if (payload.calendarSync && payload.status === '일정 확정') {
      openSchedule('admin');
    } else {
      navigate('case');
    }
  }

  function updateDocumentDueDates(documentIds: string[], dueDate: string) {
    const dueLabel = formatKoreanDate(dueDate);
    setCompanyDocuments((current) => current.map((document) => documentIds.includes(document.id) ? { ...document, dueDate, updatedAt: '방금 전' } : document));
    setTasks((current) => current.map((task) => recordBelongsToCase(task, task.assignee, selectedCase, cases, members) && task.kind === '서류요청' && task.due === '기한 확인' ? { ...task, due: dueLabel } : task));
    setTimeline((current) => [...current, { caseId: selectedCase.id, date: '방금 전', title: '서류 제출기한 설정', detail: `요청서류 ${documentIds.length}건 / 제출기한 ${dueLabel}`, type: '기한', tone: 'amber' }]);
    notify(`${selectedCase.company} 요청서류 ${documentIds.length}건의 제출기한을 ${dueLabel}로 저장했습니다.`);
  }

  function navButton(item: { view: View; label: string; icon: IconType }) {
    const Icon = item.icon;
    const active = item.view === view;
    return (
      <button key={item.view} type="button" onClick={() => item.view === 'schedule' ? openSchedule(view === 'trainee' ? 'trainee' : 'admin') : navigate(item.view)} className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-300/40 ${active ? 'bg-white text-[#15375b]' : 'text-blue-50 hover:bg-white/10'}`}>
        <Icon className="size-[18px]" aria-hidden="true" /> {item.label}
      </button>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a href="#main-content" className="sr-only z-[60] rounded-md bg-white px-4 py-3 text-sm font-semibold text-[#15375b] focus:not-sr-only focus:fixed focus:left-4 focus:top-4">본문으로 바로가기</a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[244px] flex-col bg-[#112f50] text-white lg:flex">
        <div className="flex h-[76px] items-center gap-3 border-b border-white/10 px-5"><BrandMark /><div><p className="text-[11px] font-semibold tracking-[0.18em] text-blue-200">KEVE</p><p className="text-[15px] font-bold tracking-tight">한기평 파트너 허브</p></div></div>
        <nav aria-label="주요 메뉴" className="flex-1 space-y-1 overflow-y-auto p-4">{availableNavItems.map(navButton)}</nav>
        <div className="m-4 min-h-24 rounded-xl border border-white/10 bg-white/5 p-4"><p className="text-xs text-blue-200">{isAdmin ? '대표 관리자' : currentMember ? partnerTypeOf(currentMember) : '파트너'}</p><p className="mt-1 text-sm font-semibold">{accountDisplayName}</p><p className="mt-2 flex items-center gap-1 text-xs text-blue-100/80"><ShieldCheck className="size-3.5" aria-hidden="true" /> {currentUser.authMethod === 'password' ? '이메일 로그인 확인' : 'ChatGPT 로그인 확인'}</p>{currentUser.authMethod === 'password' && <PartnerSignout disabled={dataStatus !== 'saved' || applicationPending || applicationDirty || fileRecoveryBusy} />}</div>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" onClick={() => setMobileOpen(false)} aria-label="메뉴 닫기" className="absolute inset-0 h-full w-full cursor-default bg-slate-950/40" />
          <aside className="relative h-full w-[min(86vw,320px)] bg-[#112f50] p-4 text-white">
            <div className="mb-5 flex items-center justify-between"><div className="flex items-center gap-3"><BrandMark /><span className="font-bold">파트너 허브</span></div><button type="button" onClick={() => setMobileOpen(false)} className="grid size-11 place-items-center rounded-xl hover:bg-white/10" aria-label="메뉴 닫기"><X /></button></div>
            <nav aria-label="모바일 메뉴" className="space-y-2">{availableNavItems.map(navButton)}</nav>
            <div className="mt-5 flex min-h-12 w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold"><span>{accountDisplayName}</span><ShieldCheck className="size-4" aria-hidden="true" /></div>
            {currentUser.authMethod === 'password' && <PartnerSignout disabled={dataStatus !== 'saved' || applicationPending || applicationDirty || fileRecoveryBusy} />}
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-[244px]">
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 lg:hidden"><button type="button" onClick={() => setMobileOpen(true)} className="grid size-11 place-items-center rounded-xl hover:bg-slate-100" aria-label="메뉴 열기"><Menu /></button><span className="hidden text-sm font-bold text-[#15375b] sm:inline">{activeLabel}</span></div>
          <div className="hidden max-w-md flex-1 items-center gap-2 rounded-xl border bg-slate-50 px-3 text-slate-500 md:flex"><Search className="size-4" aria-hidden="true" /><input aria-label="기업명 또는 신청번호 검색" className="h-10 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400" placeholder="기업명 또는 신청번호 검색" /></div>
          <div className="ml-auto flex items-center gap-2">
            <Pill tone={dataStatusTone}>{dataStatusLabel}</Pill>
            <div className="flex min-h-11 max-w-[210px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-left text-sm font-semibold text-slate-700" title={currentUser.email}><span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#eaf1f7] text-xs font-bold text-[#15375b]">{accountDisplayName.slice(0, 1)}</span><span className="hidden min-w-0 truncate sm:block">{accountDisplayName}</span><ShieldCheck className="size-4 shrink-0 text-emerald-600" aria-hidden="true" /></div>
            <button type="button" onClick={() => navigate('tasks')} className="relative hidden size-11 place-items-center rounded-xl text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-100 sm:grid" aria-label={`확인할 업무 알림 ${notificationCount}건`}><Bell aria-hidden="true" />{notificationCount ? <span className="absolute right-0.5 top-0.5 grid min-h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{notificationCount}</span> : null}</button>
            {isAdmin || currentMember?.permissions.collaborationApply ? <PrimaryButton onClick={() => navigate('application')}><Plus className="size-4" aria-hidden="true" /> <span className="hidden md:inline">새 협업신청</span><span className="md:hidden">신청</span></PrimaryButton> : null}
          </div>
        </header>

        <main id="main-content" className="mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8">
          {saveError && <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800"><p className="font-bold">변경사항 저장 확인 필요</p><p>{saveError}</p><p className="mt-1">입력은 현재 화면에 남아 있습니다. 새로고침하지 말고 연결을 확인한 뒤 다시 저장해 주세요. 로그인 만료 시 같은 계정으로 새 탭에서 로그인한 후 돌아오세요.</p><div className="mt-3 flex flex-wrap gap-3"><SecondaryButton onClick={() => { void saveQueue.flush().catch(() => {}); }} disabled={dataStatus === 'saving' || applicationPending}>변경사항 다시 저장</SecondaryButton><a className="inline-flex min-h-11 items-center underline" href="/account" target="_blank" rel="noopener noreferrer">새 탭에서 로그인</a><a className="inline-flex min-h-11 items-center underline" href="/" target="_blank" rel="noopener noreferrer">새 탭에서 최신 운영 내용 확인</a></div></div>}
          {view === 'admin' ? <AdminDashboard onOpenCase={() => navigate('case')} onOpenSchedule={() => openSchedule('admin')} schedule={schedule} /> : null}
          {view === 'pipeline' ? <PipelineBoard cases={cases} setCases={setCases} members={members} isAdmin={isAdmin} currentName={traineeName} notify={notify} onOpenCase={openCase} /> : null}
          {view === 'workflow' ? <div className="space-y-6"><div className="flex flex-wrap items-end justify-between gap-4"><label className="grid min-w-0 flex-1 gap-2 text-sm font-semibold sm:max-w-xl">진행 기업 선택<select className={inputClass} value={cases.some(item => item.id === selectedCaseId) ? selectedCaseId : cases[0]?.id ?? ''} onChange={event => setSelectedCaseId(event.target.value)}>{cases.length ? cases.map(item => <option key={item.id} value={item.id}>{item.company} · {item.trainee} · {item.id.slice(-8)}</option>) : <option value="">담당 진행 없음</option>}</select></label>{cases.length > 0 && <SecondaryButton onClick={() => navigate('case')}>기존 진행 기록 보기</SecondaryButton>}</div>{cases.length ? <><ApplicationDetailsSummary details={selectedCase.applicationDetails} /><ConsultingWorkflow key={selectedCase.id} caseId={selectedCase.id} onUpdated={() => void refreshFlowProjection()} /></> : <Card><CardContent>등록된 담당 진행이 없습니다. 먼저 협업신청을 접수해 주세요.</CardContent></Card>}</div> : null}
          {view === 'schedule' ? <SchedulePage schedule={schedule} onNewConsultation={() => navigate('consultation')} notify={notify} audience={isAdmin ? scheduleAudience : 'trainee'} onAudienceChange={setScheduleAudience} canPreviewAdmin={isAdmin} traineeName={traineeName} /> : null}
          {view === 'tasks' ? <WorkManagement tasks={tasks} setTasks={setTasks} members={members} isAdmin={isAdmin} currentName={traineeName} currentMemberId={currentUser.memberId} notify={notify} /> : null}
          {view === 'files' ? <DocumentCenter documents={companyDocuments} setDocuments={setCompanyDocuments} members={members} isAdmin={isAdmin} currentName={traineeName} currentMemberId={currentUser.memberId} currentUserId={currentUser.id} recoveryControls={{ recoveryBusy: fileRecoveryBusy, recoveryDisabled: dataStatus !== 'saved' || fileRecoveryBusy || applicationPending || applicationDirty, beginRecovery: beginFileRecovery, finishRecovery: finishFileRecovery }} notify={notify} /> : null}
          {view === 'ai-diagnosis' ? <DiagnosisPreflight assessments={diagnosisAssessments} setAssessments={setDiagnosisAssessments} cases={cases} documents={companyDocuments} onOpenFiles={() => navigate('files')} onRequestDocuments={(caseId) => { setSelectedCaseId(caseId); navigate('documents'); }} onQueueDraft={queueDiagnosisDraft} notify={notify} /> : null}
          {view === 'trainee' ? <TraineeDashboard onOpenCase={() => navigate('case')} onNew={() => navigate('application')} onOpenSchedule={() => openSchedule('trainee')} schedule={schedule} member={previewMember} /> : null}
          {view === 'access' && isAdmin ? <AccessManagement notify={notify} members={members} setMembers={setMembers} registrationDisabled={dataStatus !== 'saved'} onRegistered={result => { setMembers(result.members); setMembersRevision(result.membersRevision); notify(`${result.member.name} 파트너 등록을 확인했습니다.`); }} /> : null}
          {view === 'application' ? <ApplicationForm onSubmissionBusy={setApplicationPending} currentUserId={currentUser.id} onDraftSaved={hasFiles => setApplicationDirty(hasFiles)} awaitingSave={applicationAwaitingSave} onDirty={() => setApplicationDirty(true)} applicant={collaborationApplicant} members={members} canUpload={isAdmin || Boolean(currentMember?.permissions.fileUpload)} onCancel={() => navigate('trainee')} onDone={async (files, companyName, selectedServices, applicantType, applicantName, recordingConsent, selectedMemberId, details, draftId, draftRevision) => {
            setApplicationPending(true);
            try {
              const result = await applicationSubmission.submit(async () => {
                const initial: PortalState = { version: 1, consultationNumber, timeline, schedule, tasks, companyDocuments, cases, members, membersRevision, diagnosisAssessments };
                saveQueue.update(initial);
                await saveQueue.flush();
                const partnerMemberId = isAdmin ? selectedMemberId : currentUser.memberId ?? '';
                const company = companyName.trim() || '신규기업';
                const caseId = draftCaseId(draftId);
                if (cases.some(item => item.id === caseId)) throw new Error('이미 접수된 신청입니다. 진행 기록을 확인해 주세요.');
                const storedFiles: Array<{ category: CompanyDocument['category']; stored: StoredCompanyFile }> = [];
                // Preserve successful uploads if a later response fails. Stable request
                // keys recover them on retry, including after draft reload/reselection.
                for (const item of files) {
                  const { file, category } = item;
                  const title = applicationAttachmentTitle(item);
                  const stored = await uploadCompanyFile({ file, company, title, category, assignedTrainee: applicantName, partnerMemberId, caseId, recordingConsent, expectedUserId: currentUser.id });
                  if (!storedFiles.some(item => item.stored.id === stored.id)) storedFiles.push({ category, stored });
                }
                const service = selectedServices.join(' · ') || '기업컨설팅';
                const nextCases = prependApplicationCase(cases, { id: caseId, company, service, trainee: applicantName, partnerMemberId, applicantType, applicationDetails: details, applicationDraftRevision: draftRevision, stage: '접수', consultationCount: 0, nextAction: stageNextActions.접수, updatedAt: '방금 전', idleDays: 0, urgent: details.urgency === '긴급' });
                const nextTimeline = [...timeline, { caseId, date: '방금 전', title: '협업신청 접수', detail: `${service} 요청 / 주관 파트너 ${applicantName}`, type: '접수', tone: 'navy' }];
                const nextDocuments = [...storedFiles.map(({ category, stored }): CompanyDocument => ({
                  id: `doc-${stored.id}`, storageFileId: stored.id, fileName: stored.fileName, fileSize: stored.sizeBytes,
                  company, title: stored.title, category, status: '제출완료', assignedTrainee: stored.assignedTrainee,
                  partnerMemberId: stored.partnerMemberId, caseId: stored.caseId ?? caseId,
                  submittedBy: isAdmin ? `김성민 대표 대리접수 · ${applicantType}` : `${applicantName} · ${applicantType}`,
                  updatedAt: '방금 전', version: 'V1', sensitive: true,
                })), ...companyDocuments];
                return { state: { ...initial, cases: nextCases, timeline: nextTimeline, companyDocuments: nextDocuments }, caseId, fileCount: storedFiles.length, applicantType };
              }, async ({ state, caseId }) => {
                setApplicationAwaitingSave(true);
                setCases(state.cases);
                setTimeline(state.timeline);
                setCompanyDocuments(state.companyDocuments);
                setSelectedCaseId(caseId);
                saveQueue.update(state);
                await saveQueue.flush();
              });
              setApplicationDirty(false);
              setApplicationPending(false);
              setApplicationAwaitingSave(false);
              notify(`${result.applicantType} 협업신청 저장을 확인했습니다.${result.fileCount ? ` 첨부 ${result.fileCount}건을 연결했습니다.` : ''}`);
              setView(allowedViews.has('pipeline') ? 'pipeline' : 'trainee');
              setMobileOpen(false);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            } catch (error) {
              setApplicationPending(applicationSubmission.hasPrepared());
              throw error;
            }
          }} /> : null}
          {view === 'case' ? <CaseDetail key={selectedCase.id} caseItem={selectedCase} timeline={selectedCaseTimeline} documents={companyDocuments} allCases={cases} members={members} onWorkflow={() => navigate('workflow')} onConsult={() => navigate(selectedCase.flowManaged ? 'workflow' : 'consultation')} onDocuments={() => navigate(selectedCase.flowManaged ? 'workflow' : 'documents')} onSetDocumentDueDates={updateDocumentDueDates} onDocumentModal={() => navigate('workflow')} canFileUpload={isAdmin || Boolean(currentMember?.permissions.fileUpload)} canQuoteContract={isAdmin || Boolean(currentMember?.permissions.quoteContract)} /> : null}
          {view === 'consultation' ? <ConsultationForm key={selectedCase.id} number={consultationNumber} caseItem={selectedCase} onCancel={() => navigate('case')} onSave={saveConsultation} /> : null}
          {view === 'documents' ? <DocumentRequest key={selectedCase.id} caseItem={selectedCase} onCancel={() => navigate('case')} onSave={({ items, dueDate }) => { const requestNumber = selectedCaseTimeline.filter((item) => item.type === '서류').length + 1; const dueLabel = formatKoreanDate(dueDate); setTimeline((current) => [...current, { caseId: selectedCase.id, date: '방금 전', title: `서류요청 #${requestNumber} 등록`, detail: `요청서류 ${items.length}건 / 제출기한 ${dueLabel} / 전달 담당자: ${selectedCase.trainee} 파트너`, type: '서류', tone: 'amber' }]); setCompanyDocuments((current) => [...items.map((item, index): CompanyDocument => ({ id: `file-request-${Date.now()}-${index}`, company: selectedCase.company, title: item.name, category: '요청서류', status: '요청중', assignedTrainee: selectedCase.trainee, partnerMemberId: selectedCase.partnerMemberId, caseId: selectedCase.id, submittedBy: '기업대표 요청', updatedAt: '방금 전', dueDate, version: '-', sensitive: true })), ...current]); setTasks((current) => [{ id: `task-request-${Date.now()}`, company: selectedCase.company, title: `요청서류 ${items.length}건 제출 확인`, kind: '서류요청', assignee: selectedCase.trainee, partnerMemberId: selectedCase.partnerMemberId, caseId: selectedCase.id, due: dueLabel, dueState: 'upcoming', status: '대기', priority: '보통', related: `서류요청 #${requestNumber}` }, ...current]); setCases((current) => current.map((item) => item.id === selectedCase.id ? { ...item, nextAction: `요청서류 ${items.length}건 제출 확인`, updatedAt: '방금 전', idleDays: 0 } : item)); notify(`${selectedCase.company} 서류요청 ${items.length}건을 자료함과 업무목록에 등록했습니다.`); navigate('case'); }} /> : null}
        </main>
      </div>

      {modal ? <DocumentModal type={modal} onClose={() => setModal(null)} onSave={() => { const kind = modal === 'quote' ? '견적서 V1' : '계약서 V1'; setTimeline((current) => [...current, { caseId: selectedCase.id, date: '방금 전', title: `${kind} 초안 저장`, detail: `${selectedCase.company} / 관련 상담: 연결하지 않음 / 내부검토 전`, type: modal === 'quote' ? '견적' : '계약', tone: 'violet' }]); setModal(null); notify(`${selectedCase.company} ${kind} 초안이 저장되었습니다.`); }} /> : null}

      {toast ? <output aria-live="polite" aria-atomic="true" className="fixed bottom-5 left-1/2 z-[70] flex w-[min(92vw,520px)] -translate-x-1/2 items-center gap-3 rounded-2xl bg-[#112f50] px-5 py-4 text-sm font-semibold text-white shadow-2xl"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-emerald-400 text-[#112f50]"><Check className="size-4" /></span>{toast}</output> : null}
    </div>
  );
}
