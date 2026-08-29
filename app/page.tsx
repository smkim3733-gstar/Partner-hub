'use client';
/* oxlint-disable next/no-html-link-for-pages -- Sites authentication routes require native top-level navigation. */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bell,
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
import { hasDuplicateLoginEmail, isValidLoginEmail } from '@/lib/member-email';

type View =
  | 'admin'
  | 'pipeline'
  | 'schedule'
  | 'tasks'
  | 'files'
  | 'trainee'
  | 'access'
  | 'application'
  | 'case'
  | 'consultation'
  | 'documents';

type IconType = typeof LayoutDashboard;

const navItems: Array<{ view: View; label: string; icon: IconType }> = [
  { view: 'admin', label: '대표 대시보드', icon: LayoutDashboard },
  { view: 'pipeline', label: '전체 진행현황', icon: ClipboardList },
  { view: 'schedule', label: '대표 상담일정', icon: CalendarDays },
  { view: 'tasks', label: '업무·알림', icon: ClipboardCheck },
  { view: 'files', label: '기업자료함', icon: FolderOpen },
  { view: 'trainee', label: '파트너 화면', icon: Users },
  { view: 'access', label: '파트너 계정관리', icon: UserCog },
  { view: 'application', label: '새 협업신청', icon: FilePlus2 },
  { view: 'case', label: '컨설팅 진행 현황', icon: BriefcaseBusiness },
  { view: 'consultation', label: '상담 등록', icon: MessageSquarePlus },
  { view: 'documents', label: '서류요청 등록', icon: FileCheck2 },
];

type ScheduleItem = {
  id: string;
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

type PartnerType = '한기평 컨설턴트' | '타사 컨설턴트' | '보험설계사' | '기타';

const partnerTypes: PartnerType[] = ['한기평 컨설턴트', '타사 컨설턴트', '보험설계사', '기타'];

type TraineeMember = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  affiliation?: string;
  cohort: string;
  memberType?: PartnerType;
  role: '교육생' | '리더 교육생' | '일반 파트너' | '리더 파트너';
  status: '활성' | '승인대기' | '초대대기' | '정지';
  companies: number;
  lastLoginAt?: string;
  loginCount?: number;
  permissions: {
    sharedSchedule: boolean;
    collaborationApply: boolean;
    ownCases: boolean;
    fileUpload: boolean;
    quoteContract: boolean;
  };
};

type WorkTask = {
  id: string;
  company: string;
  title: string;
  kind: '서류요청' | '상담' | '견적서' | '계약서' | '사후관리' | '내부업무';
  assignee: string;
  due: string;
  dueState: 'overdue' | 'today' | 'upcoming';
  status: '대기' | '진행' | '완료';
  priority: '긴급' | '보통';
  related: string;
};

