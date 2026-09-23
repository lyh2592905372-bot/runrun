import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { configurationError, findConfigurationByName, findConfigurationsByName } from '@/lib/configuration-crud';
import { requireUser } from '@/lib/server-auth';

const schema = z.object({ name: z.string().trim().min(1).max(120) });

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, response } = await requireUser();
  if (response) return response;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: '请填写跑步类型' }, { status: 400 });
  try {
    const { data: current, error: currentError } = await supabase.from('running_types').select('name').eq('id', id).maybeSingle();
    if (currentError) throw currentError;
    if (!current) return NextResponse.json({ error: '跑步类型不存在' }, { status: 404 });
    const aliases = await findConfigurationsByName(supabase, 'running_types', current.name);
    const duplicate = await findConfigurationByName(supabase, 'running_types', parsed.data.name);
    if (duplicate && !aliases.some((item) => item.id === duplicate.id)) return NextResponse.json({ error: '已存在同名跑步类型' }, { status: 409 });
    const { error } = await supabase.from('running_types').update(parsed.data).in('id', aliases.map((item) => item.id));
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
  try {
    const { data: current, error: currentError } = await supabase.from('running_types').select('name').eq('id', id).maybeSingle();
    if (currentError) throw currentError;
    if (!current) return NextResponse.json({ ok: true });
    const aliases = await findConfigurationsByName(supabase, 'running_types', current.name);
    const { error } = await supabase.from('running_types').delete().in('id', aliases.map((item) => item.id));
    if (error) throw error;
  } catch (error) {
    configurationError('delete running type', error);
    return NextResponse.json({ error: '删除跑步类型失败，请稍后重试' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
