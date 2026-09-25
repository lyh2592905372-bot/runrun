import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// Keep customer compatible with existing profiles; user has the same limited permissions.
export type UserRole = 'user' | 'customer' | 'admin';

export async function requireUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { supabase, user: null, role: null, response: NextResponse.json({ error: '未登录' }, { status: 401 }) };
  // Roles are authoritative database values, never editable auth user_metadata.
  const { data: profile, error: profileError } = await supabase.from('profiles').select('role,is_active').eq('id', user.id).maybeSingle();
  if (profileError) return { supabase, user: null, role: null, response: NextResponse.json({ error: '用户权限读取失败，请确认权限迁移已执行' }, { status: 503 }) };
  if (!profile?.is_active || !['admin', 'user', 'customer'].includes(profile.role)) {
    return { supabase, user: null, role: null, response: NextResponse.json({ error: '账号未启用或无访问权限' }, { status: 403 }) };
  }
  return { supabase, user, role: profile.role as UserRole, response: null };
}

export async function requireAdmin() {
  const auth = await requireUser();
  if (auth.response) return auth;
  if (auth.role !== 'admin') return { ...auth, response: NextResponse.json({ error: '需要管理员权限' }, { status: 403 }) };
  return auth;
}

// Verify ownership before any account reads, writes, decryption or remote sync.
export async function requireAccount(id: string) {
  const auth = await requireUser();
  if (auth.response || !auth.user) return auth;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { ...auth, response: NextResponse.json({ error: '账号不存在' }, { status: 404 }) };
  }
  let query = auth.supabase.from('accounts').select('id').eq('id', id).is('deleted_at', null);
  if (auth.role !== 'admin') query = query.eq('user_id', auth.user.id);
  const { data, error } = await query.maybeSingle();
  if (error) return { ...auth, response: NextResponse.json({ error: '账号权限读取失败' }, { status: 503 }) };
  if (!data) return { ...auth, response: NextResponse.json({ error: '账号不存在' }, { status: 404 }) };
  return auth;
}
