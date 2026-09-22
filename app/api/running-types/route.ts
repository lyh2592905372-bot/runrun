import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { configurationError, findConfigurationByName } from '@/lib/configuration-crud';
import { requireUser } from '@/lib/server-auth';

const schema = z.object({ school_id: z.string().uuid(), name: z.string().trim().min(1).max(120) });

export async function GET(request: NextRequest) {
  const { supabase, response } = await requireUser();
  if (response) return response;
  let query = supabase.from('running_types').select('*,school:schools(*)').order('name');
  const schoolId = request.nextUrl.searchParams.get('school_id');
  if (schoolId) query = query.eq('school_id', schoolId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: '加载跑步类型失败' }, { status: 500 });
  return NextResponse.json({ running_types: data || [] });
}

export async function POST(request: NextRequest) {
  const { supabase, response } = await requireUser();
  if (response) return response;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: '请选择学校并填写跑步类型' }, { status: 400 });
  try {
    const existing = await findConfigurationByName(supabase, 'running_types', parsed.data.name, { column: 'school_id', id: parsed.data.school_id });
    if (existing) return NextResponse.json({ running_type: existing });
    const { data, error } = await supabase.from('running_types').insert(parsed.data).select().single();
    if (error) throw error;
    return NextResponse.json({ running_type: data }, { status: 201 });
  } catch (error) {
    configurationError('create running type', error);
    return NextResponse.json({ error: '添加跑步类型失败，请稍后重试' }, { status: 500 });
  }
}
