import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Compile the real application modules; external services are isolated fixtures.
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
function loadTs(file, mocks = {}) {
  const filename = path.resolve(root, file);
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith('@/')) return loadTs(`${id.slice(2)}.ts`, mocks);
    if (id.startsWith('.')) return loadTs(path.resolve(path.dirname(filename), `${id}.ts`), mocks);
    return require(id);
  };
  vm.runInThisContext(`(function(require, module, exports) { ${output}\n})`, { filename })(localRequire, module, module.exports);
  return module.exports;
}

const { calculateProgressCount, calculateProgressFromOrderTime, progressWithDraft } = loadTs('lib/order-progress.ts');
const { refreshOrderProgressAfterSync, readProgressRecords } = loadTs('lib/order-progress-server.ts');
const account = { id: 'a', username: 'fixture', order_time: '2026-09-04T20:34:00+08:00', order_count: 40, distance_per_run: 2.5 };
const run = (id, time = '2026-09-05T08:00:00+08:00', extra = {}) => ({
  account_record_id: account.id, sport_world_record_id: String(id), start_time: time, is_valid: true, ...extra,
});
const runs = (count) => Array.from({ length: count }, (_, i) => run(i));
const manual = (count) => ({ manual_override: true, manual_override_count: count, manual_override_order_time: account.order_time });
let passed = 0;
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`); }

function database(initialRecords = [], initialProgress = {}) {
  const state = {
    accounts: [{ ...account }],
    progress: [{ account_id: account.id, completed_runs: 31, auto_completed_count: 5, ...initialProgress }],
    sport_world_run_records: structuredClone(initialRecords),
    sport_world_accounts: [{ id: 'binding', account_record_id: account.id, sport_account: 'fixture', sport_password_encrypted: 'encrypted', sport_token_encrypted: 'encrypted', token_status: 'valid', completed_runs: 31, completed_distance: 99, manual_run_adjustment: 2, manual_distance_adjustment: 3 }],
    sport_world_sync_logs: [], operation_logs: [],
  };
  const writes = [];
  const failures = new Set();
  const selects = [];
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.action = 'read'; }
    select(fields) { selects.push({ table: this.table, fields }); return this; }
    eq(key, value) { this.filters.push((row) => row[key] === value); return this; }
    is(key, value) { this.filters.push((row) => (row[key] ?? null) === value); return this; }
    in(key, values) { this.filters.push((row) => values.includes(row[key])); return this; }
    or() { return this; }
    order() { return this; }
    range(from, to) { this.bounds = [from, to + 1]; return this; }
    single() { this.one = true; return this; }
    maybeSingle() { this.one = true; return this; }
    update(values) { this.action = 'update'; this.values = values; return this; }
    insert(values) { this.action = 'insert'; this.values = values; return this; }
    upsert(values, options) { this.action = 'upsert'; this.values = values; this.conflict = options.onConflict.split(','); return this; }
    then(resolve, reject) { return Promise.resolve().then(() => this.execute()).then(resolve, reject); }
    execute() {
      if (failures.has(`${this.table}:${this.action}`)) return { data: null, error: { message: 'Fixture database failure' } };
      let rows = state[this.table].filter((row) => this.filters.every((test) => test(row)));
      if (this.action !== 'read') {
        writes.push({ table: this.table, action: this.action, values: structuredClone(this.values) });
        if (this.action === 'update') rows.forEach((row) => Object.assign(row, this.values));
        if (this.action === 'insert') state[this.table].push(structuredClone(this.values));
        if (this.action === 'upsert') {
          const existing = state[this.table].find((row) => this.conflict.every((key) => row[key] === this.values[key]));
          if (existing) Object.assign(existing, this.values); else state[this.table].push(structuredClone(this.values));
        }
      }
      if (this.table === 'accounts') rows = rows.map((row) => ({ ...row,
        sport_world_accounts: state.sport_world_accounts.filter((sport) => sport.account_record_id === row.id),
        progress: state.progress.filter((progress) => progress.account_id === row.id),
      }));
      if (this.bounds) rows = rows.slice(...this.bounds);
      return { data: structuredClone(this.one ? rows[0] || null : rows), error: null };
    }
  }
  return { state, writes, failures, selects, from: (table) => new Query(table) };
}

await check('1 no records = 0/40', () => assert.equal(calculateProgressFromOrderTime(account, []).finalCompletedCount, 0));
await check('2 only pre-order records = 0/40', () => assert.equal(calculateProgressCount(account, [run('old', '2026-09-04T20:33:59+08:00')]), 0));
await check('3 five valid records = 5/40; distance, remainder and percent share final count', () => {
  const p = calculateProgressFromOrderTime(account, [...runs(5), run('invalid', undefined, { is_valid: false })]);
  assert.deepEqual([p.finalCompletedCount, p.completedDistance, p.totalDistance, p.remainingCount, p.percent], [5, 12.5, 100, 35, 12.5]);
  assert.equal(calculateProgressFromOrderTime({ ...account, order_count: 6 }, runs(5)).percent, 83.33);
});
await check('4 auto 5, manual +2 = 7; automatic count stays 5', () => {
  const p = progressWithDraft({ ...account, order_progress: calculateProgressFromOrderTime(account, runs(5)) }, 7);
  assert.deepEqual([p.autoCompletedCount, p.finalCompletedCount, p.completedDistance], [5, 7, 17.5]);
});
await check('5 successful sync replaces manual 7 with automatic 6', async () => {
  const db = database(runs(6), manual(7));
  assert.equal((await refreshOrderProgressAfterSync(db, account.id)).finalCompletedCount, 6);
  assert.deepEqual([db.state.progress[0].manual_override, db.state.progress[0].manual_override_count], [false, null]);
  assert.equal(db.state.progress[0].completed_runs, 31, 'Legacy dashboard counter must not change');
});
await check('6 automatic 8, manual 10, next sync 9 = 9', async () => {
  const db = database(runs(9), { auto_completed_count: 8, ...manual(10) });
  assert.equal((await refreshOrderProgressAfterSync(db, account.id)).finalCompletedCount, 9);
});
await check('7 repeated sync and duplicate record IDs never accumulate', async () => {
  const db = database([...runs(5), run(0)]);
  for (let i = 0; i < 3; i += 1) assert.equal((await refreshOrderProgressAfterSync(db, account.id)).finalCompletedCount, 5);
});

function progressRoute(db, signedIn = true) {
  return loadTs('app/api/progress/route.ts', {
    '@/lib/server-auth': { requireUser: async () => ({ supabase: db, user: signedIn ? { id: 'user' } : null, response: signedIn ? null : Response.json({ error: '未登录' }, { status: 401 }) }) },
  });
}
await check('8 save and reload use persisted override, not old counters; invalid input rejected', async () => {
  const db = database(runs(5));
  const routes = progressRoute(db);
  const request = (value) => new Request('http://localhost/api/progress', { method: 'PATCH', body: JSON.stringify({ account_id: account.id, completed_runs: value }) });
  assert.equal((await routes.PATCH(request(7))).status, 200);
  for (const value of [-1, 41, 2.5, '7', null]) assert.equal((await routes.PATCH(request(value))).status, 400);
  assert.equal(db.state.progress[0].auto_completed_count, 5);
  assert.equal(db.state.sport_world_accounts[0].manual_run_adjustment, 2);
  const result = await (await routes.GET()).json();
  assert.equal(result.accounts[0].order_progress.finalCompletedCount, 7);
  assert.equal(result.accounts[0].sport_world_accounts.sport_password_encrypted, undefined);
});
await check('9 fresh authenticated session reads same result; signed-out request stays unauthorized', async () => {
  const db = database(runs(5), manual(7));
  assert.equal((await progressRoute(db, false).GET()).status, 401);
  assert.equal((await (await progressRoute(db).GET()).json()).accounts[0].order_progress.finalCompletedCount, 7);
});
await check('10 changed order time invalidates override and recalculates on GET and sync', async () => {
  const db = database(runs(5), manual(7));
  db.state.accounts[0].order_time = '2026-09-06T00:00:00+08:00';
  const p = (await (await progressRoute(db).GET()).json()).accounts[0].order_progress;
  assert.deepEqual([p.autoCompletedCount, p.finalCompletedCount, p.manualOverride], [0, 0, false]);
  assert.equal((await refreshOrderProgressAfterSync(db, account.id)).finalCompletedCount, 0);
});
await check('11 50 completed with target 40 displays 40 and 100%', () => {
  const p = calculateProgressFromOrderTime(account, runs(50));
  assert.deepEqual([p.autoCompletedCount, p.finalCompletedCount, p.remainingCount, p.percent], [50, 40, 0, 100]);
  assert.equal(calculateProgressFromOrderTime(account, [], manual(50)).finalCompletedCount, 40);
});
await check('12 negative final count displays zero', () => assert.equal(calculateProgressFromOrderTime(account, runs(5), manual(-3)).finalCompletedCount, 0));
await check('UTC, UTC+8 and local values compare identically including exact boundary', () => {
  for (const orderTime of ['2026-09-04 20:34', '2026-09-04T12:34:00Z', '2026-09-04T20:34:00+08:00']) {
    const records = [run(1, '2026-09-04T12:34:00Z'), run(2, '2026-09-04T20:34:00+08:00'), run(3, '2026-09-04 20:34:00'), run(4, '2026-09-04T12:33:59.999Z')];
    assert.equal(calculateProgressCount({ ...account, order_time: orderTime }, records), 3);
  }
});
await check('Never count sync/creation/update times or another account; missing times excluded', () => {
  const records = [run(1, null, { synced_at: '2026-09-20', created_at: '2026-09-20', updated_at: '2026-09-20' }), run(2, 'bad-date'), run(3, undefined, { account_record_id: 'other' }), run(4, null, { run_date: '2026-09-05' }), run(5, null, { run_date: '2026-09-04' })];
  assert.equal(calculateProgressCount(account, records), 1);
  assert.equal(calculateProgressCount({ ...account, order_time: 'invalid' }, runs(5)), 0);
});
await check('Legacy missing fields default to automatic count; zero manual override remains valid', () => {
  assert.equal(calculateProgressFromOrderTime(account, runs(5), { completed_runs: 99 }).finalCompletedCount, 5);
  assert.equal(calculateProgressFromOrderTime(account, runs(5), manual(0)).finalCompletedCount, 0);
  assert.equal(calculateProgressFromOrderTime({ ...account, order_count: 0 }, runs(5)).percent, 0);
});
await check('Record pagination counts all 1205 records', async () => {
  const db = database(runs(1205));
  const records = await readProgressRecords(db, [account.id]);
  assert.equal(records.length, 1205);
  assert.equal(calculateProgressCount(account, records), 1205);
});
await check('Read/write failures do not clear manual corrections', async () => {
  const db = database(runs(6), manual(7));
  db.failures.add('sport_world_run_records:read');
  await assert.rejects(refreshOrderProgressAfterSync(db, account.id));
  assert.equal((await progressRoute(db).GET()).status, 500);
  assert.equal(db.state.progress[0].manual_override_count, 7);
  db.failures.clear(); db.failures.add('progress:upsert');
  await assert.rejects(refreshOrderProgressAfterSync(db, account.id));
  assert.equal(db.state.progress[0].manual_override_count, 7);
});
await check('Real sync entry point resets override after records save; failure keeps it', async () => {
  let failRemote = false;
  class FakeSportWorldError extends Error { constructor(code, message) { super(message); this.code = code; } }
  class FakeClient {
    async validateToken() { return true; }
    async getSemesterProgress() { if (failRemote) throw new Error('Remote fixture failure'); return { semester: 'term', completedRuns: 88, completedDistance: 222 }; }
    async getRunHistory() { return { records: runs(6).map((r) => ({ id: r.sport_world_record_id, startTime: r.start_time, distance: 3, isValid: true })), hasMore: false }; }
  }
  const { syncSportWorldAccount } = loadTs('lib/sport-world/sync.ts', {
    './client': { SportWorldClient: FakeClient, SportWorldError: FakeSportWorldError },
    '@/lib/encryption': { decryptSportSecret: () => 'fixture', encryptSportSecret: () => 'fixture' },
  });
  const db = database([], manual(7));
  await syncSportWorldAccount(db, account.id);
  assert.equal(db.state.progress[0].auto_completed_count, 6);
  assert.equal(db.state.progress[0].manual_override, false);
  assert.equal(db.state.sport_world_accounts[0].completed_runs, 88, 'Remote semester field must keep its existing meaning');
  Object.assign(db.state.progress[0], manual(10));
  failRemote = true;
  await assert.rejects(syncSportWorldAccount(db, account.id));
  assert.equal(db.state.progress[0].manual_override_count, 10);
});

console.log(`\n${passed} order-progress checks passed. External APIs and user data were not modified.`);
