import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { configurationError, findConfigurationByName } from '@/lib/configuration-crud';
import { requireUser } from '@/lib/server-auth';

const schema = z.object({ name: z.string().trim().min(1).max(120), running_type_id: z.string().uuid() });

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, response } = await requireUser();
  if (response) return response;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: '请选择跑步类型并填写是否人脸选项' }, { status: 400 });
  try {
    const duplicate = await findConfigurationByName(supabase, 'face_options', parsed.data.name, { column: 'running_type_id', id: parsed.data.running_type_id });
    if (duplicate && duplicate.id !== id) return NextResponse.json({ error: '该跑步类型下已存在同名人脸选项' }, { status: 409 });
    const { error } = await supabase.from('face_options').update(parsed.data).eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    configurationError('update face option', error);
    return NextResponse.json({ error: '保存是否人脸选项失败，请稍后重试' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, response } = await requireUser();
  if (response) return response;
  const { error } = await supabase.from('face_options').delete().eq('id', id);
  if (error) {
    configurationError('delete face option', error);
    return NextResponse.json({ error: '删除是否人脸选项失败，请稍后重试' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
