import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { configurationError, findConfigurationByName } from '@/lib/configuration-crud';
import { requireUser } from '@/lib/server-auth';

const schema = z.object({ running_type_id: z.string().uuid(), name: z.string().trim().min(1).max(120) });

export async function GET(request: NextRequest) {
  const { supabase, response } = await requireUser();
  if (response) return response;
  let query = supabase.from('face_options').select('*,running_type:running_types(*)').order('name');
  const runningTypeId = request.nextUrl.searchParams.get('running_type_id');
  if (runningTypeId) query = query.eq('running_type_id', runningTypeId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: '加载是否人脸选项失败' }, { status: 500 });
  return NextResponse.json({ face_options: data || [] });
}

export async function POST(request: NextRequest) {
  const { supabase, response } = await requireUser();
  if (response) return response;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: '请选择跑步类型并填写是否人脸选项' }, { status: 400 });
  try {
    const existing = await findConfigurationByName(supabase, 'face_options', parsed.data.name, { column: 'running_type_id', id: parsed.data.running_type_id });
    if (existing) return NextResponse.json({ face_option: existing });
    const { data, error } = await supabase.from('face_options').insert(parsed.data).select().single();
    if (error) throw error;
    return NextResponse.json({ face_option: data }, { status: 201 });
  } catch (error) {
    configurationError('create face option', error);
    return NextResponse.json({ error: '添加是否人脸选项失败，请稍后重试' }, { status: 500 });
  }
}
