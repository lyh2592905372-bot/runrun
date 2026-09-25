import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

function loadEnv(file) {
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#') && line.includes('=')).map(line => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  }));
}

const env = loadEnv(process.argv[2] || '.env.production');
const base = (process.argv[3] || 'https://xuehuayd.top').replace(/\/$/, '');
const service = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function sessionFor(profile) {
  const jar = new Map();
  const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: cookies => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { data: link, error: linkError } = await service.auth.admin.generateLink({ type: 'magiclink', email: profile.email });
  if (linkError) throw linkError;
  const { error: verifyError } = await client.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token });
  if (verifyError) throw verifyError;
  return {
    client,
    headers: { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') },
  };
}

async function request(path, headers) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${base}${path}`, { headers: { ...headers, connection: 'close' }, redirect: 'manual' });
      const text = await response.text();
      let json = null;
      if ((response.headers.get('content-type') || '').includes('application/json')) json = JSON.parse(text);
      return { response, text, json };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw lastError;
}

const { data: profiles, error: profilesError } = await service.from('profiles').select('id,email,role,is_active').eq('is_active', true);
if (profilesError) throw profilesError;
const adminProfile = profiles.find(profile => profile.role === 'admin');
const customerProfile = profiles.find(profile => profile.role === 'customer');
assert(adminProfile && customerProfile, 'active admin and customer required');

const admin = await sessionFor(adminProfile);
const customer = await sessionFor(customerProfile);
const { count: activeAccountCount, error: activeAccountCountError } = await service.from('accounts').select('id', { count: 'exact', head: true }).is('deleted_at', null);
if (activeAccountCountError) throw activeAccountCountError;

const [adminMe, customerMe, adminPage, customerPage, adminUsers, adminStats, customerAccounts, customerAdminUsers, customerAdminPage, adminCustomerPage] = await Promise.all([
  request('/api/auth/me', admin.headers),
  request('/api/auth/me', customer.headers),
  request('/admin/users', admin.headers),
  request('/accounts', customer.headers),
  request('/api/admin/users?page=1', admin.headers),
  request('/api/admin/stats?page=1', admin.headers),
  request('/api/accounts', customer.headers),
  request('/api/admin/users?page=1', customer.headers),
  request('/admin/users', customer.headers),
  request('/accounts', admin.headers),
]);

console.log(JSON.stringify({ diagnostics: {
  adminMe: [adminMe.response.status, adminMe.response.headers.get('location'), adminMe.response.headers.get('content-type')],
  customerMe: [customerMe.response.status, customerMe.response.headers.get('location'), customerMe.response.headers.get('content-type')],
  adminPage: [adminPage.response.status, adminPage.response.headers.get('location')],
  customerPage: [customerPage.response.status, customerPage.response.headers.get('location')],
  adminUsers: [adminUsers.response.status, adminUsers.response.headers.get('location')],
  adminStats: [adminStats.response.status, adminStats.response.headers.get('location')],
  customerAccounts: [customerAccounts.response.status, customerAccounts.response.headers.get('location')],
  customerAdminUsers: [customerAdminUsers.response.status, customerAdminUsers.response.headers.get('location')],
  customerAdminPage: [customerAdminPage.response.status, customerAdminPage.response.headers.get('location')],
  adminCustomerPage: [adminCustomerPage.response.status, adminCustomerPage.response.headers.get('location')],
} }));

assert.equal(adminMe.response.status, 200);
assert.equal(adminMe.json.user.role, 'admin');
assert.equal(adminMe.json.home, '/admin');
assert.equal(customerMe.response.status, 200);
assert.equal(customerMe.json.user.role, 'customer');
assert.equal(customerMe.json.home, '/accounts');

assert.equal(adminPage.response.status, 200);
for (const label of ['用户管理', '数据统计', '系统设置']) assert(adminPage.text.includes(label), `admin menu missing ${label}`);
assert.equal(customerPage.response.status, 200);
for (const label of ['账号管理', '进度管理', '同步管理']) assert(customerPage.text.includes(label), `customer menu missing ${label}`);

assert.equal(adminUsers.response.status, 200);
assert.equal(adminUsers.json.users.length, profiles.length);
assert.equal(adminStats.response.status, 200);
assert.equal(adminStats.json.stats.users, profiles.length);
assert.equal(adminStats.json.stats.accounts, activeAccountCount);
assert.equal(customerAccounts.response.status, 200);
assert(customerAccounts.json.accounts.every(account => account.user_id === undefined), 'customer API leaked user_id');
assert.equal(customerAdminUsers.response.status, 403);
assert.equal(customerAdminPage.response.status, 307);
assert(new URL(customerAdminPage.response.headers.get('location'), base).pathname === '/accounts');
assert.equal(adminCustomerPage.response.status, 307);
assert(new URL(adminCustomerPage.response.headers.get('location'), base).pathname === '/admin');

await Promise.all([admin.client.auth.signOut({ scope: 'local' }), customer.client.auth.signOut({ scope: 'local' })]);
console.log(JSON.stringify({
  productionAuthReady: true,
  adminHome: adminMe.json.home,
  customerHome: customerMe.json.home,
  adminVisibleUsers: adminUsers.json.users.length,
  adminStats: adminStats.json.stats,
  customerVisibleAccounts: customerAccounts.json.accounts.length,
  customerAdminApiStatus: customerAdminUsers.response.status,
  customerAdminPageRedirect: customerAdminPage.response.headers.get('location'),
  adminCustomerPageRedirect: adminCustomerPage.response.headers.get('location'),
  roleMenusVerified: true,
}));
