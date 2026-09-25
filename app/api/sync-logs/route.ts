import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/server-auth';
import { z } from 'zod';
export async function GET(request: NextRequest) {
  const { supabase, user, role, response } = await requireUser();
  if (response || !user) return response!;
  const page = z.coerce.number().int().min(1).max(100000).safeParse(request.nextUrl.searchParams.get('page') || 1);
  if (!page.success) return NextResponse.json({ error: '页码无效' }, { status: 400 });
  let query = supabase.from('sport_world_sync_logs')
    .select('id,account_record_id,started_at,finished_at,status,records_received,error_code,error_message,account:accounts(username)', { count: 'exact' });
  if (role !== 'admin') query = query.eq('user_id', user.id);
  const { data, count, error } = await query.order('started_at', { ascending: false }).order('id').range((page.data - 1) * 25, page.data * 25 - 1);
  if (error) return NextResponse.json({ error: '同步记录读取失败' }, { status: 500 });
  return NextResponse.json({ logs: data || [], total: count || 0, page: page.data, pageSize: 25 });
}
