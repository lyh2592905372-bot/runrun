'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/ui/page-header';
import { formatDate } from '@/lib/utils';
import type { Account, SportWorldAccount } from '@/lib/types';

type Log = { id: string; started_at: string; status: string; records_received: number; error_message: string | null; account: { username: string } | null };
const statuses: Record<string, string> = { never_synced: '尚未同步', syncing: '同步中', success: '成功', failed: '失败', token_expired: '认证过期', need_verify: '需要验证' };
export default function SyncPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [a, l] = await Promise.all([api<{ accounts: Account[] }>('/api/accounts'), api<{ logs: Log[]; total: number }>(`/api/sync-logs?page=${page}`)]);
      setAccounts(a.accounts.filter(a => a.sport_world_accounts)); setLogs(l.logs); setTotal(l.total);
    } catch (e) { setError(e instanceof Error ? e.message : '同步数据读取失败'); }
    finally { setLoading(false); }
  }, [page]);
  useEffect(() => { void load(); }, [load]);
  async function act(account: Account, action: 'sync-sport-world' | 'sport-world-settings', enabled?: boolean) {
    setBusy(account.id);
    try { await api(`/api/accounts/${account.id}/${action}`, { method: enabled === undefined ? 'POST' : 'PATCH', ...(enabled === undefined ? {} : { body: JSON.stringify({ sync_enabled: enabled }) }) }); toast.success(enabled === undefined ? '同步完成' : '自动同步设置已更新'); }
    catch (e) { toast.error(e instanceof Error ? e.message : '操作失败'); }
    finally { await load(); setBusy(''); }
  }
  return <><PageHeader title="同步管理" description="管理运动世界同步任务，查看同步结果和历史记录" />
    <div className="mb-4 flex gap-2"><button className="btn-secondary" disabled={loading} onClick={load}>刷新</button><Link className="btn-secondary" href="/accounts/sport-world">管理绑定账号</Link></div>
    {error && <p role="alert" className="mb-4 text-sm text-rose-600">{error}</p>}
    <div className="card mb-6 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{['账号', '上次同步', '状态', '自动同步', '操作'].map(t => <th key={t} className="whitespace-nowrap p-4 font-medium">{t}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={5} className="p-10 text-center text-slate-400">加载中…</td></tr> : accounts.length ? accounts.map(a => {
      const sport = (Array.isArray(a.sport_world_accounts) ? a.sport_world_accounts[0] : a.sport_world_accounts) as SportWorldAccount;
      return <tr key={a.id} className="border-t border-slate-100"><td className="p-4 font-medium">{a.username}</td><td className="whitespace-nowrap p-4 text-slate-500">{sport.last_sync_at ? formatDate(sport.last_sync_at) : '—'}</td><td className="p-4">{statuses[sport.last_sync_status] || sport.last_sync_status}</td><td className="p-4"><label className="flex items-center gap-2"><input aria-label={`${a.username} 自动同步`} type="checkbox" checked={sport.sync_enabled} disabled={!!busy || !sport.sport_account} onChange={e => act(a, 'sport-world-settings', e.target.checked)} />{sport.sync_enabled ? '开启' : '关闭'}</label></td><td className="p-4"><button className="btn-primary whitespace-nowrap" disabled={!!busy || !sport.sport_account || sport.last_sync_status === 'syncing'} onClick={() => act(a, 'sync-sport-world')}>{busy === a.id ? '处理中…' : '立即同步'}</button></td></tr>;
    }) : <tr><td colSpan={5} className="p-10 text-center text-slate-400">暂无绑定账号，请先在账号管理中添加</td></tr>}</tbody></table></div>
    <h2 className="mb-3 text-base font-semibold">同步历史</h2><div className="card divide-y divide-slate-100">{logs.length ? logs.map(l => <div key={l.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{l.account?.username || '历史账号'} · {statuses[l.status] || l.status}</span><span className="text-xs text-slate-400">{formatDate(l.started_at)}</span></div><p className="mt-1 break-words text-xs text-slate-500">{l.error_message || `接收 ${l.records_received} 条记录`}</p></div>) : <p className="p-10 text-center text-sm text-slate-400">暂无同步记录</p>}</div>
    <div className="mt-4 flex items-center justify-between text-sm text-slate-500"><span>共 {total} 条 · 第 {page} 页</span><div className="flex gap-2"><button className="btn-secondary" disabled={loading || page === 1} onClick={() => setPage(p => p - 1)}>上一页</button><button className="btn-secondary" disabled={loading || page * 25 >= total} onClick={() => setPage(p => p + 1)}>下一页</button></div></div>
  </>;
}
