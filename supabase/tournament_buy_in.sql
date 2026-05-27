-- Adds tournamentBuyIn to game_state.
-- null  = default price (1000 ₽) for all actions
-- 0     = free entry; rebuys/addons cost 1000 ₽
-- > 0   = all actions (entry, rebuys, addons) cost this amount
alter table public.game_state
  add column if not exists "tournamentBuyIn" integer default null;
