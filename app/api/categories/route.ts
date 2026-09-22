import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { configurationError, findConfigurationByName } from '@/lib/configuration-crud';
import { requireUser } from '@/lib/server-auth';

const schema = z.object({ name: z.string().trim().min(1).max(120), color: z.string().optional().default('#5b5bd6') });

export async function GET() {
  const { supabase, response } = await requireUser();
  if (response) return response;
  const { data, error } = await supabase.from('account_categories').select('*').order('name');
  if (error) return NextResponse.json({ error: '加载账号分类失败' }, { status: 500 });
  return NextResponse.json({ categories: data || [] });
}

export async function POST(request: NextRequest) {
  const { supabase, response } = await requireUser();
  if (response) return response;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: '分类名称不能为空' }, { status: 400 });
  try {
    const existing = await findConfigurationByName(supabase, 'account_categories', parsed.data.name);
    if (existing) return NextResponse.json({ category: existing });
    const { data, error } = await supabase.from('account_categories').insert(parsed.data).select().single();
    if (error) throw error;
    return NextResponse.json({ category: data }, { status: 201 });
  } catch (error) {
    configurationError('create category', error);
    return NextResponse.json({ error: '添加账号分类失败，请稍后重试' }, { status: 500 });
  }
}
