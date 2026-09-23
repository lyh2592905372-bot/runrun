import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { configurationError, deduplicateConfigurationsByName, findConfigurationByName } from '@/lib/configuration-crud';
import { requireUser } from '@/lib/server-auth';

const schema = z.object({ name: z.string().trim().min(1).max(120) });

export async function GET() {
  const { supabase, response } = await requireUser();
  if (response) return response;
  const { data, error } = await supabase.from('schools').select('*,category:account_categories(*)').order('name');
  if (error) return NextResponse.json({ error: '加载学校失败' }, { status: 500 });
  return NextResponse.json({ schools: deduplicateConfigurationsByName(data || [], 'category_id') });
}

export async function POST(request: NextRequest) {
  const { supabase, response } = await requireUser();
  if (response) return response;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: '请填写学校名称' }, { status: 400 });
  try {
    const existing = await findConfigurationByName(supabase, 'schools', parsed.data.name);
    if (existing) return NextResponse.json({ school: existing });
    const { data, error } = await supabase.from('schools').insert({ ...parsed.data, category_id: null }).select().single();
    if (error) throw error;
    return NextResponse.json({ school: data }, { status: 201 });
  } catch (error) {
    configurationError('create school', error);
    return NextResponse.json({ error: '添加学校失败，请稍后重试' }, { status: 500 });
  }
}
