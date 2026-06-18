-- Stores the temporary chip-leader slate shown on the display after a break.
-- Shape:
-- {
--   "levelIndex": 8,
--   "entries": [
--     { "id": "chip-1", "playerId": "...", "name": "Player", "stack": 125000 }
--   ]
-- }
alter table public.game_state
  add column if not exists "chipLeaders" jsonb default null;
