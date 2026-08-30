'use client';
/* oxlint-disable next/no-html-link-for-pages -- Protected report/download endpoints use native navigation. */
import {
  useEffect,
  useRef,
  useState,
  type SubmitEvent,
  type ReactNode,
} from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  LockKeyhole,
  RefreshCw,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  ConsultationTranscriptForm,
  type TranscriptSubmit,
} from '@/components/consultation-transcript-form';
import {
  analysisDone,
  deepReport,
  depositReceived,
  documentsDone,
  firstMeeting,
  flowPhases,
  latestRecording,
  latestReport,
  nextFlowAction,
  phaseOf,
  preparationDone,
  reportLabels,
  signingPreparationDone,
  type ConsultingFlow,
  type FlowPhase,
  type ReportStage,
} from '@/lib/consulting-flow';

type Section =
  | 'reports'
  | 'analysis'
  | 'meetings'
  | 'recording'
  | 'solutions'
  | 'documents'
  | 'contract'
  | 'aftercare'
  | 'history'
  | 'ai';
const sections: [Section, string][] = [
  ['reports', '보고서 1–6차'],
  ['analysis', '공동분석'],
  ['meetings', '상담 일정'],
  ['recording', '녹취자료·심화분석'],
  ['solutions', '진행솔루션'],
  ['documents', '추가서류'],
  ['contract', '계약·입금'],
  ['aftercare', '수행·사후관리'],
  ['history', '변경 이력'],
  ['ai', 'AI·근거자료'],
];
const phaseSection: Record<FlowPhase, Section> = {
  '1차 보고서': 'reports',
  공동분석: 'analysis',
  '초회상담 예약': 'meetings',
  '2차·3차 준비': 'reports',
  초회상담: 'meetings',
  '녹취자료 등록': 'recording',
  '4차 심화분석': 'recording',
  '진행솔루션 확정': 'solutions',
  '추가서류 확인': 'documents',
  '5차·6차 준비': 'reports',
  '계약 상담': 'meetings',
  '계약 체결': 'contract',
  '계약금 확인': 'contract',
  '컨설팅 수행': 'aftercare',
  사후관리: 'aftercare',
};
const control =
  'min-h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40';
const dateTime = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '상담일 확인 필요';
const meetingName = (kind: string) =>
  kind === 'first' ? '초회상담' : kind === 'contract' ? '계약상담' : '추가상담';
const attendanceName = (attendance: string) =>
  attendance === 'both'
    ? '동반'
    : attendance === 'partner'
      ? '파트너 단독'
      : '김성민 대표 단독';
const value = (data: FormData, key: string) => {
  const entry = data.get(key);
  return typeof entry === 'string' ? entry.trim() : '';
};
const attached = (data: FormData) => {
  const f = data.get('file');
  return f instanceof File && f.size ? f : undefined;
};
const checks = (data: FormData) => ({
  fileConsent: data.has('fileConsent'),
  recordingConsent: data.has('recordingConsent'),
  privacyMasked: data.has('privacyMasked'),
  costConsent: data.has('costConsent'),
});

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}
function Confirm({
  name,
  children,
  required = true,
}: {
  name: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="flex min-h-11 items-start gap-3 rounded-lg bg-muted/60 p-3 text-sm leading-6">
      <input
        type="checkbox"
        name={name}
        required={required}
        className="mt-1 size-4 shrink-0 accent-primary"
      />
      <span>{children}</span>
    </label>
  );
}
function Files({
  accept,
  required = false,
}: {
  accept?: string;
  required?: boolean;
}) {
  return (
    <>
      <Field label="첨부파일 (최대 25MB)">
        <input
          type="file"
          name="file"
          accept={accept}
          required={required}
          className={`${control} py-2`}
        />
      </Field>
      <Confirm name="fileConsent" required={required}>
        자료 저장과 담당 파트너 공유 권한을 확인했습니다. 첨부가 있다면 반드시
        선택해 주세요.
      </Confirm>
    </>
  );
}
function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-bold">{title}</CardTitle>
        {description && (
          <CardDescription className="leading-6">{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}
function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm leading-6 text-muted-foreground">
      {children}
    </p>
  );
}
type Submit = TranscriptSubmit;
type FlowPayload = {
  flow: ConsultingFlow;
  error?: string;
  role: 'admin' | 'partner';
  canUpload: boolean;
  readiness: { aiConnected: boolean; model: string };
};
function ActionForm({
  busy,
  label,
  onSubmit,
  children,
}: {
  busy: boolean;
  label: string;
  onSubmit: (data: FormData) => Promise<boolean>;
  children: ReactNode;
}) {
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (await onSubmit(data)) form.reset();
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <fieldset disabled={busy} className="space-y-4">
        {children}
        <Button type="submit" className="min-h-11 px-5">
          {busy ? '저장·처리 중…' : label}
        </Button>
      </fieldset>
    </form>
  );
}

