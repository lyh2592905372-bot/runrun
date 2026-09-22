import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { configurationError, findConfigurationByName } from '@/lib/configuration-crud';
import { requireUser } from '@/lib/server-auth';

const schema = z.object({ name: z.string().trim().min(1).max(120), school_id: z.string().uuid() });

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, response } = await requireUser();
  if (response) return response;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: '请选择学校并填写跑步类型' }, { status: 400 });
  try {
    const duplicate = await findConfigurationByName(supabase, 'running_types', parsed.data.name, { column: 'school_id', id: parsed.data.school_id });
    if (duplicate && duplicate.id !== id) return NextResponse.json({ error: '该学校下已存在同名跑步类型' }, { status: 409 });
    const { error } = await supabase.from('running_types').update(parsed.data).eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    configurationError('update running type', error);
    return NextResponse.json({ error: '保存跑步类型失败，请稍后重试' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, response } = await requireUser();
  if (response) return response;
  const { error } = await supabase.from('running_types').delete().eq('id', id);
  if (error) {
    configurationError('delete running type', error);
    return NextResponse.json({ error: '删除跑步类型失败，请稍后重试' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
