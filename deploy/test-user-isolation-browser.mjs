import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright-core';
import { PGlite } from '@electric-sql/pglite';

// Run the real Next app against a LOCAL fake Auth/PostgREST backend. No production
// environment file is changed; all Supabase URLs/keys are overridden for this child.
const root = path.resolve(import.meta.dirname, '..');
const appPort = 43119, authPort = 43120;
const base = `http://127.0.0.1:${appPort}`;
const adminId = '10000000-0000-4000-8000-000000000001';
const aliceId = '10000000-0000-4000-8000-000000000002';
const bobId = '10000000-0000-4000-8000-000000000003';
const ownId = '20000000-0000-4000-8000-000000000001';
const otherId = '20000000-0000-4000-8000-000000000002';
const profiles = [
  { id: adminId, email: 'admin@example.test', display_name: '测试管理员', role: 'admin', is_active: true, created_at: '2026-09-01T00:00:00Z' },
  { id: aliceId, email: 'alice@example.test', display_name: '客户甲', role: 'user', is_active: true, created_at: '2026-09-02T00:00:00Z' },
  { id: bobId, email: 'bob@example.test', display_name: '客户乙', role: 'customer', is_active: true, created_at: '2026-09-03T00:00:00Z' },
];
const category = { id: '30000000-0000-4000-8000-000000000001', name: '运动世界', color: '#5b5bd6' };
const school = { id: '30000000-0000-4000-8000-000000000002', name: '测试大学' };
const runningType = { id: '30000000-0000-4000-8000-000000000003', school_id: school.id, name: '非人脸非晨跑' };
const faceOption = { id: '30000000-0000-4000-8000-000000000004', running_type_id: runningType.id, name: '无需人脸' };
const accounts = [ownId, otherId].map((id, i) => ({ id, user_id: i ? bobId : aliceId, username: i ? '客户乙账号' : '客户甲账号', school_id: school.id, category_id: category.id,
  distance_per_run: 2, order_count: 20, order_time: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z', deleted_at: null,
  owner: profiles[i + 1], category, school, running_type: runningType, running_type_id: runningType.id, face_option: faceOption, face_option_id: faceOption.id, progress: [], sport_world_accounts: { id, account_record_id: id, sport_account: 'fixture', sport_password_encrypted: null, token_status: 'unknown', sync_enabled: false, last_sync_status: 'never_synced' } }));
