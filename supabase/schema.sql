-- Run in Supabase SQL Editor. The schema is intentionally normalized and keeps
-- derived progress values calculated at query time.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  created_at timestamptz not null default now()
);
create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);
create table if not exists public.account_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null default '#5b5bd6',
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists role text not null default 'admin';
alter table public.profiles alter column role set default 'customer';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'customer'));
alter table public.schools add column if not exists category_id uuid references public.account_categories(id) on delete set null;
create index if not exists schools_category_id_idx on public.schools(category_id);
create table if not exists public.running_types (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete set null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);
create table if not exists public.face_options (
  id uuid primary key default gen_random_uuid(),
  running_type_id uuid references public.running_types(id) on delete set null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (running_type_id, name)
);
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete set null,
  category_id uuid references public.account_categories(id) on delete set null,
  running_type_id uuid references public.running_types(id) on delete set null,
  face_option_id uuid references public.face_options(id) on delete set null,
  username text not null,
  encrypted_password text,
  distance_per_run numeric(10,2) not null check (distance_per_run > 0),
  order_count integer not null check (order_count > 0),
  order_time timestamptz not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.accounts add column if not exists running_type_id uuid references public.running_types(id) on delete set null;
alter table public.accounts add column if not exists face_option_id uuid references public.face_options(id) on delete set null;
alter table public.accounts add column if not exists note text not null default '';
-- The final user-isolation migration creates the owner-scoped unique index.
create index if not exists accounts_order_time_idx on public.accounts(order_time desc);
create table if not exists public.progress (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.accounts(id) on delete cascade,
  completed_runs integer not null default 0 check (completed_runs >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.operation_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  action_type text not null,
  target_type text not null,
  target_id uuid,
  description text not null,
  old_value jsonb,
  new_value jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);
create index if not exists operation_logs_created_at_idx on public.operation_logs(created_at desc);
create table if not exists public.backups (
  id uuid primary key default gen_random_uuid(),
  file_path text not null,
  size_bytes bigint,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.backup_settings (
  id boolean primary key default true check (id),
  auto_enabled boolean not null default false,
  frequency text not null default 'daily' check (frequency in ('daily', 'weekly', 'custom')),
  next_run_at timestamptz,
  last_run_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.backup_settings (id) values (true) on conflict (id) do nothing;

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists accounts_updated_at on public.accounts;
create trigger accounts_updated_at before update on public.accounts for each row execute function public.set_updated_at();
drop trigger if exists progress_updated_at on public.progress;
create trigger progress_updated_at before update on public.progress for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$ begin insert into public.profiles (id, email, display_name, role) values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)), 'customer') on conflict (id) do update set email = excluded.email; return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
insert into public.profiles (id, email, display_name, role)
select id, email, coalesce(raw_user_meta_data->>'display_name', split_part(email, '@', 1)), case when raw_app_meta_data->>'role' = 'admin' then 'admin' else 'customer' end
from auth.users
on conflict (id) do update set email = excluded.email;

