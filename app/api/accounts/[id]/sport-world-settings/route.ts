import { NextRequest, NextResponse } from 'next/server';
import { requireAccount } from '@/lib/server-auth';

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, user, role, response } = await requireAccount(id);
  if (response || !user) return response!;
  const body = await request.json();
  if (typeof body.sync_enabled !== 'boolean') return NextResponse.json({ error: '参数错误' }, { status: 400 });
  let query = supabase.from('sport_world_accounts').update({ sync_enabled: body.sync_enabled }).eq('account_record_id', id);
  if (role !== 'admin') query = query.eq('user_id', user.id);
  const { error } = await query;
  if (error) return NextResponse.json({ error: '自动同步设置失败' }, { status: 500 });
  await supabase.from('operation_logs').insert({ user_id: user.id, action_type: body.sync_enabled ? 'enable_sport_world_auto_sync' : 'disable_sport_world_auto_sync', target_type: 'account', target_id: id, description: body.sync_enabled ? '开启运动世界自动同步' : '关闭运动世界自动同步' });
  return NextResponse.json({ ok: true, sync_enabled: body.sync_enabled });
}
