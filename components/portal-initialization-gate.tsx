'use client';

import { Database, FlaskConical, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function PortalInitializationGate({
  busy,
  onChoose,
}: {
  busy: boolean;
  onChoose: (mode: 'empty' | 'sample') => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-4 sm:p-6">
      <Card className="w-full max-w-3xl border-slate-200 shadow-xl">
        <CardHeader className="border-b border-slate-100">
          <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-sky-50 text-[#0877b8]">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </div>
          <CardTitle className="text-2xl text-[#15375b]">운영 데이터 기준선 선택</CardTitle>
          <CardDescription className="leading-6">
            저장된 운영 데이터가 없습니다. 대표가 시작 방식을 선택하기 전에는
            가상 예시나 빈 상태를 자동 저장하지 않습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
          <section className="flex flex-col rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
            <Database className="size-6 text-emerald-700" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-bold text-slate-900">빈 운영 데이터로 시작</h2>
            <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">
              진행, 자료, 일정, 업무, 파트너 명단을 비운 상태로 시작합니다. 실제
              파일럿 기준선이 필요할 때 선택하세요.
            </p>
            <Button
              type="button"
              className="mt-5 min-h-11"
              disabled={busy}
              onClick={() => onChoose('empty')}
            >
              빈 운영 데이터 선택
            </Button>
          </section>
          <section className="flex flex-col rounded-2xl border border-sky-200 bg-sky-50/60 p-5">
            <FlaskConical className="size-6 text-[#0877b8]" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-bold text-slate-900">가상 예시 데이터로 시작</h2>
            <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">
              화면과 흐름을 연습할 수 있는 가상 진행·자료·파트너를 저장합니다.
              대표 지표에서는 가상 레코드를 별도로 구분합니다.
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-5 min-h-11 bg-white"
              disabled={busy}
              onClick={() => onChoose('sample')}
            >
              가상 예시 데이터 선택
            </Button>
          </section>
          <p className="md:col-span-2 text-xs leading-5 text-amber-800">
            선택 후 데이터 삭제·보관 정책은 자동으로 바뀌지 않습니다. 운영을
            시작한 뒤 기준선을 변경하려면 저장 데이터 영향 검토가 필요합니다.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
