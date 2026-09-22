import { type NextRequest, NextResponse } from 'next/server';
import { encryptSecret, encryptSportSecret } from '@/lib/encryption';
import { requireUser } from '@/lib/server-auth';
import { validateAccountHierarchy } from '@/lib/account-hierarchy';
import { accountInputSchema } from '@/lib/account-input';
import { ConfigurationResolutionError, resolveAccountConfiguration } from '@/lib/configuration-resolution';

function accountSaveError(error: unknown) {
  if (error instanceof ConfigurationResolutionError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (process.env.NODE_ENV === 'development') console.error(error);
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code === '23505') return NextResponse.json({ error: '该学校下已存在相同账号' }, { status: 409 });
  return NextResponse.json({ error: '保存账号失败，请稍后重试' }, { status: 500 });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, user, response } = await requireUser();
  if (response) return response;
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const body = accountInputSchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message || '参数错误' }, { status: 400 });

  try {
    const configuration = await resolveAccountConfiguration(supabase, body.data);
    const { password, sport_account, sport_password, category: _category, school: _school, running_type: _runningType, face_option: _faceOption, ...accountFields } = body.data;
    const values = { ...accountFields, ...configuration };
    const hierarchyError = await validateAccountHierarchy(supabase, configuration);
    if (hierarchyError) return NextResponse.json({ error: hierarchyError }, { status: 400 });

    const update: Record<string, unknown> = { ...values };
    if (password) update.encrypted_password = encryptSecret(password);
    const { error } = await supabase.from('accounts').update(update).eq('id', id);
    if (error) throw error;
    const { data: existingSport } = await supabase.from('sport_world_accounts').select('id,sport_account,sport_password_encrypted').eq('account_record_id', id).maybeSingle();
    if (sport_account || sport_password) {
      if (!sport_account && !existingSport?.sport_account) return NextResponse.json({ error: '请填写运动世界账号' }, { status: 400 });
      const sportUpdate: Record<string, unknown> = { account_record_id: id, sport_account: sport_account || existingSport?.sport_account };
      if (sport_password) sportUpdate.sport_password_encrypted = encryptSportSecret(sport_password);
      if (!existingSport && !sport_password) return NextResponse.json({ error: '首次绑定需要填写运动世界密码' }, { status: 400 });
      const { error: sportError } = await supabase.from('sport_world_accounts').upsert(sportUpdate, { onConflict: 'account_record_id' });
      if (sportError) throw sportError;
    }
    await supabase.from('operation_logs').insert({ user_id: user.id, action_type: sport_account || sport_password ? 'edit_sport_world_binding' : 'edit_account', target_type: 'account', target_id: id, description: sport_account || sport_password ? '修改运动世界绑定信息' : password ? '编辑账号，密码已修改' : '编辑账号' });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return accountSaveError(error);
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, user, response } = await requireUser();
  if (response) return response;
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const { error } = await supabase.from('accounts').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await supabase.from('operation_logs').insert({ user_id: user.id, action_type: 'delete_account', target_type: 'account', target_id: id, description: '删除账号（软删除）' });
  return NextResponse.json({ ok: true });
}
