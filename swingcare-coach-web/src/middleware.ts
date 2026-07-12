import { type NextRequest, NextResponse } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  try {
    return await updateSession(request);
  } catch (error) {
    console.error('[middleware] unhandled', error);
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: [
    /*
     * 정적 자산·이미지 제외. 코치 앱 전 경로에서 세션 쿠키 갱신.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
