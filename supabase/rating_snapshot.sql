alter table public.game_state
  add column if not exists rating_snapshot jsonb;

alter table public.game_state
  add column if not exists bounty_snapshot jsonb;
