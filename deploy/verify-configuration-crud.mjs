import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createClient } from '@supabase/supabase-js';

const appUrl = 'https://xuehuayd.top';
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const prefix = `codex-${Date.now().toString(36)}`;

function loadEnv(path) {
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  }));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitFor(fn, timeoutMs = 25000) {
  const end = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError || new Error('Timed out');
}

class Cdp {
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.ws = new WebSocket(url);
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        if (message.method === 'Runtime.exceptionThrown') {
          this.consoleErrors.push(message.params?.exceptionDetails?.text || message.method);
        }
        if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
          this.consoleErrors.push(message.params.entry.text || message.method);
        }
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Browser evaluation failed');
    }
    return response.result?.value;
  }

  close() {
    this.ws.close();
  }
}

const env = loadEnv('.env.local');
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const created = {
  accounts: new Set(),
  categories: new Set(),
  schools: new Set(),
  runningTypes: new Set(),
  faceOptions: new Set(),
};

let port;
let profileDir;
let chrome;
let cdp;

async function rememberConfiguration() {
  const tables = [
    ['account_categories', 'categories'],
    ['schools', 'schools'],
    ['running_types', 'runningTypes'],
    ['face_options', 'faceOptions'],
  ];
  for (const [table, key] of tables) {
    const { data, error } = await admin.from(table).select('id').like('name', `${prefix}%`);
    if (error) throw error;
    for (const row of data || []) created[key].add(row.id);
  }
}

async function cleanup() {
  await rememberConfiguration().catch(() => undefined);
  const accountIds = [...created.accounts];
  if (accountIds.length) {
    await admin.from('operation_logs').delete().in('target_id', accountIds);
    await admin.from('accounts').delete().in('id', accountIds);
  }
  for (const [table, ids] of [
    ['face_options', created.faceOptions],
    ['running_types', created.runningTypes],
    ['schools', created.schools],
    ['account_categories', created.categories],
  ]) {
    if (ids.size) await admin.from(table).delete().in('id', [...ids]);
  }
}

