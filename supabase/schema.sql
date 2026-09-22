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
create unique index if not exists accounts_username_school_idx on public.accounts (school_id, username) where deleted_at is null;
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
insert into public.profiles (id, email, display_name)
select id, email, coalesce(raw_user_meta_data->>'display_name', split_part(email, '@', 1))
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
