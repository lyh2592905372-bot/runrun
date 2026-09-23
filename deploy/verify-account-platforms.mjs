import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';

const appUrl = process.env.RUNFLOW_VERIFY_URL || 'http://localhost:3000';
const chromePath = process.env.RUNFLOW_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chromeProxy = process.env.RUNFLOW_CHROME_PROXY;

function loadEnv(path) {
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  }));
}

async function createVerificationLink() {
  const env = loadEnv('.env.local');
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profiles, error: profileError } = await admin.from('profiles').select('id').eq('role', 'admin').limit(1);
  if (profileError || !profiles?.[0]) throw profileError || new Error('No administrator profile is available');
  const { data: userPage, error: userError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (userError) throw userError;
  const user = userPage.users.find((candidate) => candidate.id === profiles[0].id && candidate.email);
  if (!user?.email) throw new Error('Administrator email is unavailable');
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
    options: { redirectTo: `${appUrl}/auth/callback?next=/accounts/sport-world` },
  });
  if (error || !data?.properties?.action_link) throw error || new Error('Unable to create a verification session');
  return data.properties.action_link;
}

const platforms = [
  { slug: 'sport-world', name: '运动世界', labels: ['学校', '跑步类型', '账号', '密码', '校区名称', '跑步时间', '公里数', '次数', '下单时间', '备注'] },
  { slug: 'flash-campus', name: '闪动校园', labels: ['学校', '跑步类型', '账号', '密码', '跑步时间', '公里数', '次数', '下单时间', '围栏名称', '备注'] },
  { slug: 'alipay-sunshine', name: '支付宝阳光跑', labels: ['学校', '跑步类型', '姓名', '学号', '跑步时间', '公里数', '次数', '下单时间', '备注'] },
];

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  ...(chromeProxy ? { proxy: { server: chromeProxy } } : {}),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
page.on('pageerror', (error) => consoleErrors.push(error.message));

try {
  await page.goto(await createVerificationLink(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForURL(`${appUrl}/accounts/sport-world`, { timeout: 60000 });
  await page.getByRole('button', { name: '添加账号' }).waitFor({ timeout: 30000 });
  const initialAccountStatus = await page.evaluate(async () => (await fetch('/api/accounts')).status);
  assert.equal(initialAccountStatus, 200, `账号 API 返回 ${initialAccountStatus}，请先应用账号平台 migration`);

  const desktopOrder = await page.locator('aside nav').evaluate((nav) => [...nav.children]
    .filter((node) => node.matches('a, button'))
    .map((node) => node.textContent?.trim()));
  assert.deepEqual(desktopOrder, ['首页', '账号管理', '进度管理', '操作记录', '数据与备份', '设置']);

  const accountMenu = page.locator('aside nav > button').filter({ hasText: '账号管理' });
  const childLinks = page.locator('aside nav a[href^="/accounts/"]');
  assert.deepEqual(await childLinks.allTextContents(), platforms.map((platform) => platform.name));
  await accountMenu.click();
  await assert.rejects(() => childLinks.first().waitFor({ state: 'visible', timeout: 500 }));
  await accountMenu.click();
  await childLinks.first().waitFor({ state: 'visible' });

  const formChecks = {};
  for (const platform of platforms) {
    await page.goto(`${appUrl}/accounts/${platform.slug}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '添加账号' }).waitFor();
    assert.equal((await page.locator('h1').textContent())?.trim(), `${platform.name}账号`);
    const selected = page.locator(`aside nav a[href="/accounts/${platform.slug}"]`);
    assert.match(await selected.getAttribute('class'), /bg-brand-50/);

    await page.getByRole('button', { name: '添加账号' }).click();
    const modal = page.locator('.fixed').filter({ has: page.getByRole('heading', { name: '添加账号' }) });
    await modal.waitFor();
    const labels = (await modal.locator('label').allTextContents()).map((label) => label.trim());
    assert.deepEqual(labels, platform.labels);
    assert.equal(labels.some((label) => label.includes('运动世界账号') || label.includes('运动世界密码')), false);
    const fieldHeights = await modal.locator('.input').evaluateAll((elements) => elements.slice(0, 3).map((element) => element.getBoundingClientRect().height));
    assert(fieldHeights.every((height) => height === fieldHeights[0]), `${platform.name}学校、跑步类型与普通输入框高度不一致：${fieldHeights.join(', ')}`);
    const initialValues = await modal.locator('input, textarea').evaluateAll((elements) => elements.map((element) => element.value));
    assert(initialValues.every((value) => value === ''), `${platform.name}新增表单存在非空默认值`);

    const editable = modal.locator('input, textarea');
    for (let index = 0; index < await editable.count(); index += 1) {
      const input = editable.nth(index);
      const type = await input.getAttribute('type');
      await input.fill(type === 'number' ? '1' : type === 'datetime-local' ? '2026-09-22T12:00' : `test-${index}`);
    }
    await modal.getByRole('button', { name: '关闭' }).click();
    await page.getByRole('button', { name: '添加账号' }).click();
    const reopened = page.locator('.fixed').filter({ has: page.getByRole('heading', { name: '添加账号' }) });
    const reopenedValues = await reopened.locator('input, textarea').evaluateAll((elements) => elements.map((element) => element.value));
    assert(reopenedValues.every((value) => value === ''), `${platform.name}重新打开新增表单后残留数据`);
    await reopened.getByRole('button', { name: '关闭' }).click();
    formChecks[platform.name] = { labels, emptyOnOpen: true, emptyAfterReopen: true };
  }

  const mobileChecks = {};
  for (const width of [375, 390, 430, 768]) {
    await page.setViewportSize({ width, height: 812 });
    await page.goto(`${appUrl}/accounts/sport-world`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '添加账号' }).waitFor();
    await page.locator('header button').first().click();
    await page.waitForFunction(() => document.querySelector('aside')?.getBoundingClientRect().left >= -1);
    const layout = await page.locator('aside').evaluate((aside) => {
      const rect = aside.getBoundingClientRect();
      return {
        rect: { left: rect.left, right: rect.right, width: rect.width },
        insideViewport: rect.left >= -2 && rect.right <= window.innerWidth + 2,
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        sidebarFits: aside.scrollWidth <= window.innerWidth,
      };
    });
    assert(Object.values(layout).every(Boolean), `${width}px 侧栏布局异常：${JSON.stringify(layout)}`);
    await page.locator('aside nav > button').filter({ hasText: '账号管理' }).click();
    await assert.rejects(() => page.locator('aside nav a[href^="/accounts/"]').first().waitFor({ state: 'visible', timeout: 500 }));
    await page.locator('aside nav > button').filter({ hasText: '账号管理' }).click();
    await page.locator('aside nav a[href="/accounts/sport-world"]').waitFor({ state: 'visible' });
    mobileChecks[width] = { ...layout, collapsible: true };
  }

  assert.deepEqual(consoleErrors, []);
  console.log(JSON.stringify({ desktopMenuOrder: desktopOrder, formChecks, mobileChecks, consoleErrors }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
