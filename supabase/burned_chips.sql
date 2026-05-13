alter table public.game_state
  add column if not exists "burnedChips" integer not null default 0;
