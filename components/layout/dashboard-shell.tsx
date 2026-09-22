'use client';

import { useState } from 'react';
import { BarChart3, BookOpen, ChevronDown, ClipboardList, DatabaseBackup, LayoutDashboard, Menu, Settings, ShieldCheck, Users, X, LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const nav = [
  { href: '/dashboard', label: '首页', icon: LayoutDashboard },
  { href: '/accounts', label: '账号管理', icon: Users },
  { href: '/progress', label: '进度管理', icon: BarChart3 },
  { href: '/logs', label: '操作记录', icon: ClipboardList },
  { href: '/backups', label: '数据与备份', icon: DatabaseBackup },
  { href: '/settings', label: '设置', icon: Settings }
];

export function DashboardShell({ children, user }: { children: React.ReactNode; user: { email: string; role: string } }) {
  const [open, setOpen] = useState(false); const [profileOpen, setProfileOpen] = useState(false); const pathname = usePathname(); const router = useRouter();
  async function logout() { await createClient().auth.signOut(); toast.success('已退出登录'); router.push('/login'); router.refresh(); }
  return <div className="min-h-screen bg-canvas"><aside className={cn('fixed inset-y-0 left-0 z-40 w-64 border-r border-slate-200 bg-white px-4 py-5 transition-transform lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}><div className="flex items-center justify-between px-2"><Link href="/dashboard" className="flex items-center gap-3"><img src="/snowflake-sports-avatar.png" alt="雪花运动" className="h-10 w-10 rounded-xl object-cover" /><div><div className="font-bold tracking-tight">雪花运动</div><div className="text-[10px] tracking-wide text-slate-400">科技服务于人民</div></div></Link><button className="lg:hidden" onClick={() => setOpen(false)}><X className="h-5 w-5 text-slate-500" /></button></div><nav className="mt-10 space-y-1">{nav.map(item => { const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href)); const Icon = item.icon; return <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={cn('flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition', active ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800')}><Icon className="h-[18px] w-[18px]" />{item.label}</Link>; })}</nav><div className="absolute bottom-5 left-4 right-4 rounded-xl bg-slate-50 p-3"><div className="flex items-center gap-2 text-xs font-semibold text-slate-600"><ShieldCheck className="h-4 w-4 text-emerald-500" />数据安全已启用</div><p className="mt-1 text-[11px] leading-4 text-slate-400">Supabase RLS 保护每一条记录</p></div></aside><div className="lg:pl-64"><header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6"><button className="rounded-lg p-2 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button><div className="hidden text-sm text-slate-400 sm:block">工作区 / <span className="text-slate-700">{nav.find(n => pathname.startsWith(n.href))?.label || '首页'}</span></div><div className="relative ml-auto"><button onClick={() => setProfileOpen(!profileOpen)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"><img src="/snowflake-sports-avatar.png" alt="用户头像" className="h-8 w-8 rounded-full object-cover" /><div className="hidden text-left sm:block"><div className="max-w-[180px] truncate text-xs font-semibold text-slate-700">{user.email}</div><div className="text-[11px] text-slate-400">{user.role === 'admin' ? '管理员' : '普通顾客'}</div></div><ChevronDown className="h-4 w-4 text-slate-400" /></button>{profileOpen && <div className="absolute right-0 top-12 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-soft"><button onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"><LogOut className="h-4 w-4" />退出登录</button></div>}</div></header><main className="mx-auto max-w-[1600px] p-4 sm:p-6">{children}</main></div></div>;
}
