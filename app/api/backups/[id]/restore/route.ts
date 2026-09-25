import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server-auth';
import { restoreAccountOwners } from '@/lib/backup-ownership';

const record = z.object({ id: z.string().uuid() }).passthrough();
const snapshotSchema = z.object({
  schools: z.array(record), categories: z.array(record), running_types: z.array(record).optional(), face_options: z.array(record).optional(),
  accounts: z.array(record.extend({ user_id: z.string().uuid().nullish() })),
  progress: z.array(record.extend({ account_id: z.string().uuid(), user_id: z.string().uuid().nullish() })),
  backup_settings: z.array(z.object({ id: z.boolean() }).passthrough()).optional(),
});

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, user, response } = await requireAdmin();
  if (response || !user) return response!;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: '备份不存在' }, { status: 404 });
  const { data: backup, error } = await supabase.from('backups').select('file_path,created_by').eq('id', id).single();
  if (error || !backup) return NextResponse.json({ error: '备份不存在' }, { status: 404 });
  const { data: file, error: downloadError } = await supabase.storage.from('backups').download(backup.file_path);
  if (downloadError || !file) return NextResponse.json({ error: '无法读取备份文件' }, { status: 500 });
  try {
    const parsed = snapshotSchema.safeParse(JSON.parse(await file.text()));
    if (!parsed.success) return NextResponse.json({ error: '备份格式不正确' }, { status: 400 });
    const snapshot = parsed.data;
    const existing: { id: string; user_id: string }[] = [];
    const referencedIds = Array.from(new Set([...snapshot.accounts.map(a => a.id), ...snapshot.progress.map(p => p.account_id)]));
    for (let i = 0; i < referencedIds.length; i += 100) {
      const { data, error: ownerError } = await supabase.from('accounts').select('id,user_id').in('id', referencedIds.slice(i, i + 100));
      if (ownerError) return NextResponse.json({ error: '账号归属读取失败，恢复已取消' }, { status: 500 });
      existing.push(...(data || []));
    }
    const accounts = restoreAccountOwners(snapshot.accounts, existing, backup.created_by || user.id);
    const owners = new Map([...existing, ...accounts].map(a => [a.id, a.user_id]));
    for (const progress of snapshot.progress) {
      const owner = owners.get(progress.account_id);
      if (!owner || (progress.user_id && progress.user_id !== owner)) return NextResponse.json({ error: '备份进度归属不一致，恢复已取消' }, { status: 409 });
      progress.user_id = owner;
    }
    const writes: [string, Record<string, unknown>[] | undefined][] = [
      ['account_categories', snapshot.categories], ['schools', snapshot.schools],
      ['running_types', snapshot.running_types], ['face_options', snapshot.face_options],
      ['accounts', accounts], ['progress', snapshot.progress], ['backup_settings', snapshot.backup_settings],
    ];
    for (const [table, values] of writes) {
      if (!values?.length) continue;
      const { error: writeError } = await supabase.from(table).upsert(values);
      if (writeError) return NextResponse.json({ error: `恢复 ${table} 失败，请检查备份的数据完整性` }, { status: 500 });
    }
    await supabase.from('operation_logs').insert({ user_id: user.id, action_type: 'restore_backup', target_type: 'backup', target_id: id, description: '恢复数据备份' });
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '备份读取失败' }, { status: 400 }); }
}
