-- Adds rebuyCost and addonCost to game_state.
-- null  = inherit from tournamentBuyIn (or default 1000)
-- 0     = free rebuys/addons
-- > 0   = explicit price per action
alter table public.game_state
  add column if not exists "rebuyCost" integer default null;

alter table public.game_state
  add column if not exists "addonCost" integer default null;
