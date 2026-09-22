import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { configurationError, findConfigurationByName } from '@/lib/configuration-crud';
import { requireUser } from '@/lib/server-auth';

const schema = z.object({ name: z.string().trim().min(1).max(120), category_id: z.string().uuid() });

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, response } = await requireUser();
  if (response) return response;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: '请选择账号分类并填写学校名称' }, { status: 400 });
  try {
    const duplicate = await findConfigurationByName(supabase, 'schools', parsed.data.name);
    if (duplicate && duplicate.id !== id) return NextResponse.json({ error: '已存在同名学校' }, { status: 409 });
    const { error } = await supabase.from('schools').update(parsed.data).eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    configurationError('update school', error);
    return NextResponse.json({ error: '保存学校失败，请稍后重试' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, response } = await requireUser();
  if (response) return response;
  const { error } = await supabase.from('schools').delete().eq('id', id);
  if (error) {
    configurationError('delete school', error);
    return NextResponse.json({ error: '删除学校失败，请稍后重试' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
