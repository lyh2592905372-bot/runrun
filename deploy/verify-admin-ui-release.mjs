import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { chromium } from 'playwright-core';
import ExcelJS from 'exceljs';

// Production checks read business data only, except the normal export audit entry.
// Verification sessions are temporary; secrets and business records are never logged.
const env = Object.fromEntries(readFileSync(process.argv[2] || '.env.local', 'utf8').split(/\r?\n/)
  .filter(line => line && !line.startsWith('#') && line.includes('='))
  .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const base = process.argv[3] || 'https://xuehuayd.top';
const service = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sessions = [];
let browser;
async function readAll(table, fields, configure = query => query) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await configure(service.from(table).select(fields)).order('id').range(offset, offset + 999);
    assert.ok(!error, `Read ${table}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
async function signIn(profile) {
  const jar = new Map();
  const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: values => values.forEach(({ name, value }) => jar.set(name, value)) },
  });
  const { data, error } = await service.auth.admin.generateLink({ type: 'magiclink', email: profile.email });
  assert.ok(!error, 'Generate verification session without sending email');
  const verified = await client.auth.verifyOtp({ type: 'magiclink', token_hash: data.properties.hashed_token });
  assert.ok(!verified.error, 'Administrator/customer authentication');
  sessions.push(client);
  return { headers: { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') }, jar };
}
async function get(path, auth) {
  const response = await fetch(new URL(path, base), { headers: auth?.headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  const json = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
  return { status: response.status, json };
}
const sameIds = (a, b) => a.length === b.length && a.every(row => b.some(other => other.id === row.id));
try {
  const profiles = await readAll('profiles', 'id,email,display_name,role,is_active');
  const accounts = await readAll('accounts', 'id,user_id,username,school_id,category_id,running_type_id', query => query.is('deleted_at', null));
  const adminProfile = profiles.find(p => p.role === 'admin' && p.is_active);
  const customerProfiles = profiles.filter(p => ['user', 'customer'].includes(p.role) && p.is_active);
  assert.ok(adminProfile && customerProfiles.length, 'Active admin and customer verification profiles');
  const admin = await signIn(adminProfile);
  const owner = profiles.find(p => accounts.some(a => a.user_id === p.id) && p.email) || adminProfile;
  const checks = [
    {}, { username: owner.display_name || '未匹配的名称' }, { email: owner.email },
    { email: owner.email.split('@')[0] }, { username: '2592905372', email: '2592905372' },
    { username: '2592905372@qq.com', email: '2592905372@qq.com' },
    { username: owner.email.toUpperCase(), email: owner.email.toUpperCase() },
    { username: '__no_such_user_20260924__', email: '__no_such_user_20260924__' },
    { username: owner.id, email: owner.id },
    ...['%', '_', 'x",email.ilike."%', 'a,b(c)', '\\'].map(term => ({ username: term, email: term })),
  ];
  for (const params of checks) {
    const matches = profiles.filter(p => !params.username && !params.email ||
      params.username && (p.display_name || '').toLowerCase().includes(params.username.toLowerCase()) ||
      params.email && (p.email || '').toLowerCase().includes(params.email.toLowerCase()));
    const expected = accounts.filter(a => matches.some(p => p.id === a.user_id));
    const collected = [];
    for (let page = 1; ; page++) {
      const result = await get(`/api/admin/stats?${new URLSearchParams({ ...params, page: String(page) })}`, admin);
      assert.equal(result.status, 200, 'Production statistics request');
      assert.equal(result.json.total, expected.length, 'Statistics matching count agrees with stored profiles');
      assert.equal(result.json.stats.accounts, accounts.length, 'Global account statistic is preserved');
      collected.push(...result.json.accounts);
      if (collected.length >= result.json.total) break;
      assert.ok(result.json.accounts.length && page < 1000, 'Statistics pagination advances');
    }
    assert.ok(sameIds(collected, expected), 'Statistics account IDs agree with independently matched profile owners');
  }
  console.log('PASS production name/email search, full/partial email, pagination and special characters against real PostgREST');
  const errors = [];
  browser = await chromium.launch({ executablePath: process.env.TEST_CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : chromium.executablePath()), headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  await context.addCookies([...admin.jar].map(([name, value]) => ({ name, value, url: base, secure: base.startsWith('https:') })));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.name));
  await page.goto(`${base}/accounts/sport-world`);
  await page.getByRole('heading', { name: '运动世界账号', exact: true }).waitFor();
  await page.locator('tbody .animate-spin').waitFor({ state: 'hidden' });
  const menu = page.getByRole('navigation', { name: '管理员菜单' });
  for (const label of ['首页', '进度管理', '同步管理', '数据统计', '操作日志', '用户管理', '系统设置']) assert.equal(await menu.getByRole('link', { name: label, exact: true }).count(), 1);
  assert.equal(await menu.getByRole('link', { name: 'Excel导出', exact: true }).count(), 0);
  const schoolCells = page.locator('tbody tr').filter({ has: page.locator('td:nth-child(3)') }).locator('td:first-child');
  for (const cell of await schoolCells.all()) assert.equal(await cell.locator('p').count(), 1, 'School cell contains only the school name');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const download = await downloadEvent;
  const book = new ExcelJS.Workbook(); await book.xlsx.readFile(await download.path());
  assert.ok(book.getWorksheet('账号管理') && book.getWorksheet('进度管理'), 'Both exported worksheets are readable');
  assert.equal(book.getWorksheet('账号管理').rowCount - 1, await schoolCells.count(), 'Export contains all visible accounts');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/production-admin-accounts.png', fullPage: true });
  await menu.getByRole('link', { name: '用户管理', exact: true }).click();
  await page.getByText('加载中…', { exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '编辑', exact: true }).first().waitFor();
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  assert.ok(!uuid.test(await page.locator('table').innerText()), 'User UUIDs are hidden');
  await page.getByRole('button', { name: '编辑', exact: true }).first().click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  const initialStatsResponse = page.waitForResponse(r => r.url().includes('/api/admin/stats?') && r.request().method() === 'GET');
  await menu.getByRole('link', { name: '数据统计', exact: true }).click();
  await (await initialStatsResponse).json();
  await page.getByText(`共 ${accounts.length} 条 · 第 1 页`, { exact: true }).waitFor();
  await page.getByPlaceholder('按用户名或邮箱筛选，留空查看全部').waitFor();
  const term = owner.email.split('@')[0];
  const queryResponse = page.waitForResponse(r => r.url().includes('/api/admin/stats?') && new URL(r.url()).searchParams.get('email') === term && r.request().method() === 'GET');
  await page.getByPlaceholder('按用户名或邮箱筛选，留空查看全部').fill(term);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  const filteredResponse = await queryResponse;
  assert.equal(filteredResponse.status(), 200);
  const filtered = await filteredResponse.json();
  await page.getByText(`共 ${filtered.total} 条 · 第 1 页`, { exact: true }).waitFor();
  await page.getByText('加载中…', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await page.locator('tbody tr').count(), filtered.accounts.length, 'Rendered search rows match the filtered response');
  assert.ok(!uuid.test(await page.locator('table').innerText()), 'Statistics UUIDs are hidden');
  for (const cell of await page.locator('tbody tr td:first-child').all()) assert.ok((await cell.innerText()).includes('@'), 'Owner cells contain email');
  await page.screenshot({ path: 'test-results/production-admin-stats.png', fullPage: true });
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log('PASS production menus, school display, user editor, hidden UUIDs, statistics UI and Excel download');
  for (const profile of customerProfiles) {
    const auth = await signIn(profile);
    for (const route of ['/api/accounts', '/api/progress']) {
      const result = await get(`${route}?user_id=${adminProfile.id}`, auth);
      assert.equal(result.status, 200);
      assert.ok(sameIds(result.json.accounts, accounts.filter(a => a.user_id === profile.id)), 'Ordinary user data isolation');
    }
    for (const route of ['/api/admin/users', '/api/admin/stats?username=test&email=test', '/api/admin/logs']) assert.equal((await get(route, auth)).status, 403);
    const foreign = accounts.find(a => a.user_id !== profile.id);
    if (foreign) assert.equal((await get(`/api/accounts/${foreign.id}/password`, auth)).status, 404);
  }
  assert.equal((await get('/api/admin/stats?email=test')).status, 401);
  console.log('PASS production ordinary-user isolation, administrator-only access and anonymous denial');
} finally {
  await browser?.close();
  await Promise.all(sessions.map(client => client.auth.signOut({ scope: 'local' })));
}
