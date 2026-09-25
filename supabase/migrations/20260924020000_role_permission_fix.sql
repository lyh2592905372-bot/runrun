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
