'use client';

import { useMemo, useState } from 'react';
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
  FileCheck2,
  FilePlus2,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Menu,
  MessageSquarePlus,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Upload,
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
  | 'trainee'
  | 'application'
  | 'case'
  | 'consultation'
  | 'documents';

type IconType = typeof LayoutDashboard;

const navItems: Array<{ view: View; label: string; icon: IconType }> = [
  { view: 'admin', label: '대표 대시보드', icon: LayoutDashboard },
  { view: 'trainee', label: '교육생 화면', icon: Users },
  { view: 'application', label: '새 협업신청', icon: FilePlus2 },
  { view: 'case', label: '기업·사건 상세', icon: BriefcaseBusiness },
  { view: 'consultation', label: '상담 등록', icon: MessageSquarePlus },
  { view: 'documents', label: '서류 요청', icon: FolderOpen },
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

function AdminDashboard({ onOpenCase }: { onOpenCase: () => void }) {
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

function TraineeDashboard({ onOpenCase, onNew }: { onOpenCase: () => void; onNew: () => void }) {
  return (
    <>
      <PageIntro
        eyebrow="교육생 협업공간"
        title="박지현 교육생님, 진행상황을 확인하세요"
        description="본인이 주관하거나 공동 협업자로 참여한 기업만 표시됩니다."
        action={
          <PrimaryButton onClick={onNew}>
            <Plus className="size-4" aria-hidden="true" /> 새 협업신청
          </PrimaryButton>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['진행기업', '6', BriefcaseBusiness, '전체 협업 사건'],
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
}: {
  timeline: typeof baseTimeline;
  onConsult: () => void;
  onDocuments: () => void;
  onDocumentModal: (type: 'quote' | 'contract') => void;
}) {
  const [tab, setTab] = useState('timeline');
  const tabs = [
    ['timeline', '전체 타임라인'],
    ['services', '서비스 과업'],
    ['consultations', '상담'],
    ['documents', '서류요청'],
    ['quotes', '견적서'],
    ['contracts', '계약서'],
  ];

  return (
    <>
      <PageIntro
        eyebrow="기업·사건 상세"
        title="세림테크(가상)"
        description="신청번호 KEVE-2026-0829-001 · 주관 교육생 박지현 · 내부 담당자 김도윤"
        action={<Pill tone="blue">상담·협의 진행</Pill>}
      />

      <section aria-label="사건 요약" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['상담', `${Math.max(3, timeline.filter((item) => item.type === '상담').length)}회`, '반복등록'],
          ['미제출 서류', '2건', '09.05 마감'],
          ['견적서', 'V1 검토 중', '대표 승인 대기'],
          ['계약서', '미작성', '필요 시 생성'],
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
              <SecondaryButton onClick={onDocuments} className="justify-start"><FileCheck2 className="size-4 text-[#0877b8]" /> 서류요청</SecondaryButton>
              <SecondaryButton onClick={() => onDocumentModal('quote')} className="justify-start"><FilePlus2 className="size-4 text-[#0877b8]" /> 견적서 작성</SecondaryButton>
              <SecondaryButton onClick={() => onDocumentModal('contract')} className="justify-start"><FileText className="size-4 text-[#0877b8]" /> 계약서 작성</SecondaryButton>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-[0_8px_30px_rgb(15_23_42/6%)] ring-slate-200/80">
            <CardHeader><CardTitle className="text-lg font-bold">다음 행동</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm font-semibold text-slate-800">견적서 V1 대표 승인</p>
              <div className="mt-3 flex items-center justify-between gap-3"><Pill tone="amber">오늘 마감</Pill><span className="text-xs text-slate-500">담당 김도윤</span></div>
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
  onSave: (followUps: string[]) => void;
  onCancel: () => void;
}) {
  const options = ['다음 상담 등록', '서류요청', '견적서 작성', '계약서 작성', '내부업무 등록'];
  const [followUps, setFollowUps] = useState<string[]>(['서류요청']);

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
            <Field label="상담 제목·목적" required><input className={inputClass} placeholder="예: 정책자금 신청방향 및 보완사항 협의" /></Field>
            <Field label="관련 서비스" required><select className={inputClass}><option>정책자금</option><option>특허·지식재산</option><option>정책자금 + 특허</option></select></Field>
            <Field label="상담 일시" required><input className={inputClass} type="datetime-local" /></Field>
            <Field label="상담방식"><select className={inputClass}><option>전화</option><option>방문</option><option>화상</option><option>기타</option></select></Field>
            <Field label="참석자"><input className={inputClass} placeholder="기업대표, 교육생, 내부 담당자" /></Field>
            <Field label="상담상태"><select className={inputClass}><option>상담 완료</option><option>일정 요청</option><option>일정 확정</option><option>고객 회신 대기</option><option>취소</option></select></Field>
          </div>

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
          <PrimaryButton onClick={() => onSave(followUps)}><Check className="size-4" /> 상담 #{number} 저장</PrimaryButton>
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

export default function Home() {
  const [view, setView] = useState<View>('admin');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [consultationNumber, setConsultationNumber] = useState(4);
  const [timeline, setTimeline] = useState(baseTimeline);
  const [modal, setModal] = useState<'quote' | 'contract' | null>(null);
  const [toast, setToast] = useState('');

  const activeLabel = useMemo(() => navItems.find((item) => item.view === view)?.label ?? '파트너 허브', [view]);

  function navigate(next: View) {
    setView(next);
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  }

  function saveConsultation(followUps: string[]) {
    const number = consultationNumber;
    setTimeline((current) => [
      ...current,
      {
        date: '방금 전',
        title: `상담 #${number} 저장`,
        detail: `후속조치: ${followUps.length ? followUps.join(' · ') : '없음'}`,
        type: '상담',
        tone: 'green',
      },
    ]);
    setConsultationNumber((value) => value + 1);
    notify(`상담 #${number}과 후속조치가 저장되었습니다.`);
    navigate('case');
  }

  function navButton(item: { view: View; label: string; icon: IconType }) {
    const Icon = item.icon;
    const active = item.view === view;
    return (
      <button key={item.view} type="button" onClick={() => navigate(item.view)} className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-300/40 ${active ? 'bg-white text-[#15375b]' : 'text-blue-50 hover:bg-white/10'}`}>
        <Icon className="size-[18px]" aria-hidden="true" /> {item.label}
      </button>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a href="#main-content" className="sr-only z-[60] rounded-md bg-white px-4 py-3 text-sm font-semibold text-[#15375b] focus:not-sr-only focus:fixed focus:left-4 focus:top-4">본문으로 바로가기</a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[244px] flex-col bg-[#112f50] text-white lg:flex">
        <div className="flex h-[76px] items-center gap-3 border-b border-white/10 px-5"><BrandMark /><div><p className="text-[11px] font-semibold tracking-[0.18em] text-blue-200">KEVE</p><p className="text-[15px] font-bold tracking-tight">한기평 파트너 허브</p></div></div>
        <nav aria-label="주요 메뉴" className="flex-1 space-y-1 overflow-y-auto p-4">{navItems.map(navButton)}</nav>
        <div className="m-4 rounded-xl border border-white/10 bg-white/5 p-4"><p className="text-xs text-blue-200">대표 관리자</p><p className="mt-1 text-sm font-semibold">김성민 대표</p><p className="mt-3 text-xs leading-5 text-blue-100/80">기업의 가치를 높이고 성장시키는 솔루션</p></div>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" onClick={() => setMobileOpen(false)} aria-label="메뉴 닫기" className="absolute inset-0 h-full w-full cursor-default bg-slate-950/40" />
          <aside className="relative h-full w-[min(86vw,320px)] bg-[#112f50] p-4 text-white">
            <div className="mb-5 flex items-center justify-between"><div className="flex items-center gap-3"><BrandMark /><span className="font-bold">파트너 허브</span></div><button type="button" onClick={() => setMobileOpen(false)} className="grid size-11 place-items-center rounded-xl hover:bg-white/10" aria-label="메뉴 닫기"><X /></button></div>
            <nav aria-label="모바일 메뉴" className="space-y-2">{navItems.map(navButton)}</nav>
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-[244px]">
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 lg:hidden"><button type="button" onClick={() => setMobileOpen(true)} className="grid size-11 place-items-center rounded-xl hover:bg-slate-100" aria-label="메뉴 열기"><Menu /></button><span className="hidden text-sm font-bold text-[#15375b] sm:inline">{activeLabel}</span></div>
          <div className="hidden max-w-md flex-1 items-center gap-2 rounded-xl border bg-slate-50 px-3 text-slate-500 md:flex"><Search className="size-4" aria-hidden="true" /><input aria-label="기업명 또는 신청번호 검색" className="h-10 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400" placeholder="기업명 또는 신청번호 검색" /></div>
          <div className="ml-auto flex items-center gap-2"><Pill tone="slate">가상 시안 데이터</Pill><button type="button" className="hidden size-11 place-items-center rounded-xl text-slate-600 hover:bg-slate-100 sm:grid" aria-label="알림 5건"><Bell /></button><PrimaryButton onClick={() => navigate('application')}><Plus className="size-4" /> <span className="hidden sm:inline">새 협업신청</span><span className="sm:hidden">신청</span></PrimaryButton></div>
        </header>

        <main id="main-content" className="mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8">
          {view === 'admin' ? <AdminDashboard onOpenCase={() => navigate('case')} /> : null}
          {view === 'trainee' ? <TraineeDashboard onOpenCase={() => navigate('case')} onNew={() => navigate('application')} /> : null}
          {view === 'application' ? <ApplicationForm onCancel={() => navigate('trainee')} onDone={() => { notify('협업신청이 접수되었습니다.'); navigate('trainee'); }} /> : null}
          {view === 'case' ? <CaseDetail timeline={timeline} onConsult={() => navigate('consultation')} onDocuments={() => navigate('documents')} onDocumentModal={setModal} /> : null}
          {view === 'consultation' ? <ConsultationForm number={consultationNumber} onCancel={() => navigate('case')} onSave={saveConsultation} /> : null}
          {view === 'documents' ? <DocumentRequest onCancel={() => navigate('case')} onSave={() => { setTimeline((current) => [...current, { date: '방금 전', title: '서류요청 #2 등록', detail: '요청대상: 기업대표 / 전달 담당자: 박지현 교육생', type: '서류', tone: 'amber' }]); notify('서류요청 #2가 등록되었습니다.'); navigate('case'); }} /> : null}
        </main>
      </div>

      {modal ? <DocumentModal type={modal} onClose={() => setModal(null)} onSave={() => { const kind = modal === 'quote' ? '견적서 V2' : '계약서 V1'; setTimeline((current) => [...current, { date: '방금 전', title: `${kind} 초안 저장`, detail: '관련 상담: 연결하지 않음 / 내부검토 전', type: modal === 'quote' ? '견적' : '계약', tone: 'violet' }]); setModal(null); notify(`${kind} 초안이 저장되었습니다.`); }} /> : null}

      {toast ? <output aria-live="polite" aria-atomic="true" className="fixed bottom-5 left-1/2 z-[70] flex w-[min(92vw,520px)] -translate-x-1/2 items-center gap-3 rounded-2xl bg-[#112f50] px-5 py-4 text-sm font-semibold text-white shadow-2xl"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-emerald-400 text-[#112f50]"><Check className="size-4" /></span>{toast}</output> : null}
    </div>
  );
}