const sql = new PGlite();
function authUser(id) { const p = profiles.find(p => p.id === id); return p && { id: p.id, aud: 'authenticated', role: 'authenticated', email: p.email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: p.created_at }; }
function token(id) { return [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'fixture-signature'].join('.'); }
function requestUser(req) { try { return JSON.parse(Buffer.from(req.headers.authorization.split(' ')[1].split('.')[1], 'base64url')).sub; } catch { return null; } }
let failedRequests = [];
const backend = http.createServer(async (req,res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,HEAD,OPTIONS'); res.setHeader('Content-Type', 'application/json');
  const send = (data, status = 200) => { res.statusCode = status; res.end(JSON.stringify(data)); };
  if (req.method === 'OPTIONS') return send({});
  const url = new URL(req.url, `http://127.0.0.1:${authPort}`);
  const parts = []; for await (const chunk of req) parts.push(chunk);
  const body = parts.length ? JSON.parse(Buffer.concat(parts).toString()) : {};
  if (url.pathname === '/auth/v1/token') {
    const user = profiles.find(p => p.email === body.email);
    if (!user) return send({ error: 'invalid_credentials', msg: 'Invalid login' }, 400);
    return send({ access_token: token(user.id), refresh_token: 'fixture-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: authUser(user.id) });
  }
  if (url.pathname === '/auth/v1/user') { const user = authUser(requestUser(req)); return user ? send(user) : send({ msg: 'unauthorized' }, 401); }
  if (url.pathname === '/auth/v1/logout') return send({});
  if (url.pathname === '/auth/v1/admin/users' && req.method === 'POST') {
    const p = { id: crypto.randomUUID(), email: body.email, display_name: body.user_metadata.display_name, role: 'customer', is_active: true, created_at: new Date().toISOString() }; profiles.push(p); return send({ user: authUser(p.id), ...authUser(p.id) });
  }
  if (url.pathname === '/rest/v1/rpc/admin_update_user') {
    const profile = profiles.find(p => p.id === body.target_id);
    if (body.new_role != null) profile.role = body.new_role;
    if (body.new_active != null) profile.is_active = body.new_active;
    if (body.new_display_name != null) profile.display_name = body.new_display_name;
    return send(null);
  }
  if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.slice('/rest/v1/'.length);
    const tables = { profiles, accounts, schools: [school], account_categories: [category], running_types: [runningType], face_options: [faceOption], progress: [], sport_world_run_records: [], sport_world_sync_logs: [], operation_logs: [], backups: [], backup_settings: [{ id: true, auto_enabled: false, frequency: 'daily', next_run_at: null }] };
    if (!(table in tables)) { failedRequests.push(url.pathname); return send({ message: 'unexpected table' }, 500); }
    let data = tables[table];
    const ownerFilter = url.searchParams.get('owner.or');
    if (ownerFilter) {
      assert.equal(table, 'accounts');
      assert.equal(url.searchParams.get('owner'), 'not.is.null', 'owner filters must also restrict parent accounts');
      const expression = ownerFilter.slice(1, -1);
      const terms = [...expression.matchAll(/(display_name|email)\.ilike\.("(?:[^"\\]|\\.)*")/g)];
      assert.equal(terms.map(t => t[0]).join(','), expression, 'valid quoted PostgREST OR expression');
      const matches = await Promise.all(data.map(async account => {
        for (const [, field, encoded] of terms) {
          const result = await sql.query('select $1::text ilike $2::text as matched', [account.owner?.[field] ?? null, JSON.parse(encoded)]);
          if (result.rows[0].matched) return true;
        }
        return false;
      }));
      data = data.filter((_, i) => matches[i]);
    }
    for (const [key, value] of url.searchParams) {
      if (value.startsWith('eq.')) data = data.filter(r => String(r[key]) === value.slice(3));
      if (value === 'is.null') data = data.filter(r => r[key] == null);
      if (value.startsWith('ilike.')) data = data.filter(r => String(r[key] || '').includes(value.slice(6).replaceAll('%','')));
    }
    res.setHeader('Content-Range', data.length ? `0-${data.length - 1}/${data.length}` : '*/0');
    if (url.searchParams.has('offset') || url.searchParams.has('limit')) {
      const offset = Number(url.searchParams.get('offset') || 0);
      data = data.slice(offset, url.searchParams.has('limit') ? offset + Number(url.searchParams.get('limit')) : undefined);
    }
    if (req.method === 'HEAD') { res.end(); return; }
    if (req.method === 'POST') return send({ id: crypto.randomUUID(), ...body });
    if (req.headers.accept?.includes('vnd.pgrst.object+json')) return send(data[0] || null);
    return send(data);
  }
  failedRequests.push(url.pathname); send({ message: 'unexpected request' }, 404);
});
await new Promise(resolve => backend.listen(authPort, '127.0.0.1', resolve));
let output = '';
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(appPort)], {
  cwd: root, windowsHide: true, stdio: ['ignore','pipe','pipe'], env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${authPort}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon-key', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key', NEXT_PUBLIC_APP_URL: base, CRON_SECRET: 'fixture-cron', SPORT_WORLD_CREDENTIAL_KEY: 'fixture-sport' },
});
app.stdout.on('data', b => { output += b; }); app.stderr.on('data', b => { output += b; });
let browser;
try {
  for (let i = 0; i < 90; i++) { try { if ((await fetch(`${base}/login`)).ok) break; } catch {} if (i === 89) throw new Error(`Next did not start: ${output.slice(-3000)}`); await new Promise(resolve => setTimeout(resolve, 500)); }
  browser = await chromium.launch({ executablePath: process.env.TEST_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  const page = await context.newPage(); const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  const login = async email => {
    await page.goto(`${base}/login`);
    await page.locator('input[type=email]').fill(email);
    await page.locator('input[type=password]').fill('fixture-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
  };
  await login('admin@example.test');
  await page.waitForURL('**/dashboard');
  await page.getByRole('heading', { name: '工作台', exact: true }).waitFor();
  const adminMenu = page.getByRole('navigation', { name: '管理员菜单' });
  for (const label of ['首页','进度管理','同步管理','数据统计','操作日志','用户管理','系统设置']) assert.equal(await adminMenu.getByRole('link', { name: label, exact: true }).count(), 1, label);
  assert.equal(await adminMenu.getByRole('link', { name: 'Excel导出', exact: true }).count(), 0);
  await adminMenu.getByRole('button', { name: '账号管理', exact: true }).click();
  for (const [label, slug] of [['运动世界','sport-world'],['闪动校园','flash-campus'],['支付宝阳光跑','alipay-sunshine']]) {
    await adminMenu.getByRole('link', { name: label, exact: true }).click();
    await page.waitForURL(`**/accounts/${slug}`);
    await page.getByRole('heading', { name: `${label}账号`, exact: true }).waitFor();
    assert.ok(await page.getByRole('button', { name: '添加账号', exact: true }).isVisible());
  }
  await adminMenu.getByRole('link', { name: '运动世界', exact: true }).click();
  await page.getByText('客户甲账号', { exact: true }).first().waitFor();
  await page.getByText('客户乙账号', { exact: true }).first().waitFor();
  assert.equal((await page.getByRole('row').filter({ hasText: '客户甲账号' }).getByRole('cell').first().innerText()).trim(), school.name);
  assert.equal((await page.getByRole('row').filter({ hasText: '客户甲账号' }).getByRole('cell').nth(1).innerText()).trim(), runningType.name);
  async function checkExport(expected) {
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
    const download = await waiting;
    const book = new ExcelJS.Workbook(); await book.xlsx.readFile(await download.path());
    const accountValues = JSON.stringify(book.getWorksheet('账号管理').getSheetValues());
    assert.ok(accountValues.includes(runningType.name)); assert.ok(accountValues.includes(faceOption.name));
    for (const sheet of book.worksheets) {
      const values = JSON.stringify(sheet.getSheetValues());
      for (const name of expected) assert.ok(values.includes(name));
      if (expected.length === 1) assert.ok(!values.includes('客户乙账号'));
    }
  }
  await checkExport(['客户甲账号','客户乙账号']);
  await page.screenshot({ path: path.join(root, 'test-results/admin-accounts-restored.png'), fullPage: true });
  await adminMenu.getByRole('link', { name: '进度管理', exact: true }).click();
  await page.waitForURL('**/progress'); await page.getByRole('heading', { name: '进度管理', exact: true }).waitFor();
  await page.getByText('客户甲账号', { exact: true }).waitFor(); await page.getByText('客户乙账号', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '保存', exact: true }).count(), 2);
  assert.equal(await page.getByRole('button', { name: '立即同步', exact: true }).count(), 2);
  await page.getByRole('textbox', { name: '搜索学校、账号、手机号或校区' }).fill('客户乙');
  assert.equal(await page.getByText('客户甲账号', { exact: true }).count(), 0);
  await adminMenu.getByRole('link', { name: '同步管理', exact: true }).click();
  await page.waitForURL('**/sync'); await page.getByRole('heading', { name: '同步管理', exact: true }).waitFor();
  await page.getByText('客户甲账号', { exact: true }).waitFor(); await page.getByText('客户乙账号', { exact: true }).waitFor();
  for (const [label, heading] of [['操作日志', '操作记录'], ['系统设置', '设置']]) {
    await adminMenu.getByRole('link', { name: label, exact: true }).click();
    await page.getByRole('heading', { name: heading, exact: true }).waitFor();
  }
  await page.getByRole('link', { name: '数据备份', exact: true }).click();
  await page.waitForURL('**/admin/backups');
  await adminMenu.getByRole('link', { name: '用户管理', exact: true }).click();
  await page.waitForURL('**/admin/users'); await page.getByText('测试管理员', { exact: true }).waitFor();
  for (const profile of profiles) assert.ok(!(await page.locator('table').innerText()).includes(profile.id), 'user IDs must not be rendered');
  await page.getByRole('button', { name: '新增用户', exact: true }).click();
  await page.getByLabel('姓名', { exact: true }).fill('新客户'); await page.getByLabel('邮箱', { exact: true }).fill('new@example.test'); await page.getByLabel('初始密码').fill('new-fixture-password');
  await page.getByRole('button', { name: '创建用户', exact: true }).click(); await page.getByText('新客户', { exact: true }).waitFor();
  const row = page.getByRole('row').filter({ hasText: 'new@example.test' }); await row.getByRole('button', { name: '编辑' }).click();
  await page.getByRole('dialog').getByRole('combobox').selectOption('admin'); await page.getByRole('button', { name: '保存', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.match(await row.innerText(), /管理员/);
  await page.screenshot({ path: path.join(root, 'test-results/admin-users-desktop.png'), fullPage: true });
  await page.getByRole('link', { name: '数据统计', exact: true }).click(); await page.getByText('客户甲账号', { exact: true }).waitFor(); await page.getByText('客户乙账号', { exact: true }).waitFor();
  assert.equal((await page.getByRole('row').filter({ hasText: '客户甲账号' }).getByRole('cell').first().innerText()).trim(), 'alice@example.test');
  for (const profile of profiles) assert.ok(!(await page.locator('table').innerText()).includes(profile.id), 'statistics must not render user IDs');
  async function searchStats(term, expected) {
    await page.getByPlaceholder('按用户名或邮箱筛选，留空查看全部').fill(term);
    const response = page.waitForResponse(r => r.url().includes('/api/admin/stats?') && r.request().method() === 'GET');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    const result = await response;
    assert.equal(result.status(), 200);
    const url = new URL(result.url());
    assert.equal(url.searchParams.get('username'), term.trim());
    assert.equal(url.searchParams.get('email'), term.trim());
    assert.equal(url.searchParams.has('user_id'), false);
    await page.getByText('加载中…', { exact: true }).waitFor({ state: 'hidden' });
    assert.deepEqual((await result.json()).accounts.map(a => a.id).sort(), [...expected].sort());
    assert.equal(await page.locator('tbody tr').count(), expected.length || 1);
    if (!expected.length) await page.getByText('暂无业务账号', { exact: true }).waitFor();
  }
  await searchStats('客户甲', [ownId]);
  await searchStats('ALICE', [ownId]);
  await searchStats(' alice@example.test ', [ownId]);
  await searchStats('不存在的用户', []);
  await searchStats('', [ownId, otherId]);
  const statsRequest = async params => {
    const response = await context.request.get(`${base}/api/admin/stats?${new URLSearchParams(params)}`);
    assert.equal(response.status(), 200);
    return response.json();
  };
  assert.deepEqual((await statsRequest({ username: '客户乙' })).accounts.map(a => a.id), [otherId]);
  assert.deepEqual((await statsRequest({ email: 'alice@' })).accounts.map(a => a.id), [ownId]);
  assert.equal((await statsRequest({ username: '客户甲', email: 'bob@' })).total, 2, 'name/email use OR');
  assert.equal((await statsRequest({ username: aliceId, email: aliceId })).total, 0, 'new search does not match UUID');
  assert.equal((await statsRequest({ username: '客户甲', user_id: bobId })).accounts[0].id, ownId, 'new search takes priority over legacy ID');
  assert.equal((await statsRequest({ user_id: bobId })).accounts[0].id, otherId, 'existing API callers remain compatible');
  for (const text of ['%', '_', 'x",email.ilike."%', 'a,b(c)', '\\']) {
    assert.equal((await statsRequest({ username: text, email: text })).total, 0, 'literal special characters must not broaden matches');
  }
  assert.equal((await context.request.get(`${base}/api/admin/stats?username=${'x'.repeat(255)}`)).status(), 400);
  assert.equal((await context.request.get(`${base}/api/admin/stats?page=0`)).status(), 400);
  const originalEmail = profiles[1].email;
  profiles[1].email = '2592905372@qq.com';
  await searchStats('2592905372', [ownId]);
  await searchStats('2592905372@qq.com', [ownId]);
  profiles[1].email = originalEmail;
  const extraAccounts = Array.from({ length: 30 }, (_, i) => ({ ...accounts[0], id: `40000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
  accounts.push(...extraAccounts);
  const firstPage = await statsRequest({ username: '客户甲' });
  const secondPage = await statsRequest({ username: '客户甲', page: '2' });
  assert.equal(firstPage.total, 31); assert.equal(firstPage.accounts.length, 25);
  assert.equal(secondPage.total, 31); assert.equal(secondPage.accounts.length, 6);
  assert.equal(new Set([...firstPage.accounts, ...secondPage.accounts].map(a => a.id)).size, 31);
  await searchStats('客户甲', accounts.filter(a => a.user_id === aliceId).slice(0, 25).map(a => a.id));
  const nextPageResponse = page.waitForResponse(r => r.url().includes('/api/admin/stats?page=2'));
  await page.getByRole('button', { name: '下一页', exact: true }).click(); await nextPageResponse;
  await page.getByText('共 31 条 · 第 2 页', { exact: true }).waitFor();
  await searchStats('客户乙', [otherId]);
  await page.getByText('共 1 条 · 第 1 页', { exact: true }).waitFor();
  accounts.splice(2);
  await searchStats('', [ownId, otherId]);
  console.log('PASS stats name/email partial search, literal escaping, pagination, UUID hiding and API compatibility');
  await page.screenshot({ path: path.join(root, 'test-results/admin-stats-desktop.png'), fullPage: true });
  console.log('PASS admin login, full business menus, three platforms, all-owner progress/sync/export, settings, backups and user management');
  await context.clearCookies(); await login('alice@example.test'); await page.waitForURL(/\/accounts/);
  await page.getByText('客户甲账号', { exact: true }).first().waitFor(); assert.equal(await page.getByText('客户乙账号', { exact: true }).count(), 0);
  await checkExport(['客户甲账号']);
  for (const path of ['/admin/users','/admin/stats','/admin/settings','/admin/backups','/settings','/backups']) {
    await page.goto(`${base}${path}`); await page.waitForURL(/\/accounts/);
  }
  await page.getByRole('link', { name: '进度管理', exact: true }).click();
  await page.waitForURL('**/progress'); await page.getByRole('heading', { name: '进度管理', exact: true }).waitFor();
  await page.getByText('客户甲账号', { exact: true }).waitFor();
  assert.equal(await page.getByText('客户乙账号', { exact: true }).count(), 0);
  const foreign = await context.request.get(`${base}/api/accounts/${otherId}/password`); assert.equal(foreign.status(), 404);
  assert.equal((await context.request.get(`${base}/api/admin/users`)).status(), 403);
  assert.equal((await context.request.get(`${base}/api/admin/stats?username=客户乙&email=bob`)).status(), 403);
  await page.getByRole('link', { name: '同步管理', exact: true }).click();
  await page.waitForURL('**/sync'); await page.getByRole('heading', { name: '同步管理', exact: true }).waitFor();
  await page.getByText('客户甲账号', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(root, 'test-results/customer-sync-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开菜单', exact: true }).click(); await page.getByRole('navigation', { name: '客户菜单' }).waitFor();
  await page.waitForFunction(() => Math.abs(document.querySelector('aside').getBoundingClientRect().x) < 1);
  assert.equal(await page.getByRole('link', { name: '用户管理', exact: true }).count(), 0);
  await page.screenshot({ path: path.join(root, 'test-results/customer-mobile-menu.png'), fullPage: true });
  await page.getByRole('button', { name: '关闭菜单', exact: true }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile viewport should not overflow');
  console.log('PASS customer login, tenant filtering, admin denial, sync page and mobile menu');
  profiles.find(p => p.id === aliceId).is_active = false;
  assert.equal((await context.request.get(`${base}/api/accounts`)).status(), 403);
  await page.goto(`${base}/sync`); await page.waitForURL('**/login?error=access');
  console.log('PASS disabled customer immediately loses existing session access');
  assert.deepEqual(failedRequests, []); assert.deepEqual(pageErrors, []);
  console.log('PASS browser runtime has no uncaught errors; all data served by local fixture');
} finally {
  await browser?.close();
  if (process.platform === 'win32') { const killer = spawn('taskkill', ['/pid', String(app.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); await new Promise(resolve => killer.on('exit', resolve)); }
  else app.kill('SIGTERM');
  await new Promise(resolve => backend.close(resolve));
  await sql.close();
}
