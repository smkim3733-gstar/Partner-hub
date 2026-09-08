'use client';

import { Component, Suspense, type ReactNode } from 'react';

type DeferredPanelProps = {
  children: ReactNode;
  label: string;
};

class DeferredPanelErrorBoundary extends Component<
  DeferredPanelProps,
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950"
      >
        <p className="font-bold">
          {this.props.label} 화면을 불러오지 못했습니다.
        </p>
        <p className="mt-1">
          배포 중 열린 탭일 수 있습니다. 현재 탭은 닫지 말고 새 탭에서 최신
          화면을 확인하세요.
        </p>
        <a
          className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-amber-300 bg-white px-4 font-bold hover:bg-amber-100"
          href="/"
          target="_blank"
          rel="noopener noreferrer"
        >
          새 탭에서 최신 화면 열기
        </a>
      </div>
    );
  }
}

export function DeferredPanel({ children, label }: DeferredPanelProps) {
  return (
    <DeferredPanelErrorBoundary label={label}>
      <Suspense
        fallback={
          <output className="block rounded-2xl border bg-white p-5 text-sm">
            {label} 화면을 안전하게 불러오는 중입니다.
          </output>
        }
      >
        {children}
      </Suspense>
    </DeferredPanelErrorBoundary>
  );
}
