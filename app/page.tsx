'use client';

import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Bell,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
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
  MailPlus,
  Menu,
  MessageSquarePlus,
  Plus,
  RefreshCw,
  Search,
  Send,
  Share2,
  ShieldCheck,
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

type View =
  | 'admin'
  | 'schedule'
  | 'trainee'
  | 'access'
  | 'application'
  | 'case'
  | 'consultation'
  | 'documents';

type IconType = typeof LayoutDashboard;

const navItems: Array<{ view: View; label: string; icon: IconType }> = [
  { view: 'admin', label: '대표 대시보드', icon: LayoutDashboard },
  { view: 'schedule', label: '대표 상담일정', icon: CalendarDays },
  { view: 'trainee', label: '교육생 화면', icon: Users },
  { view: 'access', label: '교육생 권한관리', icon: UserCog },
  { view: 'application', label: '새 협업신청', icon: FilePlus2 },
  { view: 'case', label: '기업·사건 상세', icon: BriefcaseBusiness },
  { view: 'consultation', label: '상담 등록', icon: MessageSquarePlus },
  { view: 'documents', label: '서류 요청', icon: FolderOpen },
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

type TraineeMember = {
  id: string;
  name: string;
  email: string;
  cohort: string;
  role: '교육생' | '리더 교육생';
  status: '활성' | '초대대기' | '정지';
  companies: number;
  permissions: {
    sharedSchedule: boolean;
    collaborationApply: boolean;
    ownCases: boolean;
    fileUpload: boolean;
    quoteContract: boolean;
  };
};

const sampleTrainees: TraineeMember[] = [
  {
    id: 'trainee-1',
    name: '박지현(가상)',
    email: 'jihyun.park@example.com',
    cohort: '12기',
    role: '교육생',
    status: '활성',
    companies: 6,
    permissions: { sharedSchedule: true, collaborationApply: true, ownCases: true, fileUpload: true, quoteContract: false },
  },
  {
    id: 'trainee-2',
    name: '이준호(가상)',
    email: 'junho.lee@example.com',
    cohort: '12기',
    role: '리더 교육생',
    status: '활성',
    companies: 9,
    permissions: { sharedSchedule: true, collaborationApply: true, ownCases: true, fileUpload: true, quoteContract: true },
  },
  {
    id: 'trainee-3',
    name: '최서윤(가상)',
    email: 'seoyun.choi@example.com',
    cohort: '13기',
    role: '교육생',
    status: '초대대기',
    companies: 0,
    permissions: { sharedSchedule: true, collaborationApply: true, ownCases: true, fileUpload: true, quoteContract: false },
  },
  {
    id: 'trainee-4',
    name: '정민수(가상)',
    email: 'minsu.jung@example.com',
    cohort: '11기',
    role: '교육생',
    status: '정지',
    companies: 2,
    permissions: { sharedSchedule: false, collaborationApply: false, ownCases: true, fileUpload: false, quoteContract: false },
  },
];

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

const baseTimeline = [
  {
    date: '08.29 09:20',
    title: '협업신청 접수',
    detail: '정책자금 · 특허 요청 / 주관 교육생 박지현',
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
    service: item.source === 'google' ? '상세 내용 비공개' : '담당 교육생만 상세 확인',
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
              대표 확인이 필요한 사건
            </CardTitle>
            <CardDescription>다음 행동이 멈춰 있거나 승인 대기 중인 사건입니다.</CardDescription>
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
            <CardDescription>7일 이상 다음 행동이 없는 사건입니다.</CardDescription>
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
        eyebrow={audience === 'admin' ? '대표 일정관리' : '교육생 공유일정'}
        title="김성민 대표 상담일정"
        description={audience === 'admin' ? '기업상담 일정과 Google Calendar의 바쁜 시간을 한 화면에서 확인하고 중복 예약을 예방합니다.' : '교육생은 대표님의 상담 가능시간을 확인하고, 본인이 담당하는 기업의 상담만 상세하게 볼 수 있습니다.'}
        action={
          audience === 'admin' ? (
            <PrimaryButton onClick={onNewConsultation}>
              <Plus className="size-4" aria-hidden="true" /> 새 상담 예약
            </PrimaryButton>
          ) : <Pill tone="green">교육생 공유 ON</Pill>
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
                    ['trainee', '교육생 공유'],
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
                <CardTitle className="flex items-center gap-2 text-lg font-bold"><UserRoundCheck className="size-5 text-[#0877b8]" aria-hidden="true" /> 교육생 공개범위</CardTitle>
                <CardDescription>{traineeName} 교육생 화면 기준입니다.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-1">
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4"><p className="text-sm font-bold text-emerald-900">김성민 대표 일정 공유 중</p><p className="mt-1 text-xs leading-5 text-emerald-800">예약 가능·불가 시간은 전체 교육생에게 표시됩니다.</p></div>
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
                ['개인 일정은 시간만 공유', '교육생에게 제목·상세내용을 공개하지 않음'],
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
        eyebrow="교육생 협업공간"
        title={`${displayName} 교육생님, 진행상황을 확인하세요`}
        description="본인이 주관하거나 공동 협업자로 참여한 기업만 표시됩니다."
        action={
          member.permissions.collaborationApply ? <PrimaryButton onClick={onNew}>
            <Plus className="size-4" aria-hidden="true" /> 새 협업신청
          </PrimaryButton> : <Pill tone="slate">신청 권한 없음</Pill>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['진행기업', String(member.companies), BriefcaseBusiness, '전체 협업 사건'],
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
            <div className="flex flex-wrap items-center gap-2"><Pill tone="green">교육생 공유 ON</Pill><SecondaryButton onClick={onOpenSchedule}>전체 일정 보기 <ChevronRight className="size-4" aria-hidden="true" /></SecondaryButton></div>
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
            <CardDescription>최근 변경된 사건을 우선 표시합니다.</CardDescription>
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

const permissionLabels: Array<{ key: keyof TraineeMember['permissions']; label: string; detail: string }> = [
  { key: 'sharedSchedule', label: '대표 공유일정', detail: '대표의 예약 가능·불가 시간과 담당기업 상담 확인' },
  { key: 'collaborationApply', label: '협업신청 등록', detail: '새 기업 협업신청 작성 및 임시저장' },
  { key: 'ownCases', label: '담당 사건 열람', detail: '본인이 주관·공동담당인 기업만 확인' },
  { key: 'fileUpload', label: '서류 업로드', detail: '담당기업의 요청서류 등록 및 제출상태 확인' },
  { key: 'quoteContract', label: '견적·계약 확인', detail: '담당기업의 승인된 견적·계약 상태 확인' },
];

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
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteCohort, setInviteCohort] = useState('13기');

  const filteredMembers = members.filter((member) => {
    const keywordMatch = `${member.name} ${member.email} ${member.cohort}`.toLowerCase().includes(query.toLowerCase());
    const statusMatch = statusFilter === '전체' || member.status === statusFilter;
    return keywordMatch && statusMatch;
  });
  const selectedMember = members.find((member) => member.id === selectedId) ?? null;

  function togglePermission(key: keyof TraineeMember['permissions']) {
    if (!selectedId) return;
    setMembers((current) => current.map((member) => member.id === selectedId ? { ...member, permissions: { ...member.permissions, [key]: !member.permissions[key] } } : member));
  }

  function prepareInvite() {
    if (!inviteName.trim() || !inviteEmail.trim()) {
      notify('이름과 이메일을 입력해 주세요.');
      return;
    }
    setMembers((current) => [
      ...current,
      {
        id: `trainee-${Date.now()}`,
        name: `${inviteName.trim()}(가상)`,
        email: inviteEmail.trim(),
        cohort: inviteCohort,
        role: '교육생',
        status: '초대대기',
        companies: 0,
        permissions: { sharedSchedule: true, collaborationApply: true, ownCases: true, fileUpload: true, quoteContract: false },
      },
    ]);
    setInviteName('');
    setInviteEmail('');
    setInviteOpen(false);
    notify('교육생 초대대기로 등록했습니다. 시안에서는 실제 이메일이 발송되지 않습니다.');
  }

  return (
    <>
      <PageIntro
        eyebrow="관리자 전용"
        title="교육생 계정·권한관리"
        description="교육생별 접속상태, 담당기업, 대표 일정 공유범위와 업무권한을 관리합니다."
        action={<PrimaryButton onClick={() => setInviteOpen(true)}><UserPlus className="size-4" aria-hidden="true" /> 교육생 초대</PrimaryButton>}
      />

      <section aria-label="교육생 계정 요약" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['등록 교육생', members.length, Users, '시안 등록계정'],
          ['활성 계정', members.filter((member) => member.status === '활성').length, UserRoundCheck, '현재 접속 가능'],
          ['초대 대기', members.filter((member) => member.status === '초대대기').length, MailPlus, '이메일 승인 전'],
          ['일정 공유', members.filter((member) => member.permissions.sharedSchedule).length, CalendarDays, '대표 공유일정 열람'],
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

      <Card className="mt-6 border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
        <CardHeader className="border-b border-slate-100">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div><CardTitle className="text-lg font-bold">교육생 목록</CardTitle><CardDescription className="mt-1">모든 이름과 이메일은 화면 검토용 가상 정보입니다.</CardDescription></div>
            <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_150px]">
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-slate-500"><Search className="size-4" aria-hidden="true" /><span className="sr-only">교육생 검색</span><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none" placeholder="이름·이메일·기수" /></label>
              <label><span className="sr-only">계정상태 필터</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as '전체' | TraineeMember['status'])} className={inputClass}><option>전체</option><option>활성</option><option>초대대기</option><option>정지</option></select></label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-1">
          {filteredMembers.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredMembers.map((member) => {
                const statusTone = member.status === '활성' ? 'green' : member.status === '초대대기' ? 'amber' : 'red';
                const granted = Object.values(member.permissions).filter(Boolean).length;
                return (
                  <article key={member.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#eaf1f7] text-sm font-bold text-[#15375b]">{member.name.slice(0, 1)}</span><div className="min-w-0"><h2 className="truncate text-sm font-bold text-slate-900">{member.name}</h2><p className="mt-1 truncate text-xs text-slate-500">{member.email}</p></div></div>
                      <Pill tone={statusTone}>{member.status}</Pill>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center"><div><p className="text-xs text-slate-500">기수</p><p className="mt-1 text-sm font-bold text-slate-800">{member.cohort}</p></div><div><p className="text-xs text-slate-500">담당기업</p><p className="mt-1 text-sm font-bold tabular-nums text-slate-800">{member.companies}개</p></div><div><p className="text-xs text-slate-500">권한</p><p className="mt-1 text-sm font-bold tabular-nums text-slate-800">{granted}/5</p></div></div>
                    <div className="mt-4 flex flex-wrap gap-2"><Pill tone="navy">{member.role}</Pill>{member.permissions.sharedSchedule ? <Pill tone="blue">대표 일정 공유</Pill> : <Pill tone="slate">일정 미공개</Pill>}</div>
                    <SecondaryButton className="mt-4 w-full" onClick={() => setSelectedId(member.id)}><UserCog className="size-4 text-[#0877b8]" aria-hidden="true" /> 권한 설정</SecondaryButton>
                  </article>
                );
              })}
            </div>
          ) : <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center"><p className="text-sm font-semibold text-slate-700">조건에 맞는 교육생이 없습니다.</p><button type="button" onClick={() => { setQuery(''); setStatusFilter('전체'); }} className="mt-3 min-h-11 rounded-xl px-4 text-sm font-semibold text-[#0877b8] hover:bg-sky-50">필터 초기화</button></div>}
        </CardContent>
      </Card>

      <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50/70 p-5">
        <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#0877b8]" aria-hidden="true" /><div><p className="text-sm font-bold text-[#15375b]">실제 운영 시 적용할 보안원칙</p><p className="mt-1 text-xs leading-5 text-slate-600">로그인한 교육생의 이메일을 서버에서 허용명단과 대조하고, 본인에게 배정된 기업 데이터만 조회하도록 권한을 서버에서 검사합니다.</p></div></div>
      </div>

      {selectedMember ? (
        <dialog open className="fixed inset-0 z-50 m-0 grid h-screen max-h-none w-screen max-w-none place-items-center border-0 bg-slate-950/40 p-4 backdrop-blur-sm" aria-labelledby="permission-modal-title">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b p-5"><div><p className="text-xs font-semibold text-[#0877b8]">{selectedMember.cohort} · {selectedMember.role}</p><h2 id="permission-modal-title" className="mt-1 text-xl font-bold">{selectedMember.name} 권한 설정</h2><p className="mt-1 text-sm text-slate-500">허용된 기능만 교육생 메뉴에 표시됩니다.</p></div><button type="button" onClick={() => setSelectedId(null)} className="grid size-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label="권한 설정 닫기"><X className="size-5" /></button></div>
            <div className="max-h-[65vh] space-y-3 overflow-y-auto p-5">
              {permissionLabels.map(({ key, label, detail }) => {
                const enabled = selectedMember.permissions[key];
                return (
                  <div key={key} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 p-4"><div><p className="text-sm font-bold text-slate-800">{label}</p><p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p></div><button type="button" role="switch" aria-checked={enabled} aria-label={`${label} 권한`} onClick={() => togglePermission(key)} className={`relative h-11 w-[68px] shrink-0 rounded-full p-1 transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-200 ${enabled ? 'bg-[#0877b8]' : 'bg-slate-300'}`}><span className={`block size-9 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0'}`} /></button></div>
                );
              })}
            </div>
            <div className="flex flex-col-reverse gap-3 border-t bg-slate-50 p-4 sm:flex-row sm:justify-end sm:px-5"><SecondaryButton onClick={() => setSelectedId(null)}>취소</SecondaryButton><PrimaryButton onClick={() => { setSelectedId(null); notify(`${selectedMember.name} 권한 변경사항을 저장했습니다.`); }}><Check className="size-4" aria-hidden="true" /> 권한 저장</PrimaryButton></div>
          </div>
        </dialog>
      ) : null}

      {inviteOpen ? (
        <dialog open className="fixed inset-0 z-50 m-0 grid h-screen max-h-none w-screen max-w-none place-items-center border-0 bg-slate-950/40 p-4 backdrop-blur-sm" aria-labelledby="invite-modal-title">
          <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b p-5"><div><p className="text-xs font-semibold text-[#0877b8]">신규 계정</p><h2 id="invite-modal-title" className="mt-1 text-xl font-bold">교육생 초대 준비</h2><p className="mt-1 text-sm text-slate-500">실제 명단 연결 전 화면 검토용 단계입니다.</p></div><button type="button" onClick={() => setInviteOpen(false)} className="grid size-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100" aria-label="초대창 닫기"><X className="size-5" /></button></div>
            <div className="space-y-5 p-5"><Field label="교육생 이름" required><input value={inviteName} onChange={(event) => setInviteName(event.target.value)} className={inputClass} placeholder="예: 홍길동" /></Field><Field label="로그인 이메일" required hint="실제 운영 시 이 이메일로 본인 여부를 확인합니다."><input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} className={inputClass} placeholder="name@example.com" /></Field><Field label="교육기수" required><select value={inviteCohort} onChange={(event) => setInviteCohort(event.target.value)} className={inputClass}><option>11기</option><option>12기</option><option>13기</option><option>기타</option></select></Field><div className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-xs leading-5 text-amber-900">시안에서는 초대대기 목록에만 추가되며 실제 이메일은 발송되지 않습니다.</div></div>
            <div className="flex flex-col-reverse gap-3 border-t bg-slate-50 p-4 sm:flex-row sm:justify-end sm:px-5"><SecondaryButton onClick={() => setInviteOpen(false)}>취소</SecondaryButton><PrimaryButton onClick={prepareInvite}><MailPlus className="size-4" aria-hidden="true" /> 초대대기 등록</PrimaryButton></div>
          </div>
        </dialog>
      ) : null}
    </>
  );
}

function ApplicationForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [step, setStep] = useState(1);
  const [selectedServices, setSelectedServices] = useState<string[]>(['정책자금']);
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
              <Field label="신청 교육생"><input className={inputClass} value="박지현 교육생" readOnly /></Field>
              <Field label="소속·교육기수"><input className={inputClass} value="기업컨설턴트 과정 12기" readOnly /></Field>
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
              <Field label="기업명" required><input className={inputClass} defaultValue="세림테크(가상)" /></Field>
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
                  <input type="file" multiple className="sr-only" />
                </label>
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
            <PrimaryButton className="flex-1 sm:flex-none" onClick={step === 4 ? onDone : () => setStep((value) => Math.min(4, value + 1))}>
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
  timeline,
  onConsult,
  onDocuments,
  onDocumentModal,
  canFileUpload,
  canQuoteContract,
  assignedTrainee,
}: {
  timeline: typeof baseTimeline;
  onConsult: () => void;
  onDocuments: () => void;
  onDocumentModal: (type: 'quote' | 'contract') => void;
  canFileUpload: boolean;
  canQuoteContract: boolean;
  assignedTrainee: string;
}) {
  const [tab, setTab] = useState('timeline');
  const tabs = [
    ['timeline', '전체 타임라인'],
    ['services', '서비스 과업'],
    ['consultations', '상담'],
    ...(canFileUpload ? [['documents', '서류요청']] : []),
    ...(canQuoteContract ? [['quotes', '견적서'], ['contracts', '계약서']] : []),
  ];

  return (
    <>
      <PageIntro
        eyebrow="기업·사건 상세"
        title="세림테크(가상)"
        description={`신청번호 KEVE-2026-0829-001 · 주관 교육생 ${assignedTrainee} · 내부 담당자 김도윤`}
        action={<Pill tone="blue">상담·협의 진행</Pill>}
      />

      <section aria-label="사건 요약" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['상담', `${Math.max(3, timeline.filter((item) => item.type === '상담').length)}회`, '반복등록'],
          ['미제출 서류', '2건', '09.05 마감'],
          ...(canQuoteContract ? [['견적서', 'V1 검토 중', '대표 승인 대기'], ['계약서', '미작성', '필요 시 생성']] : []),
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
            <div role="tablist" aria-label="사건 상세 탭" className="flex min-w-max gap-1">
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
                {[
                  ['정책자금', '상담·협의 진행', '견적서 승인 후 2차 상담 일정 확정'],
                  ['특허·지식재산', '기업진단·사전검토', '아이디어 설명자료 제출 대기'],
                ].map(([service, status, next]) => (
                  <div key={service} className="rounded-2xl border border-slate-200 p-5">
                    <div className="flex items-center justify-between gap-3"><p className="font-bold">{service}</p><Pill tone="blue">{status}</Pill></div>
                    <p className="mt-4 text-xs font-semibold text-slate-500">다음 행동</p>
                    <p className="mt-1 text-sm leading-6 text-slate-700">{next}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {tab === 'consultations' ? (
              <div className="py-4">
                <div className="flex items-center justify-between gap-4"><div><p className="font-bold">등록된 상담 3회</p><p className="mt-1 text-sm text-slate-500">필요 횟수만큼 계속 추가할 수 있습니다.</p></div><PrimaryButton onClick={onConsult}><Plus className="size-4" /> 상담 추가</PrimaryButton></div>
                <div className="mt-5 space-y-3">{['상담 #1 · 정책자금 방향 확인', '상담 #2 · 보완자료와 조건 검토', '상담 #3 · 견적 범위 협의'].map((item) => <div key={item} className="rounded-xl border p-4 text-sm font-semibold">{item}</div>)}</div>
              </div>
            ) : null}

            {tab === 'documents' ? (
              <div className="py-4"><div className="flex items-center justify-between gap-4"><div><p className="font-bold">서류요청 #1</p><p className="mt-1 text-sm text-slate-500">3건 중 1건 제출완료</p></div><PrimaryButton onClick={onDocuments}><Plus className="size-4" /> 새 요청</PrimaryButton></div></div>
            ) : null}

            {tab === 'quotes' ? (
              <div className="py-4"><div className="rounded-2xl border p-5"><div className="flex items-center justify-between gap-3"><p className="font-bold">견적서 V1</p><Pill tone="violet">내부검토</Pill></div><p className="mt-2 text-sm text-slate-600">정책자금 사전진단 및 신청지원</p></div></div>
            ) : null}

            {tab === 'contracts' ? (
              <div className="py-10 text-center"><FileText className="mx-auto size-9 text-slate-300" /><p className="mt-3 font-bold">등록된 계약서가 없습니다.</p><p className="mt-1 text-sm text-slate-500">필요한 상담 뒤에 계약서 초안을 생성하세요.</p><PrimaryButton className="mt-4" onClick={() => onDocumentModal('contract')}><Plus className="size-4" /> 계약서 작성</PrimaryButton></div>
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
              {!canQuoteContract ? <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600 sm:col-span-2 xl:col-span-1"><LockKeyhole className="mr-1 inline size-4 align-text-bottom" aria-hidden="true" />견적·계약 기능은 리더 교육생 또는 대표 권한이 필요합니다.</div> : null}
            </CardContent>
          </Card>

          <Card className="border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
            <CardHeader><CardTitle className="text-lg font-bold">다음 행동</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm font-semibold text-slate-800">{canQuoteContract ? '견적서 V1 대표 승인' : '추가서류 제출 확인'}</p>
              <div className="mt-3 flex items-center justify-between gap-3"><Pill tone="amber">오늘 마감</Pill><span className="text-xs text-slate-500">{canQuoteContract ? '담당 김도윤' : `담당 ${assignedTrainee}`}</span></div>
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
}

function ConsultationForm({
  number,
  onSave,
  onCancel,
}: {
  number: number;
  onSave: (payload: ConsultationPayload) => void;
  onCancel: () => void;
}) {
  const options = ['다음 상담 등록', '서류요청', '견적서 작성', '계약서 작성', '내부업무 등록'];
  const [followUps, setFollowUps] = useState<string[]>(['서류요청']);
  const [calendarSync, setCalendarSync] = useState(true);
  const [title, setTitle] = useState('정책자금 신청방향 및 보완사항 협의');
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
        action={<Pill tone="blue">세림테크(가상)</Pill>}
      />

      <Card className="mx-auto max-w-5xl border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
        <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-bold">상담 기본정보</CardTitle><CardDescription>상담번호는 시스템이 자동으로 부여합니다.</CardDescription></CardHeader>
        <CardContent className="space-y-7 py-2">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="상담 제목·목적" required><input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 정책자금 신청방향 및 보완사항 협의" /></Field>
            <Field label="관련 서비스" required><select className={inputClass}><option>정책자금</option><option>특허·지식재산</option><option>정책자금 + 특허</option></select></Field>
            <Field label="상담 일시" required><input className={inputClass} type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></Field>
            <Field label="상담방식"><select className={inputClass} value={method} onChange={(event) => setMethod(event.target.value)}><option>전화</option><option>방문</option><option>화상</option><option>기타</option></select></Field>
            <Field label="참석자"><input className={inputClass} placeholder="기업대표, 교육생, 내부 담당자" /></Field>
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
              {calendarSync ? '저장 후 대표 일정에 상담 제목·시간·상담방식이 등록되고, 교육생 화면에는 가능/불가 시간만 표시됩니다.' : '캘린더 연동 없이 상담기록만 저장합니다.'}
            </p>
          </section>

          <section aria-labelledby="trainee-share-title" className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-emerald-700 shadow-sm"><Share2 className="size-5" aria-hidden="true" /></span>
              <div className="min-w-0 flex-1">
                <h2 id="trainee-share-title" className="text-sm font-bold text-emerald-950">교육생 일정 공개범위</h2>
                <p className="mt-1 text-xs leading-5 text-emerald-900/80">전체 교육생에게는 예약시간을, 담당 교육생에게는 기업명과 상담목적까지 공유할 수 있습니다.</p>
                <select value={shareMode} onChange={(event) => setShareMode(event.target.value as 'all_with_assignee' | 'all_busy' | 'private')} className={`${inputClass} mt-4 border-emerald-200`} aria-label="교육생 일정 공개범위">
                  <option value="all_with_assignee">전체 교육생 시간 공유 · 담당 교육생 상세공개</option>
                  <option value="all_busy">전체 교육생에게 예약시간만 공개</option>
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
            <Field label="공유 메모" hint="교육생에게 보이는 내용입니다."><textarea className={`${inputClass} min-h-28 py-3`} placeholder="교육생과 공유할 준비사항" /></Field>
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

function DocumentRequest({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  const [items, setItems] = useState([
    { name: '최근 3개년 재무제표', required: true },
    { name: '부가가치세 과세표준증명', required: true },
    { name: '기존 대출·보증 현황', required: false },
  ]);
  const [newItem, setNewItem] = useState('');

  function addItem() {
    if (!newItem.trim()) return;
    setItems((current) => [...current, { name: newItem.trim(), required: true }]);
    setNewItem('');
  }

  return (
    <>
      <PageIntro
        eyebrow="독립 업무 등록"
        title="새 서류요청"
        description="접수·상담·계약·사후관리 어느 단계에서든 요청할 수 있으며 관련 상담 연결은 선택사항입니다."
        action={<Pill tone="amber">고객 서류 대기</Pill>}
      />

      <Card className="mx-auto max-w-5xl border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
        <CardHeader className="border-b border-slate-100"><CardTitle className="text-lg font-bold">서류요청 #2</CardTitle><CardDescription>요청대상과 전달 담당자를 분리해 기록합니다.</CardDescription></CardHeader>
        <CardContent className="space-y-7 py-2">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="요청대상" required><select className={inputClass}><option>기업대표</option><option>교육생</option><option>내부 담당자</option><option>외부 전문가</option></select></Field>
            <Field label="전달 담당자" required><select className={inputClass}><option>박지현 교육생</option><option>김도윤 내부담당자</option></select></Field>
            <Field label="관련 서비스"><select className={inputClass}><option>정책자금</option><option>특허·지식재산</option><option>전체</option></select></Field>
            <Field label="관련 상담" hint="상담과 무관한 요청이면 선택하지 않아도 됩니다."><select className={inputClass}><option>연결하지 않음</option><option>상담 #1</option><option>상담 #2</option><option>상담 #3</option></select></Field>
            <Field label="제출기한" required><input type="date" className={inputClass} /></Field>
            <Field label="공유범위"><select className={inputClass}><option>교육생과 내부 담당자</option><option>내부 담당자만</option></select></Field>
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

          <Field label="요청사유·안내문"><textarea className={`${inputClass} min-h-28 py-3`} placeholder="기업대표와 교육생에게 전달할 요청사유와 제출방법" /></Field>

          <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-5 text-sm leading-6 text-slate-700">
            <p className="font-bold text-[#15375b]">MVP 전달 방식</p>
            <p className="mt-1">기업대표에게 별도 계정은 제공하지 않습니다. 전달 담당자가 요청내용을 안내하고 받은 파일을 사이트에 등록합니다.</p>
          </div>
        </CardContent>
        <div className="flex flex-col-reverse gap-3 border-t bg-slate-50 p-4 sm:flex-row sm:justify-end sm:px-6">
          <SecondaryButton onClick={onCancel}>취소</SecondaryButton>
          <PrimaryButton onClick={onSave}><Send className="size-4" /> 서류요청 등록</PrimaryButton>
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

function VirtualAccountSwitcher({
  members,
  currentAccountId,
  onSelect,
  onClose,
}: {
  members: TraineeMember[];
  currentAccountId: string;
  onSelect: (accountId: string) => void;
  onClose: () => void;
}) {
  const activeMembers = members.filter((member) => member.status === '활성');

  return (
    <dialog open className="fixed inset-0 z-50 m-0 grid h-screen max-h-none w-screen max-w-none place-items-center border-0 bg-slate-950/45 p-4 backdrop-blur-sm" aria-labelledby="account-switcher-title">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b p-5">
          <div>
            <p className="text-xs font-semibold text-[#0877b8]">가상 로그인</p>
            <h2 id="account-switcher-title" className="mt-1 text-xl font-bold text-slate-950">확인할 계정을 선택하세요</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">실제 로그인 없이 역할별 메뉴와 권한 차이를 체험합니다.</p>
          </div>
          <button type="button" onClick={onClose} className="grid size-11 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-100" aria-label="계정 전환 닫기"><X className="size-5" aria-hidden="true" /></button>
        </div>

        <div className="max-h-[68vh] space-y-3 overflow-y-auto p-5">
          <button type="button" aria-pressed={currentAccountId === 'admin'} onClick={() => onSelect('admin')} className={`flex min-h-[88px] w-full items-center justify-between gap-4 rounded-2xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-100 ${currentAccountId === 'admin' ? 'border-[#0877b8] bg-sky-50' : 'border-slate-200 hover:bg-slate-50'}`}>
            <span className="flex min-w-0 items-center gap-3"><span className="grid size-12 shrink-0 place-items-center rounded-full bg-[#15375b] text-white"><ShieldCheck className="size-5" aria-hidden="true" /></span><span className="min-w-0"><span className="block font-bold text-slate-950">김성민 대표</span><span className="mt-1 block text-xs leading-5 text-slate-500">대표 관리자 · 전체 메뉴 및 모든 업무 권한</span></span></span>
            {currentAccountId === 'admin' ? <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#0877b8] text-white"><Check className="size-4" aria-hidden="true" /></span> : <ChevronRight className="size-5 shrink-0 text-slate-400" aria-hidden="true" />}
          </button>

          {activeMembers.map((member) => {
            const selected = currentAccountId === member.id;
            const granted = Object.values(member.permissions).filter(Boolean).length;
            return (
              <button key={member.id} type="button" aria-pressed={selected} onClick={() => onSelect(member.id)} className={`flex min-h-[88px] w-full items-center justify-between gap-4 rounded-2xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-100 ${selected ? 'border-[#0877b8] bg-sky-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                <span className="flex min-w-0 items-center gap-3"><span className="grid size-12 shrink-0 place-items-center rounded-full bg-[#eaf1f7] font-bold text-[#15375b]">{member.name.slice(0, 1)}</span><span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="font-bold text-slate-950">{member.name}</span><Pill tone={member.role === '리더 교육생' ? 'violet' : 'blue'}>{member.role}</Pill></span><span className="mt-1 block text-xs leading-5 text-slate-500">{member.cohort} · 허용 권한 {granted}/5</span></span></span>
                {selected ? <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#0877b8] text-white"><Check className="size-4" aria-hidden="true" /></span> : <ChevronRight className="size-5 shrink-0 text-slate-400" aria-hidden="true" />}
              </button>
            );
          })}
        </div>

        <div className="border-t bg-slate-50 p-4 text-xs leading-5 text-slate-600 sm:px-5">
          가상 시안이므로 계정 전환과 권한 변경은 이 브라우저에서만 유지되며, 새로고침하면 초기화됩니다.
        </div>
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
  const [members, setMembers] = useState<TraineeMember[]>(sampleTrainees);
  const [currentAccountId, setCurrentAccountId] = useState('admin');
  const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false);
  const [scheduleAudience, setScheduleAudience] = useState<'admin' | 'trainee'>('admin');
  const [modal, setModal] = useState<'quote' | 'contract' | null>(null);
  const [toast, setToast] = useState('');

  const currentMember = currentAccountId === 'admin' ? null : members.find((member) => member.id === currentAccountId) ?? null;
  const isAdmin = currentAccountId === 'admin';
  const previewMember = currentMember ?? members.find((member) => member.status === '활성') ?? sampleTrainees[0];
  const traineeName = previewMember.name.replace('(가상)', '');
  const availableNavItems = useMemo(() => {
    if (isAdmin) return navItems;
    if (!currentMember || currentMember.status !== '활성') return [];
    return navItems.filter((item) => {
      if (item.view === 'trainee') return true;
      if (item.view === 'schedule') return currentMember.permissions.sharedSchedule;
      if (item.view === 'application') return currentMember.permissions.collaborationApply;
      if (item.view === 'case' || item.view === 'consultation') return currentMember.permissions.ownCases;
      if (item.view === 'documents') return currentMember.permissions.fileUpload;
      return false;
    });
  }, [currentMember, isAdmin]);
  const allowedViews = useMemo(() => new Set(availableNavItems.map((item) => item.view)), [availableNavItems]);
  const activeLabel = useMemo(() => navItems.find((item) => item.view === view)?.label ?? '파트너 허브', [view]);

  function navigate(next: View) {
    if (!allowedViews.has(next)) {
      notify('현재 가상 계정에는 이 메뉴 권한이 없습니다.');
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

  function switchAccount(accountId: string) {
    const nextMember = accountId === 'admin' ? null : members.find((member) => member.id === accountId) ?? null;
    setCurrentAccountId(accountId);
    setAccountSwitcherOpen(false);
    setMobileOpen(false);
    setModal(null);
    if (accountId === 'admin') {
      setScheduleAudience('admin');
      setView('admin');
      notify('김성민 대표 관리자 화면으로 전환했습니다.');
    } else if (nextMember) {
      setScheduleAudience('trainee');
      setView('trainee');
      notify(`${nextMember.name} ${nextMember.role} 화면으로 전환했습니다.`);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
        date: '방금 전',
        title: `상담 #${number} 저장`,
        detail: `후속조치: ${payload.followUps.length ? payload.followUps.join(' · ') : '없음'}${payload.calendarSync ? ' / Google Calendar 등록대상' : ''}${payload.shareMode !== 'private' ? ' / 교육생 일정 공유' : ''}`,
        type: '상담',
        tone: 'green',
      },
    ]);
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
          company: '세림테크(가상)',
          service: payload.title || `상담 #${number}`,
          method: payload.method,
          status: '확정',
          tone: 'green',
          source: 'partner',
          assignedTrainee: '박지현',
          shareMode: payload.shareMode,
        },
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
        <button type="button" onClick={() => setAccountSwitcherOpen(true)} className="m-4 min-h-24 rounded-xl border border-white/10 bg-white/5 p-4 text-left hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-300/30" aria-haspopup="dialog"><p className="text-xs text-blue-200">{isAdmin ? '대표 관리자' : currentMember?.role}</p><p className="mt-1 text-sm font-semibold">{isAdmin ? '김성민 대표' : currentMember?.name}</p><p className="mt-2 flex items-center gap-1 text-xs text-blue-100/80">가상 계정 전환 <ChevronRight className="size-3.5" aria-hidden="true" /></p></button>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" onClick={() => setMobileOpen(false)} aria-label="메뉴 닫기" className="absolute inset-0 h-full w-full cursor-default bg-slate-950/40" />
          <aside className="relative h-full w-[min(86vw,320px)] bg-[#112f50] p-4 text-white">
            <div className="mb-5 flex items-center justify-between"><div className="flex items-center gap-3"><BrandMark /><span className="font-bold">파트너 허브</span></div><button type="button" onClick={() => setMobileOpen(false)} className="grid size-11 place-items-center rounded-xl hover:bg-white/10" aria-label="메뉴 닫기"><X /></button></div>
            <nav aria-label="모바일 메뉴" className="space-y-2">{availableNavItems.map(navButton)}</nav>
            <button type="button" onClick={() => setAccountSwitcherOpen(true)} className="mt-5 flex min-h-12 w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold hover:bg-white/10" aria-haspopup="dialog"><span>{isAdmin ? '김성민 대표' : currentMember?.name}</span><ChevronRight className="size-4" aria-hidden="true" /></button>
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-[244px]">
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 lg:hidden"><button type="button" onClick={() => setMobileOpen(true)} className="grid size-11 place-items-center rounded-xl hover:bg-slate-100" aria-label="메뉴 열기"><Menu /></button><span className="hidden text-sm font-bold text-[#15375b] sm:inline">{activeLabel}</span></div>
          <div className="hidden max-w-md flex-1 items-center gap-2 rounded-xl border bg-slate-50 px-3 text-slate-500 md:flex"><Search className="size-4" aria-hidden="true" /><input aria-label="기업명 또는 신청번호 검색" className="h-10 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400" placeholder="기업명 또는 신청번호 검색" /></div>
          <div className="ml-auto flex items-center gap-2">
            <Pill tone="slate">가상 시안</Pill>
            <button type="button" onClick={() => setAccountSwitcherOpen(true)} aria-haspopup="dialog" aria-expanded={accountSwitcherOpen} className="flex min-h-11 max-w-[190px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-100"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#eaf1f7] text-xs font-bold text-[#15375b]">{isAdmin ? '김' : currentMember?.name.slice(0, 1)}</span><span className="hidden min-w-0 truncate sm:block">{isAdmin ? '김성민 대표' : currentMember?.name}</span><ChevronDown className="size-4 shrink-0 text-slate-400" aria-hidden="true" /></button>
            <button type="button" className="hidden size-11 place-items-center rounded-xl text-slate-600 hover:bg-slate-100 xl:grid" aria-label="알림 5건"><Bell /></button>
            {isAdmin || currentMember?.permissions.collaborationApply ? <PrimaryButton onClick={() => navigate('application')}><Plus className="size-4" aria-hidden="true" /> <span className="hidden md:inline">새 협업신청</span><span className="md:hidden">신청</span></PrimaryButton> : null}
          </div>
        </header>

        <main id="main-content" className="mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8">
          {view === 'admin' ? <AdminDashboard onOpenCase={() => navigate('case')} onOpenSchedule={() => openSchedule('admin')} schedule={schedule} /> : null}
          {view === 'schedule' ? <SchedulePage schedule={schedule} onNewConsultation={() => navigate('consultation')} notify={notify} audience={isAdmin ? scheduleAudience : 'trainee'} onAudienceChange={setScheduleAudience} canPreviewAdmin={isAdmin} traineeName={traineeName} /> : null}
          {view === 'trainee' ? <TraineeDashboard onOpenCase={() => navigate('case')} onNew={() => navigate('application')} onOpenSchedule={() => openSchedule('trainee')} schedule={schedule} member={previewMember} /> : null}
          {view === 'access' ? <AccessManagement notify={notify} members={members} setMembers={setMembers} /> : null}
          {view === 'application' ? <ApplicationForm onCancel={() => navigate('trainee')} onDone={() => { notify('협업신청이 접수되었습니다.'); navigate('trainee'); }} /> : null}
          {view === 'case' ? <CaseDetail timeline={timeline} onConsult={() => navigate('consultation')} onDocuments={() => navigate('documents')} onDocumentModal={(type) => { if (isAdmin || currentMember?.permissions.quoteContract) setModal(type); else notify('현재 가상 계정에는 견적·계약 권한이 없습니다.'); }} canFileUpload={isAdmin || Boolean(currentMember?.permissions.fileUpload)} canQuoteContract={isAdmin || Boolean(currentMember?.permissions.quoteContract)} assignedTrainee={isAdmin ? '박지현' : traineeName} /> : null}
          {view === 'consultation' ? <ConsultationForm number={consultationNumber} onCancel={() => navigate('case')} onSave={saveConsultation} /> : null}
          {view === 'documents' ? <DocumentRequest onCancel={() => navigate('case')} onSave={() => { setTimeline((current) => [...current, { date: '방금 전', title: '서류요청 #2 등록', detail: '요청대상: 기업대표 / 전달 담당자: 박지현 교육생', type: '서류', tone: 'amber' }]); notify('서류요청 #2가 등록되었습니다.'); navigate('case'); }} /> : null}
        </main>
      </div>

      {modal ? <DocumentModal type={modal} onClose={() => setModal(null)} onSave={() => { const kind = modal === 'quote' ? '견적서 V2' : '계약서 V1'; setTimeline((current) => [...current, { date: '방금 전', title: `${kind} 초안 저장`, detail: '관련 상담: 연결하지 않음 / 내부검토 전', type: modal === 'quote' ? '견적' : '계약', tone: 'violet' }]); setModal(null); notify(`${kind} 초안이 저장되었습니다.`); }} /> : null}

      {accountSwitcherOpen ? <VirtualAccountSwitcher members={members} currentAccountId={currentAccountId} onSelect={switchAccount} onClose={() => setAccountSwitcherOpen(false)} /> : null}

      {toast ? <output aria-live="polite" aria-atomic="true" className="fixed bottom-5 left-1/2 z-[70] flex w-[min(92vw,520px)] -translate-x-1/2 items-center gap-3 rounded-2xl bg-[#112f50] px-5 py-4 text-sm font-semibold text-white shadow-2xl"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-emerald-400 text-[#112f50]"><Check className="size-4" /></span>{toast}</output> : null}
    </div>
  );
}
