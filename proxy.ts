import { NextResponse } from 'next/server';

import { applyBrowserSecurityHeaders } from '@/lib/browser-security-headers';

export function proxy() {
  const response = NextResponse.next();
  applyBrowserSecurityHeaders(response.headers);
  return response;
}

export const config = {
  matcher: ['/', '/account/:path*'],
};
