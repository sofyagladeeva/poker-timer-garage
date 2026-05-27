alter table public.game_state
  add column if not exists "showLogo" boolean not null default false;
