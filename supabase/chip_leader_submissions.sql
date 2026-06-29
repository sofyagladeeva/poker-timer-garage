-- Raw chip leader stacks submitted by dealer tablets per active table.
create table if not exists public.chip_leader_submissions (
  id uuid primary key default gen_random_uuid(),
  session_id integer not null,
  level_index integer not null,
  table_number integer not null,
  entries jsonb not null default '[]'::jsonb,
  submitted_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (session_id, level_index, table_number)
);

alter table public.chip_leader_submissions enable row level security;

drop policy if exists "chip_leader_submissions_all" on public.chip_leader_submissions;
create policy "chip_leader_submissions_all"
on public.chip_leader_submissions
for all
using (true)
with check (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chip_leader_submissions'
  ) then
    alter publication supabase_realtime add table public.chip_leader_submissions;
  end if;
end $$;
