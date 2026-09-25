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
