-- Preserve accounts and child configuration rows when a configuration item is deleted.
-- Safe to retry: every foreign key is dropped and recreated with the intended action.
begin;

alter table public.accounts
  alter column category_id drop not null,
  alter column school_id drop not null,
  alter column running_type_id drop not null,
  alter column face_option_id drop not null;

alter table public.schools
  alter column category_id drop not null;

alter table public.running_types
  alter column school_id drop not null;

alter table public.face_options
  alter column running_type_id drop not null;

alter table public.accounts drop constraint if exists accounts_category_id_fkey;
alter table public.accounts drop constraint if exists accounts_school_id_fkey;
alter table public.accounts drop constraint if exists accounts_running_type_id_fkey;
alter table public.accounts drop constraint if exists accounts_face_option_id_fkey;
alter table public.schools drop constraint if exists schools_category_id_fkey;
alter table public.running_types drop constraint if exists running_types_school_id_fkey;
alter table public.face_options drop constraint if exists face_options_running_type_id_fkey;

alter table public.accounts
  add constraint accounts_category_id_fkey foreign key (category_id) references public.account_categories(id) on delete set null,
  add constraint accounts_school_id_fkey foreign key (school_id) references public.schools(id) on delete set null,
  add constraint accounts_running_type_id_fkey foreign key (running_type_id) references public.running_types(id) on delete set null,
  add constraint accounts_face_option_id_fkey foreign key (face_option_id) references public.face_options(id) on delete set null;

alter table public.schools
  add constraint schools_category_id_fkey foreign key (category_id) references public.account_categories(id) on delete set null;

alter table public.running_types
  add constraint running_types_school_id_fkey foreign key (school_id) references public.schools(id) on delete set null;

alter table public.face_options
  add constraint face_options_running_type_id_fkey foreign key (running_type_id) references public.running_types(id) on delete set null;

commit;
