import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server-auth';
import { syncErrorResponse, syncSportWorldAccount } from '@/lib/sport-world/sync';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, user, response } = await requireUser();
  if (response || !user) return response!;
  const { error } = await supabase.from('sport_world_accounts').update({ sport_token_encrypted: null, token_status: 'expired' }).eq('account_record_id', id);
  if (error) return NextResponse.json({ error: '重新认证准备失败' }, { status: 500 });
  try {
    const result = await syncSportWorldAccount(supabase, id);
    await supabase.from('operation_logs').insert({ user_id: user.id, action_type: 'reauth_sport_world', target_type: 'account', target_id: id, description: '重新认证运动世界账号' });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const result = syncErrorResponse(error);
    return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
  }
}
