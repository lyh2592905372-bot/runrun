-- Sport World read-only account synchronization. Safe to run more than once.
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
create index if not exists sport_world_run_records_account_date_idx on public.sport_world_run_records(account_record_id, start_time desc);
create table if not exists public.sport_world_sync_logs (
  id uuid primary key default gen_random_uuid(),
  account_record_id uuid not null references public.accounts(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  auth_method text,
  records_received integer not null default 0,
  records_created integer not null default 0,
  records_updated integer not null default 0,
  completed_runs integer,
  completed_distance numeric(12,2),
  error_code text,
  error_message text
);
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
