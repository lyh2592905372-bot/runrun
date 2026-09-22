import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => request.cookies.getAll(), setAll: (items: { name: string; value: string; options: CookieOptions }[]) => items.forEach(({ name, value, options }) => response.cookies.set(name, value, options)) }
  });
  const { data: { user } } = await supabase.auth.getUser();
  const isAuthPage = request.nextUrl.pathname.startsWith('/login');
  const isAuthCallback = request.nextUrl.pathname === '/auth/callback';
  const isCronRoute = request.nextUrl.pathname === '/api/cron/backup';
  const isSportCronRoute = request.nextUrl.pathname === '/api/cron/sport-world';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.url;
  if (!user && !isAuthPage && !isAuthCallback && !isCronRoute && !isSportCronRoute) {
    if (request.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error: '未登录' }, { status: 401 });
    return NextResponse.redirect(new URL('/login', appUrl));
  }
  if (user && isAuthPage) return NextResponse.redirect(new URL('/dashboard', appUrl));
  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'] };
