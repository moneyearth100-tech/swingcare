import { type NextRequest, NextResponse } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 로그인 화면은 세션 갱신 생략 → 첫 페인트 빠르게
  if (pathname === '/coach/login') {
    return NextResponse.next({ request });
  }

  try {
    return await updateSession(request);
  } catch (error) {
    console.error('[middleware] unhandled', error);
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: ['/', '/coach/:path*'],
};