export function ConsultingWorkflow({
  caseId,
  onUpdated,
}: {
  caseId: string;
  onUpdated?: () => void;
}) {
  const [flow, setFlow] = useState<ConsultingFlow | null>(null);
  const [role, setRole] = useState<'admin' | 'partner'>('partner');
  const [canUpload, setCanUpload] = useState(false);
  const [readiness, setReadiness] = useState({ aiConnected: false, model: '' });
  const [section, setSection] = useState<Section>('reports');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(() => Date.now());
  const currentDate = new Date(clock + 9 * 3600000).toISOString().slice(0, 10);
  const busyRef = useRef(false);
  const pending = useRef<{ key: string; id: string } | null>(null);
  const endpoint = `/api/consulting-flow/${encodeURIComponent(caseId)}`;
  async function refresh(initial = false) {
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      const data = (await response.json()) as FlowPayload;
      if (!response.ok)
        throw new Error(data.error || '진행 정보를 불러오지 못했습니다.');
      setFlow(data.flow);
      setRole(data.role);
      setReadiness(data.readiness);
      setCanUpload(data.canUpload);
      if (initial) setSection(phaseSection[phaseOf(data.flow)]);
      return data.flow as ConsultingFlow;
    } catch (e) {
      setError(e instanceof Error ? e.message : '연결을 확인해 주세요.');
      return null;
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as FlowPayload;
        if (!response.ok)
          throw new Error(data.error || '진행을 불러오지 못했습니다.');
        return data;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setFlow(data.flow);
        setRole(data.role);
        setReadiness(data.readiness);
        setCanUpload(data.canUpload);
        setSection(phaseSection[phaseOf(data.flow)]);
        setLoading(false);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : '진행 확인 필요');
          setLoading(false);
        }
      });
    const timer = window.setInterval(() => setClock(Date.now()), 30000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [endpoint]);
  async function runQueued() {
    const response = await fetch(`${endpoint}/run`, { method: 'POST' });
    const data = (await response.json()) as FlowPayload;
    if (!response.ok)
      throw new Error(data.error || 'AI 생성 상태를 확인해 주세요.');
    setFlow(data.flow);
    const latest = data.flow.jobs.at(-1);
    setNotice(
      latest?.status === 'complete'
        ? '보고서를 자동 저장하고 담당 파트너 자료함에 공유했습니다.'
        : latest?.reason
          ? `업무는 저장되었습니다. AI 생성 확인: ${latest.reason}`
          : '업무 저장 완료. 생성 대기·진행 상태를 확인해 주세요.',
    );
  }
  const submit: Submit = async (command, file, audio) => {
    if (!flow || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const key =
      JSON.stringify(command) +
      (file ? `${file.name}:${file.size}:${file.lastModified}` : '') +
      (audio ? `:audio:${audio.name}:${audio.size}:${audio.lastModified}` : '');
    if (pending.current?.key !== key)
      pending.current = { key, id: crypto.randomUUID() };
    const payload = JSON.stringify({
      command,
      revision: flow.revision,
      commandId: pending.current.id,
    });
    let saved = false;
    try {
      const form = new FormData();
      if (file || audio) {
        form.set('payload', payload);
        if (file) form.set('file', file);
        if (audio) form.set('audio', audio);
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers:
          file || audio ? undefined : { 'content-type': 'application/json' },
        body: file || audio ? form : payload,
      });
      const data = (await response.json()) as FlowPayload;
      if (!response.ok) {
        if (response.status === 409) await refresh();
        throw new Error(data.error || '저장하지 못했습니다.');
      }
      setFlow(data.flow);
      pending.current = null;
      saved = true;
      setNotice('저장되었습니다. 담당 파트너와 같은 진행 상태를 확인합니다.');
      if (
        (data.flow as ConsultingFlow).jobs.some((j) => j.status === 'queued') &&
        !(
          command.type === 'save_recording' &&
          !(typeof command.transcript === 'string' && command.transcript.trim())
        )
      ) {
        setNotice(
          '업무 저장 완료. 보고서를 생성 중입니다. 잠시 이 화면을 유지해 주세요.',
        );
        await runQueued();
      }
      return true;
    } catch (e) {
      setError(
        (saved ? '업무는 저장되었지만 ' : '') +
          (e instanceof Error
            ? e.message
            : '연결 상태가 불확실합니다. 새로고침으로 저장 여부를 확인해 주세요.'),
      );
      return saved;
    } finally {
      if (saved) onUpdated?.();
      busyRef.current = false;
      setBusy(false);
    }
  };
  async function resumeQueued() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await runQueued();
      onUpdated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : '생성 상태 확인 필요');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const download = (id: string, label = '첨부 내려받기') => (
    <a
      href={`${endpoint}/files/${encodeURIComponent(id)}`}
      className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4"
    >
      {label}
    </a>
  );
  if (loading)
    return (
      <Panel title="컨설팅 진행 불러오는 중">
        <output>저장된 보고서와 현재 단계를 확인하고 있습니다.</output>
      </Panel>
    );
  if (!flow)
    return (
      <Panel title="컨설팅 진행 확인 필요">
        <p role="alert">{error}</p>
        <Button className="min-h-11" onClick={() => void refresh(true)}>
          다시 불러오기
        </Button>
      </Panel>
    );
  const admin = role === 'admin';
  const current = nextFlowAction(flow);
  const phaseIndex = flowPhases.indexOf(current.phase);
  const r1 = latestReport(flow, 1);
  const r4 = deepReport(flow);
  const first = firstMeeting(flow);
  const recording = latestRecording(flow);
  const transcriptForm = !flow.contract && (
    <ConsultationTranscriptForm
      key={`new-${caseId}-${recording?.id || 'first'}`}
      meetings={flow.meetings}
      busy={busy}
      canUpload={canUpload}
      submit={submit}
      aiEnabled={flow.ai.enabled}
    />
  );
  const contractMeetings = flow.meetings.filter(
    (m) => m.kind === 'contract' && m.status !== 'cancelled',
  );
  const showReports = (stage: ReportStage) => {
    const report = latestReport(flow, stage);
    const allowed =
      !flow.contract &&
      (stage === 1
        ? !first?.completedAt
        : stage <= 3
          ? analysisDone(flow) && Boolean(first)
          : stage === 4
            ? Boolean(recording)
            : documentsDone(flow));
    return (
      <Card key={stage}>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-primary/10 font-bold text-primary">
              {stage}
            </span>
            <span
              className={`text-xs font-semibold ${report ? 'text-emerald-700' : 'text-muted-foreground'}`}
            >
              {report ? `V${report.version} 저장됨` : '준비 전'}
            </span>
          </div>
          <CardTitle className="mt-2">{reportLabels[stage]}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {report ? (
            <>
              <p className="text-xs leading-5 text-muted-foreground">
                {dateTime(report.createdAt)} · {report.createdBy}
                <br />
                담당 파트너에게 자동 공유됨
              </p>
              <div className="flex flex-wrap gap-4">
                {report.fileId && download(report.fileId)}
                {report.body && (
                  <>
                    <a
                      href={`${endpoint}/reports/${report.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center font-semibold text-primary underline"
                    >
                      본문·인쇄
                    </a>
                    <a
                      href={`${endpoint}/reports/${report.id}?download=1`}
                      className="inline-flex min-h-11 items-center text-primary underline"
                    >
                      본문 저장
                    </a>
                  </>
                )}
              </div>
              {report.origin === 'ai' && (
                <Hint>
                  AI 내부 초안입니다. 기업대표 전달 전 대표님 검토가 필요합니다.
                </Hint>
              )}
              {(((stage === 2 || stage === 3) &&
                report.sourceReportId !== r1?.id) ||
                (stage === 4 && report.id !== r4?.id) ||
                (stage >= 5 && !signingPreparationDone(flow))) && (
                <Hint>후속 진행 전 최신 근거와 문서 버전을 확인해 주세요.</Hint>
              )}
            </>
          ) : (
            <p className="min-h-12 text-sm text-muted-foreground">
              {stage === 3
                ? '김성민 대표가 완성한 PPTX 또는 발표용 PDF를 등록합니다.'
                : stage === 5 || stage === 6
                  ? '솔루션 확정·필수 서류 검토 후 대표님이 문서를 준비합니다.'
                  : stage === 4
                    ? '확인한 상담 전사문으로 초안 생성 또는 대표 수동 등록'
                    : '완성한 문서를 등록하거나 본문을 입력합니다.'}
            </p>
          )}
          {admin && allowed && (
            <details>
              <summary className="min-h-11 cursor-pointer py-3 font-semibold text-primary">
                {report ? '새 버전 등록' : '보고서 등록'}
              </summary>
              <ActionForm
                busy={busy}
                label="저장 · 담당 파트너 공유"
                onSubmit={(d) =>
                  submit(
                    {
                      type: 'save_report',
                      stage,
                      body: value(d, 'body'),
                      ...checks(d),
                    },
                    attached(d),
                  )
                }
              >
                <Hint>
                  첨부파일 또는 80자 이상 본문이 필요합니다. 등록 즉시 담당
                  파트너에게만 공유됩니다.
                </Hint>
                {stage !== 3 && (
                  <Field label="보고서 본문 (첨부파일만 등록해도 됩니다)">
                    <Textarea name="body" maxLength={80000} rows={6} />
                  </Field>
                )}
                <Files
                  accept={stage === 3 ? '.pptx,.pdf' : '.pdf,.docx,.txt,.md'}
                  required={stage === 3}
                />
              </ActionForm>
            </details>
          )}
          {!allowed && !report && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <LockKeyhole className="size-3" /> 앞 단계 조건 충족 후 준비
            </p>
          )}
          {flow.reports.filter((r) => r.stage === stage).length > 1 && (
            <details>
              <summary className="cursor-pointer py-2 text-sm">
                이전 버전 보기
              </summary>
              {flow.reports
                .filter((r) => r.stage === stage && r.id !== report?.id)
                .map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center gap-3 border-t py-2 text-xs"
                  >
                    V{r.version} · {dateTime(r.createdAt)}{' '}
                    {r.fileId && download(r.fileId)}
                    {r.body && (
                      <a
                        href={`${endpoint}/reports/${r.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        본문
                      </a>
                    )}
                  </div>
                ))}
            </details>
          )}
        </CardContent>
      </Card>
    );
  };
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-widest text-primary">
            CONSULTING WORKFLOW
          </p>
          <h1 className="mt-2 text-2xl font-bold text-primary">
            {flow.company}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            주관 파트너 {flow.partnerName} · 김성민 대표 · 진행번호 {caseId}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          className="min-h-11"
          onClick={() => {
            setError('');
            void refresh();
          }}
        >
          <RefreshCw /> 새로고침
        </Button>
      </header>
      <Card className="bg-primary text-primary-foreground">
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs text-white/75">
                현재 단계 · {phaseIndex + 1} / {flowPhases.length}
              </p>
              <h2 className="mt-2 text-2xl font-bold">{current.phase}</h2>
              <p className="mt-3 flex items-center gap-2 text-sm">
                <Users className="size-4" /> {current.owner}
              </p>
            </div>
            <Button
              variant="secondary"
              className="min-h-11"
              onClick={() => setSection(phaseSection[current.phase])}
            >
              다음 할 일 <ArrowRight />
            </Button>
          </div>
          <p className="text-sm leading-6 text-white/90">{current.message}</p>
          <progress
            aria-label="현재 업무 단계 위치"
            value={phaseIndex + 1}
            max={15}
            aria-valuetext={current.phase}
            className="h-1.5 w-full overflow-hidden rounded-full bg-white/20 accent-sky-300"
          />
        </CardContent>
      </Card>
      <div
        className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5"
        aria-label="업무 진행 순서"
      >
        {flowPhases.map((phase, i) => (
          <button
            key={phase}
            type="button"
            onClick={() => setSection(phaseSection[phase])}
            aria-current={current.phase === phase ? 'step' : undefined}
            className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 text-left text-xs ${current.phase === phase ? 'border-primary bg-primary/5 font-bold text-primary' : 'border-border bg-card text-muted-foreground'}`}
          >
            <span className="tabular-nums">
              {String(i + 1).padStart(2, '0')}
            </span>
            {phase}
          </button>
        ))}
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800"
        >
          {error}
        </div>
      )}
      {notice && (
        <output
          aria-live="polite"
          className="block rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-900"
        >
          {notice}
        </output>
      )}
      {busy && (
        <output className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock3 className="size-4" />
          저장·생성 중입니다. 중복 클릭하지 말고 잠시 기다려 주세요.
        </output>
      )}
      <nav aria-label="진행 업무 선택" className="flex flex-wrap gap-2">
        {sections
          .filter(([key]) => admin || key !== 'ai')
          .map(([key, label]) => (
            <Button
              key={key}
              variant={section === key ? 'default' : 'outline'}
              aria-pressed={section === key}
              className="min-h-11 px-4"
              onClick={() => setSection(key)}
            >
              {label}
            </Button>
          ))}
      </nav>
      {section === 'reports' && (
        <>
          <Hint>
            보고서 등록은 담당 파트너 자료함에 자동 반영됩니다.
            2차·3차·5차·6차는 대표님이 준비한 실제 파일이나 본문을 등록합니다.
            기존 자료가 이미 있다면 자동생성을 다시 실행하지 않고 여기서
            등록하세요.
          </Hint>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {([1, 2, 3, 4, 5, 6] as ReportStage[]).map(showReports)}
          </div>
          {admin && (
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => setSection('ai')}
            >
              <FileText /> 1차 자동생성 · 근거자료 설정
            </Button>
          )}
        </>
      )}
      {section === 'analysis' && (
        <Panel
          title="각자 확인하는 1차 공동분석"
          description="대표님과 담당 파트너가 본인 계정에서 각각 완료합니다. 1차 보고서가 바뀌면 다시 확인해야 합니다."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ['김성민 대표', flow.analysis.adminAt],
              [flow.partnerName, flow.analysis.partnerAt],
            ].map(([name, at]) => (
              <div key={name} className="rounded-xl border p-5">
                <p className="font-semibold">{name}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {at ? `분석 완료 · ${dateTime(at)}` : '확인 대기'}
                </p>
              </div>
            ))}
          </div>
          <Button
            className="min-h-11"
            disabled={
              busy ||
              !r1 ||
              Boolean(admin ? flow.analysis.adminAt : flow.analysis.partnerAt)
            }
            onClick={() =>
              void submit({ type: 'confirm_analysis', reportId: r1?.id })
            }
          >
            <CheckCircle2 /> {admin ? '대표' : '파트너'} 분석 완료
          </Button>
          {analysisDone(flow) && (
            <Hint>
              두 사람 모두 확인했습니다. 담당 파트너가 기업대표와 초회상담을
              예약해 주세요.
            </Hint>
          )}
        </Panel>
      )}
      {section === 'meetings' && (
        <>
          <Panel
            title="상담 일정 · 필요한 만큼 반복"
            description="시간은 한국 시간(서울) 기준입니다. 초회상담은 동반, 추가·계약상담은 동반 또는 단독 참석을 선택합니다. 저장은 사이트 일정에 반영되며 Google 자동 전송은 하지 않습니다."
          >
            {flow.meetings.length === 0 && (
              <Hint>아직 예약된 상담이 없습니다.</Hint>
            )}
            {flow.meetings.map((m) => (
              <article key={m.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>
                    {meetingName(m.kind)} · {attendanceName(m.attendance)}
                  </strong>
                  <span className="text-xs">
                    {m.status === 'scheduled'
                      ? '예약됨'
                      : m.status === 'completed'
                        ? '완료'
                        : '취소'}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6">
                  {dateTime(m.startsAt)} – {dateTime(m.endsAt)}
                  <br />
                  {m.location}
                </p>
                {m.note && (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                    {m.note}
                  </p>
                )}
                {m.status === 'scheduled' &&
                  (admin || m.attendance !== 'admin') && (
                    <div className="mt-3 flex flex-wrap gap-3">
                      <Button
                        variant="outline"
                        disabled={
                          busy ||
                          new Date(m.startsAt).getTime() > clock ||
                          (m.kind === 'first' && !preparationDone(flow))
                        }
                        className="min-h-11"
                        onClick={() =>
                          void submit({
                            type: 'complete_meeting',
                            meetingId: m.id,
                          })
                        }
                      >
                        실제 상담 완료
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        className="min-h-11"
                        onClick={() => {
                          if (
                            window.confirm(
                              '이 상담 예약을 취소할까요? 기존 기록은 남습니다.',
                            )
                          )
                            void submit({
                              type: 'cancel_meeting',
                              meetingId: m.id,
                            });
                        }}
                      >
                        예약 취소
                      </Button>
                    </div>
                  )}
              </article>
            ))}
          </Panel>
          <Panel title="상담 예약 등록">
            <ActionForm
              busy={busy}
              label="상담 예약 저장"
              onSubmit={(d) =>
                submit({
                  type: 'book_meeting',
                  kind: value(d, 'kind'),
                  attendance:
                    value(d, 'kind') === 'first'
                      ? 'both'
                      : value(d, 'attendance'),
                  startsAt: `${value(d, 'startsAt')}:00+09:00`,
                  endsAt: `${value(d, 'endsAt')}:00+09:00`,
                  location: value(d, 'location'),
                  note: value(d, 'note'),
                })
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="상담 종류">
                  <select
                    name="kind"
                    className={control}
                    defaultValue={
                      !first
                        ? 'first'
                        : signingPreparationDone(flow) && !flow.contract
                          ? 'contract'
                          : 'followup'
                    }
                  >
                    <option
                      value="first"
                      disabled={Boolean(first) || !analysisDone(flow)}
                    >
                      초회상담 (공동분석 후)
                    </option>
                    <option
                      value="followup"
                      disabled={first?.status !== 'completed'}
                    >
                      추가상담
                    </option>
                    <option
                      value="contract"
                      disabled={
                        !signingPreparationDone(flow) || Boolean(flow.contract)
                      }
                    >
                      계약상담 (5차·6차 준비 후)
                    </option>
                  </select>
                </Field>
                <Field label="참석 방식 (초회는 동반 고정)">
                  <select name="attendance" className={control}>
                    <option value="both">파트너 + 김성민 대표</option>
                    <option value="partner">파트너 단독</option>
                    <option value="admin">김성민 대표 단독</option>
                  </select>
                </Field>
                <Field label="시작일시 · 한국 시간">
                  <Input
                    className="min-h-11"
                    name="startsAt"
                    type="datetime-local"
                    required
                  />
                </Field>
                <Field label="종료일시 · 한국 시간">
                  <Input
                    className="min-h-11"
                    name="endsAt"
                    type="datetime-local"
                    required
                  />
                </Field>
              </div>
              <Field label="장소 / 상담 방식">
                <Input
                  className="min-h-11"
                  name="location"
                  required
                  maxLength={200}
                  placeholder="기업 방문, 화상회의 등"
                />
              </Field>
              <Field label="상담 메모">
                <Textarea name="note" maxLength={1000} />
              </Field>
            </ActionForm>
          </Panel>
        </>
      )}
      {section === 'recording' && (
        <>
          <Panel
            title="녹취자료 등록 → 내용 확인 → 4차 심화보고서"
            description="완료한 상담을 선택하고 Word·TXT 전사문을 첨부하거나 본문을 붙여넣어 주세요. 내용을 확인한 뒤 제출하며 원본 음성은 선택 첨부입니다."
          >
            {flow.recordings.map((r) => (
              <div key={r.id} className="rounded-lg border p-4 text-sm">
                <p>
                  {dateTime(r.createdAt)} · 전사문{' '}
                  {r.transcript
                    ? '등록됨 · 내부 검토 자료'
                    : '대기 · 음성 보관만 완료'}
                </p>
                <p className="mt-1 text-muted-foreground">
                  연결된 상담일:{' '}
                  {dateTime(
                    flow.meetings.find((m) => m.id === r.meetingId)?.startsAt,
                  )}
                </p>
                <div className="flex flex-wrap gap-3">
                  {[
                    ...new Set(
                      [r.fileId, r.transcriptFileId, r.audioFileId].filter(
                        (id): id is string => Boolean(id),
                      ),
                    ),
                  ].map((id) => (
                    <span key={id}>
                      {download(
                        id,
                        flow.files.find((f) => f.id === id)?.name ||
                          '첨부 내려받기',
                      )}
                    </span>
                  ))}
                </div>
                {r.transcriptReviewedAt && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    전사문 내용 확인: {dateTime(r.transcriptReviewedAt)} · 증빙
                    검증 완료를 뜻하지 않습니다.
                  </p>
                )}
                {r.transcript && (
                  <details>
                    <summary className="cursor-pointer py-3">
                      전사문 확인
                    </summary>
                    <p className="max-h-64 overflow-y-auto whitespace-pre-wrap leading-6">
                      {r.transcript}
                    </p>
                  </details>
                )}
              </div>
            ))}
            {recording && !recording.transcript && !flow.contract ? (
              <details className="rounded-lg border p-3">
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
                  다른 상담 또는 새 버전 등록
                </summary>
                <p className="mb-3 text-sm text-muted-foreground">
                  보관한 음성에 전사문을 연결하려면 아래 ‘전사문 보완’을 이용해
                  주세요.
                </p>
                {transcriptForm}
              </details>
            ) : (
              transcriptForm
            )}
          </Panel>
          {recording && !recording.transcript && !flow.contract && (
            <Panel
              title="보관한 음성의 전사문 보완"
              description={`연결된 상담일: ${dateTime(flow.meetings.find((m) => m.id === recording.meetingId)?.startsAt)} · 기존 음성을 유지하며 전사문을 연결합니다.`}
            >
              <ConsultationTranscriptForm
                key={`supplement-${caseId}-${recording.id}`}
                recordingId={recording.id}
                meetings={flow.meetings}
                busy={busy}
                canUpload={canUpload}
                submit={submit}
                aiEnabled={flow.ai.enabled}
              />
            </Panel>
          )}
          <JobPanel
            clock={clock}
            flow={flow}
            admin={admin}
            busy={busy}
            submit={submit}
            resume={() => void resumeQueued()}
          />
        </>
      )}
      {section === 'solutions' && (
        <Panel
          title="김성민 대표의 진행솔루션 확정"
          description="4차 심화보고서를 검토한 뒤 필요한 컨설팅을 결정합니다. 재확정하면 5차·6차 문서는 새 결정에 맞춰 다시 준비합니다."
        >
          {flow.decision && (
            <Hint>
              확정 솔루션: {flow.decision.solutions.join(' · ')}
              <br />
              결정 메모: {flow.decision.note}
              <br />
              추가 필수 서류:{' '}
              {flow.decision.documentsNeeded
                ? '필요'
                : '추가 없음 (기존 요청은 별도 확인)'}
            </Hint>
          )}
          {admin && !flow.contract ? (
            <ActionForm
              busy={busy || !r4}
              label="진행솔루션 확정"
              onSubmit={(d) =>
                submit({
                  type: 'confirm_solutions',
                  reportId: r4?.id,
                  solutions: value(d, 'solutions')
                    .split(/[,\n]/)
                    .filter(Boolean),
                  documentsNeeded: value(d, 'documentsNeeded') === 'yes',
                  note: value(d, 'note'),
                  reviewConfirmed: d.has('reviewConfirmed'),
                })
              }
            >
              <Field label="진행솔루션 (줄바꿈 또는 쉼표로 구분)">
                <Textarea
                  name="solutions"
                  required
                  defaultValue={flow.decision?.solutions.join('\n')}
                  placeholder="정책자금 사전진단&#10;기업인증 준비"
                />
              </Field>
              <Field label="추가 필수 서류">
                <select
                  name="documentsNeeded"
                  className={control}
                  defaultValue="yes"
                >
                  <option value="yes">
                    필요함 — 요청·수령·검토 후 문서 준비
                  </option>
                  <option value="no">
                    추가 없음 — 사유를 결정 메모에 기록
                  </option>
                </select>
              </Field>
              <Field label="판단 근거 / 추가 서류가 없다면 그 이유">
                <Textarea name="note" required maxLength={2000} />
              </Field>
              <Confirm name="reviewConfirmed">
                최신 4차 보고서를 검토했고, 최종 컨설팅 방향을 결정했습니다.
              </Confirm>
            </ActionForm>
          ) : (
            <Hint>진행솔루션 확정은 김성민 대표가 담당합니다.</Hint>
          )}
        </Panel>
      )}
      {section === 'documents' && (
        <>
          <Panel
            title="추가서류 요청 · 수령 · 대표 검토"
            description="서류요청은 상담 횟수와 관계없이 반복 등록할 수 있습니다. 카톡·이메일은 문안을 복사해 발송한 후 실제 발송을 기록하세요."
          >
            {flow.requests.length === 0 && (
              <Hint>등록된 서류요청이 없습니다.</Hint>
            )}
            {flow.requests.map((r) => (
              <article key={r.id} className="space-y-3 rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>
                    {r.title} {r.required ? '(필수)' : '(선택)'}
                  </strong>
                  <span className="rounded-full bg-muted px-3 py-1 text-xs">
                    {
                      {
                        requested: '요청중',
                        received: '검토 대기',
                        verified: '검토 완료',
                        needs_fix: '보완 필요',
                      }[r.status]
                    }
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {r.recipient} · {r.channel} · 기한 {r.dueDate || '미지정'} ·{' '}
                  {r.sentAt ? '발송 기록 있음' : '발송 전'}
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          `안녕하세요. ${flow.company} 컨설팅 진행을 위해 ${r.title} 자료를 요청드립니다.${r.dueDate ? ` 제출 희망일은 ${r.dueDate}입니다.` : ''} 불필요한 개인정보는 마스킹해 담당 파트너에게 전달해 주세요. 감사합니다. 주식회사 한국기업가치평가원 김성민 대표`,
                        );
                        setNotice(
                          '요청 문안을 복사했습니다. 카톡·이메일에 붙여 넣어 직접 발송해 주세요.',
                        );
                      } catch {
                        setError(
                          '클립보드 접근이 제한되었습니다. 서류 제목과 기한을 확인해 직접 전달해 주세요.',
                        );
                      }
                    }}
                  >
                    카톡·이메일 문안 복사
                  </Button>
                  {!r.sentAt && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      className="min-h-11"
                      onClick={() => {
                        if (
                          window.confirm(
                            '카톡 또는 이메일로 실제 발송하셨나요?',
                          )
                        )
                          void submit({
                            type: 'mark_request_sent',
                            requestId: r.id,
                            sentConfirmed: true,
                          });
                      }}
                    >
                      실제 발송 완료
                    </Button>
                  )}
                  {r.fileId && download(r.fileId, '수령 서류 내려받기')}
                </div>
                {r.note && <Hint>{r.note}</Hint>}
                {!flow.contract && (
                  <details>
                    <summary className="cursor-pointer py-3 text-sm font-semibold">
                      {r.fileId ? '보완서류 등록 / 검토' : '수령서류 등록'}
                    </summary>
                    {canUpload && (
                      <ActionForm
                        busy={busy}
                        label="수령서류 저장"
                        onSubmit={(d) =>
                          submit(
                            {
                              type: 'receive_document',
                              requestId: r.id,
                              note: value(d, 'note'),
                              ...checks(d),
                            },
                            attached(d),
                          )
                        }
                      >
                        <Files
                          accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.txt"
                          required
                        />
                        <Field label="수령 메모">
                          <Input
                            name="note"
                            className="min-h-11"
                            maxLength={1000}
                          />
                        </Field>
                      </ActionForm>
                    )}
                    {admin && r.fileId && (
                      <div className="mt-5">
                        <ActionForm
                          busy={busy}
                          label="대표 검토 결과 저장"
                          onSubmit={(d) =>
                            submit({
                              type: 'review_document',
                              requestId: r.id,
                              approved: value(d, 'approved') === 'yes',
                              note: value(d, 'note'),
                            })
                          }
                        >
                          <Field label="검토 결과">
                            <select name="approved" className={control}>
                              <option value="yes">검토 완료</option>
                              <option value="no">보완 필요 (사유 필수)</option>
                            </select>
                          </Field>
                          <Field label="검토 의견 / 보완 사유">
                            <Textarea name="note" maxLength={1000} />
                          </Field>
                        </ActionForm>
                      </div>
                    )}
                  </details>
                )}
              </article>
            ))}
          </Panel>
          {admin && !flow.contract && (
            <Panel title="서류요청 추가">
              <ActionForm
                busy={busy}
                label="서류요청 등록 (아직 발송하지 않음)"
                onSubmit={(d) =>
                  submit({
                    type: 'request_document',
                    title: value(d, 'title'),
                    recipient: value(d, 'recipient'),
                    channel: value(d, 'channel'),
                    dueDate: value(d, 'dueDate'),
                    required: value(d, 'required') === 'yes',
                  })
                }
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="요청 서류">
                    <Input
                      className="min-h-11"
                      name="title"
                      required
                      maxLength={150}
                      placeholder="예: 최근 결산 재무제표"
                    />
                  </Field>
                  <Field label="수신 담당자 (이름·역할만)">
                    <Input
                      name="recipient"
                      className="min-h-11"
                      required
                      maxLength={100}
                      placeholder="기업대표 / 재무 담당자"
                    />
                  </Field>
                  <Field label="전달 경로">
                    <select name="channel" className={control}>
                      <option>카카오톡</option>
                      <option>이메일</option>
                      <option>기타</option>
                    </select>
                  </Field>
                  <Field label="희망 제출기한">
                    <Input name="dueDate" type="date" className="min-h-11" />
                  </Field>
                  <Field label="5차·6차 준비 전 필수 여부">
                    <select name="required" className={control}>
                      <option value="yes">필수 — 대표 검토 완료 필요</option>
                      <option value="no">선택</option>
                    </select>
                  </Field>
                </div>
              </ActionForm>
            </Panel>
          )}
        </>
      )}
      {section === 'contract' && (
        <>
          <Panel
            title="계약 체결 확인"
            description="계약상담 참석자가 실제 서명본과 약정 계약금을 등록합니다. 이 단계만으로 컨설팅이 시작되지는 않습니다."
          >
            {flow.contract ? (
              <>
                <Hint>
                  체결일 {flow.contract.signedAt} · 기록{' '}
                  {flow.contract.recordedBy}
                  <br />
                  약정 계약금{' '}
                  {flow.contract.expectedDepositWon.toLocaleString()}원
                </Hint>
                {download(flow.contract.signedFileId, '서명 계약서 내려받기')}
              </>
            ) : (
              <ActionForm
                busy={busy || !canUpload || !signingPreparationDone(flow)}
                label="실제 계약 체결 등록"
                onSubmit={(d) =>
                  submit(
                    {
                      type: 'record_contract',
                      meetingId: value(d, 'meetingId'),
                      signedAt: value(d, 'signedAt'),
                      expectedDepositWon: Number(
                        value(d, 'expectedDepositWon'),
                      ),
                      signedConfirmed: d.has('signedConfirmed'),
                      ...checks(d),
                    },
                    attached(d),
                  )
                }
              >
                <Field label="계약상담">
                  <select name="meetingId" className={control} required>
                    <option value="">참석한 계약상담 선택</option>
                    {contractMeetings
                      .filter((m) => admin || m.attendance !== 'admin')
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {dateTime(m.startsAt)} ·{' '}
                          {attendanceName(m.attendance)}
                        </option>
                      ))}
                  </select>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="실제 체결일">
                    <Input
                      name="signedAt"
                      type="date"
                      max={currentDate}
                      className="min-h-11"
                      required
                    />
                  </Field>
                  <Field label="약정 계약금 (원)">
                    <Input
                      name="expectedDepositWon"
                      type="number"
                      min={1}
                      max={1000000000000}
                      step={1}
                      className="min-h-11"
                      required
                    />
                  </Field>
                </div>
                <Files accept=".pdf,.png,.jpg,.jpeg" required />
                <Confirm name="signedConfirmed">
                  양 당사자의 실제 서명과 계약금 약정 내용을 확인했습니다.
                </Confirm>
              </ActionForm>
            )}
          </Panel>
          <Panel
            title="계약금 입금 확인 → 컨설팅 시작"
            description="입금 사실은 김성민 대표만 확인합니다. 약정 계약금보다 적게 들어오면 잔액 대기로 남습니다."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['약정 계약금', flow.contract?.expectedDepositWon ?? 0],
                ['확인된 입금', depositReceived(flow)],
                [
                  '잔여 계약금',
                  Math.max(
                    0,
                    (flow.contract?.expectedDepositWon ?? 0) -
                      depositReceived(flow),
                  ),
                ],
              ].map(([label, amount]) => (
                <div key={label} className="rounded-xl bg-muted/50 p-4">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-2 text-xl font-bold">
                    {Number(amount).toLocaleString()}원
                  </p>
                </div>
              ))}
            </div>
            {flow.payments.map((p) => (
              <p key={p.id} className="border-b py-3 text-sm">
                {p.receivedAt} · {p.amountWon.toLocaleString()}원 · 확인{' '}
                {p.confirmedBy}
                <br />
                <span className="text-muted-foreground">
                  증빙 메모: {p.reference}
                </span>
              </p>
            ))}
            {admin && flow.contract && !flow.executionStartedAt && (
              <ActionForm
                busy={busy}
                label="실제 입금 확인 저장"
                onSubmit={(d) =>
                  submit({
                    type: 'confirm_payment',
                    receivedAt: value(d, 'receivedAt'),
                    amountWon: Number(value(d, 'amountWon')),
                    reference: value(d, 'reference'),
                    paymentConfirmed: d.has('paymentConfirmed'),
                  })
                }
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="입금일">
                    <Input
                      name="receivedAt"
                      type="date"
                      max={currentDate}
                      className="min-h-11"
                      required
                    />
                  </Field>
                  <Field label="이번 입금액 (원)">
                    <Input
                      name="amountWon"
                      type="number"
                      min={1}
                      max={1000000000000}
                      step={1}
                      className="min-h-11"
                      required
                    />
                  </Field>
                </div>
                <Field label="증빙 확인 메모 (계좌번호 입력 금지)">
                  <Input
                    name="reference"
                    className="min-h-11"
                    required
                    maxLength={200}
                    placeholder="거래내역 확인 위치 또는 내부 참조번호"
                  />
                </Field>
                <Confirm name="paymentConfirmed">
                  실제 거래내역에서 이번 입금을 확인했으며, 이전에 등록한 입금과
                  중복되지 않습니다.
                </Confirm>
              </ActionForm>
            )}
            {flow.executionStartedAt && (
              <Hint>
                약정 계약금 확인 완료 · 컨설팅 시작{' '}
                {dateTime(flow.executionStartedAt)}
              </Hint>
            )}
          </Panel>
        </>
      )}
      {section === 'aftercare' && (
        <Panel
          title="컨설팅 수행 · 사후관리"
          description="계약금 확인 후 수행을 시작하고, 완료 결과와 후속 점검 계획을 남깁니다."
        >
          {flow.executionStartedAt ? (
            <Hint>
              수행 시작: {dateTime(flow.executionStartedAt)}
              <br />
              확정 솔루션: {flow.decision?.solutions.join(' · ')}
            </Hint>
          ) : (
            <Hint>실제 계약 체결과 약정 계약금 확인이 먼저 필요합니다.</Hint>
          )}
          {flow.aftercare && (
            <Hint>
              수행 결과: {flow.aftercare.summary}
              <br />
              다음 점검: {flow.aftercare.nextDate} · 담당 {flow.aftercare.owner}
            </Hint>
          )}
          {admin && flow.executionStartedAt && (
            <ActionForm
              busy={busy}
              label={
                flow.aftercare
                  ? '사후관리 점검 업데이트'
                  : '수행 결과 확인 · 사후관리 시작'
              }
              onSubmit={(d) =>
                submit({
                  type: 'start_aftercare',
                  summary: value(d, 'summary'),
                  nextDate: value(d, 'nextDate'),
                  owner: value(d, 'owner'),
                  deliveryConfirmed: d.has('deliveryConfirmed'),
                })
              }
            >
              <Field label="수행 결과 / 후속 관리 내용">
                <Textarea name="summary" required maxLength={3000} rows={5} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="다음 점검일">
                  <Input
                    name="nextDate"
                    type="date"
                    required
                    className="min-h-11"
                  />
                </Field>
                <Field label="관리 담당자">
                  <Input
                    name="owner"
                    required
                    maxLength={100}
                    defaultValue="김성민 대표"
                    className="min-h-11"
                  />
                </Field>
              </div>
              <Confirm name="deliveryConfirmed">
                컨설팅 수행 결과를 확인했습니다. 후속 관리 내용을 기록합니다.
              </Confirm>
            </ActionForm>
          )}
        </Panel>
      )}
      {section === 'history' && (
        <Panel
          title="누가 언제 처리했는지"
          description="변경 이력은 누적 보관됩니다. 저장 버전 충돌 시 최신 상태를 다시 확인하도록 안내합니다."
        >
          {!flow.audit.length && (
            <Hint>
              아직 변경 기록이 없습니다. 기존 진행 기록은 기존 상세 화면에
              보존되어 있습니다.
            </Hint>
          )}
          <ol className="divide-y">
            {[...flow.audit].reverse().map((event) => (
              <li key={event.id} className="space-y-1 py-4">
                <p className="text-sm font-semibold">{event.detail}</p>
                <p className="text-xs text-muted-foreground">
                  {event.actor} · {dateTime(event.at)}
                </p>
              </li>
            ))}
          </ol>
        </Panel>
      )}
      {section === 'ai' && admin && (
        <>
          <Panel
            title="기업별 AI 자동생성 설정"
            description="유료 외부 전송은 이 기업에 대해 명시적으로 허용해야 시작됩니다. 1차와 4차 초안만 자동 생성하며, 파트너 외 기업대표에게는 자동 발송하지 않습니다."
          >
            <Hint>
              Claude 연결:{' '}
              {readiness.aiConnected
                ? '키 연결됨 (실제 호출 결과는 별도 확인)'
                : '연결 필요'}{' '}
              · 모델 {readiness.model}
              <br />이 기업의 자동생성: {flow.ai.enabled ? '허용' : '중지'} ·
              음성 자동전사: 미연결
              <br />
              현재 진행 중인 API 호출은 중지 설정으로 과금이 취소되지 않을 수
              있습니다.
            </Hint>
            <ActionForm
              busy={busy}
              label="이 기업 자동생성 허용"
              onSubmit={(d) =>
                submit({
                  type: 'set_ai_policy',
                  enabled: true,
                  thirdPartyConsent: d.has('thirdPartyConsent'),
                  ...checks(d),
                })
              }
            >
              <Confirm name="thirdPartyConsent">
                이 기업 자료를 Claude API에 보내 분석할 수 있는 처리 권한을
                확인했습니다.
              </Confirm>
              <Confirm name="privacyMasked">
                전송할 모든 자료에서 불필요한 개인정보를 제거했습니다.
                PDF·이미지는 자동 마스킹되지 않습니다.
              </Confirm>
              <Confirm name="costConsent">
                1차·녹취별 4차 생성에 API 이용요금이 발생함을 확인했고 자동
                실행을 허용합니다.
              </Confirm>
            </ActionForm>
            {flow.ai.enabled && (
              <Button
                variant="outline"
                disabled={busy}
                className="min-h-11"
                onClick={() =>
                  void submit({ type: 'set_ai_policy', enabled: false })
                }
              >
                이 기업 AI 자동생성 중지
              </Button>
            )}
          </Panel>
          <Panel
            title="1차 분석용 근거자료"
            description="기존 협업신청 자료는 기업자료함에 유지됩니다. 외부 AI 전송에는 마스킹한 별도 사본을 등록하세요. PDF·JPG·PNG·TXT 합계 8MB / 8개까지 분석합니다. DOCX·XLSX는 저장만 지원합니다."
          >
            {flow.files
              .filter((f) => f.purpose === 'source')
              .map((f) => (
                <div
                  key={f.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 text-sm"
                >
                  <span>
                    {f.name} · {(f.size / 1024 / 1024).toFixed(2)}MB
                  </span>
                  <div className="flex flex-wrap gap-3">
                    {download(f.id)}
                    <Button
                      variant="ghost"
                      disabled={busy}
                      className="min-h-11"
                      onClick={() =>
                        void submit({ type: 'exclude_source', fileId: f.id })
                      }
                    >
                      AI 입력에서 제외
                    </Button>
                  </div>
                </div>
              ))}
            {flow.files.some((f) => f.purpose === 'source_archived') && (
              <details>
                <summary className="cursor-pointer py-3 text-sm">
                  AI 입력에서 제외된 원본 (보존됨)
                </summary>
                {flow.files
                  .filter((f) => f.purpose === 'source_archived')
                  .map((f) => (
                    <div
                      key={f.id}
                      className="flex flex-wrap items-center justify-between gap-3 border-t text-sm"
                    >
                      <span>{f.name}</span>
                      {download(f.id)}
                    </div>
                  ))}
              </details>
            )}
            <ActionForm
              busy={busy}
              label="근거자료 저장 (이 단계는 AI 미전송)"
              onSubmit={(d) =>
                submit(
                  {
                    type: 'save_source',
                    sourceText: value(d, 'sourceText'),
                    ...checks(d),
                  },
                  attached(d),
                )
              }
            >
              <Field label="마스킹한 기업 근거자료 요약 (저장 시 기존 요약을 대체)">
                <Textarea
                  name="sourceText"
                  defaultValue={flow.ai.sourceText}
                  rows={6}
                  maxLength={40000}
                />
              </Field>
              <Files accept=".pdf,.jpg,.jpeg,.png,.txt" />
              <Confirm name="privacyMasked">
                AI 분석에 사용할 사본이며, 불필요한 개인정보를 제거했습니다.
              </Confirm>
            </ActionForm>
            <Button
              className="min-h-11"
              disabled={
                busy ||
                !flow.ai.enabled ||
                !readiness.aiConnected ||
                Boolean(first?.completedAt)
              }
              onClick={() => {
                if (
                  window.confirm(
                    '등록한 근거자료를 Claude로 전송하여 1차 초안을 생성할까요? API 이용요금이 발생합니다.',
                  )
                )
                  void submit({ type: 'queue_report1' });
              }}
            >
              등록 자료로 1차 보고서 생성
            </Button>
          </Panel>
          <JobPanel
            clock={clock}
            flow={flow}
            admin
            busy={busy}
            submit={submit}
            resume={() => void resumeQueued()}
          />
        </>
      )}
      <p className="flex items-center gap-2 text-xs leading-5 text-muted-foreground">
        <LockKeyhole className="size-3 shrink-0" />
        담당 파트너와 대표만 조회 · 최종 저장{' '}
        {flow.updatedAt ? dateTime(flow.updatedAt) : '기록 없음'} · 새로고침으로
        상대방의 최신 작업을 확인하세요.
      </p>
    </div>
  );
}

function JobPanel({
  clock,
  flow,
  admin,
  busy,
  submit,
  resume,
}: {
  clock: number;
  flow: ConsultingFlow;
  admin: boolean;
  busy: boolean;
  submit: Submit;
  resume: () => void;
}) {
  return (
    <Panel
      title="보고서 자동생성 상태"
      description="실패·중단은 자동 재시도하지 않습니다. 대표님이 처리·과금 상태를 확인한 후 재시도할 수 있습니다."
    >
      {flow.jobs.length === 0 && (
        <Hint>
          생성 요청이 없습니다. 수동으로 완성한 보고서를 등록할 수도 있습니다.
        </Hint>
      )}
      {[...flow.jobs].reverse().map((j) => (
        <div key={j.id} className="rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <strong className="text-sm">{reportLabels[j.stage]}</strong>
            <span className="text-xs">
              {
                {
                  queued: '생성 대기',
                  processing: '생성 중',
                  blocked: '보완 대기',
                  failed: '실패',
                  complete: '저장·공유 완료',
                }[j.status]
              }
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {dateTime(j.createdAt)}
          </p>
          {j.reason && <p className="mt-2 text-sm leading-6">{j.reason}</p>}
          {j.status === 'queued' && (
            <Button
              variant="outline"
              disabled={busy}
              className="mt-3 min-h-11"
              onClick={resume}
            >
              승인된 대기 작업 계속
            </Button>
          )}
          {admin &&
            (['failed', 'blocked'].includes(j.status) ||
              (j.status === 'processing' &&
                clock - Date.parse(j.startedAt || '') > 180000)) && (
              <Button
                variant="outline"
                disabled={busy || !flow.ai.enabled}
                className="mt-3 min-h-11"
                onClick={() => {
                  if (
                    window.confirm(
                      '기존 요청의 처리·과금 상태를 확인하셨나요? 다시 실행하면 추가 요금이 발생할 수 있습니다.',
                    )
                  )
                    void submit({
                      type: 'retry_job',
                      jobId: j.id,
                      costConsent: true,
                    });
                }}
              >
                비용 확인 후 재시도
              </Button>
            )}
        </div>
      ))}
    </Panel>
  );
}
