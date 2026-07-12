import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  // Vercel에 env 미설정 시 createServerClient 가 throw → MIDDLEWARE_INVOCATION_FAILED
  // Expo 모노레포와 공유하는 EXPO_PUBLIC_* 도 허용
  const url = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.EXPO_PUBLIC_SUPABASE_URL ??
    ''
  ).trim();
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    ''
  ).trim();

  if (!url || !key) {
    console.error(
      '[middleware] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY',
    );
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options?: Parameters<
              NextResponse['cookies']['set']
            >[2];
          }[],
        ) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    });

    await supabase.auth.getUser();
  } catch (error) {
    console.error('[middleware] supabase session refresh failed', error);
    return NextResponse.next({ request });
  }

  return supabaseResponse;
}
