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
