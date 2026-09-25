import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Real embedded PostgreSQL: these tests exercise RLS, grants, triggers and the
// actual migration without connecting to Supabase or touching production data.
const db = new PGlite();
const admin = '10000000-0000-4000-8000-000000000001';
const alice = '10000000-0000-4000-8000-000000000002';
const bob = '10000000-0000-4000-8000-000000000003';
const newcomer = '10000000-0000-4000-8000-000000000004';
const a = '20000000-0000-4000-8000-000000000001';
const b = '20000000-0000-4000-8000-000000000002';
const legacy = '20000000-0000-4000-8000-000000000003';
let passed = 0;
async function check(name, fn) { await fn(); console.log(`PASS ${name}`); passed++; }
const rows = async sql => (await db.query(sql)).rows;
async function asUser(id, fn, role = 'authenticated') {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${id || ''}', false);`);
  try { return await fn(); } finally { await db.exec('reset role'); }
}
async function denied(sql) { await assert.rejects(db.query(sql), e => ['42501', '23503', '23502', 'P0001'].includes(e.code)); }
const setupSQL = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema storage;
  create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table storage.buckets(id text primary key, name text, public boolean);
  create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
  grant all on all tables in schema storage to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`;
await db.exec(setupSQL);
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8').split('-- User isolation (also distributed')[0].replace('create extension if not exists pgcrypto;', '');
const migration = readFileSync(new URL('../supabase/migrations/20260924010000_user_isolation.sql', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('../supabase/migrations/20260924020000_role_permission_fix.sql', import.meta.url), 'utf8');
await db.exec(schema);
await db.exec(readFileSync(new URL('../supabase/migrations/20260924000000_order_progress_count.sql', import.meta.url), 'utf8'));
await db.exec(`
  insert into auth.users(id,email) values ('${admin}','admin@example.test'),('${alice}','alice@example.test'),('${bob}','bob@example.test');
  update public.profiles set role = 'admin' where id = '${admin}';
  insert into public.accounts(id,username,encrypted_password,distance_per_run,order_count,order_time) values
    ('${a}','alice-account','cipher-a',2,40,'2026-09-01'), ('${b}','bob-account','cipher-b',3,20,'2026-09-02'), ('${legacy}','legacy','cipher-legacy',1,10,'2026-09-03');
  insert into public.progress(account_id,completed_runs) values ('${a}',7),('${b}',8),('${legacy}',9);
  insert into public.sport_world_accounts(account_record_id,sport_account) values ('${a}','alice-sport'),('${b}','bob-sport');
  insert into public.sport_world_run_records(account_record_id,sport_world_record_id,distance) values ('${a}','run-a',2),('${b}','run-b',3);
  insert into public.sport_world_sync_logs(account_record_id,status) values ('${a}','success'),('${b}','failed');
  insert into public.operation_logs(user_id,action_type,target_type,target_id,description) values
    ('${alice}','create_account','account','${a}','alice created'),('${bob}','add_sport_world_binding','account','${b}','bob created');
  insert into storage.objects(bucket_id,name) values ('backups','${alice}/old.json'),('backups','system/all.json');
