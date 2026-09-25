'use client';

import { useEffect, useState } from 'react';
import { BarChart3, ChevronDown, History, House, Menu, RefreshCw, Settings, Users, X, LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';
import { ACCOUNT_PLATFORMS } from '@/lib/account-platforms';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { UserRole } from '@/lib/server-auth';

const customerNav = [
  { href: '/accounts', label: '账号管理', icon: Users },
  { href: '/progress', label: '进度管理', icon: BarChart3 },
  { href: '/sync', label: '同步管理', icon: RefreshCw },
];
const adminNav = [
  { href: '/dashboard', label: '首页', icon: House },
  ...customerNav,
  { href: '/admin/stats', label: '数据统计', icon: BarChart3 },
  { href: '/admin/logs', label: '操作日志', icon: History },
  { href: '/admin/users', label: '用户管理', icon: Users },
  { href: '/admin/settings', label: '系统设置', icon: Settings },
];

function SidebarNavigation({ pathname, role, onNavigate }: { pathname: string; role: UserRole; onNavigate: () => void }) {
  const [accountsOpen, setAccountsOpen] = useState(pathname.startsWith('/accounts'));
  useEffect(() => { if (pathname.startsWith('/accounts')) setAccountsOpen(true); }, [pathname]);
  return <nav className="mt-10 space-y-1" aria-label={role === 'admin' ? '管理员菜单' : '客户菜单'}>
    {(role === 'admin' ? adminNav : customerNav).map(item => {
      const active = pathname.startsWith(item.href) || (item.href === '/admin/settings' && pathname === '/admin/backups');
      const Icon = item.icon;
      const style = cn('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition', active ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800');
      if (item.href !== '/accounts') return <Link key={item.href} href={item.href} onClick={onNavigate} className={style}><Icon className="h-[18px] w-[18px]" />{item.label}</Link>;
      return <div key={item.href}><button type="button" aria-expanded={accountsOpen} onClick={() => setAccountsOpen(v => !v)} className={style}><Icon className="h-[18px] w-[18px]" /><span className="flex-1 text-left">{item.label}</span><ChevronDown className={cn('h-4 w-4 transition-transform', accountsOpen && 'rotate-180')} /></button>
        {accountsOpen && <div className="space-y-1 pl-7">{ACCOUNT_PLATFORMS.map(platform => {
          const href = `/accounts/${platform.slug}`;
          return <Link key={href} href={href} onClick={onNavigate} className={cn('block rounded-lg px-3 py-2 text-sm transition', pathname === href || (pathname === '/accounts' && platform.slug === 'sport-world') ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50')}>{platform.name}</Link>;
        })}</div>}
      </div>;
    })}
  </nav>;
}

export function DashboardShell({ children, user }: { children: React.ReactNode; user: { email: string; role: UserRole } }) {
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const admin = user.role === 'admin';
  const label = (admin ? adminNav : customerNav).find(n => pathname.startsWith(n.href))?.label || (admin ? '系统设置' : '工作区');
  async function logout() {
    const { error } = await createClient().auth.signOut();
    if (error) return toast.error('退出失败，请重试');
    toast.success('已退出登录'); router.push('/login'); router.refresh();
  }
  return <div className="min-h-screen bg-canvas">
    {open && <button aria-label="关闭菜单遮罩" onClick={() => setOpen(false)} className="fixed inset-0 z-30 bg-black/20 lg:hidden" />}
    <aside className={cn('fixed inset-y-0 left-0 z-40 w-64 max-w-full overflow-y-auto border-r border-slate-200 bg-white px-4 py-5 transition-transform lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
      <div className="flex items-center justify-between px-2"><Link href={admin ? '/admin' : '/accounts'} className="flex items-center gap-3"><img src="/snowflake-sports-avatar.png" alt="雪花运动" className="h-10 w-10 rounded-xl object-cover" /><div><div className="font-bold tracking-tight">雪花运动</div><div className="text-[10px] tracking-wide text-slate-400">{admin ? '管理员后台' : '科技服务于人民'}</div></div></Link><button aria-label="关闭菜单" className="lg:hidden" onClick={() => setOpen(false)}><X className="h-5 w-5 text-slate-500" /></button></div>
      <SidebarNavigation pathname={pathname} role={user.role} onNavigate={() => setOpen(false)} />
    </aside>
    <div className="lg:pl-64"><header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6"><button aria-label="打开菜单" className="rounded-lg p-2 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button><div className="hidden text-sm text-slate-400 sm:block">{admin ? '管理后台' : '工作区'} / <span className="text-slate-700">{label}</span></div><div className="relative ml-auto"><button aria-expanded={profileOpen} onClick={() => setProfileOpen(!profileOpen)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"><img src="/snowflake-sports-avatar.png" alt="用户头像" className="h-8 w-8 rounded-full object-cover" /><div className="hidden text-left sm:block"><div className="max-w-[180px] truncate text-xs font-semibold text-slate-700">{user.email}</div><div className="text-[11px] text-slate-400">{admin ? '管理员' : '普通客户'}</div></div><ChevronDown className="h-4 w-4 text-slate-400" /></button>{profileOpen && <div className="absolute right-0 top-12 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-soft"><button onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"><LogOut className="h-4 w-4" />退出登录</button></div>}</div></header><main className="mx-auto max-w-[1600px] p-4 sm:p-6">{children}</main></div>
  </div>;
}
