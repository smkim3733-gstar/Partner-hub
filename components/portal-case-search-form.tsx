'use client';

import { Search } from 'lucide-react';
import type React from 'react';

type PortalCaseSearchItem = {
  id: string;
  company: string;
  service: string;
};

export function PortalCaseSearchForm({
  className = '',
  inputId,
  items,
  value,
  onChange,
  onSubmit,
}: {
  className?: string;
  inputId: string;
  items: PortalCaseSearchItem[];
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: React.SyntheticEvent<HTMLFormElement>) => void;
}) {
  const optionsId = `${inputId}-options`;
  return (
    <search className={className}>
      <form onSubmit={onSubmit} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 text-slate-500 focus-within:border-sky-400 focus-within:ring-4 focus-within:ring-sky-100">
        <button type="submit" className="grid size-10 shrink-0 place-items-center rounded-lg hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400" aria-label="기업 진행 검색">
          <Search className="size-4" aria-hidden="true" />
        </button>
        <input
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          list={optionsId}
          aria-label="기업명 또는 신청번호 검색"
          className="h-10 min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
          placeholder="기업명 또는 신청번호 검색"
          autoComplete="off"
        />
        <datalist id={optionsId}>
          {items.map((item) => <option key={item.id} value={item.id}>{item.company} · {item.service}</option>)}
        </datalist>
      </form>
    </search>
  );
}
