alter table public.game_state
  add column if not exists "tournamentBotId" integer default null;
