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
