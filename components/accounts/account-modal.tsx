'use client';

import { useId, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { CreatableCombobox, type ComboboxValue } from '@/components/ui/creatable-combobox';
import { api } from '@/lib/api';
import type { Account, Category, FaceOption, RunningType, School } from '@/lib/types';

type Props = {
  account?: Account | null;
  schools: School[];
  categories: Category[];
  runningTypes: RunningType[];
  faceOptions: FaceOption[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
};

function toLocalDateTime(value: string | Date) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function choice(id: string | null | undefined, relationName: string | undefined, options: { id: string; name: string }[]): ComboboxValue {
  if (!id) return { id: '', name: relationName || '' };
  const option = options.find((item) => item.id === id);
  return { id, name: relationName || option?.name || '' };
}

export function AccountModal({ account, schools, categories, runningTypes, faceOptions, onClose, onSaved }: Props) {
  const formId = useId();
  const ids = {
    category: `${formId}-category`,
    school: `${formId}-school`,
    runningType: `${formId}-running-type`,
    faceOption: `${formId}-face-option`,
    username: `${formId}-username`,
    password: `${formId}-password`,
    sportAccount: `${formId}-sport-account`,
    sportPassword: `${formId}-sport-password`,
    distance: `${formId}-distance`,
    orders: `${formId}-orders`,
    orderTime: `${formId}-order-time`,
    note: `${formId}-note`,
  };
  const sportBinding = account?.sport_world_accounts ? (Array.isArray(account.sport_world_accounts) ? account.sport_world_accounts[0] : account.sport_world_accounts) : null;
  const initialCategory = account
    ? choice(account.category_id, account.category?.name, categories)
    : choice(categories[0]?.id, categories[0]?.name, categories);
  const initialSchoolOptions = schools.filter((school) => school.category_id === initialCategory.id);
  const initialSchool = account
    ? choice(account.school_id, account.school?.name, schools)
    : choice(initialSchoolOptions[0]?.id, initialSchoolOptions[0]?.name, initialSchoolOptions);
  const initialTypeOptions = runningTypes.filter((type) => type.school_id === initialSchool.id);
  const initialRunningType = account
    ? choice(account.running_type_id, account.running_type?.name, runningTypes)
    : choice(initialTypeOptions[0]?.id, initialTypeOptions[0]?.name, initialTypeOptions);
  const initialFaceOptions = faceOptions.filter((option) => option.running_type_id === initialRunningType.id);

  const [form, setForm] = useState({
    category: initialCategory,
    school: initialSchool,
    running_type: initialRunningType,
    face_option: account
      ? choice(account.face_option_id, account.face_option?.name, faceOptions)
      : choice(initialFaceOptions[0]?.id, initialFaceOptions[0]?.name, initialFaceOptions),
    username: account?.username || '',
    password: '',
    sport_account: sportBinding?.sport_account || '',
    sport_password: '',
    distance_per_run: String(account?.distance_per_run || ''),
    order_count: String(account?.order_count || ''),
    order_time: account?.order_time ? toLocalDateTime(account.order_time) : toLocalDateTime(new Date()),
    note: account?.note || '',
  });
  const [saving, setSaving] = useState(false);

  const availableSchools = useMemo(
    () => form.category.id ? schools.filter((school) => school.category_id === form.category.id) : [],
    [schools, form.category.id],
  );
  const availableTypes = useMemo(
    () => form.school.id ? runningTypes.filter((type) => type.school_id === form.school.id) : [],
    [runningTypes, form.school.id],
  );
  const availableFaces = useMemo(
    () => form.running_type.id ? faceOptions.filter((option) => option.running_type_id === form.running_type.id) : [],
    [faceOptions, form.running_type.id],
  );

  function set(key: 'username' | 'password' | 'sport_account' | 'sport_password' | 'distance_per_run' | 'order_count' | 'order_time' | 'note', value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function changeCategory(value: ComboboxValue) {
    setForm((current) => ({ ...current, category: value, school: { id: '', name: '' }, running_type: { id: '', name: '' }, face_option: { id: '', name: '' } }));
  }

  function changeSchool(value: ComboboxValue) {
    setForm((current) => ({ ...current, school: value, running_type: { id: '', name: '' }, face_option: { id: '', name: '' } }));
  }

  function changeRunningType(value: ComboboxValue) {
    setForm((current) => ({ ...current, running_type: value, face_option: { id: '', name: '' } }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        running_type: form.running_type.name.trim() ? form.running_type : null,
        face_option: form.face_option.name.trim() ? form.face_option : null,
        distance_per_run: Number(form.distance_per_run),
        order_count: Number(form.order_count),
        order_time: new Date(form.order_time).toISOString(),
      };
      if (account) {
        await api(`/api/accounts/${account.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await api('/api/accounts', { method: 'POST', body: JSON.stringify(payload) });
      }
      toast.success(account ? '账号已更新' : '账号已创建');
      await onSaved();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-100 px-6 py-4"><div><h2 className="font-semibold">{account ? '编辑账号' : '添加账号'}</h2><p className="mt-1 text-xs text-slate-400">账号分类 → 学校 → 跑步类型 → 是否人脸</p></div><button type="button" aria-label="关闭" onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100"><X className="h-5 w-5 text-slate-500" /></button></div><form onSubmit={submit} className="grid gap-4 p-6 sm:grid-cols-2"><div><label htmlFor={ids.category} className="label">账号分类</label><CreatableCombobox id={ids.category} value={form.category} options={categories} onChange={changeCategory} placeholder="选择或输入账号分类" /></div><div><label htmlFor={ids.school} className="label">学校</label><CreatableCombobox id={ids.school} value={form.school} options={availableSchools} onChange={changeSchool} placeholder="选择或输入学校" disabled={!form.category.name.trim()} /></div><div><label htmlFor={ids.runningType} className="label">跑步类型</label><CreatableCombobox id={ids.runningType} value={form.running_type} options={availableTypes} onChange={changeRunningType} placeholder="选择或输入跑步类型" disabled={!form.school.name.trim()} allowEmpty /></div><div><label htmlFor={ids.faceOption} className="label">是否人脸</label><CreatableCombobox id={ids.faceOption} value={form.face_option} options={availableFaces} onChange={(value) => setForm((current) => ({ ...current, face_option: value }))} placeholder="选择或输入是否人脸" disabled={!form.running_type.name.trim()} allowEmpty /></div><div><label htmlFor={ids.username} className="label">账号</label><input id={ids.username} className="input" value={form.username} onChange={(event) => set('username', event.target.value)} required /></div><div><label htmlFor={ids.password} className="label">密码 {account && <span className="font-normal normal-case text-slate-400">（留空表示不修改）</span>}</label><input id={ids.password} className="input" type="password" value={form.password} onChange={(event) => set('password', event.target.value)} required={!account} /></div><div><label htmlFor={ids.sportAccount} className="label">运动世界账号</label><input id={ids.sportAccount} className="input" value={form.sport_account} onChange={(event) => set('sport_account', event.target.value)} placeholder="可选" /></div><div><label htmlFor={ids.sportPassword} className="label">运动世界密码 {account && <span className="font-normal normal-case text-slate-400">（已保存则留空）</span>}</label><input id={ids.sportPassword} className="input" type="password" value={form.sport_password} onChange={(event) => set('sport_password', event.target.value)} placeholder={sportBinding?.has_sport_password ? '••••••••' : '可选'} /></div><div><label htmlFor={ids.distance} className="label">单次跑步公里数</label><input id={ids.distance} className="input" type="number" min="0.1" step="0.1" value={form.distance_per_run} onChange={(event) => set('distance_per_run', event.target.value)} required /></div><div><label htmlFor={ids.orders} className="label">下单次数</label><input id={ids.orders} className="input" type="number" min="1" step="1" value={form.order_count} onChange={(event) => set('order_count', event.target.value)} required /></div><div className="sm:col-span-2"><label htmlFor={ids.orderTime} className="label">下单时间</label><input id={ids.orderTime} className="input" type="datetime-local" value={form.order_time} onChange={(event) => set('order_time', event.target.value)} required /></div><div className="sm:col-span-2"><label htmlFor={ids.note} className="label">备注</label><textarea id={ids.note} className="input min-h-20 resize-y" value={form.note} onChange={(event) => set('note', event.target.value)} placeholder="可填写订单说明、客户要求等" /></div><div className="flex justify-end gap-3 border-t border-slate-100 pt-4 sm:col-span-2"><button type="button" className="btn-secondary" onClick={onClose}>取消</button><button type="submit" className="btn-primary" disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}保存账号</button></div></form></div></div>;
}
