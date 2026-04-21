create table if not exists public.background_library (
  id text primary key,
  name text not null,
  url text not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.background_library replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'background_library'
  ) then
    alter publication supabase_realtime add table public.background_library;
  end if;
end $$;

alter table public.background_library enable row level security;

drop policy if exists "background_library_select_all" on public.background_library;
create policy "background_library_select_all"
on public.background_library
for select
using (true);

drop policy if exists "background_library_insert_all" on public.background_library;
create policy "background_library_insert_all"
on public.background_library
for insert
with check (true);

drop policy if exists "background_library_update_all" on public.background_library;
create policy "background_library_update_all"
on public.background_library
for update
using (true)
with check (true);

drop policy if exists "background_library_delete_all" on public.background_library;
create policy "background_library_delete_all"
on public.background_library
for delete
using (true);
