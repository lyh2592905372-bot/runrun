import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/server-auth';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, response } = await requireUser();
  if (response) return response;
  const q = request.nextUrl.searchParams;
  const page = Math.max(1, Number(q.get('page') || 1));
  const pageSize = Math.min(100, Math.max(1, Number(q.get('pageSize') || 20)));
  let query = supabase.from('sport_world_run_records').select('*', { count: 'exact' }).eq('account_record_id', id).order('start_time', { ascending: false });
  if (q.get('valid') === 'true' || q.get('valid') === 'false') query = query.eq('is_valid', q.get('valid') === 'true');
  if (q.get('from')) query = query.gte('run_date', q.get('from')!);
  if (q.get('to')) query = query.lte('run_date', q.get('to')!);
  const from = (page - 1) * pageSize;
  const { data, count, error } = await query.range(from, from + pageSize - 1);
  if (error) return NextResponse.json({ error: '跑步记录读取失败' }, { status: 500 });
  return NextResponse.json({ records: data || [], total: count || 0, page, pageSize });
}
