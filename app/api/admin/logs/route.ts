import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
export async function GET(request: NextRequest) {
  const { supabase, response } = await requireAdmin();
  if (response) return response;
  let query = supabase.from('operation_logs').select('*,profiles(display_name,email)').order('created_at', { ascending: false }).limit(200);
  const search = request.nextUrl.searchParams.get('search');
  if (search) query = query.ilike('description', `%${search.slice(0, 200)}%`);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: '系统日志读取失败' }, { status: 500 });
  return NextResponse.json({ logs: data || [] });
}
