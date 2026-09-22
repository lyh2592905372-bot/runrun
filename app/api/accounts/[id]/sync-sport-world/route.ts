import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server-auth';
import { syncErrorResponse, syncSportWorldAccount } from '@/lib/sport-world/sync';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, user, response } = await requireUser();
  if (response || !user) return response!;
  try {
    const result = await syncSportWorldAccount(supabase, id);
    await supabase.from('operation_logs').insert({ user_id: user.id, action_type: 'sync_sport_world', target_type: 'account', target_id: id, description: `立即同步运动世界账号，更新 ${result.recordsReceived} 条记录` });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const result = syncErrorResponse(error);
    await supabase.from('operation_logs').insert({ user_id: user.id, action_type: 'sync_sport_world_failed', target_type: 'account', target_id: id, description: `运动世界同步失败：${result.code}` });
    return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
  }
}
