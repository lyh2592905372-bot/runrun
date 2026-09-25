import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnv(file) {
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#') && line.includes('=')).map(line => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  }));
}

const env = loadEnv(process.argv[2] || '.env.production');
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function all(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return rows;
}

const profiles = await all('profiles', 'id,role,is_active');
const accounts = await all('accounts', 'id,user_id,deleted_at');
const progress = await all('progress', 'id,account_id,user_id');
const sportAccounts = await all('sport_world_accounts', 'id,account_record_id,user_id');
const records = await all('sport_world_run_records', 'id,account_record_id,user_id');
const syncLogs = await all('sport_world_sync_logs', 'id,account_record_id,user_id');
const owners = new Map(accounts.map(row => [row.id, row.user_id]));
const invalidRole = profiles.find(row => !['admin', 'user', 'customer'].includes(row.role) || typeof row.is_active !== 'boolean');
if (invalidRole) throw new Error('A profile has an invalid role or activation state');
if (!profiles.some(row => row.role === 'admin' && row.is_active)) throw new Error('No active administrator remains');
if (accounts.some(row => !row.user_id)) throw new Error('An account has no owner');
for (const [table, rows] of [['progress', progress], ['sport_world_accounts', sportAccounts], ['sport_world_run_records', records], ['sport_world_sync_logs', syncLogs]]) {
  const invalid = rows.find(row => !row.user_id || owners.get(row.account_id || row.account_record_id) !== row.user_id);
  if (invalid) throw new Error(`${table} contains an ownership mismatch`);
}
console.log(JSON.stringify({
  migrationReady: true,
  profiles: profiles.length,
  activeAdmins: profiles.filter(row => row.role === 'admin' && row.is_active).length,
  customers: profiles.filter(row => ['user', 'customer'].includes(row.role)).length,
  accounts: accounts.length,
  progress: progress.length,
  sport_world_accounts: sportAccounts.length,
  sport_world_run_records: records.length,
  sport_world_sync_logs: syncLogs.length,
}));
