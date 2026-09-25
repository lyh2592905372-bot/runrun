import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { NextRequest } = require('next/server');
const root = path.resolve(import.meta.dirname, '..');
const alice = '10000000-0000-4000-8000-000000000001';
const bob = '10000000-0000-4000-8000-000000000002';
const admin = '10000000-0000-4000-8000-000000000003';
const a = '20000000-0000-4000-8000-000000000001';
const b = '20000000-0000-4000-8000-000000000002';
const school = '30000000-0000-4000-8000-000000000001';
const category = '30000000-0000-4000-8000-000000000002';
let passed = 0;
async function check(name, fn) { await fn(); console.log(`PASS ${name}`); passed++; }
function loadTs(file, mocks = {}, cache = new Map()) {
  const filename = path.resolve(root, file);
  if (cache.has(filename)) return cache.get(filename);
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const localRequire = id => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith('@/')) return loadTs(`${id.slice(2)}.ts`, mocks, cache);
    if (id.startsWith('.')) return loadTs(path.resolve(path.dirname(filename), `${id}.ts`), mocks, cache);
    return require(id);
  };
  vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename })(localRequire, module, module.exports);
  cache.set(filename, module.exports); return module.exports;
}
function fixture() {
  const state = {
    profiles: [{ id: alice, role: 'user', is_active: true }, { id: bob, role: 'customer', is_active: true }, { id: admin, role: 'admin', is_active: true }],
    accounts: [a, b].map((id, index) => ({ id, user_id: index ? bob : alice, username: index ? 'bob' : 'alice', encrypted_password: 'cipher', category: { name: '运动世界' }, order_time: '2026-09-01', order_count: 20, distance_per_run: 2, deleted_at: null, sport_world_accounts: { sport_password_encrypted: 'cipher', sport_account: 'bound' } })),
    progress: [], sport_world_accounts: [a, b].map((id, index) => ({ account_record_id: id, user_id: index ? bob : alice, sport_account: 'bound' })),
    sport_world_run_records: [a, b].map((id, index) => ({ id, account_record_id: id, user_id: index ? bob : alice, is_valid: true, start_time: '2026-09-02', sport_world_record_id: id })), sport_world_sync_logs: [a, b].map((id, index) => ({ id, account_record_id: id, user_id: index ? bob : alice, status: 'success' })),
    operation_logs: [a, b].map((id, index) => ({ id, user_id: index ? bob : alice })),
    schools: [{ id: school, name: 'School' }], account_categories: [{ id: category, name: '闪动校园' }], running_types: [], face_options: [], backups: [], backup_settings: [],
  };
  const writes = []; const calls = []; const effects = { sync: 0, decrypt: 0, service: 0 };
  let current = alice; let profileError = false;
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.action = 'select'; this.head = false; }
    select(fields, options = {}) { this.head = options.head; return this; }
    eq(key, value) { this.filters.push(r => r[key] === value); return this; }
    neq(key, value) { this.filters.push(r => r[key] !== value); return this; }
    is(key, value) { this.filters.push(r => (r[key] ?? null) === value); return this; }
    in(key, values) { this.filters.push(r => values.includes(r[key])); return this; }
    ilike() { return this; } or() { return this; } gte() { return this; } lte() { return this; }
    order() { return this; } limit(n) { this.bounds = [0,n]; return this; } range(a,b) { this.bounds = [a,b+1]; return this; }
    single() { this.one = true; return this; } maybeSingle() { this.one = true; return this; }
    insert(values) { this.action = 'insert'; this.values = values; return this; }
    update(values) { this.action = 'update'; this.values = values; return this; }
    delete() { this.action = 'delete'; return this; }
    upsert(values) { this.action = 'upsert'; this.values = values; return this; }
    then(resolve,reject) { return Promise.resolve().then(() => this.execute()).then(resolve,reject); }
    execute() {
      calls.push({ table: this.table, action: this.action });
      if (this.table === 'profiles' && profileError) return { data: null, error: { code: 'unavailable' } };
      const table = state[this.table] || [];
      let data = table.filter(r => this.filters.every(f => f(r)));
      if (this.action !== 'select') {
        writes.push({ table: this.table, action: this.action, values: this.values });
        if (this.action === 'insert' || this.action === 'upsert') { const value = { id: crypto.randomUUID(), ...this.values }; table.push(value); data = [value]; }
        if (this.action === 'update') data.forEach(r => Object.assign(r, this.values));
        if (this.action === 'delete') state[this.table] = table.filter(r => !data.includes(r));
      }
      const count = data.length;
      if (this.bounds) data = data.slice(...this.bounds);
      return { data: this.head ? null : structuredClone(this.one ? data[0] || null : data), count, error: null };
    }
  }
  // Deliberately no RLS in this fixture: API owner filters must work independently.
  const db = { from: table => new Query(table), auth: { getUser: async () => ({ data: { user: current ? { id: current, email: 'fixture@example.test', user_metadata: { role: 'admin' } } : null }, error: null }) }, rpc: async () => ({ error: null }) };
  const mocks = {
    '@/lib/supabase/server': { createClient: async () => db },
    '@/lib/supabase/admin': { createAdminClient: () => { effects.service++; throw new Error('Unexpected service role use'); } },
    '@/lib/encryption': { encryptSecret: () => 'cipher', encryptSportSecret: () => 'cipher', decryptSecret: () => { effects.decrypt++; return 'own-password'; } },
    '@/lib/sport-world/sync': { syncSportWorldAccount: async () => { effects.sync++; return { recordsReceived: 3 }; }, syncErrorResponse: () => ({ code: 'fixture', status: 500, message: 'failed' }) },
  };
  return { state, writes, calls, effects, login(id) { current = id; }, failProfiles(value) { profileError = value; }, load: file => loadTs(file, mocks) };
}
function request(method = 'GET', body, url = '/api/test') { return new NextRequest(`http://localhost${url}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }); }
const context = id => ({ params: Promise.resolve({ id }) });
const files = readdirSync(path.join(root, 'app/api'), { recursive: true }).filter(f => f.endsWith('route.ts')).map(f => `app/api/${f.replaceAll('\\','/')}`);
await check('every API handler returns 401 for anonymous requests (including both cron routes)', async () => {
  const db = fixture(); db.login(null);
  for (const file of files) for (const [method, handler] of Object.entries(db.load(file))) {
    if (!['GET','POST','PATCH','PUT','DELETE'].includes(method)) continue;
    const result = await handler(request(method, method === 'GET' ? undefined : {}), context(a));
    assert.equal(result.status, 401, `${file} ${method}`);
  }
  assert.equal(db.writes.length, 0); assert.equal(db.effects.service, 0);
});
await check('all admin endpoints, backups and shared-option edits reject customer with 403', async () => {
  const db = fixture();
  for (const file of files.filter(f => f.includes('/admin/') || f.includes('/backups/') || f.includes('/backup-settings/') || /\/(schools|categories|running-types|face-options)\/\[id\]/.test(f))) {
    for (const [method, handler] of Object.entries(db.load(file))) {
      if (!['GET','POST','PATCH','DELETE'].includes(method)) continue;
      assert.equal((await handler(request(method, method === 'GET' ? undefined : {}), context(b))).status, 403, `${file} ${method}`);
    }
  }
  assert.equal(db.writes.length, 0); assert.equal(db.effects.service, 0);
});
await check('all account ID handlers return the same 404 for foreign/missing IDs before side effects', async () => {
  const db = fixture();
  for (const file of files.filter(f => f.includes('/accounts/[id]/'))) for (const [method, handler] of Object.entries(db.load(file))) {
    for (const id of [b, '99999999-9999-4999-8999-999999999999', 'invalid']) assert.equal((await handler(request(method, method === 'GET' ? undefined : {}), context(id))).status, 404, `${file} ${id}`);
  }
  assert.equal(db.writes.length, 0); assert.equal(db.effects.sync, 0); assert.equal(db.effects.decrypt, 0);
});
await check('list APIs ignore spoofed user_id, isolate accounts/progress/logs/sync logs and strip sport ciphertext', async () => {
  const db = fixture();
  for (const [file, key] of [['accounts','accounts'],['progress','accounts'],['logs','logs'],['sync-logs','logs']]) {
    const result = await db.load(`app/api/${file}/route.ts`).GET(request('GET', undefined, `/api/${file}?user_id=${bob}`));
    assert.equal(result.status, 200); const payload = await result.json();
    assert.equal(payload[key].length, 1, file); assert.equal(payload[key][0].user_id, alice, file);
    if (payload[key][0].sport_world_accounts) assert.equal(payload[key][0].sport_world_accounts.sport_password_encrypted, undefined);
  }
  const result = await db.load('app/api/dashboard/route.ts').GET();
  assert.equal((await result.json()).stats.accounts, 1);
});
await check('foreign progress writes return 404 and cannot create an upsert or audit entry', async () => {
  const db = fixture(); const before = structuredClone(db.state);
  assert.equal((await db.load('app/api/progress/route.ts').PATCH(request('PATCH', { account_id: b, completed_runs: 2, user_id: alice }))).status, 404);
  assert.deepEqual(db.state, before); assert.equal(db.writes.length, 0);
});
await check('new account and initial progress bind to session ID even if body supplies another ID', async () => {
  const db = fixture();
  const result = await db.load('app/api/accounts/route.ts').POST(request('POST', { username: 'new', category: { id: category }, school: { id: school }, distance_per_run: 2, order_count: 10, order_time: '2026-09-01', user_id: bob, role: 'admin' }));
  assert.equal(result.status, 201);
  for (const table of ['accounts', 'progress', 'operation_logs']) assert.equal(db.writes.find(w => w.table === table).values.user_id, alice);
});
await check('own progress, password access, sync and soft delete continue to work', async () => {
  const db = fixture();
  assert.equal((await db.load('app/api/accounts/[id]/route.ts').PATCH(request('PATCH', { username: 'alice-edited', category: { id: category }, school: { id: school }, distance_per_run: 3, order_count: 25, order_time: '2026-09-01', user_id: bob }), context(a))).status, 200);
  assert.equal(db.state.accounts[0].username, 'alice-edited'); assert.equal(db.state.accounts[0].user_id, alice);
  assert.equal(db.state.accounts[1].username, 'bob');
  assert.equal((await db.load('app/api/progress/route.ts').PATCH(request('PATCH', { account_id: a, completed_runs: 5, user_id: bob }))).status, 200);
  assert.equal(db.writes.find(w => w.table === 'progress').values.user_id, alice);
  const password = await db.load('app/api/accounts/[id]/password/route.ts').GET(request(), context(a));
  assert.equal((await password.json()).password, 'own-password'); assert.equal(db.effects.decrypt, 1);
  assert.equal((await db.load('app/api/accounts/[id]/sync-sport-world/route.ts').POST(request('POST'), context(a))).status, 200); assert.equal(db.effects.sync, 1);
  assert.equal((await db.load('app/api/accounts/[id]/route.ts').DELETE(request('DELETE'), context(a))).status, 200);
  assert.ok(db.state.accounts[0].deleted_at); assert.equal(db.state.accounts[1].deleted_at, null);
  assert.equal((await db.load('app/api/accounts/[id]/password/route.ts').GET(request(), context(a))).status, 404);
});
await check('administrator sees and manages every owner through all business APIs', async () => {
  const db = fixture(); db.login(admin);
  const users = await db.load('app/api/admin/users/route.ts').GET(request());
  assert.equal(users.status, 200); assert.equal((await users.json()).users.length, 3);
  const stats = await db.load('app/api/admin/stats/route.ts').GET(request());
  assert.equal(stats.status, 200); assert.equal((await stats.json()).total, 2);
  for (const [file, key] of [['accounts','accounts'],['progress','accounts'],['logs','logs'],['sync-logs','logs']]) {
    const response = await db.load(`app/api/${file}/route.ts`).GET(request());
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json())[key].map(row => row.user_id).sort(), [alice, bob]);
  }
  assert.equal((await (await db.load('app/api/dashboard/route.ts').GET()).json()).stats.accounts, 2);
  for (const [id, owner] of [[a, alice], [b, bob]]) {
    assert.equal((await db.load('app/api/accounts/[id]/password/route.ts').GET(request(), context(id))).status, 200);
    const records = await db.load('app/api/accounts/[id]/sport-world-records/route.ts').GET(request(), context(id));
    assert.equal((await records.json()).records[0].user_id, owner);
    assert.equal((await db.load('app/api/accounts/[id]/route.ts').PATCH(request('PATCH', { username: 'edited', category: { id: category }, school: { id: school }, distance_per_run: 3, order_count: 25, order_time: '2026-09-01', user_id: admin }), context(id))).status, 200);
    assert.equal(db.state.accounts.find(row => row.id === id).user_id, owner);
    assert.equal(db.writes.filter(w => w.table === 'sport_world_accounts' && w.action === 'upsert').at(-1).values.user_id, owner);
    assert.equal((await db.load('app/api/progress/route.ts').PATCH(request('PATCH', { account_id: id, completed_runs: 6, user_id: admin }))).status, 200);
    assert.equal(db.writes.filter(w => w.table === 'progress').at(-1).values.user_id, owner);
    assert.equal((await db.load('app/api/accounts/[id]/sport-world-settings/route.ts').PATCH(request('PATCH', { sync_enabled: true }), context(id))).status, 200);
    assert.equal(db.state.sport_world_accounts.find(row => row.account_record_id === id).sync_enabled, true);
    for (const action of ['sync-sport-world','reauth-sport-world','unbind-sport-world']) {
      assert.equal((await db.load(`app/api/accounts/[id]/${action}/route.ts`).POST(request('POST'), context(id))).status, 200, action);
    }
    assert.equal(db.state.sport_world_accounts.find(row => row.account_record_id === id).sport_account, '');
    assert.equal((await db.load('app/api/accounts/[id]/route.ts').DELETE(request('DELETE'), context(id))).status, 200);
    assert.ok(db.state.accounts.find(row => row.id === id).deleted_at);
  }
  assert.equal(db.effects.sync, 4); assert.equal(db.effects.service, 0);
  assert.ok(db.writes.filter(w => w.table === 'operation_logs').every(w => w.values.user_id === admin));
  for (const role of ['customer','user']) assert.equal((await db.load('app/api/admin/users/[id]/route.ts').PATCH(request('PATCH', { role }), context(admin))).status, 409);
});
await check('legacy customer retains ordinary-user isolation', async () => {
  const db = fixture(); db.login(bob);
  const accounts = await db.load('app/api/accounts/route.ts').GET(request());
  assert.deepEqual((await accounts.json()).accounts.map(row => row.id), [b]);
  assert.equal((await db.load('app/api/accounts/[id]/password/route.ts').GET(request(), context(a))).status, 404);
  assert.equal((await db.load('app/api/admin/users/route.ts').GET(request())).status, 403);
});
await check('profile failures, disabled accounts and invalid roles fail closed; user metadata never elevates role', async () => {
  const db = fixture(); const auth = db.load('lib/server-auth.ts');
  assert.equal((await auth.requireUser()).role, 'user'); assert.equal((await auth.requireAdmin()).response.status, 403);
  db.failProfiles(true); assert.equal((await auth.requireUser()).response.status, 503); db.failProfiles(false);
  db.state.profiles[0].is_active = false; assert.equal((await auth.requireUser()).response.status, 403);
  db.state.profiles[0].is_active = true; db.state.profiles[0].role = 'superadmin'; assert.equal((await auth.requireUser()).response.status, 403);
});
await check('older backups retain current owners, new snapshots retain explicit owners, conflicts fail', () => {
  const { restoreAccountOwners } = loadTs('lib/backup-ownership.ts');
  assert.equal(restoreAccountOwners([{ id: a }], [{ id: a, user_id: alice }], admin)[0].user_id, alice);
  assert.equal(restoreAccountOwners([{ id: b, user_id: bob }], [], admin)[0].user_id, bob);
  assert.equal(restoreAccountOwners([{ id: a }], [], admin)[0].user_id, admin);
  assert.throws(() => restoreAccountOwners([{ id: a, user_id: bob }], [{ id: a, user_id: alice }], admin));
});
await check('page routing follows database roles and preserves refreshed cookies on redirects', async () => {
  let user = { id: alice }; let profile = { role: 'user', is_active: true };
  const { proxy } = loadTs('proxy.ts', { '@supabase/ssr': { createServerClient: (_url, _key, options) => ({
    auth: { getUser: async () => { options.cookies.setAll([{ name: 'refreshed', value: 'session', options: { httpOnly: true } }]); return { data: { user } }; } },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) }),
  }) } });
  const previous = process.env.NEXT_PUBLIC_APP_URL; process.env.NEXT_PUBLIC_APP_URL = 'http://localhost';
  try {
    for (const url of ['/admin','/admin/users','/settings','/backups','/login']) {
      const response = await proxy(request('GET', undefined, url)); assert.equal(response.status, 307, url);
      assert.equal(new URL(response.headers.get('location')).pathname, '/accounts'); assert.match(response.headers.get('set-cookie'), /refreshed=session/);
    }
    assert.equal((await proxy(request('GET', undefined, '/accounts'))).status, 200);
    profile = { role: 'admin', is_active: true };
    for (const url of ['/login','/']) assert.equal(new URL((await proxy(request('GET', undefined, url))).headers.get('location')).pathname, '/admin');
    for (const url of ['/admin/users','/dashboard','/accounts','/accounts/sport-world','/accounts/flash-campus','/accounts/alipay-sunshine','/progress','/progress/' + a,'/sync','/logs','/settings','/backups']) assert.equal((await proxy(request('GET', undefined, url))).status, 200, url);
    profile.is_active = false;
    assert.equal(new URL((await proxy(request('GET', undefined, '/admin/users'))).headers.get('location')).pathname, '/login');
    assert.equal((await proxy(request('GET', undefined, '/login'))).status, 200);
    user = null;
    assert.equal((await proxy(request('GET', undefined, '/api/admin/users'))).status, 401);
    assert.equal((await proxy(request('GET', undefined, '/auth/callback'))).status, 200);
    assert.equal((await proxy(request('GET', undefined, '/api/cron/backup'))).status, 200, 'cron authorization remains in handler');
  } finally { if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = previous; }
});
await check('rendered navigation contains exactly the correct role menu', () => {
  const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server');
  const { DashboardShell } = loadTs('components/layout/dashboard-shell.tsx', {
    'next/navigation': { usePathname: () => '/accounts/sport-world', useRouter: () => ({}) },
    'next/link': { default: ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children) },
    '@/lib/supabase/browser': { createClient: () => ({}) },
  });
  const markup = role => renderToStaticMarkup(React.createElement(DashboardShell, { user: { email: 'fixture@example.test', role } }, 'content'));
  const customer = markup('user'), admin = markup('admin');
  assert.equal(customer, markup('customer'));
  for (const label of ['账号管理','进度管理','同步管理']) { assert.ok(customer.includes(label)); assert.ok(admin.includes(label)); }
  for (const label of ['首页','用户管理','数据统计','系统设置','操作日志']) { assert.ok(admin.includes(label)); assert.ok(!customer.includes(label)); }
  assert.ok(!admin.includes('Excel导出')); assert.ok(!customer.includes('Excel导出'));
  for (const platform of ['运动世界','闪动校园','支付宝阳光跑']) assert.ok(admin.includes(platform));
});
console.log(`\n${passed} API/UI isolation groups passed (${files.length} route modules). No network or real credentials used.`);
