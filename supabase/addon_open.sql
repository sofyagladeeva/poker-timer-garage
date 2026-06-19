-- Add addonOpen column to game_state
ALTER TABLE game_state ADD COLUMN IF NOT EXISTS "addonOpen" boolean NOT NULL DEFAULT false;
