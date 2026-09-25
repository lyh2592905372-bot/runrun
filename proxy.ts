import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => request.cookies.getAll(), setAll: (items: { name: string; value: string; options: CookieOptions }[]) => {
      items.forEach(({ name, value }) => request.cookies.set(name, value));
      response = NextResponse.next({ request });
      items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    } }
  });
  const { data: { user } } = await supabase.auth.getUser();
  const isAuthPage = request.nextUrl.pathname === '/login';
  const isAuthCallback = request.nextUrl.pathname === '/auth/callback';
  const isCronRoute = request.nextUrl.pathname === '/api/cron/backup';
  const isSportCronRoute = request.nextUrl.pathname === '/api/cron/sport-world';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.url;
  const redirectTo = (path: string) => {
    const redirect = NextResponse.redirect(new URL(path, appUrl));
    response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
    return redirect;
  };
  if (!user && !isAuthPage && !isAuthCallback && !isCronRoute && !isSportCronRoute) {
    if (request.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error: '未登录' }, { status: 401 });
    return redirectTo('/login');
  }
  // API handlers perform their own authoritative checks. Page checks choose the workspace.
  if (user && !request.nextUrl.pathname.startsWith('/api/') && !isAuthCallback) {
    const { data: profile } = await supabase.from('profiles').select('role,is_active').eq('id', user.id).maybeSingle();
    if (!profile?.is_active || !['admin', 'user', 'customer'].includes(profile.role)) {
      return isAuthPage ? response : redirectTo('/login?error=access');
    }
    const admin = profile.role === 'admin';
    const path = request.nextUrl.pathname;
    const isAdminPath = path === '/admin' || path.startsWith('/admin/');
    if (isAuthPage || path === '/') return redirectTo(admin ? '/admin' : '/accounts');
    if (!admin && (isAdminPath || ['/settings', '/backups'].some(p => path === p || path.startsWith(`${p}/`)))) return redirectTo('/accounts');
  }
  return response;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'] };
