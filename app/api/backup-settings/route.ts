import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server-auth';

const schema = z.object({
  auto_enabled: z.boolean(),
  frequency: z.enum(['daily', 'weekly', 'custom']),
  next_run_at: z.string().datetime().nullable(),
});

export async function GET() {
  const { supabase, response } = await requireAdmin();
  if (response) return response;
  const { data, error } = await supabase.from('backup_settings').select('*').eq('id', true).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data });
}

export async function PATCH(request: NextRequest) {
  const { supabase, user, response } = await requireAdmin();
  if (response || !user) return response!;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: '备份设置参数无效' }, { status: 400 });
  if (parsed.data.auto_enabled && !parsed.data.next_run_at) return NextResponse.json({ error: '请选择首次备份日期时间' }, { status: 400 });
  const values = { ...parsed.data, updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from('backup_settings').upsert({ id: true, ...values }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await supabase.from('operation_logs').insert({ user_id: user.id, action_type: 'update_backup_settings', target_type: 'backup', description: parsed.data.auto_enabled ? '启用并更新自动备份计划' : '关闭自动备份' });
  return NextResponse.json({ settings: data });
}
