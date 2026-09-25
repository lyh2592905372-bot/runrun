import { NextResponse } from 'next/server';
import { requireAccount } from '@/lib/server-auth';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, user, role, response } = await requireAccount(id);
  if (response || !user) return response!;
  let query = supabase.from('sport_world_accounts').update({ sport_account: '', sport_password_encrypted: null, sport_token_encrypted: null, sport_uid: null, sport_unid: null, token_status: 'unknown', sync_enabled: false, last_sync_status: 'never_synced', last_sync_error: null }).eq('account_record_id', id);
  if (role !== 'admin') query = query.eq('user_id', user.id);
  const { error } = await query;
  if (error) return NextResponse.json({ error: '解除绑定失败' }, { status: 500 });
  await supabase.from('operation_logs').insert({ user_id: user.id, action_type: 'unbind_sport_world', target_type: 'account', target_id: id, description: '解除运动世界账号绑定，历史记录保留' });
  return NextResponse.json({ ok: true });
}
