'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { AlertTriangle, Loader2, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/ui/page-header';
import { api } from '@/lib/api';
import type { Category, FaceOption, RunningType, School } from '@/lib/types';

type ConfigurationType = 'category' | 'school' | 'running_type' | 'face_option';
type EditState = { type: ConfigurationType; id: string; name: string; parentId?: string } | null;
type DeleteState = { type: ConfigurationType; id: string; name: string } | null;

const endpoints: Record<ConfigurationType, string> = {
  category: '/api/categories',
  school: '/api/schools',
  running_type: '/api/running-types',
  face_option: '/api/face-options',
};
const labels: Record<ConfigurationType, string> = {
  category: '账号分类',
  school: '学校',
  running_type: '跑步类型',
  face_option: '是否人脸选项',
};

export default function SettingsPage() {
  const deleteTitleId = useId();
  const [categories, setCategories] = useState<Category[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [runningTypes, setRunningTypes] = useState<RunningType[]>([]);
  const [faceOptions, setFaceOptions] = useState<FaceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [newValues, setNewValues] = useState<Record<ConfigurationType, string>>({ category: '', school: '', running_type: '', face_option: '' });
  const [parents, setParents] = useState({ schoolCategory: '', runningSchool: '', faceType: '' });
  const [edit, setEdit] = useState<EditState>(null);
  const [pendingDelete, setPendingDelete] = useState<DeleteState>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [categoryResult, schoolResult, typeResult, faceResult] = await Promise.all([
        api<{ categories: Category[] }>('/api/categories'),
        api<{ schools: School[] }>('/api/schools'),
        api<{ running_types: RunningType[] }>('/api/running-types'),
        api<{ face_options: FaceOption[] }>('/api/face-options'),
      ]);
      setCategories(categoryResult.categories);
      setSchools(schoolResult.schools);
      setRunningTypes(typeResult.running_types);
      setFaceOptions(faceResult.face_options);
      setParents((current) => ({
        schoolCategory: categoryResult.categories.some((item) => item.id === current.schoolCategory) ? current.schoolCategory : categoryResult.categories[0]?.id || '',
        runningSchool: schoolResult.schools.some((item) => item.id === current.runningSchool) ? current.runningSchool : schoolResult.schools[0]?.id || '',
        faceType: typeResult.running_types.some((item) => item.id === current.faceType) ? current.faceType : typeResult.running_types[0]?.id || '',
      }));
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
    const parent = type === 'school' ? parents.schoolCategory : type === 'running_type' ? parents.runningSchool : type === 'face_option' ? parents.faceType : '';
    if (type !== 'category' && !parent) return toast.error('请先选择上级选项');
    const body = type === 'category' ? { name } : type === 'school' ? { name, category_id: parent } : type === 'running_type' ? { name, school_id: parent } : { name, running_type_id: parent };
    try {
      await api(endpoints[type], { method: 'POST', body: JSON.stringify(body) });
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
    const body = edit.type === 'category' ? { name } : edit.type === 'school' ? { name, category_id: edit.parentId } : edit.type === 'running_type' ? { name, school_id: edit.parentId } : { name, running_type_id: edit.parentId };
    try {
      await api(`${endpoints[edit.type]}/${edit.id}`, { method: 'PATCH', body: JSON.stringify(body) });
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

  return <><PageHeader title="设置" description="按账号分类管理学校、跑步类型与是否人脸选项" /><div className="grid gap-6 xl:grid-cols-2"><SettingCard title="账号分类" placeholder="例如：主要账号" value={newValues.category} setValue={(value) => setNew('category', value)} add={() => add('category')} loading={loading}>{categories.map((category) => <Row key={category.id} name={category.name} editing={edit?.id === category.id} editValue={edit?.name || ''} onEdit={() => setEdit({ type: 'category', id: category.id, name: category.name })} onEditChange={(name) => setEdit((current) => current ? { ...current, name } : current)} onSave={saveEdit} onCancel={() => setEdit(null)} onDelete={() => setPendingDelete({ type: 'category', id: category.id, name: category.name })} />)}</SettingCard><SettingCard title="学校" placeholder="例如：UCLA" value={newValues.school} setValue={(value) => setNew('school', value)} add={() => add('school')} loading={loading} selector={<select className="input" value={parents.schoolCategory} onChange={(event) => setParents((current) => ({ ...current, schoolCategory: event.target.value }))}><option value="">选择账号分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>}>{schools.map((school) => <Row key={school.id} name={`${school.name}${school.category?.name ? ` · ${school.category.name}` : ''}`} editing={edit?.id === school.id} editValue={edit?.name || ''} editSelector={edit?.id === school.id ? <select className="input py-1.5" value={edit.parentId || ''} onChange={(event) => setEdit((current) => current ? { ...current, parentId: event.target.value } : current)}><option value="">选择账号分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select> : undefined} onEdit={() => setEdit({ type: 'school', id: school.id, name: school.name, parentId: school.category_id || categories[0]?.id })} onEditChange={(name) => setEdit((current) => current ? { ...current, name } : current)} onSave={saveEdit} onCancel={() => setEdit(null)} onDelete={() => setPendingDelete({ type: 'school', id: school.id, name: school.name })} />)}</SettingCard><SettingCard title="跑步类型" placeholder="例如：操场跑" value={newValues.running_type} setValue={(value) => setNew('running_type', value)} add={() => add('running_type')} loading={loading} selector={<select className="input" value={parents.runningSchool} onChange={(event) => setParents((current) => ({ ...current, runningSchool: event.target.value }))}><option value="">选择学校</option>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select>}>{runningTypes.map((type) => <Row key={type.id} name={`${type.name}${type.school?.name ? ` · ${type.school.name}` : ''}`} editing={edit?.id === type.id} editValue={edit?.name || ''} editSelector={edit?.id === type.id ? <select className="input py-1.5" value={edit.parentId || ''} onChange={(event) => setEdit((current) => current ? { ...current, parentId: event.target.value } : current)}><option value="">选择学校</option>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select> : undefined} onEdit={() => setEdit({ type: 'running_type', id: type.id, name: type.name, parentId: type.school_id || schools[0]?.id })} onEditChange={(name) => setEdit((current) => current ? { ...current, name } : current)} onSave={saveEdit} onCancel={() => setEdit(null)} onDelete={() => setPendingDelete({ type: 'running_type', id: type.id, name: type.name })} />)}</SettingCard><SettingCard title="是否人脸" placeholder="例如：需要人脸 / 不需要人脸" value={newValues.face_option} setValue={(value) => setNew('face_option', value)} add={() => add('face_option')} loading={loading} selector={<select className="input" value={parents.faceType} onChange={(event) => setParents((current) => ({ ...current, faceType: event.target.value }))}><option value="">选择跑步类型</option>{runningTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select>}>{faceOptions.map((option) => <Row key={option.id} name={`${option.name}${option.running_type?.name ? ` · ${option.running_type.name}` : ''}`} editing={edit?.id === option.id} editValue={edit?.name || ''} editSelector={edit?.id === option.id ? <select className="input py-1.5" value={edit.parentId || ''} onChange={(event) => setEdit((current) => current ? { ...current, parentId: event.target.value } : current)}><option value="">选择跑步类型</option>{runningTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select> : undefined} onEdit={() => setEdit({ type: 'face_option', id: option.id, name: option.name, parentId: option.running_type_id || runningTypes[0]?.id })} onEditChange={(name) => setEdit((current) => current ? { ...current, name } : current)} onSave={saveEdit} onCancel={() => setEdit(null)} onDelete={() => setPendingDelete({ type: 'face_option', id: option.id, name: option.name })} />)}</SettingCard></div><div className="card mt-6 p-5"><h2 className="font-semibold">安全与权限</h2><div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2"><div className="rounded-lg bg-emerald-50 p-3 text-emerald-700">✓ Supabase Auth 管理登录</div><div className="rounded-lg bg-emerald-50 p-3 text-emerald-700">✓ 普通顾客可自助注册</div><div className="rounded-lg bg-emerald-50 p-3 text-emerald-700">✓ 密码 AES-256-GCM 加密</div><div className="rounded-lg bg-emerald-50 p-3 text-emerald-700">✓ 查看密码写入审计日志</div></div></div>{pendingDelete && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" role="dialog" aria-modal="true" aria-labelledby={deleteTitleId}><div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600"><AlertTriangle className="h-5 w-5" /></div><div><h2 id={deleteTitleId} className="font-semibold text-slate-900">确认删除</h2><p className="mt-2 text-sm leading-6 text-slate-600">{deleteMessage}</p></div></div><div className="mt-6 flex justify-end gap-3"><button type="button" className="btn-secondary" disabled={deleting} onClick={() => setPendingDelete(null)}>取消</button><button type="button" className="btn-primary bg-rose-600 hover:bg-rose-700" disabled={deleting} onClick={confirmDelete}>{deleting && <Loader2 className="h-4 w-4 animate-spin" />}确认删除</button></div></div></div>}</>;
}

function SettingCard({ title, placeholder, value, setValue, add, loading, selector, children }: { title: string; placeholder: string; value: string; setValue: (value: string) => void; add: () => void; loading: boolean; selector?: React.ReactNode; children: React.ReactNode }) {
  return <section className="card overflow-hidden"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold">{title}</h2>{selector && <div className="mt-3">{selector}</div>}<div className="mt-3 flex gap-2"><input className="input" placeholder={placeholder} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && add()} /><button type="button" className="btn-primary shrink-0" onClick={add}><Plus className="h-4 w-4" />新增</button></div></div>{loading ? <div className="p-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand-500" /></div> : <div className="divide-y divide-slate-100">{children}</div>}</section>;
}

function Row({ name, editing, editValue, editSelector, onEdit, onEditChange, onSave, onCancel, onDelete }: { name: string; editing: boolean; editValue: string; editSelector?: React.ReactNode; onEdit: () => void; onEditChange: (name: string) => void; onSave: () => void; onCancel: () => void; onDelete: () => void }) {
  return <div className="flex items-center gap-3 px-5 py-3">{editing ? <><div className="grid flex-1 gap-2 sm:grid-cols-2"><input className="input py-1.5" value={editValue} onChange={(event) => onEditChange(event.target.value)} />{editSelector}</div><button type="button" aria-label="保存" onClick={onSave} className="rounded-md p-2 text-emerald-600 hover:bg-emerald-50"><Save className="h-4 w-4" /></button><button type="button" aria-label="取消" onClick={onCancel} className="rounded-md p-2 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button></> : <><span className="flex-1 text-sm font-medium">{name}</span><button type="button" aria-label="编辑" onClick={onEdit} className="rounded-md p-2 text-slate-400 hover:bg-brand-50 hover:text-brand-600"><Pencil className="h-4 w-4" /></button><button type="button" aria-label="删除" onClick={onDelete} className="rounded-md p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button></>}</div>;
}
