import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server-auth';

const schema = z.object({ role: z.enum(['admin', 'user', 'customer']).optional(), is_active: z.boolean().optional(), display_name: z.string().trim().min(1).max(80).optional() }).strict().refine(body => Object.keys(body).length > 0);
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { supabase, user, response } = await requireAdmin();
  if (response || !user) return response!;
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: '用户参数无效' }, { status: 400 });
  if (id === user.id && ((parsed.data.role === 'customer' || parsed.data.role === 'user') || parsed.data.is_active === false)) return NextResponse.json({ error: '不能禁用或降级当前管理员' }, { status: 409 });
  const { error } = await supabase.rpc('admin_update_user', {
    target_id: id, new_role: parsed.data.role ?? null, new_active: parsed.data.is_active ?? null, new_display_name: parsed.data.display_name ?? null,
  });
  if (error) return NextResponse.json({ error: error.code === 'P0002' ? '用户不存在' : '更新用户失败，请确认仍有管理员权限并保留至少一名启用的管理员' }, { status: error.code === 'P0002' ? 404 : error.code === '42501' ? 403 : 500 });
  return NextResponse.json({ ok: true });
}
