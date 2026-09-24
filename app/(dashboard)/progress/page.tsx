'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Minus, Plus, RefreshCw, Save, Search } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/ui/page-header';
import { api } from '@/lib/api';
import { ACCOUNT_PLATFORMS, belongsToPlatform, type AccountPlatform } from '@/lib/account-platforms';
import { progressWithDraft, type ProgressAccount as Account } from '@/lib/order-progress';
import { cn, formatDate, formatDistance } from '@/lib/utils';

function sport(a: Account) { return a.sport_world_accounts ? (Array.isArray(a.sport_world_accounts) ? a.sport_world_accounts[0] : a.sport_world_accounts) : null; }
function completed(a: Account) { return a.order_progress.finalCompletedCount; }
function syncStatus(a: Account) { const s = sport(a); if (!s?.sport_account) return '未绑定'; if (s.last_sync_status === 'success') return '已同步'; if (s.last_sync_status === 'need_verify') return '需要验证'; if (s.last_sync_status === 'token_expired') return 'Token失效'; if (s.last_sync_status === 'failed') return '同步失败'; if (s.last_sync_status === 'syncing') return '同步中'; return '已绑定'; }

export default function ProgressPage() {
  const [accounts, setAccounts] = useState<Account[]>([]); const [drafts, setDrafts] = useState<Record<string, number>>({}); const [loading, setLoading] = useState(true); const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [platform, setPlatform] = useState<AccountPlatform>(ACCOUNT_PLATFORMS[0].name);
  const [searches, setSearches] = useState<Partial<Record<AccountPlatform, string>>>({});
  const search = searches[platform] || '';
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return accounts.filter((account) => belongsToPlatform(account, platform))
      .filter((account) => !term || [
        account.school?.name, account.username, account.student_name, account.student_id,
        account.campus_name, sport(account)?.sport_account,
      ].some((value) => value?.toLowerCase().includes(term)));
  }, [accounts, platform, search]);
  async function load() { setLoading(true); try { const result = await api<{ accounts: Account[] }>('/api/progress'); setAccounts(result.accounts); setDrafts(Object.fromEntries(result.accounts.map((account) => [account.id, completed(account)]))); return result.accounts; } catch (error) { toast.error(error instanceof Error ? error.message : '加载失败'); } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);
  async function save(account: Account) { const value = drafts[account.id] ?? completed(account); try { const result = await api<{ completed: boolean }>('/api/progress', { method: 'PATCH', body: JSON.stringify({ account_id: account.id, completed_runs: value }) }); toast.success(result.completed ? '任务完成！' : '进度已更新'); await load(); } catch (error) { toast.error(error instanceof Error ? error.message : '保存失败'); } }
  async function sync(account: Account) { if (syncing[account.id]) return; setSyncing((current) => ({ ...current, [account.id]: true })); try { await api(`/api/accounts/${account.id}/sync-sport-world`, { method: 'POST' }); const updated = (await load())?.find((item) => item.id === account.id)?.order_progress; if (updated) toast.success(`同步成功 · ${updated.finalCompletedCount} 次 · ${updated.completedDistance.toFixed(2)} km`); } catch (error) { toast.error(error instanceof Error ? error.message : '同步失败'); } finally { setSyncing((current) => ({ ...current, [account.id]: false })); } }
  return <><PageHeader title="进度管理" description="运动世界自动同步进度，可保留人工修正" />
    <div className="card mb-5 p-4">
      <div className="relative min-w-0">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input
          className="input pl-9"
          placeholder="搜索学校、账号、手机号或校区"
          aria-label="搜索学校、账号、手机号或校区"
          value={search}
          onChange={(event) => setSearches((current) => ({ ...current, [platform]: event.target.value }))}
        />
      </div>
    </div>
    <nav className="mb-5 flex flex-wrap gap-2" aria-label="进度分类">
      {ACCOUNT_PLATFORMS.map((item) => <button
        key={item.slug}
        type="button"
        aria-pressed={platform === item.name}
        onClick={() => setPlatform(item.name)}
        className={cn('btn-secondary', platform === item.name && 'border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-50')}
      >{item.name}</button>)}
    </nav>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{loading ? <div className="card col-span-full py-20 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand-500" /></div> : filtered.length ? filtered.map((account) => { const binding = sport(account); const progress = progressWithDraft(account, drafts[account.id]); const done = progress.finalCompletedCount; const distance = progress.completedDistance; const remaining = progress.remainingCount; const isComplete = done >= account.order_count; const percent = progress.percent; return <article key={account.id} className="card p-5"><div className="flex items-start justify-between"><div><p className="font-semibold">{account.school?.name || '—'}</p><p className="mt-1 text-sm text-slate-500">{account.username}</p><p className="mt-1 text-xs text-slate-400">同步状态：{syncStatus(account)} · 最近同步：{formatDate(binding?.last_sync_at)}</p>{binding?.latest_run_at && <p className="mt-1 text-xs text-slate-400">最近跑步：{formatDate(binding.latest_run_at)} · {formatDistance(binding.latest_run_distance || 0)}</p>}</div>{isComplete ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />已完成</span> : remaining <= 2 ? <span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-600">即将完成</span> : <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-600">进行中</span>}</div><div className="mt-5"><div className="mb-2 flex items-end justify-between"><span className="text-3xl font-bold tracking-tight">{percent}%</span><span className="text-xs text-slate-400">{formatDistance(distance)} / {formatDistance(progress.totalDistance)}</span></div><div className="h-2 rounded-full bg-slate-100"><div className={`h-full rounded-full transition-all ${isComplete ? 'bg-emerald-500' : remaining <= 2 ? 'bg-orange-500' : 'bg-brand-600'}`} style={{ width: `${percent}%` }} /></div></div><div className="mt-5 flex items-center justify-between rounded-lg bg-slate-50 p-2"><button onClick={() => setDrafts((current) => ({ ...current, [account.id]: Math.max(0, (current[account.id] ?? done) - 1) }))} className="rounded-md p-2 text-slate-500 hover:bg-white"><Minus className="h-4 w-4" /></button><div className="flex items-center gap-2"><input className="w-16 rounded-md border border-slate-200 bg-white py-1.5 text-center text-sm font-semibold" type="number" min="0" max={account.order_count} value={done} onChange={(event) => setDrafts((current) => ({ ...current, [account.id]: Math.min(account.order_count, Math.max(0, Number(event.target.value))) }))} /><span className="text-xs text-slate-400">/ {account.order_count} 次</span></div><button onClick={() => setDrafts((current) => ({ ...current, [account.id]: Math.min(account.order_count, (current[account.id] ?? done) + 1) }))} className="rounded-md p-2 text-slate-500 hover:bg-white"><Plus className="h-4 w-4" /></button></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><div className="text-xs text-slate-500">已完成 {formatDistance(distance)} · 剩余 {remaining} 次</div><div className="flex gap-2"><Link className="btn-secondary px-3 py-1.5 text-xs" href={`/progress/${account.id}`}>查看详情</Link><button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => sync(account)} disabled={syncing[account.id]}><RefreshCw className={`h-3.5 w-3.5 ${syncing[account.id] ? 'animate-spin' : ''}`} />{syncing[account.id] ? '同步中' : '立即同步'}</button><button className="btn-primary px-3 py-1.5 text-xs" onClick={() => save(account)}><Save className="h-3.5 w-3.5" />保存</button></div></div></article>; }) : <div className="card col-span-full py-20 text-center text-sm text-slate-400">{search.trim() ? '未找到匹配的账号' : '当前分类暂无账号，请先在账号管理中添加'}</div>}</div></>;
}
