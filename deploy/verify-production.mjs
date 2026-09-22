import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createClient } from '@supabase/supabase-js';

const appUrl = 'https://xuehuayd.top';
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function loadEnv(path) {
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
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
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitFor(fn, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw lastError || new Error('Timed out');
}

class Cdp {
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.ws = new WebSocket(url);
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        if (message.method === 'Runtime.exceptionThrown' || (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error')) {
          this.events.push(message.method);
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
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error('Browser evaluation failed');
    return result.result?.value;
  }
  close() { this.ws.close(); }
}

let port;
let profileDir;
let chrome;

let cdp;
try {
  const env = loadEnv('.env.local');
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profiles, error: profileError } = await admin.from('profiles').select('id').eq('role', 'admin').limit(1);
  if (profileError || !profiles?.[0]) throw new Error('No administrator profile is available for verification');
  const { data: userPage, error: userError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (userError) throw new Error('Unable to list verification users');
  const verificationUser = userPage.users.find(user => user.id === profiles[0].id && user.email);
  if (!verificationUser?.email) throw new Error('Administrator email is unavailable');
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: verificationUser.email, options: { redirectTo: `${appUrl}/auth/callback?next=/dashboard` } });
  const actionLink = linkData?.properties?.action_link;
  if (linkError || !actionLink) throw new Error('Unable to create a verification session');

  port = await freePort();
  profileDir = mkdtempSync(join(tmpdir(), 'snowflake-verify-'));
  chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, actionLink,
  ], { stdio: 'ignore', windowsHide: true });

  const page = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const pages = await response.json();
    return pages.find(item => item.type === 'page' && item.webSocketDebuggerUrl);
  });
  cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  async function snapshot(url, expectedText) {
    await cdp.send('Page.navigate', { url });
    return waitFor(async () => {
      const result = await cdp.evaluate(`({ href: location.href, text: document.body.innerText, title: document.title })`);
      return result.text?.includes(expectedText) ? result : null;
    }, 25000);
  }

  const dashboard = await waitFor(async () => {
    const result = await cdp.evaluate(`({ href: location.href, text: document.body.innerText, title: document.title })`);
    return result.href?.startsWith(`${appUrl}/dashboard`) && result.text?.includes('工作台') ? result : null;
  }, 60000);
  const settings = await snapshot(`${appUrl}/settings`, '账号分类');
  await waitFor(async () => (await cdp.evaluate(`document.querySelectorAll('section > div > h2').length >= 4`)) === true, 60000);
  writeFileSync('settings-production.png', Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).data, 'base64'));
  const settingHeadings = await cdp.evaluate(`([...document.querySelectorAll('section > div > h2')].map(node => node.textContent?.trim()))`);
  const settingEditorChecks = await cdp.evaluate(`(async () => {
    const result = {};
    for (const [key, heading] of [['school', '学校'], ['running', '跑步类型'], ['face', '是否人脸']]) {
      const section = [...document.querySelectorAll('section')].find(node => node.querySelector('h2')?.textContent?.trim() === heading);
      const editButton = section?.querySelector('.lucide-pencil')?.closest('button');
      if (!editButton) { result[key] = 'no-data-row'; continue; }
      editButton.click();
      await new Promise(resolve => setTimeout(resolve, 150));
      result[key] = Boolean(section.querySelector('.divide-y select'));
    }
    return result;
  })()`);

  const accounts = await snapshot(`${appUrl}/accounts`, '添加账号');
  await waitFor(async () => (await cdp.evaluate(`Boolean([...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === '添加账号')) && document.querySelectorAll('select[aria-label]').length >= 5`)) === true, 60000);
  const filterChecks = await cdp.evaluate(`(() => {
    const card = [...document.querySelectorAll('.card')].find(node => node.querySelector('[aria-label="账号分类"]'));
    const controls = [...card.querySelectorAll('input[aria-label], select[aria-label]')];
    return {
      order: controls.map(node => node.getAttribute('aria-label')),
      defaults: controls.map(node => node.tagName === 'SELECT' ? node.selectedOptions[0]?.textContent?.trim() : node.getAttribute('placeholder')),
      noTechnicalLabels: !card.textContent.includes('索引'),
    };
  })()`);
  const cascadeChecks = await cdp.evaluate(`(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const select = label => document.querySelector('select[aria-label="' + label + '"]');
    const change = (node, value) => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(node, value);
      node.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const [schoolResult, typeResult, faceResult] = await Promise.all([
      fetch('/api/schools').then(response => response.json()),
      fetch('/api/running-types').then(response => response.json()),
      fetch('/api/face-options').then(response => response.json()),
    ]);
    const targetSchool = schoolResult.schools?.[0];
    if (!targetSchool) return { noSchoolData: true };
    change(select('学校'), targetSchool.id);
    await wait(400);
    change(select('账号分类'), targetSchool.category_id);
    await wait(500);
    const expectedSchools = schoolResult.schools.filter(item => item.category_id === targetSchool.category_id).map(item => item.id).sort();
    const shownSchools = [...select('学校').options].map(option => option.value).filter(Boolean).sort();
    const categoryReset = select('学校').value === '' && select('跑步类型').value === '' && select('是否人脸').value === '';
    change(select('学校'), targetSchool.id);
    await wait(500);
    const expectedTypes = typeResult.running_types.filter(item => item.school_id === targetSchool.id).map(item => item.id).sort();
    const shownTypes = [...select('跑步类型').options].map(option => option.value).filter(Boolean).sort();
    const schoolReset = select('跑步类型').value === '' && select('是否人脸').value === '';
    let typeReset = true;
    let faceOptionsValid = true;
    if (expectedTypes[0]) {
      change(select('跑步类型'), expectedTypes[0]);
      await wait(500);
      const expectedFaces = faceResult.face_options.filter(item => item.running_type_id === expectedTypes[0]).map(item => item.id).sort();
      const shownFaces = [...select('是否人脸').options].map(option => option.value).filter(Boolean).sort();
      typeReset = select('是否人脸').value === '';
      faceOptionsValid = JSON.stringify(shownFaces) === JSON.stringify(expectedFaces);
    } else {
      faceOptionsValid = [...select('是否人脸').options].every(option => !option.value);
    }
    return {
      categoryReset,
      schoolReset,
      typeReset,
      schoolOptionsValid: JSON.stringify(shownSchools) === JSON.stringify(expectedSchools),
      runningTypeOptionsValid: JSON.stringify(shownTypes) === JSON.stringify(expectedTypes),
      faceOptionsValid,
      dataCoverage: { schools: schoolResult.schools.length, runningTypes: typeResult.running_types.length, faceOptions: faceResult.face_options.length },
    };
  })()`);
  const combinedSelection = await cdp.evaluate(`(async () => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const setSelect = (label, value) => {
      const node = document.querySelector('select[aria-label="' + label + '"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(node, value);
      node.dispatchEvent(new Event('change', { bubbles: true }));
      return node;
    };
    const face = document.querySelector('select[aria-label="是否人脸"]');
    const faceId = [...face.options].find(option => option.value)?.value || '';
    if (faceId) setSelect('是否人脸', faceId);
    setSelect('下单时间', 'today');
    const search = document.querySelector('[aria-label="搜索学校或账号"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, '南通大学');
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(1000);
    const accountUrls = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => name.includes('/api/accounts?'));
    const latestUrl = accountUrls.at(-1);
    const params = latestUrl ? new URL(latestUrl).searchParams : new URLSearchParams();
    return {
      search: search.value,
      category: document.querySelector('select[aria-label="账号分类"]').value,
      school: document.querySelector('select[aria-label="学校"]').value,
      runningType: document.querySelector('select[aria-label="跑步类型"]').value,
      faceOption: face.value,
      dateFilter: document.querySelector('select[aria-label="下单时间"]').value,
      apiUsesAllHierarchyFilters: ['category_id', 'school_id', 'running_type_id', 'face_option_id'].every(key => params.has(key)),
    };
  })()`);
  const addAccountClicked = await cdp.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(node => node.textContent?.trim() === '添加账号');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!addAccountClicked) throw new Error('Add-account control was not found');
  const accountModal = await waitFor(async () => {
    const result = await cdp.evaluate(`(() => {
      const modal = [...document.querySelectorAll('h2')].find(node => node.textContent?.trim() === '添加账号')?.closest('.fixed');
      return modal ? [...modal.querySelectorAll('label')].map(node => node.textContent?.trim()) : null;
    })()`);
    return result?.length ? result : null;
  });
  const requiredOrder = ['账号分类', '学校', '跑步类型', '是否人脸', '账号', '密码', '单次跑步公里数', '下单次数', '下单时间', '备注'];
  const accountOrderOk = requiredOrder.every((label, index) => accountModal[index]?.startsWith(label));

  await cdp.evaluate(`(() => {
    const modal = [...document.querySelectorAll('h2')].find(node => node.textContent?.trim() === '添加账号')?.closest('.fixed');
    modal?.querySelector('button')?.click();
  })()`);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await snapshot(`${appUrl}/accounts`, '添加账号');
  await waitFor(async () => (await cdp.evaluate(`Boolean([...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === '添加账号')) && document.querySelectorAll('select[aria-label]').length >= 5`)) === true, 60000);
  const mobileLayout = await cdp.evaluate(`(() => {
    const controls = [...document.querySelectorAll('[aria-label="搜索学校或账号"], select[aria-label]')].slice(0, 6);
    return {
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      controlsInsideViewport: controls.every(node => { const rect = node.getBoundingClientRect(); return rect.left >= 0 && rect.right <= window.innerWidth; }),
      controlCount: controls.length,
    };
  })()`);
  writeFileSync('accounts-filter-mobile.png', Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).data, 'base64'));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await snapshot(`${appUrl}/accounts`, '添加账号');
  await waitFor(async () => (await cdp.evaluate(`Boolean([...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === '添加账号')) && document.querySelectorAll('select[aria-label]').length >= 5`)) === true, 60000);
  const desktopLayout = await cdp.evaluate(`(() => {
    const controls = [...document.querySelectorAll('[aria-label="搜索学校或账号"], select[aria-label]')].slice(0, 6);
    return {
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
      singleRow: new Set(controls.map(node => Math.round(node.getBoundingClientRect().top))).size === 1,
      controlCount: controls.length,
    };
  })()`);
  writeFileSync('accounts-filter-desktop.png', Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).data, 'base64'));
  await cdp.send('Page.reload', { ignoreCache: true });
  const refreshOk = await waitFor(async () => (await cdp.evaluate(`document.body.innerText.includes('账号管理')`)) === true, 25000);

  const backups = await snapshot(`${appUrl}/backups`, '自动备份计划');
  const backupControls = await cdp.evaluate(`({
    switchText: [...document.querySelectorAll('button')].some(node => node.textContent?.includes('自动备份已关闭') || node.textContent?.includes('自动备份已开启')),
    daily: [...document.querySelectorAll('option')].some(node => node.value === 'daily'),
    weekly: [...document.querySelectorAll('option')].some(node => node.value === 'weekly'),
    custom: [...document.querySelectorAll('option')].some(node => node.value === 'custom' && node.textContent?.includes('自定义日期时间')),
    datetime: Boolean(document.querySelector('input[type="datetime-local"]')),
  })`);

  console.log(JSON.stringify({
    dashboard: dashboard.title === '雪花运动',
    settings: JSON.stringify(settingHeadings) === JSON.stringify(['账号分类', '学校', '跑步类型', '是否人脸']) && !settings.text.includes('索引'),
    settingHeadings,
    settingEditorChecks,
    accounts: accounts.text.includes('账号管理'),
    filterChecks,
    cascadeChecks,
    combinedSelection,
    accountModalOrder: accountOrderOk,
    accountModalLabels: accountModal,
    mobileLayout,
    desktopLayout,
    refreshOk,
    browserErrorCount: cdp.events.length,
    backups: backups.text.includes('自定义日期时间'),
    backupControls,
  }, null, 2));
} finally {
  cdp?.close();
  chrome?.kill();
  await new Promise(resolve => setTimeout(resolve, 500));
  if (profileDir) rmSync(profileDir, { recursive: true, force: true });
}
