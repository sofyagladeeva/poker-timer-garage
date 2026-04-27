-- Таблица архива турниров
create table if not exists public.tournaments (
  id bigint generated always as identity primary key,
  finished_at timestamptz not null default timezone('utc', now()),
  title text,
  players int not null default 0,
  rebuys int not null default 0,
  addon_count int not null default 0,
  bonus_count int,
  bonus_stack int,
  total_stack bigint not null default 0,
  levels_played int not null default 0
);

-- Отключить RLS (как у game_state и blind_levels) — доступ через anon key
alter table public.tournaments disable row level security;
