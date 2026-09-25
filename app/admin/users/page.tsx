'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/page-header';
import { formatDate } from '@/lib/utils';

type User = { id: string; email: string; display_name: string; role: 'user' | 'customer' | 'admin'; is_active: boolean; created_at: string };
type Result = { users: User[]; total: number; currentUserId: string };
const emptyForm = { display_name: '', email: '', password: '', role: 'customer' };

export default function UsersPage() {
  const [data, setData] = useState<Result>({ users: [], total: 0, currentUserId: '' });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<User | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await api<Result>(`/api/admin/users?page=${page}&search=${encodeURIComponent(filter)}`)); }
    catch (e) { setError(e instanceof Error ? e.message : '加载失败'); }
    finally { setLoading(false); }
  }, [page, filter]);
  useEffect(() => { void load(); }, [load]);
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try { await api('/api/admin/users', { method: 'POST', body: JSON.stringify(form) }); toast.success('用户已创建'); setForm(emptyForm); setCreating(false); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : '创建失败'); await load(); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!editing) return; setBusy(true);
    try {
      await api(`/api/admin/users/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ display_name: editing.display_name, role: editing.role, is_active: editing.is_active }) });
      toast.success('用户已更新'); setEditing(null); await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : '更新失败'); }
    finally { setBusy(false); }
  }
  return <><PageHeader title="用户管理" description="创建用户、分配角色和管理访问状态；停用用户后保留业务数据" />
    <div className="mb-4 flex flex-wrap gap-3"><form className="flex flex-1 gap-2" onSubmit={e => { e.preventDefault(); setPage(1); setFilter(search); }}><input aria-label="搜索用户邮箱" className="input max-w-sm" placeholder="搜索用户邮箱" value={search} onChange={e => setSearch(e.target.value)} /><button className="btn-secondary">搜索</button></form><button className="btn-primary" onClick={() => setCreating(v => !v)}>{creating ? '收起' : '新增用户'}</button></div>
    {creating && <form onSubmit={create} className="card mb-5 grid gap-4 p-5 sm:grid-cols-2"><label className="label">姓名<input required maxLength={80} className="input mt-2" value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} /></label><label className="label">邮箱<input required type="email" className="input mt-2" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label><label className="label">初始密码<input required type="password" autoComplete="new-password" minLength={8} maxLength={128} className="input mt-2" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label><label className="label">角色<select className="input mt-2" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}><option value="customer">普通客户</option><option value="admin">管理员</option></select></label><div><button disabled={busy} className="btn-primary">{busy ? '正在创建…' : '创建用户'}</button></div></form>}
    {error ? <div role="alert" className="card p-6 text-rose-600">{error}<button className="btn-secondary ml-3" onClick={load}>重试</button></div> : <div className="card overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{['用户', '角色', '状态', '创建时间', '操作'].map(t => <th key={t} className="whitespace-nowrap p-4 font-medium">{t}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={5} className="p-12 text-center text-slate-400">加载中…</td></tr> : data.users.length ? data.users.map(u => <tr key={u.id} className="border-t border-slate-100"><td className="p-4"><div className="font-medium">{u.display_name || '未命名'}</div><div className="mt-1 text-xs text-slate-400">{u.email}</div></td><td className="whitespace-nowrap p-4">{u.role === 'admin' ? '管理员' : '普通客户'}</td><td className="p-4"><span className={u.is_active ? 'text-emerald-600' : 'text-slate-400'}>{u.is_active ? '启用' : '停用'}</span></td><td className="whitespace-nowrap p-4 text-slate-500">{formatDate(u.created_at)}</td><td className="p-4"><button className="btn-secondary whitespace-nowrap" onClick={() => setEditing({ ...u })}>编辑</button></td></tr>) : <tr><td colSpan={5} className="p-12 text-center text-slate-400">暂无用户</td></tr>}</tbody></table></div>}
    <div className="mt-4 flex items-center justify-between text-sm text-slate-500"><span>共 {data.total} 位用户 · 第 {page} 页</span><div className="flex gap-2"><button className="btn-secondary" disabled={loading || page === 1} onClick={() => setPage(p => p - 1)}>上一页</button><button className="btn-secondary" disabled={loading || page * 25 >= data.total} onClick={() => setPage(p => p + 1)}>下一页</button></div></div>
    {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"><form role="dialog" aria-modal="true" aria-labelledby="edit-user-title" onSubmit={save} className="card w-full max-w-md space-y-4 p-6"><h2 id="edit-user-title" className="text-lg font-bold">编辑用户</h2><p className="break-all text-sm text-slate-500">{editing.email}</p><label className="label block">姓名<input required maxLength={80} className="input mt-2" value={editing.display_name || ''} onChange={e => setEditing({ ...editing, display_name: e.target.value })} /></label><label className="label block">角色<select disabled={editing.id === data.currentUserId} className="input mt-2" value={editing.role === 'user' ? 'customer' : editing.role} onChange={e => setEditing({ ...editing, role: e.target.value as User['role'] })}><option value="customer">普通客户</option><option value="admin">管理员</option></select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.is_active} disabled={editing.id === data.currentUserId} onChange={e => setEditing({ ...editing, is_active: e.target.checked })} />允许该用户登录并访问数据</label>{editing.id === data.currentUserId && <p className="text-xs text-slate-400">当前管理员不能禁用或降级自己。</p>}<div className="flex justify-end gap-2"><button type="button" disabled={busy} className="btn-secondary" onClick={() => setEditing(null)}>取消</button><button disabled={busy} className="btn-primary">{busy ? '保存中…' : '保存'}</button></div></form></div>}
  </>;
}
