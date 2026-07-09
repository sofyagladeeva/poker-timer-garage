create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  role text not null default 'dealer' check (role in ('dealer', 'admin', 'custom')),
  role_label text not null default 'Дилер',
  base_rate integer not null default 0 check (base_rate >= 0),
  phone text not null default '',
  telegram_username text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.staff add column if not exists phone text not null default '';
alter table public.staff add column if not exists telegram_username text not null default '';

alter table public.staff enable row level security;

drop policy if exists "staff_select_all" on public.staff;
create policy "staff_select_all" on public.staff for select using (true);

drop policy if exists "staff_insert_all" on public.staff;
create policy "staff_insert_all" on public.staff for insert with check (true);

drop policy if exists "staff_update_all" on public.staff;
create policy "staff_update_all" on public.staff for update using (true) with check (true);

drop policy if exists "staff_delete_all" on public.staff;
create policy "staff_delete_all" on public.staff for delete using (true);

do $$
begin
  alter publication supabase_realtime add table public.staff;
exception
  when duplicate_object then null;
end $$;