alter table public.profiles enable row level security;
alter table public.schools enable row level security;
alter table public.account_categories enable row level security;
alter table public.running_types enable row level security;
alter table public.face_options enable row level security;
alter table public.accounts enable row level security;
alter table public.progress enable row level security;
alter table public.operation_logs enable row level security;
alter table public.backups enable row level security;
alter table public.backup_settings enable row level security;
drop policy if exists "authenticated profiles" on public.profiles;
drop policy if exists "authenticated schools" on public.schools;
drop policy if exists "authenticated categories" on public.account_categories;
drop policy if exists "authenticated running types" on public.running_types;
drop policy if exists "authenticated face options" on public.face_options;
drop policy if exists "authenticated accounts" on public.accounts;
drop policy if exists "authenticated progress" on public.progress;
drop policy if exists "authenticated logs" on public.operation_logs;
drop policy if exists "insert own logs" on public.operation_logs;
drop policy if exists "authenticated backups" on public.backups;
drop policy if exists "authenticated backup settings" on public.backup_settings;
create policy "authenticated profiles" on public.profiles for select to authenticated using (id = auth.uid());
create policy "authenticated schools" on public.schools for all to authenticated using (true) with check (true);
create policy "authenticated categories" on public.account_categories for all to authenticated using (true) with check (true);
create policy "authenticated running types" on public.running_types for all to authenticated using (true) with check (true);
create policy "authenticated face options" on public.face_options for all to authenticated using (true) with check (true);
create policy "authenticated accounts" on public.accounts for all to authenticated using (true) with check (true);
create policy "authenticated progress" on public.progress for all to authenticated using (true) with check (true);
create policy "authenticated logs" on public.operation_logs for select to authenticated using (true);
create policy "insert own logs" on public.operation_logs for insert to authenticated with check (user_id = auth.uid());
create policy "authenticated backups" on public.backups for all to authenticated using (true) with check (created_by = auth.uid());
create policy "authenticated backup settings" on public.backup_settings for all to authenticated using (true) with check (true);
insert into public.account_categories (name, color) values ('主要账号','#5b5bd6'), ('备用账号','#f59e0b'), ('测试账号','#0ea5e9'), ('已停用','#94a3b8') on conflict (name) do nothing;
update public.schools
set category_id = (select id from public.account_categories order by created_at limit 1)
where category_id is null;
alter table public.schools alter column category_id drop not null;

