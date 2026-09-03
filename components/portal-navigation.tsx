'use client';

import type { LucideIcon } from 'lucide-react';

export function PortalNavigationButton({
  active,
  icon: Icon,
  label,
  onSelect,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onSelect}
      className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-300/40 ${active ? 'bg-white text-[#15375b]' : 'text-blue-50 hover:bg-white/10'}`}
    >
      <Icon className="size-[18px]" aria-hidden="true" /> {label}
    </button>
  );
}
