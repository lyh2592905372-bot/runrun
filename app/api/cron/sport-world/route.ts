import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncErrorResponse, syncSportWorldAccount } from '@/lib/sport-world/sync';

export async function POST(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || authorization !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: '未授权' }, { status: 401 });
  const supabase = createAdminClient();
  const { data: bindings, error } = await supabase.from('sport_world_accounts').select('account_record_id').eq('sync_enabled', true).neq('sport_account', '').limit(100);
  if (error) return NextResponse.json({ error: '自动同步任务读取失败' }, { status: 500 });
  const results: Array<{ id: string; ok: boolean; code?: string }> = [];
  for (let index = 0; index < (bindings || []).length; index += 2) {
    const batch = (bindings || []).slice(index, index + 2);
    const settled = await Promise.all(batch.map(async ({ account_record_id }) => {
      try { await syncSportWorldAccount(supabase, account_record_id); return { id: account_record_id, ok: true }; }
      catch (syncError) { return { id: account_record_id, ok: false, code: syncErrorResponse(syncError).code }; }
    }));
    results.push(...settled);
  }
  return NextResponse.json({ ok: true, total: results.length, success: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, results });
}
