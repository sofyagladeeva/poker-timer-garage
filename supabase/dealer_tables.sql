-- Количество открытых столов
alter table public.game_state
add column if not exists "tableCount" integer not null default 4;

-- Уведомления флора (вызовы + выбывания от дилеров)
create table if not exists public.floor_notifications (
  id uuid primary key default gen_random_uuid(),
  session_id integer not null,
  type text not null check (type in ('floor_call', 'bustout')),
  table_number integer not null,
  player_id text,
  player_name text,
  projected_place integer,
  bounty integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'confirmed')),
  created_at timestamptz not null default timezone('utc', now()),
  confirmed_at timestamptz
);

alter table public.floor_notifications enable row level security;

drop policy if exists "floor_notifications_all" on public.floor_notifications;
create policy "floor_notifications_all"
on public.floor_notifications
for all
using (true)
with check (true);

alter publication supabase_realtime add table public.floor_notifications;
