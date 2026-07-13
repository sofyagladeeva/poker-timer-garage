alter table public.game_state
  add column if not exists "extraAddonCount" integer not null default 0,
  add column if not exists "extraBonusCount" integer not null default 0;
