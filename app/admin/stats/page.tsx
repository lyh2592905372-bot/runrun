'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/page-header';
import { formatDate } from '@/lib/utils';

type AccountRow = { id: string; username: string; user_id: string; owner: { email: string; display_name: string } | null; category: { name: string } | null; school: { name: string } | null; order_count: number; order_time: string; order_progress: { finalCompletedCount: number } };
type Result = { stats: { users: number; activeUsers: number; accounts: number; syncs: number; records: number }; accounts: AccountRow[]; total: number };
export default function StatsPage() {
  const [data, setData] = useState<Result | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await api<Result>(`/api/admin/stats?page=${page}&username=${encodeURIComponent(filter)}&email=${encodeURIComponent(filter)}`)); }
    catch (e) { setError(e instanceof Error ? e.message : '读取失败'); }
    finally { setLoading(false); }
  }, [page, filter]);
  useEffect(() => { void load(); }, [load]);
  return <><PageHeader title="数据统计" description="查看全系统用户、业务账号、订单进度和同步数据" />
    <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-5">{[['用户总数', data?.stats.users], ['启用用户', data?.stats.activeUsers], ['业务账号', data?.stats.accounts], ['同步记录', data?.stats.syncs], ['跑步记录', data?.stats.records]].map(([label, value]) => <div key={label} className="card p-5"><div className="text-xs text-slate-500">{label}</div><div className="mt-3 text-2xl font-bold">{value ?? '—'}</div></div>)}</div>
    <form onSubmit={e => { e.preventDefault(); setPage(1); setFilter(search.trim()); }} className="mb-4 flex flex-wrap gap-2"><input className="input max-w-sm" aria-label="按用户名或邮箱筛选" placeholder="按用户名或邮箱筛选，留空查看全部" maxLength={254} value={search} onChange={e => setSearch(e.target.value)} /><button className="btn-secondary">查询</button><button type="button" className="btn-secondary" onClick={load}>刷新</button></form>
    {error && <p role="alert" className="mb-4 text-sm text-rose-600">{error}</p>}
    <div className="card overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{['所属用户', '业务账号', '平台 / 学校', '订单进度', '下单时间'].map(label => <th key={label} className="whitespace-nowrap p-4 font-medium">{label}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={5} className="p-12 text-center text-slate-400">加载中…</td></tr> : (data?.accounts.length ? data.accounts.map(a => <tr key={a.id} className="border-t border-slate-100"><td className="p-4"><p>{a.owner?.email || '—'}</p></td><td className="p-4 font-medium">{a.username}</td><td className="p-4"><p>{a.category?.name || '—'}</p><p className="text-xs text-slate-400">{a.school?.name || '—'}</p></td><td className="whitespace-nowrap p-4">{a.order_progress.finalCompletedCount} / {a.order_count} 次</td><td className="whitespace-nowrap p-4 text-slate-500">{formatDate(a.order_time)}</td></tr>) : <tr><td colSpan={5} className="p-12 text-center text-slate-400">暂无业务账号</td></tr>)}</tbody></table></div>
    <div className="mt-4 flex items-center justify-between text-sm text-slate-500"><span>共 {data?.total || 0} 条 · 第 {page} 页</span><div className="flex gap-2"><button className="btn-secondary" disabled={loading || page === 1} onClick={() => setPage(p => p - 1)}>上一页</button><button className="btn-secondary" disabled={loading || page * 25 >= (data?.total || 0)} onClick={() => setPage(p => p + 1)}>下一页</button></div></div>
  </>;
}
