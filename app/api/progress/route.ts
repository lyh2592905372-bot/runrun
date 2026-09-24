import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/server-auth';
import { calculateProgressFromOrderTime, type ProgressRun } from '@/lib/order-progress';
import { readProgressRecords } from '@/lib/order-progress-server';

export async function GET() {
  const { supabase, response } = await requireUser();
  if (response) return response;
  const { data, error } = await supabase.from('accounts').select('id,username,campus_name,student_name,student_id,category:account_categories(*),school:schools(*),distance_per_run,order_count,order_time,progress(*),sport_world_accounts(id,account_record_id,sport_account,sport_password_encrypted,sport_uid,token_status,sync_enabled,last_sync_at,last_sync_status,last_sync_error,current_semester,semester_started_at,semester_ended_at,completion_status,target_runs,target_distance,completed_runs,completed_distance,latest_run_at,latest_run_distance,manual_run_adjustment,manual_distance_adjustment,sync_started_at)').is('deleted_at', null).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try {
    const records = await readProgressRecords(supabase, (data || []).map((account) => account.id));
    const byAccount = new Map<string, ProgressRun[]>();
    for (const record of records) {
      const rows = byAccount.get(record.account_record_id) || [];
      rows.push(record);
      byAccount.set(record.account_record_id, rows);
    }
    const accounts = (data || []).map((account: any) => {
      const manual = Array.isArray(account.progress) ? account.progress[0] : account.progress;
      const order_progress = calculateProgressFromOrderTime(account, byAccount.get(account.id) || [], manual || {});
      const sport = Array.isArray(account.sport_world_accounts) ? account.sport_world_accounts[0] : account.sport_world_accounts;
      if (!sport) return { ...account, order_progress, sport_world_accounts: null };
      const hasSportPassword = Boolean(sport.sport_password_encrypted);
      const { sport_password_encrypted: _sportPasswordEncrypted, ...safeSport } = sport;
      return { ...account, order_progress, sport_world_accounts: { ...safeSport, has_sport_password: hasSportPassword } };
    });
    return NextResponse.json({ accounts });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '订单进度读取失败' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const { supabase, user, response } = await requireUser();
  if (response || !user) return response!;
  const { account_id, completed_runs } = await request.json();
  const { data: account } = await supabase.from('accounts').select('order_count,order_time,username').eq('id', account_id).single();
  if (!account || !Number.isInteger(completed_runs) || completed_runs < 0 || completed_runs > account.order_count) return NextResponse.json({ error: `已跑次数必须在 0-${account?.order_count || 0} 之间` }, { status: 400 });
  const { error } = await supabase.from('progress').upsert({
    account_id,
    manual_override: true,
    manual_override_count: completed_runs,
    manual_override_order_time: account.order_time,
  }, { onConflict: 'account_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await supabase.from('operation_logs').insert({ user_id: user.id, action_type: 'update_progress', target_type: 'account', target_id: account_id, description: `修改 ${account.username} 最终已跑次数为 ${completed_runs}` });
  return NextResponse.json({ ok: true, completed: completed_runs === account.order_count });
}
