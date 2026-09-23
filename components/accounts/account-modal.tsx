'use client';

import { useId, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { CreatableCombobox, type ComboboxValue } from '@/components/ui/creatable-combobox';
import type { AccountPlatform } from '@/lib/account-platforms';
import { api } from '@/lib/api';
import { appDateTimeInputToIso, toAppDateTimeInput } from '@/lib/datetime';
import type { Account, Category, FaceOption, RunningType, School } from '@/lib/types';

type Props = {
  account?: Account | null;
  platform: AccountPlatform;
  schools: School[];
  categories: Category[];
  runningTypes: RunningType[];
  faceOptions: FaceOption[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

function choice(id: string | null | undefined, relationName: string | undefined, options: { id: string; name: string }[]): ComboboxValue {
  if (!id) return { id: '', name: relationName || '' };
  const option = options.find((item) => item.id === id);
  return { id, name: relationName || option?.name || '' };
}

export function AccountModal({ account, platform, schools, categories, runningTypes, faceOptions, onClose, onSaved }: Props) {
  const formId = useId();
  const ids = {
    school: `${formId}-school`, studentName: `${formId}-student-name`, studentId: `${formId}-student-id`,
    username: `${formId}-username`, password: `${formId}-password`, orderTime: `${formId}-order-time`, runningTime: `${formId}-running-time`, runningType: `${formId}-running-type`,
    distance: `${formId}-distance`, orders: `${formId}-orders`, campusName: `${formId}-campus-name`,
    fenceName: `${formId}-fence-name`, note: `${formId}-note`,
  };
  const platformCategory = categories.find((category) => category.name === platform);
  const sportBinding = account?.sport_world_accounts ? (Array.isArray(account.sport_world_accounts) ? account.sport_world_accounts[0] : account.sport_world_accounts) : null;
  const initialCategory = account?.category_id
    ? choice(account.category_id, account.category?.name, categories)
    : choice(platformCategory?.id, platform, categories);
  // running_time is intentionally free-form text. Existing timestamp values are
  // kept verbatim so older records remain editable without being rewritten.
  const initialOrderTime = account?.order_time ? toAppDateTimeInput(account.order_time) : '';
  const initialRunningTime = account?.running_time || '';
  const [form, setForm] = useState({
    category: initialCategory,
    school: account ? choice(account.school_id, account.school?.name, schools) : { id: '', name: '' },
    running_type: account ? choice(account.running_type_id, account.running_type?.name, runningTypes) : null,
    face_option: account ? choice(account.face_option_id, account.face_option?.name, faceOptions) : null,
    username: account?.username || (platform === '运动世界' ? sportBinding?.sport_account || '' : ''), password: '',
    order_time: initialOrderTime,
    running_time: initialRunningTime,
    distance_per_run: account ? String(account.distance_per_run) : '', order_count: account ? String(account.order_count) : '',
    campus_name: account?.campus_name || '', fence_name: account?.fence_name || '',
    student_name: account?.student_name || '', student_id: account?.student_id || '', note: account?.note || '',
  });
  const [saving, setSaving] = useState(false);
  function set(key: 'username' | 'password' | 'order_time' | 'running_time' | 'distance_per_run' | 'order_count' | 'campus_name' | 'fence_name' | 'student_name' | 'student_id' | 'note', value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        distance_per_run: Number(form.distance_per_run),
        order_count: Number(form.order_count),
        // New records leave 下单时间 empty so the existing API default remains
        // authoritative; edits keep the existing datetime workflow intact.
        order_time: account && form.order_time === initialOrderTime ? account.order_time : form.order_time ? appDateTimeInputToIso(form.order_time) : '',
        running_time: account && form.running_time === initialRunningTime ? account.running_time ?? null : form.running_time || null,
      };
      if (account) await api(`/api/accounts/${account.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await api('/api/accounts', { method: 'POST', body: JSON.stringify(payload) });
      toast.success(account ? '账号已更新' : '账号已创建');
      await onSaved();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
      <div className="max-h-[90vh] max-h-[calc(100dvh-2rem)] w-full max-w-2xl min-w-0 touch-pan-y overscroll-contain overflow-x-hidden overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4"><div><h2 className="font-semibold">{account ? '编辑账号' : '添加账号'}</h2><p className="mt-1 text-xs text-slate-400">{platform}</p></div><button type="button" aria-label="关闭" onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100"><X className="h-5 w-5 text-slate-500" /></button></div>
        <form onSubmit={submit} className="grid min-w-0 gap-4 p-4 sm:grid-cols-2 sm:p-6" autoComplete="off">
          <div className="min-w-0 sm:col-span-2"><label htmlFor={ids.school} className="label">学校</label><CreatableCombobox id={ids.school} value={form.school} options={schools} onChange={(school) => setForm((current) => ({ ...current, school }))} placeholder="选择或输入学校" /></div>
          <div className="min-w-0 sm:col-span-2"><label htmlFor={ids.runningType} className="label">跑步类型</label><CreatableCombobox id={ids.runningType} value={form.running_type || { id: '', name: '' }} options={runningTypes} onChange={(running_type) => setForm((current) => ({ ...current, running_type, face_option: null }))} placeholder="选择或输入跑步类型" /></div>
          {platform === '支付宝阳光跑' && <><div><label htmlFor={ids.studentName} className="label">姓名</label><input id={ids.studentName} className="input" value={form.student_name} onChange={(event) => set('student_name', event.target.value)} /></div><div><label htmlFor={ids.studentId} className="label">学号</label><input id={ids.studentId} className="input" value={form.student_id} onChange={(event) => set('student_id', event.target.value)} /></div></>}
          {platform !== '支付宝阳光跑' && <><div><label htmlFor={ids.username} className="label">账号</label><input id={ids.username} className="input" value={form.username} onChange={(event) => set('username', event.target.value)} autoComplete="off" required /></div>
          <div><label htmlFor={ids.password} className="label">密码 {account && <span className="font-normal normal-case text-slate-400">（留空表示不修改）</span>}</label><input id={ids.password} className="input" type="password" value={form.password} onChange={(event) => set('password', event.target.value)} autoComplete="new-password" required={!account} /></div></>}
          {platform === '运动世界' && <div className="sm:col-span-2"><label htmlFor={ids.campusName} className="label">校区名称</label><input id={ids.campusName} className="input" value={form.campus_name} onChange={(event) => set('campus_name', event.target.value)} /></div>}
          <div className="sm:col-span-2"><label htmlFor={ids.runningTime} className="label">跑步时间</label><input id={ids.runningTime} className="input" type="text" value={form.running_time} onChange={(event) => set('running_time', event.target.value)} placeholder="请输入跑步时间，例如 06:00-08:00" /></div>
          <div><label htmlFor={ids.distance} className="label">公里数</label><input id={ids.distance} className="input" type="number" min="0.1" step="0.1" value={form.distance_per_run} onChange={(event) => set('distance_per_run', event.target.value)} required /></div>
          <div><label htmlFor={ids.orders} className="label">次数</label><input id={ids.orders} className="input" type="number" min="1" step="1" value={form.order_count} onChange={(event) => set('order_count', event.target.value)} required /></div>
          <div className="sm:col-span-2"><label htmlFor={ids.orderTime} className="label">下单时间</label><input id={ids.orderTime} className="input" type="datetime-local" value={form.order_time} onChange={(event) => set('order_time', event.target.value)} required={Boolean(account)} /></div>
          {platform === '闪动校园' && <div className="sm:col-span-2"><label htmlFor={ids.fenceName} className="label">围栏名称</label><input id={ids.fenceName} className="input" value={form.fence_name} onChange={(event) => set('fence_name', event.target.value)} /></div>}
          <div className="sm:col-span-2"><label htmlFor={ids.note} className="label">备注</label><textarea id={ids.note} className="input min-h-20 resize-y" value={form.note} onChange={(event) => set('note', event.target.value)} placeholder="可填写订单说明、客户要求等" /></div>
          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4 sm:col-span-2"><button type="button" className="btn-secondary" onClick={onClose}>取消</button><button type="submit" className="btn-primary" disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}保存账号</button></div>
        </form>
      </div>
    </div>
  );
}
