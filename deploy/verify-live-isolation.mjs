import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnv(file) {
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#') && line.includes('=')).map(line => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  }));
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function expectRows(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data || [];
}

async function authenticatedClient(admin, env, profile) {
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: required(profile.email, `${profile.role} email`),
  });
  if (linkError) throw new Error(`generate ${profile.role} link: ${linkError.message}`);
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: verifyError } = await client.auth.verifyOtp({
    type: 'magiclink',
    token_hash: required(link.properties?.hashed_token, `${profile.role} token hash`),
  });
  if (verifyError) throw new Error(`verify ${profile.role} session: ${verifyError.message}`);
  return client;
}

const env = loadEnv(process.argv[2] || '.env.production');
required(env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
required(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
required(env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY');

const service = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const profiles = await expectRows(service.from('profiles').select('id,email,role,is_active'), 'service profiles');
const adminProfile = profiles.find(row => row.role === 'admin' && row.is_active);
const customerProfile = profiles.find(row => ['user', 'customer'].includes(row.role) && row.is_active);
if (!adminProfile || !customerProfile) throw new Error('An active admin and customer are required');

const serviceAccounts = await expectRows(service.from('accounts').select('id,user_id'), 'service accounts');
const foreignAccount = serviceAccounts.find(row => row.user_id !== customerProfile.id);
if (!foreignAccount) throw new Error('A foreign account is required to prove customer isolation');

const customer = await authenticatedClient(service, env, customerProfile);
const customerProfiles = await expectRows(customer.from('profiles').select('id,role'), 'customer profiles');
if (customerProfiles.length !== 1 || customerProfiles[0].id !== customerProfile.id) {
  throw new Error('Customer can read another profile');
}
const customerAccounts = await expectRows(customer.from('accounts').select('id,user_id'), 'customer accounts');
if (customerAccounts.some(row => row.user_id !== customerProfile.id)) {
  throw new Error('Customer can read another user account');
}
const foreignLookup = await expectRows(customer.from('accounts').select('id').eq('id', foreignAccount.id), 'customer foreign account lookup');
if (foreignLookup.length !== 0) throw new Error('Customer can query a foreign account by id');
const { error: customerAdminError } = await customer.rpc('admin_update_user', { target_id: customerProfile.id });
if (!customerAdminError) throw new Error('Customer can call admin_update_user');

const admin = await authenticatedClient(service, env, adminProfile);
const adminProfiles = await expectRows(admin.from('profiles').select('id'), 'admin profiles');
const adminAccounts = await expectRows(admin.from('accounts').select('id,user_id'), 'admin accounts');
if (adminProfiles.length !== profiles.length) throw new Error('Admin cannot read all profiles');
if (adminAccounts.length !== serviceAccounts.length) throw new Error('Admin cannot read all accounts');

await Promise.all([customer.auth.signOut({ scope: 'local' }), admin.auth.signOut({ scope: 'local' })]);
console.log(JSON.stringify({
  liveIsolationReady: true,
  profiles: profiles.length,
  accounts: serviceAccounts.length,
  customerVisibleAccounts: customerAccounts.length,
  customerForeignLookupRows: foreignLookup.length,
  customerAdminRpcDenied: true,
  adminVisibleProfiles: adminProfiles.length,
  adminVisibleAccounts: adminAccounts.length,
}));