`);
const before = await rows('select * from accounts order by id');
await check('migration preserves records, counters, ciphertext, timestamps and existing roles', async () => {
  await db.exec(migration);
  const after = await rows('select * from accounts order by id');
  assert.deepEqual(after.map(({ user_id, ...rest }) => rest), before);
  assert.deepEqual(after.map(r => r.user_id), [alice, bob, admin]);
  assert.deepEqual((await rows('select completed_runs from progress order by account_id')).map(r => r.completed_runs), [7, 8, 9]);
  assert.equal((await rows(`select role from profiles where id='${admin}'`))[0].role, 'admin');
  assert.equal((await rows(`select role from profiles where id='${alice}'`))[0].role, 'customer');
  for (const table of ['progress','sport_world_accounts','sport_world_run_records','sport_world_sync_logs']) {
    const key = table === 'progress' ? 'account_id' : 'account_record_id';
    assert.equal((await rows(`select user_id from ${table} where ${key}='${a}'`))[0].user_id, alice);
  }
});
await check('migration is repeatable without reassigning owners or promoting customers', async () => {
  const before = await rows('select * from accounts order by id'); await db.exec(migration);
  assert.deepEqual(await rows('select * from accounts order by id'), before);
  assert.equal((await rows(`select role from profiles where id='${bob}'`))[0].role, 'customer');
});
await check('registration ignores spoofed admin metadata and creates a customer', async () => {
  await db.exec(`insert into auth.users values ('${newcomer}','new@example.test','{"role":"admin"}','{}')`);
  assert.equal((await rows(`select role from profiles where id='${newcomer}'`))[0].role, 'customer');
});
await check('customer sees only own accounts, progress, credentials, records, sync logs and audit logs', () => asUser(alice, async () => {
  for (const table of ['accounts','progress','sport_world_accounts','sport_world_run_records','sport_world_sync_logs','operation_logs']) {
    const data = await rows(`select * from ${table}`); assert.equal(data.length, 1, table); assert.equal(data[0].user_id, alice, table);
  }
  assert.deepEqual((await rows('select id from profiles')).map(r => r.id), [alice]);
}));
await check('customer cannot update/delete another user, inject ownership or attach children to other accounts', () => asUser(alice, async () => {
  assert.equal((await rows(`update accounts set note='hacked' where id='${b}' returning id`)).length, 0);
  assert.equal((await rows(`delete from accounts where id='${b}' returning id`)).length, 0);
  await denied(`insert into accounts(user_id,username,distance_per_run,order_count,order_time) values ('${bob}','injected',1,1,now())`);
  await denied(`update accounts set user_id='${bob}' where id='${a}'`);
  await denied(`insert into sport_world_sync_logs(account_record_id,user_id,status) values ('${b}','${alice}','success')`);
  await denied(`insert into sport_world_sync_logs(account_record_id,status) values ('${b}','success')`);
  await denied(`insert into operation_logs(user_id,action_type,target_type,target_id,description) values ('${alice}','edit','account','${b}','fake')`);
  assert.equal((await rows(`update progress set completed_runs=0 where account_id='${b}' returning id`)).length, 0);
}));
await check('customer can create, modify, soft-delete and hard-delete own records; child ownership auto-fills', () => asUser(alice, async () => {
  const [created] = await rows("insert into accounts(username,distance_per_run,order_count,order_time) values ('own-new',1,2,now()) returning id,user_id");
  assert.equal(created.user_id, alice);
  const [child] = await rows(`insert into progress(account_id,completed_runs) values ('${created.id}',1) returning user_id`);
  assert.equal(child.user_id, alice);
  assert.equal((await rows(`update accounts set note='own edit',deleted_at=now() where id='${created.id}' returning id`)).length, 1);
  assert.equal((await rows(`delete from accounts where id='${created.id}' returning id`)).length, 1);
}));
await check('same username/school may be used by different customers but not twice by one customer', async () => {
  const [{ id: school }] = await rows("insert into schools(name) values ('Isolation School') returning id");
  for (const user of [alice, bob]) await asUser(user, () => db.query(`insert into accounts(school_id,username,distance_per_run,order_count,order_time) values ('${school}','shared-login',1,1,now())`));
  await asUser(alice, () => assert.rejects(db.query(`insert into accounts(school_id,username,distance_per_run,order_count,order_time) values ('${school}','shared-login',1,1,now())`), e => e.code === '23505'));
});
await check('customer cannot mutate profiles, invoke admin RPC, change global options or access backups', () => asUser(alice, async () => {
  await denied(`update profiles set role='admin' where id='${alice}'`);
  await denied(`insert into profiles(id,role) values ('${newcomer}','admin')`);
  await denied(`select admin_update_user('${bob}','admin',null,null)`);
  assert.equal((await rows("update schools set name='hacked' returning id")).length, 0);
  assert.equal((await rows('delete from account_categories returning id')).length, 0);
  assert.equal((await rows('select * from backup_settings')).length, 0);
  assert.equal((await rows('select * from storage.objects')).length, 0);
  await denied("insert into storage.objects(bucket_id,name) values ('backups','unauthorized')");
  const [option] = await rows("insert into schools(name) values ('Inline school') returning name");
  assert.equal(option.name, 'Inline school');
}));
await check('administrator sees all data and can manage users but cannot demote/disable self', () => asUser(admin, async () => {
  assert.equal((await rows('select * from accounts')).length, 5);
  assert.equal((await rows('select * from profiles')).length, 4);
  assert.equal((await rows('select * from storage.objects')).length, 2);
  await denied(`select admin_update_user('${admin}','customer',null,null)`);
  await denied(`select admin_update_user('${admin}',null,false,null)`);
  await db.query(`select admin_update_user('${bob}',null,false,'Bob disabled')`);
}));
await check('disabled customer loses data access immediately, including existing JWT/direct SQL access', () => asUser(bob, async () => {
  for (const table of ['accounts','progress','sport_world_accounts','sport_world_run_records','sport_world_sync_logs','operation_logs','schools']) assert.equal((await rows(`select * from ${table}`)).length, 0, table);
  await denied("insert into accounts(username,distance_per_run,order_count,order_time) values ('blocked',1,1,now())");
  await denied("insert into schools(name) values ('blocked school')");
}));
await check('role changes take effect without JWT refresh and can be reversed', async () => {
  await asUser(admin, () => db.query(`select admin_update_user('${bob}','admin',true,null)`));
  await asUser(bob, async () => assert.equal((await rows('select * from accounts')).length, 5));
  await asUser(admin, () => db.query(`select admin_update_user('${bob}','customer',true,null)`));
  await asUser(bob, async () => assert.equal((await rows('select * from accounts')).length, 2));
});
await check('service-role cron writes inherit the customer owner instead of the cron identity', () => asUser(null, async () => {
  const [log] = await rows(`insert into sport_world_sync_logs(account_record_id,status) values ('${b}','success') returning user_id`);
  assert.equal(log.user_id, bob);
}, 'service_role'));
await check('anonymous users cannot read customer data or call privileged functions', () => asUser(null, async () => {
  assert.equal((await rows('select * from accounts')).length, 0);
  await denied(`select admin_update_user('${alice}','admin',null,null)`);
}, 'anon'));
await check('role=user has the same ownership isolation and admin denial as legacy customer', async () => {
  await asUser(admin, () => db.query(`select admin_update_user('${alice}','user',true,null)`));
  await asUser(alice, async () => {
    assert.ok((await rows('select * from accounts')).every(row => row.user_id === alice));
    assert.equal((await rows(`update accounts set note='blocked' where id='${b}' returning id`)).length, 0);
    await denied(`select admin_update_user('${alice}','admin',null,null)`);
    assert.equal((await rows('select * from backup_settings')).length, 0);
  });
  await asUser(admin, async () => {
    await denied(`select admin_update_user('${admin}','user',null,null)`);
    assert.equal((await rows(`update accounts set note='admin edit' where id='${a}' returning user_id`))[0].user_id, alice);
    assert.equal((await rows(`update progress set manual_override=true,manual_override_count=5 where account_id='${a}' returning user_id`))[0].user_id, alice);
    assert.equal((await rows(`update sport_world_accounts set sync_enabled=true where account_record_id='${a}' returning user_id`))[0].user_id, alice);
  });
  const compatibility = readFileSync(new URL('../supabase/migrations/20260924020000_role_permission_fix.sql', import.meta.url), 'utf8');
  const before = await rows('select * from accounts order by id');
  await db.exec(compatibility);
  assert.deepEqual(await rows('select * from accounts order by id'), before);
  assert.equal((await rows(`select role from profiles where id='${alice}'`))[0].role, 'user');
});
await db.close();
await check('fresh-install schema includes all business fields and finishes with tenant policies', async () => {
  const fresh = new PGlite();
  try {
    await fresh.exec(setupSQL);
    await fresh.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8').replace('create extension if not exists pgcrypto;', ''));
    const columns = (await fresh.query("select column_name from information_schema.columns where table_name='accounts' and table_schema='public'")).rows.map(r => r.column_name);
    for (const name of ['user_id','campus_name','student_name','student_id','fence_name','running_time']) assert.ok(columns.includes(name), name);
    assert.deepEqual((await fresh.query("select policyname from pg_policies where tablename='accounts'")).rows, [{ policyname: 'owner_access' }]);
    await fresh.exec(`insert into auth.users(id,email,raw_user_meta_data) values ('${alice}','fresh@example.test','{"role":"admin"}')`);
    assert.equal((await fresh.query('select role from profiles')).rows[0].role, 'customer');
  } finally { await fresh.close(); }
});
await check('pre-role legacy administrators default to admin and retain unowned historical records', async () => {
  const old = new PGlite();
  try {
    await old.exec(setupSQL); await old.exec(schema);
    await old.exec(`insert into auth.users(id,email) values ('${admin}','old-admin@example.test');
      alter table profiles drop column role;
      insert into accounts(id,username,distance_per_run,order_count,order_time) values ('${legacy}','old-account',1,5,'2026-09-01');`);
    await old.exec(migration);
    assert.equal((await old.query('select role from profiles')).rows[0].role, 'admin');
    assert.equal((await old.query('select user_id from accounts')).rows[0].user_id, admin);
    await old.exec(`insert into auth.users(id,email) values ('${newcomer}','new-after-migration@example.test')`);
    assert.equal((await old.query(`select role from profiles where id='${newcomer}'`)).rows[0].role, 'customer');
  } finally { await old.close(); }
});
await check('unowned legacy data without an administrator aborts atomically without data loss or privilege escalation', async () => {
  const old = new PGlite();
  try {
    await old.exec(setupSQL); await old.exec(schema);
    await old.exec(`insert into auth.users(id,email) values ('${alice}','only-customer@example.test');
      insert into accounts(id,username,distance_per_run,order_count,order_time) values ('${legacy}','unowned',1,5,'2026-09-01');`);
    await assert.rejects(old.exec(migration), /Legacy accounts have no owner/);
    await old.exec('rollback');
    assert.equal((await old.query('select username from accounts')).rows[0].username, 'unowned');
    assert.equal((await old.query('select role from profiles')).rows[0].role, 'customer');
    assert.equal((await old.query("select 1 from information_schema.columns where table_schema='public' and table_name='accounts' and column_name='user_id'")).rows.length, 0);
  } finally { await old.close(); }
});
console.log(`\n${passed} PostgreSQL isolation checks passed. No remote data accessed.`);
