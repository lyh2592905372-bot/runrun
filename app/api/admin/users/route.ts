import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server-auth';
import { createAdminClient } from '@/lib/supabase/admin';

const createSchema = z.object({
  email: z.string().trim().email().max(254), password: z.string().min(8).max(128),
  display_name: z.string().trim().min(1).max(80), role: z.enum(['user', 'customer', 'admin']).default('customer'),
}).strict();

export async function GET(request: NextRequest) {
  const { supabase, user, response } = await requireAdmin();
  if (response || !user) return response!;
  const q = request.nextUrl.searchParams;
  const parsed = z.coerce.number().int().min(1).max(100000).safeParse(q.get('page') || 1);
  if (!parsed.success) return NextResponse.json({ error: '页码无效' }, { status: 400 });
  const page = parsed.data;
  let query = supabase.from('profiles').select('id,email,display_name,role,is_active,created_at', { count: 'exact' }).order('created_at', { ascending: false }).order('id');
  if (q.get('search')) query = query.ilike('email', `%${q.get('search')!.slice(0, 254)}%`);
  const { data, count, error } = await query.range((page - 1) * 25, page * 25 - 1);
  if (error) return NextResponse.json({ error: '用户列表读取失败' }, { status: 500 });
  return NextResponse.json({ users: data || [], total: count || 0, page, pageSize: 25, currentUserId: user.id });
}

export async function POST(request: NextRequest) {
  const { supabase, user, response } = await requireAdmin();
  if (response || !user) return response!;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '请填写姓名、有效邮箱和至少 8 位密码' }, { status: 400 });
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({ email: parsed.data.email, password: parsed.data.password, email_confirm: true, user_metadata: { display_name: parsed.data.display_name } });
  if (error || !data.user) return NextResponse.json({ error: '创建用户失败，请检查邮箱是否已注册' }, { status: 400 });
  if (parsed.data.role === 'admin') {
    const { error: roleError } = await supabase.rpc('admin_update_user', { target_id: data.user.id, new_role: 'admin' });
    if (roleError) return NextResponse.json({ error: '用户已创建为普通客户，管理员权限设置失败，请在用户列表重试', id: data.user.id }, { status: 409 });
  }
  await supabase.from('operation_logs').insert({ user_id: user.id, action_type: 'create_user', target_type: 'user', target_id: data.user.id, description: '管理员创建用户' });
  return NextResponse.json({ id: data.user.id }, { status: 201 });
}
