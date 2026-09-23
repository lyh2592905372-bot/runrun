-- Allow a free-form running schedule while preserving existing timestamps.
-- Existing timestamptz values are converted to their textual representation;
-- no account or order rows are deleted or reset.
alter table public.accounts add column if not exists running_time text;
alter table public.accounts alter column running_time type text using running_time::text;
