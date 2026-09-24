import type { Account } from './types';

type OrderAccount = Pick<Account, 'id' | 'order_time' | 'order_count' | 'distance_per_run'>;
export type ProgressRun = {
  account_record_id: string;
  sport_world_record_id: string;
  start_time?: string | null;
  run_date?: string | null;
  is_valid: boolean;
};
export type ManualProgress = {
  manual_override?: boolean | null;
  manual_override_count?: number | null;
  manual_override_order_time?: string | null;
};
export type OrderProgress = {
  autoCompletedCount: number;
  manualOverride: boolean;
  manualOverrideCount: number | null;
  finalCompletedCount: number;
  completedDistance: number;
  totalDistance: number;
  remainingCount: number;
  percent: number;
};
export type ProgressAccount = Account & { order_progress: OrderProgress };

// Only this calculation interprets timezone-less dates as Asia/Shanghai.
// Never substitute synced_at, created_at or updated_at for a run's actual time.
function occurrenceTime(value?: string | null): number {
  if (!value) return NaN;
  const text = value.trim().replace(' ', 'T');
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00+08:00`
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text) ? `${text}+08:00` : text;
  return Date.parse(normalized);
}

function nonnegativeInteger(value: number): number {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
}

export function calculateProgressCount(account: Pick<OrderAccount, 'id' | 'order_time'>, records: readonly ProgressRun[]): number {
  const orderTime = occurrenceTime(account.order_time);
  if (!Number.isFinite(orderTime)) return 0;
  const counted = new Set<string>();
  for (const record of records) {
    if (record.account_record_id !== account.id || record.is_valid !== true) continue;
    // A date-only record has day precision; use midnight, never the sync time.
    const runTime = occurrenceTime(record.start_time || record.run_date);
    if (Number.isFinite(runTime) && runTime >= orderTime) counted.add(record.sport_world_record_id);
  }
  return counted.size;
}

export function calculateProgressFromOrderTime(account: OrderAccount, records: readonly ProgressRun[] | number, manual: ManualProgress = {}): OrderProgress {
  // The numeric form is used only by the UI with the freshly calculated API result.
  const autoCompletedCount = typeof records === 'number' ? nonnegativeInteger(records) : calculateProgressCount(account, records);
  const targetCount = nonnegativeInteger(account.order_count);
  const manualOverride = (manual.manual_override ?? false) && manual.manual_override_count != null
    && Number.isFinite(manual.manual_override_count)
    && occurrenceTime(manual.manual_override_order_time) === occurrenceTime(account.order_time);
  const manualOverrideCount = manualOverride ? nonnegativeInteger(manual.manual_override_count!) : null;
  const finalCompletedCount = Math.min(targetCount, manualOverrideCount ?? autoCompletedCount);
  const distancePerRun = Number.isFinite(Number(account.distance_per_run)) ? Math.max(0, Number(account.distance_per_run)) : 0;
  return {
    autoCompletedCount, manualOverride, manualOverrideCount, finalCompletedCount,
    completedDistance: finalCompletedCount * distancePerRun,
    totalDistance: targetCount * distancePerRun,
    remainingCount: targetCount - finalCompletedCount,
    percent: targetCount ? Math.round(finalCompletedCount / targetCount * 10000) / 100 : 0,
  };
}

export function progressWithDraft(account: ProgressAccount, draft?: number): OrderProgress {
  const saved = account.order_progress;
  return calculateProgressFromOrderTime(account, saved.autoCompletedCount, {
    manual_override: draft !== undefined || saved.manualOverride,
    manual_override_count: draft ?? saved.manualOverrideCount,
    manual_override_order_time: account.order_time,
  });
}
