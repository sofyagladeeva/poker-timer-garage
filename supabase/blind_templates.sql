create table if not exists public.blind_templates (
  id text primary key,
  name text not null,
  levels jsonb not null,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.blind_templates enable row level security;

drop policy if exists "blind_templates_select_all" on public.blind_templates;
create policy "blind_templates_select_all"
on public.blind_templates
for select
using (true);

drop policy if exists "blind_templates_insert_all" on public.blind_templates;
create policy "blind_templates_insert_all"
on public.blind_templates
for insert
with check (true);

drop policy if exists "blind_templates_update_all" on public.blind_templates;
create policy "blind_templates_update_all"
on public.blind_templates
for update
using (true)
with check (true);

drop policy if exists "blind_templates_delete_all" on public.blind_templates;
create policy "blind_templates_delete_all"
on public.blind_templates
for delete
using (true);
