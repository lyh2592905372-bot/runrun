"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Link2Off,
  List,
  Loader2,
  Pencil,
  Plus,
  Search,
  RefreshCw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { AccountModal } from "@/components/accounts/account-modal";
import { api } from "@/lib/api";
import { accountMatchesFilters, runningTypesForSelection } from "@/lib/account-filters";
import type { Account, Category, FaceOption, RunningType, School } from "@/lib/types";
import { formatDate, formatDistance } from "@/lib/utils";
import { accountPlatformFromPathname, type AccountPlatform } from "@/lib/account-platforms";

function completed(a: Account) {
  const p = a.progress;
  return Array.isArray(p) ? p[0]?.completed_runs || 0 : p?.completed_runs || 0;
}
function sportBinding(a: Account) { return a.sport_world_accounts ? (Array.isArray(a.sport_world_accounts) ? a.sport_world_accounts[0] : a.sport_world_accounts) : null; }
function sportLabel(a: Account) { const s = sportBinding(a); if (!s?.sport_account) return { text: '未绑定', tone: 'text-slate-400 bg-slate-50' }; if (s.last_sync_status === 'need_verify') return { text: '需要验证', tone: 'text-orange-600 bg-orange-50' }; if (s.last_sync_status === 'failed') return { text: '同步失败', tone: 'text-rose-600 bg-rose-50' }; if (s.token_status === 'expired' || s.last_sync_status === 'token_expired') return { text: 'Token失效', tone: 'text-orange-600 bg-orange-50' }; if (s.last_sync_status === 'success') return { text: '已同步', tone: 'text-emerald-600 bg-emerald-50' }; return { text: '已绑定', tone: 'text-brand-600 bg-brand-50' }; }
function belongsToPlatform(account: Account, platform: AccountPlatform) { return account.category?.name === platform; }
export default function AccountsPage() {
  const pathname = usePathname();
  const platform = accountPlatformFromPathname(pathname);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [runningTypes, setRunningTypes] = useState<RunningType[]>([]);
  const [faceOptions, setFaceOptions] = useState<FaceOption[]>([]);
  const [search, setSearch] = useState("");
  const [school, setSchool] = useState("");
  const [runningType, setRunningType] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sportBindingFilter, setSportBindingFilter] = useState("");
  const [sportSyncStatusFilter, setSportSyncStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{
    open: boolean;
    account?: Account | null;
  }>({ open: false });
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordsLoading, setPasswordsLoading] = useState(false);
  const [includePassword, setIncludePassword] = useState(false);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const category = categories.find((item) => item.name === platform)?.id || "";
  useEffect(() => {
    setSchool("");
    setRunningType("");
    setSportBindingFilter("");
    setSportSyncStatusFilter("");
  }, [platform]);
  const load = useCallback(async () => {
    setShowPasswords(false);
    setRevealed({});
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (school) params.set("school_id", school);
      if (runningType) params.set("running_type_id", runningType);
      const [a, s, c, t, f] = await Promise.all([
        api<{ accounts: Account[] }>(`/api/accounts?${params.toString()}`),
        api<{ schools: School[] }>("/api/schools"),
        api<{ categories: Category[] }>("/api/categories"),
        api<{ running_types: RunningType[] }>("/api/running-types"),
        api<{ face_options: FaceOption[] }>("/api/face-options"),
      ]);
      setAccounts(a.accounts);
      setSchools(s.schools);
      setCategories(c.categories);
      setRunningTypes(t.running_types);
      setFaceOptions(f.face_options);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [school, runningType]);
  useEffect(() => {
    load();
  }, [load]);
  const availableSchools = useMemo(
    () => schools.filter((item) => item.category_id === category || accounts.some((account) => account.school_id === item.id && belongsToPlatform(account, platform))),
    [schools, accounts, category, platform],
  );
  const availableRunningTypes = useMemo(
    () => runningTypesForSelection(runningTypes, availableSchools, category, school),
    [runningTypes, school, category, availableSchools],
  );
  const filtered = useMemo(
    () => accounts.filter((account) => belongsToPlatform(account, platform)).filter((account) => accountMatchesFilters(account, { search, category: "", school, runningType, faceOption: "", dateFilter, dateFrom, dateTo, sportBinding: sportBindingFilter, sportSyncStatus: sportSyncStatusFilter })),
    [accounts, platform, search, school, runningType, dateFilter, dateFrom, dateTo, sportBindingFilter, sportSyncStatusFilter],
  );
  async function remove(a: Account) {
    if (!confirm(`确定删除账号？\n${a.school?.name || "未设置学校"} / ${a.username}`)) return;
    try {
      await api(`/api/accounts/${a.id}`, { method: "DELETE" });
      toast.success("已删除");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    }
  }
  async function sync(a: Account) {
    if (syncing[a.id]) return;
    setSyncing((current) => ({ ...current, [a.id]: true }));
    try {
      const result = await api<{ recordsReceived: number; completedRuns: number; completedDistance: number }>(`/api/accounts/${a.id}/sync-sport-world`, { method: 'POST' });
      toast.success(`同步成功 · ${result.recordsReceived} 条记录 · 已跑 ${result.completedRuns} 次 · ${result.completedDistance.toFixed(2)} km`);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : '同步失败'); }
    finally { setSyncing((current) => ({ ...current, [a.id]: false })); }
  }
  async function toggleAutoSync(a: Account) {
    const current = sportBinding(a);
    if (!current?.sport_account) return toast.error('请先绑定运动世界账号');
    try { await api(`/api/accounts/${a.id}/sport-world-settings`, { method: 'PATCH', body: JSON.stringify({ sync_enabled: !current.sync_enabled }) }); toast.success(current.sync_enabled ? '已关闭自动同步' : '已开启自动同步'); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : '设置失败'); }
  }
  async function reauth(a: Account) {
    if (syncing[a.id]) return;
    if (!sportBinding(a)?.sport_account) return toast.error('请先绑定运动世界账号');
    setSyncing((current) => ({ ...current, [a.id]: true }));
    try {
      const result = await api<{ completedRuns: number; completedDistance: number }>(`/api/accounts/${a.id}/reauth-sport-world`, { method: 'POST' });
      toast.success(`重新认证成功 · 已跑 ${result.completedRuns} 次 · ${result.completedDistance.toFixed(2)} km`);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : '重新认证失败'); }
    finally { setSyncing((current) => ({ ...current, [a.id]: false })); }
  }
  async function unbind(a: Account) {
    if (!sportBinding(a)?.sport_account) return toast.error('该账号未绑定运动世界');
    if (!confirm(`确定解除 ${a.username} 的运动世界绑定吗？历史跑步记录会保留。`)) return;
    try {
      await api(`/api/accounts/${a.id}/unbind-sport-world`, { method: 'POST' });
      toast.success('运动世界绑定已解除');
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : '解除绑定失败'); }
  }
  async function reveal(a: Account) {
    if (showPasswords) {
      setShowPasswords(false);
      setRevealed({});
      return;
    }
    if (revealed[a.id]) return setRevealed((r) => ({ ...r, [a.id]: "" }));
    try {
      const r = await api<{ password: string }>(
        `/api/accounts/${a.id}/password`,
      );
      setRevealed((x) => ({ ...x, [a.id]: r.password }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "查看失败");
    }
  }
  async function togglePasswords(checked: boolean) {
    setShowPasswords(checked);
    if (!checked) {
      setRevealed({});
      return;
    }

    setPasswordsLoading(true);
    const values = await Promise.all(
      filtered.map(async (account) => {
        try {
          const result = await api<{ password: string }>(
            `/api/accounts/${account.id}/password`,
          );
          return [account.id, result.password] as const;
        } catch {
          return [account.id, ""] as const;
        }
      }),
    );
    const visible = Object.fromEntries(values);
    setRevealed(visible);
    setPasswordsLoading(false);
    if (values.some(([, password]) => !password)) {
      toast.error("部分密码读取失败");
    }
  }
  async function exportExcel() {
    if (includePassword && !confirm("导出密码存在泄露风险，确定继续吗？"))
      return;
    const passwords: Record<string, string> = {};
    if (includePassword) {
      const values = await Promise.all(
        filtered.map(async (a) => {
          try {
            const r = await api<{ password: string }>(
              `/api/accounts/${a.id}/password`,
            );
            return [a.id, r.password] as const;
          } catch {
            return [a.id, ""] as const;
          }
        }),
      );
      values.forEach(([id, password]) => {
        passwords[id] = password;
      });
    }
    const rows = filtered.map((a) => ({
      学校: a.school?.name || "",
      分类: a.category?.name || "",
      跑步类型: a.running_type?.name || "",
      是否人脸: a.face_option?.name || "",
      账号: a.username,
      ...(includePassword ? { 密码: passwords[a.id] || "" } : {}),
      单次公里数: a.distance_per_run,
      下单次数: a.order_count,
      校区名称: a.campus_name || "",
      围栏名称: a.fence_name || "",
      姓名: a.student_name || "",
      学号: a.student_id || "",
      总公里数: a.distance_per_run * a.order_count,
      下单时间: formatDate(a.order_time),
      跑步时间: a.running_time || "",
      备注: a.note || "",
      创建时间: formatDate(a.created_at),
    }));
    const progressRows = filtered.map((a) => {
      const done = completed(a);
      return {
        学校: a.school?.name || "",
        账号: a.username,
        已跑次数: done,
        剩余次数: Math.max(0, a.order_count - done),
        已完成公里数: a.distance_per_run * done,
        总公里数: a.distance_per_run * a.order_count,
        完成百分比: `${Math.round((done / a.order_count) * 100)}%`,
        状态:
          done >= a.order_count
            ? "已完成"
            : Math.max(0, a.order_count - done) <= 2
              ? "即将完成"
              : "进行中",
        更新时间: formatDate(a.updated_at),
      };
    });
    const ExcelJS = (await import("exceljs")).default;
    const book = new ExcelJS.Workbook();
    appendSheet(book, "账号管理", rows);
    appendSheet(book, "进度管理", progressRows);
    const buffer = await book.xlsx.writeBuffer();
    const blob = new Blob([buffer as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `账号数据-${new Date().toISOString().slice(0, 10)}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
    await api("/api/logs", {
      method: "POST",
      body: JSON.stringify({
        action_type: "export_excel",
        target_type: "account",
        description: includePassword
          ? "导出账号与进度 Excel（包含密码）"
          : "导出账号与进度 Excel",
      }),
    }).catch(() => undefined);
    toast.success("Excel 已导出");
  }
  return (
    <>
      <PageHeader
        title={`${platform}账号`}
        description={`集中管理${platform}账号、订单和敏感凭据`}
        action={
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={showPasswords}
                onChange={(event) => togglePasswords(event.target.checked)}
                disabled={passwordsLoading || loading}
                className="rounded border-slate-300 text-brand-600"
              />
              {passwordsLoading ? "正在读取密码" : "显示全部密码"}
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={includePassword}
                onChange={(e) => setIncludePassword(e.target.checked)}
                className="rounded border-slate-300 text-brand-600"
              />
              导出包含密码
            </label>
            <button className="btn-secondary" onClick={exportExcel}>
              <Download className="h-4 w-4" />
              导出 Excel
            </button>
            <button
              className="btn-primary"
              onClick={() => setModal({ open: true, account: null })}
            >
              <Plus className="h-4 w-4" />
              添加账号
            </button>
          </div>
        }
      />
      <div className="card mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="relative min-w-0">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="搜索学校或账号"
              aria-label="搜索学校或账号"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
            />
          </div>
          <select
            className="input min-w-0"
            aria-label="学校"
            value={school}
            onChange={(e) => { setSchool(e.target.value); setRunningType(""); }}
          >
            <option value="">全部学校</option>
            {availableSchools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            className="input min-w-0"
            aria-label="跑步类型"
            value={runningType}
            onChange={(e) => setRunningType(e.target.value)}
          >
            <option value="">全部跑步类型</option>
            {availableRunningTypes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            className="input min-w-0"
            aria-label="下单时间"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          >
            <option value="all">全部下单时间</option>
            <option value="today">今天</option>
            <option value="7d">最近 7 天</option>
            <option value="30d">最近 30 天</option>
            <option value="custom">自定义日期</option>
            </select>
          {platform === "运动世界" && <select className="input min-w-0" aria-label="运动世界绑定状态" value={sportBindingFilter} onChange={(e) => setSportBindingFilter(e.target.value)}>
            <option value="">全部绑定状态</option>
            <option value="bound">已绑定</option>
            <option value="unbound">未绑定</option>
          </select>}
          {platform === "运动世界" && <select className="input min-w-0" aria-label="运动世界同步状态" value={sportSyncStatusFilter} onChange={(e) => setSportSyncStatusFilter(e.target.value)}>
            <option value="">全部同步状态</option>
            <option value="never_synced">未同步</option>
            <option value="success">同步成功</option>
            <option value="failed">同步失败</option>
            <option value="token_expired">Token 失效</option>
            <option value="need_verify">需要验证</option>
          </select>}
        </div>
        {dateFilter === "custom" && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="开始日期" />
            <input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="结束日期" />
          </div>
        )}
      </div>
      <div className="card overflow-hidden">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/80 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">学校</th>
                <th className="px-5 py-3">跑步类型</th>
                <th className="px-5 py-3">账号</th>
                <th className="px-5 py-3">{platform === "运动世界" ? "校区名称" : platform === "闪动校园" ? "围栏名称" : "姓名 / 学号"}</th>
                <th className="px-5 py-3">密码</th>
                <th className="px-5 py-3">单次公里</th>
                <th className="px-5 py-3">下单次数</th>
                <th className="px-5 py-3">总公里</th>
                <th className="px-5 py-3">下单时间</th>
                {platform === "运动世界" && <th className="px-5 py-3">运动世界</th>}
                {platform === "运动世界" && <th className="px-5 py-3">最近同步</th>}
                <th className="px-5 py-3">备注</th>
                <th className="px-5 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={platform === "运动世界" ? 13 : 11} className="py-16 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-brand-500" />
                  </td>
                </tr>
              ) : filtered.length ? (
                filtered.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-800">{a.school?.name || "—"}</p>
                      <p className="mt-1 text-xs text-slate-400">{platform}</p>
                      <p className="mt-1 text-[11px] text-brand-600">{a.running_type?.name || "未设跑步类型"} · {a.face_option?.name || "未设人脸选项"}</p>
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-500">{a.running_type?.name || "—"}</td>
                    <td className="px-5 py-4 font-medium">{a.username}</td>
                    <td className="px-5 py-4 text-xs text-slate-500">{platform === "运动世界" ? a.campus_name || "—" : platform === "闪动校园" ? a.fence_name || "—" : <>{a.student_name || "—"}<br />{a.student_id || "—"}</>}</td>
                    <td className="px-5 py-4">
                      <button
                        onClick={() => reveal(a)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600"
                      >
                        {revealed[a.id] || "••••••••"}
                        {revealed[a.id] ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </td>
                    <td className="px-5 py-4">
                      {formatDistance(a.distance_per_run)}
                    </td>
                    <td className="px-5 py-4">{a.order_count}</td>
                    <td className="px-5 py-4 font-semibold">
                      {formatDistance(a.distance_per_run * a.order_count)}
                    </td>
                    <td className="px-5 py-4 text-xs text-slate-500">
                      {formatDate(a.order_time)}
                    </td>
                    {platform === "运动世界" && <td className="px-5 py-4">{(() => { const s = sportLabel(a); return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${s.tone}`}>{s.text}</span>; })()}</td>}
                    {platform === "运动世界" && <td className="px-5 py-4 text-xs text-slate-500">{formatDate(sportBinding(a)?.last_sync_at)}</td>}
                    <td className="max-w-48 px-5 py-4 text-xs text-slate-500" title={a.note || ""}>{a.note || "—"}</td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-1">
                        {platform === "运动世界" && <button
                          onClick={() => sync(a)}
                          disabled={syncing[a.id]}
                          title="立即同步"
                          className="rounded-md p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600 disabled:opacity-50"
                        >
                          <RefreshCw className={`h-4 w-4 ${syncing[a.id] ? "animate-spin" : ""}`} />
                        </button>}
                        {platform === "运动世界" && <button onClick={() => reauth(a)} disabled={syncing[a.id] || !sportBinding(a)?.sport_account} title="重新认证" className="rounded-md p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600 disabled:opacity-40"><KeyRound className="h-4 w-4" /></button>}
                        <Link href={`/progress/${a.id}`} title="查看运动记录" className="rounded-md p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"><List className="h-4 w-4" /></Link>
                        {platform === "运动世界" && <button onClick={() => unbind(a)} disabled={!sportBinding(a)?.sport_account} title="解除绑定" className="rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"><Link2Off className="h-4 w-4" /></button>}
                        {platform === "运动世界" && <button onClick={() => toggleAutoSync(a)} title={sportBinding(a)?.sync_enabled ? "关闭自动同步" : "开启自动同步"} className={`rounded-md px-2 text-xs ${sportBinding(a)?.sync_enabled ? "text-emerald-600" : "text-slate-400"}`}>{sportBinding(a)?.sync_enabled ? "自动" : "手动"}</button>}
                        <button
                          onClick={() => setModal({ open: true, account: a })}
                          className="rounded-md p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => remove(a)}
                          className="rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={platform === "运动世界" ? 13 : 11}
                    className="py-16 text-center text-sm text-slate-400"
                  >
                    暂无账号，点击“添加账号”开始
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-slate-100 md:hidden">
          {loading ? (
            <div className="py-16 text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-brand-500" />
            </div>
          ) : filtered.length ? (
            filtered.map((a) => (
              <div key={a.id} className="space-y-3 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">
                      {a.school?.name || "未设置"}{" "}
                      <span className="font-normal text-slate-500">
                        / {a.username}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {a.category?.name || "未分类"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">跑步类型：{a.running_type?.name || "—"}</p>
                    <p className="mt-1 text-xs text-slate-500">{platform === "运动世界" ? a.campus_name || "未设校区" : platform === "闪动校园" ? a.fence_name || "未设围栏" : `${a.student_name || "未设姓名"} · ${a.student_id || "未设学号"}`}</p>
                  </div>
                  <div className="flex gap-1">
                    {platform === "运动世界" && <button onClick={() => reauth(a)} disabled={syncing[a.id] || !sportBinding(a)?.sport_account} title="重新认证" className="rounded-md p-2 text-slate-400 disabled:opacity-40"><KeyRound className="h-4 w-4" /></button>}
                    <Link href={`/progress/${a.id}`} title="查看运动记录" className="rounded-md p-2 text-slate-400"><List className="h-4 w-4" /></Link>
                    {platform === "运动世界" && <button onClick={() => unbind(a)} disabled={!sportBinding(a)?.sport_account} title="解除绑定" className="rounded-md p-2 text-rose-500 disabled:opacity-40"><Link2Off className="h-4 w-4" /></button>}
                    <button
                      onClick={() => setModal({ open: true, account: a })}
                      className="rounded-md p-2 text-slate-400"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => remove(a)}
                      className="rounded-md p-2 text-rose-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-50 p-2">
                    <span className="text-slate-400">密码</span>
                    <p className="mt-1 font-medium">
                      {revealed[a.id] || "••••••••"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <span className="text-slate-400">次数</span>
                    <p className="mt-1 font-medium">{a.order_count}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <span className="text-slate-400">总公里</span>
                    <p className="mt-1 font-medium">
                      {formatDistance(a.distance_per_run * a.order_count)}
                    </p>
                  </div>
                </div>
                {platform === "运动世界" && <div className="flex items-center justify-between text-xs"><span className={`rounded-full px-2 py-1 font-semibold ${sportLabel(a).tone}`}>{sportLabel(a).text}</span><span className="text-slate-400">最近同步 {formatDate(sportBinding(a)?.last_sync_at)}</span></div>}
                 {platform === "运动世界" && <button onClick={() => sync(a)} disabled={syncing[a.id]} className="btn-secondary w-full py-1.5 text-xs"><RefreshCw className={`h-3.5 w-3.5 ${syncing[a.id] ? "animate-spin" : ""}`} />{syncing[a.id] ? "正在同步..." : "立即同步"}</button>}
                <button
                  onClick={() => reveal(a)}
                  className="text-xs font-semibold text-brand-600"
                >
                  {showPasswords
                    ? "隐藏全部密码"
                    : revealed[a.id]
                      ? "隐藏密码"
                      : "查看密码"}
                </button>
              </div>
            ))
          ) : (
            <div className="py-16 text-center text-sm text-slate-400">
              暂无账号
            </div>
          )}
        </div>
      </div>
      {modal.open && (
        <AccountModal
          account={modal.account}
          platform={platform}
          schools={schools}
          categories={categories}
          runningTypes={runningTypes}
          faceOptions={faceOptions}
          onClose={() => setModal({ open: false })}
          onSaved={load}
        />
      )}
    </>
  );
}

function appendSheet(
  book: import("exceljs").Workbook,
  name: string,
  rows: Record<string, string | number>[],
) {
  const sheet = book.addWorksheet(name);
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  sheet.columns = headers.map((header) => ({
    header,
    key: header,
    width: Math.max(14, header.length * 2 + 4),
  }));
  rows.forEach((row) => { sheet.addRow(row); });
  if (headers.length) {
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4F46C8" },
    };
    header.alignment = { vertical: "middle" };
    sheet.autoFilter = {
      from: "A1",
      to: `${String.fromCharCode(64 + headers.length)}1`,
    };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
  }
}
