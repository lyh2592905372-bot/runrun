import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server-auth';
import { calculateProgressFromOrderTime } from '@/lib/order-progress';
import { readProgressRecords } from '@/lib/order-progress-server';

export async function GET(request: NextRequest) {
  const { supabase, response } = await requireAdmin();
  if (response) return response;
  const params = request.nextUrl.searchParams;
  const parsed = z.object({
    page: z.coerce.number().int().min(1).max(100000),
    username: z.string().trim().max(254).default(''),
    email: z.string().trim().max(254).default(''),
    user_id: z.string().uuid().optional(),
  }).safeParse({
    page: params.get('page') || 1,
    username: params.get('username') || '',
    email: params.get('email') || '',
    // Retain the legacy parameter for existing callers; the UI uses username/email.
    user_id: params.get('username')?.trim() || params.get('email')?.trim() ? undefined : params.get('user_id') || undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: '查询参数无效' }, { status: 400 });
  const { page, username, email, user_id } = parsed.data;
  let query = supabase.from('accounts').select('id,user_id,username,order_count,order_time,distance_per_run,created_at,owner:profiles(email,display_name),category:account_categories(name),school:schools(name),progress(*),sport_world_accounts(last_sync_status,last_sync_at,sync_enabled)', { count: 'exact' }).is('deleted_at', null).order('created_at', { ascending: false }).order('id');
  if (username || email) {
    // Quote values so commas, quotes and parentheses remain search text rather than filters.
    const pattern = (value: string) => JSON.stringify(`%${value.replace(/[\\%_]/g, '\\$&')}%`);
    const filters = [username && `display_name.ilike.${pattern(username)}`, email && `email.ilike.${pattern(email)}`].filter(Boolean);
    // Filter the related profile and exclude accounts without a matching owner before pagination/counting.
    query = query.or(filters.join(','), { referencedTable: 'owner' }).not('owner', 'is', null);
  } else if (user_id) query = query.eq('user_id', user_id);
  const [users, activeUsers, accounts, syncs, records, rows] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('accounts').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    supabase.from('sport_world_sync_logs').select('id', { count: 'exact', head: true }),
    supabase.from('sport_world_run_records').select('id', { count: 'exact', head: true }),
    query.range((page - 1) * 25, page * 25 - 1),
  ]);
  if ([users, activeUsers, accounts, syncs, records, rows].some(r => r.error)) return NextResponse.json({ error: '系统统计读取失败' }, { status: 500 });
  try {
    const runs = await readProgressRecords(supabase, (rows.data || []).map(a => a.id));
    return NextResponse.json({ stats: { users: users.count || 0, activeUsers: activeUsers.count || 0, accounts: accounts.count || 0, syncs: syncs.count || 0, records: records.count || 0 },
      accounts: (rows.data || []).map(a => ({ ...a, order_progress: calculateProgressFromOrderTime(a, runs.filter(r => r.account_record_id === a.id), Array.isArray(a.progress) ? a.progress[0] || {} : a.progress || {}) })),
      total: rows.count || 0, page, pageSize: 25 });
  } catch { return NextResponse.json({ error: '系统进度读取失败' }, { status: 500 }); }
}
