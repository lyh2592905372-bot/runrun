import { decryptSportSecret, encryptSportSecret } from '@/lib/encryption';
import { refreshOrderProgressAfterSync } from '@/lib/order-progress-server';
import { SportWorldClient, SportWorldError, type SportWorldProgress, type SportWorldRun, type SportWorldSession } from './client';

export type SyncResult = { recordsReceived: number; recordsCreated: number; recordsUpdated: number; completedRuns: number; completedDistance: number; authMethod: 'existing_token' | 'password_login' };

function relation<T>(value: T | T[] | null | undefined): T | null { return Array.isArray(value) ? value[0] || null : value || null; }
function round(value: number) { return Math.round(value * 100) / 100; }
function friendlyCode(error: unknown) { return error instanceof SportWorldError ? error.code : 'UNKNOWN_ERROR'; }

export async function syncSportWorldAccount(supabase: any, accountId: string): Promise<SyncResult> {
  const { data: account, error: accountError } = await supabase.from('accounts').select('id,username,order_count,distance_per_run,sport_world_accounts(*)').eq('id', accountId).is('deleted_at', null).single();
  if (accountError || !account) throw new SportWorldError('UNKNOWN_ERROR', '账号不存在');
  const sport = relation(account.sport_world_accounts);
  if (!sport?.sport_account || !sport.sport_password_encrypted) throw new SportWorldError('AUTH_FAILED', '请先绑定运动世界账号');
  const client = new SportWorldClient(sport.sport_account);

  const now = new Date().toISOString();
  const { data: lock } = await supabase.from('sport_world_accounts').update({ last_sync_status: 'syncing', sync_started_at: now, last_sync_error: null }).eq('account_record_id', accountId).or(`last_sync_status.neq.syncing,sync_started_at.lt.${new Date(Date.now() - 10 * 60 * 1000).toISOString()}`).select('id').maybeSingle();
  if (!lock) throw new SportWorldError('UNKNOWN_ERROR', '该账号正在同步，请勿重复操作');
  const startedAt = now;
  let authMethod: 'existing_token' | 'password_login' = 'existing_token';
  let recordsReceived = 0;
  try {
    let session: SportWorldSession | null = null;
    if (sport.sport_token_encrypted) {
      try {
        session = { token: decryptSportSecret(sport.sport_token_encrypted), uid: sport.sport_uid || undefined, unid: sport.sport_unid || undefined };
      } catch {
        // A stale token should not prevent password re-authentication after a key rotation.
        session = null;
      }
    }
    if (!session || !(await client.validateToken(session))) {
      authMethod = 'password_login';
      let password: string;
      try { password = decryptSportSecret(sport.sport_password_encrypted); }
      catch { throw new SportWorldError('CONFIG_ERROR', '运动世界密码无法解密，请重新填写密码；如多个账号同时出现，请检查服务器凭据密钥'); }
      session = await client.login({ account: sport.sport_account, password });
      await supabase.from('sport_world_accounts').update({ sport_token_encrypted: encryptSportSecret(session.token), sport_uid: session.uid || null, sport_unid: session.unid || null, token_status: 'valid' }).eq('account_record_id', accountId);
    } else {
      await supabase.from('sport_world_accounts').update({ token_status: 'valid' }).eq('account_record_id', accountId);
    }
    const readRemote = async (activeSession: SportWorldSession) => {
      const progress = await client.getSemesterProgress(activeSession);
      const records: SportWorldRun[] = [];
      const seenRecordIds = new Set<string>();
      let page = 1;
      do {
        const result = await client.getRunHistory(activeSession, page, 50, progress.semester);
        const newRecords = result.records.filter((record) => !seenRecordIds.has(record.id));
        newRecords.forEach((record) => seenRecordIds.add(record.id));
        records.push(...newRecords);
        page += 1;
        if (!result.hasMore || newRecords.length === 0 || page > 200) break;
      } while (true);
      recordsReceived = records.length;
      return { progress, records };
    };
    let remote: { progress: SportWorldProgress; records: SportWorldRun[] };
    try {
      remote = await readRemote(session);
    } catch (error) {
      if (!(error instanceof SportWorldError) || error.code !== 'TOKEN_EXPIRED' || authMethod === 'password_login') throw error;
      authMethod = 'password_login';
      let password: string;
      try { password = decryptSportSecret(sport.sport_password_encrypted); }
      catch { throw new SportWorldError('CONFIG_ERROR', '运动世界密码无法解密，请重新填写密码；如多个账号同时出现，请检查服务器凭据密钥'); }
      session = await client.login({ account: sport.sport_account, password });
      await supabase.from('sport_world_accounts').update({ sport_token_encrypted: encryptSportSecret(session.token), sport_uid: session.uid || null, sport_unid: session.unid || null, token_status: 'valid' }).eq('account_record_id', accountId);
      remote = await readRemote(session);
    }
    const { progress, records } = remote;
    let recordsCreated = 0; let recordsUpdated = 0;
    for (const run of records) {
      const row = { account_record_id: accountId, sport_world_record_id: run.id, run_date: run.runDate || (run.startTime ? run.startTime.slice(0, 10) : null), start_time: run.startTime || null, end_time: run.endTime || null, distance: round(run.distance), duration: run.duration || null, pace: run.pace || null, status: run.status || null, is_valid: run.isValid, sport_type: run.sportType || null, semester: run.semester || progress.semester || null, raw_status: run.rawStatus || run.status || null, source: 'sport_world', synced_at: now };
      const { data: existing } = await supabase.from('sport_world_run_records').select('id').eq('account_record_id', accountId).eq('sport_world_record_id', run.id).maybeSingle();
      const { error } = await supabase.from('sport_world_run_records').upsert(row, { onConflict: 'account_record_id,sport_world_record_id' });
      if (error) throw new SportWorldError('API_ERROR', '跑步记录保存失败', error);
      if (existing) recordsUpdated += 1; else recordsCreated += 1;
    }
    const { data: allRecords } = await supabase.from('sport_world_run_records').select('distance,is_valid,semester,start_time').eq('account_record_id', accountId);
    const rows = (allRecords || []).filter((row: any) => row.is_valid && (!progress.semester || row.semester === progress.semester));
    const completedRuns = progress.completedRuns ?? rows.length;
    const completedDistance = round(progress.completedDistance ?? rows.reduce((sum: number, row: any) => sum + Number(row.distance || 0), 0));
    const latest = rows.slice().sort((a: any, b: any) => String(b.start_time || '').localeCompare(String(a.start_time || '')))[0];
    await refreshOrderProgressAfterSync(supabase, accountId);
    await supabase.from('sport_world_accounts').update({ last_sync_at: now, last_sync_status: 'success', token_status: 'valid', last_sync_error: null, sync_started_at: null, current_semester: progress.semester || null, semester_started_at: progress.startsAt || null, semester_ended_at: progress.endsAt || null, completion_status: progress.status || null, target_runs: progress.targetRuns ?? null, target_distance: progress.targetDistance ?? null, completed_runs: completedRuns, completed_distance: completedDistance, latest_run_at: latest?.start_time || null, latest_run_distance: latest?.distance || null }).eq('account_record_id', accountId);
    await supabase.from('sport_world_sync_logs').insert({ account_record_id: accountId, started_at: startedAt, finished_at: new Date().toISOString(), status: 'success', auth_method: authMethod, records_received: recordsReceived, records_created: recordsCreated, records_updated: recordsUpdated, completed_runs: completedRuns, completed_distance: completedDistance });
    return { recordsReceived, recordsCreated, recordsUpdated, completedRuns, completedDistance, authMethod };
  } catch (error) {
    const code = friendlyCode(error);
    const status = code === 'VERIFY_REQUIRED' ? 'need_verify' : code === 'TOKEN_EXPIRED' ? 'token_expired' : 'failed';
    const message = error instanceof Error ? error.message : '同步失败';
    await supabase.from('sport_world_accounts').update({ last_sync_status: status, token_status: code === 'VERIFY_REQUIRED' ? 'need_verify' : code === 'TOKEN_EXPIRED' ? 'expired' : sport.token_status, last_sync_error: message.slice(0, 500), sync_started_at: null }).eq('account_record_id', accountId);
    await supabase.from('sport_world_sync_logs').insert({ account_record_id: accountId, started_at: startedAt, finished_at: new Date().toISOString(), status, auth_method: authMethod, records_received: recordsReceived, error_code: code, error_message: message.slice(0, 500) });
    throw error;
  }
}

export function syncErrorResponse(error: unknown) {
  const code = friendlyCode(error);
  const message = error instanceof Error ? error.message : '同步失败';
  const status = code === 'AUTH_FAILED' ? 400 : code === 'VERIFY_REQUIRED' ? 409 : code === 'TOKEN_EXPIRED' ? 401 : code === 'RATE_LIMITED' ? 429 : code === 'CONFIG_ERROR' ? 503 : 502;
  return { code, message, status };
}
