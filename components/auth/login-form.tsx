'use client';

import { FormEvent, useState } from 'react';
import { Eye, EyeOff, Loader2, LockKeyhole, Mail, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/browser';
import { api } from '@/lib/api';

export function LoginForm() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'register' && password !== confirmPassword) return toast.error('两次输入的密码不一致');
    setLoading(true);
    const supabase = createClient();
    try {
    if (mode === 'register') {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`, data: { role: 'customer' } } });
      if (error) toast.error(error.message);
      else if (data.session) { const { home } = await api<{ home: string }>('/api/auth/me'); toast.success('注册成功，已作为普通顾客登录'); window.location.assign(home); }
      else { toast.success('注册成功，请查收验证邮件后登录'); setMode('login'); setConfirmPassword(''); }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) toast.error(error.message);
      else { const { home } = await api<{ home: string }>('/api/auth/me'); await fetch('/api/logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action_type: 'login', target_type: 'session', description: '用户登录' }) }).catch(() => undefined); toast.success('登录成功'); window.location.assign(home); }
    }
    } catch (error) {
      await supabase.auth.signOut();
      toast.error(error instanceof Error ? error.message : '登录失败，请重试');
    } finally { setLoading(false); }
  }

  async function forgot() { if (!email) return toast.error('请先填写邮箱'); const { error } = await createClient().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/login` }); if (error) toast.error(error.message); else toast.success('重置链接已发送'); }

  return <div className="card overflow-hidden"><form onSubmit={submit} className="space-y-5 p-6"><div><label className="label">邮箱</label><div className="relative"><Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input className="input pl-9" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required /></div></div><div><label className="label">密码</label><div className="relative"><LockKeyhole className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input className="input pl-9 pr-10" type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="至少 6 位密码" minLength={6} required /><button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-2.5 text-slate-400" aria-label={show ? '隐藏密码' : '显示密码'}>{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></div>{mode === 'register' && <div><label className="label">确认密码</label><div className="relative"><LockKeyhole className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input className="input pl-9" type={show ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="再次输入密码" minLength={6} required /></div></div>}{mode === 'login' ? <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><label className="flex items-center gap-2 text-slate-500"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="rounded border-slate-300 text-brand-600" />记住登录状态</label><div className="flex items-center gap-3"><button type="button" onClick={() => setMode('register')} className="font-semibold text-brand-600 hover:text-brand-700">注册账号</button><span className="text-slate-300">|</span><button type="button" onClick={forgot} className="font-semibold text-brand-600 hover:text-brand-700">忘记密码？</button></div></div> : <div className="flex justify-end text-sm"><button type="button" onClick={() => { setMode('login'); setConfirmPassword(''); }} className="font-semibold text-brand-600 hover:text-brand-700">返回登录</button></div>}<button className="btn-primary h-11 w-full" disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'register' ? <UserPlus className="h-4 w-4" /> : null}{mode === 'register' ? '注册普通顾客' : '登录'}</button></form></div>;
}
