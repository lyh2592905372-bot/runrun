'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { AlertTriangle, Loader2, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/ui/page-header';
import { api } from '@/lib/api';
import type { Category, RunningType, School } from '@/lib/types';

type ConfigurationType = 'category' | 'school' | 'running_type';
type EditState = { type: ConfigurationType; id: string; name: string } | null;
type DeleteState = { type: ConfigurationType; id: string; name: string } | null;

const endpoints: Record<ConfigurationType, string> = {
  category: '/api/categories',
  school: '/api/schools',
  running_type: '/api/running-types',
};

const labels: Record<ConfigurationType, string> = {
  category: '账号分类',
  school: '学校',
  running_type: '跑步类型',
};

export default function SettingsPage() {
  const deleteTitleId = useId();
  const [categories, setCategories] = useState<Category[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [runningTypes, setRunningTypes] = useState<RunningType[]>([]);
  const [loading, setLoading] = useState(true);
  const [newValues, setNewValues] = useState<Record<ConfigurationType, string>>({ category: '', school: '', running_type: '' });
  const [edit, setEdit] = useState<EditState>(null);
  const [pendingDelete, setPendingDelete] = useState<DeleteState>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [categoryResult, schoolResult, typeResult] = await Promise.all([
        api<{ categories: Category[] }>('/api/categories'),
        api<{ schools: School[] }>('/api/schools'),
        api<{ running_types: RunningType[] }>('/api/running-types'),
      ]);
      setCategories(categoryResult.categories);
      setSchools(schoolResult.schools);
      setRunningTypes(typeResult.running_types);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function setNew(type: ConfigurationType, value: string) {
    setNewValues((current) => ({ ...current, [type]: value }));
  }

  async function add(type: ConfigurationType) {
    const name = newValues[type].trim();
    if (!name) return;
    try {
      await api(endpoints[type], { method: 'POST', body: JSON.stringify({ name }) });
      toast.success(`${labels[type]}已添加`);
      setNew(type, '');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '添加失败');
    }
  }

  async function saveEdit() {
    if (!edit) return;
    const name = edit.name.trim();
    if (!name) return toast.error('名称不能为空');
    try {
      await api(`${endpoints[edit.type]}/${edit.id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
      toast.success('已保存');
      setEdit(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api(`${endpoints[pendingDelete.type]}/${pendingDelete.id}`, { method: 'DELETE' });
      toast.success(`${labels[pendingDelete.type]}已删除`);
      setPendingDelete(null);
      await load();
    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.error(error);
      toast.error('删除失败，请稍后重试。');
    } finally {
      setDeleting(false);
    }
  }

  const deleteMessage = pendingDelete?.type === 'school'
    ? `确定删除学校『${pendingDelete.name}』吗？已有账号不会被删除，但这些账号的学校关联将被清空。`
    : pendingDelete
      ? `确定删除${labels[pendingDelete.type]}『${pendingDelete.name}』吗？已有账号不会被删除，对应关联将被清空。`
      : '';

  return <>
    <PageHeader title="设置" description="管理账号分类，以及全局学校和跑步类型" />
    <div className="grid gap-6 xl:grid-cols-2">
      <SettingCard title="账号分类" placeholder="例如：主要账号" value={newValues.category} setValue={(value) => setNew('category', value)} add={() => add('category')} loading={loading}>
        {categories.map((category) => <Row key={category.id} name={category.name} editing={edit?.id === category.id} editValue={edit?.name || ''} onEdit={() => setEdit({ type: 'category', id: category.id, name: category.name })} onEditChange={(name) => setEdit((current) => current ? { ...current, name } : current)} onSave={saveEdit} onCancel={() => setEdit(null)} onDelete={() => setPendingDelete({ type: 'category', id: category.id, name: category.name })} />)}
      </SettingCard>
      <SettingCard title="学校" placeholder="例如：UCLA" value={newValues.school} setValue={(value) => setNew('school', value)} add={() => add('school')} loading={loading}>
        {schools.map((school) => <Row key={school.id} name={school.name} editing={edit?.id === school.id} editValue={edit?.name || ''} onEdit={() => setEdit({ type: 'school', id: school.id, name: school.name })} onEditChange={(name) => setEdit((current) => current ? { ...current, name } : current)} onSave={saveEdit} onCancel={() => setEdit(null)} onDelete={() => setPendingDelete({ type: 'school', id: school.id, name: school.name })} />)}
      </SettingCard>
      <SettingCard title="跑步类型" placeholder="例如：操场跑" value={newValues.running_type} setValue={(value) => setNew('running_type', value)} add={() => add('running_type')} loading={loading}>
        {runningTypes.map((type) => <Row key={type.id} name={type.name} editing={edit?.id === type.id} editValue={edit?.name || ''} onEdit={() => setEdit({ type: 'running_type', id: type.id, name: type.name })} onEditChange={(name) => setEdit((current) => current ? { ...current, name } : current)} onSave={saveEdit} onCancel={() => setEdit(null)} onDelete={() => setPendingDelete({ type: 'running_type', id: type.id, name: type.name })} />)}
      </SettingCard>
    </div>
    {pendingDelete && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" role="dialog" aria-modal="true" aria-labelledby={deleteTitleId}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600"><AlertTriangle className="h-5 w-5" /></div>
          <div><h2 id={deleteTitleId} className="font-semibold text-slate-900">确认删除</h2><p className="mt-2 text-sm leading-6 text-slate-600">{deleteMessage}</p></div>
        </div>
        <div className="mt-6 flex justify-end gap-3"><button type="button" className="btn-secondary" disabled={deleting} onClick={() => setPendingDelete(null)}>取消</button><button type="button" className="btn-primary bg-rose-600 hover:bg-rose-700" disabled={deleting} onClick={confirmDelete}>{deleting && <Loader2 className="h-4 w-4 animate-spin" />}确认删除</button></div>
      </div>
    </div>}
  </>;
}

function SettingCard({ title, placeholder, value, setValue, add, loading, children }: { title: string; placeholder: string; value: string; setValue: (value: string) => void; add: () => void; loading: boolean; children: React.ReactNode }) {
  return <section className="card overflow-hidden"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold">{title}</h2><div className="mt-3 flex gap-2"><input className="input" placeholder={placeholder} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && add()} /><button type="button" className="btn-primary shrink-0" onClick={add}><Plus className="h-4 w-4" />新增</button></div></div>{loading ? <div className="p-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand-500" /></div> : <div className="divide-y divide-slate-100">{children}</div>}</section>;
}

function Row({ name, editing, editValue, onEdit, onEditChange, onSave, onCancel, onDelete }: { name: string; editing: boolean; editValue: string; onEdit: () => void; onEditChange: (name: string) => void; onSave: () => void; onCancel: () => void; onDelete: () => void }) {
  return <div className="flex items-center gap-3 px-5 py-3">{editing ? <><input className="input flex-1 py-1.5" value={editValue} onChange={(event) => onEditChange(event.target.value)} /><button type="button" aria-label="保存" onClick={onSave} className="rounded-md p-2 text-emerald-600 hover:bg-emerald-50"><Save className="h-4 w-4" /></button><button type="button" aria-label="取消" onClick={onCancel} className="rounded-md p-2 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button></> : <><span className="flex-1 text-sm font-medium">{name}</span><button type="button" aria-label="编辑" onClick={onEdit} className="rounded-md p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"><Pencil className="h-4 w-4" /></button><button type="button" aria-label="删除" onClick={onDelete} className="rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button></>}</div>;
}
