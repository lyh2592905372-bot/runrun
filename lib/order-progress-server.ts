import type { SupabaseClient } from '@supabase/supabase-js';
import { calculateProgressFromOrderTime, type ProgressRun } from './order-progress';

export async function readProgressRecords(supabase: SupabaseClient, accountIds: string[]): Promise<ProgressRun[]> {
  const records: ProgressRun[] = [];
  // Explicit pagination avoids PostgREST's result cap silently undercounting orders.
  for (let index = 0; index < accountIds.length; index += 100) {
    const ids = accountIds.slice(index, index + 100);
    for (let from = 0; ; from += 500) {
      const { data, error } = await supabase.from('sport_world_run_records')
        .select('account_record_id,sport_world_record_id,start_time,run_date,is_valid')
        .in('account_record_id', ids).eq('is_valid', true).order('id').range(from, from + 499);
      if (error) throw new Error('订单进度的运动记录读取失败');
      records.push(...(data || []));
      if ((data || []).length < 500) break;
    }
  }
  return records;
}

export async function refreshOrderProgressAfterSync(supabase: SupabaseClient, accountId: string) {
  // Re-read the current order: its time may have changed while remote sync ran.
  const { data: account, error } = await supabase.from('accounts')
    .select('id,order_time,order_count,distance_per_run').eq('id', accountId).is('deleted_at', null).single();
  if (error || !account) throw new Error('订单进度的账号读取失败');
  const progress = calculateProgressFromOrderTime(account, await readProgressRecords(supabase, [accountId]));
  const { error: saveError } = await supabase.from('progress').upsert({
    account_id: accountId,
    auto_completed_count: progress.autoCompletedCount,
    manual_override: false,
    manual_override_count: null,
    manual_override_order_time: null,
  }, { onConflict: 'account_id' });
  if (saveError) throw new Error('订单进度保存失败，请确认进度数据库迁移已执行');
  return progress;
}
