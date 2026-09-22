-- Apply once to an existing Snowflake Sports / RunFlow database.
-- The statements are idempotent so the migration can be retried safely.

alter table public.profiles add column if not exists role text not null default 'admin';
alter table public.profiles alter column role set default 'customer';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'customer'));

alter table public.schools add column if not exists category_id uuid references public.account_categories(id) on delete restrict;
insert into public.account_categories (name, color) values
  ('主要账号','#5b5bd6'),
  ('备用账号','#f59e0b'),
  ('测试账号','#0ea5e9'),
  ('已停用','#94a3b8')
on conflict (name) do nothing;
update public.schools
set category_id = (select id from public.account_categories order by created_at limit 1)
where category_id is null;
alter table public.schools alter column category_id set not null;
create index if not exists schools_category_id_idx on public.schools(category_id);

create table if not exists public.running_types (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  name text not null,
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

create table if not exists public.face_options (
  id uuid primary key default gen_random_uuid(),
  running_type_id uuid not null references public.running_types(id) on delete restrict,
  name text not null,
  created_at timestamptz not null default now(),
  unique (running_type_id, name)
);

alter table public.accounts add column if not exists running_type_id uuid references public.running_types(id) on delete restrict;
alter table public.accounts add column if not exists face_option_id uuid references public.face_options(id) on delete restrict;
alter table public.accounts add column if not exists note text not null default '';

create table if not exists public.backup_settings (
  id boolean primary key default true check (id),
  auto_enabled boolean not null default false,
  frequency text not null default 'daily' check (frequency in ('daily', 'weekly', 'custom')),
  next_run_at timestamptz,
  last_run_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.backup_settings (id) values (true) on conflict (id) do nothing;

alter table public.running_types enable row level security;
alter table public.face_options enable row level security;
alter table public.backup_settings enable row level security;

drop policy if exists "authenticated running types" on public.running_types;
drop policy if exists "authenticated face options" on public.face_options;
drop policy if exists "authenticated backup settings" on public.backup_settings;
create policy "authenticated running types" on public.running_types for all to authenticated using (true) with check (true);
create policy "authenticated face options" on public.face_options for all to authenticated using (true) with check (true);
create policy "authenticated backup settings" on public.backup_settings for all to authenticated using (true) with check (true);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)), 'customer')
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;