insert into storage.buckets (id, name, public) values ('backups', 'backups', false)
on conflict (id) do update set public = false;
drop policy if exists "backup objects read own folder" on storage.objects;
drop policy if exists "backup objects insert own folder" on storage.objects;
drop policy if exists "backup objects delete own folder" on storage.objects;
create policy "backup objects read own folder" on storage.objects for select to authenticated using (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "backup objects insert own folder" on storage.objects for insert to authenticated with check (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "backup objects delete own folder" on storage.objects for delete to authenticated using (bucket_id = 'backups' and (storage.foldername(name))[1] = auth.uid()::text);

-- Sport World read-only synchronization tables. Keep secrets server-side and never select
-- encrypted columns in browser-facing API responses.
create table if not exists public.sport_world_accounts (
  id uuid primary key default gen_random_uuid(),
  account_record_id uuid not null unique references public.accounts(id) on delete cascade,
  sport_account text not null,
  sport_password_encrypted text,
  sport_uid text,
  sport_unid text,
  sport_token_encrypted text,
  token_status text not null default 'unknown' check (token_status in ('valid', 'expired', 'unknown', 'need_verify')),
  sync_enabled boolean not null default false,
  last_sync_at timestamptz,
  last_sync_status text not null default 'never_synced' check (last_sync_status in ('never_synced', 'syncing', 'success', 'failed', 'token_expired', 'need_verify')),
  last_sync_error text,
  sync_started_at timestamptz,
  current_semester text,
  semester_started_at timestamptz,
  semester_ended_at timestamptz,
  completion_status text,
  target_runs integer,
  target_distance numeric(12,2),
  completed_runs integer not null default 0 check (completed_runs >= 0),
  completed_distance numeric(12,2) not null default 0 check (completed_distance >= 0),
  latest_run_at timestamptz,
  latest_run_distance numeric(10,2),
  manual_run_adjustment integer not null default 0,
  manual_distance_adjustment numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sport_world_accounts_status_idx on public.sport_world_accounts(last_sync_status, sync_enabled);
create table if not exists public.sport_world_run_records (
  id uuid primary key default gen_random_uuid(),
  account_record_id uuid not null references public.accounts(id) on delete cascade,
  sport_world_record_id text not null,
  run_date date,
  start_time timestamptz,
  end_time timestamptz,
  distance numeric(10,2) not null default 0 check (distance >= 0),
  duration integer,
  pace numeric(10,2),
  status text,
  is_valid boolean not null default false,
  sport_type text,
  semester text,
  raw_status text,
  source text not null default 'sport_world',
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_record_id, sport_world_record_id)
);
create table if not exists public.sport_world_sync_logs (
  id uuid primary key default gen_random_uuid(), account_record_id uuid not null references public.accounts(id) on delete cascade,
  started_at timestamptz not null default now(), finished_at timestamptz, status text not null, auth_method text,
  records_received integer not null default 0, records_created integer not null default 0, records_updated integer not null default 0,
  completed_runs integer, completed_distance numeric(12,2), error_code text, error_message text
);
create index if not exists sport_world_run_records_account_date_idx on public.sport_world_run_records(account_record_id, start_time desc);
create index if not exists sport_world_sync_logs_account_idx on public.sport_world_sync_logs(account_record_id, started_at desc);
drop trigger if exists sport_world_accounts_updated_at on public.sport_world_accounts;
create trigger sport_world_accounts_updated_at before update on public.sport_world_accounts for each row execute function public.set_updated_at();
drop trigger if exists sport_world_run_records_updated_at on public.sport_world_run_records;
create trigger sport_world_run_records_updated_at before update on public.sport_world_run_records for each row execute function public.set_updated_at();
alter table public.sport_world_accounts enable row level security;
alter table public.sport_world_run_records enable row level security;
alter table public.sport_world_sync_logs enable row level security;
drop policy if exists "authenticated sport world accounts" on public.sport_world_accounts;
drop policy if exists "authenticated sport world records" on public.sport_world_run_records;
drop policy if exists "authenticated sport world logs" on public.sport_world_sync_logs;
create policy "authenticated sport world accounts" on public.sport_world_accounts for all to authenticated using (true) with check (true);
create policy "authenticated sport world records" on public.sport_world_run_records for all to authenticated using (true) with check (true);
create policy "authenticated sport world logs" on public.sport_world_sync_logs for all to authenticated using (true) with check (true);

-- Current business fields for fresh installs.
-- Add only the platform-specific account details that cannot be represented by
-- existing account columns. Existing categories and account data are preserved.
alter table public.accounts add column if not exists campus_name text;
alter table public.accounts add column if not exists fence_name text;
alter table public.accounts add column if not exists student_name text;
alter table public.accounts add column if not exists student_id text;

insert into public.account_categories (name, color) values
  ('运动世界', '#5b5bd6'),
  ('闪动校园', '#0ea5e9'),
  ('支付宝阳光跑', '#f59e0b')
on conflict (name) do nothing;

-- Allow a free-form running schedule while preserving existing timestamps.
-- Existing timestamptz values are converted to their textual representation;
-- no account or order rows are deleted or reset.
alter table public.accounts add column if not exists running_time text;
alter table public.accounts alter column running_time type text using running_time::text;

-- Additive migration: preserve legacy counters consumed outside progress management.
begin;

alter table public.progress
  add column if not exists auto_completed_count integer not null default 0 check (auto_completed_count >= 0),
  add column if not exists manual_override boolean not null default false,
  add column if not exists manual_override_count integer default null,
  add column if not exists manual_override_order_time timestamptz default null;

-- Changing the order boundary invalidates only the new order-progress state.
create or replace function public.reset_order_progress_override()
returns trigger language plpgsql set search_path = public as $$
begin
  update public.progress
  set auto_completed_count = 0,
      manual_override = false,
      manual_override_count = null,
      manual_override_order_time = null
  where account_id = new.id;
  return new;
end;
$$;

drop trigger if exists accounts_reset_order_progress_override on public.accounts;
create trigger accounts_reset_order_progress_override
  after update of order_time on public.accounts
  for each row when (old.order_time is distinct from new.order_time)
  execute function public.reset_order_progress_override();

notify pgrst, 'reload schema';
commit;


-- User isolation (also distributed as an incremental migration).
-- Apply after all earlier migrations. All ownership changes and policies commit together.
-- Never infer privileges from user-editable raw_user_meta_data.
begin;

alter table public.profiles add column if not exists role text not null default 'admin';
alter table public.profiles alter column role set default 'customer';
alter table public.profiles add column if not exists is_active boolean not null default true;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'customer'));

