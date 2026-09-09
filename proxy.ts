import { NextResponse } from 'next/server';

import { applyBrowserSecurityHeaders } from '@/lib/browser-security-headers';
import { migrationPreviewOnly } from '@/lib/platform-auth-capabilities';
import { serverRequestGate } from '@/lib/platform-server-gate';

export function proxy(request: Request) {
  const pathname = new URL(request.url).pathname;
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    const rejected = serverRequestGate(request);
    if (rejected) return rejected;
    // The standalone preview must not access production data or run AI jobs.
    // This is a temporary deployment gate, not a replacement for route auth.
    if (!migrationPreviewOnly) return NextResponse.next();
    return NextResponse.json(
      {
        code: 'MIGRATION_BACKEND_NOT_CONFIGURED',
        error:
          'Next.js 이전 준비 중입니다. DB·파일 저장소·독립 인증 연결 전에는 업무 API를 사용할 수 없습니다. 기존 운영 사이트를 이용해 주세요.',
      },
      {
        status: 503,
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
          'X-Content-Type-Options': 'nosniff',
        },
      },
    );
  }
  const response = NextResponse.next();
  applyBrowserSecurityHeaders(response.headers);
  return response;
}

export const config = {
  matcher: ['/', '/account/:path*', '/api/:path*'],
};
