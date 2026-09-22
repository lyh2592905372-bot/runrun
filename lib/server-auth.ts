import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function requireUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { supabase, user: null, response: NextResponse.json({ error: '未登录' }, { status: 401 }) };
  return { supabase, user, response: null };
}
