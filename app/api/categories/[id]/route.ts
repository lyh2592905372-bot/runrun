import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { configurationError, findConfigurationByName } from '@/lib/configuration-crud';
import { requireAdmin } from '@/lib/server-auth';

const schema = z.object({ name: z.string().trim().min(1).max(120), color: z.string().optional() });

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, response } = await requireAdmin();
  if (response) return response;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: '分类名称不能为空' }, { status: 400 });
  try {
    const duplicate = await findConfigurationByName(supabase, 'account_categories', parsed.data.name);
    if (duplicate && duplicate.id !== id) return NextResponse.json({ error: '已存在同名账号分类' }, { status: 409 });
    const values = parsed.data.color ? parsed.data : { name: parsed.data.name };
    const { error } = await supabase.from('account_categories').update(values).eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    configurationError('update category', error);
    return NextResponse.json({ error: '保存账号分类失败，请稍后重试' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, response } = await requireAdmin();
  if (response) return response;
  const { error } = await supabase.from('account_categories').delete().eq('id', id);
  if (error) {
    configurationError('delete category', error);
    return NextResponse.json({ error: '删除账号分类失败，请稍后重试' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
