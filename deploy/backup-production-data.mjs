import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const destination = process.argv[2];
if (!destination?.startsWith('/var/backups/runflow/')) throw new Error('Backup destination must be inside /var/backups/runflow');

function loadEnv(file) {
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#') && line.includes('=')).map(line => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  }));
}

const env = loadEnv('.env.production');
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const tables = [
  'profiles', 'account_categories', 'schools', 'running_types', 'face_options',
  'accounts', 'progress', 'operation_logs', 'backups', 'backup_settings',
  'sport_world_accounts', 'sport_world_run_records', 'sport_world_sync_logs',
];

async function readAll(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select('*').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return rows;
}

const snapshot = { version: 3, created_at: new Date().toISOString(), tables: {}, auth_users: [] };
for (const table of tables) snapshot.tables[table] = await readAll(table);
for (let page = 1; ; page += 1) {
  const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw new Error(`auth.users: ${error.message}`);
  snapshot.auth_users.push(...data.users);
  if (data.users.length < 1000) break;
}
writeFileSync(destination, JSON.stringify(snapshot));
chmodSync(destination, 0o600);
console.log(JSON.stringify({ destination, tables: Object.fromEntries(Object.entries(snapshot.tables).map(([name, rows]) => [name, rows.length])), auth_users: snapshot.auth_users.length }));