try {
  const { data: profiles, error: profileError } = await admin.from('profiles').select('id').eq('role', 'admin').limit(1);
  if (profileError || !profiles?.[0]) throw new Error('No administrator profile is available');
  const { data: userPage, error: userError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (userError) throw userError;
  const verificationUser = userPage.users.find((user) => user.id === profiles[0].id && user.email);
  if (!verificationUser?.email) throw new Error('Administrator email is unavailable');
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: verificationUser.email,
    options: { redirectTo: `${appUrl}/auth/callback?next=/dashboard` },
  });
  if (linkError || !linkData?.properties?.action_link) throw linkError || new Error('Unable to create verification session');

  port = await freePort();
  profileDir = mkdtempSync(join(tmpdir(), 'snowflake-config-verify-'));
  chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    linkData.properties.action_link,
  ], { stdio: 'ignore', windowsHide: true });

  const page = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const pages = await response.json();
    return pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
  });
  cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  await waitFor(async () => {
    const state = await cdp.evaluate(`({ href: location.href, text: document.body.innerText })`);
    return state.href?.startsWith(`${appUrl}/dashboard`) && state.text?.includes('工作台');
  }, 60000);

  async function appRequest(path, { method = 'GET', body } = {}) {
    const request = JSON.stringify({ path, method, body });
    const result = await cdp.evaluate(`(async () => {
      const input = ${request};
      const response = await fetch(input.path, {
        method: input.method,
        headers: input.body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
      });
      const text = await response.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { text }; }
      return { status: response.status, data };
    })()`);
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`${method} ${path} failed (${result.status}): ${result.data?.error || result.data?.text || 'unknown error'}`);
    }
    return result;
  }

  async function navigate(path, expectedText) {
    await cdp.send('Page.navigate', { url: `${appUrl}${path}` });
    return waitFor(async () => {
      const state = await cdp.evaluate(`({ href: location.href, text: document.body.innerText })`);
      return state.href?.startsWith(`${appUrl}${path}`) && state.text?.includes(expectedText) ? state : null;
    });
  }

  const names = {
    existingCategory: `${prefix}-已有分类`,
    existingSchool: `${prefix}-已有学校`,
    existingType: `${prefix}-已有跑步类型`,
    existingFace: `${prefix}-已有人脸`,
    customCategory: `${prefix}-自定义分类`,
    customSchool: `${prefix}-自定义学校`,
    customType: `${prefix}-自定义跑步类型`,
    customFace: `${prefix}-自定义人脸`,
    editSchool: `${prefix}-编辑新学校`,
    editType: `${prefix}-编辑新跑步类型`,
    editFace: `${prefix}-编辑新人脸`,
    unreferencedSchool: `${prefix}-未引用学校`,
    referencedSchool: `${prefix}-被引用学校`,
  };

  const existingCategory = (await appRequest('/api/categories', { method: 'POST', body: { name: names.existingCategory } })).data.category;
  created.categories.add(existingCategory.id);
  const existingSchool = (await appRequest('/api/schools', { method: 'POST', body: { category_id: existingCategory.id, name: names.existingSchool } })).data.school;
  created.schools.add(existingSchool.id);
  const existingType = (await appRequest('/api/running-types', { method: 'POST', body: { school_id: existingSchool.id, name: names.existingType } })).data.running_type;
  created.runningTypes.add(existingType.id);
  const existingFace = (await appRequest('/api/face-options', { method: 'POST', body: { running_type_id: existingType.id, name: names.existingFace } })).data.face_option;
  created.faceOptions.add(existingFace.id);

  const accountPayload = (username, configuration, note) => ({
    ...configuration,
    username,
    password: 'Codex-verify-2026',
    distance_per_run: 2.5,
    order_count: 3,
    order_time: new Date().toISOString(),
    note,
  });
  const existingConfig = {
    category: { id: existingCategory.id, name: existingCategory.name },
    school: { id: existingSchool.id, name: existingSchool.name },
    running_type: { id: existingType.id, name: existingType.name },
    face_option: { id: existingFace.id, name: existingFace.name },
  };
  const existingUsername = `${prefix}-existing`;
  const existingAccountId = (await appRequest('/api/accounts', {
    method: 'POST',
    body: accountPayload(existingUsername, existingConfig, `${prefix}-existing-note`),
  })).data.id;
  created.accounts.add(existingAccountId);

  const customUsername = `${prefix}-custom`;
  const customPayload = accountPayload(customUsername, {
    category: { id: '', name: `  ${names.customCategory}  ` },
    school: { id: '', name: ` ${names.customSchool} ` },
    running_type: { id: '', name: ` ${names.customType} ` },
    face_option: { id: '', name: ` ${names.customFace} ` },
  }, `${prefix}-searchable-note`);
  const customAccountId = (await appRequest('/api/accounts', { method: 'POST', body: customPayload })).data.id;
  created.accounts.add(customAccountId);
  await rememberConfiguration();

  const configurationRows = {};
  for (const [table, key, name] of [
    ['account_categories', 'category', names.customCategory],
    ['schools', 'school', names.customSchool],
    ['running_types', 'runningType', names.customType],
    ['face_options', 'faceOption', names.customFace],
  ]) {
    const { data, error } = await admin.from(table).select('*').eq('name', name);
    if (error) throw error;
    assert.equal(data.length, 1, `${table} must contain exactly one trimmed custom value`);
    configurationRows[key] = data[0];
  }
  assert.equal(configurationRows.school.category_id, configurationRows.category.id);
  assert.equal(configurationRows.runningType.school_id, configurationRows.school.id);
  assert.equal(configurationRows.faceOption.running_type_id, configurationRows.runningType.id);

  const duplicateUsername = `${prefix}-duplicate`;
  const duplicateAccountId = (await appRequest('/api/accounts', {
    method: 'POST',
    body: accountPayload(duplicateUsername, {
      category: { id: '', name: ` ${names.customCategory} ` },
      school: { id: '', name: `  ${names.customSchool}  ` },
      running_type: { id: '', name: names.customType },
      face_option: { id: '', name: ` ${names.customFace} ` },
    }, `${prefix}-duplicate-note`),
  })).data.id;
  created.accounts.add(duplicateAccountId);
  for (const [table, name] of [
    ['account_categories', names.customCategory],
    ['schools', names.customSchool],
    ['running_types', names.customType],
    ['face_options', names.customFace],
  ]) {
    const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true }).eq('name', name);
    if (error) throw error;
    assert.equal(count, 1, `${table} duplicate trim reuse failed`);
  }

  const searchResult = await appRequest(`/api/accounts?search=${encodeURIComponent(customUsername)}`);
  assert(searchResult.data.accounts.some((account) => account.id === customAccountId), 'Account API search did not find the custom account');

  const editPayload = accountPayload(customUsername, {
    category: { id: configurationRows.category.id, name: configurationRows.category.name },
    school: { id: '', name: names.editSchool },
    running_type: { id: '', name: names.editType },
    face_option: { id: '', name: names.editFace },
  }, `${prefix}-edited-note`);
  editPayload.password = '';
  await appRequest(`/api/accounts/${customAccountId}`, { method: 'PATCH', body: editPayload });
  await rememberConfiguration();
  const { data: editedAccount, error: editedError } = await admin.from('accounts').select('*').eq('id', customAccountId).single();
  if (editedError) throw editedError;
  const { data: editSchool, error: editSchoolError } = await admin.from('schools').select('*').eq('name', names.editSchool).single();
  if (editSchoolError) throw editSchoolError;
  const { data: editType, error: editTypeError } = await admin.from('running_types').select('*').eq('name', names.editType).single();
  if (editTypeError) throw editTypeError;
  const { data: editFace, error: editFaceError } = await admin.from('face_options').select('*').eq('name', names.editFace).single();
  if (editFaceError) throw editFaceError;
  assert.deepEqual(
    [editedAccount.category_id, editedAccount.school_id, editedAccount.running_type_id, editedAccount.face_option_id],
    [configurationRows.category.id, editSchool.id, editType.id, editFace.id],
  );

  await navigate('/accounts', '添加账号');
  await waitFor(async () => (await cdp.evaluate(`document.body.innerText.includes(${JSON.stringify(customUsername)})`)) === true, 60000);
  const addModalChecks = await cdp.evaluate(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const addButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === '添加账号');
    addButton?.click();
    await wait(200);
    const modal = [...document.querySelectorAll('h2')].find((node) => node.textContent?.trim() === '添加账号')?.closest('.fixed');
    if (!modal) return { opened: false };
    const boxes = [...modal.querySelectorAll('input[role="combobox"]')];
    const categoryInput = boxes[0];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    categoryInput.focus();
    setter.call(categoryInput, ${JSON.stringify(names.existingCategory.slice(0, -2))});
    categoryInput.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(150);
    const searchShowsExisting = modal.textContent.includes(${JSON.stringify(names.existingCategory)});
    categoryInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(150);
    const keyboardSelected = categoryInput.value === ${JSON.stringify(names.existingCategory)};
    const schoolInput = boxes[1];
    schoolInput.click();
    await wait(100);
    const schoolOption = [...modal.querySelectorAll('[role="option"]')].find((node) => node.textContent?.includes(${JSON.stringify(names.existingSchool)}));
    schoolOption?.click();
    await wait(150);
    const mouseSelected = schoolInput.value === ${JSON.stringify(names.existingSchool)};
    setter.call(categoryInput, ${JSON.stringify(`${prefix}-UI创建候选`)});
    categoryInput.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(150);
    const createOptionVisible = modal.textContent.includes(${JSON.stringify(`创建“${prefix}-UI创建候选”`)});
    return {
      opened: true,
      comboboxCount: boxes.length,
      placeholders: boxes.map((input) => input.placeholder),
      searchShowsExisting,
      keyboardSelected,
      mouseSelected,
      createOptionVisible,
    };
  })()`);
  assert.deepEqual(addModalChecks.placeholders, ['选择或输入账号分类', '选择或输入学校', '选择或输入跑步类型', '选择或输入是否人脸']);
  assert.equal(addModalChecks.comboboxCount, 4);
  assert.equal(addModalChecks.searchShowsExisting, true);
  assert.equal(addModalChecks.keyboardSelected, true);
  assert.equal(addModalChecks.mouseSelected, true);
  assert.equal(addModalChecks.createOptionVisible, true);
  writeFileSync('configuration-combobox-production.png', Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).data, 'base64'));

  await cdp.evaluate(`document.querySelector('[aria-label="关闭"]')?.click()`);
  await waitFor(async () => (await cdp.evaluate(`!document.querySelector('input[role="combobox"]')`)) === true);
  const editEcho = await cdp.evaluate(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const row = [...document.querySelectorAll('tbody tr')].find((item) => item.textContent?.includes(${JSON.stringify(customUsername)}));
    const editButton = row?.querySelector('.lucide-pencil')?.closest('button');
    editButton?.click();
    await wait(200);
    const modal = [...document.querySelectorAll('h2')].find((node) => node.textContent?.trim() === '编辑账号')?.closest('.fixed');
    return modal ? [...modal.querySelectorAll('input[role="combobox"]')].map((input) => input.value) : [];
  })()`);
  assert.deepEqual(editEcho, [names.customCategory, names.editSchool, names.editType, names.editFace]);

  await navigate('/settings', '账号分类');
  await waitFor(async () => (await cdp.evaluate(`document.body.innerText.includes(${JSON.stringify(names.customCategory)})`)) === true, 60000);
  const settingsText = await cdp.evaluate(`document.body.innerText`);
  for (const name of [names.customCategory, names.customSchool, names.customType, names.customFace, names.editSchool, names.editType, names.editFace]) {
    assert(settingsText.includes(name), `Settings page did not show ${name}`);
  }

  const unreferencedSchool = (await appRequest('/api/schools', {
    method: 'POST',
    body: { category_id: configurationRows.category.id, name: names.unreferencedSchool },
  })).data.school;
  created.schools.add(unreferencedSchool.id);
  await appRequest(`/api/schools/${unreferencedSchool.id}`, { method: 'DELETE' });
  const { data: removedUnreferenced, error: removedUnreferencedError } = await admin.from('schools').select('id').eq('id', unreferencedSchool.id).maybeSingle();
  if (removedUnreferencedError) throw removedUnreferencedError;
  assert.equal(removedUnreferenced, null);

  const referencedSchool = (await appRequest('/api/schools', {
    method: 'POST',
    body: { category_id: configurationRows.category.id, name: names.referencedSchool },
  })).data.school;
  created.schools.add(referencedSchool.id);
  const referencedUsername = `${prefix}-referenced`;
  const referencedAccountId = (await appRequest('/api/accounts', {
    method: 'POST',
    body: accountPayload(referencedUsername, {
      category: { id: configurationRows.category.id, name: configurationRows.category.name },
      school: { id: referencedSchool.id, name: referencedSchool.name },
      running_type: null,
      face_option: null,
    }, `${prefix}-referenced-note`),
  })).data.id;
  created.accounts.add(referencedAccountId);

  await navigate('/settings', names.referencedSchool);
  await waitFor(async () => (await cdp.evaluate(`document.body.innerText.includes(${JSON.stringify(names.referencedSchool)})`)) === true, 60000);
  const deleteClicked = await cdp.evaluate(`(() => {
    const schoolSection = [...document.querySelectorAll('section')].find((section) => section.querySelector('h2')?.textContent?.trim() === '学校');
    const row = [...(schoolSection?.querySelectorAll('.divide-y > div') || [])].find((item) => item.textContent?.includes(${JSON.stringify(names.referencedSchool)}));
    const deleteButton = row?.querySelector('button[aria-label="删除"]');
    if (!deleteButton) return false;
    deleteButton.click();
    return true;
  })()`);
  assert.equal(deleteClicked, true, 'Referenced school delete button was not found');
  const dialogMessage = await waitFor(async () => {
    const text = await cdp.evaluate(`document.querySelector('[role="dialog"]')?.textContent || ''`);
    return text.includes(names.referencedSchool) ? text : null;
  });
  assert(dialogMessage.includes(names.referencedSchool));
  assert(dialogMessage.includes('已有账号不会被删除，但这些账号的学校关联将被清空'));
  writeFileSync('configuration-delete-dialog-production.png', Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).data, 'base64'));
  await cdp.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent?.includes('确认删除'))?.click()`);
  await waitFor(async () => (await cdp.evaluate(`document.body.innerText.includes('学校已删除')`)) === true);

  const { data: referencedAccount, error: referencedAccountError } = await admin.from('accounts').select('id,school_id').eq('id', referencedAccountId).single();
  if (referencedAccountError) throw referencedAccountError;
  assert.equal(referencedAccount.school_id, null);
  const { data: deletedReferencedSchool, error: deletedReferencedSchoolError } = await admin.from('schools').select('id').eq('id', referencedSchool.id).maybeSingle();
  if (deletedReferencedSchoolError) throw deletedReferencedSchoolError;
  assert.equal(deletedReferencedSchool, null);

  await navigate('/accounts', '账号管理');
  await waitFor(async () => (await cdp.evaluate(`document.body.innerText.includes(${JSON.stringify(referencedUsername)})`)) === true, 60000);
  const nullSchoolDisplay = await cdp.evaluate(`(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((item) => item.textContent?.includes(${JSON.stringify(referencedUsername)}));
    return { exists: Boolean(row), showsEmptySchool: Boolean(row?.textContent?.includes('—')) };
  })()`);
  assert.equal(nullSchoolDisplay.exists, true);
  assert.equal(nullSchoolDisplay.showsEmptySchool, true);
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(async () => (await cdp.evaluate(`document.body.innerText.includes('账号管理') && Boolean([...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === '添加账号'))`)) === true, 60000);
  const refreshedAccounts = await appRequest(`/api/accounts?search=${encodeURIComponent(referencedUsername)}`);
  assert(refreshedAccounts.data.accounts.some((account) => account.id === referencedAccountId && account.school_id === null));

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(async () => (await cdp.evaluate(`document.body.innerText.includes('账号管理') && Boolean([...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === '添加账号'))`)) === true, 60000);
  await waitFor(async () => (await cdp.evaluate(`(() => {
    const modal = [...document.querySelectorAll('h2')].find((node) => node.textContent?.trim() === '添加账号')?.closest('.fixed');
    if (modal) return true;
    [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === '添加账号')?.click();
    return false;
  })()`)) === true, 60000);
  const mobileChecks = await waitFor(async () => {
    const result = await cdp.evaluate(`(() => {
      const modal = [...document.querySelectorAll('h2')].find((node) => node.textContent?.trim() === '添加账号')?.closest('.fixed');
      if (!modal) return null;
      const boxes = [...modal.querySelectorAll('input[role="combobox"]')];
      return {
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        comboboxCount: boxes.length,
        boxesInsideViewport: boxes.every((input) => {
          const rect = input.closest('.input').getBoundingClientRect();
          return rect.left >= 0 && rect.right <= window.innerWidth;
        }),
      };
    })()`);
    return result?.comboboxCount === 4 ? result : null;
  });
  assert.equal(mobileChecks.noHorizontalOverflow, true);
  assert.equal(mobileChecks.boxesInsideViewport, true);
  writeFileSync('configuration-combobox-mobile-production.png', Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).data, 'base64'));
  await cdp.send('Emulation.clearDeviceMetricsOverride');

  console.log(JSON.stringify({
    prefix,
    authenticatedRlsCrud: true,
    existingHierarchySelection: true,
    customHierarchyCreated: true,
    duplicateTrimReuse: true,
    search: true,
    editExistingAndNewOptions: true,
    combobox: addModalChecks,
    editEcho,
    settingsPersistence: true,
    unreferencedSchoolDelete: true,
    referencedSchoolDelete: true,
    referencedAccountPreserved: true,
    schoolIdCleared: true,
    refreshPersistence: true,
    nullSafeAccountDisplay: nullSchoolDisplay,
    mobile: mobileChecks,
    browserErrors: cdp.consoleErrors,
  }, null, 2));
} finally {
  await cleanup().catch((error) => console.error(`Cleanup failed: ${error.message}`));
  cdp?.close();
  chrome?.kill();
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (profileDir) rmSync(profileDir, { recursive: true, force: true });
}