insert into public.profiles (id, email, display_name, role)
select id, email, coalesce(raw_user_meta_data->>'display_name', split_part(email, '@', 1)),
  case when raw_app_meta_data->>'role' = 'admin' then 'admin' else 'customer' end
from auth.users on conflict (id) do nothing;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)), 'customer')
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.accounts add column if not exists user_id uuid references public.profiles(id) on delete restrict;
alter table public.progress add column if not exists user_id uuid references public.profiles(id) on delete restrict;
alter table public.sport_world_accounts add column if not exists user_id uuid references public.profiles(id) on delete restrict;
alter table public.sport_world_run_records add column if not exists user_id uuid references public.profiles(id) on delete restrict;
-- The existing application's sync_logs table is named sport_world_sync_logs.
alter table public.sport_world_sync_logs add column if not exists user_id uuid references public.profiles(id) on delete restrict;

-- Preserve ownership when creation audit evidence exists; otherwise use the oldest admin.
-- Backfilling ownership must not rewrite historical business timestamps.
alter table public.accounts disable trigger accounts_updated_at;
alter table public.progress disable trigger progress_updated_at;
alter table public.sport_world_accounts disable trigger sport_world_accounts_updated_at;
alter table public.sport_world_run_records disable trigger sport_world_run_records_updated_at;
update public.accounts a set user_id = (
  select l.user_id from public.operation_logs l join public.profiles p on p.id = l.user_id
  where l.target_id = a.id and l.target_type = 'account'
    and l.action_type in ('create_account', 'add_sport_world_binding')
  order by l.created_at, l.id limit 1
) where a.user_id is null;
update public.accounts set user_id = (select id from public.profiles where role = 'admin' order by created_at, id limit 1)
where user_id is null;
do $$ begin
  if exists (select 1 from public.accounts where user_id is null) then
    raise exception 'Legacy accounts have no owner. Set the existing administrator profile role to admin and retry; no data was changed.';
  end if;
end $$;
update public.progress p set user_id = a.user_id from public.accounts a where p.account_id = a.id and p.user_id is distinct from a.user_id;
update public.sport_world_accounts p set user_id = a.user_id from public.accounts a where p.account_record_id = a.id and p.user_id is distinct from a.user_id;
update public.sport_world_run_records p set user_id = a.user_id from public.accounts a where p.account_record_id = a.id and p.user_id is distinct from a.user_id;
update public.sport_world_sync_logs p set user_id = a.user_id from public.accounts a where p.account_record_id = a.id and p.user_id is distinct from a.user_id;
alter table public.accounts enable trigger accounts_updated_at;
alter table public.progress enable trigger progress_updated_at;
alter table public.sport_world_accounts enable trigger sport_world_accounts_updated_at;
alter table public.sport_world_run_records enable trigger sport_world_run_records_updated_at;

alter table public.accounts alter column user_id set not null;
alter table public.accounts alter column user_id set default auth.uid();
alter table public.progress alter column user_id set not null;
alter table public.sport_world_accounts alter column user_id set not null;
alter table public.sport_world_run_records alter column user_id set not null;
alter table public.sport_world_sync_logs alter column user_id set not null;
drop index if exists public.accounts_username_school_idx;
create unique index if not exists accounts_user_username_school_idx on public.accounts(user_id, school_id, username) where deleted_at is null;
create index if not exists accounts_user_created_idx on public.accounts(user_id, created_at desc);
create index if not exists progress_user_idx on public.progress(user_id);
create index if not exists sport_world_accounts_user_idx on public.sport_world_accounts(user_id);
create index if not exists sport_world_records_user_idx on public.sport_world_run_records(user_id, start_time desc);
create index if not exists sport_world_logs_user_idx on public.sport_world_sync_logs(user_id, started_at desc);
create index if not exists operation_logs_user_idx on public.operation_logs(user_id, created_at desc);

-- Ownership is immutable. Child rows inherit the account owner, including cron jobs
-- with a service-role client and restores of older backups without user_id.
create or replace function public.keep_account_owner() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.user_id is distinct from old.user_id then raise exception 'Account ownership cannot be changed' using errcode = '42501'; end if;
  return new;
