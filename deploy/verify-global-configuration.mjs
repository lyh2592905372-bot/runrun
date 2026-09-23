import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';

const appUrl = process.env.RUNFLOW_VERIFY_URL || 'http://127.0.0.1:3000';
const chromePath = process.env.RUNFLOW_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const prefix = `global-config-test-${Date.now()}`;

function loadEnv(path) {
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  }));
}

const env = loadEnv('.env.local');
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function createVerificationLink() {
  const { data: profiles, error: profileError } = await admin.from('profiles').select('id').eq('role', 'admin').limit(1);
  if (profileError || !profiles?.[0]) throw profileError || new Error('No administrator profile is available');
  const { data: userPage, error: userError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (userError) throw userError;
  const user = userPage.users.find((candidate) => candidate.id === profiles[0].id && candidate.email);
  if (!user?.email) throw new Error('Administrator email is unavailable');
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
    options: { redirectTo: `${appUrl}/auth/callback?next=/settings` },
  });
  if (error || !data?.properties?.action_link) throw error || new Error('Unable to create verification session');
  return data.properties.action_link;
}

const browser = await chromium.launch({ executablePath: chromePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
const settingsRequests = [];
let accountId = '';
let schoolId = '';
let runningTypeId = '';
page.on('pageerror', (error) => consoleErrors.push(error.message));
page.on('request', (request) => {
  if (request.url().includes('/api/face-options')) settingsRequests.push(request.url());
});

async function appRequest(path, init = {}) {
  return page.evaluate(async ({ requestPath, requestInit }) => {
    const response = await fetch(requestPath, {
      ...requestInit,
      headers: requestInit.body ? { 'content-type': 'application/json' } : undefined,
      body: requestInit.body ? JSON.stringify(requestInit.body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  }, { requestPath: path, requestInit: init });
}

try {
  await page.goto(await createVerificationLink(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForURL(`${appUrl}/settings`, { timeout: 60000 });
  await page.getByRole('heading', { name: '设置' }).waitFor({ timeout: 30000 });

  const settings = await page.evaluate(() => ({
    headings: [...document.querySelectorAll('section h2, .card > h2')].map((node) => node.textContent?.trim()),
    schoolSelects: [...document.querySelectorAll('section')].find((section) => section.querySelector('h2')?.textContent?.trim() === '学校')?.querySelectorAll('select').length,
    runningTypeSelects: [...document.querySelectorAll('section')].find((section) => section.querySelector('h2')?.textContent?.trim() === '跑步类型')?.querySelectorAll('select').length,
    text: document.body.innerText,
  }));
  assert.deepEqual(settings.headings, ['账号分类', '学校', '跑步类型', '安全与权限']);
  assert.equal(settings.schoolSelects, 0);
  assert.equal(settings.runningTypeSelects, 0);
  assert.equal(settings.text.includes('是否人脸'), false);
  assert.deepEqual(settingsRequests, []);

  const schoolName = `${prefix}-学校`;
  const runningTypeName = `${prefix}-跑步类型`;
  const renamedSchool = `${schoolName}-已编辑`;
  const renamedRunningType = `${runningTypeName}-已编辑`;

  const createdSchool = await appRequest('/api/schools', { method: 'POST', body: { name: schoolName } });
  assert.equal(createdSchool.status, 201);
  assert.equal(createdSchool.data.school.category_id, null);
  schoolId = createdSchool.data.school.id;
  const reusedSchool = await appRequest('/api/schools', { method: 'POST', body: { name: schoolName } });
  assert.equal(reusedSchool.status, 200);
  assert.equal(reusedSchool.data.school.id, schoolId);

  const createdType = await appRequest('/api/running-types', { method: 'POST', body: { name: runningTypeName } });
  assert.equal(createdType.status, 201);
  assert.equal(createdType.data.running_type.school_id, null);
  runningTypeId = createdType.data.running_type.id;

  assert.equal((await appRequest(`/api/schools/${schoolId}`, { method: 'PATCH', body: { name: renamedSchool } })).status, 200);
  assert.equal((await appRequest(`/api/running-types/${runningTypeId}`, { method: 'PATCH', body: { name: renamedRunningType } })).status, 200);

  const [categories, schools, runningTypes] = await Promise.all([
    appRequest('/api/categories'),
    appRequest('/api/schools'),
    appRequest('/api/running-types'),
  ]);
  const alipay = categories.data.categories.find((item) => item.name === '支付宝阳光跑');
  assert(alipay, '支付宝阳光跑分类不存在');
  assert.equal(new Set(schools.data.schools.map((item) => item.name.trim())).size, schools.data.schools.length);
  assert.equal(new Set(runningTypes.data.running_types.map((item) => item.name.trim())).size, runningTypes.data.running_types.length);

  const studentId = `${Date.now()}`;
  const payload = {
    category: { id: alipay.id, name: alipay.name },
    school: { id: schoolId, name: renamedSchool },
    running_type: { id: runningTypeId, name: renamedRunningType },
    face_option: null,
    username: '',
    password: '',
    distance_per_run: 2,
    order_count: 3,
    order_time: new Date().toISOString(),
    running_time: '06:00-08:00',
    campus_name: '',
    fence_name: '',
    student_name: '自动验证',
    student_id: studentId,
    note: prefix,
  };
  const createdAccount = await appRequest('/api/accounts', { method: 'POST', body: payload });
  assert.equal(createdAccount.status, 201, JSON.stringify(createdAccount.data));
  accountId = createdAccount.data.id;
  const fetchedAccount = await appRequest(`/api/accounts?search=${studentId}`);
  const account = fetchedAccount.data.accounts.find((item) => item.id === accountId);
  assert(account, '支付宝阳光跑账号创建后未找到');
  assert.equal(account.username, studentId);
  assert.equal(account.school_id, schoolId);
  assert.equal(account.running_type_id, runningTypeId);
  assert.equal((await appRequest(`/api/accounts/${accountId}`, { method: 'PATCH', body: payload })).status, 200);

  await page.goto(`${appUrl}/accounts/alipay-sunshine`, { waitUntil: 'domcontentloaded' });
  const alipayRow = page.locator('tbody tr').filter({ hasText: studentId });
  await alipayRow.waitFor({ timeout: 30000 });
  await alipayRow.locator('.lucide-pencil').click();
  const alipayEditModal = page.locator('.fixed').filter({ has: page.getByRole('heading', { name: '编辑账号' }) });
  await alipayEditModal.waitFor({ timeout: 30000 });
  const alipayEditLabels = (await alipayEditModal.locator('label').allTextContents()).map((label) => label.trim());
  assert.equal(alipayEditLabels.includes('账号'), false);
  assert.equal(alipayEditLabels.some((label) => label.startsWith('密码')), false);
  await alipayEditModal.getByRole('button', { name: '关闭' }).click();

  const flash = categories.data.categories.find((item) => item.name === '闪动校园');
  const sportWorld = categories.data.categories.find((item) => item.name === '运动世界');
  assert.equal((await appRequest('/api/accounts', { method: 'POST', body: { ...payload, category: { id: flash.id, name: flash.name } } })).status, 400);
  assert.equal((await appRequest('/api/accounts', { method: 'POST', body: { ...payload, category: { id: sportWorld.id, name: sportWorld.name }, username: `${prefix}-sport` } })).status, 400);

  await page.goto(`${appUrl}/accounts/sport-world`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '添加账号' }).click();
  const desktopModal = page.locator('.fixed').filter({ has: page.getByRole('heading', { name: '添加账号' }) });
  const desktopLayout = await desktopModal.evaluate((modal) => {
    const fields = [...modal.querySelectorAll('.input')].slice(0, 3);
    const schoolInput = modal.querySelector('input[placeholder="选择或输入学校"]');
    const runningTypeInput = modal.querySelector('input[placeholder="选择或输入跑步类型"]');
    return {
      heights: fields.map((field) => field.getBoundingClientRect().height),
      schoolEmpty: schoolInput?.value === '',
      runningTypeEnabled: !runningTypeInput?.disabled,
    };
  });
  assert.deepEqual(desktopLayout.heights, [40, 40, 40]);
  assert.equal(desktopLayout.schoolEmpty, true);
  assert.equal(desktopLayout.runningTypeEnabled, true);
  await desktopModal.locator('input[placeholder="选择或输入跑步类型"]').click();
  await desktopModal.getByRole('option', { name: renamedRunningType }).waitFor({ timeout: 30000 });
  await desktopModal.getByRole('button', { name: '关闭' }).click();

  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '添加账号' }).click();
  const mobileModal = page.locator('.fixed').filter({ has: page.getByRole('heading', { name: '添加账号' }) });
  const mobileLayout = await mobileModal.evaluate((modal) => {
    const panel = modal.firstElementChild;
    const fields = [...modal.querySelectorAll('.input')].slice(0, 3);
    return {
      heights: fields.map((field) => field.getBoundingClientRect().height),
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      fieldsInsideViewport: fields.every((field) => {
        const rect = field.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= window.innerWidth;
      }),
      panelScrollable: panel.scrollHeight > panel.clientHeight && getComputedStyle(panel).overflowY === 'auto',
    };
  });
  assert.deepEqual(mobileLayout.heights, [40, 40, 40]);
  assert.equal(mobileLayout.noHorizontalOverflow, true);
  assert.equal(mobileLayout.fieldsInsideViewport, true);
  assert.equal(mobileLayout.panelScrollable, true);
  await mobileModal.locator('input[placeholder="选择或输入跑步类型"]').click();
  const mobileOptions = mobileModal.locator('[role="listbox"]');
  await mobileOptions.waitFor({ timeout: 30000 });
  const mobileDropdown = await mobileOptions.evaluate((list) => {
    const rect = list.getBoundingClientRect();
    const panelRect = list.closest('.fixed').firstElementChild.getBoundingClientRect();
    return {
      insideViewportWidth: rect.left >= 0 && rect.right <= window.innerWidth,
      visibleInsidePanel: rect.top >= panelRect.top && rect.bottom <= panelRect.bottom,
    };
  });
  assert.equal(mobileDropdown.insideViewportWidth, true);
  assert.equal(mobileDropdown.visibleInsidePanel, true);

  await admin.from('operation_logs').delete().eq('target_id', accountId);
  await admin.from('accounts').delete().eq('id', accountId);
  accountId = '';
  assert.equal((await appRequest(`/api/running-types/${runningTypeId}`, { method: 'DELETE' })).status, 200);
  runningTypeId = '';
  assert.equal((await appRequest(`/api/schools/${schoolId}`, { method: 'DELETE' })).status, 200);
  schoolId = '';

  const [{ count: leftoverSchools }, { count: leftoverRunningTypes }, { count: leftoverAccounts }] = await Promise.all([
    admin.from('schools').select('id', { count: 'exact', head: true }).like('name', 'global-config-test-%'),
    admin.from('running_types').select('id', { count: 'exact', head: true }).like('name', 'global-config-test-%'),
    admin.from('accounts').select('id', { count: 'exact', head: true }).like('note', 'global-config-test-%'),
  ]);
  assert.equal(leftoverSchools, 0);
  assert.equal(leftoverRunningTypes, 0);
  assert.equal(leftoverAccounts, 0);

  assert.deepEqual(consoleErrors, []);
  console.log(JSON.stringify({
    settingsModules: settings.headings,
    noFaceConfigurationRequest: true,
    globalSchoolCrud: true,
    globalRunningTypeCrud: true,
    namesDeduplicated: true,
    alipayCreateWithoutCredentials: true,
    alipayEditWithoutCredentials: true,
    alipayEditFieldsHidden: true,
    otherPlatformsStillRequireCredentials: true,
    desktopLayout,
    mobileLayout,
    mobileDropdown,
    testDataCleaned: true,
    consoleErrors,
  }, null, 2));
} finally {
  if (accountId) {
    await admin.from('operation_logs').delete().eq('target_id', accountId);
    await admin.from('accounts').delete().eq('id', accountId);
  }
  if (runningTypeId) await admin.from('running_types').delete().eq('id', runningTypeId);
  if (schoolId) await admin.from('schools').delete().eq('id', schoolId);
  await context.close();
  await browser.close();
}
