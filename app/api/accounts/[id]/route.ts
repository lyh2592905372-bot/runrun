import { type NextRequest, NextResponse } from 'next/server';
import { encryptSecret, encryptSportSecret } from '@/lib/encryption';
import { requireAccount } from '@/lib/server-auth';
import { validateAccountHierarchy } from '@/lib/account-hierarchy';
import { accountFieldsFromInput, accountInputSchema } from '@/lib/account-input';
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
  const { supabase, user, role, response } = await requireAccount(id);
  if (response) return response;
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const body = accountInputSchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message || '参数错误' }, { status: 400 });

  try {
    let existingAccountQuery = supabase.from('accounts').select('id,user_id,username,encrypted_password,school_id,running_type_id,face_option_id,order_time,running_time').eq('id', id);
    if (role !== 'admin') existingAccountQuery = existingAccountQuery.eq('user_id', user.id);
    const { data: existingAccount, error: existingAccountError } = await existingAccountQuery.single();
    if (existingAccountError || !existingAccount) return NextResponse.json({ error: '账号不存在' }, { status: 404 });
    const configuration = await resolveAccountConfiguration(supabase, body.data);
    if (body.data.running_type === null && existingAccount.school_id === configuration.school_id) {
      configuration.running_type_id = existingAccount.running_type_id;
      configuration.face_option_id = existingAccount.face_option_id;
    }
    const hierarchyError = await validateAccountHierarchy(supabase, configuration);
    if (hierarchyError) return NextResponse.json({ error: hierarchyError }, { status: 400 });

    const [{ data: categoryRecord, error: categoryError }, { data: existingSport, error: existingSportError }] = await Promise.all([
      supabase.from('account_categories').select('name').eq('id', configuration.category_id).single(),
      supabase.from('sport_world_accounts').select('id,sport_account,sport_password_encrypted').eq('account_record_id', id).maybeSingle(),
    ]);
    if (categoryError) throw categoryError;
    if (existingSportError) throw existingSportError;
    const isSportWorld = categoryRecord.name === '运动世界';
    const isAlipaySunshine = categoryRecord.name === '支付宝阳光跑';
    const inputUsername = body.data.username;
    const username = isAlipaySunshine ? inputUsername || existingAccount.username : inputUsername;
    if (!username) return NextResponse.json({ error: '账号不能为空' }, { status: 400 });
    const { password, sport_account, sport_password } = body.data;
    const accountFields = accountFieldsFromInput(body.data);
    const values = { ...accountFields, username, ...configuration };
    const explicitlyUnbound = Boolean(existingSport && !existingSport.sport_account);
    const accountChanged = username !== existingAccount.username;
    const passwordChanged = Boolean(password);
    const shouldSaveSportCredentials = isSportWorld
      ? !explicitlyUnbound || accountChanged || passwordChanged
      : Boolean(existingSport) || Boolean(sport_account || sport_password);
    const legacyLoginAccount = existingSport && username === existingAccount.username ? existingSport.sport_account : username;
    const loginAccount = isSportWorld ? username : existingSport ? legacyLoginAccount : sport_account;
    const loginPassword = isSportWorld || existingSport ? password : sport_password;
    if (shouldSaveSportCredentials && !loginAccount) return NextResponse.json({ error: '请填写运动世界账号' }, { status: 400 });
    if (shouldSaveSportCredentials && !existingSport && !loginPassword && !existingAccount.encrypted_password) return NextResponse.json({ error: '首次绑定需要填写运动世界密码' }, { status: 400 });
    if (shouldSaveSportCredentials && explicitlyUnbound && accountChanged && !loginPassword) return NextResponse.json({ error: '重新绑定需要填写运动世界密码' }, { status: 400 });

    const update: Record<string, unknown> = { ...values };
    if (existingAccount.order_time && new Date(existingAccount.order_time).getTime() === new Date(body.data.order_time).getTime()) delete update.order_time;
    if (body.data.running_time === undefined || existingAccount.running_time === body.data.running_time) delete update.running_time;
    if (password) update.encrypted_password = encryptSecret(password);
    let updateQuery = supabase.from('accounts').update(update).eq('id', id);
    if (role !== 'admin') updateQuery = updateQuery.eq('user_id', user.id);
    const { error } = await updateQuery;
    if (error) throw error;
    if (shouldSaveSportCredentials) {
      const sportUpdate: Record<string, unknown> = { account_record_id: id, user_id: existingAccount.user_id, sport_account: loginAccount };
      if (loginPassword) sportUpdate.sport_password_encrypted = encryptSportSecret(loginPassword);
      if (isSportWorld && (loginAccount !== existingSport?.sport_account || Boolean(loginPassword))) {
        Object.assign(sportUpdate, { sport_token_encrypted: null, sport_uid: null, sport_unid: null, token_status: 'unknown' });
      }
      const { error: sportError } = await supabase.from('sport_world_accounts').upsert(sportUpdate, { onConflict: 'account_record_id' });
      if (sportError) throw sportError;
    }
    await supabase.from('operation_logs').insert({ user_id: user.id, action_type: shouldSaveSportCredentials ? 'edit_sport_world_binding' : 'edit_account', target_type: 'account', target_id: id, description: shouldSaveSportCredentials ? '修改运动世界绑定信息' : password ? '编辑账号，密码已修改' : '编辑账号' });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return accountSaveError(error);
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, user, role, response } = await requireAccount(id);
  if (response) return response;
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  let deleteQuery = supabase.from('accounts').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (role !== 'admin') deleteQuery = deleteQuery.eq('user_id', user.id);
  const { error } = await deleteQuery;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await supabase.from('operation_logs').insert({ user_id: user.id, action_type: 'delete_account', target_type: 'account', target_id: id, description: '删除账号（软删除）' });
  return NextResponse.json({ ok: true });
}
