import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

// Read-only production verification; tokens stay in memory and only these sessions are revoked.
const env = Object.fromEntries(readFileSync(process.argv[2] || '.env.production', 'utf8').split(/\r?\n/)
  .filter(line => line && !line.startsWith('#') && line.includes('='))
  .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const base = process.argv[3] || 'https://xuehuayd.top';
const service = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sessions = [];
async function rows(table, fields, configure = query => query) {
  const result = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await configure(service.from(table).select(fields)).order('id').range(offset, offset + 999);
    if (error) throw new Error(`Failed reading ${table}`);
    result.push(...data);
    if (data.length < 1000) return result;
  }
}
async function signIn(profile) {
  const jar = new Map();
  const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: values => values.forEach(({ name, value }) => jar.set(name, value)) },
  });
  const { data, error } = await service.auth.admin.generateLink({ type: 'magiclink', email: profile.email });
  if (error) throw new Error('Verification session generation failed');
  const verified = await client.auth.verifyOtp({ type: 'magiclink', token_hash: data.properties.hashed_token });
  if (verified.error) throw new Error('Verification sign-in failed');
  sessions.push(client);
  return { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') };
}
async function get(path, headers) {
  const response = await fetch(new URL(path, base), { headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  return { status: response.status, location: response.headers.get('location'), text, json: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : null };
}
function equalIds(actual, expected, label) {
  assert.deepEqual(actual.map(row => row.id).sort(), expected.map(row => row.id).sort(), label);
}
try {
  const profiles = await rows('profiles', 'id,email,role,is_active', query => query.eq('is_active', true));
  const accounts = await rows('accounts', 'id,user_id', query => query.is('deleted_at', null));
  const adminProfile = profiles.find(row => row.role === 'admin');
  const ordinary = profiles.filter(row => ['user', 'customer'].includes(row.role));
  assert.ok(adminProfile && ordinary.length, 'Active administrator and ordinary user required');
  const admin = await signIn(adminProfile);
  for (const path of ['/dashboard', '/accounts/sport-world', '/accounts/flash-campus', '/accounts/alipay-sunshine', '/progress', '/sync', '/admin/stats', '/admin/logs', '/admin/users', '/admin/settings', '/admin/backups']) {
    const page = await get(path, admin);
    assert.equal(page.status, 200, `Administrator route ${path}`);
    for (const label of ['首页', '账号管理', '进度管理', '同步管理', '数据统计', '操作日志', '用户管理', '系统设置']) assert.ok(page.text.includes(label), `Missing admin menu ${label}`);
    assert.ok(!page.text.includes('href="/accounts#excel-export"'), 'Standalone Excel navigation is removed');
  }
  for (const path of ['/api/accounts', '/api/progress']) {
    const result = await get(path, admin);
    assert.equal(result.status, 200, path);
    equalIds(result.json.accounts, accounts, `All-owner access ${path}`);
  }
  const home = await get('/admin', admin);
  assert.equal(home.status, 307); assert.equal(new URL(home.location, base).pathname, '/dashboard');
  const summaries = [];
  for (const profile of ordinary) {
    const headers = await signIn(profile);
    const own = accounts.filter(row => row.user_id === profile.id);
    const foreign = accounts.find(row => row.user_id !== profile.id);
    for (const path of ['/api/accounts', '/api/progress']) {
      const result = await get(`${path}?user_id=${adminProfile.id}`, headers);
      assert.equal(result.status, 200); equalIds(result.json.accounts, own, `Ordinary user isolation ${path}`);
    }
    for (const path of ['/api/admin/users', '/api/admin/stats', '/api/admin/logs', '/api/backup-settings', '/api/backups']) assert.equal((await get(path, headers)).status, 403, path);
    for (const path of ['/admin/users', '/admin/settings', '/settings', '/backups']) {
      const result = await get(path, headers); assert.equal(result.status, 307, path);
      assert.equal(new URL(result.location, base).pathname, '/accounts');
    }
    if (foreign) for (const suffix of ['password', 'sport-world-records']) assert.equal((await get(`/api/accounts/${foreign.id}/${suffix}`, headers)).status, 404, suffix);
    for (const [path, key, table] of [['/api/logs', 'logs', 'operation_logs'], ['/api/sync-logs', 'logs', 'sport_world_sync_logs']]) {
      const allowed = new Set((await rows(table, 'id', query => query.eq('user_id', profile.id))).map(row => row.id));
      const result = await get(path, headers); assert.equal(result.status, 200);
      assert.ok(result.json[key].every(row => allowed.has(row.id)), `Log isolation ${path}`);
    }
    const page = await get('/accounts', headers);
    assert.equal(page.status, 200);
    assert.ok(!page.text.includes('管理员菜单'));
    summaries.push({ role: profile.role, visibleAccounts: own.length, foreignAccessDenied: Boolean(foreign) });
  }
  console.log(JSON.stringify({ productionPermissionsVerified: true, adminVisibleAccounts: accounts.length, adminMenusVerified: true, ordinaryUsers: summaries, businessDataModified: false }));
} finally {
  await Promise.all(sessions.map(client => client.auth.signOut({ scope: 'local' })));
}