end;
$$;
drop trigger if exists accounts_keep_owner on public.accounts;
create trigger accounts_keep_owner before update on public.accounts for each row execute function public.keep_account_owner();
create or replace function public.set_child_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid; parent_id uuid;
begin
  parent_id := (to_jsonb(new)->>TG_ARGV[0])::uuid;
  select user_id into owner_id from public.accounts where id = parent_id;
  if owner_id is null then raise exception 'Account not found' using errcode = '23503'; end if;
  if new.user_id is not null and new.user_id <> owner_id then
    raise exception 'Account owner mismatch' using errcode = '42501';
  end if;
  new.user_id := owner_id;
  return new;
end;
$$;
drop trigger if exists progress_set_owner on public.progress;
create trigger progress_set_owner before insert or update on public.progress for each row execute function public.set_child_owner('account_id');
drop trigger if exists sport_world_accounts_set_owner on public.sport_world_accounts;
create trigger sport_world_accounts_set_owner before insert or update on public.sport_world_accounts for each row execute function public.set_child_owner('account_record_id');
drop trigger if exists sport_world_records_set_owner on public.sport_world_run_records;
create trigger sport_world_records_set_owner before insert or update on public.sport_world_run_records for each row execute function public.set_child_owner('account_record_id');
drop trigger if exists sport_world_logs_set_owner on public.sport_world_sync_logs;
create trigger sport_world_logs_set_owner before insert or update on public.sport_world_sync_logs for each row execute function public.set_child_owner('account_record_id');

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active);
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active);
$$;
revoke all on function public.is_active_user(), public.is_admin() from public;
grant execute on function public.is_active_user(), public.is_admin() to authenticated;

-- Remove old permissive policies: policies combine with OR, so leaving one is unsafe.
do $$ declare p record; begin
  for p in select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('profiles','accounts','progress','sport_world_accounts',
      'sport_world_run_records','sport_world_sync_logs','operation_logs','schools','account_categories',
      'running_types','face_options','backups','backup_settings')
  loop execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename); end loop;
end $$;

alter table public.profiles enable row level security;
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

do $$ declare t text; begin
  foreach t in array array['accounts','progress','sport_world_accounts','sport_world_run_records','sport_world_sync_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy owner_access on public.%I for all to authenticated using ((select public.is_active_user()) and (user_id = (select auth.uid()) or (select public.is_admin()))) with check ((select public.is_active_user()) and (user_id = (select auth.uid()) or (select public.is_admin())))', t);
  end loop;
end $$;