type CompanyDocument = {
  id: string;
  company: string;
  title: string;
  category: '사업자등록증' | '크레탑' | '재무제표' | '인증·특허' | '계약자료' | '요청서류' | '기타자료';
  fileName?: string;
  status: '요청중' | '제출완료' | '보완필요' | '검토완료';
  assignedTrainee: string;
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

type PipelineStage = '접수' | '기업진단' | '상담예약' | '상담진행' | '계약' | '사후관리';

type CollaborationCase = {
  id: string;
  company: string;
  service: string;
  trainee: string;
  applicantType?: PartnerType;
  stage: PipelineStage;
  consultationCount: number;
  nextAction: string;
  updatedAt: string;
  idleDays: number;
  urgent: boolean;
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
  const member = members.find((candidate) => candidate.name.replace('(가상)', '') === item.trainee);
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
};

type PortalUser = {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'trainee';
  memberId: string | null;
  memberName: string | null;
  permissions: TraineeMember['permissions'] | null;
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

const pipelineStages: PipelineStage[] = ['접수', '기업진단', '상담예약', '상담진행', '계약', '사후관리'];

const stageNextActions: Record<PipelineStage, string> = {
  접수: '담당자 배정 및 기본자료 확인',
  기업진단: '기업진단보고서 준비',
  상담예약: '김성민 대표 상담일 확정',
  상담진행: '다음 상담·서류·견적 판단',
  계약: '경영자문용역계약 조건 확정',
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

function documentCategoryFromFileName(fileName: string): CompanyDocument['category'] {
  const normalized = fileName.toLowerCase();
  if (normalized.includes('사업자')) return '사업자등록증';
  if (normalized.includes('cretop') || normalized.includes('크레탑')) return '크레탑';
  if (normalized.includes('재무') || normalized.includes('결산')) return '재무제표';
  if (normalized.includes('특허') || normalized.includes('인증')) return '인증·특허';
  if (normalized.includes('계약')) return '계약자료';
  return '기타자료';
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

const services = [
  '기업인증',
  '정책자금',
  '특허·지식재산',
  '영업권·법인전환',
  '부동산 프로젝트',
  'CEO 자산관리',
  '보험 법인영업',
  '기타 기업컨설팅',
];

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

function googleCalendarUrl(item: ScheduleItem) {
  const date = `2026${item.date.replace('.', '')}`;
  const start = `${date}T${item.time.replace(':', '')}00`;
  const end = `${date}T${item.end.replace(':', '')}00`;
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
  const [traineeFilter, setTraineeFilter] = useState('전체 담당자');
  const [serviceFilter, setServiceFilter] = useState('전체 서비스');
  const [staleOnly, setStaleOnly] = useState(false);

  const accountCases = isAdmin ? cases : cases.filter((item) => item.trainee === currentName);
  const serviceOptions = ['전체 서비스', ...Array.from(new Set(accountCases.map((item) => item.service)))];
  const visibleCases = accountCases.filter((item) => {
    const keywordMatch = `${item.company} ${item.service} ${item.trainee} ${casePartnerType(item, members)} ${item.nextAction}`.toLowerCase().includes(query.toLowerCase());
    const traineeMatch = traineeFilter === '전체 담당자' || item.trainee === traineeFilter;
    const serviceMatch = serviceFilter === '전체 서비스' || item.service === serviceFilter;
    const staleMatch = !staleOnly || item.idleDays >= 7;
    return keywordMatch && traineeMatch && serviceMatch && staleMatch;
  });
  const staleCount = accountCases.filter((item) => item.idleDays >= 7).length;
  const consultationCount = accountCases.filter((item) => item.stage === '상담예약' || item.stage === '상담진행').length;
  const contractCount = accountCases.filter((item) => item.stage === '계약').length;

  function moveCase(item: CollaborationCase, stage: PipelineStage) {
    setCases((current) => current.map((record) => record.id === item.id ? { ...record, stage, nextAction: stageNextActions[stage], updatedAt: '방금 전', idleDays: 0, urgent: false } : record));
    notify(`${item.company} 진행단계를 ${stage}(으)로 변경했습니다.`);
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
            {isAdmin ? <label><span className="sr-only">담당자 필터</span><select value={traineeFilter} onChange={(event) => setTraineeFilter(event.target.value)} className={inputClass}><option>전체 담당자</option>{members.filter((member) => member.status === '활성').map((member) => <option key={member.id}>{member.name.replace('(가상)', '')}</option>)}</select></label> : <div className="flex min-h-11 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">담당자 {currentName}</div>}
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
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-bold text-slate-950">{item.company}</p><p className="mt-1 text-xs leading-5 text-slate-500">{item.service}</p></div>{item.idleDays >= 7 ? <Pill tone="red">{item.idleDays}일 정체</Pill> : <Pill tone={item.urgent ? 'amber' : 'slate'}>{item.updatedAt}</Pill>}</div>
                <div className="mt-3 rounded-lg bg-slate-50 p-3"><p className="text-[11px] font-semibold text-slate-500">다음 행동</p><p className="mt-1 text-sm font-bold leading-5 text-slate-800">{item.nextAction}</p></div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-semibold text-slate-600">담당 {item.trainee}</span><div className="flex flex-wrap gap-2"><Pill tone="navy">{casePartnerType(item, members)}</Pill>{item.consultationCount ? <Pill tone="violet">상담 {item.consultationCount}회</Pill> : null}</div></div>
                <label className="mt-4 block"><span className="mb-2 block text-xs font-semibold text-slate-600">진행단계 변경</span><select value={item.stage} onChange={(event) => moveCase(item, event.target.value as PipelineStage)} className={inputClass}>{pipelineStages.map((option) => <option key={option}>{option}</option>)}</select></label>
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
  notify,
}: {
  tasks: WorkTask[];
  setTasks: React.Dispatch<React.SetStateAction<WorkTask[]>>;
  members: TraineeMember[];
  isAdmin: boolean;
  currentName: string;
  notify: (message: string) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'urgent' | 'today' | 'progress' | 'complete'>('all');
  const [query, setQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCompany, setNewCompany] = useState('세림테크(가상)');
  const [newKind, setNewKind] = useState<WorkTask['kind']>('내부업무');
  const [newAssignee, setNewAssignee] = useState(isAdmin ? '박지현' : currentName);
  const [newDue, setNewDue] = useState('09.05');
  const [newDueState, setNewDueState] = useState<WorkTask['dueState']>('upcoming');

  const accountTasks = isAdmin ? tasks : tasks.filter((task) => task.assignee === currentName);
  const visibleTasks = accountTasks.filter((task) => {
    const keywordMatch = `${task.company} ${task.title} ${task.kind} ${task.assignee}`.toLowerCase().includes(query.toLowerCase());
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
    setTasks((current) => [
      {
        id: `task-${Date.now()}`,
        company: newCompany.trim() || '내부업무',
        title: newTitle.trim(),
        kind: newKind,
        assignee: newAssignee,
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
                  <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-white/80 p-3 text-xs sm:grid-cols-3"><div><p className="text-slate-500">담당자</p><p className="mt-1 font-bold text-slate-800">{task.assignee}</p></div><div><p className="text-slate-500">마감</p><div className="mt-1"><Pill tone={dueTone}>{task.due}</Pill></div></div><div className="col-span-2 sm:col-span-1"><p className="text-slate-500">관련 업무</p><p className="mt-1 font-bold text-slate-800">{task.related}</p></div></div>
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
            <Field label="담당자" required><select value={newAssignee} onChange={(event) => setNewAssignee(event.target.value)} className={inputClass} disabled={!isAdmin}>{isAdmin ? <option>김성민 대표</option> : null}{members.filter((member) => member.status === '활성').map((member) => <option key={member.id}>{member.name.replace('(가상)', '')}</option>)}</select></Field>
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
  notify,
}: {
  documents: CompanyDocument[];
  setDocuments: React.Dispatch<React.SetStateAction<CompanyDocument[]>>;
  members: TraineeMember[];
  isAdmin: boolean;
  currentName: string;
  notify: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'전체' | CompanyDocument['status']>('전체');
  const [companyFilter, setCompanyFilter] = useState('전체 기업');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadCompany, setUploadCompany] = useState('세림테크(가상)');
  const [uploadTitle, setUploadTitle] = useState('사업자등록증');
  const [uploadCategory, setUploadCategory] = useState<CompanyDocument['category']>('사업자등록증');
  const [uploadAssignee, setUploadAssignee] = useState(isAdmin ? '박지현' : currentName);
  const [uploadFileName, setUploadFileName] = useState('');

  const accountDocuments = isAdmin ? documents : documents.filter((document) => document.assignedTrainee === currentName);
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

  function addDocument() {
    if (!uploadFileName) {
      notify('가상 등록할 파일을 선택해 주세요.');
      return;
    }
    setDocuments((current) => [
      {
        id: `file-${Date.now()}`,
        company: uploadCompany,
        title: uploadTitle.trim() || uploadCategory,
        category: uploadCategory,
        fileName: uploadFileName,
        status: '제출완료',
        assignedTrainee: uploadAssignee,
        submittedBy: isAdmin ? '김성민 대표' : currentName,
        updatedAt: '방금 전',
        version: 'V1',
        sensitive: ['사업자등록증', '크레탑', '재무제표', '계약자료'].includes(uploadCategory),
      },
      ...current,
    ]);
    setUploadFileName('');
    setUploadOpen(false);
    notify('가상 자료함에 파일정보를 등록했습니다. 실제 파일은 업로드되지 않았습니다.');
  }

  return (
    <>
      <PageIntro
        eyebrow={isAdmin ? '기업자료 통합관리' : '담당기업 자료관리'}
        title="기업별 자료함"
        description={isAdmin ? '사업자등록증·크레탑·재무제표와 상담 중 요청한 서류를 기업별로 모아 제출·보완·검토 상태를 관리합니다.' : '본인이 담당하는 기업의 자료만 확인하고 제출상태와 보완 여부를 변경할 수 있습니다.'}
        action={<PrimaryButton onClick={() => setUploadOpen(true)}><Upload className="size-4" aria-hidden="true" /> 자료 등록</PrimaryButton>}
      />

      <section aria-label="자료 제출현황 요약" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Pill tone="navy">{document.category}</Pill><Pill tone={statusTone}>{document.status}</Pill>{document.sensitive ? <Pill tone="slate"><LockKeyhole className="mr-1 size-3" aria-hidden="true" />민감자료</Pill> : null}</div><p className="mt-3 text-xs font-semibold text-slate-500">{document.company}</p><h2 className="mt-1 text-base font-bold text-slate-950">{document.title}</h2>{document.fileName ? <p className="mt-2 [overflow-wrap:anywhere] text-xs leading-5 text-slate-500">{document.fileName}</p> : <p className="mt-2 text-xs leading-5 text-amber-700">아직 제출된 파일이 없습니다.</p>}</div><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-slate-50 text-[#0877b8]"><FileText className="size-5" aria-hidden="true" /></span></div>
                <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-3 text-xs"><div><p className="text-slate-500">담당</p><p className="mt-1 font-bold text-slate-800">{document.assignedTrainee}</p></div><div><p className="text-slate-500">버전</p><p className="mt-1 font-bold text-slate-800">{document.version}</p></div><div><p className="text-slate-500">변경</p><p className="mt-1 font-bold text-slate-800">{document.updatedAt}</p></div></div>
                <label className="mt-4 block"><span className="mb-2 block text-xs font-semibold text-slate-600">상태 변경</span><select value={document.status} onChange={(event) => changeStatus(document, event.target.value as CompanyDocument['status'])} className={inputClass}><option>요청중</option><option>제출완료</option><option>보완필요</option><option>검토완료</option></select></label>
              </article>;
            })}
          </div> : <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center"><FolderOpen className="mx-auto size-9 text-slate-300" aria-hidden="true" /><p className="mt-3 text-sm font-bold text-slate-700">조건에 맞는 자료가 없습니다.</p><button type="button" onClick={() => { setQuery(''); setStatusFilter('전체'); setCompanyFilter('전체 기업'); }} className="mt-3 min-h-11 rounded-xl px-4 text-sm font-semibold text-[#0877b8] hover:bg-sky-50">필터 초기화</button></div>}
        </CardContent>
      </Card>

      <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50/70 p-5"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#0877b8]" aria-hidden="true" /><div><p className="text-sm font-bold text-[#15375b]">자료보안 운영원칙</p><p className="mt-1 text-xs leading-5 text-slate-600">주민번호·계좌번호는 마스킹하고 목적에 필요한 최소 자료만 등록합니다. 실제 운영에서는 파일을 암호화 저장하고 담당기업 권한을 서버에서 검사해야 합니다.</p></div></div></div>

      {uploadOpen ? <dialog open className="fixed inset-0 z-50 m-0 grid h-screen max-h-none w-screen max-w-none place-items-center border-0 bg-slate-950/45 p-4 backdrop-blur-sm" aria-labelledby="upload-modal-title">
        <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b p-5"><div><p className="text-xs font-semibold text-[#0877b8]">가상 파일등록</p><h2 id="upload-modal-title" className="mt-1 text-xl font-bold">기업자료 등록</h2><p className="mt-1 text-sm text-slate-500">선택한 파일명과 상태만 화면에 기록합니다.</p></div><button type="button" onClick={() => setUploadOpen(false)} className="grid size-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label="자료등록 닫기"><X className="size-5" aria-hidden="true" /></button></div>
          <div className="grid max-h-[65vh] gap-5 overflow-y-auto p-5 md:grid-cols-2">
            <Field label="기업명" required><input value={uploadCompany} onChange={(event) => setUploadCompany(event.target.value)} className={inputClass} /></Field>
            <Field label="담당 파트너" required><select value={uploadAssignee} onChange={(event) => setUploadAssignee(event.target.value)} className={inputClass} disabled={!isAdmin}>{members.filter((member) => member.status === '활성').map((member) => <option key={member.id}>{member.name.replace('(가상)', '')}</option>)}</select></Field>
            <Field label="자료종류" required><select value={uploadCategory} onChange={(event) => setUploadCategory(event.target.value as CompanyDocument['category'])} className={inputClass}><option>사업자등록증</option><option>크레탑</option><option>재무제표</option><option>인증·특허</option><option>계약자료</option><option>요청서류</option><option>기타자료</option></select></Field>
            <Field label="자료명" required><input value={uploadTitle} onChange={(event) => setUploadTitle(event.target.value)} className={inputClass} /></Field>
            <div className="md:col-span-2"><label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 text-center hover:border-sky-300 hover:bg-sky-50"><Upload className="size-7 text-[#0877b8]" aria-hidden="true" /><span className="mt-3 text-sm font-semibold text-slate-800">{uploadFileName || 'PDF·이미지·엑셀 파일 선택'}</span><span className="mt-1 text-xs text-slate-500">시안에서는 파일 자체를 전송하거나 저장하지 않습니다.</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls" className="sr-only" onChange={(event) => setUploadFileName(event.target.files?.[0]?.name ?? '')} /></label></div>
            <div className="md:col-span-2 rounded-xl border border-amber-100 bg-amber-50 p-4 text-xs leading-5 text-amber-900">현재 단계에서는 실제 문서가 업로드되지 않습니다. 파일명과 제출상태만 새로고침 전까지 가상으로 표시됩니다.</div>
          </div>
          <div className="flex flex-col-reverse gap-3 border-t bg-slate-50 p-4 sm:flex-row sm:justify-end sm:px-5"><SecondaryButton onClick={() => setUploadOpen(false)}>취소</SecondaryButton><PrimaryButton onClick={addDocument}><Upload className="size-4" aria-hidden="true" /> 자료 등록</PrimaryButton></div>
        </div>
      </dialog> : null}
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

type RegistrationField = 'name' | 'phone' | 'affiliation' | 'email';

function PartnerRegistrationForm({ email }: { email: string }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [affiliation, setAffiliation] = useState('');
  const [errors, setErrors] = useState<Partial<Record<RegistrationField, string>>>({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  function validateField(field: RegistrationField, value: string) {
    const normalized = value.trim();
    if (field === 'name' && (normalized.length < 2 || normalized.length > 40)) return '이름은 2자 이상 40자 이하로 입력해 주세요.';
    if (field === 'phone' && !/^[0-9+()\-\s.]{7,24}$/.test(normalized)) return '연락처를 숫자와 하이픈을 사용해 입력해 주세요.';
    if (field === 'affiliation' && (normalized.length < 2 || normalized.length > 80)) return '소속은 2자 이상 80자 이하로 입력해 주세요.';
    if (field === 'email' && !isValidLoginEmail(normalized)) return '로그인 이메일을 확인해 주세요.';
    return '';
  }

  function validateAll() {
    const nextErrors: Partial<Record<RegistrationField, string>> = {};
    const values: Record<RegistrationField, string> = { name, phone, affiliation, email };
    (Object.keys(values) as RegistrationField[]).forEach((field) => {
      const error = validateField(field, values[field]);
      if (error) nextErrors[field] = error;
    });
    return nextErrors;
  }

  function validateOnBlur(field: RegistrationField, value: string) {
    const error = validateField(field, value);
    setErrors((current) => ({ ...current, [field]: error || undefined }));
  }

  async function submitRegistration(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateAll();
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      window.requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }

    setSubmitting(true);
    setFormError('');
    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, phone, affiliation, email }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || '등록 신청을 저장하지 못했습니다.');
      setSubmitted(true);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '등록 신청을 저장하지 못했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <output className="mt-6 block rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-left">
        <div className="flex items-start gap-3"><UserRoundCheck className="mt-0.5 size-5 shrink-0 text-emerald-700" aria-hidden="true" /><div><p className="text-sm font-bold text-emerald-900">파트너 등록 신청 완료</p><p className="mt-1 text-xs leading-5 text-emerald-800">현재 승인대기 상태입니다. 김성민 대표가 파트너 유형을 선택해 승인하면 바로 로그인할 수 있습니다.</p></div></div>
      </output>
    );
  }

  return (
    <form onSubmit={submitRegistration} className="mt-6 rounded-2xl border border-sky-100 bg-sky-50/60 p-5 text-left" noValidate>
      <div><p className="text-sm font-bold text-[#15375b]">파트너 등록 신청</p><p className="mt-1 text-xs leading-5 text-slate-600">아래 4개 항목만 입력해 주세요. 파트너 유형은 대표님이 승인할 때 지정합니다.</p></div>
      {Object.keys(errors).length ? <div ref={errorSummaryRef} tabIndex={-1} role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800"><p>입력내용을 확인해 주세요.</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{Object.values(errors).filter(Boolean).map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
      {formError ? <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{formError}</p> : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div><Field label="이름" required><input id="registration-name" autoComplete="name" value={name} onChange={(event) => { setName(event.target.value); setErrors((current) => ({ ...current, name: undefined })); }} onBlur={() => validateOnBlur('name', name)} className={`${inputClass} ${errors.name ? 'border-red-400' : ''}`} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'registration-name-error' : undefined} /></Field>{errors.name ? <p id="registration-name-error" role="alert" className="mt-2 text-xs font-semibold text-red-700">{errors.name}</p> : null}</div>
        <div><Field label="연락처" required><input id="registration-phone" type="tel" autoComplete="tel" value={phone} onChange={(event) => { setPhone(event.target.value); setErrors((current) => ({ ...current, phone: undefined })); }} onBlur={() => validateOnBlur('phone', phone)} className={`${inputClass} ${errors.phone ? 'border-red-400' : ''}`} placeholder="010-0000-0000" aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? 'registration-phone-error' : undefined} /></Field>{errors.phone ? <p id="registration-phone-error" role="alert" className="mt-2 text-xs font-semibold text-red-700">{errors.phone}</p> : null}</div>
        <div><Field label="소속" required><input id="registration-affiliation" autoComplete="organization" value={affiliation} onChange={(event) => { setAffiliation(event.target.value); setErrors((current) => ({ ...current, affiliation: undefined })); }} onBlur={() => validateOnBlur('affiliation', affiliation)} className={`${inputClass} ${errors.affiliation ? 'border-red-400' : ''}`} placeholder="회사명 또는 소속 조직" aria-invalid={Boolean(errors.affiliation)} aria-describedby={errors.affiliation ? 'registration-affiliation-error' : undefined} /></Field>{errors.affiliation ? <p id="registration-affiliation-error" role="alert" className="mt-2 text-xs font-semibold text-red-700">{errors.affiliation}</p> : null}</div>
        <div><Field label="이메일" required hint="현재 ChatGPT 로그인 이메일입니다."><input id="registration-email" type="email" autoComplete="email" value={email} readOnly className={`${inputClass} bg-slate-100 text-slate-600 ${errors.email ? 'border-red-400' : ''}`} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'registration-email-error' : undefined} /></Field>{errors.email ? <p id="registration-email-error" role="alert" className="mt-2 text-xs font-semibold text-red-700">{errors.email}</p> : null}</div>
      </div>
      <PrimaryButton type="submit" className="mt-5 w-full" disabled={submitting}>{submitting ? <RefreshCw className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />} {submitting ? '신청 저장 중' : '등록 승인 요청'}</PrimaryButton>
    </form>
  );
}

function AccessManagement({
  notify,
  members,
  setMembers,
}: {
  notify: (message: string) => void;
  members: TraineeMember[];
  setMembers: React.Dispatch<React.SetStateAction<TraineeMember[]>>;
}) {
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
        description="4개 항목으로 들어온 등록신청을 확인하고 파트너 유형을 지정해 승인합니다."
        action={<div className="flex flex-wrap items-center gap-2"><Pill tone={members.some((member) => ['승인대기', '초대대기'].includes(member.status)) ? 'amber' : 'green'}>승인대기 {members.filter((member) => ['승인대기', '초대대기'].includes(member.status)).length}명</Pill><SecondaryButton onClick={() => window.location.reload()}><RefreshCw className="size-4" aria-hidden="true" /> 신청목록 새로고침</SecondaryButton></div>}
      />

      <section aria-label="파트너 계정 요약" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['등록 파트너', members.length, Users, '전체 이메일 계정'],
          ['활성 계정', members.filter((member) => member.status === '활성').length, UserRoundCheck, 'ChatGPT 로그인 후 접속'],
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
                <Field label="로그인 이메일" required hint="파트너가 ChatGPT에 로그인하는 이메일과 정확히 일치해야 합니다.">
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
              <div className={`rounded-2xl border p-4 ${selectedMember.status === '활성' ? 'border-emerald-200 bg-emerald-50/70' : ['승인대기', '초대대기'].includes(selectedMember.status) ? 'border-amber-200 bg-amber-50/70' : 'border-slate-200 bg-slate-50'}`}><div className="flex items-start gap-3"><ShieldCheck className={`mt-0.5 size-5 shrink-0 ${selectedMember.status === '활성' ? 'text-emerald-700' : ['승인대기', '초대대기'].includes(selectedMember.status) ? 'text-amber-700' : 'text-slate-500'}`} aria-hidden="true" /><div><p className="text-sm font-bold text-slate-800">{selectedMember.status === '활성' ? '이메일 계정 활성 상태' : ['승인대기', '초대대기'].includes(selectedMember.status) ? '대표 승인 후 즉시 등록' : '이메일 계정 정지 상태'}</p><p className="mt-1 text-xs leading-5 text-slate-600">{['승인대기', '초대대기'].includes(selectedMember.status) ? '신청내용을 확인하고 파트너 유형을 선택한 뒤 승인해 주세요.' : '등록된 이메일과 같은 ChatGPT 계정으로 로그인하면 서버가 자동으로 권한을 확인합니다.'}</p>{selectedMember.status === '활성' ? <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-slate-700"><Clock3 className="size-3.5" aria-hidden="true" /> {loginActivityLabel(selectedMember)}</p> : null}</div></div></div>
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

    </>
  );
}

function ApplicationForm({
  onDone,
  onCancel,
  applicant,
}: {
  onDone: (files: string[], companyName: string, selectedServices: string[], applicantType: PartnerType, applicantName: string) => void;
  onCancel: () => void;
  applicant: { name: string; email: string; memberType: PartnerType; detail: string; editable: boolean };
}) {
  const [step, setStep] = useState(1);
  const [selectedServices, setSelectedServices] = useState<string[]>(['정책자금']);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [companyName, setCompanyName] = useState('세림테크(가상)');
  const [applicantType, setApplicantType] = useState<PartnerType>(applicant.memberType);
  const [applicantName, setApplicantName] = useState(applicant.name);
  const stepLabels = ['신청자', '기업정보', '요청서비스', '자료·동의'];

  function toggleService(service: string) {
    setSelectedServices((current) =>
      current.includes(service) ? current.filter((item) => item !== service) : [...current, service],
    );
  }

  return (
    <>
      <PageIntro
        eyebrow="협업신청"
        title="새 기업 협업신청"
        description="기업과 요청서비스를 등록하면 관리자 검토 후 담당자와 진행방향이 배정됩니다."
        action={<Pill tone="navy">임시저장 가능</Pill>}
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

        <CardContent className="py-2">
          {step === 1 ? (
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="신청자 유형" required hint={applicant.editable ? '대표님은 대리 접수할 신청자 유형을 선택할 수 있습니다.' : '등록된 파트너 유형이 자동 적용됩니다.'}><select className={inputClass} value={applicantType} onChange={(event) => setApplicantType(event.target.value as PartnerType)} disabled={!applicant.editable}>{partnerTypes.map((type) => <option key={type}>{type}</option>)}</select></Field>
              <Field label="신청자 이름" required><input className={inputClass} value={applicantName} onChange={(event) => setApplicantName(event.target.value)} readOnly={!applicant.editable} /></Field>
              <Field label="로그인 이메일"><input className={inputClass} value={applicant.email} readOnly /></Field>
              <Field label="소속·구분"><input className={inputClass} value={applicant.editable ? '관리자 대리접수' : applicant.detail} readOnly /></Field>
              <Field label="기업과의 관계" required>
                <select className={inputClass} defaultValue="직접 상담 중">
                  <option>직접 상담 중</option><option>소개받은 기업</option><option>기존 고객</option>
                </select>
              </Field>
              <Field label="공동 협업자"><input className={inputClass} placeholder="이름 또는 이메일 검색" /></Field>
              <div className="md:col-span-2">
                <Field label="대표님에게 전달할 내용">
                  <textarea className={`${inputClass} min-h-28 py-3`} placeholder="고객의 핵심 요청과 현재까지의 상담내용을 적어주세요." />
                </Field>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="기업명" required><input className={inputClass} value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></Field>
              <Field label="사업자등록번호" required hint="중복기업 여부는 관리자에게만 상세 표시됩니다.">
                <div className="flex gap-2"><input className={inputClass} placeholder="000-00-00000" /><SecondaryButton className="shrink-0">중복확인</SecondaryButton></div>
              </Field>
              <Field label="대표자명" required><input className={inputClass} placeholder="대표자명" /></Field>
              <Field label="법인·개인 구분" required><select className={inputClass}><option>법인사업자</option><option>개인사업자</option></select></Field>
              <Field label="업종·주요사업" required><input className={inputClass} placeholder="예: 산업용 장비 제조" /></Field>
              <Field label="소재지"><input className={inputClass} placeholder="시·도 및 시·군·구" /></Field>
              <Field label="기업 담당자"><input className={inputClass} placeholder="이름" /></Field>
              <Field label="연락처"><input className={inputClass} placeholder="010-0000-0000" /></Field>
            </div>
          ) : null}

          {step === 3 ? (
            <div>
              <p className="text-sm font-semibold text-slate-800">요청서비스 <span className="text-red-600">*</span></p>
              <p className="mt-1 text-xs text-slate-500">복수 선택할 수 있으며, 선택한 서비스별 과업이 따로 생성됩니다.</p>
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
                <Field label="희망 진행시기"><input className={inputClass} type="date" /></Field>
                <Field label="긴급도"><select className={inputClass}><option>일반</option><option>긴급</option><option>일정 협의</option></select></Field>
                <div className="md:col-span-2"><Field label="요청 배경·해결할 문제" required><textarea className={`${inputClass} min-h-32 py-3`} placeholder="기업이 해결하려는 문제와 희망 결과를 적어주세요." /></Field></div>
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-6">
              <div>
                <p className="text-sm font-semibold text-slate-800">기본자료 업로드</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">주민번호·계좌번호 등 불필요한 개인정보는 마스킹 후 제출해 주세요.</p>
                <label className="mt-4 flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 text-center transition-colors hover:border-sky-300 hover:bg-sky-50">
                  <Upload className="size-7 text-[#0877b8]" aria-hidden="true" />
                  <span className="mt-3 text-sm font-semibold text-slate-800">사업자등록증·크레탑·재무자료 선택</span>
                  <span className="mt-1 text-xs text-slate-500">PDF, JPG, PNG, XLSX · 시안에서는 실제 업로드하지 않습니다.</span>
                  <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls" className="sr-only" onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []).map((file) => file.name))} />
                </label>
                {selectedFiles.length ? <div className="mt-3 space-y-2" aria-label="선택한 가상 제출파일">{selectedFiles.map((file) => <div key={file} className="flex min-h-11 items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 text-sm font-semibold text-emerald-900"><FileCheck2 className="size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]">{file}</span></div>)}</div> : null}
              </div>

              <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-5">
                <div className="flex gap-3">
                  <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#0877b8]" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-bold text-[#15375b]">자료제출 권한 확인</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">기업으로부터 협업 검토에 필요한 자료를 제출할 권한을 확인했으며, 목적에 필요한 최소한의 자료만 제출합니다.</p>
                    <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm font-semibold text-slate-700">
                      <input type="checkbox" defaultChecked className="mt-1 size-4 accent-[#0877b8]" /> 위 내용을 확인했습니다.
                    </label>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>

        <div className="flex flex-col-reverse gap-3 border-t bg-slate-50 p-4 sm:flex-row sm:justify-between sm:px-6">
          <SecondaryButton onClick={step === 1 ? onCancel : () => setStep((value) => Math.max(1, value - 1))}>
            <ChevronLeft className="size-4" aria-hidden="true" /> {step === 1 ? '취소' : '이전'}
          </SecondaryButton>
          <div className="flex gap-3">
            <SecondaryButton className="flex-1 sm:flex-none">임시저장</SecondaryButton>
            <PrimaryButton className="flex-1 sm:flex-none" onClick={step === 4 ? () => onDone(selectedFiles, companyName, selectedServices, applicantType, applicantName.trim() || applicant.name) : () => setStep((value) => Math.min(4, value + 1))}>
              {step === 4 ? '협업신청 제출' : '다음'}
              {step < 4 ? <ChevronRight className="size-4" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
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
  onConsult,
  onDocuments,
  onSetDocumentDueDates,
  onDocumentModal,
  canFileUpload,
  canQuoteContract,
}: {
  caseItem: CollaborationCase;
  timeline: typeof baseTimeline;
  documents: CompanyDocument[];
  onConsult: () => void;
  onDocuments: () => void;
  onSetDocumentDueDates: (documentIds: string[], dueDate: string) => void;
  onDocumentModal: (type: 'quote' | 'contract') => void;
  canFileUpload: boolean;
  canQuoteContract: boolean;
}) {
  const [tab, setTab] = useState('timeline');
  const [bulkDueDate, setBulkDueDate] = useState('');
  const consultationEvents = timeline.filter((item) => item.type === '상담');
  const documentEvents = timeline.filter((item) => item.type === '서류');
  const quoteEvents = timeline.filter((item) => item.type === '견적');
  const contractEvents = timeline.filter((item) => item.type === '계약');
  const caseDocuments = documents.filter((document) => document.company === caseItem.company);
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
                  <div><p className="font-bold">서류요청 {documentEvents.length}회</p><p className="mt-1 text-sm text-slate-500">요청중·보완필요 {requestedDocuments.length}건</p></div>
                  <PrimaryButton onClick={onDocuments}><Plus className="size-4" /> 새 요청</PrimaryButton>
                </div>
                {missingDueDateDocuments.length ? (
                  <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                    <p className="text-sm font-bold text-amber-900">제출기한이 누락된 요청서류 {missingDueDateDocuments.length}건</p>
                    <p className="mt-1 text-xs leading-5 text-amber-800">기존 요청에 날짜가 저장되지 않은 경우 한 번에 보정할 수 있습니다.</p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <label className="min-w-0 flex-1"><span className="sr-only">미등록 요청서류 제출기한</span><input type="date" value={bulkDueDate} onChange={(event) => setBulkDueDate(event.target.value)} className={inputClass} /></label>
                      <PrimaryButton disabled={!bulkDueDate} onClick={() => { onSetDocumentDueDates(missingDueDateDocuments.map((document) => document.id), bulkDueDate); setBulkDueDate(''); }}><Check className="size-4" /> 기한 일괄 저장</PrimaryButton>
                    </div>
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
  const [dueDate, setDueDate] = useState('');
  const [formError, setFormError] = useState('');

  function addItem() {
    if (!newItem.trim()) return;
    setItems((current) => [...current, { name: newItem.trim(), required: true }]);
    setNewItem('');
  }

  function saveRequest() {
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
            <Field label="제출기한" required><input type="date" value={dueDate} onChange={(event) => { setDueDate(event.target.value); setFormError(''); }} aria-describedby={formError ? 'document-request-error' : undefined} className={inputClass} /></Field>
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
  const [selectedCaseId, setSelectedCaseId] = useState('case-1');
  const [members, setMembers] = useState<TraineeMember[]>(sampleTrainees);
  const [scheduleAudience, setScheduleAudience] = useState<'admin' | 'trainee'>('admin');
  const [modal, setModal] = useState<'quote' | 'contract' | null>(null);
  const [toast, setToast] = useState('');
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [dataStatus, setDataStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [currentUser, setCurrentUser] = useState<PortalUser | null>(null);
  const [accessError, setAccessError] = useState('');
  const [accessStatus, setAccessStatus] = useState<number | null>(null);
  const [accessEmail, setAccessEmail] = useState('');
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;

    async function loadState() {
      try {
        const response = await fetch('/api/state', { cache: 'no-store' });
        const payload = await response.json() as { state?: unknown; currentUser?: PortalUser; error?: string; authenticatedEmail?: string };
        if (!response.ok) {
          if (active) {
            setAccessStatus(response.status);
            setAccessEmail(payload.authenticatedEmail ?? '');
          }
          throw new Error(payload.error || '로그인 정보를 확인하지 못했습니다.');
        }
        if (!payload.currentUser) throw new Error('로그인 사용자 정보가 없습니다.');
        if (!active) return;

        if (payload.state !== null && payload.state !== undefined) {
          if (!isPortalState(payload.state)) throw new Error('Invalid portal state');
          setConsultationNumber(payload.state.consultationNumber);
          setTimeline(payload.state.timeline);
          setSchedule(payload.state.schedule);
          setTasks(payload.state.tasks);
          setCompanyDocuments(payload.state.companyDocuments);
          setCases(payload.state.cases);
          setMembers(payload.state.members);
        }

        setCurrentUser(payload.currentUser);
        setAccessStatus(null);
        setAccessEmail('');
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
  }, []);

  useEffect(() => {
    if (!persistenceReady || !currentUser) return;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    const state: PortalState = {
      version: 1,
      consultationNumber,
      timeline,
      schedule,
      tasks,
      companyDocuments,
      cases,
      members,
    };

    saveTimerRef.current = window.setTimeout(async () => {
      setDataStatus('saving');
      try {
        const response = await fetch('/api/state', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ state }),
        });
        if (!response.ok) {
          const payload = await response.json() as { error?: string };
          if (response.status === 401 || response.status === 403) {
            setAccessStatus(response.status);
            setAccessError(payload.error || '저장 권한이 없습니다.');
          }
          throw new Error('Failed to save portal state');
        }
        setDataStatus('saved');
      } catch {
        setDataStatus('error');
      }
    }, 700);

    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, [persistenceReady, currentUser, consultationNumber, timeline, schedule, tasks, companyDocuments, cases, members]);

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
      if (item.view === 'case' || item.view === 'consultation') return currentMember.permissions.ownCases;
      if (item.view === 'documents') return currentMember.permissions.fileUpload;
      return false;
    });
  }, [currentMember, currentUser, isAdmin]);
  const allowedViews = useMemo(() => new Set(availableNavItems.map((item) => item.view)), [availableNavItems]);
  const activeLabel = useMemo(() => navItems.find((item) => item.view === view)?.label ?? '파트너 허브', [view]);

  if (accessError) {
    const needsSignIn = accessStatus === 401;
    const deniedAccount = accessStatus === 403;
    return (
      <div className="grid min-h-screen place-items-center bg-[radial-gradient(circle_at_top,#edf7fd_0,#f8fafc_45%,#f8fafc_100%)] p-5">
        <Card className={`w-full border-0 text-center shadow-xl ring-slate-200 ${deniedAccount ? 'max-w-2xl' : 'max-w-xl'}`}>
          <CardContent className="py-10 sm:px-10">
            <span className={`mx-auto grid size-14 place-items-center rounded-2xl ${needsSignIn ? 'bg-sky-50 text-[#0877b8]' : 'bg-red-50 text-red-700'}`}><LockKeyhole className="size-7" aria-hidden="true" /></span>
            <p className="mt-5 text-xs font-bold tracking-[0.18em] text-[#0877b8]">KEVE PARTNER HUB</p>
            <h1 className="mt-2 text-2xl font-bold text-slate-950">{needsSignIn ? '파트너 로그인' : '파트너 허브 접근 확인 필요'}</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">{accessError}</p>
            <p className="mt-3 text-xs leading-5 text-slate-500">한기평 컨설턴트·타사 컨설턴트·보험설계사·기타 파트너가 승인 후 이용할 수 있습니다.</p>
            {needsSignIn ? <a href="/signin-with-chatgpt?return_to=/" target="_top" className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0877b8] px-5 text-sm font-bold text-white transition-colors hover:bg-[#06679f] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-200"><ShieldCheck className="size-4" aria-hidden="true" /> ChatGPT로 로그인</a> : null}
            {deniedAccount && accessEmail ? <PartnerRegistrationForm email={accessEmail} /> : null}
            {deniedAccount ? <a href="/signout-with-chatgpt?return_to=/" target="_top" className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200">다른 ChatGPT 계정으로 다시 로그인</a> : null}
            {!needsSignIn && !deniedAccount ? <button type="button" onClick={() => window.location.reload()} className="mt-6 min-h-12 w-full rounded-xl bg-[#15375b] px-5 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200">다시 확인</button> : null}
            <div className="mt-6 rounded-xl border border-slate-100 bg-slate-50 p-4 text-left"><p className="text-xs font-bold text-slate-700">개인정보 보호</p><p className="mt-1 text-xs leading-5 text-slate-500">로그인 전에는 기업·상담·서류 정보가 제공되지 않으며, 로그인 후에도 본인에게 배정된 진행만 열람할 수 있습니다.</p></div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!currentUser) {
    return <div className="grid min-h-screen place-items-center bg-slate-50 p-5"><div className="text-center"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-sky-50 text-[#0877b8]"><RefreshCw className="size-7 animate-spin" aria-hidden="true" /></span><p className="mt-4 text-sm font-semibold text-slate-700">로그인 정보와 담당 권한을 확인하고 있습니다.</p></div></div>;
  }

  const accountTasks = isAdmin ? tasks : tasks.filter((task) => task.assignee === traineeName);
  const notificationCount = accountTasks.filter((task) => task.status !== '완료' && (task.dueState === 'today' || task.dueState === 'overdue')).length;
  const dataStatusLabel = {
    loading: '데이터 불러오는 중',
    saving: '자동저장 중',
    saved: 'DB 저장됨',
    error: '저장 연결 오류',
  }[dataStatus];
  const dataStatusTone = dataStatus === 'saved' ? 'green' : dataStatus === 'error' ? 'red' : 'blue';

  function navigate(next: View) {
    if (!allowedViews.has(next)) {
      notify('현재 로그인 계정에는 이 메뉴 권한이 없습니다.');
      return;
    }
    setView(next);
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openSchedule(audience: 'admin' | 'trainee') {
    setScheduleAudience(isAdmin ? audience : 'trainee');
    navigate('schedule');
  }

  function openCase(item: CollaborationCase) {
    setSelectedCaseId(item.id);
    navigate('case');
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
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
    setTasks((current) => current.map((task) => task.company === selectedCase.company && task.kind === '서류요청' && task.due === '기한 확인' ? { ...task, due: dueLabel } : task));
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
        <div className="m-4 min-h-24 rounded-xl border border-white/10 bg-white/5 p-4"><p className="text-xs text-blue-200">{isAdmin ? '대표 관리자' : currentMember ? partnerTypeOf(currentMember) : '파트너'}</p><p className="mt-1 text-sm font-semibold">{accountDisplayName}</p><p className="mt-2 flex items-center gap-1 text-xs text-blue-100/80"><ShieldCheck className="size-3.5" aria-hidden="true" /> ChatGPT 로그인 확인</p></div>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" onClick={() => setMobileOpen(false)} aria-label="메뉴 닫기" className="absolute inset-0 h-full w-full cursor-default bg-slate-950/40" />
          <aside className="relative h-full w-[min(86vw,320px)] bg-[#112f50] p-4 text-white">
            <div className="mb-5 flex items-center justify-between"><div className="flex items-center gap-3"><BrandMark /><span className="font-bold">파트너 허브</span></div><button type="button" onClick={() => setMobileOpen(false)} className="grid size-11 place-items-center rounded-xl hover:bg-white/10" aria-label="메뉴 닫기"><X /></button></div>
            <nav aria-label="모바일 메뉴" className="space-y-2">{availableNavItems.map(navButton)}</nav>
            <div className="mt-5 flex min-h-12 w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold"><span>{accountDisplayName}</span><ShieldCheck className="size-4" aria-hidden="true" /></div>
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
          {view === 'admin' ? <AdminDashboard onOpenCase={() => navigate('case')} onOpenSchedule={() => openSchedule('admin')} schedule={schedule} /> : null}
          {view === 'pipeline' ? <PipelineBoard cases={cases} setCases={setCases} members={members} isAdmin={isAdmin} currentName={traineeName} notify={notify} onOpenCase={openCase} /> : null}
          {view === 'schedule' ? <SchedulePage schedule={schedule} onNewConsultation={() => navigate('consultation')} notify={notify} audience={isAdmin ? scheduleAudience : 'trainee'} onAudienceChange={setScheduleAudience} canPreviewAdmin={isAdmin} traineeName={traineeName} /> : null}
          {view === 'tasks' ? <WorkManagement tasks={tasks} setTasks={setTasks} members={members} isAdmin={isAdmin} currentName={traineeName} notify={notify} /> : null}
          {view === 'files' ? <DocumentCenter documents={companyDocuments} setDocuments={setCompanyDocuments} members={members} isAdmin={isAdmin} currentName={traineeName} notify={notify} /> : null}
          {view === 'trainee' ? <TraineeDashboard onOpenCase={() => navigate('case')} onNew={() => navigate('application')} onOpenSchedule={() => openSchedule('trainee')} schedule={schedule} member={previewMember} /> : null}
          {view === 'access' ? <AccessManagement notify={notify} members={members} setMembers={setMembers} /> : null}
          {view === 'application' ? <ApplicationForm applicant={collaborationApplicant} onCancel={() => navigate('trainee')} onDone={(files, companyName, selectedServices, applicantType, applicantName) => { const company = companyName.trim() || '신규기업(가상)'; const caseId = `case-${Date.now()}`; const service = selectedServices.join(' · ') || '기업컨설팅'; setCases((current) => current.some((item) => item.company === company) ? current : [{ id: caseId, company, service, trainee: applicantName, applicantType, stage: '접수', consultationCount: 0, nextAction: stageNextActions.접수, updatedAt: '방금 전', idleDays: 0, urgent: false }, ...current]); setTimeline((current) => current.some((item) => item.caseId === caseId) ? current : [...current, { caseId, date: '방금 전', title: '협업신청 접수', detail: `${service} 요청 / 주관 파트너 ${applicantName}`, type: '접수', tone: 'navy' }]); if (files.length) { setCompanyDocuments((current) => [...files.map((fileName, index): CompanyDocument => { const category = documentCategoryFromFileName(fileName); return { id: `file-application-${Date.now()}-${index}`, company, title: category === '기타자료' ? fileName : category, category, fileName, status: '제출완료', assignedTrainee: applicantName, submittedBy: isAdmin ? `김성민 대표 대리접수 · ${applicantType}` : `${applicantName} · ${applicantType}`, updatedAt: '방금 전', version: 'V1', sensitive: ['사업자등록증', '크레탑', '재무제표', '계약자료'].includes(category) }; }), ...current]); } notify(files.length ? `${applicantType} 협업신청과 가상 제출파일 ${files.length}건을 등록했습니다.` : `${applicantType} 협업신청을 진행현황에 접수했습니다.`); navigate(allowedViews.has('pipeline') ? 'pipeline' : 'trainee'); }} /> : null}
          {view === 'case' ? <CaseDetail key={selectedCase.id} caseItem={selectedCase} timeline={selectedCaseTimeline} documents={companyDocuments} onConsult={() => navigate('consultation')} onDocuments={() => navigate('documents')} onSetDocumentDueDates={updateDocumentDueDates} onDocumentModal={(type) => { if (isAdmin || currentMember?.permissions.quoteContract) setModal(type); else notify('현재 로그인 계정에는 견적·계약 권한이 없습니다.'); }} canFileUpload={isAdmin || Boolean(currentMember?.permissions.fileUpload)} canQuoteContract={isAdmin || Boolean(currentMember?.permissions.quoteContract)} /> : null}
          {view === 'consultation' ? <ConsultationForm key={selectedCase.id} number={consultationNumber} caseItem={selectedCase} onCancel={() => navigate('case')} onSave={saveConsultation} /> : null}
          {view === 'documents' ? <DocumentRequest key={selectedCase.id} caseItem={selectedCase} onCancel={() => navigate('case')} onSave={({ items, dueDate }) => { const requestNumber = selectedCaseTimeline.filter((item) => item.type === '서류').length + 1; const dueLabel = formatKoreanDate(dueDate); setTimeline((current) => [...current, { caseId: selectedCase.id, date: '방금 전', title: `서류요청 #${requestNumber} 등록`, detail: `요청서류 ${items.length}건 / 제출기한 ${dueLabel} / 전달 담당자: ${selectedCase.trainee} 파트너`, type: '서류', tone: 'amber' }]); setCompanyDocuments((current) => [...items.map((item, index): CompanyDocument => ({ id: `file-request-${Date.now()}-${index}`, company: selectedCase.company, title: item.name, category: '요청서류', status: '요청중', assignedTrainee: selectedCase.trainee, submittedBy: '기업대표 요청', updatedAt: '방금 전', dueDate, version: '-', sensitive: true })), ...current]); setTasks((current) => [{ id: `task-request-${Date.now()}`, company: selectedCase.company, title: `요청서류 ${items.length}건 제출 확인`, kind: '서류요청', assignee: selectedCase.trainee, due: dueLabel, dueState: 'upcoming', status: '대기', priority: '보통', related: `서류요청 #${requestNumber}` }, ...current]); setCases((current) => current.map((item) => item.id === selectedCase.id ? { ...item, nextAction: `요청서류 ${items.length}건 제출 확인`, updatedAt: '방금 전', idleDays: 0 } : item)); notify(`${selectedCase.company} 서류요청 ${items.length}건을 자료함과 업무목록에 등록했습니다.`); navigate('case'); }} /> : null}
        </main>
      </div>

      {modal ? <DocumentModal type={modal} onClose={() => setModal(null)} onSave={() => { const kind = modal === 'quote' ? '견적서 V1' : '계약서 V1'; setTimeline((current) => [...current, { caseId: selectedCase.id, date: '방금 전', title: `${kind} 초안 저장`, detail: `${selectedCase.company} / 관련 상담: 연결하지 않음 / 내부검토 전`, type: modal === 'quote' ? '견적' : '계약', tone: 'violet' }]); setModal(null); notify(`${selectedCase.company} ${kind} 초안이 저장되었습니다.`); }} /> : null}

      {toast ? <output aria-live="polite" aria-atomic="true" className="fixed bottom-5 left-1/2 z-[70] flex w-[min(92vw,520px)] -translate-x-1/2 items-center gap-3 rounded-2xl bg-[#112f50] px-5 py-4 text-sm font-semibold text-white shadow-2xl"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-emerald-400 text-[#112f50]"><Check className="size-4" /></span>{toast}</output> : null}
    </div>
  );
}
