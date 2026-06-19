-- Heartbeat from public Display screens.
-- Admin uses this table to show which TV/browser screens are online.
create table if not exists public.display_clients (
  id text primary key,
  name text not null default 'TV экран',
  route text not null default 'display',
  user_agent text not null default '',
  last_seen_at timestamptz not null default timezone('utc', now()),
  current_level_index integer not null default 0,
  current_level_label text,
  status text not null default 'idle'
    check (status in ('idle', 'running', 'paused', 'break', 'ended'))
);

alter table public.display_clients enable row level security;

drop policy if exists "display_clients_all" on public.display_clients;
create policy "display_clients_all"
on public.display_clients
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
      and tablename = 'display_clients'
  ) then
    alter publication supabase_realtime add table public.display_clients;
  end if;
end $$;