-- These are shared lookup options, not customer records. Preserve inline creation
-- in account forms; only administrators may rename/delete options used by others.
do $$ declare t text; begin
  foreach t in array array['schools','account_categories','running_types','face_options'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy lookup_read on public.%I for select to authenticated using ((select public.is_active_user()))', t);
    execute format('create policy lookup_create on public.%I for insert to authenticated with check ((select public.is_active_user()))', t);
    execute format('create policy lookup_update on public.%I for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', t);
    execute format('create policy lookup_delete on public.%I for delete to authenticated using ((select public.is_admin()))', t);
  end loop;
end $$;
alter table public.operation_logs enable row level security;
create policy logs_read on public.operation_logs for select to authenticated using ((select public.is_active_user()) and (user_id = (select auth.uid()) or (select public.is_admin())));
create policy logs_insert on public.operation_logs for insert to authenticated with check ((select public.is_active_user()) and user_id = (select auth.uid()) and
  (target_type <> 'account' or exists (select 1 from public.accounts a where a.id = target_id and (a.user_id = (select auth.uid()) or (select public.is_admin())))));
alter table public.backups enable row level security;
alter table public.backup_settings enable row level security;
create policy admin_backups on public.backups for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy admin_backup_settings on public.backup_settings for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "backup objects read own folder" on storage.objects;
drop policy if exists "backup objects insert own folder" on storage.objects;
drop policy if exists "backup objects delete own folder" on storage.objects;
drop policy if exists admin_backup_objects on storage.objects;
create policy admin_backup_objects on storage.objects for all to authenticated
using (bucket_id = 'backups' and (select public.is_admin())) with check (bucket_id = 'backups' and (select public.is_admin()));

-- Restricted RPC is the sole authenticated write path to roles/activation.
create or replace function public.admin_update_user(target_id uuid, new_role text default null,
  new_active boolean default null, new_display_name text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare target public.profiles;
begin
  perform pg_advisory_xact_lock(9282401);
  if not public.is_admin() then raise exception 'Administrator required' using errcode = '42501'; end if;
  select * into target from public.profiles where id = target_id for update;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  if new_role is not null and new_role not in ('admin','customer') then raise exception 'Invalid role' using errcode = '22023'; end if;
  if target_id = auth.uid() and (new_role = 'customer' or new_active = false) then
    raise exception 'Cannot disable or demote yourself' using errcode = '42501';
  end if;
  if target.role = 'admin' and target.is_active and (new_role = 'customer' or new_active = false)
    and (select count(*) from public.profiles where role = 'admin' and is_active) <= 1 then
    raise exception 'At least one active administrator is required' using errcode = '42501';
  end if;
  update public.profiles set role = coalesce(new_role, role), is_active = coalesce(new_active, is_active),
    display_name = coalesce(new_display_name, display_name) where id = target_id;
  insert into public.operation_logs(user_id, action_type, target_type, target_id, description, old_value, new_value)
    values (auth.uid(), 'update_user', 'user', target_id, '管理员更新用户权限',
      jsonb_build_object('role', target.role, 'is_active', target.is_active),
      jsonb_build_object('role', coalesce(new_role, target.role), 'is_active', coalesce(new_active, target.is_active)));
end;
$$;
revoke all on function public.admin_update_user(uuid,text,boolean,text) from public;
grant execute on function public.admin_update_user(uuid,text,boolean,text) to authenticated;
revoke all on function public.handle_new_user(), public.set_child_owner(), public.keep_account_owner() from public;
notify pgrst, 'reload schema';
commit;

-- Role compatibility for the administrator permission fix.
-- Permission-only compatibility: user and legacy customer are both ordinary users.
-- Existing profiles, ownership, data and RLS policies are preserved.
begin;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'user', 'customer'));

create or replace function public.admin_update_user(target_id uuid, new_role text default null,
  new_active boolean default null, new_display_name text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare target public.profiles;
begin
  perform pg_advisory_xact_lock(9282401);
  if not public.is_admin() then raise exception 'Administrator required' using errcode = '42501'; end if;
  select * into target from public.profiles where id = target_id for update;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  if new_role is not null and new_role not in ('admin','user','customer') then raise exception 'Invalid role' using errcode = '22023'; end if;
  if target_id = auth.uid() and (new_role in ('user','customer') or new_active = false) then
    raise exception 'Cannot disable or demote yourself' using errcode = '42501';
  end if;
  if target.role = 'admin' and target.is_active and (new_role in ('user','customer') or new_active = false)
    and (select count(*) from public.profiles where role = 'admin' and is_active) <= 1 then
    raise exception 'At least one active administrator is required' using errcode = '42501';
  end if;
  update public.profiles set role = coalesce(new_role, role), is_active = coalesce(new_active, is_active),
    display_name = coalesce(new_display_name, display_name) where id = target_id;
  insert into public.operation_logs(user_id, action_type, target_type, target_id, description, old_value, new_value)
    values (auth.uid(), 'update_user', 'user', target_id, '管理员更新用户权限',
      jsonb_build_object('role', target.role, 'is_active', target.is_active),
      jsonb_build_object('role', coalesce(new_role, target.role), 'is_active', coalesce(new_active, target.is_active)));
end;
$$;
revoke all on function public.admin_update_user(uuid,text,boolean,text) from public;
grant execute on function public.admin_update_user(uuid,text,boolean,text) to authenticated;
notify pgrst, 'reload schema';
commit;
