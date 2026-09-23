import { type NextRequest, NextResponse } from 'next/server';
import { encryptSecret, encryptSportSecret } from '@/lib/encryption';
import { requireUser } from '@/lib/server-auth';
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

export async function GET(request: NextRequest) {
  const { supabase, response } = await requireUser();
  if (response) return response;
  const queryParams = request.nextUrl.searchParams;
  let query = supabase
    .from('accounts')
    .select('id,school_id,category_id,running_type_id,face_option_id,username,distance_per_run,order_count,order_time,running_time,campus_name,fence_name,student_name,student_id,note,created_at,updated_at,deleted_at,school:schools(*),category:account_categories(*),running_type:running_types(*),face_option:face_options(*),progress(*),sport_world_accounts(id,account_record_id,sport_account,sport_password_encrypted,sport_uid,sport_unid,token_status,sync_enabled,last_sync_at,last_sync_status,last_sync_error,current_semester,semester_started_at,semester_ended_at,completion_status,target_runs,target_distance,completed_runs,completed_distance,latest_run_at,latest_run_distance,manual_run_adjustment,manual_distance_adjustment,sync_started_at)')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (queryParams.get('search')) query = query.or(`username.ilike.%${queryParams.get('search')}%,note.ilike.%${queryParams.get('search')}%`);
  if (queryParams.get('school_id')) query = query.eq('school_id', queryParams.get('school_id'));
  if (queryParams.get('category_id')) query = query.eq('category_id', queryParams.get('category_id'));
  if (queryParams.get('running_type_id')) query = query.eq('running_type_id', queryParams.get('running_type_id'));
  if (queryParams.get('face_option_id')) query = query.eq('face_option_id', queryParams.get('face_option_id'));
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const accounts = (data || []).map((account: any) => {
    const category = Array.isArray(account.category) ? account.category[0] : account.category;
    const sport = Array.isArray(account.sport_world_accounts) ? account.sport_world_accounts[0] : account.sport_world_accounts;
    if (category?.name !== '运动世界' || !sport) return { ...account, sport_world_accounts: null };
    const hasSportPassword = Boolean(sport.sport_password_encrypted);
    const safeSport = { ...sport };
    delete safeSport.sport_password_encrypted;
    return { ...account, sport_world_accounts: { ...safeSport, has_sport_password: hasSportPassword } };
  });
  return NextResponse.json({ accounts });
}

export async function POST(request: NextRequest) {
  const { supabase, user, response } = await requireUser();
  if (response) return response;
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const input = await request.json();
  if (input.order_time === undefined || input.order_time === '') input.order_time = new Date().toISOString();
  const body = accountInputSchema.safeParse(input);
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message || '参数错误' }, { status: 400 });

  try {
    const configuration = await resolveAccountConfiguration(supabase, body.data);
    const { password, sport_account, sport_password, username: inputUsername } = body.data;
    const accountFields = accountFieldsFromInput(body.data);
    const { data: categoryRecord, error: categoryError } = await supabase.from('account_categories').select('name').eq('id', configuration.category_id).single();
    if (categoryError) throw categoryError;
    const isSportWorld = categoryRecord.name === '运动世界';
    const isAlipaySunshine = categoryRecord.name === '支付宝阳光跑';
    if (!isAlipaySunshine && !inputUsername) return NextResponse.json({ error: '账号不能为空' }, { status: 400 });
    const username = isAlipaySunshine
      ? inputUsername || body.data.student_id || `alipay-${crypto.randomUUID()}`
      : inputUsername;
    const loginAccount = isSportWorld ? username : sport_account;
    const loginPassword = isSportWorld ? password : sport_password;
    if (loginAccount || loginPassword) {
      if (!loginAccount || !loginPassword) return NextResponse.json({ error: '运动世界账号和密码需要同时填写' }, { status: 400 });
    }
    const encryptedSportPassword = loginPassword ? encryptSportSecret(loginPassword) : null;
    const values = { ...accountFields, username, ...configuration };
    const hierarchyError = await validateAccountHierarchy(supabase, configuration);
    if (hierarchyError) return NextResponse.json({ error: hierarchyError }, { status: 400 });

    const { data, error } = await supabase
      .from('accounts')
      .insert({ ...values, encrypted_password: password ? encryptSecret(password) : null })
      .select('id')
      .single();
    if (error) throw error;
    await supabase.from('progress').insert({ account_id: data.id, completed_runs: 0 });
    if (loginAccount || loginPassword) {
      const { error: sportError } = await supabase.from('sport_world_accounts').insert({ account_record_id: data.id, sport_account: loginAccount, sport_password_encrypted: encryptedSportPassword, token_status: 'unknown', last_sync_status: 'never_synced' });
      if (sportError) throw sportError;
    }
    await supabase.from('operation_logs').insert({ user_id: user.id, action_type: loginAccount ? 'add_sport_world_binding' : 'create_account', target_type: 'account', target_id: data.id, description: loginAccount ? `新增账号并绑定运动世界账号 ${values.username}` : `新增账号 ${values.username}` });
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (error) {
    return accountSaveError(error);
  }
}
